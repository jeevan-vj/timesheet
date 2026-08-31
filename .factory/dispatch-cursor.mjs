import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = process.env.CURSOR_AGENTS_URL || 'https://api.cursor.com/v1/agents';

const SPECIALISTS = [
  ['spec', 'Specify the task and return an evidence-based task contract', 'spec.md'],
  ['frontend', 'Implement accessible browser-facing React behavior', 'frontend.md'],
  ['api', 'Implement authenticated and owner-scoped API behavior', 'api.md'],
  ['database', 'Implement safe Drizzle, D1, query, and migration changes', 'database.md'],
  ['verifier', 'Independently verify acceptance criteria without editing files', 'verifier.md'],
];

export function loadCustomSubagents() {
  return SPECIALISTS.map(([name, description, file]) => ({
    name,
    description,
    prompt: fs.readFileSync(new URL(`./agents/${file}`, import.meta.url), 'utf8'),
    model: 'inherit',
  }));
}

export function buildImplementPrompt({ issueNumber, title, body, repository }) {
  return [
    `You are the Cursor factory orchestrator for ${repository}.`,
    `Own GitHub issue #${issueNumber}: ${title}`,
    '',
    'Read and obey AGENTS.md, .factory/agents/orchestrator.md, and the relevant specialist instructions.',
    'Read SPEC.md, SECURITY.md, docs/ARCHITECTURE.md, docs/THREAT_MODEL.md, the issue, and relevant tests.',
    'Ask the spec subagent for a task contract before editing. Delegate only the necessary editing specialists, sequentially, in this shared checkout.',
    'After integration, ask the verifier subagent to check every acceptance criterion without editing. Route findings back to the responsible specialist and allow at most two repair cycles.',
    'Implement with TDD where practical, then run: pnpm install --frozen-lockfile && pnpm test && pnpm typecheck && pnpm build.',
    `Open a PR containing Closes #${issueNumber}, verification results, and security/payroll/migration impact.`,
    'Never weaken owner scoping, trusted-origin checks, rate snapshots, validation, migrations, or tests.',
    'Never edit AGENTS.md, .github/**, or .factory/** unless the issue explicitly requires protected work.',
    'Follow CI and review feedback until the PR is merge-ready. Do not merge protected changes.',
    '', '## Issue body', body?.trim() || '(empty)',
  ].join('\n');
}

export function buildAgentPayload({ repository, issueNumber, title, body, startingRef = 'main' }) {
  return {
    name: `factory #${issueNumber}`.slice(0, 100),
    prompt: { text: buildImplementPrompt({ issueNumber, title, body, repository }) },
    repos: [{ url: repository.startsWith('http') ? repository : `https://github.com/${repository}`, startingRef }],
    customSubagents: loadCustomSubagents(),
    autoCreatePR: true,
    skipReviewerRequest: true,
  };
}

export async function dispatchCursorAgent(payload, { apiKey, apiUrl = API_URL, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('CURSOR_API_KEY is required');
  const response = await fetchImpl(apiUrl, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await response.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!response.ok) throw new Error(`Cursor Agents API ${response.status}: ${JSON.stringify(json)}`);
  return json;
}

function parseArgs(argv) {
  const out = { dryRun:false, repo:'', issue:'', title:'', body:'', bodyFile:'', ref:'main' };
  for (let i=0;i<argv.length;i+=1) { const arg=argv[i]; const next=argv[i+1]; if (arg==='--dry-run') out.dryRun=true; else if (arg==='--repo') {out.repo=next;i+=1;} else if (arg==='--issue') {out.issue=next;i+=1;} else if (arg==='--title') {out.title=next;i+=1;} else if (arg==='--body') {out.body=next;i+=1;} else if (arg==='--body-file') {out.bodyFile=next;i+=1;} else if (arg==='--ref') {out.ref=next;i+=1;} }
  return out;
}
async function main() {
  const args=parseArgs(process.argv.slice(2));
  if (!args.repo || !args.issue || !args.title) throw new Error('Missing --repo, --issue, or --title');
  const body=args.bodyFile ? fs.readFileSync(args.bodyFile,'utf8') : args.body;
  const payload=buildAgentPayload({repository:args.repo,issueNumber:Number(args.issue),title:args.title,body,startingRef:args.ref});
  const result=args.dryRun ? payload : await dispatchCursorAgent(payload,{apiKey:process.env.CURSOR_API_KEY});
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
}
const self=fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1])===path.resolve(self)) await main();
