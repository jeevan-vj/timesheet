---
name: nz-timesheet-domain
description: >-
  CleanTrack domain invariants: integer cents and minutes, snapshotted rates,
  Monday weeks in Pacific/Auckland, NZD, GST metadata-only, no historical
  rewrite. Use for payroll, remittance, week approval, schedules, or engagement.
---

# NZ timesheet domain rules

## When

Any change to pay, duration, rates, week approval, remittance PDF, recurring
schedules, contractor engagement, or business profile.

## Invariants (from SPEC.md / SECURITY.md)

1. **Money:** integer cents. **Time:** integer minutes. Floating-point hours are
   display-only.
2. **Entry pay:** `calculateEntryPayCents` in `packages/core` —
   `round(paid_minutes × rate_cents / 60)`. Weekly pay sums entry pay.
   Call it only when `paid_minutes > 0`; 0-minute absences add 0¢.
3. **Snapshots:** effective rate is copied onto each new `time_entry`. Changing
   contractor or assignment rates never rewrites historical `rate_cents`.
4. **Week:** Monday start, business timezone `Pacific/Auckland`, currency
   `NZD`. Approval is compare-and-set on expected minutes/cents (`stale_week`
   on mismatch). Approval stores status/timestamps only — not a second pay
   snapshot.
5. **GST / NZBN:** metadata only (GST number 8–9 digits when set; NZBN blank or
   13 digits). They must not change entry pay, week totals, or remittance.
6. **Remittance PDF:** gross contractor pay only (before tax, GST, expenses).
   Generated on read from entries; empty week → `no_entries`.
7. **Engagement:** `engagement_status` is source of truth; `active` flag stays
   aligned (`invited`/`active` schedulable). Do not schedule `draft` /
   `suspended` / `archived`.
8. **Confidentiality:** never log contractor details, rates, notes, GST,
   emergency contacts, tokens, or passwords.

## Steps

1. Put behavior in a test when it is pay, authorization, or a new derivation.
2. Site rollups must call `calculateEntryPayCents` on snapshotted rates and sum
   to the contractor total.
3. Prefer extending `packages/core` over re-implementing math in UI or mobile.

## Done when

Tests lock the invariant, and the PR security/payroll section states impact.
