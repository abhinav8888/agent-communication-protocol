import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createRelayServer } from '../src/server.js';
import { createEnvelope } from '@agent-protocol/protocol';

const PORT = 9876;
const ADMIN_KEY = 'test-admin-key';

function connect(agentSecret) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, {
      headers: { Authorization: `Bearer ${agentSecret}` },
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function sendAndWait(ws, envelope) {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    ws.send(JSON.stringify(envelope));
  });
}

function waitForMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

const makeCard = (name) => ({
  name, description: `Agent ${name}`, version: '1.0.0', protocolVersion: '1.0',
  capabilities: { streaming: false, pushNotifications: true },
  skills: [{ id: 's1', name: 'Skill', description: 'A skill', tags: ['test'] }],
  defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
});

describe('Relay Server', () => {
  let server;
  afterEach(async () => { if (server) await server.close(); });

  it('starts and accepts connections', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    const ws = await connect(ADMIN_KEY);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('rejects invalid auth', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    await expect(connect('wrong-key')).rejects.toThrow();
  });

  it('registers an agent and returns connected agents', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    const ws = await connect(ADMIN_KEY);
    const envelope = createEnvelope({
      method: 'agents/register', from: 'agent-a',
      params: { agentCard: makeCard('agent-a') }, secret: ADMIN_KEY,
    });
    const response = await sendAndWait(ws, envelope);
    expect(response.result.registered).toBe(true);
    expect(response.result.agentName).toBe('agent-a');
    expect(response.result.agentSecret).toBeDefined();
    ws.close();
  });

  it('routes a direct message between two agents', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    const wsA = await connect(ADMIN_KEY);
    const regA = createEnvelope({ method: 'agents/register', from: 'agent-a', params: { agentCard: makeCard('agent-a') }, secret: ADMIN_KEY });
    const resA = await sendAndWait(wsA, regA);
    const secretA = resA.result.agentSecret;

    const wsB = await connect(ADMIN_KEY);
    const regB = createEnvelope({ method: 'agents/register', from: 'agent-b', params: { agentCard: makeCard('agent-b') }, secret: ADMIN_KEY });
    await sendAndWait(wsB, regB);

    const receivePromise = waitForMessage(wsB);
    const sendEnv = createEnvelope({
      method: 'tasks/send', from: 'agent-a', to: 'agent-b',
      params: { taskId: 'task-1', message: { messageId: 'msg-1', role: 'agent', parts: [{ text: 'hello' }] } },
      secret: secretA,
    });
    const sendRes = await sendAndWait(wsA, sendEnv);
    expect(sendRes.result.delivered).toBe(true);

    const received = await receivePromise;
    expect(received.method).toBe('tasks/receive');
    expect(received.params.taskId).toBe('task-1');
    expect(received.params.from).toBe('agent-a');
    wsA.close(); wsB.close();
  });

  it('returns AGENT_NOT_FOUND for offline target', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    const ws = await connect(ADMIN_KEY);
    const reg = createEnvelope({ method: 'agents/register', from: 'agent-a', params: { agentCard: makeCard('agent-a') }, secret: ADMIN_KEY });
    const res = await sendAndWait(ws, reg);
    const secret = res.result.agentSecret;

    const sendEnv = createEnvelope({
      method: 'tasks/send', from: 'agent-a', to: 'ghost',
      params: { taskId: 't1', message: { messageId: 'm1', role: 'agent', parts: [{ text: 'hi' }] } },
      secret,
    });
    const sendRes = await sendAndWait(ws, sendEnv);
    expect(sendRes.error.code).toBe(-32001);
    ws.close();
  });

  it('lists connected agents', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    const wsA = await connect(ADMIN_KEY);
    const regA = createEnvelope({ method: 'agents/register', from: 'agent-a', params: { agentCard: makeCard('agent-a') }, secret: ADMIN_KEY });
    const resA = await sendAndWait(wsA, regA);
    const secretA = resA.result.agentSecret;

    const wsB = await connect(ADMIN_KEY);
    const regB = createEnvelope({ method: 'agents/register', from: 'agent-b', params: { agentCard: makeCard('agent-b') }, secret: ADMIN_KEY });
    await sendAndWait(wsB, regB);

    const listEnv = createEnvelope({ method: 'agents/list', from: 'agent-a', params: {}, secret: secretA });
    const listRes = await sendAndWait(wsA, listEnv);
    expect(listRes.result.agents.length).toBe(1);
    expect(listRes.result.agents[0].name).toBe('agent-b');
    wsA.close(); wsB.close();
  });

  it('unregisters agent on disconnect', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    const wsA = await connect(ADMIN_KEY);
    const regA = createEnvelope({ method: 'agents/register', from: 'agent-a', params: { agentCard: makeCard('agent-a') }, secret: ADMIN_KEY });
    const resA = await sendAndWait(wsA, regA);
    const secretA = resA.result.agentSecret;

    const wsB = await connect(ADMIN_KEY);
    const regB = createEnvelope({ method: 'agents/register', from: 'agent-b', params: { agentCard: makeCard('agent-b') }, secret: ADMIN_KEY });
    await sendAndWait(wsB, regB);

    wsB.close();
    await new Promise((r) => setTimeout(r, 100));

    const listEnv = createEnvelope({ method: 'agents/list', from: 'agent-a', params: {}, secret: secretA });
    const listRes = await sendAndWait(wsA, listEnv);
    expect(listRes.result.agents.length).toBe(0);
    wsA.close();
  });
});
