import { describe, expect, it, vi } from 'vitest';
import { detectFactoryHandoff } from '../.factory/handoff.mjs';
import { buildAgentPayload, dispatchCursorAgent } from '../.factory/dispatch-cursor.mjs';
import { classifyRisk, loadPolicy } from '../.factory/classify-risk.mjs';

describe('Cursor factory', () => {
  it('prefers an explicit @cursor handoff', () => {
    expect(detectFactoryHandoff('@cursor implement this')).toEqual({ delegated:true, provider:'cursor' });
    expect(detectFactoryHandoff('cursor without mention')).toEqual({ delegated:false, provider:null });
  });
  it('creates an auto-PR Cursor Agents payload', () => {
    const payload=buildAgentPayload({repository:'jeevan-vj/timesheet',issueNumber:4,title:'Weekly CSV',body:'Export approved totals'});
    expect(payload.autoCreatePR).toBe(true);
    expect(payload.prompt.text).toContain('Closes #4');
    expect(payload.prompt.text).toContain('AGENTS.md');
  });
  it('uses bearer authentication without placing a key in the payload', async () => {
    const fetchImpl=vi.fn(async()=>({ok:true,status:200,text:async()=>JSON.stringify({agent:{id:'bc-test'}})}));
    await dispatchCursorAgent({name:'test'},{apiKey:'test-key',fetchImpl});
    const [,init]=fetchImpl.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(init.body).not.toContain('test-key');
  });
  it('protects control plane and treats payroll/auth/data as high risk', () => {
    const policy=loadPolicy();
    expect(classifyRisk(['.github/workflows/factory.yml'],policy)).toBe('protected');
    expect(classifyRisk(['src/lib/payroll.ts'],policy)).toBe('high');
    expect(classifyRisk(['drizzle/0001_change.sql'],policy)).toBe('high');
  });
});
