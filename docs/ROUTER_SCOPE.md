# Personal model selection scope

Product owner decision: October 18, 2026. [ADR 0031](decisions/0031-personal-model-selection.md)
refines the existing customer-local router architecture and supersedes its
local-only ranking and separate binary classifier as the product focus.

**Koto adds local models to the pool alongside the commercial model already in
use, and learns from the user's checked historical work which model to choose.**
The first pool contains the client's selected commercial model and qualified
local alternatives. Other commercial providers and clients require their own
compatible, authorized adapters.

One loop governs the product: **history → scorecard → classifier → model
execution → observed outcome**. The public verification workflow remains
**connect → coding-client request → inspect result/status → disconnect**.

## Keep and simplify

| Keep | Remove from the active product path |
| --- | --- |
| Opt-in encrypted history and checked task outcomes | Mandatory hand-authored benchmark suites |
| One local multiclass selector with observation and validated automatic modes | Separate binary LLM routing calls |
| Current commercial baseline plus qualified local candidates | An unrestricted cross-provider commercial marketplace |
| Policy, credential isolation, local-only and continuation affinity | A second agent loop or standalone coding/chat app |
| Minimal CLI/plugin setup, status and restoration | Hosted accounts, billing, enterprise front doors and native shells |
| Bounded local evaluations and retained failure evidence | Repeated candidate trials without a declared product acceptance purpose |

Manual benchmarks remain an advanced interface. Historical contracts, frozen
campaigns, failed trials and their independent checkers remain recoverable and
are not rewritten as successful qualifications.

## Active implementation order

1. Connect separately consented history to automatically derived personal
   scorecards, preserving failed and unknown outcomes.
2. Use checked examples to classify fresh requests into model choices locally.
   Keep the current commercial baseline when evidence is insufficient.
3. Validate held-out quality and measurable latency benefit before activation.
   Selection never supplies missing coding qualification or cloud permission.
4. Prove the supported client workflow: real tool execution, streaming,
   continuation affinity, cancellation and settings restoration. Acquisition and
   compatibility work must directly support admitting a model into this pool.
5. Qualify representative real user workloads and the documented provider/client
   path before release claims. Routine synthetic tests establish behavior only.

The active backlog and acceptance are in [personal model selection](PERSONAL_MODEL_SELECTION.md).
Further real-model candidate trials are paused during this realignment.
External resource cleanup remains the separate [operations track](OPERATIONS_CLEANUP.md).
Existing releases, user data, live accounts, financial records and Codex settings
are preserved. Earlier retired source remains recoverable from Git commit
`8489d9d3a467442dca4b91d196928e325dd01a18`.
