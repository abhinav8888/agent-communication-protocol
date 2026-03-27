import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createToolHandlers } from '../src/tools.js';

function mockConnection() { return { sendRequest: vi.fn(), isConnected: vi.fn(() => true) }; }
function mockInbox() { return { getUnread: vi.fn(() => []), markRead: vi.fn(), updateStatus: vi.fn(), getMessage: vi.fn() }; }
function mockTaskTracker() { return { trackSent: vi.fn(), getStatus: vi.fn(), updateSentStatus: vi.fn() }; }

describe('Tool Handlers', () => {
  let conn, inbox, tracker, handlers;
  beforeEach(() => { conn = mockConnection(); inbox = mockInbox(); tracker = mockTaskTracker(); handlers = createToolHandlers(conn, inbox, tracker); });

  it('list_agents calls agents/list', async () => {
    conn.sendRequest.mockResolvedValue({ agents: [{ name: 'agent-b' }] });
    const result = await handlers.list_agents({});
    expect(conn.sendRequest).toHaveBeenCalledWith('agents/list', undefined, {});
    expect(result.agents[0].name).toBe('agent-b');
  });
  it('discover_agents calls agents/discover', async () => {
    conn.sendRequest.mockResolvedValue({ agents: [] });
    await handlers.discover_agents({ tag: 'playwright' });
    expect(conn.sendRequest).toHaveBeenCalledWith('agents/discover', undefined, { tag: 'playwright' });
  });
  it('send_message sends task and tracks it', async () => {
    conn.sendRequest.mockResolvedValue({ delivered: true, taskId: 'task-1' });
    const result = await handlers.send_message({ to: 'agent-b', text: 'run tests' });
    expect(conn.sendRequest).toHaveBeenCalledOnce();
    expect(tracker.trackSent).toHaveBeenCalledWith(expect.any(String), 'agent-b');
    expect(result.delivered).toBe(true);
  });
  it('send_message includes data parts', async () => {
    conn.sendRequest.mockResolvedValue({ delivered: true, taskId: 'task-1' });
    await handlers.send_message({ to: 'agent-b', text: 'run tests', data: { files: ['a.py'] } });
    const parts = conn.sendRequest.mock.calls[0][2].message.parts;
    expect(parts.length).toBe(2);
    expect(parts[1].data).toEqual({ files: ['a.py'] });
  });
  it('get_messages returns unread', async () => {
    inbox.getUnread.mockReturnValue([{ taskId: 'task-1', from: 'agent-a', message: { parts: [{ text: 'hello' }] } }]);
    const result = await handlers.get_messages({});
    expect(result.messages.length).toBe(1);
    expect(inbox.markRead).toHaveBeenCalledWith('task-1');
  });
  it('update_task updates inbox and sends to relay', async () => {
    conn.sendRequest.mockResolvedValue({ updated: true });
    inbox.getMessage.mockReturnValue({ taskId: 'task-1', from: 'agent-a', status: 'working' });
    await handlers.update_task({ taskId: 'task-1', status: 'completed', text: 'All tests passed' });
    expect(inbox.updateStatus).toHaveBeenCalledWith('task-1', 'completed');
    expect(conn.sendRequest).toHaveBeenCalledWith('tasks/update', 'agent-a', expect.objectContaining({ status: 'completed' }));
  });
  it('get_task_status checks tracker first', async () => {
    tracker.getStatus.mockReturnValue({ status: 'working', to: 'agent-b' });
    expect((await handlers.get_task_status({ taskId: 'task-1' })).status).toBe('working');
  });
  it('get_task_status falls back to inbox', async () => {
    tracker.getStatus.mockReturnValue(null);
    inbox.getMessage.mockReturnValue({ taskId: 'task-1', status: 'submitted', from: 'agent-a' });
    expect((await handlers.get_task_status({ taskId: 'task-1' })).status).toBe('submitted');
  });
  it('get_connection_status returns state', async () => {
    expect((await handlers.get_connection_status({})).connected).toBe(true);
  });
});
