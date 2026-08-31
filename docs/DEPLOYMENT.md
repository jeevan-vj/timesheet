# Deployment

1. Create D1 databases for staging and production.
2. Replace the placeholder D1 database ID in `wrangler.jsonc` or configure environment-specific bindings.
3. Set `BETTER_AUTH_URL` to the exact HTTPS origin.
4. Add `BETTER_AUTH_SECRET` with `wrangler secret put BETTER_AUTH_SECRET`; never place it in `vars`.
5. Add any additional origins to `AUTH_TRUSTED_ORIGINS` only when required.
6. Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, and `pnpm build`.
7. Apply migrations with `pnpm wrangler d1 migrations apply cleantrack-timesheet --remote`.
8. Deploy with `pnpm run deploy` and verify sign-up/sign-in, owner isolation, mutation origin checks, a rate override, and a weekly total.

For GitHub Actions, store `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `BETTER_AUTH_SECRET` in the protected production environment. Keep `AUTONOMOUS_PRODUCTION=false` until staging, backups, and rollback have been exercised.
