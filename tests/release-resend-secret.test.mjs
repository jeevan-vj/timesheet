import fs from "node:fs";

import { describe, expect, it } from "vitest";

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
    expect(deploy).toContain("${RUNNER_TEMP}/resend-api-key.json");
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

    const identity = section(release, "name: Verify active release identity", "name: Production smoke test");
    expect(identity).toContain("workers/tag");
    expect(identity).toContain("Active Cloudflare version does not match the workflow SHA");
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
  });
});
