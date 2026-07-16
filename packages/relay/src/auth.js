import { verifySignature } from '@agent-protocol/protocol';

export class AuthManager {
  constructor({ timestampWindowSec = 10, maxSeenIds = 10000, rateLimitPerSec = 100 } = {}) {
    this.timestampWindowSec = timestampWindowSec;
    this.maxSeenIds = maxSeenIds;
    this.rateLimitPerSec = rateLimitPerSec;
    this.seenIds = [];
    this.seenIdSet = new Set();
    this.rateCounts = new Map();
  }
  checkTimestamp(timestamp) {
    const now = Math.floor(Date.now() / 1000);
    return Math.abs(now - timestamp) <= this.timestampWindowSec;
  }
  checkReplay(messageId) {
    if (this.seenIdSet.has(messageId)) return false;
    this.seenIds.push(messageId);
    this.seenIdSet.add(messageId);
    while (this.seenIds.length > this.maxSeenIds) {
      const evicted = this.seenIds.shift();
      this.seenIdSet.delete(evicted);
    }
    return true;
  }
  checkRateLimit(agentName) {
    const now = Date.now();
    let entry = this.rateCounts.get(agentName);
    if (!entry || now - entry.windowStart >= 1000) {
      entry = { count: 0, windowStart: now };
      this.rateCounts.set(agentName, entry);
    }
    entry.count++;
    return entry.count <= this.rateLimitPerSec;
  }
  verifyEnvelope(envelope, secret) {
    return verifySignature(secret, envelope, envelope.signature);
  }
}
