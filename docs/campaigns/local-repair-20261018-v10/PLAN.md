# Devstral Small 2 native coding campaign

The owner authorized preflight and setup freeze, then one canary at eight
requests, 90 seconds and 512 output tokens per generation. Only a passing,
independently inspected canary authorizes the remaining qualification cases.
Preparation and native supplied controls are not model-quality evidence.

## Fixed execution envelope

- Codex 0.160.0, Darwin arm64, Mac17,2 with 32 GiB physical memory; native binary
  SHA-256 `112fae7a5a1223e673c8a1791d32338f37df8b527ff1159bb8adac6c4dbf1b4b`.
- Existing llama.cpp b11617-14310190c archive SHA-256
  `051bb0b55b3e5e72081aa819131ba30c74d910acc915b28bab298757472e39d9`.
  Its declared source includes Mistral's required attention fix, recorded in
  [runtime compatibility](runtime-compatibility.json). This is source ancestry,
  not a substitute for actual engine preflight.
- Product source remains `d006beb6a21e527c01692b7591c62aa820fea41f`.
  `managed-llama.v1` remains unchanged: 32,768 context, one slot, four inference
  and batch threads, two HTTP threads, thinking disabled, temperature 0.7,
  top-p 0.8, top-k 20, min-p 0 and presence penalty 1.5. These are the existing
  managed profile, not a claim to reproduce Mistral's example sampling settings.
- Start with the pinned [publisher artifact](candidate-artifact.json): Bartowski
  Devstral Small 2 Q4_K_M, 14,334,438,272 bytes, declared SHA-256
  `bfd11c8679c6b81eb43763505465d7dcfa72e460ab1c220ecc235a3efadd7f7f`.
  One download stream, at most 16 GiB and 1,800 seconds, zero automatic retries,
  then full SHA-256 verification. Preserve original assets and all prior trials.
- Test the stock GGUF through native capture and the real engine's public
  token/render endpoints with zero completions. Preserve any template rejection.
  A demonstrated protocol/template correction must be reproduced before the
  fix, keep all instructions and tools, and be separately identified and sealed
  before the single actual-model canary. Do not silently rewrite native requests,
  model output or tool arguments. Final pins/profile/manifest are authoritative;
  an unverified download or prepared candidate is not a frozen setup.

## Demonstrated template correction

The [stock preflight](stock-preflight/preflight.json) failed at the real
Responses token endpoint with HTTP 500: its Jinja template requires alternating
user/assistant roles. Native Codex supplies adjacent developer/instruction and
user-environment/task messages. No completion request was sent, and owned
listeners/settings were restored.

The [compatibility preamble](codex-role-preamble.jinja) coalesces adjacent
messages of the same system or user role, retaining their complete content
chunks in order and inserting a separator. It leaves assistant/tool messages,
function names and argument objects untouched. The pinned engine already maps
developer to system; this patch introduces no new role promotion. The existing
template still rejects a system message appearing after conversation content.

The [derived artifact](effective-artifact.json) is **14,334,439,200 bytes**,
SHA-256 `a09fc328cf64127938c18afc2e94eaa66996a21ffce44c417cb40a8946adf899`.
Only `tokenizer.chat_template` and alignment padding differ from the verified
publisher GGUF. All **363 tensor records and every tensor-data byte** were
compared and are identical, as recorded in the
[derivation receipt](template-derivation-receipt.json). Both original and derived
files remain private and are included in the frozen input manifest. The alias
explicitly identifies `codex-roles-v1`; qualification cannot transfer to stock
Devstral or another template digest.

The unchanged pinned runtime also applies its existing Mistral empty-assistant
guard workaround. An initially over-strict preflight compared raw metadata to
that applied source and stopped before native capture; its
[failed guard](preflight-template-guard-failure.json) and
[exact source difference](template-property-inspection.json) remain retained.
The final guard requires the exact, independently observed applied-template
digest `2803457b078a1a505614f50c8d02333de0804a227b71531c8e050eda0ffdfb55`.
It does not accept arbitrary differences or change the runtime flags.

The corrected [native preflight](preflight.json) passes the actual engine token
and render endpoints: 6,833 input tokens, all six native text blocks preserved
in order and all seven tools present. The
[protocol controls](protocol-controls.json) additionally use the converter's
exact typed text shape and supplied tool continuation. Both render, the native
continuation tokenizes, and a late system message stays rejected. All these
preparations have zero completion requests and are not model-quality evidence.

## Independent outcomes and limits

The [corpus](corpus.json) contains four development cases and twelve newly
authored held-out cases, three per family: arithmetic, text, collections and
validation/state. The canary is `dev-clamp`. The other fifteen run once each,
sequentially, only after its passing protected operator inspection. There are no
quality/provider retries, tuning on held-out results, dropped cases or relaxed
budgets. Changing a treatment requires a separately frozen version and fresh
held-out tasks. All outcomes remain in the denominator.

A pass needs an independently observed baseline assertion exit 1, actual safe
implementation edit and retained patch digest, unchanged frozen independent
checks, completed post-edit assertions with exit 0, real native tool execution,
and normal native exit 0 within 90 seconds. Exit 0 alone or a checker pass alone
is insufficient. Completion tokens are an early-exit guard, not a security
boundary: inspect every exact implementation/patch for oracle, process,
assertion or receipt interference, binding the result and file hashes in a
protected record. All sixteen inspected passes are required for qualification.

Private references and checkers remain outside native read/write roots. Tools
deny other temporary generations, this source checkout, the private preparation
directory and the owner's real Codex directory. Only the disposable project and
tool-temp directories are writable. Keep the reviewed current-date probe-plan
binding and permitted zsh temporary environment. Freeze the actual native
instruction/tool profile, case/check hashes, source, runner, assets and budgets
and publish the reviewed checkpoint before inference.

Keep hard local-only, no cloud/fallback, answer cache disabled, one owned engine
and native episode, bounded trace/checker output and finally-based revocation,
disconnect and process cleanup. Preserve the owner's live Codex settings. Probe
permission changes no automatic admission; no live connection, settings change
or automatic coding activation is authorized by this campaign. A complete
passing receipt, if obtained, remains subject to separate activation scope.
