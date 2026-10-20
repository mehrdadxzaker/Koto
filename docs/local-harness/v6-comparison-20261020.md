# Qwen v3 versus v6 comparison — October 20, 2026

**V3 passed 4/6 repairs; v6 passed 2/6. V6 did not improve coding performance.**
Grouping passed in both arms. Rollback and list-valued uniqueness keys remained
broken in both arms.

| Measure | V3 | V6 |
| --- | --- | --- |
| Saved code passes unchanged independent checker | 4/6 | 3/6 |
| Native turn completes normally with client exit 0 | 6/6 | 2/6 |
| Both conditions within frozen controls | 4/6 | 2/6 |
| Median elapsed time | 48.308 s | 72.790 s |
| Recorded native tool errors | 2 | 3 |

| Case | V3 | V6 | V3 time | V6 time |
| --- | --- | --- | --- | --- |
| signed-ceiling | Pass | Fail | 53.639 s | 169.690 s |
| literal-first | Pass | Pass | 32.676 s | 56.442 s |
| adjacent-groups | Pass | Pass | 64.726 s | 85.188 s |
| interval-union | Pass | Fail | 75.338 s | 180.010 s |
| atomic-stock | Fail | Fail | 39.078 s | 60.391 s |
| stable-key-unique | Fail | Fail | 42.976 s | 51.111 s |

V6 interval-union passes its saved-code checker without a normally completed
native turn, so it receives no successful-repair credit. V3 stock and uniqueness
finish normally with incorrect code. Four V6 turns fail to complete normally.

The compiler executes model-supplied cases; it is not an independent oracle.
Signed-ceiling supplies floor-like negative expectations: it expects
`ceil_div(-4, 3) == -2` and `ceil_div(-7, 3) == -3`, while the specified ceiling
results are `-1` and `-2`. A check fails against a correct negative result, and a
later saved edit is wrong. That assertion is not defect-detection credit.
The interval check passes two positional arguments to a one-argument function,
producing `TypeError` without establishing correctness.

Exact frozen-compiler commands execute in four adapted episodes. Only
literal-first prints a successful check marker matching the final saved source
(six cases). Signed-ceiling has eight cases with wrong negative expectations;
grouping has six and intervals sixteen, both with a positional-argument shape
error. Grouping later prints an example rather than completing the typed check.
Stock and uniqueness execute no compiled check. No failed check is treated as
verification of the final edit.

Stock prevalidates each quantity against original stock before deducting all
requests. It still accepts cumulative repeated-item demand exceeding available
stock. Its actual sequence is read, accepted patch, stream interruption and
failed turn; no check runs and no normal final answer appears. Uniqueness still
uses hashing and raises `TypeError` for list-valued keys.

The [signed diagnosis](v6-comparison-20261020/adapted-signed-stream-diagnosis-a21.json)
finds a final request lasting about 90 seconds with a configured 90-second
request limit. Deadline attribution is an inference from timing and code;
the exact exception was not retained. The
[stock diagnosis](v6-comparison-20261020/adapted-stock-stream-diagnosis-a21.json)
rules out that explanation: its final request lasts about 30.729 seconds and
reads 49,711 bytes while only 592 reach the client. Suppressed arguments followed
by stream/adapter failure are compatible with this evidence. Original frames
and chained exceptions were not retained, so the exact cause is unknown.

The [independent audit](v6-comparison-20261020/independent-audit.json) reruns all
twelve unchanged external checkers and matches every recorded exit. The
[integrity audit](v6-comparison-20261020/frozen-integrity.json) verifies all 175
frozen artifacts and four physical assets. Goals, fixtures, checker bytes,
native profiles, developer instructions, launch flags and budgets are unchanged.
Both arms use installed Qwen3-14B-Q4_K_M, Codex 0.160.0 and llama.cpp b11617.
Each episode has 180 seconds, sixteen requests and 2,048 output tokens per
request, with serial execution and no quality retries. External checks stay
outside the model workspace.

Candidate: source `55785ac544b92206f7c49182ad8ed1e7ad77f8c1`, runtime
`2.0.0a21`; wheel SHA-256
`18c3c85b5853d4683682ead72d1587e1aad6854c052e7aa5abeb043078775ac2`.
It passes **162 installed fast tests and thirteen focused workflows** outside
the checkout. This is focused validation, not a full-suite claim.
[Package/wire receipts](v6-development-diagnosis-20261020.md) verify 173 runtime
files, 138 test/fixture files, and 72 unchanged default/v1–v5 first-request
transformations. The real-client mechanism control completes seven scripted
roundtrips with zero inference; that does not establish model quality.

All three disposable connection lifetimes restore settings and close owned
listeners; normal settings and frozen artifacts remain unchanged. No automatic
coding permission or ordinary coding evidence is installed. These reused
development tasks do not establish general superiority or ordinary 90-second
qualification. The [diagnosis](v6-development-diagnosis-20261020.md) preserves
v4/v5 failures and the interrupted a20 attempt; none replace this result.

See the [comparison](v6-comparison-20261020/comparison.json),
[frozen plan](v6-comparison-20261020/frozen-plan.json), and
[publication manifest](v6-comparison-20261020/manifest.json).
