# Typed Python checks through existing Codex tools

`qwen_code_v6` selects the experimental `qwen-code.v6` profile for the installed
Qwen3-14B-Q4_K_M model. Select exactly one harness alongside `codex_llama_v1`.
The profile is default off and remains subject to existing coding qualification.
The current candidate is `2.0.0a21`, source commit
`55785ac544b92206f7c49182ad8ed1e7ad77f8c1`. Its
[completed comparison](local-harness/v6-comparison-20261020.md) scored v3 4/6
versus v6 2/6. V6 did not improve performance. A21 has focused validation;
no full installed-package suite is claimed for that candidate.

V6 gives the model a structured way to describe checks against saved Python
source. Koto compiles those data into an ordinary command for the existing native
`exec_command` tool. Codex continues to own approvals, sandboxing, execution,
results and the agent loop. This is an explicit semantic compiler profile:
new derived calls intentionally receive compiled arguments. Existing native
history and decoded argument values retain their existing translation behavior.

## Private interface and host execution

The private model-facing tools may include `koto_python_checks`; a deterministic
suffix avoids collisions with existing tool names. It accepts `checks` plus an
optional `workdir` only when that field exists in the native command schema.
The helper appears only when automatic/default tool selection is permitted and
one original native execution declaration is identified. Supported identities
are the explicit `functions.exec_command` identity or the exact flat declaration
captured from pinned Codex CLI 0.160.0. A changed flat declaration, another MCP
namespace, replayed discovery output, ambiguous target, full tool catalog, or
forced/restricted selection does not supply this authority.

The model supplies a relative `module_path`, function name and cases containing
positional `args`, optional `kwargs`, and exactly one of `expected` or `raises`.
Optional fields check unchanged arguments, return identity, or explicit tuple
positions in expected values. Expected values and exception choices come from
the model's interpretation of the original request. Koto supplies no task answers
or hidden checker inputs.

The [compiler](../hormuz/local_python_checks.py) validates data and returns command
text without opening target source or starting a process. When Codex executes
that command, its driver resolves the target inside the host working directory,
reads fresh saved bytes, invokes the saved function, and checks results and
state after expected exceptions. It does not substitute an inline implementation
or rely on a stale import cache. The host receives its existing tool name,
namespace when present, call ID, and ordinary `cmd` arguments. An explicitly
supplied native work directory is retained. No permission flags are added.

The interface accepts at most 32 KiB of JSON data, depth eight and sixteen cases.
Commands are bounded to 128 KiB. Transport separately bounds unfinished argument
data to 64 KiB, compiled command cache to 512 KiB, and call identities to 1,024.
The tool catalog's existing 1,024-entry limit remains in force. Invalid or
inconsistent derived calls fail closed without a fabricated host result.

For streaming, raw derived argument deltas and argument-done events are withheld.
The adapter emits the existing native identity with empty added arguments, then
compiled arguments in item-done and terminal snapshots. The pinned native
[a21 scripted control](local-harness/v6-diagnosis-20261020/native-semantic-control-a21.json)
confirmed that this sequence executes through Codex without an added event loop.
It included empty argument chunks and used seven scripted requests with zero
model-inference submissions. Empty chunks retain no argument fragments or budget;
identity and completion validation still apply.

## Optional ordered-batch property

`atomic_batch` opts into an additional property for ordered-operation APIs whose
concatenated batches must preserve sequential rejection. It is stronger than
atomicity alone and is inappropriate when whole-batch validation can legitimately
change that relationship.

The driver derives at most eight combinations or repetitions, each containing
at most three supplied batches. It invents no operation values. It requires
meaningful coverage of a state-changing valid prefix followed by rejection and
checks that a rejected combined batch preserves the declared state arguments.
Missing coverage fails the check instead of producing a success claim. These
bounded probes do not establish every failure path or complete task coverage.

## Qualification and compatibility

Use the [existing setup/disconnect workflow](LOCAL_QWEN_HARNESS.md) with an explicit
reviewed setup-v5 declaration selecting `qwen_code_v6`. Disconnect before changing
profiles. Existing v1–v5 evidence cannot authorize v6 or migrate an in-flight
conversation. Ordinary coding qualification retains its 90-second bounds; the
explicit 180-second development probe grants no automatic coding readiness.

The existing [comparison runner](../tools/compare_local_harness.py) accepts
`--harness v6` and an explicitly selected baseline. A full development comparison
keeps the same six tasks and independent checks, matched 180-second episodes,
sixteen requests, 2,048 output tokens per request, serial execution and no quality
retries. Independent checks stay outside the model workspace. These repeatedly
inspected development tasks cannot establish general model superiority.

The a21 [focused validation summary](local-harness/v6-diagnosis-20261020/validation-a21.json)
records 162 installed fast and thirteen focused workflow tests, package parity for 173 runtime or
configuration files and 138 test/fixture files. A separate
[wire audit](local-harness/v6-diagnosis-20261020/previous-profile-wire-a21.json)
found 72 byte-identical transformations across twelve captured first requests
for default behavior and v1–v5. This is bounded compatibility evidence, not a
claim about every transcript or a full-suite result.

The earlier a20 mechanism evidence remains historical. Its partial study was
[stopped after a transport review](local-harness/v6-diagnosis-20261020/aborted-a20-study.json),
and all quality credits from that run are excluded. The fresh a21 study is separate.

See the [development diagnosis](local-harness/v6-development-diagnosis-20261020.md)
for retained negative v4/v5 findings and the remaining evaluation gates. No
coding-performance gain or qualification is claimed by these mechanism checks.
