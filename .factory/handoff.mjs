import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function detectFactoryHandoff(text) {
  const body = String(text ?? '');
  if (/(?:^|[\s([{])@cursor\b/i.test(body)) return { delegated: true, provider: 'cursor' };
  if (/(?:^|[\s([{])@codex\b/i.test(body)) return { delegated: true, provider: 'codex' };
  return { delegated: false, provider: null };
}

async function main() {
  let input = process.argv.slice(2).join(' ');
  if (!input && !process.stdin.isTTY) for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(`${JSON.stringify(detectFactoryHandoff(input))}\n`);
}
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(self)) await main();
