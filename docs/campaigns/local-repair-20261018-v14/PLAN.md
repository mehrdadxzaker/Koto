# V14: faster sparse local coder with the concise native Codex profile

The owner authorized selection, preflight and freezing of one faster local model,
then **one canary at 8 requests / 90 seconds / 512 output tokens per generation**.
Only a protected, independently inspected canary pass unlocks the remaining
qualification cases. All prior failures, local-only enforcement and the owner's
live Codex settings must remain unchanged.

V13 was frozen but never used for model inference. Independent review found
two confounded negative assertions. Its [unrun disposition](../local-repair-20261018-v13/UNRUN.json)
preserves every original frozen input. V14 replaces that preparation before the
sole model attempt, inheriting the same twelve still-unexposed held-out tasks
and strengthening only the two checkers. No model outcome informed the change.

## Candidate and predictions

Select the existing, pinned **Qwen3-Coder-30B-A3B-Instruct Q4_K_M** artifact.
The [publisher model card](https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct)
describes 30.5 billion total / 3.3 billion activated parameters, a non-thinking
mode and a dedicated function-call format. The selected community quantization
is 18,556,689,568 bytes with SHA-256
`fadc3e5f8d42bf7e894a785b05082e47daee4df26680389817e2093056f088ad`,
at the retained Unsloth revision `b17cb02dd882d5b6ab62fc777ad2995f19668350`.
No new download, weight edit or template override is needed.

[Selection evidence](candidate-selection.json) uses the retained v9 same-machine
native trial: eight executable structured calls in 28.534 seconds, with observed
decoding from 35.26 to 36.77 tokens/second (median 36.34), versus approximately
7.8 for Devstral v12. V9 made a correct edit and passed independent assertions,
but exhausted requests after malformed patch bodies and a nonportable shell
flag. It remains a failure. V12 Devstral's real canary pass and failed 5/16 full
qualification also remain unchanged. Existing transport evidence and speed
motivate this choice; they do not qualify the revised setup.

The ranked predictions, recorded before inference, are:

1. Switching from dense Devstral to this sparse coder will increase actual
   decoding throughput under the same managed runtime profile.
2. Reusing the exact concise v12 native/client guidance will reduce Qwen's
   initial 7,016-token v9 request and wasted patch/shell rounds. The guidance
   permits simple whole-file writes and concise behavior checks.
3. Model mistakes and unnecessary rounds may still prevent bounded completion.
   Any such result remains a failure; it does not trigger another attempt.

## Fixed execution envelope

- Native Codex 0.160.0, Mac17,2 / Darwin arm64 / macOS 26.2 / 32 GiB RAM.
  Client executable SHA-256
  `112fae7a5a1223e673c8a1791d32338f37df8b527ff1159bb8adac6c4dbf1b4b`.
- Existing llama.cpp b11617-14310190c, runtime archive SHA-256
  `051bb0b55b3e5e72081aa819131ba30c74d910acc915b28bab298757472e39d9`.
  Product source remains `d006beb6a21e527c01692b7591c62aa820fea41f`.
- Model alias `Qwen3-Coder-30B-A3B-Instruct-Q4_K_M`. The retained public engine
  template hash must match the actual preflight. Unlike the Devstral campaign,
  this treatment uses the original verified quantization without a derivative.
- Unchanged `managed-llama.v1`: context 32,768, one slot, four inference/batch
  threads, two HTTP threads, no thinking, temperature 0.7, top-p 0.8, top-k 20,
  min-p 0 and presence penalty 1.5. No speculative decoding, prefill warm-up,
  extra completion, sampler change or latency benchmark.
- Exact v12 [client instructions](client-instructions.txt) supplied with native
  per-invocation `model_instructions_file`, plus exact v12 task-independent
  [developer guidance](developer-instructions.txt). Native terminal-newline
  normalization is measured rather than inferred. All seven tool definitions
  stay unchanged. No assistant-text-to-command coercion or response rewrite.
- At most 8 model requests, 90 seconds and 512 output tokens per generation in
  each episode. One native episode at a time, zero quality/provider retries,
  failovers, answer-cache hits or cloud/helper inference. Engine prompt-cache
  reuse during a turn is distinct from answer caching.
- A fresh disposable client home; native network disabled; approval policy
  `never`; only the disposable project and tool-temp directory writable. Deny
  tools access to other temporary generations, this source checkout, the primary
  checkout, private checkers/references and the owner's real Codex home. Keep
  the prior macOS tool-temp fix and finally-based owned-process cleanup.

The live configuration's initial fingerprint is 11,790 bytes / SHA-256
`428f5d89b103c14d4ad0f3e626dd96f3d6c8104c9fa94371b9db95277a617388`.
Do not write or publish its contents. The model runs exclusively through the
disposable Codex home and owned local router/runtime.

## Preparation, freeze and acceptance

Preparation uses native capture with a deliberate local 503 and public engine
metadata/token/render endpoints only; no generated completion or warm-up is
allowed. Verify original artifact hashes, exact effective template, native text
order, all tools, first-turn conversion and a supplied typed tool continuation.
Qwen's supported role semantics are observed directly; a Devstral-specific
late-system rejection must not be falsely attributed to Qwen. Supplied native
function/tool/isolation controls are transport evidence, not model quality.

The preflight-volume test first fails on retained v9 input (7,016 > 4,000).
The older receipt lacks an explicit all-text-order observation, which remains
unknown instead of being invented. Actual revised preflight passes at **3,595 tokens**, under the
4,000-token preparation target, preserving all six native text blocks and seven
tools. Exact typed first-turn and supplied tool-continuation render/token
controls pass with zero completions; the supplied continuation is 3,641 tokens.
The original Qwen template accepts a later system role, as recorded; this is
not a permissions change. Native supplied-function isolation control executes
one real command, makes a safe edit and passes independent assertions while
private inventories remain unreadable and outside writes are denied.
The earlier V13 checker preparation attempt was prevented by the outer command
sandbox: every child exited 71 before assertions. Its original diagnostic is
retained unchanged. V14 runs each checker in its own independent sandbox,
outside the outer command sandbox; all sixteen baselines fail by assertion and
all sixteen private correct references finish assertions successfully.

The [sensitivity red control](checker-sensitivity-red.json) shows two deliberately
wrong implementations passing the original V13 checkers: a date validator that
accepts otherwise-valid day=True and a key renamer omitting source validation.
The [green control](checker-sensitivity-green.json) runs the identical fixture
bytes against V14. New unconfounded cases reject day=True, an existing integer
source key and an existing empty-string source key by assertion exit 1. Every
correct reference still passes. The fixtures, references, checker sources and
controls are frozen before any model inference; none are model-quality evidence.

The corpus keeps four fixed development tasks and declares twelve distinct new
held-out behaviors, three per arithmetic, text, collections and validation/state
family. Independent semantic review confirms all twelve behaviors differ from
the 108 goal records preceding V13, including earlier unrun preparations. V14
explicitly inherits the twelve tasks of its unrun V13 predecessor: its freshness
record includes all 120 prior goal records and classifies that single preparation
lineage rather than falsely claiming different task hashes. Distinct bytes alone
are insufficient. Independent literal
assertions and private correct references must distinguish every broken baseline
before inference. References and checker storage remain outside tool permissions.

Freeze hashes for model/runtime/client, installed product source, effective
instruction/tool profile, native context, exact case/check inventory, private
references, collection/checker code, controls, ownership grant and budgets.
Obtain exact-head Spec and Standards/AI technical-lead review and publish the
reviewed checkpoint before the sole canary. Then record the checkpoint and
fingerprints in protected preregistration before any actual model submission.

Run `dev-clamp` once. A passing canary needs real native tool execution, a safe
actual implementation edit and patch digest, assertion-failing baseline exit 1,
unchanged independent assertions completed with exit 0, and normal native exit 0
with exactly one `turn.completed`, no top-level `error` or `turn.failed`, within
90 seconds. Merely exiting zero or producing checker-passing code is insufficient.
The fresh checker completion marker guards premature exit but is not an
adversarial security boundary. Protected hash-bound operator inspection of the
exact implementation, patch, results and native events is mandatory before any
case can pass or unlock the remaining battery.

Only an accepted canary unlocks the remaining three development and twelve
held-out episodes. Run all fifteen once each, sequentially, without retuning,
operator repair, oracle edits, dropped cases, retries or relaxed limits. Every
one of the sixteen cases must pass and receive protected inspection for a
passing qualification record. Preserve all unsuccessful results. Any change to
the frozen setup requires a separately authorized campaign and fresh held-out
tasks. A pass applies only to this exact overridden native instruction profile.

Keep local-only, unknown coding readiness and empty automatic task lists while
collecting evidence. Revoke every probe and disconnect in finally cleanup;
restore the isolated settings and stop owned listeners/runtime/router. Rehash
all frozen inputs and the live configuration after collection. No passing
receipt installation, live reconnect, global settings change, automatic coding
activation or PR merge is authorized by this experiment.
