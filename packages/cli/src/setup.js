import { Command } from 'commander';
import { copyFileSync, chmodSync, mkdirSync, existsSync, readFileSync, readSync, writeFileSync, renameSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const SRC_BRIDGE = join(REPO_ROOT, 'dist', 'agent-protocol-bridge.mjs');
const SRC_HOOK = join(REPO_ROOT, 'hooks', 'check-notifications.sh');

// --- IDE definitions ---
// delivery mode is set as AGENT_PROTOCOL_DELIVERY env in the MCP server config.
// The bridge reads it to tailor post-connect instructions for the agent.

const IDES = {
  'claude-code': {
    label: 'Claude Code',
    delivery: 'channel',
    configPath: () => join(process.env.HOME, '.claude.json'),
    hint: 'Restart Claude Code. For channel push, launch with:\n  claude --dangerously-load-development-channels server:agent-protocol',
  },
  cursor: {
    label: 'Cursor',
    delivery: 'poll',
    configPath: () => join(process.env.HOME, '.cursor', 'mcp.json'),
    hint: 'Restart Cursor to pick up the new MCP server.',
  },
  codex: {
    label: 'Codex CLI',
    delivery: 'poll',
    configPath: () => join(process.env.HOME, '.codex', 'config.toml'),
    hint: 'Restart Codex to pick up the new MCP server.',
  },
  omp: {
    label: 'Oh My Pi',
    delivery: 'irc',
    configPath: () => join(process.env.HOME, '.omp', 'agent', 'mcp.json'),
    hint: 'Restart OMP to pick up the new MCP server.',
  },
  pi: {
    label: 'Pi',
    delivery: 'channel-pi',
    configPath: () => '.pi-channels.json',
    hint: 'Launch pi from your project directory with:\n  pi --channels agent-protocol',
  },
};

const IDE_ALIASES = {};

export const setupCommand = new Command('setup')
  .description('Install the agent-protocol bridge for one or more IDEs')
  .argument('[ides...]', 'IDEs to set up (claude-code, cursor, codex, omp, pi)', ['claude-code'])
  .option('--dest <dir>', 'Where to copy the bridge bundle', join(process.env.HOME, '.agent-protocol', 'bin'))
  .option('--mcp-name <name>', 'MCP server name in IDE config', 'agent-protocol')
  .option('--debug', 'Set AGENT_PROTOCOL_DEBUG=1 in the MCP server env')
  .option('--with-hook', 'Install PostToolUse hook for Claude Code (optional safety net for file-based notifications)', false)
  .action((ides, opts) => {
    // Resolve aliases (pi → omp)
    const resolved = ides.map((name) => IDE_ALIASES[name] || name);
    const invalid = resolved.filter((name) => !IDES[name]);
    if (invalid.length > 0) {
      console.error(`[agent-protocol] Unknown IDE(s): ${invalid.join(', ')}`);
      console.error(`[agent-protocol] Available: ${Object.keys(IDES).join(', ')} (aliases: ${Object.entries(IDE_ALIASES).map(([k, v]) => `${k}→${v}`).join(', ')})`);
      process.exit(1);
    }

    const uniqueIdes = [...new Set(resolved)];

    if (!existsSync(SRC_BRIDGE)) {
      console.error(`[agent-protocol] Bundle missing: ${SRC_BRIDGE}`);
      console.error('[agent-protocol] Run "npm run build" from the repo root first.');
      process.exit(1);
    }

    // Copy bridge bundle (shared by all IDEs)
    mkdirSync(opts.dest, { recursive: true });
    const bridgeDest = join(opts.dest, 'agent-protocol-bridge.mjs');
    copyFileSync(SRC_BRIDGE, bridgeDest);
    console.error(`[agent-protocol] Installed bridge → ${bridgeDest}`);

    // Copy hook only when explicitly requested for Claude Code
    let hookDest = null;
    if (opts.withHook && uniqueIdes.includes('claude-code')) {
      if (!existsSync(SRC_HOOK)) {
        console.error(`[agent-protocol] Hook missing: ${SRC_HOOK}`);
        process.exit(1);
      }
      hookDest = join(opts.dest, 'check-notifications.sh');
      copyFileSync(SRC_HOOK, hookDest);
      chmodSync(hookDest, 0o755);
      console.error(`[agent-protocol] Installed hook   → ${hookDest}`);
    }
    // For pi: check if pi-channels plugin is installed, prompt if not
    if (uniqueIdes.includes('pi')) {
      ensurePiChannelsInstalled();
    }

    for (const ide of uniqueIdes) {
      const def = IDES[ide];
      const env = { AGENT_PROTOCOL_DELIVERY: def.delivery };
      if (def.delivery === 'channel-pi') env.AGENT_PROTOCOL_MCP_NAME = opts.mcpName;
      if (opts.debug) env.AGENT_PROTOCOL_DEBUG = '1';

      const writers = {
        'claude-code': () => installClaudeCode({ mcpName: opts.mcpName, bridgePath: bridgeDest, hookPath: hookDest, env }),
        cursor: () => installJsonMcp({ def, mcpName: opts.mcpName, bridgePath: bridgeDest, env }),
        codex: () => installCodex({ mcpName: opts.mcpName, bridgePath: bridgeDest, env }),
        omp: () => installJsonMcp({ def, mcpName: opts.mcpName, bridgePath: bridgeDest, env }),
        pi: () => installPiChannels({ mcpName: opts.mcpName, bridgePath: bridgeDest, env }),
      };
      writers[ide]();
    }


    console.error('');
    console.error('[agent-protocol] Done. Next steps:');
    for (const ide of uniqueIdes) {
      console.error(`  ${IDES[ide].label}: ${IDES[ide].hint}`);
    }
    console.error('  In a session: connect({ relay_url, name, admin_key })');
  });

// --- Claude Code: JSON mcpServers + optional PostToolUse hook ---

function installClaudeCode({ mcpName, bridgePath, hookPath, env }) {
  const path = IDES['claude-code'].configPath();
  const config = readJson(path);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers[mcpName] = { command: 'node', args: [bridgePath], env };
  writeJsonAtomic(path, config);
  console.error(`[agent-protocol] Updated MCP entry "${mcpName}" in ${path}`);

  if (hookPath) {
    const settingsPath = join(process.env.HOME, '.claude', 'settings.json');
    mkdirSync(dirname(settingsPath), { recursive: true });
    const settings = readJson(settingsPath);
    if (!settings.hooks) settings.hooks = {};
    if (!Array.isArray(settings.hooks.PostToolUse)) settings.hooks.PostToolUse = [];

    const isOurHook = (h) => h?.type === 'command' && typeof h.command === 'string' && h.command.endsWith('check-notifications.sh');
    let group = settings.hooks.PostToolUse.find((g) => Array.isArray(g.hooks) && g.hooks.some(isOurHook));

    if (group) {
      group.hooks = group.hooks.filter((h) => !isOurHook(h));
      group.hooks.push({ type: 'command', command: hookPath });
    } else {
      settings.hooks.PostToolUse.push({ matcher: '', hooks: [{ type: 'command', command: hookPath }] });
    }

    writeJsonAtomic(settingsPath, settings);
    console.error(`[agent-protocol] Updated PostToolUse hook in ${settingsPath}`);
  }
}

// --- Generic JSON mcpServers (Cursor, OMP) ---

function installJsonMcp({ def, mcpName, bridgePath, env }) {
  const path = def.configPath();
  mkdirSync(dirname(path), { recursive: true });
  const config = readJson(path);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers[mcpName] = { command: 'node', args: [bridgePath], env };
  writeJsonAtomic(path, config);
  console.error(`[agent-protocol] Updated MCP entry "${mcpName}" in ${path} (${def.label})`);
}

// --- Pi: project-local .pi-channels.json ---
// pi-channels reads .pi-channels.json from the project root (ctx.cwd).
// The bridge acts as a channel server: pi-channels spawns it as a subprocess,
// receives notifications/claude/channel pushes, and injects them as <channel> tags.
// Tools are proxied as channel_<name>_<tool> (e.g. channel_agent-protocol_connect).

function installPiChannels({ mcpName, bridgePath, env }) {
  const configPath = IDES.pi.configPath();
  const config = readJson(configPath);
  config[mcpName] = { command: 'node', args: [bridgePath], env };
  writeJsonAtomic(configPath, config);
  console.error(`[agent-protocol] Updated channel "${mcpName}" in ${configPath} (pi-channels)`);
}

// Check if pi-channels plugin is installed for pi, prompt to install if not.
function ensurePiChannelsInstalled() {
  // pi stores installed packages in ~/.pi/agent/settings.json under "packages"
  const settingsPath = join(process.env.HOME, '.pi', 'agent', 'settings.json');
  let installed = false;
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const packages = settings.packages || [];
      installed = packages.some((p) => typeof p === 'string' && p.includes('pi-channels'));
    } catch { /* ignore */ }
  }

  if (installed) {
    console.error('[agent-protocol] pi-channels plugin already installed');
    return;
  }

  process.stderr.write('\n[agent-protocol] The pi-channels plugin is required for pi channel push.\n');
  process.stderr.write('[agent-protocol] Install it now? [Y/n] ');

  const answer = readLineSync();
  if (answer.trim().toLowerCase() === 'n') {
    console.error('[agent-protocol] Skipped. Install it later with: pi install npm:pi-channels');
    return;
  }

  console.error('[agent-protocol] Installing pi-channels...');
  try {
    execSync('pi install npm:pi-channels', { stdio: 'inherit' });
    console.error('[agent-protocol] pi-channels installed successfully.');
  } catch {
    console.error('[agent-protocol] Failed to install pi-channels. Install it manually: pi install npm:pi-channels');
  }
}

function readLineSync() {
  const buf = Buffer.alloc(1);
  let line = '';
  while (true) {
    const n = readSync(0, buf, 0, 1);
    if (n === 0 || buf[0] === 0x0a) break;
    if (buf[0] !== 0x0d) line += buf.toString('utf8');
  }
  return line;
}


// --- Codex: TOML [mcp_servers.X] ---
// Strict section replacement: anchor on exact header, remove until the next
// top-level [section] or EOF. Env vars go in a subtable [mcp_servers.X.env].

function installCodex({ mcpName, bridgePath, env }) {
  const path = IDES.codex.configPath();
  mkdirSync(dirname(path), { recursive: true });
  let toml = existsSync(path) ? readFileSync(path, 'utf8') : '';

  const serverKey = mcpName.replace(/[^a-zA-Z0-9_-]/g, '-');
  const header = `[mcp_servers.${serverKey}]`;
  const envHeader = `[mcp_servers.${serverKey}.env]`;

  // Remove existing section + any subtable (e.g. .env)
  const lines = toml.split('\n');
  const kept = [];
  let inOurSection = false;
  for (const line of lines) {
    if (line.startsWith('[')) {
      // Check if this line is our section or a subtable of it
      if (line === header || line === envHeader || line.startsWith(`[mcp_servers.${serverKey}.`)) {
        inOurSection = true;
        continue;
      }
      inOurSection = false;
    }
    if (!inOurSection) kept.push(line);
  }

  // Trim trailing blanks
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();

  // Build new section
  const escPath = tomlString(bridgePath);
  let section = `\n${header}\ncommand = "node"\nargs = ["${escPath}"]`;
  const envEntries = Object.entries(env);
  if (envEntries.length > 0) {
    section += `\n${envHeader}`;
    for (const [key, value] of envEntries) {
      section += `\n${key} = "${tomlString(value)}"`;
    }
  }

  kept.push(section);
  writeAtomic(path, kept.join('\n') + '\n');
  console.error(`[agent-protocol] Updated MCP entry "${serverKey}" in ${path} (Codex CLI)`);
}

// --- Shared helpers ---

function readJson(path) {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

function writeJsonAtomic(path, obj) {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, path);
}

function writeAtomic(path, content) {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function tomlString(str) {
  // Escape backslashes and double quotes for TOML basic strings
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

