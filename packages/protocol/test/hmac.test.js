import { describe, it, expect } from 'vitest';
import { signMessage, verifySignature, canonicalizeParams } from '../src/hmac.js';

describe('canonicalizeParams', () => {
  it('sorts keys alphabetically with no whitespace', () => {
    expect(canonicalizeParams({ zebra: 1, alpha: 'hello', middle: [1, 2] })).toBe('{"alpha":"hello","middle":[1,2],"zebra":1}');
  });
  it('sorts nested keys', () => { expect(canonicalizeParams({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}'); });
  it('handles empty object', () => { expect(canonicalizeParams({})).toBe('{}'); });
});

describe('signMessage', () => {
  const baseEnvelope = { id: 'msg-1', method: 'tasks/send', from: 'agent-a', to: 'agent-b', timestamp: 100, params: { a: 1 } };

  it('returns a base64 string', () => {
    const sig = signMessage('my-secret', { ...baseEnvelope, timestamp: 1711468800, params: { taskId: 'abc' } });
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
  it('produces consistent signatures', () => {
    expect(signMessage('secret', baseEnvelope)).toBe(signMessage('secret', baseEnvelope));
  });
  it('different secrets -> different sigs', () => {
    expect(signMessage('s1', baseEnvelope)).not.toBe(signMessage('s2', baseEnvelope));
  });
  it('different timestamps -> different sigs', () => {
    expect(signMessage('s', baseEnvelope)).not.toBe(signMessage('s', { ...baseEnvelope, timestamp: 200 }));
  });
  it('different method -> different sigs', () => {
    expect(signMessage('s', baseEnvelope)).not.toBe(signMessage('s', { ...baseEnvelope, method: 'tasks/broadcast' }));
  });
  it('different from -> different sigs', () => {
    expect(signMessage('s', baseEnvelope)).not.toBe(signMessage('s', { ...baseEnvelope, from: 'agent-b' }));
  });
  it('different to -> different sigs', () => {
    expect(signMessage('s', baseEnvelope)).not.toBe(signMessage('s', { ...baseEnvelope, to: 'agent-c' }));
  });
  it('different id -> different sigs', () => {
    expect(signMessage('s', baseEnvelope)).not.toBe(signMessage('s', { ...baseEnvelope, id: 'msg-2' }));
  });
  it('omitted to is treated same as empty string', () => {
    const withoutTo = { id: 'msg-1', method: 'tasks/send', from: 'agent-a', timestamp: 100, params: { a: 1 } };
    const withEmptyTo = { id: 'msg-1', method: 'tasks/send', from: 'agent-a', to: '', timestamp: 100, params: { a: 1 } };
    expect(signMessage('s', withoutTo)).toBe(signMessage('s', withEmptyTo));
  });
});

describe('verifySignature', () => {
  const baseEnvelope = { id: 'msg-1', method: 'tasks/send', from: 'agent-a', to: 'agent-b', timestamp: 100, params: { a: 1 } };

  it('returns true for valid', () => {
    const s = signMessage('secret', baseEnvelope);
    expect(verifySignature('secret', baseEnvelope, s)).toBe(true);
  });
  it('returns false for wrong secret', () => {
    const s = signMessage('secret', baseEnvelope);
    expect(verifySignature('wrong', baseEnvelope, s)).toBe(false);
  });
  it('returns false for tampered params', () => {
    const s = signMessage('secret', baseEnvelope);
    expect(verifySignature('secret', { ...baseEnvelope, params: { a: 2 } }, s)).toBe(false);
  });
  it('returns false for wrong timestamp', () => {
    const s = signMessage('secret', baseEnvelope);
    expect(verifySignature('secret', { ...baseEnvelope, timestamp: 200 }, s)).toBe(false);
  });
  it('returns false for tampered method', () => {
    const s = signMessage('secret', baseEnvelope);
    expect(verifySignature('secret', { ...baseEnvelope, method: 'tasks/broadcast' }, s)).toBe(false);
  });
  it('returns false for tampered to', () => {
    const s = signMessage('secret', baseEnvelope);
    expect(verifySignature('secret', { ...baseEnvelope, to: 'agent-c' }, s)).toBe(false);
  });
  it('returns false for tampered id', () => {
    const s = signMessage('secret', baseEnvelope);
    expect(verifySignature('secret', { ...baseEnvelope, id: 'msg-2' }, s)).toBe(false);
  });
});
