# Security Policy

## Data boundary

Contractor identity, contact details, engagement notes, GST numbers, emergency contacts, rates, hours, notes, and pay totals are confidential business data.

Non-negotiable rules:

1. Every domain read and write requires a valid server-side session.
2. `owner_user_id` and `business_id` are derived only from that session and its active owner membership, never from request JSON or query parameters.
3. Every referenced site, contractor, assignment, assignment_schedule_version, time entry, and week_approval is filtered by the same owner and the same business.
4. Do not log request bodies, business profile fields, contact details, rates, notes, session tokens, passwords, or authentication URLs.
5. Store currency as integer cents and time as integer minutes; never persist calculated floating-point hours.
6. Snapshot the effective rate on each time entry to protect historical totals.
7. Validate all untrusted input at the API boundary and return non-disclosing errors. Contractor create/patch field messages are canned and do not disclose whether another owner's contractor exists.
8. Cookie-authenticated mutations must enforce trusted-origin checks.
9. Do not weaken authentication, authorization, validation, migrations, headers, or tests to make a change pass.
10. `AGENTS.md`, `.github/**`, and `.factory/**` are protected control-plane code and require human merge approval.
11. Weekly remittance PDFs are owner-only downloads of pay data. Serve them `Cache-Control: no-store`. Cross-owner contractor ids return identical `404 { error: "not_found" }`. Do not log PDF bytes, contractor details, rates, notes, or pay totals.
12. Unexpected JSON API failures return `500` with `{"error":"internal_error","correlationId":"<uuid>"}`. The correlation id is generated on the server. The log is one JSON object: route, method, correlation id, safe name, message, stack, and release. Query failures are logged as `query_failed` without SQL or bound values. Optional `SENTRY_DSN` is a Worker secret; capture is off when it is unset; the same scrub applies before send. Never log request bodies, business profile fields, contractor details, rates, notes, pay totals, cookies, tokens, or secrets.
13. Contractor invitation tokens are stored as SHA-256 hex only and travel in the URL fragment, never the path or query. Do not log tokens, invite links, recipient addresses, or the Resend API key. Provisioning that optional Worker secret is described in `docs/DEPLOYMENT.md`. A missing key does not fail deploy and falls back to a one-time copy link. `EMAIL_FROM` is the non-secret sender `CleanTrack <invites@jnok.co.nz>`. Operational email events may include only `event`, `kind`, and `httpStatus`.

## Secrets

Never commit `BETTER_AUTH_SECRET`, `OPS_BOT_TOKEN`, mail credentials, Cloudflare credentials, D1 production identifiers, Cursor keys, personal tokens, or `.dev.vars`.

`OPS_BOT_TOKEN` authenticates `/api/ops/*` only. Compare it with a constant-time digest check. Do not accept a session cookie on those routes. Do not log the token, confirm tokens, SQL text, or bound parameters. Optional Cloudflare Access in front of `/api/ops` is defense in depth and does not replace the bearer token. Domain ops reads and writes still filter by the requested owner and that owner's active business. Raw SQL is an operator-scoped exception: one `SELECT` or a confirmed `INSERT`/`UPDATE`, never `DELETE` or DDL, never a write to `ops_audit`, and never an assignment to `contractor.active`. Named contractor responses omit GST number, internal notes, and emergency contact.

## Reporting

Report suspected vulnerabilities privately to the repository owner. Do not include real contractor data in an issue or test fixture.
