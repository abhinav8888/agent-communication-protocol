import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthManager } from '../src/auth.js';

describe('AuthManager', () => {
  let auth;
  beforeEach(() => { auth = new AuthManager({ timestampWindowSec: 10, maxSeenIds: 100, rateLimitPerSec: 5 }); });

  describe('checkTimestamp', () => {
    it('accepts timestamp within window', () => { expect(auth.checkTimestamp(Math.floor(Date.now() / 1000))).toBe(true); });
    it('rejects timestamp too old', () => { expect(auth.checkTimestamp(Math.floor(Date.now() / 1000) - 20)).toBe(false); });
    it('rejects timestamp too far in future', () => { expect(auth.checkTimestamp(Math.floor(Date.now() / 1000) + 20)).toBe(false); });
  });

  describe('checkReplay', () => {
    it('accepts new message id', () => { expect(auth.checkReplay('msg-1')).toBe(true); });
    it('rejects duplicate message id', () => { auth.checkReplay('msg-1'); expect(auth.checkReplay('msg-1')).toBe(false); });
    it('evicts oldest ids when window is full', () => {
      const smallAuth = new AuthManager({ timestampWindowSec: 10, maxSeenIds: 3, rateLimitPerSec: 100 });
      smallAuth.checkReplay('a'); smallAuth.checkReplay('b'); smallAuth.checkReplay('c'); smallAuth.checkReplay('d');
      expect(smallAuth.checkReplay('a')).toBe(true);
    });
  });

  describe('checkRateLimit', () => {
    it('allows messages under the limit', () => { expect(auth.checkRateLimit('agent-a')).toBe(true); });
    it('blocks messages over the limit', () => {
      for (let i = 0; i < 5; i++) auth.checkRateLimit('agent-a');
      expect(auth.checkRateLimit('agent-a')).toBe(false);
    });
    it('tracks agents independently', () => {
      for (let i = 0; i < 5; i++) auth.checkRateLimit('agent-a');
      expect(auth.checkRateLimit('agent-b')).toBe(true);
    });
    it('resets after time window', () => {
      vi.useFakeTimers();
      for (let i = 0; i < 5; i++) auth.checkRateLimit('agent-a');
      expect(auth.checkRateLimit('agent-a')).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(auth.checkRateLimit('agent-a')).toBe(true);
      vi.useRealTimers();
    });
  });
});
