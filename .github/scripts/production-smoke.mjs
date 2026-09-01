import { pathToFileURL } from "node:url";

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

export async function verifyProductionRelease({
  productionUrl,
  releaseSha,
  maxAttempts = 36,
  retryDelayMs = 5_000,
  fetchImpl = fetch,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  logger = console,
}) {
  if (!productionUrl) throw new SmokeCheckError("PRODUCTION_URL is required");
  if (!releaseSha) throw new SmokeCheckError("GITHUB_SHA is required");

  const attempts = positiveInteger(maxAttempts, 36, "maxAttempts");
  const delay = positiveInteger(retryDelayMs, 5_000, "retryDelayMs");
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const url = new URL("/api/health", productionUrl);
    url.searchParams.set("release", releaseSha);
    url.searchParams.set("smoke_attempt", String(attempt));

    try {
      const response = await fetchImpl(url.toString(), {
        redirect: "error",
        headers: { "cache-control": "no-cache" },
      });
      await assertHealthyResponse(response, releaseSha);
      return;
    } catch (error) {
      lastError = error instanceof SmokeCheckError
        ? error
        : new SmokeCheckError("Health request failed");
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
