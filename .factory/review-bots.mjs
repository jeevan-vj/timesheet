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
