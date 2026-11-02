# Owner assistant — web and mobile

## Goal

Let an authenticated owner use natural language to create a contractor, create a site, assign a contractor to a site, and retrieve a verified weekly remittance without navigating the corresponding forms.

## Acceptance criteria

1. Web and mobile expose the same bounded conversation protocol and four-state UI: welcome/empty, checking, safe error, and result.
2. Workers AI can return only clarify, create-contractor, create-site, assign-site, or get-remittance intents. Invalid output fails closed.
3. All domain ownership comes from the server session. AI and clients cannot supply it.
4. A write shows exact resolved fields and requires an explicit confirm. The signed token expires after five minutes, is owner-bound, and can be consumed once.
5. Confirmed writes call existing domain services and preserve duplicate, owner scope, and historical-rate behavior.
6. Remittance uses canonical snapshotted entry math. It declares verified, provisional, or incomplete with a reason and includes line and total data.
7. Unsupported operations do not run. Chat and pay data are not logged or durably stored.
8. Automated contracts, authorization, confirmation, migration, and payroll tests pass; browser proof covers web and mobile using synthetic records.

## Non-goals

Time-entry changes, week approval/reopen, contractor self-service AI, autonomous execution, durable conversation memory, tax advice, bank payment, and production deployment are excluded.

## Deployment

Apply `0010_owner_assistant_confirmation.sql` before deploying the Worker. The Worker needs the configured `AI` binding. No new secret or mobile native dependency is required.
