# Mobile owner status and remittance verification

Synthetic owner and contractor data only.

- `tests/mobile-owner-sheet.browser.mjs` renders the committed owner shift sheet, verifies the destructive confirmation, duplicate-tap protection, locked-week behavior, custom-hours guard, reset confirmation, and request bodies.
- `absence-confirmation.png` shows the explicit zero-pay confirmation before marking a shift as not worked.
- `reset-confirmation.png` shows the explicit scheduled-hours restoration confirmation.
- Remittance screenshots and checks remain under `docs/verification/mobile-remittance/`.

This is deterministic browser evidence through React Native Web adapters. It does not prove an authenticated iOS/Android device, a deployed Worker, a production migration, OTA delivery, or store release. No production endpoint or real contractor/pay data was used.
