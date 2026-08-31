# Security Policy

## Data boundary

Contractor identity, contact details, rates, hours, notes, and pay totals are confidential business data.

Non-negotiable rules:

1. Every domain read and write requires a valid server-side session.
2. `owner_user_id` is derived only from that session, never from request JSON or query parameters.
3. Every referenced site, contractor, assignment, and time entry is filtered by the same owner.
4. Do not log request bodies, contact details, rates, notes, session tokens, passwords, or authentication URLs.
5. Store currency as integer cents and time as integer minutes; never persist calculated floating-point hours.
6. Snapshot the effective rate on each time entry to protect historical totals.
7. Validate all untrusted input at the API boundary and return non-disclosing errors.
8. Cookie-authenticated mutations must enforce trusted-origin checks.
9. Do not weaken authentication, authorization, validation, migrations, headers, or tests to make a change pass.
10. `AGENTS.md`, `.github/**`, and `.factory/**` are protected control-plane code and require human merge approval.

## Secrets

Never commit `BETTER_AUTH_SECRET`, mail credentials, Cloudflare credentials, D1 production identifiers, Cursor keys, personal tokens, or `.dev.vars`.

## Reporting

Report suspected vulnerabilities privately to the repository owner. Do not include real contractor data in an issue or test fixture.
