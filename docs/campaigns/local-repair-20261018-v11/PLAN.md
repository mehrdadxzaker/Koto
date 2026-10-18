# Devstral v11: concise native instructions and efficient local tool use

The owner authorized one revised Devstral canary at eight requests, 90 seconds
and 512 output tokens per generation, followed by qualification only if it
passes. Prior failed treatments remain immutable. The revised setup is a
separately frozen client instruction profile, not a retry of v10.

## Measured problem and bounded correction

[V10](../local-repair-20261018-v10/OUTCOME.md) executed tools, edited the actual
file and passed independent assertions, but expired during request seven before
normal native completion. The engine reported 38.9 seconds processing its first
6,847-token prompt and approximately 7.7–7.8 generated tokens per second. One
invalid patch, a missing-file read and a file search consumed earlier calls.
Gateway overhead was about 0.22 seconds across seven requests.

The ranked explanations and predictions are:

1. Initial prompt volume consumes much of the deadline. A concise native base
   instruction file should reduce tokenized input; only the canary can establish
   the actual time saved.
2. Extra tool rounds and malformed patch arguments consume generation time.
   Task-independent guidance to read once, combine an edit and self-check, use
   simple permitted file writes and finish promptly should reduce those costs.
3. Dense-model generation speed remains a constraint. Retaining the exact model
   and runtime makes remaining generation latency visible rather than attributing
   an unmeasured speedup to new engine flags.

The [preparation test](check-preflight.py) first failed on v10's retained real
native/engine receipt: 6,833 input tokens exceeded a declared 4,000-token target.
After the client change, actual native capture and the real engine's public
token endpoint report **3,356 tokens**, approximately 51% fewer. All seven native
tool definitions are unchanged and all native text chunks render in order.
This is a token-volume correction, not evidence of measured repair latency or
model quality. The slightly different v10 actual-canary token count remains
retained rather than substituted for the preflight comparison.

V11 supplies [client-instructions.txt](client-instructions.txt) using the native
CLI's `model_instructions_file` override for this disposable session. The
[official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
defines it as a replacement for built-in instructions. The exact captured
request proves that the pinned 0.160.0 binary loaded the file; it removes only
its terminal newline. The earlier exact-byte assertion and this specific
difference are recorded in [instruction loading](instruction-loading-control.json).
The router does not rewrite requests or model output.

[Developer guidance](developer-instructions.txt) describes the actual disposable
workspace, structured shell calls, macOS/Python behavior, concise checks and
normal completion. It contains no case-specific answers, checker code or
reference implementation. The kernel sandbox, no-network rule, private checker
isolation and instruction/tool drift guards remain authoritative.

## Fixed setup and budget

- Native Codex 0.160.0, Darwin arm64, Mac17,2 with 32 GiB physical memory;
  native SHA-256 `112fae7a5a1223e673c8a1791d32338f37df8b527ff1159bb8adac6c4dbf1b4b`.
- Existing llama.cpp b11617-14310190c archive SHA-256
  `051bb0b55b3e5e72081aa819131ba30c74d910acc915b28bab298757472e39d9`.
  Product source remains `d006beb6a21e527c01692b7591c62aa820fea41f`.
- Same verified template-compatible Devstral Small 2 Q4_K_M artifact:
  14,334,439,200 bytes, SHA-256
  `a09fc328cf64127938c18afc2e94eaa66996a21ffce44c417cb40a8946adf899`.
  Alias `Devstral-Small-2-24B-Instruct-2512-Q4_K_M-codex-roles-v1`.
  Original publisher GGUF, metadata-only derivative, role correction, applied
  template and tensor-preservation receipts remain unchanged and local weights
  are not published. No new model download is needed.
- `managed-llama.v1` flags are unchanged: context 32,768; one slot; four
  inference/batch threads; two HTTP threads; no thinking; temperature 0.7;
  top-p 0.8; top-k 20; min-p 0; presence penalty 1.5. No custom runtime flags,
  prefill warm-up, hidden completion, sampler change or latency benchmark.
- At most **8 model requests / 90 seconds / 512 output tokens per generation**
  per episode; one episode at a time; zero quality and transport retries.
  No cloud destination, fallback, answer-cache hit or extra classifier inference.
  Engine prompt-cache reuse within a turn is distinct from answer caching.
- Freeze exact assets, source, client/driver instructions, actual native
  instruction/tool profile, task/check inventory, private references, collection
  and checker code, controls and budget. Publish the reviewed checkpoint before
  the sole actual-model canary. Preparations and supplied responses have zero
  actual-model completions and cannot count toward qualification.

## Qualification and acceptance

The corpus contains the same four development cases and twelve newly authored
held-out tasks, three each for arithmetic, text, collections and validation/state.
All sixteen baselines fail by assertion exit 1, and independently authored
reference implementations complete unchanged assertions with exit 0. References
remain private and outside native read/write roots. Freshness and family coverage
are recorded before any v11 completion.

Run only `dev-clamp` first. A pass requires actual native tool execution, a safe
implementation edit, retained patch digest, unchanged independent checks,
completed assertions with exit 0, and normal native exit 0 plus `turn.completed`
within 90 seconds. Inspect its exact code, patch, native events and results for
oracle, assertion, process or receipt interference. A fresh checker completion
token is only an early-exit guard, not an adversarial security boundary.

Only that protected, hash-bound inspected pass unlocks the remaining three
development and twelve held-out episodes. Run them once each, sequentially,
without tuning, dropping cases, relaxing bounds or retries. All sixteen planned
cases must pass and have independent protected inspections. A later failure is
retained and prevents qualification. Changed instructions, model/runtime or
controls need a new campaign and fresh held-out inventory.

Keep hard local-only, unknown coding readiness and empty automatic task lists
throughout collection. Revoke every probe and disconnect in finally-based
cleanup; close owned sockets, threads, engine and router. Only project/tool-temp
directories are writable. Preserve the owner's live Codex configuration and all
older evidence. No live connection, global setting change or automatic coding
activation is authorized by this experiment. Even a passing receipt applies only
to this exact overridden instruction profile, not an unmodified Codex session.
