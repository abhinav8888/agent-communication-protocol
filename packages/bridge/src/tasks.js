import { isValidTransition } from '@agent-protocol/protocol';

export class TaskTracker {
  constructor() { this.sentTasks = new Map(); }
  trackSent(taskId, to) {
    this.sentTasks.set(taskId, { status: 'submitted', to, sentAt: new Date().toISOString(), lastUpdate: new Date().toISOString() });
  }
  updateSentStatus(taskId, newStatus) {
    const task = this.sentTasks.get(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    if (!isValidTransition(task.status, newStatus)) throw new Error(`Invalid transition: ${task.status} -> ${newStatus}`);
    task.status = newStatus;
    task.lastUpdate = new Date().toISOString();
  }
  getStatus(taskId) { return this.sentTasks.get(taskId) ?? null; }
  listSent() { return [...this.sentTasks.entries()].map(([taskId, data]) => ({ taskId, ...data })); }
}
