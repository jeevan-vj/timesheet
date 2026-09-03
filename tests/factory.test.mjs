import { describe, expect, it, vi } from 'vitest';
import { detectFactoryHandoff } from '../.factory/handoff.mjs';
import fs from 'node:fs';
import { buildAgentPayload, dispatchCursorAgent, verifyCursorAgentRecord } from '../.factory/dispatch-cursor.mjs';
import { buildRepairPrompt, createFollowUpRun } from '../.factory/followup-cursor.mjs';
import { classifyRisk, loadPolicy } from '../.factory/classify-risk.mjs';
import {
  blockingFactoryReviewCommentIds,
  selectActionableFactoryReview,
  selectMergeableFactoryReview,
} from '../.factory/review-bots.mjs';

describe('Cursor factory', () => {
  it('starts Cursor intake from factory:ready and ignores bare @cursor mentions', () => {
    expect(detectFactoryHandoff({ labels: ['factory:ready'], text: 'Ship weekly CSV' })).toEqual({
      delegated: true,
      provider: 'cursor',
      reason: 'factory:ready',
    });
    expect(detectFactoryHandoff('@cursor implement this')).toEqual({
      delegated: false,
      provider: null,
      reason: null,
    });
    expect(detectFactoryHandoff({ labels: [], text: '@codex please take this' })).toEqual({
      delegated: true,
      provider: 'codex',
      reason: 'mention',
    });
  });
  it('keeps the factory issue template free of @cursor mentions', () => {
    const template = fs.readFileSync(new URL('../.github/ISSUE_TEMPLATE/factory-task.md', import.meta.url), 'utf8');
    const workflow = fs.readFileSync(new URL('../.github/workflows/factory.yml', import.meta.url), 'utf8');
    expect(template).toContain('factory:ready');
    expect(template).not.toMatch(/^@cursor\b/m);
    expect(workflow).toContain("github.event.label.name == 'factory:ready'");
    expect(workflow).not.toContain("contains(github.event.comment.body, '@cursor')");
    expect(workflow).toContain('Skipping dispatch; durable factory agent already recorded');
    expect(workflow).toContain('Cursor Cloud Agent API-verified');
    expect(workflow).toContain('--body-file "$comment_file"');
    expect(workflow).not.toContain('Cursor Cloud Agent dispatched${url:+: $url}\\n\\n');
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
  it('uses bearer authentication and verifies the durable agent after creation', async () => {
    const fetchImpl=vi.fn()
      .mockResolvedValueOnce({ok:true,status:200,text:async()=>JSON.stringify({agent:{id:'bc-test'}})})
      .mockResolvedValueOnce({ok:true,status:200,text:async()=>JSON.stringify({id:'bc-test',status:'ACTIVE',url:'https://cursor.com/agents/bc-test',latestRunId:'run-test'})});
    const result = await dispatchCursorAgent({name:'test'},{apiKey:'test-key',fetchImpl});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [createUrl,createInit]=fetchImpl.mock.calls[0];
    expect(createUrl).toBe('https://api.cursor.com/v1/agents');
    expect(createInit.headers.Authorization).toBe('Bearer test-key');
    expect(createInit.body).not.toContain('test-key');
    const [verifyUrl,verifyInit]=fetchImpl.mock.calls[1];
    expect(verifyUrl).toBe('https://api.cursor.com/v1/agents/bc-test');
    expect(verifyInit.method).toBe('GET');
    expect(verifyInit.headers.Authorization).toBe('Bearer test-key');
    expect(result.factoryVerification).toMatchObject({id:'bc-test',runId:'run-test',status:'ACTIVE'});
  });
  it('fails closed when post-dispatch agent verification fails', async () => {
    const fetchImpl=vi.fn()
      .mockResolvedValueOnce({ok:true,status:200,text:async()=>JSON.stringify({agent:{id:'bc-missing'}})})
      .mockResolvedValueOnce({ok:false,status:404,text:async()=>JSON.stringify({error:'not_found'})});
    await expect(dispatchCursorAgent({name:'test'},{apiKey:'test-key',fetchImpl})).rejects.toThrow('Cursor Agents API 404');
  });
  it('rejects an immediately archived or mismatched verified agent', () => {
    expect(() => verifyCursorAgentRecord('bc-test', {id:'bc-other',status:'ACTIVE'})).toThrow('unexpected ID');
    expect(() => verifyCursorAgentRecord('bc-test', {id:'bc-test',status:'ARCHIVED'})).toThrow('archived');
  });
  it('protects control plane and treats payroll/auth/data as high risk', () => {
    const policy=loadPolicy();
    expect(classifyRisk(['.github/workflows/factory.yml'],policy)).toBe('protected');
    expect(classifyRisk(['src/lib/payroll.ts'],policy)).toBe('high');
    expect(classifyRisk(['src/lib/api.ts'],policy)).toBe('high');
    expect(classifyRisk(['src/lib/request-session.ts'],policy)).toBe('high');
    expect(classifyRisk(['src/lib/accounts-config.ts'],policy)).toBe('high');
    expect(classifyRisk(['src/lib/time-entry-write.ts'],policy)).toBe('high');
    expect(classifyRisk(['drizzle/0001_change.sql'],policy)).toBe('high');
    expect(classifyRisk(['src/components/empty-state.tsx'],policy)).toBe('low');
    expect(classifyRisk(['src/lib/new-session-helper.ts'],policy)).not.toBe('low');
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
  it('routes trusted COMMENTED P0-P2 findings but ignores advisory or stale reviews', () => {
    const reviews = [
      { id: 1, commit_id: 'head-1', state: 'COMMENTED', submitted_at: '2026-09-01T10:00:00Z', user: { login: 'chatgpt-codex-connector[bot]', type: 'Bot' } },
      { id: 2, commit_id: 'head-1', state: 'COMMENTED', submitted_at: '2026-09-01T10:01:00Z', user: { login: 'unknown-reviewer[bot]', type: 'Bot' } },
      { id: 3, commit_id: 'old-head', state: 'CHANGES_REQUESTED', submitted_at: '2026-09-01T10:02:00Z', user: { login: 'cursor[bot]', type: 'Bot' } },
    ];
    const comments = [
      { id: 101, pull_request_review_id: 1, body: '[P2] Add behavioral authorization coverage.' },
      { id: 102, pull_request_review_id: 1, body: '[P3] Consider renaming this helper.' },
      { id: 103, pull_request_review_id: 2, body: '[P1] Untrusted bot finding.' },
    ];

    const selected = selectActionableFactoryReview(reviews, comments, 'head-1');
    expect(selected.id).toBe(1);
    expect(selected.blockingFindings).toEqual(['[P2] Add behavioral authorization coverage.']);
    expect(selected.blockingCommentIds).toEqual([101]);
    expect(blockingFactoryReviewCommentIds(reviews, comments)).toEqual([101]);
    expect(selectActionableFactoryReview(reviews, comments, 'unreviewed-head')).toBeNull();

    reviews.push({ id: 4, commit_id: 'head-1', state: 'COMMENTED', body: 'No blocking findings.', submitted_at: '2026-09-01T10:03:00Z', user: { login: 'chatgpt-codex-connector[bot]', type: 'Bot' } });
    expect(selectActionableFactoryReview(reviews, comments, 'head-1')).toBeNull();
  });
  it('merges only a current non-blocking trusted review and treats P3 as advisory', () => {
    const review = { id: 11, commit_id: 'head-1', state: 'COMMENTED', body: 'No blocking findings.', submitted_at: '2026-09-01T10:00:00Z', user: { login: 'chatgpt-codex-connector[bot]', type: 'Bot' } };
    const advisory = { id: 201, pull_request_review_id: 11, body: '[P3] Consider renaming this helper.' };
    expect(selectMergeableFactoryReview([review], [advisory], 'head-1')?.id).toBe(11);

    const blockingSummary = { ...review, body: '[P2] Missing authorization regression coverage.' };
    expect(selectMergeableFactoryReview([blockingSummary], [], 'head-1')).toBeNull();
    expect(selectMergeableFactoryReview([review], [], 'different-head')).toBeNull();
    expect(selectMergeableFactoryReview([{ ...review, state: 'CHANGES_REQUESTED' }], [], 'head-1')).toBeNull();
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
    expect(repair).toContain('/runs?limit=1');
    expect(repair).toContain('CREATING|RUNNING');
    expect(repair).toContain('current_head=');
    expect(repair).not.toContain('/cancel');
    expect(controller).toContain('@codex review');
    expect(controller).toContain('factory-review-request:');
    expect(controller).toContain('/replies');
    expect(controller).toContain('resolveReviewThread');
    expect(controller).toContain('--remove-label factory:needs-human');
    expect(controller).toContain('contents: write');
    expect(controller).toContain('selectMergeableFactoryReview');
    expect(controller).not.toContain('[ "$comments" -eq 0 ]');
  });
});
