import { createNotification, createError, ErrorCodes } from '@agent-protocol/protocol';

export class Router {
  constructor(registry) { this.registry = registry; }

  routeDirect(targetName, params, fromName) {
    const ws = this.registry.getConnection(targetName);
    if (!ws || ws.readyState !== 1) {
      return { delivered: false, error: createError(ErrorCodes.AGENT_NOT_FOUND, `Agent "${targetName}" is not connected`) };
    }
    const notification = createNotification('tasks/receive', { ...params, from: fromName });
    ws.send(JSON.stringify(notification));
    return { delivered: true, taskId: params.taskId };
  }

  routeBroadcast(senderName, params) {
    const connections = this.registry.getAllConnectionsExcept(senderName);
    const recipients = [];
    for (const { name, ws } of connections) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(createNotification('tasks/receive', { ...params, from: senderName })));
        recipients.push(name);
      }
    }
    return { delivered: true, taskId: params.taskId, recipients };
  }

  routeUpdate(targetName, params, fromName) {
    const ws = this.registry.getConnection(targetName);
    if (!ws || ws.readyState !== 1) {
      return { updated: false, error: createError(ErrorCodes.AGENT_NOT_FOUND, `Agent "${targetName}" is not connected`) };
    }
    ws.send(JSON.stringify(createNotification('tasks/update', { ...params, from: fromName })));
    return { updated: true, taskId: params.taskId };
  }
}
