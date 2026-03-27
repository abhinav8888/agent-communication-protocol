import { randomUUID } from 'node:crypto';
import { signMessage } from './hmac.js';

export function createEnvelope({ method, from, to, params, secret }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const id = randomUUID();
  const signature = signMessage(secret, timestamp, params);
  const envelope = { jsonrpc: '2.0', id, method, from, timestamp, signature, params };
  if (to !== undefined) envelope.to = to;
  return envelope;
}

const REQUIRED_ENVELOPE_FIELDS = ['jsonrpc', 'id', 'method', 'from', 'signature', 'timestamp', 'params'];

export function parseEnvelope(jsonString) {
  let obj;
  try { obj = JSON.parse(jsonString); } catch { return { valid: false, error: 'Failed to parse JSON' }; }
  if (obj.jsonrpc !== '2.0') return { valid: false, error: 'jsonrpc must be "2.0"' };
  for (const field of REQUIRED_ENVELOPE_FIELDS) {
    if (obj[field] === undefined || obj[field] === null) return { valid: false, error: `Missing required field: ${field}` };
  }
  return { valid: true, envelope: obj };
}

export function createNotification(method, params) {
  return { jsonrpc: '2.0', method, params };
}
