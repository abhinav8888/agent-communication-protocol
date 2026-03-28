import { describe, it, expect, afterEach } from 'vitest';
import { createRelayServer } from '@agent-protocol/relay';
import { ConnectionManager } from '../src/connection.js';

const PORT = 9877;
const ADMIN_KEY = 'test-admin-key';

const makeCard = (name) => ({
  name, description: `Agent ${name}`, version: '1.0.0', protocolVersion: '1.0',
  capabilities: { streaming: false, pushNotifications: true },
  skills: [{ id: 's1', name: 'Skill', description: 'A skill', tags: ['test'] }],
  defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
});

describe('ConnectionManager', () => {
  let server, conn;
  afterEach(async () => { if (conn) await conn.disconnect(); if (server) await server.close(); });

  it('connects to relay and registers', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    conn = new ConnectionManager({ relayUrl: `ws://127.0.0.1:${PORT}`, agentCard: makeCard('bridge-test'), adminKey: ADMIN_KEY });
    const result = await conn.connect();
    expect(result.registered).toBe(true);
    expect(result.sessionSecret).toBeDefined();
    expect(conn.isConnected()).toBe(true);
  });

  it('sends a message and gets delivery confirmation', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    conn = new ConnectionManager({ relayUrl: `ws://127.0.0.1:${PORT}`, agentCard: makeCard('bridge-a'), adminKey: ADMIN_KEY });
    await conn.connect();
    const conn2 = new ConnectionManager({ relayUrl: `ws://127.0.0.1:${PORT}`, agentCard: makeCard('bridge-b'), adminKey: ADMIN_KEY });
    await conn2.connect();
    const result = await conn.sendRequest('tasks/send', 'bridge-b', {
      taskId: 'task-1', message: { messageId: 'msg-1', role: 'agent', parts: [{ text: 'hello' }] },
    });
    expect(result.delivered).toBe(true);
    await conn2.disconnect();
  });

  it('lists agents via relay', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    conn = new ConnectionManager({ relayUrl: `ws://127.0.0.1:${PORT}`, agentCard: makeCard('bridge-a'), adminKey: ADMIN_KEY });
    await conn.connect();
    const conn2 = new ConnectionManager({ relayUrl: `ws://127.0.0.1:${PORT}`, agentCard: makeCard('bridge-b'), adminKey: ADMIN_KEY });
    await conn2.connect();
    const result = await conn.sendRequest('agents/list', undefined, {});
    expect(result.agents.length).toBe(1);
    expect(result.agents[0].name).toBe('bridge-b');
    await conn2.disconnect();
  });

  it('receives incoming messages via onMessage callback', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    const received = [];
    conn = new ConnectionManager({
      relayUrl: `ws://127.0.0.1:${PORT}`, agentCard: makeCard('bridge-a'), adminKey: ADMIN_KEY,
      onMessage: (msg) => received.push(msg),
    });
    await conn.connect();
    const conn2 = new ConnectionManager({ relayUrl: `ws://127.0.0.1:${PORT}`, agentCard: makeCard('bridge-b'), adminKey: ADMIN_KEY });
    await conn2.connect();
    await conn2.sendRequest('tasks/send', 'bridge-a', {
      taskId: 'task-1', message: { messageId: 'msg-1', role: 'agent', parts: [{ text: 'hello bridge-a' }] },
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(received.length).toBe(1);
    expect(received[0].params.taskId).toBe('task-1');
    await conn2.disconnect();
  });
});
