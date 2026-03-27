import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Router } from '../src/router.js';

function mockWs() { return { send: vi.fn(), readyState: 1 }; }

describe('Router', () => {
  let router, registry;
  beforeEach(() => {
    registry = { getConnection: vi.fn(), getNameByConnection: vi.fn(), getAllConnectionsExcept: vi.fn() };
    router = new Router(registry);
  });

  describe('routeDirect', () => {
    it('sends message to target agent with correct from field', () => {
      const targetWs = mockWs();
      registry.getConnection.mockReturnValue(targetWs);
      const result = router.routeDirect('agent-b', { taskId: '123', message: {} }, 'agent-a');
      expect(result.delivered).toBe(true);
      expect(targetWs.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(targetWs.send.mock.calls[0][0]);
      expect(sent.method).toBe('tasks/receive');
      expect(sent.params.taskId).toBe('123');
      expect(sent.params.from).toBe('agent-a');
    });
    it('returns error if target not found', () => {
      registry.getConnection.mockReturnValue(null);
      const result = router.routeDirect('unknown', { taskId: '123' }, 'agent-a');
      expect(result.delivered).toBe(false);
      expect(result.error.code).toBe(-32001);
    });
  });

  describe('routeBroadcast', () => {
    it('sends to all agents except sender', () => {
      const ws1 = mockWs(), ws2 = mockWs();
      registry.getAllConnectionsExcept.mockReturnValue([{ name: 'b', ws: ws1 }, { name: 'c', ws: ws2 }]);
      const result = router.routeBroadcast('agent-a', { taskId: '123', message: {} });
      expect(result.delivered).toBe(true);
      expect(result.recipients).toEqual(['b', 'c']);
    });
    it('returns empty recipients when alone', () => {
      registry.getAllConnectionsExcept.mockReturnValue([]);
      const result = router.routeBroadcast('agent-a', { taskId: '123' });
      expect(result.recipients).toEqual([]);
    });
  });

  describe('routeUpdate', () => {
    it('forwards task update to target agent', () => {
      const targetWs = mockWs();
      registry.getConnection.mockReturnValue(targetWs);
      const result = router.routeUpdate('agent-b', { taskId: '123', status: 'completed' }, 'agent-a');
      expect(result.updated).toBe(true);
      const sent = JSON.parse(targetWs.send.mock.calls[0][0]);
      expect(sent.method).toBe('tasks/update');
      expect(sent.params.from).toBe('agent-a');
    });
  });
});
