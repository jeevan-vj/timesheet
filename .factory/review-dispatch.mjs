import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function planIndependentReview({ reviewId = '', requestCount = 0 } = {}) {
  if (String(reviewId ?? '').trim()) return 'proceed';
  if (Number(requestCount) > 0) return 'wait';
  return 'request';
}

function parseArgs(argv) {
  const out = { reviewId: '', requestCount: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--review-id') {
      out.reviewId = next ?? '';
      i += 1;
    } else if (arg === '--requests') {
      out.requestCount = Number(next ?? 0);
      i += 1;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(`${planIndependentReview(args)}\n`);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(self)) await main();
