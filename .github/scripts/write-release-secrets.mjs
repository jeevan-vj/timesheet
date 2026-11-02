import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const MISSING_GOOGLE_CLIENT_ID =
  "GOOGLE_CLIENT_ID is required by wrangler.jsonc secrets.required. Add it as a GitHub Actions variable or secret (repository or the production environment) before releasing.";

// Builds the Worker secrets uploaded on the tagged release deploy. Values are read from the
// environment and serialised with JSON.stringify; they are never printed.
export function buildReleaseSecrets(env) {
  const googleClientId = env.GOOGLE_CLIENT_ID ?? "";
  if (googleClientId === "") {
    throw new Error(MISSING_GOOGLE_CLIENT_ID);
  }
  const secrets = { GOOGLE_CLIENT_ID: googleClientId };
  const resendApiKey = env.RESEND_API_KEY ?? "";
  if (resendApiKey !== "") {
    secrets.RESEND_API_KEY = resendApiKey;
  }
  return secrets;
}

export function writeReleaseSecrets(file, env) {
  fs.writeFileSync(file, JSON.stringify(buildReleaseSecrets(env)), { mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  try {
    if (!file) {
      throw new Error("Usage: write-release-secrets.mjs <output-file>");
    }
    writeReleaseSecrets(file, process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not write the release secrets file");
    process.exitCode = 1;
  }
}
