import { describe, it, expect } from 'vitest';
import { validateAgentCard } from '../src/agent-card.js';

const validCard = {
  name: 'backend-gpu',
  description: 'Backend dev on B200 GPU server',
  version: '1.0.0',
  protocolVersion: '1.0',
  capabilities: { streaming: false, pushNotifications: true },
  skills: [{ id: 'code-edit', name: 'Code Editing', description: 'Edit code', tags: ['code'] }],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
};

describe('validateAgentCard', () => {
  it('accepts a valid card', () => { const r = validateAgentCard(validCard); expect(r.valid).toBe(true); expect(r.errors).toEqual([]); });
  it('accepts a card with optional metadata', () => { expect(validateAgentCard({ ...validCard, metadata: { auto_act: true } }).valid).toBe(true); });
  it('rejects missing name', () => { const { name, ...c } = validCard; const r = validateAgentCard(c); expect(r.valid).toBe(false); expect(r.errors).toContain('name is required'); });
  it('rejects invalid name format', () => { expect(validateAgentCard({ ...validCard, name: 'has spaces' }).valid).toBe(false); });
  it('rejects name over 64 chars', () => { expect(validateAgentCard({ ...validCard, name: 'a'.repeat(65) }).valid).toBe(false); });
  it('rejects missing skills', () => { const { skills, ...c } = validCard; expect(validateAgentCard(c).errors).toContain('skills is required'); });
  it('rejects empty skills array', () => { expect(validateAgentCard({ ...validCard, skills: [] }).errors[0]).toMatch(/at least one skill/); });
  it('rejects skill missing required fields', () => { expect(validateAgentCard({ ...validCard, skills: [{ id: 'x' }] }).valid).toBe(false); });
  it('rejects missing protocolVersion', () => { const { protocolVersion, ...c } = validCard; expect(validateAgentCard(c).valid).toBe(false); });
});
