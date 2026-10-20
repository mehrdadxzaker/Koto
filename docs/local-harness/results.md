# Qwen request-adapter comparison — October 19, 2026

This is the historical pre-fix study. See the [post-fix six-case rerun](post-fix-results.md)
for the current result and [integration diagnosis](integration-fixes.md) for the two Koto failures.

**No improvement in coding success was observed: baseline 0/6; adapted 0/6.** Neither arm saved a changed implementation. The adapter remains an opt-in experiment and does not qualify automatic coding.

Tested stock Codex CLI 0.160.0, llama.cpp b11617 and the installed Qwen3-14B-Q4_K_M model through the built Koto 2.0.0a8 wheel. This macOS comparison retained Codex’s native base instructions and shell tools. The only treatment was the explicit qwen_code_v1 request adapter: subordinate coding guidance and lossless compact argument replay.

| Case | Baseline success | Adapted success | Baseline episode | Adapted episode |
| --- | --- | --- | --- | --- |
| signed-ceiling | Fail | Fail | 90.0 s | 90.0 s |
| literal-first | Fail | Fail | 90.0 s | 22.3 s |
| adjacent-groups | Fail | Fail | 26.3 s | 32.9 s |
| interval-union | Fail | Fail | 54.4 s | 90.0 s |
| atomic-stock | Fail | Fail | 90.0 s | 90.0 s |
| stable-key-unique | Fail | Fail | 90.0 s | 60.2 s |

Baseline median episode duration: 90.0 s; adapted: 75.1 s. Recorded failed shell commands: 17 baseline, 3 adapted. These are descriptive counts, not evidence of useful coding improvement: faster abandonment or fewer commands without an edit is still failure. Durations include native host/tool work and are not provider-only latency.

## What happened

Several adapted episodes read the source, correctly described the defect and ended with “I’ll implement…” without editing the file. Others repeated commands or exhausted the bounded stream/episode budget. Completion, saved changes and independent checks were assessed separately; a normal final answer was not counted as a repair.

All twelve independent post-checks failed against unchanged implementations. Every initial implementation failed an assertion, and all six independent check sets also accepted separate correct reference implementations. The reference implementations were never supplied to the model.

## Controls and limits

- Six paired tasks, one final-study episode per arm, serial inference, at most 16 submissions and 90 seconds per episode, and 2,048 output tokens per request. No model download, cloud execution, outcome retry or treatment tuning in the final study.
- Cases, checks, candidate source and client/runtime/model identities were frozen before inference. All frozen artifacts remained unchanged. Raw native instruction/tool profiles matched between arms for every pair.
- Counterbalanced blocks: baseline first three, adapted six, baseline last three. Each episode reset the complete workspace, and finished workspaces and diagnostics were retained.
- All three connection lifetimes restored their disposable settings and closed their owned listeners. Normal Codex settings were unchanged. No retained-history consent or automatic coding permission was enabled.
- The complete result is a small negative exploratory study, not a qualification campaign or general conclusion about other Qwen models, full Open Interpreter harnesses, or Codex desktop activation. The tested subset does not reproduce Open Interpreter’s tool surface or agent engine.

## Earlier attempts

Two retained infrastructure attempts made zero model submissions. The first inherited desktop process settings and left an extra trust entry only in its disposable home; the second established that unsupported “Repair …” task wording was refused by the existing bounded classifier. Zero-inference diagnostics confirmed stable request profiles and input hashes. Prompts were restated as “Fix the Python function …” without changing the admission gate.

A separate pilot was interrupted after independent review found incomplete workspace reset and missing checker-failure retention. It retains two completed failed baseline episodes and an interrupted third; no adapted pilot episode ran. The final comparison was frozen again after those infrastructure fixes. Adapter guidance and model/sampling settings were not tuned from the pilot. The unique-record initial implementation was corrected to fail an assertion rather than an unhashable-key runtime error before final inference.

## Evidence

- [Full outcomes and cleanup](comparison.json)
- [Frozen cases, pins and candidate source hashes](frozen-plan.json)
- [Independent reference sanity checks](oracle-reference-sanity.json)
- [Separate Standards and Spec reviews](review.md)
- Complete native JSONL, stderr, request captures and workspace snapshots remain in the local koto-local-harness-comparison-20261019-final directory beside the source checkout. Earlier attempt and pilot directories are retained separately.

Candidate wheel SHA-256: 7aeffefae4ddec5d7ac3b3edf7cd28db47a20906a9ad113563956110584ce357.
Frozen plan SHA-256: 9c649420671f4530507039bb5029e67c8deffa6c6910096aa12a9f93a9b83501.

Local package validation passed: **38 fast tests and 572 workflow tests**, run against the installed wheel outside the source checkout. Source-scope and version checks passed; every packaged runtime/configuration file is byte-identical to the final source. See [validation metadata](validation.json). An earlier concurrent run hit an unchanged native-cleanup timing test; that test passed in isolation and in the fresh complete run without model contention. GitHub CI has not been claimed.
