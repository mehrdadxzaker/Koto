# Separately bound Qwen Coder candidate

`qwen_code_v13` explicitly selects `qwen-code.v13` for the existing
Qwen3-Coder-30B-A3B-Instruct-Q4_K_M model through `codex_llama_v1`. It is
default off and unqualified. V13 keeps the exact v12 guidance, v8-derived
transport, native tools, script compiler, checkpoints and compute controls.
The only treatment change is a separately bound model. Earlier profiles remain
bound to Qwen3-14B-Q4_K_M and retain their previous behavior and failures.

The two October 22 14B campaigns failed their first development correctness
case. V12 also failed normal native completion. The older October 19 Coder
canary passed its unchanged independent checker but exhausted eight requests
before normal completion. None establishes qualification for this candidate.

The owner authorized one new bounded Coder campaign with four development and
twelve fresh held-out cases, 90 seconds and eight serial submissions per case,
at most 2,048 output tokens per generation and zero quality retries. Stop at the
first failing development case, preserving all planned unrun cases. Each pass
requires a safe saved edit, unchanged independent checks and normal native
completion. Freeze and preregister the exact setup, corpus, checks, artifacts
and budgets before inference; keep separate denial/cancellation controls.

Use the existing weights in place. No download, copied model, commercial
evaluation, live history collection or automatic coding admission is included.
Dispose of task-created execution environments after preserving compact evidence.
Native Codex retains instructions, tools, permissions, sandbox, execution,
continuations and the agent loop. No solution or independent checker enters
model instructions. The complete personal-selection, consent, measured benefit,
provider/client/plugin and fresh-user contract remains required for publication.
