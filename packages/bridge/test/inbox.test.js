import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Inbox } from '../src/inbox.js';

const TMP = join(import.meta.dirname, '.tmp-inbox');

describe('Inbox', () => {
  let inbox;
  beforeEach(() => { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); inbox = new Inbox(TMP); });
  afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

  it('writes a message to disk', () => {
    inbox.writeMessage({ taskId: 'task-1', from: 'agent-a', message: { messageId: 'msg-1', role: 'agent', parts: [{ text: 'hello' }] } });
    const data = JSON.parse(readFileSync(join(TMP, 'task-1.json'), 'utf8'));
    expect(data.taskId).toBe('task-1');
    expect(data.status).toBe('submitted');
    expect(data.readAt).toBeNull();
  });
  it('deduplicates by taskId', () => {
    inbox.writeMessage({ taskId: 'task-1', from: 'a', message: {} });
    inbox.writeMessage({ taskId: 'task-1', from: 'a', message: {} });
    expect(readdirSync(TMP).filter(f => f.endsWith('.json')).length).toBe(1);
  });
  it('reads unread messages', () => {
    inbox.writeMessage({ taskId: 'task-1', from: 'a', message: { parts: [{ text: 'hi' }] } });
    inbox.writeMessage({ taskId: 'task-2', from: 'b', message: { parts: [{ text: 'yo' }] } });
    expect(inbox.getUnread().length).toBe(2);
  });
  it('marks messages as read', () => {
    inbox.writeMessage({ taskId: 'task-1', from: 'a', message: {} });
    inbox.markRead('task-1');
    expect(inbox.getUnread().length).toBe(0);
  });
  it('updates task status', () => {
    inbox.writeMessage({ taskId: 'task-1', from: 'a', message: {} });
    inbox.updateStatus('task-1', 'working');
    expect(JSON.parse(readFileSync(join(TMP, 'task-1.json'), 'utf8')).status).toBe('working');
  });
  it('cleanup removes old completed tasks', () => {
    inbox.writeMessage({ taskId: 'task-1', from: 'a', message: {} });
    inbox.updateStatus('task-1', 'working');
    inbox.updateStatus('task-1', 'completed');
    inbox.markRead('task-1');
    const filePath = join(TMP, 'task-1.json');
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    data.receivedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    data.readAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    writeFileSync(filePath, JSON.stringify(data));
    inbox.cleanup({ completed_ttl_minutes: 60, stale_ttl_hours: 24 });
    expect(readdirSync(TMP).filter(f => f.endsWith('.json')).length).toBe(0);
  });
});
