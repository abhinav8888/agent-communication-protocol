import { describe, it, expect } from 'vitest';
import { ErrorCodes, createError } from '../src/errors.js';

describe('ErrorCodes', () => {
  it('defines all protocol error codes', () => {
    expect(ErrorCodes.AGENT_NOT_FOUND).toBe(-32001);
    expect(ErrorCodes.HMAC_FAILED).toBe(-32002);
    expect(ErrorCodes.DUPLICATE_NAME).toBe(-32003);
    expect(ErrorCodes.TIMESTAMP_EXPIRED).toBe(-32004);
    expect(ErrorCodes.REPLAY_DETECTED).toBe(-32005);
    expect(ErrorCodes.RATE_LIMITED).toBe(-32006);
    expect(ErrorCodes.FROM_MISMATCH).toBe(-32007);
    expect(ErrorCodes.INVALID_REQUEST).toBe(-32600);
    expect(ErrorCodes.METHOD_NOT_FOUND).toBe(-32601);
  });
});

describe('createError', () => {
  it('creates a JSON-RPC error object', () => {
    const err = createError(ErrorCodes.AGENT_NOT_FOUND, 'agent "foo" not connected');
    expect(err).toEqual({ code: -32001, message: 'agent "foo" not connected' });
  });

  it('includes optional data field', () => {
    const err = createError(ErrorCodes.HMAC_FAILED, 'bad sig', { from: 'x' });
    expect(err).toEqual({ code: -32002, message: 'bad sig', data: { from: 'x' } });
  });
});
