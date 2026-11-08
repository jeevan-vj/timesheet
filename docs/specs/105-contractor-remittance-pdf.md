# Contractor remittance PDF

## Goal

A signed-in contractor can open any previous approved week in mobile and explicitly preview, save, or share a remittance PDF for their own linked contractor record.

## Authorization contract

- Route: `GET /api/portal/payments/[week]/remittance/[business]`.
- The server derives the user from the authenticated session and resolves an active `contractor_account` joined to an `invited` or `active` contractor.
- The client never supplies a contractor id. `business` is only a selector among the session user's eligible links.
- Exactly one eligible link must match the business. Missing, ambiguous, inactive, suspended, archived, open-week, and reopened-week requests return non-disclosing `404 { error: "not_found" }`.
- A selected week must be Monday-start and approved for that owner/business. An approved empty week returns `400 { error: "no_entries" }`.
- Multiple businesses generate separate PDFs. Different remitters are never combined.

## Payroll and PDF contract

The route uses recorded `time_entry` rows only and the existing canonical `buildRemittanceModel` / `renderRemittancePdf` implementation. Pay is calculated per entry from integer `paid_minutes` and snapshotted `rate_cents`; a zero-minute absence remains a 0h/$0 line. Nothing is stored or mutated.

Success is `application/pdf` with attachment filename, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`. PDF bytes, contractor details, rates, and pay totals are never logged.

## Mobile contract

Approved week detail returns one `{ businessId, businessName }` remittance target for each approved business with entries. The Pay sheet shows one action per target. A repeated tap is disabled while the request is active. Loading and safe offline/server/share errors are announced without persisting response data.

The authenticated response is capped at 5 MiB, written only to `Paths.cache`, passed to the native share sheet as `application/pdf`, and deleted in `finally`, including after sharing fails. A contractor may explicitly save or share a copy from the system sheet.

`expo-file-system` and `expo-sharing` are native SDK 58 dependencies. This changes the runtime fingerprint and requires a new iOS build (and Android build when Android distribution is supported). No OTA, EAS build, store submission, deployment, or production-data write is part of implementation verification.

## Web contract

Expanded approved pay details offer one download link per server-returned remittance target. Links use the same contractor-scoped endpoint and browser session; no contractor id or owner route is exposed. Each business downloads separately, and the endpoint rechecks eligibility and approval on every request. The summary labels its actual headline week range, which may differ from approved payment history.
