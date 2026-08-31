import { describe, expect, it, vi } from 'vitest';
import { detectFactoryHandoff } from '../.factory/handoff.mjs';
import fs from 'node:fs';
import { buildAgentPayload, dispatchCursorAgent } from '../.factory/dispatch-cursor.mjs';
import { buildRepairPrompt, createFollowUpRun } from '../.factory/followup-cursor.mjs';
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
    expect(payload.prompt.text).toContain('spec subagent');
    expect(payload.customSubagents.map(({name})=>name)).toEqual(['spec','frontend','api','database','verifier']);
    expect(payload.customSubagents.every(({prompt})=>prompt.length>100)).toBe(true);
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
  it('continues the durable agent on the existing PR without exposing its key', async () => {
    const fetchImpl=vi.fn(async()=>({ok:true,status:201,text:async()=>JSON.stringify({run:{id:'run-test'}})}));
    const prompt=buildRepairPrompt({repository:'jeevan-vj/timesheet',issueNumber:7,pullRequest:8,headSha:'abc123',reason:'CI failed'});
    await createFollowUpRun({agentId:'bc-test',prompt},{apiKey:'test-key',fetchImpl});
    const [url,init]=fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.cursor.com/v1/agents/bc-test/runs');
    expect(init.body).toContain('existing pull request #8');
    expect(init.body).toContain('sequentially');
    expect(init.body).not.toContain('test-key');
  });
  it('limits autonomous merge to low-risk changes and repair to two cycles', () => {
    const controller=fs.readFileSync(new URL('../.github/workflows/factory-controller.yml',import.meta.url),'utf8');
    const repair=fs.readFileSync(new URL('../.github/workflows/factory-repair.yml',import.meta.url),'utf8');
    expect(controller).toContain('if [ "$risk" != low ]');
    expect(repair).toContain('if [ "$attempts" -ge 2 ]');
    expect(repair).toContain('https://api.cursor.com/v1/agents/$agent_id/runs');
    expect(repair).not.toContain('actions/checkout');
    expect(repair).toContain('.user.login == "github-actions[bot]"');
    expect(repair).toContain('[ "$head" = "$RUN_HEAD_SHA" ]');
  });
});
