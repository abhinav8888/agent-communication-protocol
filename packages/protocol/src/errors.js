export const ErrorCodes = {
  AGENT_NOT_FOUND: -32001,
  HMAC_FAILED: -32002,
  DUPLICATE_NAME: -32003,
  TIMESTAMP_EXPIRED: -32004,
  REPLAY_DETECTED: -32005,
  RATE_LIMITED: -32006,
  FROM_MISMATCH: -32007,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
};

export function createError(code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return err;
}
