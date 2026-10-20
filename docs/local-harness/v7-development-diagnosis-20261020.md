# Qwen harness v7 development diagnosis — 2026-10-20

V7 addresses a confirmed feedback failure for selected invalid typed-check data
while preserving the existing native Codex execution boundary. The candidate is
`2.0.0a22`, source `ba7b6517a1bed1423d0160fe5268c51e0d686fcb`, wheel SHA-256
`c25fb95df59b38f9e8d46c821dcb8467e33df8d5a226a24351aae916eb1228fd`.
**The completed v3/v7 six-task comparison scores 3/6 in each arm.** Grouping
passes with v7; stock rollback and list-valued uniqueness keys still fail. There
is no overall performance improvement. The full installed-package suite passes
184 fast tests and 635 workflows. The profile remains default off,
with no coding-readiness claim.

The [publication manifest](v7-diagnosis-20261020/manifest.json) allowlists only
small derived receipts and their hashes. It excludes configuration contents,
credentials, databases, raw requests/frames, submitted cases, probe controls and
hidden checker source. Preparing these documents runs no model, native client,
server, generated check or oracle.

## Retained v6 result and two separate diagnostics

The completed [a21 comparison](v6-comparison-20261020.md) scored v3 4/6 versus v6
2/6 successful repairs. Saved code passed independent checks in 4/6 and 3/6
episodes respectively, while native completion was a separate condition. Stock
rollback and list-valued uniqueness keys remained broken in both arms. V6 did
not improve performance. The original stock and uniqueness interruptions did
not retain the raw provider frames or chained exceptions needed to assign their
exact causes; a later diagnosis must not retrospectively fill that gap.

Two isolated instrumented a21 diagnostics remain excluded from that comparison's
quality score:

| Diagnostic | Observation | Causal limit |
| --- | --- | --- |
| [Stock](v6-diagnosis-20261020/shadow-stock-diagnosis-a21.json) | Four requests, 169.495 seconds, failed native turn. One compiled host check exited 1 with a positional-argument `TypeError`; intended assertions did not complete. The terminal request lasted about 90 seconds. | Timing is consistent with the provider deadline, but the exact terminal exception was not observed. This did not reproduce the original early stock interruption. |
| [Uniqueness](v6-diagnosis-20261020/shadow-unique-diagnosis-a21.json) | Three requests, 113.695 seconds, failed native turn. Bounded metadata captured `CheckSpecError(expected_xor_raises_required)` followed by `CodexLlamaError(invalid_provider_frame)` with that exact cause. No compiled host check ran. | This establishes the feedback failure in this isolated episode. Raw cases were not logged, so whether both `expected`/`raises` were present or both absent is unknown. The original study's early failures remain unassigned. |

The shadow core's 173 files were independently compared with the a21 wheel.
Metadata logging had fixed event/byte/chain bounds and retained no raw prompts,
frames or cases. Owner receipts record cleanup, unchanged normal settings and
unchanged frozen artifacts. The
[small v7 diagnosis summary](v7-diagnosis-20261020/semantic-feedback-diagnosis-a21.json)
retains these distinctions without copying raw execution data.

## Hypothesis, red regression and bounded change

The uniqueness diagnostic established a concrete path: strict compiler
validation raises a `ValueError` subclass; transport converts it to
`invalid_provider_frame`; the gateway closes the stream before Codex receives
a native error result. A valid helper interface can therefore deprive the model
of corrective feedback for a simple case-data mistake. This does not establish
that feedback alone will improve task performance.

New transport regressions were red before v7 selection existed: seven tests
reported seven failures because no v7 helper was offered. The production
transport change selects a separate schema/compiler only for `qwen-code.v7`.
V6 retains its original strict compiler; the transport adds no broad exception
catch or permissive fallback. The old schema, program and representative command
remain byte-pinned in the compiler regressions.

`compile_feedback_checks` uses a fixed allowlist of semantic validation codes.
Those codes become static command text containing only fixed error advice and
exit 2. It embeds no submitted data and imports no target. The ordinary Codex
tool executor supplies the resulting stderr and exit status, so there is no
fabricated tool result or success receipt. Encoding, size/depth/count, path,
function-name, unknown validation and transport/authority failures remain hard.

For valid data, the separate feedback driver loads fresh saved source, obtains
the actual callable's signature, and binds every supplied case before any target
function invocation. This path **does load the saved module** and may execute
module-level code. A binding error exits 2 without entering the case invocations.
The compiler does not convert a dictionary to keyword arguments, wrap a list,
repair a function signature or change expected values. New descriptions explain
the required JSON argument shape. Failed result/exception advice directs the
model back to the original task before changing implementation or expectations.

Existing identity, SSE suppression, argument consistency, resource budgets,
native permission and automatic-choice gates are shared with v6. No named tool
choice, forced helper selection, Koto execution loop or hidden checker was added.
Optional ordered-batch composition remains an explicit stronger property than
atomicity; the model must choose it only where the task justifies it. Passing
model-authored cases do not establish independent specification coverage.

## Scripted native mechanism control

The [a22 control](v7-diagnosis-20261020/native-feedback-control-a22.json) completed
six roundtrips through actual pinned Codex CLI 0.160.0 with zero inference. It
used the exact supported flat command declaration and empty SSE argument chunks.
An initial source read exited 0; selected semantic-invalid check data produced
actual host exit 2 without target import; valid checks failed with exit 1; a
native patch repaired the generic fixture; the identical compiled check then
passed with exit 0 before normal completion.

The command/check hashes establish reuse of the same check for the red/green
pair. Feedback was preserved into the next native request, no namespace was
synthesized, and native tool output remained unchanged. Existing network/TMP
sandbox exclusions and developer instructions were retained. The client exited
0 and owner receipts record unchanged normal/disposable settings, reaped process,
closed listener and stopped provider thread. This establishes recovery through
the native mechanism under scripted inputs, not model-authored checking or quality.

## Focused package and compatibility evidence

The [a22 validation receipt](v7-diagnosis-20261020/validation-a22.json) records
184 installed fast tests and 25 focused workflows outside the source checkout.
Source, wheel, private install and source distribution agree for 173 runtime or
configuration files; source and source distribution agree for 143 test/fixture
files. The unchanged six-task file has SHA-256
`ef495f026747e5f4a52703665240883832cc18f8f75eb209ae75dfa682da55b9`.
The separate [full installed suite](v7-diagnosis-20261020/full-installed-suite-a22.json)
passes 184 fast tests and 635 workflows, with both installed CLI entrypoints
verified. Its raw log hash is retained in the small receipt; tests run outside
the checkout and the temporary installation is cleaned.

The [wire receipt](v7-diagnosis-20261020/previous-profile-wire-a22.json) compares
a22 with a21 on twelve captured first native requests, each under default and
v1–v6: all 84 transformations are byte-identical. Separate transport tests cover
native continuation, selected feedback, hard errors, empty chunks, consistency
and bounds. First-request parity does not prove every possible conversation.

## Completed paired evaluation

The frozen `koto-harness-v7-a22-comparison-20261020` study compares the earlier
`qwen-code.v3` profile with new `qwen-code.v7`. The
[completed comparison](v7-comparison-20261020.md) scores 3/6 in both arms. Both arms
retain the same six task specifications and independent checks, 180-second
development episodes, sixteen requests, 2,048 output tokens per request and
serial execution without quality retries. Checkers remain outside model
workspaces. No tuning or task-specific answer is introduced during the study.

Grouping passes with v7 in this run. Its interval-union source passes the
external checker but receives no repair credit because the native turn fails.
Neither arm repairs stock rollback or list-valued uniqueness keys. Median elapsed time rises from
75.023 to 148.927 seconds. Only one adapted episode completes successful typed
checks matching final saved source. Selected semantic errors now reach Codex
as native exit-2 feedback, but the model still supplies invalid metadata or
argument bindings. The stock run never executes a valid target check. The
requested stock repair remains unmet.

The comparison and independent audit report saved-code correctness, native
completion, actual authored-check execution, semantic feedback and elapsed time
separately.
The two isolated a21 diagnostics and scripted a22 control receive no paired
quality credit. Repeatedly inspected development tasks cannot establish general
model superiority. Ordinary 90-second coding qualification, receipt identity,
default-off routing and explicit activation requirements remain unchanged.
