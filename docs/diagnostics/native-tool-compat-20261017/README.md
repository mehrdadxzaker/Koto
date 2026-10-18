# Native tool-call diagnosis (#569)

The v7 request reached the engine with a tool-aware prompt. Codex received an
assistant message containing fenced JSON instead of a structured function call,
so it executed no command. The independent checker failed before and after.
The existing router must not promote arbitrary assistant text into commands.

## Evidence and limits

- The unchanged [v7 request](../../campaigns/local-repair-20261017-v7/captured-request.json)
  contains all seven flat Responses function definitions, `tool_choice=auto`,
  streaming and developer guidance. Its recorded input usage was 6,742 tokens.
- The pinned Qwen2.5-Coder GGUF has the Hermes tool-aware template retained here.
  With the same b11617 engine, zero-inference rendering includes every tool and
  developer instruction. Both the Responses counter and rendered prompt count
  are **6,742**, versus **4,900** without tools. This strongly weakens a missing
  template/tools explanation; it does not recreate the original completion.
- [Controls](control-results.json) use real pinned Codex and the real current
  router with a deterministic external runtime. Reconstructed v7 text and a
  minimal fenced command both produce **zero commands, no edit, checker 1**.
  The same minimal command as a Responses `function_call` produces **one
  executed command, an actual edit, checker 0**. These are supplied replies,
  explicitly **not model-quality evidence**.
- The v8 recorder control also passes through Codex's own permission profile:
  tools cannot read the independent checker or held-out inventory, and cannot
  write outside the disposable workspace. An earlier control retained here
  failed because the proposed outer macOS sandbox prevented Codex from starting
  its inner tool sandbox (exit 71). Removing that nested harness sandbox in
  favor of the client's permission profile corrects this preparation defect.
- Exact-head review then found readable answers in prior temporary generations
  and an early-exit false pass in the checker wrapper. The retained
  [red/green guard controls](guard-controls.json) reproduce both before the fix.
  Tools now cannot read other temporary generations or the primary checkout and
  live Codex home. A fresh checker completion receipt distinguishes raw process
  exit 0 from assertions actually finishing. The final supplied repair passes;
  the early-exit implementation has process exit 0 but fails the completion
  guard. These corrections affect the experiment harness, not product routing.
  Because submitted code shares the checker interpreter, the token is not a
  security boundary. Protected, exact-patch operator inspection is mandatory
  before the canary can unlock the remaining battery and before any of the 16
  cases can be accepted. This retains the existing independent-review contract.

The original v7 run did **not** retain raw engine SSE or unparsed generated
tokens. Its client-visible message therefore cannot distinguish nonconforming
model output from a llama.cpp parser failure. No dropped structured call or
production router defect has been demonstrated. The supported finding is a
model/engine tool-format boundary failure, with working downstream transport.
The controls use product source `d006beb6`; v7 used its older frozen source.
They are a compatibility probe, not an exact replay of every original byte.

## Real native experiment

The [v8 campaign](../../campaigns/local-repair-20261017-v8/PLAN.md) selected a
function-calling-oriented Qwen3-Coder candidate and recorded raw HTTP SSE bodies,
router outcome/status, native tool events, edit hashes and independent checks.
The route has no `codex_llama_v1` adapter, so the router forwards the engine SSE
body unchanged. This captures the engine's public response, not unparsed tokens.

The [actual outcome](../../campaigns/local-repair-20261017-v8/OUTCOME.md) contains
eight structured calls, four executed commands, a real correct edit and an
independent checker pass. The episode nevertheless failed the frozen
normal-completion requirement after consuming its eight-request budget. No
held-out case ran. Three malformed patch hunks and a sandboxed zsh temp-file
failure are separately reproduced by [supplied red/green controls](shell-controls.json).
The prepared v9 treatment fixes the shell environment and clarifies the actual
patch grammar; it requires separate authorization before another model episode.
No quality retry, fallback, text-to-command coercion or automatic coding
admission occurred. Original evidence and live Codex settings remain untouched.

## Reproduce the controls

Run `replay.py --mode text --minimal --output <new-private-result.json>` for the
negative signal (exit 1), then `--mode function --minimal` for the supplied
positive control (exit 0). Add `--v8-driver` to exercise the new recorder and
checker isolation. All require the pinned local native executable and use
temporary homes, bounded loopback stand-ins, and owned-process cleanup.
`inspect-template.py` permits only public zero-inference metadata/render/token
endpoints and saves its receipts separately; it never submits a completion.

Primary references: [pinned llama.cpp function calling](https://raw.githubusercontent.com/ggml-org/llama.cpp/b11617/docs/function-calling.md),
[Responses tool normalization](https://raw.githubusercontent.com/ggml-org/llama.cpp/b11617/tools/server/server-chat.cpp),
[Qwen2.5 tool format](https://qwen.readthedocs.io/en/v2.5/framework/function_call.html),
and [Codex permission profiles](https://learn.chatgpt.com/docs/permissions).
