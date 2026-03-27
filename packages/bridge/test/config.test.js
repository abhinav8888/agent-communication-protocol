import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

const TMP = join(import.meta.dirname, '.tmp-config');
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('loadConfig', () => {
  it('loads a valid config file', () => {
    mkdirSync(TMP, { recursive: true });
    writeFileSync(join(TMP, 'config.json'), JSON.stringify({
      agent_name: 'test-agent', relay_url: 'wss://localhost:8080', agent_secret: 'secret123',
      skills: [{ id: 's1', name: 'S', description: 'D', tags: ['t'] }],
    }));
    const config = loadConfig(join(TMP, 'config.json'));
    expect(config.agent_name).toBe('test-agent');
    expect(config.relay_url).toBe('wss://localhost:8080');
  });
  it('throws for missing file', () => { expect(() => loadConfig('/nonexistent/config.json')).toThrow(); });
  it('throws for missing required fields', () => {
    mkdirSync(TMP, { recursive: true });
    writeFileSync(join(TMP, 'config.json'), JSON.stringify({ agent_name: 'test' }));
    expect(() => loadConfig(join(TMP, 'config.json'))).toThrow(/relay_url/);
  });
  it('applies defaults for optional fields', () => {
    mkdirSync(TMP, { recursive: true });
    writeFileSync(join(TMP, 'config.json'), JSON.stringify({
      agent_name: 'test', relay_url: 'wss://localhost:8080', agent_secret: 'secret',
      skills: [{ id: 's1', name: 'S', description: 'D', tags: ['t'] }],
    }));
    const config = loadConfig(join(TMP, 'config.json'));
    expect(config.auto_act).toBe(true);
    expect(config.cleanup.completed_ttl_minutes).toBe(60);
  });
});
