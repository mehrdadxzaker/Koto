# ADR 0031: Center Koto on personal model selection

- Status: Accepted by product owner for implementation
- Date: 2026-10-18

Koto is a local multiclass classifier selecting a model for each eligible fresh
prompt using scorecards built from the user's checked historical work. Its first
pool is the client's current commercial model plus qualified local candidates.
The owner selected bounded local evaluation, with separate opt-in budgeting for
any additional commercial evaluation.

The accepted flow and implementation contract are in
[personal model selection](../PERSONAL_MODEL_SELECTION.md). This replaces the
separate LLM binary advice path from ADR 0024 and makes manual benchmark ranking
from ADR 0029 advanced tooling. It refines ADR 0018's product scope around the
history/scorecard/selection loop; it preserves the client-owned agent loop,
policy, local-only, credential separation and continuation affinity.

Learning has its own consent; existing history consent is not training consent.
Historical failures and original scorecards are retained. Qualification remains
required for each admitted local capability. The change implements no further
candidate trial, real-history collection, commercial call or live setting edit.
