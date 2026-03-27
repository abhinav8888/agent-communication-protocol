import { readFileSync } from 'node:fs';

const REQUIRED_FIELDS = ['agent_name', 'relay_url', 'agent_secret', 'skills'];
const DEFAULTS = {
  auto_act: true, require_approval: [], inbox_path: '~/.agent-protocol/inbox',
  cleanup: { completed_ttl_minutes: 60, stale_ttl_hours: 24, sweep_interval_minutes: 60 },
};

export function loadConfig(configPath) {
  let raw;
  try { raw = readFileSync(configPath, 'utf8'); } catch { throw new Error(`Cannot read config file: ${configPath}`); }
  const config = JSON.parse(raw);
  for (const field of REQUIRED_FIELDS) {
    if (config[field] === undefined || config[field] === null) throw new Error(`Missing required config field: ${field}`);
  }
  return { ...DEFAULTS, ...config, cleanup: { ...DEFAULTS.cleanup, ...config.cleanup } };
}
