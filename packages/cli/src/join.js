import { Command } from 'commander';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConnectionManager } from '@agent-protocol/bridge';

export const joinCommand = new Command('join')
  .description('Join a relay and configure Claude Code')
  .requiredOption('--relay <url>', 'Relay server URL (wss://...)')
  .requiredOption('--name <name>', 'Agent name')
  .requiredOption('--admin-key <key>', 'Relay admin key')
  .option('--skills <json>', 'Skills JSON array', '[]')
  .action(async (opts) => {
    const homeDir = process.env.HOME;
    const configDir = join(homeDir, '.agent-protocol');
    const configPath = join(configDir, 'config.json');
    const inboxDir = join(configDir, 'inbox', opts.name);

    if (opts.relay.startsWith('ws://') && !opts.relay.includes('127.0.0.1') && !opts.relay.includes('localhost') && !opts.relay.includes('::1')) {
      console.error('[agent-protocol] WARNING: Using unencrypted ws:// to a remote host. Use wss:// for production.');
    }

    let skills;
    try { skills = JSON.parse(opts.skills); } catch { skills = []; }

    const agentCard = {
      name: opts.name, description: `Agent ${opts.name}`, version: '1.0.0', protocolVersion: '1.0',
      capabilities: { streaming: false, pushNotifications: true },
      skills: skills.length > 0 ? skills : [{ id: 'general', name: 'General', description: 'General agent', tags: ['general'] }],
      defaultInputModes: ['text/plain', 'application/json'],
      defaultOutputModes: ['text/plain', 'application/json'],
    };

    console.error(`[agent-protocol] Connecting to ${opts.relay} as ${opts.name}...`);
    const conn = new ConnectionManager({ relayUrl: opts.relay, agentCard, adminKey: opts.adminKey });
    const result = await conn.connect();
    console.error(`[agent-protocol] Registered. Agent secret received.`);
    await conn.disconnect();

    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    mkdirSync(inboxDir, { recursive: true, mode: 0o700 });

    const config = {
      agent_name: opts.name, relay_url: opts.relay, agent_secret: result.agentSecret,
      skills: agentCard.skills, auto_act: true, require_approval: [],
      inbox_path: join(configDir, 'inbox'),
      cleanup: { completed_ttl_minutes: 60, stale_ttl_hours: 24, sweep_interval_minutes: 60 },
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    console.error(`[agent-protocol] Config written to ${configPath}`);
    configureClaude(homeDir, configPath);
    console.error('[agent-protocol] Setup complete! Restart Claude Code to activate the bridge.');
  });

function configureClaude(homeDir, configPath) {
  const claudeConfigPath = join(homeDir, '.claude', 'claude_desktop_config.json');
  let claudeConfig = {};
  if (existsSync(claudeConfigPath)) {
    try { claudeConfig = JSON.parse(readFileSync(claudeConfigPath, 'utf8')); } catch { claudeConfig = {}; }
  }
  if (!claudeConfig.mcpServers) claudeConfig.mcpServers = {};
  claudeConfig.mcpServers['agent-protocol-bridge'] = {
    command: 'node',
    args: [join(homeDir, '.agent-protocol', 'bridge-start.js')],
    env: { AGENT_PROTOCOL_CONFIG: configPath },
  };
  mkdirSync(join(homeDir, '.claude'), { recursive: true });
  writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
  console.error(`[agent-protocol] Claude Code MCP server configured at ${claudeConfigPath}`);

  const startScript = `import { startBridge } from '@agent-protocol/bridge';\nstartBridge(process.env.AGENT_PROTOCOL_CONFIG);\n`;
  writeFileSync(join(homeDir, '.agent-protocol', 'bridge-start.js'), startScript, { mode: 0o600 });
}
