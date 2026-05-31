import { Command } from 'commander';
import { copyFileSync, chmodSync, mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const SRC_BRIDGE = join(REPO_ROOT, 'dist', 'agent-protocol-bridge.mjs');
const SRC_HOOK = join(REPO_ROOT, 'hooks', 'check-notifications.sh');

export const setupCommand = new Command('setup')
  .description('Install bridge, hook, MCP entry, and PostToolUse hook for Claude Code')
  .option('--dest <dir>', 'Where to copy bridge and hook script', join(process.env.HOME, '.agent-protocol', 'bin'))
  .option('--mcp-name <name>', 'MCP server name in ~/.claude.json', 'agent-protocol')
  .option('--debug', 'Set AGENT_PROTOCOL_DEBUG=1 in the MCP server env')
  .action((opts) => {
    if (!existsSync(SRC_BRIDGE)) {
      console.error(`[agent-protocol] Bundle missing: ${SRC_BRIDGE}`);
      console.error('[agent-protocol] Run "npm run build" from the repo root first.');
      process.exit(1);
    }
    if (!existsSync(SRC_HOOK)) {
      console.error(`[agent-protocol] Hook missing: ${SRC_HOOK}`);
      process.exit(1);
    }

    mkdirSync(opts.dest, { recursive: true });

    const bridgeDest = join(opts.dest, 'agent-protocol-bridge.mjs');
    const hookDest = join(opts.dest, 'check-notifications.sh');
    copyFileSync(SRC_BRIDGE, bridgeDest);
    copyFileSync(SRC_HOOK, hookDest);
    chmodSync(hookDest, 0o755);
    console.error(`[agent-protocol] Installed bridge → ${bridgeDest}`);
    console.error(`[agent-protocol] Installed hook   → ${hookDest}`);

    updateClaudeJson({ mcpName: opts.mcpName, bridgePath: bridgeDest, debug: !!opts.debug });
    updateSettingsJson({ hookPath: hookDest });

    console.error('');
    console.error('[agent-protocol] Done. Next steps:');
    console.error('  1. Restart Claude Code (or any open sessions) to pick up the new MCP server.');
    console.error('  2. Launch with channels enabled (research preview):');
    console.error(`       claude --dangerously-load-development-channels server:${opts.mcpName}`);
    console.error('  3. In a session: connect({ relay_url, name, admin_key })');
  });

function updateClaudeJson({ mcpName, bridgePath, debug }) {
  const path = join(process.env.HOME, '.claude.json');
  const config = readJson(path);
  if (!config.mcpServers) config.mcpServers = {};
  const entry = { command: 'node', args: [bridgePath] };
  if (debug) entry.env = { AGENT_PROTOCOL_DEBUG: '1' };
  config.mcpServers[mcpName] = entry;
  writeJsonAtomic(path, config);
  console.error(`[agent-protocol] Updated MCP entry "${mcpName}" in ${path}`);
}

function updateSettingsJson({ hookPath }) {
  const path = join(process.env.HOME, '.claude', 'settings.json');
  mkdirSync(dirname(path), { recursive: true });
  const settings = readJson(path);
  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.PostToolUse)) settings.hooks.PostToolUse = [];

  // Find an existing matcher group whose hooks reference our script (any path
  // ending in check-notifications.sh) so re-runs update in place instead of
  // appending duplicates.
  const isOurHook = (h) => h?.type === 'command' && typeof h.command === 'string' && h.command.endsWith('check-notifications.sh');
  let group = settings.hooks.PostToolUse.find((g) => Array.isArray(g.hooks) && g.hooks.some(isOurHook));

  if (group) {
    group.hooks = group.hooks.filter((h) => !isOurHook(h));
    group.hooks.push({ type: 'command', command: hookPath });
  } else {
    settings.hooks.PostToolUse.push({ matcher: '', hooks: [{ type: 'command', command: hookPath }] });
  }

  writeJsonAtomic(path, settings);
  console.error(`[agent-protocol] Updated PostToolUse hook in ${path}`);
}

function readJson(path) {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

function writeJsonAtomic(path, obj) {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, path);
}
