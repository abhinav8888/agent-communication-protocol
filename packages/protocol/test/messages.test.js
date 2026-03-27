import { describe, it, expect } from 'vitest';
import { createEnvelope, parseEnvelope, createNotification } from '../src/messages.js';

describe('createEnvelope', () => {
  it('builds a complete routing envelope', () => {
    const env = createEnvelope({ method: 'tasks/send', from: 'agent-a', to: 'agent-b', params: { taskId: '123' }, secret: 'my-secret' });
    expect(env.jsonrpc).toBe('2.0');
    expect(env.method).toBe('tasks/send');
    expect(env.from).toBe('agent-a');
    expect(env.to).toBe('agent-b');
    expect(env.params).toEqual({ taskId: '123' });
    expect(typeof env.id).toBe('string');
    expect(typeof env.signature).toBe('string');
    expect(typeof env.timestamp).toBe('number');
  });

  it('omits to field when not provided', () => {
    const env = createEnvelope({ method: 'agents/list', from: 'agent-a', params: {}, secret: 'my-secret' });
    expect(env.to).toBeUndefined();
  });
});

describe('parseEnvelope', () => {
  it('parses a valid envelope', () => {
    const env = createEnvelope({ method: 'agents/list', from: 'agent-a', params: {}, secret: 'secret' });
    const parsed = parseEnvelope(JSON.stringify(env));
    expect(parsed.valid).toBe(true);
    expect(parsed.envelope.method).toBe('agents/list');
  });
  it('rejects invalid JSON', () => { expect(parseEnvelope('not json').valid).toBe(false); });
  it('rejects missing jsonrpc', () => { expect(parseEnvelope(JSON.stringify({ method: 'test', from: 'a', id: '1', signature: 'x', timestamp: 1, params: {} })).valid).toBe(false); });
  it('rejects missing method', () => { expect(parseEnvelope(JSON.stringify({ jsonrpc: '2.0', from: 'a', id: '1', signature: 'x', timestamp: 1, params: {} })).valid).toBe(false); });
  it('rejects missing from', () => { expect(parseEnvelope(JSON.stringify({ jsonrpc: '2.0', method: 'test', id: '1', signature: 'x', timestamp: 1, params: {} })).valid).toBe(false); });
});

describe('createNotification', () => {
  it('creates a JSON-RPC notification (no id)', () => {
    const notif = createNotification('tasks/receive', { taskId: '123', from: 'a' });
    expect(notif.jsonrpc).toBe('2.0');
    expect(notif.method).toBe('tasks/receive');
    expect(notif.params).toEqual({ taskId: '123', from: 'a' });
    expect(notif.id).toBeUndefined();
  });
});
