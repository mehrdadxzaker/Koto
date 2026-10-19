# V16: complete tool arguments and one focused check

The owner authorized one revised canary on October 18, 2026, with the other
three development and twelve fresh held-out cases gated on an independently
accepted canary. Every case has eight forwarded model requests, 90 seconds and
512 output tokens per generation, zero quality/transport retries and one native
episode at a time. No commercial evaluation or automatic coding activation is
authorized. Goals and multi-agent features remain disabled for this run only.

## Treatment and behavioral tests

Keep Qwen3-Coder-30B-A3B-Instruct Q4_K_M, llama.cpp b11617, the original chat
template and managed-llama.v1 sampling/context settings. Keep Codex 0.160.0 and
its four unchanged function tool schemas. Use the newly built router wheel from
the correction in this branch; its exact SHA and source commit are frozen.

V15 reached its generation limit inside two function argument strings. It
delivered them as completed calls, then their unchanged native parse-error
continuations reached a local HTTP 500. The ordinary function path lacked the
argument validation already present for custom calls. The TDD correction
rejects malformed completed function items/argument-done frames and malformed
input replay before provider dispatch. Valid argument strings, partial deltas,
tool identities and destination affinity remain preserved. A malformed
dispatched response leaves the accounting outcome unknown. The gateway never
fills in missing JSON, executes tools, invents success or retries the request.

The second treatment change is task-independent developer guidance: short
complete tool calls, separate editing from checking when needed to fit the
generation limit, import the edited function in one concise behavior check,
inspect the result, and finish immediately after success. No task solution,
private checker or reference is provided. Supplied-response tests establish
protocol behavior; only the real canary/qualification can establish model
adherence or efficiency. This combined treatment cannot isolate the effects of
guidance versus the router change.

## Freeze, quality and isolation

Retain the four development tasks for comparison. The twelve held-outs contain
three new goals per family: arithmetic, text, collections and validation/state.
Compare their meanings and task hashes against all retained cohorts including
V15. All new built-in-int contracts explicitly test bool and int subclasses.
Verify sixteen assertion-failing baselines and sixteen completed correct
references before freezing. Retain any preparation mistakes and corrections.

Freeze the client, runtime, weights, template, wheel/installed modules, native
request envelope, actual four schemas, instructions, exact corpus and private
checkers/references, controls, dependencies, owner grant and limits before any
model request. Save a protected manifest/plan checkpoint with zero prior model
completions. Never retune, drop a case, alter a checker or retry an episode after
freeze. Previous campaigns and failed evidence remain unchanged.

Use a fresh private HOME/CODEX_HOME and an owned local-only connection. The only
destination is local; ordinary coding readiness stays unknown and automatic
task types stay empty. Deny tool network access, escalation and reads of source,
private references/checkers, other temporary generations, the live Codex home
and the durable ~/.local/share/koto-evidence archive. Tools may write only the
disposable project/temp directories. The independent checker separately denies
network/writes and reads outside interpreter/system support and the exact
active checker/solution pair. Python site startup is disabled. An unpredictable
completion token guards against premature exit; operator inspection must also
rule out interference in the shared checker interpreter.

A pass requires an assertion-failing baseline, actual native tool execution and
a safe actual edit, unchanged independent assertions completed with exit zero,
native exit zero with exactly one turn.completed and no turn.failed/error,
within all budgets. HTTP/process exit zero alone is insufficient. Inspect the
exact patch, native events, tool/continuation trace, usage and receipt, recording
hashes outside native writable roots. Only acceptance of dev-clamp unlocks the
other fifteen sequential episodes. All sixteen must be accepted for a passing
qualification; failures remain in the denominator. Do not install a receipt or
enable automatic coding even after passing this experimental campaign.

Always revoke probes and disconnect in finally cleanup. Verify owned listeners
and processes stopped, isolated settings restored, frozen/predecessor evidence
unchanged and the live Codex/dirty primary fingerprints preserved. Retain raw
native context, protected inspections and private checkers locally; publish
only inspected synthetic evidence and commitments. No merge is part of this run.
