import { pathToFileURL } from "node:url";

export const HOME_TITLE = "CleanTrack — contractor hours & weekly pay";
export const SMOKE_MUTATION_PATH = "/api/sites";
export const SMOKE_ORIGIN = "https://smoke.invalid";
export const SMOKE_COOKIE = "cleantrack-smoke=1";

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
};

export function decodeHtmlEntities(text) {
  return text.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|([a-z]+));/gi, (match, hex, decimal, name) => {
    if (hex !== undefined) return characterFromCode(Number.parseInt(hex, 16), match);
    if (decimal !== undefined) return characterFromCode(Number.parseInt(decimal, 10), match);
    const named = NAMED_ENTITIES[name.toLowerCase()];
    return named ?? match;
  });
}

function characterFromCode(code, fallback) {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return fallback;
  if (code >= 0xd800 && code <= 0xdfff) return fallback;
  return String.fromCodePoint(code);
}

export function htmlTitleText(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return decodeHtmlEntities(match[1]).trim();
}

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

  if (body.status !== "ok" || body.database !== "ok" || (releaseSha !== undefined && body.release !== releaseSha)) {
    throw new SmokeCheckError("Health response does not match the active release");
  }

  for (const [name, expected] of Object.entries(requiredHeaders)) {
    if (!response.headers.get(name)?.includes(expected)) {
      throw new SmokeCheckError(`Missing required ${name} response header`);
    }
  }
  return body;
}

function cacheBust(url, releaseSha, attempt) {
  url.searchParams.set("release", releaseSha);
  url.searchParams.set("smoke_attempt", String(attempt));
  return url;
}

async function assertReleaseSurface({ fetchImpl, productionUrl, releaseSha, attempt, expectReleaseIdentity }) {
  const cacheKey = releaseSha || "unscoped";
  const healthUrl = cacheBust(new URL("/api/health", productionUrl), cacheKey, attempt);
  const health = await fetchImpl(healthUrl.toString(), {
    redirect: "error",
    headers: { "cache-control": "no-cache" },
  });
  const healthBody = await assertHealthyResponse(health, expectReleaseIdentity ? releaseSha : undefined);

  const meUrl = cacheBust(new URL("/api/me", productionUrl), cacheKey, attempt);
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

  const homeUrl = cacheBust(new URL("/", productionUrl), cacheKey, attempt);
  const home = await fetchImpl(homeUrl.toString(), {
    redirect: "error",
    headers: { "cache-control": "no-cache" },
  });
  if (home.status !== 200) throw new SmokeCheckError(`Home page returned ${home.status}`);
  const html = await home.text();
  const title = htmlTitleText(html);
  if (title !== HOME_TITLE) {
    throw new SmokeCheckError(`Home page title does not match. Received: ${JSON.stringify(title.slice(0, 200))}`);
  }
  return healthBody;
}

export async function verifyProductionRelease({
  productionUrl,
  releaseSha,
  versionTag,
  maxAttempts = 36,
  retryDelayMs = 5_000,
  expectReleaseIdentity = true,
  fetchImpl = fetch,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  logger = console,
}) {
  if (!productionUrl) throw new SmokeCheckError("PRODUCTION_URL is required");
  if (expectReleaseIdentity) {
    if (!releaseSha) throw new SmokeCheckError("GITHUB_SHA is required");
    if (versionTag !== releaseSha) {
      throw new SmokeCheckError("Deployed version tag does not match the release SHA");
    }
  }

  const attempts = positiveInteger(maxAttempts, 36, "maxAttempts");
  const delay = positiveInteger(retryDelayMs, 5_000, "retryDelayMs");
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const healthBody = await assertReleaseSurface({
        fetchImpl,
        productionUrl,
        releaseSha,
        attempt,
        expectReleaseIdentity,
      });
      if (!expectReleaseIdentity) {
        logger.warn(`Release identity check flagged and not enforced. Observed health release: ${healthBody.release ?? "missing"}. Version tag was not compared.`);
      }
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
  const expectReleaseIdentity = process.env.SMOKE_EXPECT_RELEASE_IDENTITY !== "0";
  await verifyProductionRelease({
    productionUrl: process.env.PRODUCTION_URL,
    releaseSha: process.env.GITHUB_SHA,
    versionTag: process.env.WORKER_VERSION_TAG,
    maxAttempts: process.env.SMOKE_MAX_ATTEMPTS,
    retryDelayMs: process.env.SMOKE_RETRY_DELAY_MS,
    expectReleaseIdentity,
  });
  if (expectReleaseIdentity) {
    console.log(`Production smoke test passed for release ${process.env.GITHUB_SHA.slice(0, 12)}`);
    return;
  }
  console.log("Production smoke test passed with the release identity check flagged and not enforced");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Production smoke test failed");
    process.exitCode = 1;
  });
}
