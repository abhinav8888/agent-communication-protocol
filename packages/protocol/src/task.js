export const TaskState = {
  SUBMITTED: 'submitted',
  WORKING: 'working',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export const TERMINAL_STATES = [TaskState.COMPLETED, TaskState.FAILED];

const VALID_TRANSITIONS = {
  [TaskState.SUBMITTED]: [TaskState.WORKING, TaskState.COMPLETED, TaskState.FAILED],
  [TaskState.WORKING]: [TaskState.COMPLETED, TaskState.FAILED],
  [TaskState.COMPLETED]: [],
  [TaskState.FAILED]: [],
};

export function isValidTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}
