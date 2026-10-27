---
name: auth-permissions
description: >-
  Session ownership from the server only; owner-scope every domain query;
  bearer OPS_BOT_TOKEN for /api/ops; invite/portal rate limits and races.
  Use for auth, invite, portal, ops, or membership changes.
---

# Auth and permissions

## When

Changes under `src/lib/auth*.ts`, `src/app/api/auth/`, `src/app/api/invitations/`,
`src/app/api/portal/`, `src/app/api/ops/`, `src/app/api/me/`, contractor
invitation services, or Better Auth / Expo session code.

## Hard rules

1. Derive identity from the **authenticated server session** (or ops bearer).
   Never trust a client-supplied `ownerId`, `contractorId`, or `businessId` for
   authorization. Portal routes ignore client `contractorId`.
2. Scope every domain query by owner (and active business where applicable).
   Cross-owner → `not_found`, not `403` with existence hints on invites.
3. `/api/ops/*` requires `Authorization: Bearer` matching `OPS_BOT_TOKEN`
   (constant-time). A session cookie is not enough. Do not log the token.
4. Invite preview/accept: keep rate limits; treat concurrent counter updates as
   races (retry-once then deny). Do not weaken limits to green tests.
5. `returnTo` after sign-in must be an exact allow-listed path (`/invite`,
   `/portal`, `/dashboard`). Reject absolute / protocol-relative URLs.
6. Never log emails, tokens, passwords, rates, notes, or request bodies.

## Steps

1. Read `SECURITY.md`, `docs/THREAT_MODEL.md`, and the sibling route you are
   extending.
2. Add or extend tests for: cross-owner isolation, unauthenticated 401,
   invite expired/revoked/unknown, ops without bearer, rate-limit denial.
3. Mark the PR high-risk; do not expect autonomous merge.

## Done when

Isolation and auth tests fail red before the fix and pass after; no new
logging of confidential fields.
