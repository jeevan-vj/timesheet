# Issue 138 — optional pay rules and fixed-price shifts

## Scope

Owners may optionally configure public-holiday, weekend, and overnight loadings, add business-specific holiday dates, and set fixed prices on assignments or individual shifts. Missing settings and all-off settings preserve the existing hourly result exactly. This is a gross contractor-pay tool, not an employment-law or tax determination.

## Data model

`business_pay_rule` is one row per business. A missing row means holiday mode off, NZ calendar off, no weekend multiplier, and no overnight window. Multipliers are integer basis points of 1.0x: `10000` is 1.0x and `15000` is 1.5x. Overnight boundaries are integer minutes after local midnight.

`business_holiday` stores owner-scoped ISO dates and display names, unique by business and date. The holiday set for a shift is the union of these dates and the built-in NZ calendar when enabled.

`assignment.pay_mode` and `assignment.fixed_pay_cents` provide defaults for new shifts. `time_entry` snapshots `pay_mode`, `fixed_pay_cents`, and each loading component. `time_entry.rate_cents` remains required and keeps its existing historical-rate meaning even for fixed shifts.

Migration `0011_pay_rules.sql` is additive and forward-only. Existing assignments and entries become hourly. Existing loading snapshots are zero, and historical `paid_minutes` and `rate_cents` are not rewritten.

## Rule order and rounding

For a positive-minute entry:

1. A valid fixed shift bypasses hourly math and every loading. Base is zero and total is `fixed_pay_cents`.
2. Hourly base calls the unchanged `calculateEntryPayCents(paidMinutes, rateCents)` function.
3. A matching holiday applies `round(base × (holiday bps - 10000) / 10000)`. Holiday suppresses weekend loading.
4. Otherwise, an enabled Saturday or Sunday rule applies the same formula to base.
5. Overnight loading is additive. Its base uses `calculateEntryPayCents` for the paid minutes overlapping the configured same-calendar-date window. A wrapping window such as 22:00–06:00 can count 22:00–24:00 for a late shift or 00:00–06:00 for an early shift; shifts still cannot span midnight. Paid-hours entries have no clock position and therefore receive no overnight loading.
6. Total is base plus the independently rounded loading components.

Zero-minute absence rows pay zero, including when the underlying shift has a fixed snapshot. When every rule is off and the shift is hourly, total uses the original base function as the only pay path.

## NZ calendar

`nzPublicHolidayDates` deterministically covers 2024–2030. It includes Good Friday, Easter Monday, the first Monday in June, the fourth Monday in October, and the gazetted Matariki dates for that range. Waitangi Day and ANZAC Day keep both the gazetted date and a Monday observation when the date is Saturday or Sunday. New Year/Day after New Year and Christmas/Boxing Day keep both gazetted dates and use Monday/Tuesday transfer rules where needed.

## Authorization and snapshots

Pay-rule and holiday endpoints require an authenticated active owner membership. Missing sessions return `401 unauthorized`; authenticated users without an active owner membership return `403 forbidden`. Business and owner identifiers come only from the session membership. Holiday deletes include both owner and business predicates.

Creating an entry resolves the current assignment and rate, defaults fixed pay from that assignment when the request omits pay fields, computes current rules, and stores the components. Updating an unlocked entry recomputes the loading snapshot. Changing settings never rewrites entries. Approved weeks remain locked.

## Remittance

The canonical remittance line exposes `baseCents`, `holidayLoadingCents`, `weekendLoadingCents`, `overnightLoadingCents`, `fixedCents`, and `payCents`. Components sum to `payCents`, and line totals sum to the remittance total. Web, PDF, and mobile show Base, Public holiday loading, Weekend loading, Overnight loading, and Fixed only when a shift has an extra or fixed component. An ordinary hourly remittance keeps its previous visual form.
