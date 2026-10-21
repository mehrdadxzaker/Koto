# Native Python verification and reasoning continuation

`qwen_code_v8` explicitly selects the experimental `qwen-code.v8` profile for
Qwen3-14B-Q4_K_M alongside `codex_llama_v1`. It is default off. V1–v7 retain
their existing request contracts. Codex continues to own instructions, tools,
approvals, sandboxing, execution, continuation and the agent loop.

## Changes from v7

The typed check-data interface required the model to express ordinary Python
tests through a second language. V8 instead offers a derived Python script tool
only when the original native execution declaration is uniquely recognized.
The model supplies one `script` string with actual newlines and an optional
unchanged `workdir`. Koto quotes the script into `python3 -c` and returns the
ordinary native execution call. It does not execute or rewrite the script,
import the target, infer expected values, fabricate results, or add an agent
loop. Assertions and coverage remain the model's responsibility.

The script must be nonempty UTF-8 without NUL, at most 32 KiB. The compiled
command remains bounded to 128 KiB. The native declaration, namespace, automatic
tool choice, collision, transport and authority restrictions from
[v7](LOCAL_QWEN_HARNESS_V7.md) still apply. The helper cannot add permission,
shell, login or approval fields. Raw helper arguments are withheld from native
streaming; validated compiled arguments appear under the original host tool.

Shorter guidance asks for checks against the saved function, state preservation
after an expected exception, cumulative repeated operations, and equality for
supported unhashable values. Progress counts are observations of native tool
envelopes. They do not prove that assertions ran or that a repair is correct.

A correlated nonzero native command that reports `AssertionError` receives
static advice to inspect actual and expected values against the specification.
It asks for compact failure diagnostics and permits correcting an authored
expectation only when it contradicts that specification. It does not copy
program output into instructions, change checks, rewrite results or infer that
the implementation is wrong. Unbound feedback, successful commands and later
unfinished calls cannot inherit this advice from an earlier failure.

V8 also assigns bounded reasoning allowances by the client's requested effort:
minimal 128, low 256, medium 512, and high or above 1,024 tokens, subject to the
existing output-token cap. Explicit `none` remains zero. For native list input
at low or minimal effort, an initial request without tool history receives at
most 32 tokens; a completed source read retains the full solving allowance;
the latest correlated saved patch receives at most 64 tokens for choosing
verification. After a successful completed post-edit command, at most 16 tokens
leave time for reporting. Errors, unknown results, unresolved calls and pending
sessions retain the solving allowance. Initial and post-patch caps do not apply
to string input or medium and higher effort. These are compute hints, not tool
choice, proof that assertions executed, or a correctness gate.

## Reasoning continuation repair

A real low-effort episode exposed a router defect after its first successful
native command: the bounded coding probe rejected the client's cleartext
reasoning continuation with `probe_request_mismatch`. The native adapter already
supported that item type. For probe schema four or newer, the combination of
`qwen_code_v8` and `codex_llama_v1` now permits validated text-only reasoning
items in the appended history. Opaque or nonempty encrypted content, malformed
parts, unknown fields, incomplete items, altered prefixes and replay still fail
closed. Other profiles retain their prior probe rules.

Public workflow tests exercise first submission, rejected opaque continuation,
accepted cleartext continuation, replay rejection, ordinary unqualified coding
rejection and disconnect. The test provider uses no inference. This proves the
continuation boundary, not local-model quality.

## Comparison and rollback boundary

The comparison runner records an explicit `--reasoning-effort` control in its
frozen plan; its default remains `none`. Native effort `low` therefore identifies
a changed test control and must not be presented as a harness-only improvement
over earlier `none` runs. Independent checks and normal native turn completion
are both required for a passing episode. A correct saved file followed by a
timeout is a failed episode.

Use the existing setup and disconnect workflow with a reviewed setup-v5 profile
selecting `qwen_code_v8`. Disconnect before changing profiles. Previous evidence
does not qualify this profile or migrate an in-flight conversation. The repeated
development tasks and their 180-second bound do not establish the separate
90-second ordinary coding qualification, held-out benefit or automatic routing
readiness. No normal client settings or history consent are changed by the
disposable comparison homes.
