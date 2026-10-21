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
## V9 follow-up: request cap reached

The [v9 outcome](../../campaigns/local-repair-20261017-v9/OUTCOME.md) retains
one zero-inference admission rejection and the corrected, separately sealed
actual-model canary. Codex executed five shell commands, made the correct edit
and passed the unchanged independent checker, but exhausted eight requests and
exited 1. All eight outputs were structured calls; the first seven arguments
were preserved exactly into the next native input. The remaining battery did
not run, and automatic coding remains disabled.

[Date-binding controls](date-controls.json) reproduce and correct the operator's
stale-date expectation while keeping changed permissions and tools denied. The
owner's October 18 approval was valid. This does not relax router matching.

The [next-candidate record](next-candidate.json) selected a pinned community GGUF
of [Mistral's Devstral Small 2 24B](https://huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2512).
Mistral describes it as a coding-agent model supporting local Mac 32 GB use.
This motivates a different model family; it proves neither native Codex fit nor
bounded success. That proposal preceded the separately authorized v10 campaign
below; the original candidate record remains unchanged.

## Devstral v10 reached the elapsed cap

The [v10 frozen plan](../../campaigns/local-repair-20261018-v10/PLAN.md) retains
the stock Devstral template's real native role-alternation rejection, reproduced
with zero completions. A metadata-only correction coalesces adjacent instruction
and user content while preserving all 363 tensor records and every tensor-data
byte. Actual native token/render preflight and supplied continuation controls
pass, including retained late-system rejection.

The [single actual canary](../../campaigns/local-repair-20261018-v10/OUTCOME.md)
executed tools, made the correct edit and passed the independent checker, but
the 90-second probe expired during request seven. Six completed structured calls
reached native continuation with unchanged names and arguments. Codex exited 1
with `turn.failed`; the partial final self-check call did not execute.
Engine timing reports 38.9 seconds for the initial 6,847-token prompt and about
7.7–7.8 generated tokens per second. One malformed patch needed correction.

The eight-request cap was not exhausted. The remaining three development and
twelve fresh held-out cases stay unrun, with zero retries or accepted canary
passes. All 245 frozen inputs and live Codex settings remained unchanged;
owned listeners and processes were cleaned up. Local-only enforcement, unknown
coding readiness and disabled automatic coding remain preserved. Executable
tool compatibility is demonstrated for this corrected combination; bounded
repair completion and full qualification remain unmet.

## Devstral v12 canary passed; qualification failed

The [v12 treatment](../../campaigns/local-repair-20261018-v12/PLAN.md) uses
concise native instructions and task-independent shell/edit/check guidance,
with the same model, runtime, tools, isolation and eight-request / 90-second /
512-token limits. Its preflight test first failed on retained v10 input volume,
then passed after reducing native input from 6,833 to 3,356 tokens. The earlier
v11 preparation was superseded before any inference after semantic inventory
review; its evidence remains unchanged.

The [actual v12 outcome](../../campaigns/local-repair-20261018-v12/OUTCOME.md)
contains a real successful canary: five local requests, actual shell execution,
a safe edit, completed independent assertions and normal native completion in
65.470 seconds. Initial engine prompt processing fell from 38.9 to 19.3 seconds
in this single comparison. Only that protected inspected pass unlocked the
remaining three development and twelve fresh held-out cases, each run once.

Full qualification failed: 5/16 accepted cases (3/4 development, 2/12 held-out),
15 edits, 14 independent checker passes and 11 deadline expirations. One timed
out after an incorrect edit; another never edited the baseline. Correct edits
that failed to complete normally remain failures. All 56 completed structured
calls reached the next native input with unchanged names and arguments across
72 local requests; the recorded transport works for this frozen combination.
Slow generation, inefficient tool rounds and ordinary model errors still
prevent reliable bounded repair. All raw episode evidence and protected
inspections are retained. The 238 frozen inputs and live Codex settings stayed
unchanged, owned processes/listeners were stopped, and local-only enforcement
remains intact. No passing receipt exists; automatic coding stays disabled.

## Latest outcome: faster Qwen v14 exhausted requests before completion

The [v14 plan](../../campaigns/local-repair-20261018-v14/PLAN.md) selects the
existing verified Qwen3-Coder-30B-A3B Q4_K_M artifact with the exact concise v12
instruction bytes and unchanged managed runtime/tool/budget profile. The v13
preparation remains frozen and unrun: independent review found two confounded
checker negatives. Their false acceptance is reproduced against the original
checkers, then rejected by the replacement checkers before any model inference.
All sixteen correct private references still pass, and the replacement honestly
records the inherited, still-unexposed task inventory.

The [one actual canary](../../campaigns/local-repair-20261018-v14/OUTCOME.md)
processed its first 3,595-token prompt in 4.65 seconds and decoded at 37.95–42.30
tokens/second (median 40.15). It executed six commands, made the correct edit and
passed completed independent assertions, but exhausted eight requests and
exited 1 at 42.395 seconds with no normal native completion. Every response
included a structured call; seven observed continuation pairs preserve the
exact name and arguments. The final call has no recorded continuation.

The native ephemeral session advertised goal tools. Two engine responses called
`update_goal(status="complete")`; the recorded first result says goal tools
require a persistent thread. Rereading and repeated print-based checks continued
after successful execution. The recorder rejected the ninth attempted request
before router/model dispatch. No elapsed deadline or malformed patch caused
this failure. The raw public engine SSE and native outcomes retain this
termination/tool-selection boundary; unparsed generation tokens are unavailable.

The remaining fifteen cases did not run. No retry, toolset change, passing
receipt or automatic activation occurred. All 236 replacement and 229 unrun
predecessor inputs rehash unchanged; live settings, hard local-only enforcement,
unknown coding readiness and empty automatic task lists remain preserved.
The probe was revoked and owned processes/listeners stopped.



## V16: completed-argument validation, failed qualification

The [V16 record](../../campaigns/local-repair-20261018-v16/README.md) fixes
malformed completion/replay handling on the actual plain Codex route using TDD.
Its real edit/check canary passed in five requests and 16.475 seconds. The full
cohort accepted six of sixteen cases: repeated checking still exhausts the
request budget, some implementations miss explicit validation, and one incomplete
command was safely blocked. Prior [V15 evidence](https://github.com/mehrdadxzaker/Koto/pull/576)
and failed inputs remain unchanged. Ordinary coding readiness remains unknown;
no automatic coding or new acquisition trial is enabled.
