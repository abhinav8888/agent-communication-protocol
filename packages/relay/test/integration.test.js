import { describe, it, expect, afterEach } from 'vitest';
import { createRelayServer } from '../src/server.js';
import { ConnectionManager } from '@agent-protocol/bridge';

const PORT = 9878;
const ADMIN_KEY = 'integration-test-key';

const makeCard = (name, tags = ['test']) => ({
  name, description: `Agent ${name}`, version: '1.0.0', protocolVersion: '1.0',
  capabilities: { streaming: false, pushNotifications: true },
  skills: [{ id: 's1', name: 'Skill', description: 'A skill', tags }],
  defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
});

describe('End-to-End Integration', () => {
  let server;
  const connections = [];

  afterEach(async () => {
    for (const conn of connections) await conn.disconnect();
    connections.length = 0;
    if (server) await server.close();
  });

  async function createAgent(name, tags, onMessage) {
    const conn = new ConnectionManager({
      relayUrl: `ws://127.0.0.1:${PORT}`, agentCard: makeCard(name, tags),
      adminKey: ADMIN_KEY, onMessage: onMessage || (() => {}),
    });
    await conn.connect();
    connections.push(conn);
    return conn;
  }

  it('two agents exchange messages bidirectionally', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    const receivedA = [], receivedB = [];
    const agentA = await createAgent('agent-a', ['backend'], (msg) => receivedA.push(msg));
    const agentB = await createAgent('agent-b', ['frontend'], (msg) => receivedB.push(msg));

    await agentA.sendRequest('tasks/send', 'agent-b', {
      taskId: 'task-1', message: { messageId: 'msg-1', role: 'agent', parts: [{ text: 'Fix the API' }] },
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(receivedB.length).toBe(1);
    expect(receivedB[0].params.from).toBe('agent-a');
    expect(receivedB[0].params.message.parts[0].text).toBe('Fix the API');

    await agentB.sendRequest('tasks/update', 'agent-a', {
      taskId: 'task-1', status: 'completed',
      message: { messageId: 'msg-2', role: 'agent', parts: [{ text: 'Done!' }] },
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(receivedA.length).toBe(1);
    expect(receivedA[0].params.status).toBe('completed');
  });

  it('broadcast reaches all agents except sender', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    const receivedB = [], receivedC = [];
    const agentA = await createAgent('agent-a', ['test']);
    await createAgent('agent-b', ['test'], (msg) => receivedB.push(msg));
    await createAgent('agent-c', ['test'], (msg) => receivedC.push(msg));

    await agentA.sendRequest('tasks/broadcast', '*', {
      taskId: 'bcast-1', message: { messageId: 'msg-b1', role: 'agent', parts: [{ text: 'hello all' }] },
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(receivedB.length).toBe(1);
    expect(receivedC.length).toBe(1);
  });

  it('discover agents by skill tag', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    await createAgent('agent-a', ['playwright', 'e2e']);
    const agentB = await createAgent('agent-b', ['backend']);
    const result = await agentB.sendRequest('agents/discover', undefined, { tag: 'playwright' });
    expect(result.agents.length).toBe(1);
    expect(result.agents[0].name).toBe('agent-a');
  });

  it('rejects messages to offline agents', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    const agentA = await createAgent('agent-a', ['test']);
    try {
      await agentA.sendRequest('tasks/send', 'offline-agent', {
        taskId: 'task-fail', message: { messageId: 'msg-f', role: 'agent', parts: [{ text: 'hello?' }] },
      });
      expect.fail('Should have thrown');
    } catch (err) { expect(err.code).toBe(-32001); }
  });

  it('handles agent disconnect gracefully', async () => {
    server = await createRelayServer({ port: PORT, adminKey: ADMIN_KEY });
    const agentA = await createAgent('agent-a', ['test']);
    await createAgent('agent-b', ['test']);
    let result = await agentA.sendRequest('agents/list', undefined, {});
    expect(result.agents.length).toBe(1);
    await connections.pop().disconnect();
    await new Promise((r) => setTimeout(r, 200));
    result = await agentA.sendRequest('agents/list', undefined, {});
    expect(result.agents.length).toBe(0);
  });
});
