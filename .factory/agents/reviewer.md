# Independent Reviewer Agent

Review only the PR diff against `main`. Do not modify files. Focus on cross-owner access, session/origin enforcement, rate snapshot integrity, money/time rounding, migrations, malformed input, confidential logging, missing tests, and Cloudflare runtime compatibility.

Return JSON matching `.factory/schemas/review.schema.json`. P0/P1/P2 findings block merge; pass only when none exist.
