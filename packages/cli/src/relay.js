import { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { createRelayServer } from '@agent-protocol/relay';

export const relayCommand = new Command('relay')
  .description('Start the relay server')
  .option('-p, --port <port>', 'Port to listen on', '8080')
  .option('--admin-key <key>', 'Admin key (auto-generated if not provided)')
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const adminKey = opts.adminKey || randomBytes(32).toString('hex');
    console.error(`[agent-protocol] Starting relay on port ${port}`);
    console.error(`[agent-protocol] Admin key: ${adminKey}`);
    console.error(`[agent-protocol] Use this key with: agent-protocol join --admin-key ${adminKey}`);
    await createRelayServer({ port, adminKey });
  });
