import { randomUUID } from 'node:crypto';

export function createToolHandlers(connection, inbox, taskTracker) {
  return {
    async list_agents() { return connection.sendRequest('agents/list', undefined, {}); },
    async discover_agents({ tag }) { return connection.sendRequest('agents/discover', undefined, { tag }); },
    async send_message({ to, text, data }) {
      const taskId = randomUUID();
      const parts = [{ text }];
      if (data) parts.push({ mediaType: 'application/json', data });
      const params = { taskId, message: { messageId: randomUUID(), role: 'agent', parts, metadata: {} } };
      const result = await connection.sendRequest('tasks/send', to, params);
      taskTracker.trackSent(taskId, to);
      return { ...result, taskId };
    },
    async broadcast({ text, data }) {
      const taskId = randomUUID();
      const parts = [{ text }];
      if (data) parts.push({ mediaType: 'application/json', data });
      return connection.sendRequest('tasks/broadcast', '*', { taskId, message: { messageId: randomUUID(), role: 'agent', parts, metadata: {} } });
    },
    // get_messages is handled directly in index.js as a unified tool
    async get_task_status({ taskId }) {
      const sentTask = taskTracker.getStatus(taskId);
      if (sentTask) return sentTask;
      const receivedTask = inbox.getMessage(taskId);
      if (receivedTask) return { status: receivedTask.status, from: receivedTask.from };
      return { status: 'unknown', error: 'Task not found' };
    },
    async update_task({ taskId, status, text }) {
      const msg = inbox.getMessage(taskId);
      if (!msg) throw new Error(`Task ${taskId} not found in inbox`);
      inbox.updateStatus(taskId, status);
      const params = { taskId, status };
      if (text) params.message = { messageId: randomUUID(), role: 'agent', parts: [{ text }] };
      return connection.sendRequest('tasks/update', msg.from, params);
    },
    async get_connection_status() { return { connected: connection.isConnected() }; },
  };
}
