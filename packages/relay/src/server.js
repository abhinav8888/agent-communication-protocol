import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { parseEnvelope, validateAgentCard, ErrorCodes, createError } from '@agent-protocol/protocol';
import { Registry } from './registry.js';
import { AuthManager } from './auth.js';
import { Router } from './router.js';

export async function createRelayServer({ port, adminKey, rateLimitPerSec = 100, timestampWindowSec = 10 } = {}) {
  const registry = new Registry();
  const auth = new AuthManager({ timestampWindowSec, rateLimitPerSec });
  const router = new Router(registry);

  const wss = new WebSocketServer({ port, verifyClient: ({ req }, cb) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return cb(false, 1008, 'Auth required');
    const token = authHeader.replace('Bearer ', '');
    const isAdmin = token === adminKey;
    const isKnown = registry.isKnownSecret(token);
    if (!isAdmin && !isKnown) return cb(false, 1008, 'Auth failed');
    cb(true);
  }});

  const pingInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const authToken = req.headers.authorization?.replace('Bearer ', '');

    ws.on('message', (data) => {
      const { valid, error, envelope } = parseEnvelope(data.toString());
      if (!valid) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: null, error: createError(ErrorCodes.INVALID_REQUEST, error) }));
        return;
      }
      const response = handleMessage(envelope, ws, authToken, registry, auth, router, adminKey);
      if (response) ws.send(JSON.stringify(response));
    });

    ws.on('close', () => {
      const name = registry.getNameByConnection(ws);
      if (name) { log('disconnect', { agent: name }); registry.unregister(name); }
    });
  });

  await new Promise((resolve) => wss.on('listening', resolve));
  log('started', { port });

  return {
    close: () => new Promise((resolve) => { clearInterval(pingInterval); wss.close(resolve); }),
    registry,
  };
}

function handleMessage(envelope, ws, authToken, registry, auth, router, adminKey) {
  const { id, method, from, to } = envelope;
  const respond = (result) => ({ jsonrpc: '2.0', id, result });
  const respondError = (err) => ({ jsonrpc: '2.0', id, error: err });

  if (method === 'agents/register') {
    // Allow registration with admin key (first time) or known agent secret (reconnection)
    const isAdmin = authToken === adminKey;
    const isKnownAgent = registry.isKnownSecret(authToken);
    if (!isAdmin && !isKnownAgent) {
      return respondError(createError(ErrorCodes.HMAC_FAILED, 'Admin key or known agent secret required for registration'));
    }
    const { agentCard } = envelope.params;
    const validation = validateAgentCard(agentCard);
    if (!validation.valid) {
      return respondError(createError(ErrorCodes.INVALID_REQUEST, validation.errors.join(', ')));
    }
    try {
      const agentSecret = registry.knownSecrets.get(agentCard.name) || randomBytes(32).toString('hex');
      const result = registry.register(agentCard, ws, agentSecret);
      log('register', { agent: agentCard.name });
      return respond({ ...result, agentSecret });
    } catch (e) {
      return respondError(createError(ErrorCodes.DUPLICATE_NAME, e.message));
    }
  }

  const registeredName = registry.getNameByConnection(ws);
  if (!registeredName) {
    return respondError(createError(ErrorCodes.INVALID_REQUEST, 'Must register first'));
  }
  if (from !== registeredName) {
    log('from_mismatch', { claimed: from, actual: registeredName });
    return respondError(createError(ErrorCodes.FROM_MISMATCH, `from "${from}" does not match registered name "${registeredName}"`));
  }

  const secret = registry.getSecret(registeredName);
  if (!auth.checkTimestamp(envelope.timestamp)) {
    return respondError(createError(ErrorCodes.TIMESTAMP_EXPIRED, 'Timestamp outside allowed window'));
  }
  if (!auth.checkReplay(envelope.id)) {
    return respondError(createError(ErrorCodes.REPLAY_DETECTED, 'Duplicate message ID'));
  }
  if (!auth.verifyEnvelope(envelope, secret)) {
    log('hmac_failed', { agent: registeredName });
    return respondError(createError(ErrorCodes.HMAC_FAILED, 'HMAC verification failed'));
  }
  if (!auth.checkRateLimit(registeredName)) {
    log('rate_limited', { agent: registeredName });
    return respondError(createError(ErrorCodes.RATE_LIMITED, 'Rate limit exceeded'));
  }

  switch (method) {
    case 'agents/list':
      return respond({ agents: registry.listAgents(registeredName) });
    case 'agents/discover':
      log('discover', { from: registeredName, tag: envelope.params.tag });
      return respond({ agents: registry.discoverByTag(envelope.params.tag) });
    case 'tasks/send': {
      if (to === registeredName) {
        return respondError(createError(ErrorCodes.AGENT_NOT_FOUND, 'Cannot send message to self'));
      }
      log('route', { from: registeredName, to, method, taskId: envelope.params.taskId });
      const result = router.routeDirect(to, envelope.params, registeredName);
      if (result.error) return respondError(result.error);
      return respond(result);
    }
    case 'tasks/broadcast': {
      log('route', { from: registeredName, to: '*', method, taskId: envelope.params.taskId });
      const result = router.routeBroadcast(registeredName, envelope.params);
      return respond(result);
    }
    case 'tasks/update': {
      log('route', { from: registeredName, to, method, taskId: envelope.params.taskId });
      const result = router.routeUpdate(to, envelope.params, registeredName);
      if (result.error) return respondError(result.error);
      return respond(result);
    }
    default:
      return respondError(createError(ErrorCodes.METHOD_NOT_FOUND, `Unknown method: ${method}`));
  }
}

function log(event, data) {
  const entry = { ts: new Date().toISOString(), event, ...data };
  process.stderr.write(JSON.stringify(entry) + '\n');
}
