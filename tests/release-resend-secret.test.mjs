import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildReleaseSecrets, MISSING_GOOGLE_CLIENT_ID } from "../.github/scripts/write-release-secrets.mjs";

const release = fs.readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const preview = fs.readFileSync(new URL("../.github/workflows/preview.yml", import.meta.url), "utf8");
const deployment = fs.readFileSync(new URL("../docs/DEPLOYMENT.md", import.meta.url), "utf8");
const wrangler = fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("production RESEND_API_KEY provisioning", () => {
  it("uploads the optional key on the tagged deploy and skips it when unset", () => {
    const deploy = section(release, "name: Deploy production release", "name: Verify active release identity");
    const jobEnv = section(release, "name: production", "steps:");

    expect(jobEnv).not.toContain("RESEND_API_KEY");
    expect(deploy).toContain("RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}");
    expect(deploy).toContain("RESEND_API_KEY is unset; continuing without provisioning the Worker secret.");
    expect(deploy).toContain("umask 077");
    expect(deploy).toContain("${RUNNER_TEMP}/release-worker-secrets.json");
    expect(deploy).toContain('node .github/scripts/write-release-secrets.mjs "${secrets_file}"');
    expect(deploy).toContain("--secrets-file");
    expect(deploy).toContain("rm -f --");
    expect(deploy).toContain('--tag "$GITHUB_SHA"');
    expect(deploy).toContain('--message "GitHub Actions release $GITHUB_SHA"');
    expect(deploy).toContain('--var "BETTER_AUTH_URL:${PRODUCTION_URL}"');
    expect(deploy).toContain('--var "AUTH_TRUSTED_ORIGINS:"');
    expect(deploy).toContain('--var "RELEASE_SHA:${GITHUB_SHA}"');
    expect(deploy).not.toContain("secret put");
    expect(deploy).not.toContain("set -x");
    expect(deploy).not.toContain("bash -x");
    expect(deploy).not.toContain('echo "$RESEND_API_KEY"');
    expect(deploy).not.toContain("echo ${RESEND_API_KEY}");
    expect(deploy.match(/\$\{\{ secrets\.RESEND_API_KEY \}\}/g)).toEqual(["${{ secrets.RESEND_API_KEY }}"]);
    const run = deploy.split("run: |")[1];
    expect(run).not.toContain("${{");
    // The secrets file is always passed, not only when RESEND_API_KEY is set.
    const resendBranch = run.slice(run.indexOf('if [ -z "${RESEND_API_KEY:-}" ]'), run.indexOf("previous_umask="));
    expect(resendBranch).not.toContain("--secrets-file");
    expect(run).toContain('deploy_args+=(--secrets-file "${secrets_file}")');

    const identity = section(release, "name: Verify active release identity", "name: Production smoke test");
    expect(identity).toContain("workers/tag");
    expect(identity).toContain("Active Cloudflare version does not match the workflow SHA");
  });

  it("passes GOOGLE_CLIENT_ID from a GitHub variable or secret and fails before migrations when it is empty", () => {
    const deploy = section(release, "name: Deploy production release", "name: Verify active release identity");
    const preflight = section(release, "name: Require GOOGLE_CLIENT_ID for the release", "name: Record the D1 bookmark");
    const jobEnv = section(release, "name: production", "steps:");
    const mapping = "GOOGLE_CLIENT_ID: ${{ vars.GOOGLE_CLIENT_ID || secrets.GOOGLE_CLIENT_ID }}";

    expect(jobEnv).not.toContain("GOOGLE_CLIENT_ID");
    expect(release.indexOf("name: Require GOOGLE_CLIENT_ID for the release")).toBeLessThan(
      release.indexOf("name: Apply production D1 migrations"),
    );
    for (const step of [preflight, deploy]) {
      expect(step).toContain(mapping);
      expect(step).toContain('if [ -z "${GOOGLE_CLIENT_ID:-}" ]; then');
      expect(step).toContain("GOOGLE_CLIENT_ID is required by wrangler.jsonc secrets.required.");
      expect(step).not.toContain("set -x");
      expect(step).not.toContain('echo "$GOOGLE_CLIENT_ID"');
      expect(step.split("run: |")[1]).not.toContain("${{");
    }
    expect(deploy).toContain('echo "::add-mask::${GOOGLE_CLIENT_ID}"');
    expect(release.match(/\$\{\{ vars\.GOOGLE_CLIENT_ID \|\| secrets\.GOOGLE_CLIENT_ID \}\}/g)).toHaveLength(2);
    expect(release).not.toContain("GOOGLE_CLIENT_SECRET");
    expect(preview).not.toContain("vars.GOOGLE_CLIENT_ID");
  });

  it("builds the secrets file with GOOGLE_CLIENT_ID and only a non-empty RESEND_API_KEY", () => {
    expect(buildReleaseSecrets({ GOOGLE_CLIENT_ID: "fake-client-id.apps.example" })).toEqual({
      GOOGLE_CLIENT_ID: "fake-client-id.apps.example",
    });
    expect(buildReleaseSecrets({ GOOGLE_CLIENT_ID: "fake-client-id.apps.example", RESEND_API_KEY: "" })).toEqual({
      GOOGLE_CLIENT_ID: "fake-client-id.apps.example",
    });
    expect(
      buildReleaseSecrets({ GOOGLE_CLIENT_ID: "fake-client-id.apps.example", RESEND_API_KEY: "re_fake_key" }),
    ).toEqual({ GOOGLE_CLIENT_ID: "fake-client-id.apps.example", RESEND_API_KEY: "re_fake_key" });
    expect(() => buildReleaseSecrets({})).toThrow(MISSING_GOOGLE_CLIENT_ID);
    expect(() => buildReleaseSecrets({ GOOGLE_CLIENT_ID: "", RESEND_API_KEY: "re_fake_key" })).toThrow(
      MISSING_GOOGLE_CLIENT_ID,
    );
  });

  it("writes a 0600 JSON file without printing values and exits non-zero when the client id is empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-secrets-"));
    const script = new URL("../.github/scripts/write-release-secrets.mjs", import.meta.url);
    const file = path.join(dir, "release-worker-secrets.json");
    try {
      const stdout = execFileSync(process.execPath, [script.pathname, file], {
        env: { PATH: process.env.PATH, GOOGLE_CLIENT_ID: 'fake"client\nid', RESEND_API_KEY: "re_fake_key" },
        encoding: "utf8",
      });
      expect(stdout).toBe("");
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
        GOOGLE_CLIENT_ID: 'fake"client\nid',
        RESEND_API_KEY: "re_fake_key",
      });
      if (process.platform !== "win32") {
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      }

      const missing = path.join(dir, "missing.json");
      let failure;
      try {
        execFileSync(process.execPath, [script.pathname, missing], {
          env: { PATH: process.env.PATH, RESEND_API_KEY: "re_fake_key" },
          encoding: "utf8",
          stdio: "pipe",
        });
      } catch (error) {
        failure = error;
      }
      expect(failure?.status).toBe(1);
      expect(failure?.stderr).toContain(MISSING_GOOGLE_CLIENT_ID);
      expect(failure?.stderr).not.toContain("re_fake_key");
      expect(fs.existsSync(missing)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the key off preview and out of required Worker secrets", () => {
    expect(preview).not.toContain("RESEND_API_KEY");
    expect(wrangler).not.toContain("RESEND_API_KEY");
    expect(wrangler).toContain('"required": ["BETTER_AUTH_SECRET", "OPS_BOT_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]');
    expect(deployment).toContain("invites@jnok.co.nz");
    expect(deployment).toContain("restricted to `jnok.co.nz`");
    expect(deployment).toContain("Settings > Environments > production > Environment secrets");
    expect(deployment).toContain("wrangler deploy --secrets-file");
    expect(deployment).toContain("preview.yml");
    expect(deployment).toContain("EMAIL_FROM");
    expect(deployment).toContain("0007_contractor_portal_access.sql");
    expect(deployment).toContain("one-time copy link");
    expect(deployment).toContain('`MAIL_TRANSPORT` in `vars` stays `""`');
    expect(deployment).not.toContain("see #75");
    expect(deployment).toContain("GitHub Actions variable named `GOOGLE_CLIENT_ID`");
    expect(deployment).toContain("release-worker-secrets.json");
    expect(deployment).not.toContain("`GOOGLE_CLIENT_ID` as a Worker variable");
    expect(deployment).not.toContain("| `GOOGLE_CLIENT_ID` | Worker variable");
  });
});
