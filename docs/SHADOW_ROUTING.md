# Historical binary shadow routing

The binary LLM classifier and its `shadow_router` / `--shadow-router` activation
path are retired. Use the single [personal model selector](PERSONAL_MODEL_SELECTION.md)
in observation mode. Historical shadow and setup receipts remain readable;
the retained experiment below is unchanged negative evidence.

## Pinned experiment: 2026-10-15

The installed runtime at `8c0d6a0` was evaluated once with Codex CLI 0.147.0
(Darwin arm64), llama.cpp b11617 and the verified Qwen3-4B-Q4_K_M files. The
same model served as classifier and coding target. The independent checks
rejected every broken baseline and accepted every known correct reference
before the cases were frozen. Each native episode had a 90-second deadline
and no quality retry.

| Coding repair | Shadow advice | Independent check | Native exit | Classifier time |
| --- | --- | --- | --- | --- |
| Signed ceiling division | local | failed | 0 | 478 ms |
| Quoted CSV parsing | local | failed | 0 | 474 ms |
| Atomic, idempotent transfers | local | failed | 0 | 537 ms |

The result was **zero passing repairs and three false-local recommendations**.
All implementation files remained unchanged: the first two episodes searched
for incorrect filenames, and the third described intended changes without
executing tools. A normal client exit established neither a repair nor success.
There were no missing recommendations, unknown recommendations, timed-out
episodes or omitted cases. No cloud comparison was performed.

All 16 actual coding requests used the pinned local model. The 13 observed
continuations preserved affinity; the final case had no continuation. Disconnect
restored configuration and stopped the owned engine. The source and installed
wheel each passed 147 workflow tests with no skips. These workflow results
establish guards and integration behavior; the failed repair checks establish
only the observed coding outcomes of this small experiment.

Keep this classifier **shadow-only**. This run supplies no evidence for promoting
its recommendations into execution decisions. The content-free
[evaluation receipt](shadow-routing-evaluation-20261015.json) records pins,
fixture and private evidence digests, latency, coverage, outcomes and cleanup.

Linux CI subsequently exposed a deadline-reporting difference: the owned
watchdog's socket shutdown could surface as a disconnect. Transport now reports
that interruption as a timeout when its own deadline marker is set, including
reads interrupted after headers. The frozen coding outcomes above remain tied
to runtime `8c0d6a0`; no quality episode was repeated for this portability fix.
