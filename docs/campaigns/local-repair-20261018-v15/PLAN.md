# V15: one bounded native repair with goals disabled

The owner authorizes one new canary at **8 model requests / 90 seconds /
512 output tokens per generation**, followed by the other three development
and twelve held-out cases only after an independently inspected canary pass.
Use one native episode at a time, with zero quality or transport retries.

This supports admission to Koto's personal model selection pool. It does not
collect personal history, train the selector, install a qualification receipt,
activate automatic coding, reconnect the owner's client or change live settings.

## Frozen setup

- Reuse Qwen3-Coder-30B-A3B-Instruct Q4_K_M, SHA-256
  `fadc3e5f8d42bf7e894a785b05082e47daee4df26680389817e2093056f088ad`.
  Reuse existing assets; do not download or modify weights.
- Codex CLI 0.160.0, SHA-256
  `112fae7a5a1223e673c8a1791d32338f37df8b527ff1159bb8adac6c4dbf1b4b`.
  Pass **`--disable goals` on each invocation**. Keep the existing four tools:
  `exec_command`, `write_stdin`, `request_user_input`, `view_image`.
  Disable multi-agent execution and web search; retain approval policy `never`.
- Existing llama.cpp b11617 runtime archive, SHA-256
  `051bb0b55b3e5e72081aa819131ba30c74d910acc915b28bab298757472e39d9`.
  Keep `managed-llama.v1`: one slot, context 32768, four inference/batch threads,
  two HTTP threads, no thinking, temperature 0.7, top-p 0.8, top-k 20,
  min-p 0, presence penalty 1.5. Keep the exact original model chat template.
- Use the verified 2.0.0a4 wheel from protected main
  `d9a137b9af2b585ed4c1e006b5afa9182c3c4ba6`, wheel SHA-256
  `5297a50a5c740dcbac0423328315892a30a7e651a8fb13aa0c0cfab9cb6ca34e`.
  Its runtime sources match that main commit. This is a distinct setup from
  V14's older router snapshot; do not attribute an outcome to the flag alone.
- Keep V14's task-independent client/developer guidance byte-for-byte.
  No supplied repair, response rewriting, speculative decoding, prefill warm-up,
  extra completion, answer cache, helper inference or commercial destination.

## Preparation and freeze

Capture the actual native request through an intentionally rejecting loopback
endpoint with no model dispatch. Assert exactly four function tools, zero goal
tools, the exact original template, native text preserved in order and an initial
request within the 4000-token preparation target. The old seven-tool request
must fail this profile check. Tokenize/render a supplied typed continuation
without generating it. Keep every preparation rejection; none consumes the
single real-model canary authorization.

Run each independent checker against its broken baseline and private correct
reference. Every baseline must fail by assertion; every reference must finish
assertions successfully. A fresh completion marker guards early process exit.
Checkers and references stay outside native read/write permissions. They are
not model-quality evidence. Review held-out behaviors against the full prior
inventory; different names or hashes alone do not establish freshness.

The frozen manifest binds client/runtime/model/wheel, installed package files,
all guidance and tool schemas, native context, exact cases/checkers, private
references, preparation controls, runner dependencies, owner grant and budget.
Obtain separate Spec and Standards/technical-lead approval before inference.
Record the reviewed local Git checkpoint and manifest hash in protected
preregistration, outside native writable roots. Publish only a metadata checkpoint
to #569; raw native requests, private references and settings contents stay local.
Refuse changed inputs, an existing stage marker or a second canary launch.

## Isolation and acceptance

Use a new private client home and owned local-only gateway/runtime. Configure
only local destinations; preserve unknown ordinary coding readiness and empty
automatic task lists. Tools may write only the disposable project and temporary
directory. Deny tool network access and reads of the owner's Codex home, source
checkouts, other temporary generations, independent checkers and references.
The independent checker separately denies network access and file writes, and
allows file content reads only for interpreter/system support and its active
checker/solution pair. Disable Python site initialization. Prove read denial
with owned synthetic sentinels in the user home and outside the active inputs;
retain the failing pre-correction control and revalidate all sixteen checkers.

Keep four development tasks for comparison, starting with `dev-clamp`. The twelve
held-out cases cover three new behaviors each in arithmetic, text, collections
and validation/state. Freeze all sixteen before the canary; do not retune, drop
failed cases, repair outputs as operator, loosen limits or retry any case.

A pass requires an assertion-failing baseline, real native tool execution, a safe
actual edit, unchanged independent assertions completed with exit zero, and a
normal native exit with exactly one `turn.completed`, no top-level `error` or
`turn.failed`, within the declared request/time/token limits. HTTP success,
process exit alone, narrated edits or checker-passing code after budget
exhaustion do not pass. Inspect the exact patch, native events, response usage,
tool history and independent completion receipts; rule out harness interference.
Keep the protected inspection hashes outside native writable roots.

Only that accepted canary unlocks the other fifteen episodes, run once each
sequentially. All sixteen cases require the same protected acceptance for a
passing qualification result. A failure remains in the denominator. Freeze a
separate authorized treatment for any later change; preserve this result.

Always revoke the probe and disconnect in finally cleanup. Verify isolated
settings restoration, owned listener/process termination, unchanged frozen
inputs, unchanged failed predecessors and the current live settings fingerprint.
Retain current external user settings changes instead of restoring an old file.
No automatic admission, passing-receipt installation or experiment PR merge is
authorized by this run.
