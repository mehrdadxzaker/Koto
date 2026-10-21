# Qwen harness v6 development diagnosis — 2026-10-20

V6 tests whether model-supplied structured checks can avoid the syntax and target
binding failures retained from v4/v5 while Codex continues to execute every tool.
The profile is experimental and default off. The current source candidate is
`2.0.0a21`, commit `55785ac544b92206f7c49182ad8ed1e7ad77f8c1`.
**The completed frozen a21 comparison scored v3 4/6 versus v6 2/6.** V6 did not
improve coding performance. Mechanism, package and focused-test evidence below
does not establish a quality improvement; no full a21 suite is claimed.

The [publication manifest](v6-diagnosis-20261020/manifest.json) allowlists small
derived summaries and records their hashes. Credentials, configuration contents,
raw requests/SSE, databases, probe-control records and independent checker source
are excluded. This documentation workflow executed no helper or model.

## Evidence retained before v6

The closed [a18 v3/v4 comparison](v4-comparison-20261020.md) reports 3/6 successful
repairs for v3 and 1/6 for v4. Saved implementations passed their independent
checkers in 4/6 and 3/6 cases respectively; native turn completion is a separate
condition. V4 therefore did not improve the combined outcome in that run.

V4 stock completed eleven identical commands containing literal backslash-`n`
separators, all rejected by Python before intended assertions ran. Its final
source remained faulty. The [earlier diagnosis](v4-development-diagnosis-20261020.md)
also retains the a16/a17 pilots, shell/heredoc controls, and the static proof that
the installed llama.cpp/Qwen path includes trailing developer checkpoints.
Prompt inclusion does not establish attention or obedience. A dropped-role
explanation was rejected rather than inferred from the model ignoring advice.

The [a18 authored-check replay summary](v6-diagnosis-20261020/a18-authored-check-sensitivity.json)
preserves two eligible, completed Python checks across the twelve episodes.
Four serial read-only, no-network replays found that interval-union and
stable-key-unique assertions fail on frozen initial source and pass on their
saved candidate source. Actual assertion lines were observed during replay;
the Python payloads were unchanged. The uniqueness examples still omitted
list-valued keys, and that saved implementation failed the independent checker.
Old-bug sensitivity is useful evidence, but it is not full-specification coverage.

## V5 diagnostics are not a six-task result

The separate v5 format profile replaced multiline Python examples with a
single-line standard-library callable `assertRaises` pattern. Its preceding
scripted native control established that the format could run in the existing
sandbox; it did not establish that the local model would use it correctly.

| Retained v5 run | Observed result | Evaluation boundary |
| --- | --- | --- |
| [Grouping pilot](v6-diagnosis-20261020/v5-aborted-grouping.json) | One completed source edit followed by seven completed Python `SyntaxError` results; runner later aborted with `EPERM` while stopping the child after the deadline. | No completed outcome rows. The aborted run supplies no six-task score or completed grouping verdict. No stock episode ran in this pilot. |
| [Separate stock diagnostic](v6-diagnosis-20261020/v5-stock-diagnostic.json) | Native turn completed normally in 82.850 seconds, four model requests, client exit 0; independent checker exit 1. | One normally completed failed diagnostic, not a paired or six-task v5 comparison. |

Grouping's failed commands defined a replacement function inside a single-line
script containing compound statements after semicolons. Two identical payloads
included an assertion; five later identical payloads used a printout. None
imported the saved function, and Python compilation failed before either could
verify it. The retained source did change, so command failure must not be
misreported as proof that no edit occurred. The aborted runner receipt records
restored settings and closed owned listeners.

The stock diagnostic did invoke the saved function successfully through one
single-line expected-error/unchanged-state check. That example tested immediate
overdraw. The candidate validated each request against the original quantity,
then deducted afterward; repeated requests could exceed the cumulative limit.
The model's passing example omitted a valid prefix followed by rejection and
cumulative repeated-item behavior. Native completion and an exit-zero authored
check therefore coexisted with an independently rejected implementation.

## What changes in v6

The retained failures distinguish three issues: representation errors prevented
execution; inline definitions failed to test saved source; and narrow passing
examples omitted required behavior. V6 addresses the first two with a typed
private interface and supplies an explicit optional composition property for
appropriate ordered-operation batches. The model still has to derive adequate
expectations from the task. Improved behavior remains a fresh empirical question.

The [pure compiler](../../hormuz/local_python_checks.py) accepts only bounded JSON
check data. The [transport](../../hormuz/codex_llama.py) privately advertises a
derived helper only when the original native command declaration and automatic
selection permit it. Exact flat identity from pinned Codex 0.160.0 is supported;
other same-name tools, replayed discovery output and changed flat descriptions or
schemas do not qualify. The native namespace is retained when present and is
never invented for a flat tool.

Completed derived calls become ordinary native `exec_command` calls with compiled
`cmd` and optional unchanged native `workdir`. Existing native call IDs, history,
tool definitions and decoded arguments retain their previous translation
behavior. New derived arguments intentionally change representation. Koto neither
executes the command nor invents a tool result, permission flag, success receipt
or second agent loop. Codex applies the existing approval and sandbox workflow.

The host-run driver reads fresh saved source inside its working directory and
checks expected results, specified exceptions, post-error state, optional return
identity and explicit tuple expectations. `atomic_batch` is a separate opt-in:
it requires ordered-operation semantics where concatenation must preserve
sequential rejection. At most eight probes combine or repeat supplied batches;
atomicity alone does not justify that additional property. These checks are
model-authored development checks, not a hidden oracle or automatic qualification.

## Historical a20 mechanism and interrupted study

The a20 [native semantic control](v6-diagnosis-20261020/native-semantic-control-a20.json)
closed successfully using pinned Codex CLI 0.160.0, seven scripted native requests
and zero model inference. The same compiled command recorded two failures followed
by a success after native repairs to the generic fixture. No native
namespace was synthesized. Raw helper argument delta/done events were suppressed;
empty native added arguments followed by compiled item-done and terminal
snapshots were sufficient for the actual client. Native results and continuation
history were preserved. Normal/disposable settings stayed unchanged and the
owned process, listener and provider thread stopped. This establishes the
mechanism and those scripted sensitivities, not spontaneous model verification.

The historical [a20 validation](v6-diagnosis-20261020/validation-a20.json) and
[wire audit](v6-diagnosis-20261020/previous-profile-wire-a20.json) remain retained.
A later transport review found that empty argument deltas appended zero-byte
fragments. An empty-only sequence followed by valid completed arguments could
attempt to parse an empty string, while repeated empty chunks could grow the
fragment list without consuming its byte budget.

The [independent interrupted-study receipt](v6-diagnosis-20261020/aborted-a20-study.json)
records the owner's stop of the a20 run after that review. Only two baseline
episodes had completed: signed-ceiling and literal-first. The baseline grouping
episode was interrupted in flight, with no task verdict, and no adapted episode
had started. Sixteen actual model request attempts remain counted as exposure:
fifteen recorded successful responses and one unknown outcome. **All quality
credits from this partial study are excluded.** It is not a completed comparison.
Owner receipts record restored settings, closed owned listeners, unchanged normal
settings and unchanged frozen artifacts. An empty recorded error string reflects
`str(KeyboardInterrupt)`, not evidence that the study completed successfully.

## Current a21 mechanism and compatibility evidence

A21 ignores an empty delta only after validating its identity, type and unfinished
call state. Empty chunks retain no fragments or byte count; nonempty chunks still
obey the aggregate byte budget, and unbound or post-completion deltas still fail.
The new feed regressions failed before this minimal correction and passed after
it. The compiler contract and qualification controls did not change.

The fresh [a21 native control](v6-diagnosis-20261020/native-semantic-control-a21.json)
also passed with empty chunks included: seven scripted native requests, zero model
inference, the same compiled command's two failures followed by success, and
unchanged native identity/history and sandbox flags. The owned process, listener
and provider thread stopped, and settings stayed unchanged. This validates the
corrected mechanism; it does not supply model-quality credit.

The [a21 validation summary](v6-diagnosis-20261020/validation-a21.json) records
162 installed fast tests and thirteen focused workflows outside the source
checkout. Parity covers 173 runtime
or configuration files across source, wheel, private install and source archive,
plus 138 test/fixture files between source and source archive. The unchanged
six-case file has SHA-256
`ef495f026747e5f4a52703665240883832cc18f8f75eb209ae75dfa682da55b9`.
These focused checks and parity do not constitute a full installed-wheel suite.

The [previous-profile wire audit](v6-diagnosis-20261020/previous-profile-wire-a21.json)
compares a21 with a19 across twelve captured first requests and default/v1–v5
profiles: all 72 transformed requests are byte-identical. Separate transport
regressions cover native continuation, compiler errors, identity mismatches,
truncation, collisions and resource bounds. First-request parity does not prove
compatibility for every possible history.

## Completed a21 evaluation

The fresh `koto-harness-v6-a21-comparison-20261020` study is complete. Its
[report](v6-comparison-20261020.md) retains all twelve episodes, exact package
identity and integrity audit. Saved-code correctness, normal native completion,
authored-check execution and latency remain separate. A21 received focused
validation; it has no full-suite claim. Stock and uniqueness stream failures
require further diagnosis before a repair can be claimed.

Two separate instrumented diagnostics followed this frozen comparison. The
[stock diagnostic](v6-diagnosis-20261020/shadow-stock-diagnosis-a21.json)
executed a malformed one-positional-argument check, then met a 90-second request
limit; it did not reproduce the earlier early interruption. The
[uniqueness diagnostic](v6-diagnosis-20261020/shadow-unique-diagnosis-a21.json)
captured `CheckSpecError(expected_xor_raises_required)` being wrapped as
`CodexLlamaError(invalid_provider_frame)`, ending the stream before host feedback.
The [instrumentation proof](v6-diagnosis-20261020/shadow-instrumentation-proof-a21.json)
retains byte-identical package code and bounded metadata-only logging. These are
additional failed diagnostics, not replacements for any final episode or proof
of the historical interruptions' exact causes. The explicit
[v7 recovery profile](../LOCAL_QWEN_HARNESS_V7.md) addresses this confirmed
semantic-feedback seam and improves check-input descriptions.

The experiment retains the same six task specifications and independent checks,
matched 180-second development episodes, sixteen requests, 2,048 output tokens
per request, serial execution and no quality retries. These known development
tasks do not satisfy ordinary 90-second qualification or establish general
superiority. Prior v1–v5 receipts cannot authorize v6. No route is automatically
activated or qualified by this work.
