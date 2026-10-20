# Qwen v3 versus v7 comparison — October 20, 2026

**V3 and v7 each passed 3/6 repairs. V7 did not improve coding performance.**
Grouping passed only in v7; interval-union received successful-repair credit only
in v3. Stock rollback and list-valued uniqueness keys remained broken in both
arms. The requested stock repair remains unmet. Median elapsed time increased
from 75.023 seconds to 148.927 seconds.

| Measure | V3 | V7 |
| --- | --- | --- |
| Saved code passes unchanged independent checker | 3/6 | 4/6 |
| Native turn completes normally with client exit 0 | 5/6 | 3/6 |
| Both conditions within frozen controls | 3/6 | 3/6 |
| Median elapsed time | 75.023 s | 148.927 s |
| Recorded native tool errors | 6 | 7 |

| Case | V3 | V7 | V3 time | V7 time |
| --- | --- | --- | --- | --- |
| signed-ceiling | Pass | Pass | 76.706 s | 79.845 s |
| literal-first | Pass | Pass | 64.656 s | 90.625 s |
| adjacent-groups | Fail | Pass | 180.008 s | 154.988 s |
| interval-union | Pass | Fail | 73.339 s | 146.890 s |
| atomic-stock | Fail | Fail | 177.751 s | 180.004 s |
| stable-key-unique | Fail | Fail | 47.980 s | 150.964 s |

V7 interval-union passes the saved-code checker but its native turn does not
complete normally, so it receives no successful-repair credit. V3 grouping
leaves the source unchanged and has a failed native turn after malformed check
commands. V3 stock and uniqueness finish normally with incorrect code. V7 stock,
intervals and uniqueness have failed native turns. Saved-code correctness,
native completion and authored-check execution are separate observations.

## What the model actually checked

The [authored-check audit](v7-comparison-20261020/authored-check-credit-a22.json)
distinguishes a valid compiled driver, a semantic input-error command, and an
executed assertion about the implementation. The helper compiles model-supplied
expectations; it is not an independent oracle.

| V7 case | Observed host execution | Verification credit |
| --- | --- | --- |
| signed-ceiling | No executed helper check | None |
| literal-first | Exact compiled driver, eight cases, exit 0; success marker matches final saved source | Successful final self-check, with model-supplied coverage |
| adjacent-groups | One static `invalid_atomic_state_indices` error, then a seven-case driver rejected by `case_argument_binding`; both exit 2 | No implementation assertions completed |
| interval-union | No executed helper check | None |
| atomic-stock | Four distinct native command calls return semantic input errors: `identity_requires_success` once and `invalid_atomic_state_indices` three times; all exit 2 | No target loading or implementation assertions from those commands |
| stable-key-unique | Seven-case driver rejected by `case_argument_binding`, exit 2 | No implementation assertions completed |

The grouping and uniqueness drivers load saved source to inspect its signature,
then reject the case binding before target-function invocations. The five
semantic-error commands use static feedback without loading the target. These
actual host failures demonstrate the feedback mechanism working during the
study; they do not verify the edited implementations. Grouping's independently
correct repair therefore does not establish that its authored checks succeeded.

Only literal-first earns successful final self-check credit. No observed success
marker has a source-hash mismatch; the other cases have no successful marker.
No executed v7 implementation assertion failure or wrong expected value was
demonstrated in this study. No authored-check replay against initial faulty
source was performed, so empirical old-bug sensitivity is not claimed.

Stock's saved code in both arms validates and deducts each operation immediately.
A later invalid operation raises after an earlier deduction has already changed
the original state. Rollback remains incorrect. Both uniqueness implementations
still use a set and raise `TypeError` on list-valued keys. V7's feedback recovery
did not produce a correct implementation for either requested failure pattern.

## Frozen controls and validation

The [independent audit](v7-comparison-20261020/independent-audit.json) checks the
recorded outcomes, and the [integrity audit](v7-comparison-20261020/frozen-integrity.json)
checks the frozen study artifacts and physical asset pins. Both arms retain the
same six task specifications, initial source, independent checkers, native
profiles, developer instructions, launch flags and budgets. Independent checkers
stay outside model workspaces. The baseline is the earlier `qwen-code.v3`
harness profile, not an untreated model.

Both arms use the installed Qwen3-14B-Q4_K_M model, pinned Codex CLI 0.160.0 and
llama.cpp b11617. Episodes allow 180 seconds, sixteen requests and 2,048 output
tokens per request, with serial execution and no quality retries. V7 leaves
native tool choice, approvals, sandboxing, execution and the client agent loop
in place. It adds no forced helper choice or second executor. This comparison
downloaded no model, enabled no cloud route and activated no automatic coding.

Candidate: source `ba7b6517a1bed1423d0160fe5268c51e0d686fcb`, runtime
`2.0.0a22`; wheel SHA-256
`c25fb95df59b38f9e8d46c821dcb8467e33df8d5a226a24351aae916eb1228fd`.
It passes **184 installed fast tests and 25 focused workflows** outside the
checkout. The separate
[full installed suite](v7-diagnosis-20261020/full-installed-suite-a22.json) passes
**184 fast tests and 635 workflows**, including both installed CLI entrypoints.
[Package and wire receipts](v7-development-diagnosis-20261020.md) record parity
for 173 runtime/configuration files, 143 test/fixture files, and 84 unchanged
default/v1–v6 first-request transformations. The separate real-client mechanism
control completes six scripted roundtrips with zero inference. It supplies no
paired coding-quality credit.

All three disposable connection lifetimes restore settings and close owned
listeners; normal Codex settings and frozen artifacts remain unchanged. No
ordinary coding evidence or automatic coding permission is installed. These
reused development tasks do not establish general superiority or satisfy
ordinary 90-second coding qualification. The
[development diagnosis](v7-development-diagnosis-20261020.md) keeps the earlier
failed comparisons and two isolated shadow diagnostics separate from this result.

See the [comparison](v7-comparison-20261020/comparison.json),
[frozen plan](v7-comparison-20261020/frozen-plan.json), and
[publication manifest](v7-comparison-20261020/manifest.json).
