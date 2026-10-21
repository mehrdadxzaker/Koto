# Recoverable typed Python checks through Codex

`qwen_code_v7` selects the experimental `qwen-code.v7` profile for the installed
Qwen3-14B-Q4_K_M model, alongside `codex_llama_v1`. The profile is default off.
The current candidate is runtime `2.0.0a22`, source commit
`ba7b6517a1bed1423d0160fe5268c51e0d686fcb`. The matched six-task comparison
scored **v3 3/6 versus v7 3/6**. Grouping passed with v7, but stock rollback and
list-valued uniqueness keys still failed. There is no overall coding-performance
improvement. The full installed-package suite passes 184 fast tests and
635 workflows. No automatic qualification is granted.

V7 retains [v6's typed Python check interface](LOCAL_QWEN_HARNESS_V6.md) and adds
recoverable feedback for selected mistakes in model-supplied check data. Koto
still compiles a derived private call into an ordinary native `exec_command`
call. Codex owns approvals, sandboxing, execution, tool results and the agent
loop. Koto adds no executor, second loop, forced tool choice or fabricated result.

## What changes from v6

A separate instrumented v6 uniqueness diagnostic captured a
`CheckSpecError(expected_xor_raises_required)` followed by
`CodexLlamaError(invalid_provider_frame)` with that exact cause. The stream closed
before a native check command could run. That confirms a feedback failure in
that diagnostic. It does not assign the exact cause of the original frozen v6
stock or uniqueness interruptions.

For v7 only, an explicit allowlist of semantic check-data errors compiles to a
small static command. When Codex executes it, the command writes
`KOTO_CHECK_INPUT_ERROR` with fixed corrective advice and exits 2. It does not
load target source, invoke the target, or embed submitted case data. The error is
an actual host tool result returned through the existing continuation history.
It is not a passing check. Invalid encoding, resource limits, module paths,
function names, protocol identities and authority fields still fail closed.

For valid check data, the host-run driver loads the saved module and inspects the
actual callable's signature. It binds **all** supplied cases before invoking the
function for any case. A positional/keyword binding error therefore returns
actionable exit-2 feedback before those function invocations. Module loading can
execute module-level code; unlike compile-time semantic feedback, this path does
not promise to avoid target import.

V7's descriptions show one `args` item per positional parameter, a nested array
for one list parameter, and optional `kwargs` by actual parameter name. The
compiler does not implicitly wrap arguments, rewrite function signatures, alter
expectations or retry failed calls. Exact expected values, exceptions, state
checks, return identity and explicit tuple positions remain model-supplied.
Failure advice asks the model to recheck expectations against the original task.
An exit-zero authored check still does not prove full task coverage.

## Existing native boundary

The private `koto_python_checks` helper is offered only with original
automatic/default tool selection and a unique supported native execution
declaration. Supported declarations are `functions.exec_command` or the exact
flat declaration observed in pinned Codex CLI 0.160.0. A changed flat declaration,
another MCP namespace, replayed discovery output, ambiguous target or full tool
catalog does not qualify. A collision gets a deterministic helper suffix. The
adapter leaves forced, required, none and restricted host choices unchanged and
does not offer the helper for those choices.

The host receives its existing native identity and call IDs, compiled `cmd`,
and optional unchanged native `workdir`. No namespace or permission flag is
invented. Existing native history and decoded argument values retain their
previous translation behavior; only new derived helper arguments intentionally
change representation. Raw helper argument deltas/done events are withheld, with
compiled arguments appearing in native item-done and terminal snapshots. Empty
chunks retain no fragments; identity, consistency and completion checks remain.

Bounds remain 32 KiB of check data, depth eight, sixteen cases, 128 KiB commands,
64 KiB of unfinished transport arguments, a 512 KiB compiled cache and 1,024 call
identities. Optional `atomic_batch` still opts into the stronger property that
ordered-operation batch concatenation preserves sequential rejection. It derives
at most eight combinations/repetitions of supplied batches and requires observed
late-error coverage. Atomicity alone does not justify that property.

## Evidence and remaining gates

The [a22 scripted native control](local-harness/v7-diagnosis-20261020/native-feedback-control-a22.json)
completed six pinned-client roundtrips with zero inference. Actual command exits
were 0 for reading source, 2 for invalid check-data feedback, 1 for a valid check
against faulty source, and 0 for the identical check after a native repair. The
semantic error command avoided target import. Native feedback/history and sandbox
flags were preserved, settings stayed unchanged, and all owned resources closed.
This proves the scripted mechanism, not spontaneous model behavior or coding gain.

The [focused validation summary](local-harness/v7-diagnosis-20261020/validation-a22.json)
records 184 installed fast tests and 25 focused workflows outside the checkout,
with parity for 173 runtime/configuration files and 143 test/fixture files.
The [wire audit](local-harness/v7-diagnosis-20261020/previous-profile-wire-a22.json)
found all 84 default/v1–v6 transformations byte-identical across twelve captured
first requests. V6's schema, program and representative compiled command also
remain pinned by regression hashes. These are bounded compatibility checks;
they do not guarantee every possible history. The separate
[full installed suite](local-harness/v7-diagnosis-20261020/full-installed-suite-a22.json)
passes all 184 fast tests and 635 workflows outside the checkout.

Use the [existing setup/disconnect workflow](LOCAL_QWEN_HARNESS.md) with an
explicit reviewed setup-v5 declaration selecting `qwen_code_v7`. Disconnect
before changing profiles. Old v1–v6 evidence cannot authorize v7 or migrate an
in-flight conversation. Ordinary coding qualification retains its 90-second
bound. The matched 180-second development comparison grants no automatic coding
readiness or route activation.

The completed [paired development study](local-harness/v7-comparison-20261020.md)
compares baseline `qwen-code.v3` with
`qwen-code.v7` on the unchanged six tasks and independent checks, with sixteen
requests, 2,048 output tokens per request, serial execution and no quality
retries. V3 is an earlier harness profile, not an untreated baseline. Both
profiles pass 3/6, while median elapsed time increases from 75.023 to 148.927
seconds. Only one adapted episode completes valid compiled checks matching final
source. The prior completed v6 comparison scored v3 4/6
versus v6 2/6; v6 did not improve performance. See the
[development diagnosis](local-harness/v7-development-diagnosis-20261020.md) for
the separate diagnostic evidence and publication boundaries.
