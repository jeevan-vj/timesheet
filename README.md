# CleanTrack

Contractor hours and weekly pay tracking for multi-site cleaning teams.

## Stack

- Next-compatible App Router via vinext
- React 19
- Cloudflare Workers + D1
- Drizzle ORM
- Better Auth
- Zod
- Vitest

## Local development

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

Then create the first owner account at `/sign-up` and open `/dashboard`.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm build
```

See [SPEC.md](SPEC.md), [SECURITY.md](SECURITY.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and [.factory/SETUP.md](.factory/SETUP.md).
