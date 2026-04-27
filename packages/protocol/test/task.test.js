import { describe, it, expect } from 'vitest';
import { TaskState, isValidTransition, TERMINAL_STATES } from '../src/task.js';

describe('TaskState', () => {
  it('defines all states', () => {
    expect(TaskState.SUBMITTED).toBe('submitted');
    expect(TaskState.WORKING).toBe('working');
    expect(TaskState.COMPLETED).toBe('completed');
    expect(TaskState.FAILED).toBe('failed');
  });
});

describe('TERMINAL_STATES', () => {
  it('includes completed and failed', () => {
    expect(TERMINAL_STATES).toContain('completed');
    expect(TERMINAL_STATES).toContain('failed');
    expect(TERMINAL_STATES).not.toContain('submitted');
    expect(TERMINAL_STATES).not.toContain('working');
  });
});

describe('isValidTransition', () => {
  it('allows submitted -> working', () => { expect(isValidTransition('submitted', 'working')).toBe(true); });
  it('allows submitted -> failed', () => { expect(isValidTransition('submitted', 'failed')).toBe(true); });
  it('allows working -> completed', () => { expect(isValidTransition('working', 'completed')).toBe(true); });
  it('allows working -> failed', () => { expect(isValidTransition('working', 'failed')).toBe(true); });
  it('rejects completed -> working', () => { expect(isValidTransition('completed', 'working')).toBe(false); });
  it('rejects failed -> anything', () => {
    expect(isValidTransition('failed', 'working')).toBe(false);
    expect(isValidTransition('failed', 'submitted')).toBe(false);
  });
  it('allows submitted -> completed (skip working)', () => { expect(isValidTransition('submitted', 'completed')).toBe(true); });
  it('rejects same-state transitions', () => { expect(isValidTransition('working', 'working')).toBe(false); });
});
