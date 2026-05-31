import { describe, it, expect, beforeEach } from 'vitest';
import { TaskTracker } from '../src/tasks.js';

describe('TaskTracker', () => {
  let tracker;
  beforeEach(() => { tracker = new TaskTracker(); });

  it('tracks a sent task', () => {
    tracker.trackSent('task-1', 'agent-b');
    const status = tracker.getStatus('task-1');
    expect(status.status).toBe('submitted');
    expect(status.to).toBe('agent-b');
  });
  it('updates sent task status', () => {
    tracker.trackSent('task-1', 'agent-b');
    tracker.updateSentStatus('task-1', 'working');
    expect(tracker.getStatus('task-1').status).toBe('working');
  });
  it('rejects invalid transitions', () => {
    tracker.trackSent('task-1', 'agent-b');
    tracker.updateSentStatus('task-1', 'completed');
    expect(() => tracker.updateSentStatus('task-1', 'working')).toThrow(/invalid/i);
  });
  it('returns null for unknown task', () => { expect(tracker.getStatus('nonexistent')).toBeNull(); });
  it('lists all sent tasks', () => {
    tracker.trackSent('task-1', 'agent-b');
    tracker.trackSent('task-2', 'agent-c');
    expect(tracker.listSent().length).toBe(2);
  });
});
