# Mobile owner remittance verification

Synthetic owner and contractor data only. `tests/mobile-owner-remittance.browser.mjs` renders the real remittance sheet and request parser with React Native Web adapters, then verifies both remittance lines, the canonical total, the disclaimer, and Close behavior.

- `owner-remittance.png`: top of the in-app sheet.
- `owner-remittance-actions.png`: complete totals, disclaimer, and reachable Close action.

This is deterministic browser evidence. It does not prove authenticated iOS/Android device behavior or a deployed Worker response. No production endpoint, account, contractor record, or pay data was used.
