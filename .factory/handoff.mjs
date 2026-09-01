import path from 'node:path';
import { fileURLToPath } from 'node:url';

function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => (typeof label === 'string' ? label : label?.name))
    .filter((name) => typeof name === 'string' && name.length > 0);
}

/**
 * Factory intake is label-driven so native GitHub `@cursor` mentions do not
 * double-dispatch a second Cloud Agent beside the Actions API orchestrator.
 *
 * - `factory:ready` → Cursor via Agents API
 * - `@codex` in text → Codex fallback (label only; no Cursor API call)
 * - bare `@cursor` is intentionally ignored for factory intake
 */
export function detectFactoryHandoff(input) {
  const payload = typeof input === 'string' ? { text: input, labels: [] } : (input ?? {});
  const labels = normalizeLabels(payload.labels);
  const text = String(payload.text ?? '');

  if (labels.includes('factory:ready')) {
    return { delegated: true, provider: 'cursor', reason: 'factory:ready' };
  }
  if (/(?:^|[\s([{])@codex\b/i.test(text)) {
    return { delegated: true, provider: 'codex', reason: 'mention' };
  }
  return { delegated: false, provider: null, reason: null };
}

async function main() {
  const args = process.argv.slice(2);
  let labels = [];
  let text = '';
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--labels' && args[i + 1]) {
      labels = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (args[i] === '--text' && args[i + 1]) {
      text = args[i + 1];
      i += 1;
    } else if (!args[i].startsWith('--')) {
      text += (text ? ' ' : '') + args[i];
    }
  }
  if (!text && !process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const trimmed = input.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        labels = normalizeLabels(parsed.labels ?? labels);
        text = String(parsed.text ?? '');
      } catch {
        text = input;
      }
    } else {
      text = input;
    }
  }
  process.stdout.write(`${JSON.stringify(detectFactoryHandoff({ labels, text }))}\n`);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(self)) await main();
