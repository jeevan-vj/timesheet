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

export function codexCleanPassReview(comments, headSha, policy = loadReviewBots()) {
  const head = String(headSha ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(head)) return null;
  const found = (Array.isArray(comments) ? comments : [])
    .filter((comment) => isFactoryReviewBot(comment?.user?.login, comment?.user?.type, policy))
    .filter((comment) => /^Codex Review:\s*Didn['’]t find any major issues\b/i.test(String(comment?.body ?? '').trim()))
    .map((comment) => {
      const match = String(comment.body).match(/Reviewed commit:[^`]*`([0-9a-f]{7,40})`/i);
      return { comment, prefix: match?.[1]?.toLowerCase() ?? '' };
    })
    .filter((item) => item.prefix && head.startsWith(item.prefix))
    .sort((a, b) => String(a.comment.created_at ?? a.comment.updated_at ?? '').localeCompare(String(b.comment.created_at ?? b.comment.updated_at ?? '')))
    .at(-1);
  if (!found) return null;
  return {
    id: Number(found.comment.id),
    commit_id: headSha,
    state: 'COMMENTED',
    submitted_at: found.comment.created_at ?? found.comment.updated_at ?? '',
    user: found.comment.user,
    body: String(found.comment.body),
    synthetic: true,
  };
}

export function reviewsWithCodexCleanPass(reviews, comments, headSha, policy = loadReviewBots()) {
  const list = Array.isArray(reviews) ? reviews : [];
  const existing = selectLatestFactoryReview(list.filter((review) => review?.commit_id === headSha), policy);
  if (existing) return list;
  const synthetic = codexCleanPassReview(comments, headSha, policy);
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
