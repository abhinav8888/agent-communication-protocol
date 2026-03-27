import { writeFileSync, readFileSync, readdirSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isValidTransition, TERMINAL_STATES } from '@agent-protocol/protocol';

export class Inbox {
  constructor(inboxDir) {
    this.dir = inboxDir;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }
  writeMessage({ taskId, from, message }) {
    const filePath = join(this.dir, `${taskId}.json`);
    if (existsSync(filePath)) return;
    const data = { taskId, from, status: 'submitted', receivedAt: new Date().toISOString(), readAt: null, message };
    writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }
  getUnread() { return this._listMessages().filter(m => m.readAt === null); }
  markRead(taskId) {
    const filePath = join(this.dir, `${taskId}.json`);
    if (!existsSync(filePath)) return;
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    data.readAt = new Date().toISOString();
    writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }
  updateStatus(taskId, newStatus) {
    const filePath = join(this.dir, `${taskId}.json`);
    if (!existsSync(filePath)) return;
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!isValidTransition(data.status, newStatus)) throw new Error(`Invalid transition: ${data.status} -> ${newStatus}`);
    data.status = newStatus;
    writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }
  getMessage(taskId) {
    const filePath = join(this.dir, `${taskId}.json`);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  }
  cleanup({ completed_ttl_minutes, stale_ttl_hours }) {
    const now = Date.now();
    for (const msg of this._listMessages()) {
      const age = now - new Date(msg.receivedAt).getTime();
      if (TERMINAL_STATES.includes(msg.status) && msg.readAt && age > completed_ttl_minutes * 60 * 1000) {
        unlinkSync(join(this.dir, `${msg.taskId}.json`));
      } else if (age > stale_ttl_hours * 60 * 60 * 1000) {
        unlinkSync(join(this.dir, `${msg.taskId}.json`));
      }
    }
  }
  _listMessages() {
    return readdirSync(this.dir).filter(f => f.endsWith('.json')).map(f => {
      try { return JSON.parse(readFileSync(join(this.dir, f), 'utf8')); } catch { return null; }
    }).filter(Boolean);
  }
}
