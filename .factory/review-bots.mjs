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
