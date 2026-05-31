import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { join } from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Inbox } from './inbox.js';
import { TaskTracker } from './tasks.js';
import { ConnectionManager } from './connection.js';
import { createToolHandlers } from './tools.js';

const AP_DIR = join(process.env.HOME, '.agent-protocol');
const INBOX_BASE = join(AP_DIR, 'inbox');
const NOTIFICATIONS_FILE = join(AP_DIR, 'notifications');

const DEBUG = process.env.AGENT_PROTOCOL_DEBUG === '1';
function log(event, data = {}) {
  if (!DEBUG) return;
  try {
    process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + '\n');
  } catch { /* never let logging crash the bridge */ }
}

function writeNotificationToFile(text) {
  try {
    mkdirSync(AP_DIR, { recursive: true });
    appendFileSync(NOTIFICATIONS_FILE, text + '\n', { mode: 0o600 });
    return true;
  } catch (err) {
    log('file_write_failed', { error: err.message });
    return false;
  }
}

// Event emitter for instant wakeup of wait_for_messages
const messageEvents = new EventEmitter();

// Session state — starts disconnected
let connection = null;
let inbox = null;
let taskTracker = new TaskTracker();
let handlers = null;
let cleanupInterval = null;
const pendingNotifications = [];

async function doConnect({ relay_url, name, admin_key }) {
  if (connection && connection.isConnected()) {
    await connection.disconnect();
  }
  pendingNotifications.length = 0;
  log('connecting', { relay_url, name });

  const agentCard = {
    name,
    description: `Agent ${name}`,
    version: '1.0.0',
    protocolVersion: '1.0',
    capabilities: { streaming: false, pushNotifications: true },
    skills: [{ id: 'general', name: 'General', description: 'General agent', tags: ['general'] }],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
  };

  inbox = new Inbox(join(INBOX_BASE, name));
  taskTracker = new TaskTracker();

  connection = new ConnectionManager({
    relayUrl: relay_url,
    agentCard,
    adminKey: admin_key,
    onMessage: (msg) => {
      if (msg.method === 'tasks/receive') {
        try { inbox.writeMessage(msg.params); } catch (err) { log('inbox_write_failed', { error: err.message, taskId: msg.params?.taskId }); }
        deliver(formatNotification(msg.params), { taskId: msg.params?.taskId, kind: 'receive' });
      } else if (msg.method === 'tasks/update') {
        try { taskTracker.updateSentStatus(msg.params.taskId, msg.params.status); } catch {}
        deliver(formatUpdateNotification(msg.params), { taskId: msg.params?.taskId, kind: 'update' });
      } else {
        log('unknown_method', { method: msg.method });
      }
    },
    onDisconnect: (code) => {
      log('disconnected', { code });
      if (code !== 1000) {
        deliver('[relay disconnected, reconnecting...]', { kind: 'system' });
      }
    },
  });

  const result = await connection.connect();
  handlers = createToolHandlers(connection, inbox, taskTracker);

  if (cleanupInterval) clearInterval(cleanupInterval);
  cleanupInterval = setInterval(() => {
    inbox.cleanup({ completed_ttl_minutes: 60, stale_ttl_hours: 24 });
  }, 60 * 60 * 1000);

  return { connected: true, agent_name: name, relay_url, connected_agents: result.connectedAgents || [] };
}

function requireConnected() {
  if (!connection || !connection.isConnected()) {
    throw new Error('Not connected. Use the "connect" tool first with relay_url, name, and admin_key.');
  }
}

function drainNotifications() {
  const notifications = pendingNotifications.splice(0);
  if (notifications.length === 0) return '';
  return notifications.join('\n\n') + '\n\n---\n\n';
}

function wrapHandler(handler, { appendWaitInstruction = false } = {}) {
  return async (args) => {
    requireConnected();
    const result = await handler(args);
    let text = JSON.stringify(result, null, 2);
    if (appendWaitInstruction) {
      text += '\n\n[Now call get_messages with max_wait to listen for the response.]';
    }
    return { content: [{ type: 'text', text }] };
  };
}

function formatNotification(params) {
  const parts = params.message?.parts || [];
  const textParts = parts.filter(p => p.text).map(p => p.text);
  const dataParts = parts.filter(p => p.data);
  let text = `── Incoming from ${params.from} (task: ${params.taskId}) ──────────────────\n`;
  text += '[EXTERNAL AGENT MESSAGE]\n\n';
  text += textParts.join('\n');
  if (dataParts.length > 0) { text += '\n\nAttached data:\n'; for (const p of dataParts) text += JSON.stringify(p.data, null, 2) + '\n'; }
  text += `\n\n[ACTION REQUIRED: When you have completed this request or have a response, you MUST reply using: update_task({ taskId: "${params.taskId}", status: "completed", text: "your response here" }). If you cannot complete it, use status: "failed" with an explanation.]`;
  text += '\n───────────────────────────────────────────────';
  return text;
}

function formatUpdateNotification(params) {
  let text = `── Task update from ${params.from} ──────────────────\nTask ${params.taskId}: ${params.status}`;
  if (params.message?.parts) { const tp = params.message.parts.filter(p => p.text).map(p => p.text); if (tp.length > 0) text += '\n' + tp.join('\n'); }
  text += '\n───────────────────────────────────────────────';
  return text;
}

// --- Channel push notifications ---

// Sends an MCP server-initiated notification to wake up idle sessions.
// Uses mcpServer.server (the underlying Protocol/Server instance) which exposes
// notification() for arbitrary one-way messages. Unknown methods fall through
// assertNotificationCapability() without error, so no capability flag is required
// for this to work — but we advertise it in experimental capabilities anyway.
// Returns true on apparent success, false on throw (transport not connected, etc).
// Note: this is fire-and-forget JSON-RPC — "success" only means the call did not
// synchronously throw. If the client silently ignores the notification, we cannot
// detect that here.
function pushChannel(text, meta = {}) {
  try {
    mcpServer.server.notification({
      method: 'notifications/claude/channel',
      params: { content: text, meta: { source: 'agent-protocol', ...meta } },
    });
    log('channel_pushed', meta);
    return true;
  } catch (err) {
    log('channel_push_failed', { error: err.message, ...meta });
    return false;
  }
}

// Channel-first delivery with file + tool-result fallback.
// On channel success, the message reaches the active Claude Code session
// immediately and we do nothing else — avoids the historical triple-delivery
// (channel + file + pendingNotifications) that surfaced the same message twice.
// On channel failure, fall back to the file (PostToolUse hook drains it on
// next tool call) AND pendingNotifications (piggybacked onto next tool result).
function deliver(text, meta = {}) {
  messageEvents.emit('message');
  if (pushChannel(text, meta)) return;
  pendingNotifications.push(text);
  writeNotificationToFile(text);
}

// --- MCP Server ---

const mcpServer = new McpServer(
  { name: 'agent-protocol-bridge', version: '1.0.0' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
      },
    },
  }
);

// -- Connection tools --

mcpServer.registerTool('connect', {
  description: 'Connect to an agent relay server',
  inputSchema: {
    relay_url: z.string().describe('Relay WebSocket URL (e.g., ws://localhost:8080)'),
    name: z.string().describe('Agent name to register as'),
    admin_key: z.string().describe('Relay admin key'),
  },
}, async (args) => {
  try {
    const result = await doConnect(args);
    let text = JSON.stringify(result, null, 2);
    text += `\n\n[SETUP REQUIRED: Spawn a background subagent to listen for incoming messages. IMPORTANT: Do NOT call get_messages with max_wait on the main thread — it will block you for minutes.

Use the Agent tool with run_in_background: true and this exact prompt:

"You are a background message poller. Follow these steps exactly.

SETUP — run these ToolSearch calls first to load your tools:
1. ToolSearch(query: \\"select:mcp__agent-protocol__get_messages\\", max_results: 1)
2. ToolSearch(query: \\"select:SendMessage\\", max_results: 1)

LOOP:
1. Call mcp__agent-protocol__get_messages(max_wait: 300)
2. If a message is returned, call SendMessage(to: \\"user\\", summary: \\"Relay: <sender name>\\", message: \\"<full message content>\\")
3. Go to step 1.

IMPORTANT:
- SendMessage is an INTERNAL tool for talking to the main thread. It is NOT mcp__agent-protocol__send_message (that sends to external relay agents).
- Do not interpret or filter messages. Forward everything verbatim.
- If get_messages times out with no messages, just call it again."

Do NOT call get_messages with max_wait on the main thread yourself under any circumstances.]`;
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    log('connect_failed', { error: err.message });
    return { content: [{ type: 'text', text: `Connection failed: ${err.message}` }] };
  }
});

mcpServer.registerTool('disconnect', {
  description: 'Disconnect from the relay server',
}, async () => {
  if (connection) await connection.disconnect();
  connection = null; handlers = null;
  return { content: [{ type: 'text', text: 'Disconnected. The message listener subagent will stop on its next poll when it detects the connection is lost.' }] };
});

// -- Messaging tools --

mcpServer.registerTool('send_message', {
  description: 'Send a message to a specific agent',
  inputSchema: {
    to: z.string().describe('Target agent name'),
    text: z.string().describe('Message text'),
    data: z.any().optional().describe('Optional structured data to attach'),
  },
}, wrapHandler(async (args) => handlers.send_message(args), { appendWaitInstruction: true }));

mcpServer.registerTool('broadcast', {
  description: 'Send a message to all connected agents',
  inputSchema: {
    text: z.string().describe('Message text'),
    data: z.any().optional().describe('Optional structured data to attach'),
  },
}, wrapHandler(async (args) => handlers.broadcast(args), { appendWaitInstruction: true }));

mcpServer.registerTool('update_task', {
  description: 'Update a received task status (working/completed/failed)',
  inputSchema: {
    taskId: z.string().describe('Task ID to update'),
    status: z.enum(['working', 'completed', 'failed']).describe('New status'),
    text: z.string().optional().describe('Optional response message'),
  },
}, wrapHandler(async (args) => handlers.update_task(args), { appendWaitInstruction: true }));

// -- get_messages: unified message reader --

mcpServer.registerTool('get_messages', {
  description: 'Get messages from other agents. Returns immediately by default. Set max_wait > 0 to block until a message arrives.',
  inputSchema: {
    max_wait: z.number().optional().default(0).describe('Seconds to wait for messages (0 = return immediately, >0 = block up to N seconds)'),
  },
}, async (args) => {
  requireConnected();

  function collect() {
    const parts = [];
    const unread = inbox.getUnread();
    if (unread.length > 0) {
      for (const msg of unread) inbox.markRead(msg.taskId);
      parts.push(unread.map(m => formatNotification(m)).join('\n\n'));
    }
    const drained = drainNotifications();
    if (drained) {
      parts.push(drained);
    }
    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  const immediate = collect();
  if (immediate) return { content: [{ type: 'text', text: immediate }] };

  const maxWait = (args.max_wait ?? 0) * 1000;
  if (maxWait <= 0) {
    return { content: [{ type: 'text', text: 'No new messages.' }] };
  }

  const started = Date.now();
  while (Date.now() - started < maxWait) {
    const remaining = maxWait - (Date.now() - started);
    if (remaining <= 0) break;
    const cycleTimeout = Math.min(90 * 1000, remaining);

    const arrived = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        messageEvents.removeListener('message', onMsg);
        resolve(false);
      }, cycleTimeout);
      function onMsg() { clearTimeout(timer); resolve(true); }
      messageEvents.once('message', onMsg);
    });

    if (arrived) {
      const text = collect();
      if (text) return { content: [{ type: 'text', text }] };
    }

    if (!connection || !connection.isConnected()) {
      return { content: [{ type: 'text', text: 'Connection lost while waiting for messages.' }] };
    }
  }

  return { content: [{ type: 'text', text: 'No messages received within timeout.' }] };
});

// -- Query tools --

mcpServer.registerTool('list_agents', { description: 'List all connected peer agents' }, wrapHandler(async () => handlers.list_agents({})));
mcpServer.registerTool('discover_agents', { description: 'Find agents by skill tag', inputSchema: { tag: z.string().describe('Skill tag to search for') } }, wrapHandler(async (args) => handlers.discover_agents(args)));
mcpServer.registerTool('get_task_status', { description: 'Check the status of a task', inputSchema: { taskId: z.string().describe('Task ID to check') } }, wrapHandler(async (args) => handlers.get_task_status(args)));
mcpServer.registerTool('get_connection_status', { description: 'Check relay connection status' }, async () => {
  const connected = connection?.isConnected() || false;
  const text = JSON.stringify({ connected }, null, 2);
  return { content: [{ type: 'text', text }] };
});

const transport = new StdioServerTransport();
await mcpServer.connect(transport);
