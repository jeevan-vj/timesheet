# Contractor web remittance verification

Base: origin/main 61c6aec. Primary checkout was behind upstream; merged portal/approval fixes must not be duplicated.

Extend the existing `portalPaymentDetailSchema.remittances` rendering in `src/components/portal-home.tsx` with per-business download links to the existing `GET /api/portal/payments/[week]/remittance/[business]` endpoint. Extract the small link list into a component so actual rendered HTML can be tested without auth/runtime mocks.

Acceptance:
- Label the summary with its actual week range; it represents the requested current week, not necessarily the latest approved week.
- Each server-authorized remittance target offers its own PDF download; no combined-business document or client contractor id.
- No target means no download action; URL segments and displayed business names are safely encoded.
- Verify owner invitation acceptance, assigned work, pending-work approval rejection, resolved approval, contractor pay details and PDF on a fresh current build with screenshots.
- Retain endpoint tests for unauthenticated, unlinked, unapproved and ineligible access.
- Package repository web/native verification skills, with native execution excluded from this request.

Non-goals: iOS/Android builds, native changes, new endpoints, payroll formulas, schema/migrations, factory controls, deployment and merge.

## Authorized Factory readiness repair

After two hosted runs timed out at `networkidle` despite successful signup and
visible dashboard content, the user explicitly authorized editing the protected
Factory harness. Extend `.factory/e2e/harness.mjs` using the existing authenticated
readiness pattern in `.cursor/skills/verify-cleantrack/scripts/drive.mjs`.

Acceptance: all three existing scenarios and 30-second UI deadlines remain;
new-owner headings and authenticated `business: null` API state are required;
missing headings, failed API responses, and unexpected business state fail;
local real-browser harness, focused regression tests, and `pnpm verify` pass.
No auth, payroll, migration, workflow-permission, or iOS changes. Protected-path
human merge review remains required.

The evidence consumer additionally requires no forbidden business-settings reads
before onboarding. Guard `LoadedWeek`'s `PayRulesSettings` using `data.business`,
as already done for `OwnerAssistantWhenReady`; prove with clean browser network
and console artifacts plus the unchanged Factory evidence consumer.
