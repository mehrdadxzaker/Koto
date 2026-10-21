# Local harness repair evidence

The final a31 candidate completed 1/6 native coding episodes. Across its three target repetitions, rollback passed 0/3 and list-key uniqueness passed 0/3.

A passing episode requires changed saved code, the unchanged independent checker passing, and normal native Codex completion. Correct saved code followed by a failed or unfinished native turn does not pass. No profile was qualified or enabled for ordinary coding.

## Final six tasks

| Task | Independent saved-code check | Native completion | Full episode |
| --- | --- | --- | --- |
| signed-ceiling | fail | fail | fail |
| literal-first | pass | pass | pass |
| adjacent-groups | fail | fail | fail |
| interval-union | fail | fail | fail |
| atomic-stock | fail | fail | fail |
| stable-key-unique | pass | fail | fail |

## Retained diagnostics

| Frozen run | Runtime | Effort | Full episodes | Saved-code checks |
| --- | --- | --- | --- | --- |
| v8-diagnostic-1 | 2.0.0a23 | none | 1/2 | 1/2 |
| v8-reasoning-low-diagnostic | 2.0.0a23 | low | 0/1 | 0/1 |
| v8-low-budget-diagnostic | 2.0.0a25 | low | 0/1 | 0/1 |
| v8-continuation-fixed-diagnostic | 2.0.0a26 | low | 0/1 | 1/1 |
| v8-phase-budget-diagnostic | 2.0.0a27 | low | 0/1 | 1/1 |
| v8-a28-six-minimal | 2.0.0a28 | minimal | 4/6 | 5/6 |
| v8-a30-six-low | 2.0.0a30 | low | 1/6 | 3/6 |
| v8-a30-targets-repeat-2 | 2.0.0a30 | low | 0/2 | 1/2 |
| v8-a30-targets-repeat-3 | 2.0.0a30 | low | 1/2 | 1/2 |
| v8-a31-six-low | 2.0.0a31 | low | 1/6 | 2/6 |
| v8-a31-targets-repeat-2 | 2.0.0a31 | low | 0/2 | 0/2 |
| v8-a31-targets-repeat-3 | 2.0.0a31 | low | 0/2 | 1/2 |

All a30 and a31 repetitions were declared before their respective inference campaigns. Each ran serially with fresh disposable homes, the same six task goals and independent checks, 180 seconds, 16 requests and 2,048 output tokens per request. Target repetitions selected rollback and list-key uniqueness from the same frozen six-task inventory. There were no selective retries or changes between repetitions. Offline oracle replays used saved copies with network and file writes denied.

Earlier exploratory candidates, failed runs and the unstarted a29 withdrawal remain visible. Different candidate versions and requested reasoning efforts are separate treatments; their scores must not be pooled or presented as a causal harness-only comparison. These are reused development tasks, not held-out validation or the separate 90-second coding qualification.

## Requested v1 versus v2 comparison

The three paired repeats produced native-plus-checker totals of **10/18 for v1 and 12/18 for v2**. Rollback passed **0/3 for both profiles**. The two v2-only task wins both occurred in the first repeat; the other repeats tied. One v2 rollback implementation passed its checker but the native episode failed. The rollback gain was not repeatable under the requested endpoint.

## What changed and what remains

A separate [single-request engine diagnostic](budget-diagnostic.json), run after
the campaigns closed, observed activation of budget 32 and a forced thinking
end. The parsed reasoning text contained 31 tokens, excluding removed
delimiters. Ordinary output then continued through 831 text deltas until the
95-second bound, with no function-argument deltas or terminal response. The
recorder combines deadline and transport termination without the exception subtype.
This rules out an ignored budget field in that replay. No host tools executed,
and no generated text was retained. Fresh cache, unseeded sampling and added
trace logging prevent a matched historical latency claim; this diagnostic is
not a coding episode or proof of the earlier requests' failure mechanism.

The opt-in v8 profile repairs a confirmed cleartext reasoning-continuation rejection, transports ordinary Python scripts through the already declared native tool, and supplies correlated static failure advice. It preserves the host agent loop, native tool results, permissions and ordinary Codex settings. Reasoning allowances apply inside recognized thinking blocks; they do not cap total generation or wall time. See the [v8 contract](../../LOCAL_QWEN_HARNESS_V8.md).

Package regression tests establish these mechanics. They do not establish reliable coding quality. Issue #569 remains subject to its actual setup-bound qualification; personal selection acceptance also requires checked representative and held-out outcomes. External account cleanup requires authenticated resource, recovery and billing evidence.

The [derived receipts](results.json) contain every listed episode, frozen hashes, separate campaign audits and cleanup/settings observations. Raw requests, scripts, transcripts, credentials, configuration contents and private databases are excluded.
