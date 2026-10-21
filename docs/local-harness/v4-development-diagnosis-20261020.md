# Qwen harness v4 development diagnosis — 2026-10-20

This record explains observed stock-rollback and adjacent-grouping failures,
the request-shaping experiment, and limited a16/a17 pilot episodes. **Pilot
outcomes are separate from a full six-task comparison.** These are known
development tasks inspected during prompt design, not held-out evaluation. The six
[task specifications and independent checks](../../tools/local_harness_cases.json)
remain unchanged.

The [portable evidence manifest](v4-diagnosis-20261020/manifest.json) records hashes
of the allowlisted receipts and helper source copies. Their original bytes are
preserved; raw native requests, configuration, databases and probe controls are
excluded. Copying these artifacts executes no helper or model.

## Reproduce before changing guidance

Replaying the retained v3 implementations through their unchanged independent
checkers produced assertion failures for [stock](v4-diagnosis-20261020/atomic-stock-red.json)
and [grouping](v4-diagnosis-20261020/adjacent-groups-red.json). The retained
[minimal cases](v4-diagnosis-20261020/minimal-repro.json)
sharpen the feedback:

- Grouping `[1, 2]` returned `[[1, 2]]`, rather than `[[1], [2]]`. Each singleton
  passed, so removing either boundary element removes this failure.
- Stock `{'a': 1}` with two requests for one unit raised `ValueError` after
  leaving `{'a': 0}`. Failure requires retaining the original stock. Removing
  either request leaves an ordinary successful deduction.

The [saved-trace forensic record](v4-diagnosis-20261020/saved-v3-forensic-facts.json)
separates observations from missing evidence. Grouping had four accepted update
events, a print-only command showing unsplit groups, and final source equal to
the original. The trace does not retain patch arguments or intermediate source;
it cannot establish that an intermediate repair was correct or identify a
specific reversion patch. Stock had two identical shell commands returning exit
1 with a shell parse error. No executed Python assertion result is present.

Three ranked hypotheses were shown before probing:

| Hypothesis | Prediction and finding |
| --- | --- |
| Shell representation prevents intended checks from running | Minimized syntax checks reproduce the same shell failure; repairing the closing quote exposes a separate literal-backslash-newline defect. Confirmed representation defects. |
| Static guidance is insufficiently connected to actual tool state | Correlated native results can distinguish a failed command, pending session, or saved edit without inventing success. This supports an observational checkpoint; improved model behavior still requires fresh evidence. |
| Intended stock assertions miss the required invariant | Static inspection finds missing target binding and rollback assertions in branches skipped when the expected exception occurs. This is a coverage finding about reconstructed text, not executed tests. |

## Representation controls and the actual sandbox

The [quote-minimization record](v4-diagnosis-20261020/stock-quote-minimization.json)
used bounded, parse-only shell checks. The recovered captured shell body and a
24-character representative Python command fail with the observed parse error.
A lone `)` is the grammar minimum, but it no longer describes the Python quoting
defect. Correcting only the quote makes shell parsing succeed while Python AST
parsing still rejects literal `\n` separators.

An explicitly reconstructed multiline stock-check body is AST-parseable and has
five assertions. It was **not executed or credited as model verification**. It
imports `copy` but neither imports nor defines the target function. Its expected
error handlers only print; unchanged-state assertions are in `else` branches.
It also lacks repeated-item batches and a valid operation before a failing one.
The [AST audit](v4-diagnosis-20261020/stock-intended-check-ast-audit.json)
does not claim that supplying an import or repairing the shell wrapper would make
those checks adequate.

A separate [non-task heredoc control](v4-diagnosis-20261020/controlled-heredoc-execution.json)
ran red against a deliberately faulty
successor and green against a correct successor after a dedicated debug temporary
directory was allowed. That control did not establish compatibility with Codex's
actual temporary-directory exclusions. The exact native probes resolved it:

| Scripted native host probe | Observed result |
| --- | --- |
| Literal heredoc, with the benchmark's workspace and temporary-directory exclusions | Exit 1: shell could not create a temporary file for the here-document; intended Python assertions did not run. |
| Single-quoted `python3 -c` with actual newlines, under the same exclusions | Exit 0 with the scripted assertion marker; no temporary-file permission was added. |

Each exact probe used Codex CLI 0.160.0, three scripted native requests and **zero
model-inference submissions**, with unchanged normal settings. Native tool-result
text survived transport translation exactly. Receipts:
[heredoc](v4-diagnosis-20261020/native-exact-heredoc/result.json),
[literal command](v4-diagnosis-20261020/native-exact-literal-c/result.json).
The [exact probe helper](v4-diagnosis-20261020/helpers/replay_exec_feedback_exact.py)
and [earlier control helper](v4-diagnosis-20261020/helpers/replay_exec_feedback.py)
are retained as source, not executed by this documentation workflow.
Their native trace SHA-256 values are respectively
`92a560095ffa4fd045017272aa8cd2443c8533ba1986329b3d6e1eff28fb03f6`
and `fcdd3a0ef02502bd998013f0f098cd29cdd3ed611ec81933898f7fc8de3e88da`.
These scripted host probes establish representation mechanics, not spontaneous
local-model verification or coding quality.

## What v4 observes and preserves

The [progress module](../../hormuz/local_harness_progress.py) derives a bounded
snapshot from correlated call IDs, declared native tool identities, and pinned
host-result envelopes. It records reported saved/rejected native patches,
completed commands since the last saved native patch, latest command exit,
pending sessions, and recognized shell or Python syntax failures. A later
accepted patch resets the earlier command observation; correlated session
completion updates pending state. Unmatched or unsupported results do not become
progress facts.

The adapter appends subordinate advice to its private model-facing copy. It
never labels an exit-zero command as passing assertions or a saved edit as
correct. It advises the model to repair a failed command, inspect a pending
session, or check the latest edit. Its format example uses literal newlines in a
single-quoted Python command; it explicitly avoids heredocs under these host
restrictions. The model still chooses and runs every tool through Codex. The
adapter does not execute checks, alter tool arguments/results, force tool choice,
or add an agent loop.

[Fast observation tests](../../tests/test_local_harness_progress_fast.py) use
[captured native envelopes](../../tests/fixtures/codex-0160-native-progress.json).
A [public workflow test](../../tests/test_local_harness_v4_workflow.py) also passed
through the real connection and both server-shaping paths using captured failed
command feedback. It verifies identical progress state while preserving native
input, decoded argument values, result text, tools and request affinity. This
synthetic transport test creates no passing coding evidence.

## Development pilots and the a18 follow-up

The [a16 pilot record](v4-diagnosis-20261020/pilot-a16/comparison.json) contains
only the two selected development tasks, with a 180-second ceiling per episode:

| Task | Independent outcome | Elapsed | Model requests |
| --- | --- | --- | --- |
| Adjacent grouping | Pass | 140.108 s | 5 |
| Stock rollback | Fail | 180.007 s; timeout | 8 |

Grouping executed the same one-example assertion command twice, each time with
exit code 0. The [authored-check audit](v4-diagnosis-20261020/pilot-a16/group-authored-check-audit.json)
preserved both Python payloads unchanged: each assertion fails against the frozen
initial source and saved v3 failure, and passes against the saved a16 repair.
The replay observed the assertion line executing. This is meaningful sensitivity
to that grouping defect, but still only one example repeated twice; it does not
establish complete specification coverage. The independent task checker supplies
the broader task verdict.

Stock produced **five completed Python command failures**, each reporting
`SyntaxError` at `try` after a semicolon. A compound `try` statement must start on
its own line with an indented body. Those intended assertions did not execute.
The [stock audit](v4-diagnosis-20261020/pilot-a16/stock-authored-check-audit.json)
retains those five completed results separately from the source-read command;
an unfinished attempt is not counted as a sixth completed syntax failure. The
unchanged independent rollback assertion still fails.

The [a17 stock pilot](v4-diagnosis-20261020/pilot-a17/comparison.json) also failed:
180.003 seconds, seven model requests, no completed native turn. Its four
identical happy-path assertion commands actually executed with exit code 0.
The [authored-check audit](v4-diagnosis-20261020/pilot-a17/stock-authored-check-audit.json)
replayed each unchanged payload: all four pass against the broken frozen initial
source, saved v3 failure and saved a17 candidate. They are insensitive to the
rollback defect. The independent checker rejects an invalid batch accepted by
the candidate. A17's targeted Python `SyntaxError` branch never triggered in
this pilot; the observed formatting difference cannot be attributed to it.

A18 adds an observation of identical completed native command text since the
last accepted native patch. Repeated successful examples prompt advice to check
untested failure paths. Accepted patches clear the command counts; unknown
correlated results, running sessions and completed session polls report no
repeat count. It retains the conditional Python-syntax advice, restores the
generic expected-error/unchanged-state pattern on separate actual lines, and
advises staging atomic updates privately before committing them. These are
generic protocol hints, not generated task answers. The repeated-command
regression was red before implementation and green afterward; fixtures cover
the resets and correlated session completion.

## Frozen a18 result and the representation follow-up

The separate [full comparison](v4-comparison-20261020.md) is now closed: v3
completed three successful repairs out of six, and v4 one. Saved-code checker
passes were four and three respectively; native completion is a separate gate.
V4 stock repeated the identical literal-backslash-`n` Python command eleven
times, all failing with `SyntaxError`, and saved no patch. Its intended checks
did not run. Both saved uniqueness outputs still fail on list-valued keys.
The negative full-run record is retained alongside the pilots.

A role-dropping hypothesis does not explain these results according to the
installed path. The [role-inclusion receipt](v4-diagnosis-20261020/runtime-role-visibility/proof.json)
inspects the exact GGUF template and exact installed runtime sources. The
4,100-byte template matches the saved installed `/props` template and includes
the noninitial system branch used by this path. This is static inclusion proof,
with zero runtime/model requests; it does not establish attention or obedience.

A later [native one-line control](v4-diagnosis-20261020/native-assert-raises-one-line/result.json)
passed red/patch/green using four scripted requests and zero model inference.
Its generic accumulator deliberately mutates before an error; the same literal
single-line standard-library `assertRaises` plus unchanged-state assertion fails
before the native plain-`@@` repair and passes after it. The command contains
neither newlines nor literal `\n` separators. Normal settings stayed unchanged;
the owned process, listener and thread stopped. Raw requests are excluded; the
manifest retains the native trace hash. This establishes a simpler executable
format in the same sandbox, not autonomous coding improvement. A separate v5
format-only profile is proposed and unmeasured in the a18 comparison.

## Compatibility and evaluation boundary

The [wire-compatibility receipt](v4-diagnosis-20261020/v4-wire-compatibility.json)
compares the retained `2.0.0a15` implementation with the new source: twelve first
requests across v1, v2 and v3 produce **36 byte-identical transformations**, with
matching identity maps/declarations and unchanged originals. Another **36
non-executed synthetic history transformations** preserve argument values and
existing ordering behavior. These are compatibility checks, not additional
model episodes or proof about every possible transcript. The separate
[a16 package-parity receipt](v4-diagnosis-20261020/package-parity.json) records equality
for 172 runtime/configuration files across source, wheel, private installation
and source distribution; it does not claim a full-suite run by that audit.

Separate final-candidate receipts retain that provenance without replacing the
a16 records: [a18 package parity](v4-diagnosis-20261020/package-parity-a18.json)
again verifies 172 files across all four forms, and
[a18 wire compatibility](v4-diagnosis-20261020/v4-wire-compatibility-a18.json)
verifies 36 captured-first-request and 36 synthetic-history transformations for
v1–v3 against a15. The six-case file remains byte-identical. These audits make
no model-quality or full-suite claim.

V4 has its own explicit, mutually exclusive capability. Prior-profile receipts
cannot authorize it. Existing envelopes, Codex instructions/tools/approvals,
six-task checks, launch controls and matched 180-second/16-request/2,048-token
limits are preserved. No automatic coding permission or history consent is
granted. The full frozen comparison and its audit of actually executed checks
remain separate from these development-pilot results.

Later v5 formatting failures and the explicit v6 typed-check adapter are retained
in the [subsequent diagnosis](v6-development-diagnosis-20261020.md). Those
experiments do not replace the a16/a17 pilots or the negative a18 comparison.
