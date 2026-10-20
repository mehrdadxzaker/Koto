# Qwen harness v2 development diagnosis — 2026-10-20

These are retained development diagnostics on the already known stock-rollback
and list-key tasks. Guidance was tuned after inspecting their failures. They are
**not held-out evaluation**, and the changing candidates are not repeated trials
of one fixed treatment. The completed [180-second, six-task-per-arm comparison](v2-comparison-20261020.md)
records 5/6 successes for both v1 and v2. No improvement claim follows from these
pilots or that equal aggregate result.

## All four 90-second pilots

Every pilot froze all six [task specifications and independent checks](../../tools/local_harness_cases.json),
then explicitly selected the development subset below. The six frozen case
contents and their checker hashes match across A–D. Codex, runtime and model
asset pins also match. Each episode allowed at most 16 model requests, 90 seconds
and 2,048 output tokens per request, with serial execution and no quality retry.

| Candidate | Change under investigation | Stock rollback | List-key equality |
| --- | --- | --- | --- |
| A, `2.0.0a9` | Subordinate verification guidance in instructions | Fail; 55.388 s, 3 requests; edited, invalid batch still accepted | Fail; 22.953 s, 3 requests; edited, unhashable list raised `TypeError` |
| B, `2.0.0a10` | Repeat the same protocol as a trailing developer reminder | Fail; 90.006 s, 4 requests; two rejected patches, no saved edit | **Pass**; 60.080 s, 4 requests; saved edit and executable assertions |
| C, `2.0.0a11` | Shorter trailing checkpoint, including native patch grammar | Fail; 65.291 s, 4 requests; edited, normal example printed, invalid batch still accepted | Not run |
| D, `2.0.0a12` | Add a generic expected-exception/state-equality assertion pattern | Fail; 90.007 s, 3 requests; edited, stream ended before verification; independent rollback-state assertion failed | Not run |

A ran no model-authored verification command for either task. B's stock episode
also ran no verification command. C's successful shell command printed one normal
example; it asserted neither rejection nor rollback, so it is not verification of
the reported defect. D ran no post-edit check before the bounded stream ended.
The independent checks were not given to the model or weakened.

All four records report unchanged normal Codex settings and frozen artifacts,
restored experimental settings, and closed owned listeners. These experiments
used Codex's existing tools and execution loop. They installed no coding
qualification, enabled no automatic local coding, and did not alter Koto history
consent.

The complete local pilot records remain available:

- [A comparison](/Users/mehrdadz/Downloads/memoWiki/koto-harness-v2-pilot-20261020/comparison.json)
- [B comparison](/Users/mehrdadz/Downloads/memoWiki/koto-harness-v2b-pilot-20261020/comparison.json)
- [C comparison](/Users/mehrdadz/Downloads/memoWiki/koto-harness-v2c-pilot-20261020/comparison.json)
- [D comparison](/Users/mehrdadz/Downloads/memoWiki/koto-harness-v2d-pilot-20261020/comparison.json)

These absolute links refer to retained local artifacts, not repository-hosted
copies. Each directory also retains its frozen plan, native episode logs,
implementation snapshots and unchanged checks.

Installed-wheel provenance records the following candidate SHA-256 values:

| Candidate | Wheel SHA-256 |
| --- | --- |
| A | `72f4129690d22709da724f1ed5e2d0bff9054af06d4c0b7e0696f8a7859b86a2` |
| B | `55388801ec7fb7caf5f31d9a57df6eb5836c14bd5b60284936b8080e7b4d443f` |
| C | `fc16b9748e4d40d093d94438e3bfa31bfa4b0c7e5ba74ffd026f6bd3bdaec250` |
| D | `4dd7e8331e1fce511d352e9fc786f7fd16bb2ce3ffec450c28daba699729d516` |

These values come from each retained installation's `direct_url.json` archive
metadata. They identify different prepublication candidates; their outcomes must
not be combined as evidence for a single immutable v2 prompt.

## Developer-role hypothesis was refuted

The hypothesis was that the installed model's template discarded developer
messages. A bounded inspection used the actual Qwen3-14B runtime and native
Responses input-token endpoint, rather than inferring behavior from another
model's template. Six serial metadata requests made **zero completion requests**:
one `/props`, two `/apply-template`, and three `/v1/responses/input_tokens` calls.

Both rendered prompts retained the distinctive developer/system marker. Native
Responses input counts were baseline **27**, developer **360**, and system
**360**: either role added **333 tokens**. Both rendered prompts were 1,097 bytes.
The installed template SHA-256 was
`57f1fd00f0013a2be96aa79b857391f27e23df5b5f847072b524c897e24d0361`.

The saved-capture assertion
[`assert_native_roles_preserved.py`](/Users/mehrdadz/Downloads/memoWiki/koto-harness-v2-diagnosis-20261020/assert_native_roles_preserved.py)
passes and fails if the marker or native developer token increase disappears.
The [metadata verdict](/Users/mehrdadz/Downloads/memoWiki/koto-harness-v2-diagnosis-20261020/metadata-role-verdict.json)
records successful owned cleanup and unchanged normal settings. Retention does
not establish that the model obeys the instruction; it rules out discarded
developer content as the explanation for these failures.

## B's native patch failures and deadline

B's stock episode produced two native `apply_patch` rejections: an unprefixed
source line in a hunk, followed by unified-diff coordinates interpreted as patch
context. Those rejected calls appeared in stderr rather than completed file-change
events. The original pilot's `tool_errors=0` therefore undercounts them.

The first three model requests returned HTTP 200 and completed with **75, 215,
and 225 output tokens**, respectively. They consumed approximately **29.850,
19.787, and 21.122 seconds**. The fourth request also received HTTP 200, then its
stream ended after another **18.870 seconds**, at the 90-second probe deadline.
The work ledger records `outcome_unknown` / `provider_stream_interrupted` for that
request; its final token count is unavailable. Completed responses did not
exhaust the 2,048-token cap, and no provider HTTP error was observed.

The client exited with a failed turn after the stream closure; the runner records
`termination: completed`, not a launcher timeout. The admission implementation
clamps the local request deadline to the remaining probe budget. This accounts
for the bounded closure after patch retries without treating it as a new HTTP
failure or claiming a final token count. Native logs/state databases were empty
for the ephemeral episode; retained stderr and the linked usage/work records
provide the complementary evidence.

## B's list-key check was substantive but incomplete

The retained native command executed `python3` with **five assertions**, covering
empty input, repeated scalar keys, equal list keys, equal dictionary keys and
distinct scalar keys. It returned exit code 0, and the unchanged independent
checker also passed. This is evidence that this episode exercised the formerly
failing unhashable-key behavior; a printed success string alone is not the basis.

Those five assertions did not independently cover every specification clause,
including object identity and every missing-value distinction. The external
checker remains the task-success signal. One development success neither repairs
the failed stock task nor establishes a general coding improvement.

## Installed-wheel fixture failure and correction

The first complete installed-wheel validation passed 67 fast tests, then stopped
at the new long-probe workflow after 112 workflow tests. Its assertion saw
HTTP 403 instead of 200. An isolated installed-wheel replay outside the source
checkout reproduced the failure in **1.446 seconds** and captured
`hormuz_route_probe_request_mismatch`.

Targeted boolean/hash instrumentation in a separate temporary installed copy
showed matching native request/profile digests, user agent, work binding,
destination generation, coding classification, capabilities and readiness.
The failing condition was the declared byte envelope: the final shaped request
was **4,169 bytes**, exceeding the inherited synthetic fixture's **4,096-byte**
limit. Production admission was correct. No credential headers or raw native
payloads were needed for this diagnosis.

Commit `e60826a3` changes only the
[public workflow fixture](../../tests/test_coding_probe_v5_workflow.py): it declares
the real setup-v5 **65,536-byte** envelope before constructing its evidence/subject,
and separately preserves **4,096-byte rejection** coverage through the same public
connection and probe controls. The undersized request performs no inference.
The production gate and installed runtime were unchanged. Against the pristine
installed candidate outside source, **two new probe workflows plus six existing
coding-output workflows passed: 8 tests in 16.336 seconds**. Both paths retained
ordinary coding rejection, no automatic qualification, unused cloud destinations,
revocation and settings restoration. Debug instrumentation exists only in the
clearly marked temporary diagnosis copy, not production source.

## Boundary for the next comparison

The explicit [development envelope](../LOCAL_QWEN_HARNESS_V2.md) uses probe plan v5
and status v2 to permit up to 180 seconds for either declared Qwen harness. Plans
v1–v4 and status v1 retain 90-second limits; individual upstream requests remain
bounded at 90 seconds. Native request identity maps internally to v4 semantics.
There is no new coding-evidence version or automatic coding permission.

The completed [full comparison](v2-comparison-20261020.md) gave v1 and final v2 the
same 180-second ceiling and the same six tasks/checks. Both passed 5/6; v2 repaired
stock rollback but failed to apply its unique-record edit. Neither arm executed
model-authored assertions. The increased development budget cannot retroactively
turn the 90-second failures into passes or satisfy the existing 90-second coding
qualification criteria; the two studies must remain separate.
