import { describe, it, expect, beforeEach } from 'vitest';
import { Registry } from '../src/registry.js';

const makeCard = (name) => ({
  name, description: `Agent ${name}`, version: '1.0.0', protocolVersion: '1.0',
  capabilities: { streaming: false, pushNotifications: true },
  skills: [{ id: 's1', name: 'Skill', description: 'A skill', tags: ['test'] }],
  defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
});

describe('Registry', () => {
  let registry;
  beforeEach(() => { registry = new Registry(); });

  it('registers an agent', () => {
    const result = registry.register(makeCard('agent-a'), {}, 'session-secret-a');
    expect(result.registered).toBe(true);
    expect(result.agentName).toBe('agent-a');
  });
  it('returns list of other connected agents on register', () => {
    registry.register(makeCard('agent-a'), {}, 'sa');
    const result = registry.register(makeCard('agent-b'), {}, 'sb');
    expect(result.connectedAgents).toEqual(['agent-a']);
  });
  it('replaces stale connection on re-register', () => {
    const ws1 = { readyState: 3, close() {} };
    const ws2 = {};
    registry.register(makeCard('agent-a'), ws1, 'sa');
    const result = registry.register(makeCard('agent-a'), ws2, 'sa-new');
    expect(result.registered).toBe(true);
    expect(registry.getConnection('agent-a')).toBe(ws2);
    expect(registry.getSecret('agent-a')).toBe('sa-new');
  });
  it('lists all agents except caller', () => {
    registry.register(makeCard('agent-a'), {}, 'sa');
    registry.register(makeCard('agent-b'), {}, 'sb');
    const list = registry.listAgents('agent-a');
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('agent-b');
  });
  it('discovers agents by skill tag', () => {
    const card = makeCard('agent-a');
    card.skills = [{ id: 'pw', name: 'Playwright', description: 'test', tags: ['playwright', 'e2e'] }];
    registry.register(card, {}, 'sa');
    registry.register(makeCard('agent-b'), {}, 'sb');
    const found = registry.discoverByTag('playwright');
    expect(found.length).toBe(1);
    expect(found[0].name).toBe('agent-a');
  });
  it('returns empty for unknown tag', () => {
    registry.register(makeCard('agent-a'), {}, 'sa');
    expect(registry.discoverByTag('nonexistent')).toEqual([]);
  });
  it('unregisters an agent', () => {
    registry.register(makeCard('agent-a'), {}, 'sa');
    registry.unregister('agent-a');
    expect(registry.listAgents('nobody')).toEqual([]);
  });
  it('gets ws connection by name', () => {
    const ws = { id: 'ws1' };
    registry.register(makeCard('agent-a'), ws, 'sa');
    expect(registry.getConnection('agent-a')).toBe(ws);
  });
  it('gets session secret by name', () => {
    registry.register(makeCard('agent-a'), {}, 'my-session-secret');
    expect(registry.getSecret('agent-a')).toBe('my-session-secret');
  });
  it('gets agent name by ws connection', () => {
    const ws = {};
    registry.register(makeCard('agent-a'), ws, 'sa');
    expect(registry.getNameByConnection(ws)).toBe('agent-a');
  });
  it('gets all connections except sender', () => {
    const ws1 = {}, ws2 = {};
    registry.register(makeCard('agent-a'), ws1, 'sa');
    registry.register(makeCard('agent-b'), ws2, 'sb');
    const conns = registry.getAllConnectionsExcept('agent-a');
    expect(conns.length).toBe(1);
    expect(conns[0]).toEqual({ name: 'agent-b', ws: ws2 });
  });
});
