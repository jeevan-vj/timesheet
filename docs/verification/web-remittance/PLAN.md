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
