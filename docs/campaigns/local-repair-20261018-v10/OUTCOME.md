# Devstral executed a real repair; the bounded canary failed

The single authorized actual-model canary ran after the reviewed freeze at
`282980a9efdc4da47ef62fb3f00efebd5082cef0` and the
[published checkpoint](https://github.com/mehrdadxzaker/hormuz/issues/569#issuecomment-6252110449).
It used the derived Devstral Small 2 Q4_K_M artifact, native Codex 0.160.0,
the pinned llama.cpp runtime and unchanged managed profile. The limits remained
eight requests, 90 seconds and 512 output tokens per generation, with zero
quality or transport retries.

**The canary failed `local-repair.v1`.** Codex executed real tools, applied the
correct `solution.py` edit and passed the unchanged independent checker:
baseline assertion exit 1, post-edit exit 0 with every assertion completed.
However, the probe expired during the seventh streamed model response, before
the final function call completed or Codex finished its turn. Native Codex
reported `turn.failed`, exited 1 and measured 90,057 ms including shutdown and
polling overhead. There was no `turn.completed`.

The elapsed limit, rather than the eight-request cap, stopped this trial.
The remaining three development and twelve held-out cases were not run.
There are zero accepted canary passes from one attempted canary, with fifteen
planned cases still gated. No qualification receipt was installed and automatic
coding remains disabled. A correct edit and checker pass do not override the
normal-completion requirement.

## What the trace establishes

The first six Responses streams completed with structured `exec_command`
calls. Each call's name and exact argument string appear unchanged in the next
native request. Codex recorded four completed command-execution items and one
completed file-change item. One earlier patch was rejected by Codex's patch
verification before a file-change item was emitted. No assistant text was
converted into an executable call by the router.

The model read `solution.py`, tried a nonexistent `test_solution.py`, searched
for Python files, then supplied a patch with a missing context-line prefix.
Codex returned the patch error in the next model input. The model corrected
the patch on request five and read the correct implementation on request six.
The inspected implementation contains only the requested pure clamp function;
there is no oracle, assertion, process or receipt manipulation.

The seventh stream was generating a Python self-check heredoc when the elapsed
budget expired. The partial arguments never became a completed function call
and that check did not execute. The independently run checker is separate from
this unfinished model-generated self-check.

Engine timing reports show **38,856.812 ms** processing the first **6,847-token**
prompt. Complete generations ran at approximately **7.7–7.8 tokens/second**;
the largest complete generation used **94 tokens**, below the fixed 512 cap.
Public gateway receipts report 89,151.297 ms of summed provider intervals and
221.326 ms of gateway overhead across seven attempts. These are engine and
gateway measurements, not attribution to individual hardware components.
There were no gateway answer-cache hits, retries, failovers, trace errors or
destination changes. Engine prompt-cache reuse is recorded separately. The
unfinished stream has no final usage record, so its final token
count is unknown.

The stock template rejection was an integration mismatch reproduced without
model completion. The metadata correction removed that demonstrated blocker
and this trial proves executable tools, a real edit and independent assertions
on the corrected model/runtime/Codex combination. It does not demonstrate a
passing repair within the fixed envelope. The observed remaining constraints
combine prompt/generation latency and inefficient tool use. Unparsed model
tokens were not retained, and this does not uniquely attribute the older v7
failure or prove general model capability.

## Retained evidence and boundaries

- [Exact requests, public SSE, native events, edit and independent result](actual-canary/dev-clamp/result.json).
- [Per-submission analysis and engine timing](native-analysis.json).
- [Independent failure inspection bound to result, implementation and patch](failure-inspection.json).
- [Stage result, public routing/work state and disconnect receipts](canary-result.json).
- [Post-trial frozen-input and settings audit](post-trial-audit.json).

All 245 frozen inputs were rehashed unchanged after the trial, including both
original and derived model artifacts. The stock-template failure, preparation
guard failure, previous v7/v8/v9 trial evidence and original weights remain
preserved. The private reference implementations and model weights stay local.

Hard local-only enforcement, unknown coding readiness and an empty automatic
task list remain in effect. The probe was revoked, the owned engine/router
stopped, both owned listeners closed and isolated settings were restored.
The owner's live Codex configuration remained byte-identical. Product code
and live settings were not changed.

A subsequent experiment would require a separately frozen treatment and new
attempt authorization. The measured latency and patch efficiency should guide
that treatment; this consumed canary must not be retried, given a larger budget
or relabelled as a qualification pass.
