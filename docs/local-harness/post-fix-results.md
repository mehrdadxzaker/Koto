# Six-case comparison after the integration fixes — October 20, 2026

**Baseline: 4/6 successful repairs. Adapted: 3/6. No coding-quality improvement from the optional Qwen guidance was observed.**

All twelve episodes saved changed implementations and completed their native turns normally. The two diagnosed integration failures were resolved. Five episodes still failed independent correctness checks. Automatic coding remains disabled.

| Case | Baseline | Adapted | Baseline time | Adapted time |
| --- | --- | --- | --- | --- |
| signed-ceiling | Pass | Pass | 42.4 s | 46.1 s |
| literal-first | Pass | Pass | 22.1 s | 22.1 s |
| adjacent-groups | Pass | Fail | 25.4 s | 41.6 s |
| interval-union | Pass | Pass | 61.1 s | 39.1 s |
| atomic-stock | Fail | Fail | 29.9 s | 44.8 s |
| stable-key-unique | Fail | Fail | 26.5 s | 26.4 s |

## What the failures show

- Both arms failed `atomic-stock`: the saved code deducted quantities without validating sufficient total stock for repeated items or making failure atomic. The independent checker rejected an invalid batch.
- Both arms failed `stable-key-unique`: the saved code used a set, producing `TypeError` for list-valued keys, despite the specified support for unhashable values.
- Adapted `adjacent-groups` saved `for value in values[1():`, causing a syntax error. It tried `python` and then `which python`, both unavailable, and ended without trying `python3` or repairing the syntax. The adapted stock episode made the same interpreter-name mistake.
- All failures had a normal native `turn.completed`. There were no probe-admission rejections, stream failures, or episode timeouts in this rerun. Four failed shell commands occurred in the adapted arm; none in baseline. These counts do not establish broader reliability.

## Controls and interpretation

Both arms contain the [native editing and probe-continuation fixes](integration-fixes.md). The treatment remains only the optional subordinate Qwen coding guidance and lossless compact argument replay. Stock Codex owns tools, execution, approvals and the conversation.

The six task specifications, source fixtures, independent checks and client/runtime/model hashes match the [original failed study](results.md). The fixed candidate is Koto 2.0.0a8, stock Codex 0.160.0, llama.cpp b11617 and the installed Qwen3-14B-Q4_K_M. The rerun used its installed wheel, verified byte-identical to 171 source package files.

One episode per case and arm was frozen before inference. The runner used the same counterbalanced blocks (baseline first three, adapted six, baseline last three), serial inference, at most 16 requests and 90 seconds per episode, and 2,048 output tokens per request. No quality retry, prompt/sampling adjustment, model download or cloud execution occurred within the study. Earlier diagnostic single-case runs preceded this freeze and are described separately.

Raw native profiles matched across arms for every pair. All independent checks remained unchanged. All three connection lifetimes restored disposable settings and closed their owned listeners. Normal Codex settings were unchanged. No qualification was installed.

Median episode duration was 28.189 seconds for baseline and 40.374 seconds for adapted. Episode timing includes host work. Six stochastic samples per arm, fixed block order and cache/machine effects limit latency and quality conclusions. These results support keeping the optional guidance experimental; they do not establish an advantage over the corrected baseline or general coding qualification.

## Evidence

- [Full outcomes and cleanup](post-fix/comparison.json)
- [Frozen plan, cases and source/asset identities](post-fix/frozen-plan.json)
- [Native traces and generated-source hashes](post-fix/trace-manifest.json)
- [Candidate and validation metadata](post-fix/validation.json)

Candidate wheel SHA-256: `f0c939e66cc3f3bfc57778e0316269e85be7c41b1d9df6a32159f24edb26b5e1`.
Frozen plan SHA-256: `45f708523018ba5585658d14cd277999a6d559d7a5b63cb512124a30e64b00e6`.

Complete raw native JSONL, request captures, stderr and workspace snapshots remain in the local `koto-local-harness-comparison-20261020-fixed` directory. Published trace JSON preserves native events and saved source; the manifest binds each to its original raw JSONL and source hashes. Credentials and runtime-control files are excluded.

Final package validation passed **55 fast and 582 workflow tests (637 total)** against the same installed candidate wheel outside the source checkout. The initial full attempt failed an unchanged native-cleanup timing test; it passed in isolation and in the fresh full run. Both attempts are disclosed in the validation metadata. All 171 packaged source files still match the final runtime source.
