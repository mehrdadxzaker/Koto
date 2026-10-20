# Qwen v1 versus v3 comparison — October 20, 2026

**V1: 5/6 successful repairs. V3: 4/6. Coding-quality improvement was not established.** V3 repaired uniqueness but failed grouping and stock rollback. Its conditional patch-recovery advice had no observed triggering native patch rejection in this study, so the uniqueness success does not demonstrate recovery from that failure.

| Case | V1 | V3 | V1 time | V3 time |
| --- | --- | --- | --- | --- |
| signed-ceiling | Pass | Pass | 43.6 s | 53.9 s |
| literal-first | Pass | Pass | 33.1 s | 30.4 s |
| adjacent-groups | Pass | Fail | 30.8 s | 127.4 s |
| interval-union | Pass | Pass | 63.9 s | 45.3 s |
| atomic-stock | Fail | Fail | 30.8 s | 180.0 s |
| stable-key-unique | Pass | Pass | 34.0 s | 43.5 s |

## Failures and verification

V3 grouping received four accepted native patches but ultimately restored the original implementation. Its final Python command printed one unsplit run instead of asserting the expected groups. The turn completed normally after 11 requests, but the unchanged implementation failed the independent oracle.

Both stock implementations validated and deducted each request immediately. A later overdraw raised `ValueError` after an earlier deduction; the independent rollback-state assertion failed. V3 attempted the same malformed quoted `python3 -c` test twice. Both failed in shell parsing before Python assertions could execute. Its stream ended at the 180-second deadline with client exit 1 and no `turn.completed`.

The independent sandbox replay matched **all twelve recorded checker exit codes**: nine passes and three failures. All twelve episodes received accepted native edits, totaling 15 patch events; eleven final implementations differed from their initial fixtures, and eleven turns completed normally. No model-authored assertion command executed successfully. Assertion text in an unexecuted payload and a successful print command receive no verification credit.

The independent minimal rollback probe failed both stock outputs. The narrow single-record list-key probe and the complete unchanged uniqueness oracle passed both uniqueness outputs. These audit checks establish saved-code behavior; they are not model-authored verification.

## What the recovery mechanism proves

V3 adds conditional advice for correlated native patch range-header failures. The [scripted native replay](v3-comparison-20261020/diagnosis/native-recovery-diagnosis-receipt.json) and [transport regression](v3-comparison-20261020/diagnosis/transport-regression.json) demonstrate feedback preservation, advice activation after a rejection, and removal after success, without model inference. The transport regression also retained 24 unchanged v1/v2 transformations.

The retained zero-inference feedback loop can be rerun with a fresh output directory:

```sh
PYTHONPATH=/absolute/path/to/installed-candidate \
python docs/local-harness/v3-comparison-20261020/diagnosis/replay_patch_feedback.py \
  --client /absolute/path/to/codex-0.160.0 --output /new/absolute/output
```

It made three scripted native requests, observed the rejected header and successful
plain-header edit, preserved the error verbatim, and left normal settings unchanged.
It tests the host/transport seam and makes zero model inference submissions.

No real-model episode in this V3 comparison reported a rejected native patch. Grouping's four patches succeeded as tool operations; stock's failures were shell quoting errors. Consequently, these outcomes do not test whether a model benefits from the adaptive recovery branch. Scripted mechanics and autonomous coding quality remain separate evidence.

## Controls and limits

Both arms used the unchanged six specifications, initial fixtures and checkers, installed Qwen3-14B-Q4_K_M, stock Codex 0.160.0 and llama.cpp b11617. Actual native instruction/tool profiles matched for every pair. All 154 frozen source/runtime artifact hashes and four physical asset hashes were independently verified before the checker replay.

Each arm received 180 seconds, 16 requests and 2,048 output tokens per request through explicit development probe v5. Execution was serial, with one frozen generation per task/arm and no quality retry. Prior pilots and tuning used these known tasks. This study must remain separate from earlier 90-second evidence and establishes neither general superiority nor qualification.

All three lifetimes reported restored disposable settings and closed owned listeners. Disposable settings were independently read back; the runner reported normal settings unchanged. Automatic coding remained disabled.

Candidate: source `5627b24d3740d18c8118c4c296d9c63d0f069b2c`, runtime `2.0.0a15`; wheel SHA-256 `5d70e0089373a41cd1dbcf290eba1d063ef68a586cb9baabdf7ea2f32d78bc35`.

The full installed wheel passed **73 fast and 595 workflow tests (668 total)** outside the source checkout. All 171 packaged files matched source and the private installation byte-for-byte. See the [validation receipt](v3-comparison-20261020/validation.json). Earlier fixture and intermittent cleanup failures remain disclosed in the [v2 validation history](v2-comparison-20261020/validation.json). Passing runtime regressions does not establish coding quality.

See the [comparison](v3-comparison-20261020/comparison.json), [frozen plan](v3-comparison-20261020/frozen-plan.json), [manifest](v3-comparison-20261020/manifest.json), [independent audit](v3-comparison-20261020/independent-audit.json), [prior v2 study](v2-comparison-20261020.md) and [development diagnostics](v2-development-diagnosis-20261020.md).
