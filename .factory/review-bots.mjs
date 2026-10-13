import fs from 'node:fs';

export function loadReviewBots(policyPath = new URL('./review-bots.json', import.meta.url)) {
  return JSON.parse(fs.readFileSync(policyPath, 'utf8'));
}
export function isFactoryReviewBot(login, userType, policy = loadReviewBots()) {
  const normalized = String(login ?? '').toLowerCase();
  return policy.bots.some((bot) => bot.login.toLowerCase() === normalized && (!bot.type || !userType || bot.type === userType));
}
export function selectLatestFactoryReview(reviews, policy = loadReviewBots()) {
  return (Array.isArray(reviews) ? reviews : [])
    .filter((review) => isFactoryReviewBot(review?.user?.login, review?.user?.type, policy))
    .sort((a, b) => String(a.submitted_at ?? '').localeCompare(String(b.submitted_at ?? '')))
    .at(-1) ?? null;
}

export function isBlockingFactoryFinding(text) {
  return /(?:^|[^A-Za-z0-9])P[0-2](?:[^A-Za-z0-9]|$)/i.test(String(text ?? ''));
}

function reviewComments(review, comments) {
  return (Array.isArray(comments) ? comments : [])
    .filter((comment) => Number(comment?.pull_request_review_id) === Number(review?.id));
}

export function selectActionableFactoryReview(reviews, comments, headSha, policy = loadReviewBots()) {
  const review = (Array.isArray(reviews) ? reviews : [])
    .filter((review) => review?.commit_id === headSha)
    .filter((review) => isFactoryReviewBot(review?.user?.login, review?.user?.type, policy))
    .sort((a, b) => String(a.submitted_at ?? '').localeCompare(String(b.submitted_at ?? '')))
    .at(-1);
  if (!review) return null;

  const related = reviewComments(review, comments);
  const blockingComments = related.filter((comment) => isBlockingFactoryFinding(comment?.body));
  const blockingFindings = blockingComments.map((comment) => String(comment.body).trim());
  if (isBlockingFactoryFinding(review?.body)) blockingFindings.unshift(String(review.body).trim());
  if (String(review?.state ?? '').toLowerCase() !== 'changes_requested' && blockingFindings.length === 0) return null;
  return {
    ...review,
    blockingFindings: blockingFindings.length ? blockingFindings : [String(review?.body || 'The trusted review requested changes.').trim()],
    blockingCommentIds: blockingComments.map((comment) => Number(comment.id)).filter(Number.isFinite),
  };
}

function isCodexConnector(comment, policy) {
  return isFactoryReviewBot(comment?.user?.login, comment?.user?.type, policy)
    && String(comment?.user?.login ?? '').toLowerCase() === 'chatgpt-codex-connector[bot]';
}

function commentTime(comment) {
  return String(comment?.created_at ?? comment?.updated_at ?? '');
}

function namesHead(body, head) {
  return [...String(body).matchAll(/`([0-9a-f]{7,40})`/gi)].some((match) => head.startsWith(match[1].toLowerCase()));
}

function isBreezyCodexComment(body) {
  return /^Codex Review:\s*Didn['’]t find any major issues\b/i.test(String(body ?? '').trim());
}

function isCompletedCodexSummary(body, head) {
  if (!String(body).includes('codex-pull-request-review-summary')) return false;
  const row = [...String(body).matchAll(/Code Review[\s\S]{0,500}?`([0-9a-f]{7,40})`/gi)].at(-1);
  if (!row || !/Completed/i.test(row[0])) return false;
  return head.startsWith(row[1].toLowerCase());
}

function isCodexFindingsComment(body) {
  const text = String(body ?? '');
  if (text.includes('codex-pull-request-review-summary')) return false;
  if (isBreezyCodexComment(text)) return false;
  if (/create an environment for this repo/i.test(text)) return false;
  if (/usage limits for code reviews/i.test(text)) return false;
  if (!/`[0-9a-f]{7,40}`/i.test(text)) return false;
  return /^Codex Review\b/im.test(text.trim())
    || /💡\s*Codex Review/i.test(text)
    || /automated review suggestions/i.test(text)
    || /found \d+ (?:major )?issues?/i.test(text)
    || isBlockingFactoryFinding(text);
}

function syntheticCodexReview(comment, headSha, state) {
  return {
    id: Number(comment.id),
    commit_id: headSha,
    state,
    submitted_at: comment.created_at ?? comment.updated_at ?? '',
    user: comment.user,
    body: String(comment.body),
    synthetic: true,
  };
}

export function codexCommentReview(comments, headSha, policy = loadReviewBots()) {
  const head = String(headSha ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(head)) return null;
  const classified = (Array.isArray(comments) ? comments : [])
    .filter((comment) => isCodexConnector(comment, policy))
    .map((comment) => {
      const body = String(comment?.body ?? '');
      if (isBreezyCodexComment(body) && namesHead(body, head)) return { kind: 'breezy', comment };
      if (isCompletedCodexSummary(body, head)) return { kind: 'summary', comment };
      if (isCodexFindingsComment(body) && namesHead(body, head)) return { kind: 'findings', comment };
      return null;
    })
    .filter(Boolean);
  const latest = (kind) => classified.filter((item) => item.kind === kind).sort((a, b) => commentTime(a.comment).localeCompare(commentTime(b.comment))).at(-1);
  const findings = latest('findings');
  const breezy = latest('breezy');
  if (findings && (!breezy || commentTime(findings.comment) >= commentTime(breezy.comment))) {
    return syntheticCodexReview(findings.comment, headSha, 'CHANGES_REQUESTED');
  }
  const clean = [breezy, latest('summary')].filter(Boolean).sort((a, b) => commentTime(a.comment).localeCompare(commentTime(b.comment))).at(-1);
  return clean ? syntheticCodexReview(clean.comment, headSha, 'COMMENTED') : null;
}

export function reviewsWithCodexComments(reviews, comments, headSha, policy = loadReviewBots()) {
  const list = Array.isArray(reviews) ? reviews : [];
  const existing = selectLatestFactoryReview(list.filter((review) => review?.commit_id === headSha), policy);
  if (existing) return list;
  const synthetic = codexCommentReview(comments, headSha, policy);
  return synthetic ? [...list, synthetic] : list;
}

export function selectMergeableFactoryReview(reviews, comments, headSha, policy = loadReviewBots()) {
  const review = (Array.isArray(reviews) ? reviews : [])
    .filter((item) => item?.commit_id === headSha)
    .filter((item) => isFactoryReviewBot(item?.user?.login, item?.user?.type, policy))
    .sort((a, b) => String(a.submitted_at ?? '').localeCompare(String(b.submitted_at ?? '')))
    .at(-1);
  if (!review) return null;
  if (!['approved', 'commented'].includes(String(review.state ?? '').toLowerCase())) return null;
  if (selectActionableFactoryReview([review], comments, headSha, policy)) return null;
  return review;
}

export function blockingFactoryReviewCommentIds(reviews, comments, policy = loadReviewBots()) {
  const trustedReviewIds = new Set(
    (Array.isArray(reviews) ? reviews : [])
      .filter((review) => isFactoryReviewBot(review?.user?.login, review?.user?.type, policy))
      .map((review) => Number(review.id)),
  );
  return (Array.isArray(comments) ? comments : [])
    .filter((comment) => trustedReviewIds.has(Number(comment?.pull_request_review_id)))
    .filter((comment) => isBlockingFactoryFinding(comment?.body))
    .map((comment) => Number(comment.id))
    .filter(Number.isFinite);
}
