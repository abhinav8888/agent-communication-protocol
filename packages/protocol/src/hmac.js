import { createHmac, timingSafeEqual } from 'node:crypto';

export function canonicalizeParams(obj) {
  return JSON.stringify(sortKeys(obj));
}

function sortKeys(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const sorted = {};
  for (const key of Object.keys(value).sort()) { sorted[key] = sortKeys(value[key]); }
  return sorted;
}

export function signMessage(secret, timestamp, params) {
  const canonical = canonicalizeParams(params);
  const signingInput = `${String(timestamp)}.${canonical}`;
  return createHmac('sha256', secret).update(signingInput, 'utf8').digest('base64');
}

export function verifySignature(secret, timestamp, params, signature) {
  const expected = signMessage(secret, timestamp, params);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
