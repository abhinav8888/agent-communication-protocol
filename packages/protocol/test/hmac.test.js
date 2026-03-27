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
  it('returns a base64 string', () => { const sig = signMessage('my-secret', 1711468800, { taskId: 'abc' }); expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/); });
  it('produces consistent signatures', () => { expect(signMessage('secret', 100, { a: 1 })).toBe(signMessage('secret', 100, { a: 1 })); });
  it('different secrets -> different sigs', () => { expect(signMessage('s1', 100, { a: 1 })).not.toBe(signMessage('s2', 100, { a: 1 })); });
  it('different timestamps -> different sigs', () => { expect(signMessage('s', 100, { a: 1 })).not.toBe(signMessage('s', 200, { a: 1 })); });
});

describe('verifySignature', () => {
  it('returns true for valid', () => { const s = signMessage('secret', 100, { a: 1 }); expect(verifySignature('secret', 100, { a: 1 }, s)).toBe(true); });
  it('returns false for wrong secret', () => { const s = signMessage('secret', 100, { a: 1 }); expect(verifySignature('wrong', 100, { a: 1 }, s)).toBe(false); });
  it('returns false for tampered params', () => { const s = signMessage('secret', 100, { a: 1 }); expect(verifySignature('secret', 100, { a: 2 }, s)).toBe(false); });
  it('returns false for wrong timestamp', () => { const s = signMessage('secret', 100, { a: 1 }); expect(verifySignature('secret', 200, { a: 1 }, s)).toBe(false); });
});
