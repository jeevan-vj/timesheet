import { pathToFileURL } from "node:url";

export const HOME_TITLE = "CleanTrack — contractor hours & weekly pay";
export const SMOKE_MUTATION_PATH = "/api/sites";
export const SMOKE_ORIGIN = "https://smoke.invalid";
export const SMOKE_COOKIE = "cleantrack-smoke=1";

const requiredHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

class SmokeCheckError extends Error {}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SmokeCheckError(`${name} must be a positive integer`);
  }
  return parsed;
}

async function assertHealthyResponse(response, releaseSha) {
  if (!response.ok) throw new SmokeCheckError(`Health check failed with ${response.status}`);

  let body;
  try {
    body = await response.json();
  } catch {
    throw new SmokeCheckError("Health response was not valid JSON");
  }

  if (body.status !== "ok" || body.database !== "ok" || body.release !== releaseSha) {
    throw new SmokeCheckError("Health response does not match the active release");
  }

  for (const [name, expected] of Object.entries(requiredHeaders)) {
    if (!response.headers.get(name)?.includes(expected)) {
      throw new SmokeCheckError(`Missing required ${name} response header`);
    }
  }
}

function cacheBust(url, releaseSha, attempt) {
  url.searchParams.set("release", releaseSha);
  url.searchParams.set("smoke_attempt", String(attempt));
  return url;
}

async function assertReleaseSurface({ fetchImpl, productionUrl, releaseSha, attempt }) {
  const healthUrl = cacheBust(new URL("/api/health", productionUrl), releaseSha, attempt);
  const health = await fetchImpl(healthUrl.toString(), {
    redirect: "error",
    headers: { "cache-control": "no-cache" },
  });
  await assertHealthyResponse(health, releaseSha);

  const meUrl = cacheBust(new URL("/api/me", productionUrl), releaseSha, attempt);
  const me = await fetchImpl(meUrl.toString(), {
    redirect: "error",
    headers: { "cache-control": "no-cache" },
  });
  if (me.status !== 401) throw new SmokeCheckError(`Signed-out /api/me returned ${me.status}`);
  await me.text();

  const mutation = await fetchImpl(new URL(SMOKE_MUTATION_PATH, productionUrl).toString(), {
    method: "POST",
    redirect: "error",
    headers: {
      origin: SMOKE_ORIGIN,
      cookie: SMOKE_COOKIE,
      "content-type": "application/json",
      "cache-control": "no-cache",
    },
    body: "{}",
  });
  if (mutation.status !== 403) throw new SmokeCheckError(`Cross-origin mutation returned ${mutation.status}`);
  await mutation.text();

  const homeUrl = cacheBust(new URL("/", productionUrl), releaseSha, attempt);
  const home = await fetchImpl(homeUrl.toString(), {
    redirect: "error",
    headers: { "cache-control": "no-cache" },
  });
  if (home.status !== 200) throw new SmokeCheckError(`Home page returned ${home.status}`);
  const html = await home.text();
  if (!html.includes(HOME_TITLE)) throw new SmokeCheckError("Home page is missing the expected title");
}

export async function verifyProductionRelease({
  productionUrl,
  releaseSha,
  versionTag,
  maxAttempts = 36,
  retryDelayMs = 5_000,
  fetchImpl = fetch,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  logger = console,
}) {
  if (!productionUrl) throw new SmokeCheckError("PRODUCTION_URL is required");
  if (!releaseSha) throw new SmokeCheckError("GITHUB_SHA is required");
  if (versionTag !== releaseSha) {
    throw new SmokeCheckError("Deployed version tag does not match the release SHA");
  }

  const attempts = positiveInteger(maxAttempts, 36, "maxAttempts");
  const delay = positiveInteger(retryDelayMs, 5_000, "retryDelayMs");
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await assertReleaseSurface({ fetchImpl, productionUrl, releaseSha, attempt });
      return;
    } catch (error) {
      lastError = error instanceof SmokeCheckError
        ? error
        : new SmokeCheckError("Production smoke request failed");
      if (attempt === attempts) break;
      logger.warn(`Production smoke attempt ${attempt}/${attempts} failed: ${lastError.message}`);
      await sleep(delay);
    }
  }

  throw lastError;
}

async function main() {
  await verifyProductionRelease({
    productionUrl: process.env.PRODUCTION_URL,
    releaseSha: process.env.GITHUB_SHA,
    versionTag: process.env.WORKER_VERSION_TAG,
    maxAttempts: process.env.SMOKE_MAX_ATTEMPTS,
    retryDelayMs: process.env.SMOKE_RETRY_DELAY_MS,
  });
  console.log(`Production smoke test passed for release ${process.env.GITHUB_SHA.slice(0, 12)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Production smoke test failed");
    process.exitCode = 1;
  });
}
