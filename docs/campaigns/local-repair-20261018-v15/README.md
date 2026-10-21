# V15: a passing canary, failed full qualification

The October 18, 2026 owner grant authorized one goals-disabled canary, followed
by three more development and twelve fresh held-out cases only after acceptance.
The canary passed that gate. All sixteen cases then ran once, with **six accepted
outcomes**. Qualification failed; ordinary coding readiness remains unknown and
automatic coding remains disabled.

The canary executed six native shell commands, edited `solution.py`, completed
the unchanged independent assertions and exited normally in **35.596 seconds
using seven requests**. Every generation stayed below 512 output tokens.
This is a real edit-and-check success through Codex.

## Frozen treatment

Qwen3-Coder-30B-A3B-Instruct Q4_K_M uses the original b11617 template and
`managed-llama.v1` controls. Native Codex 0.160.0 receives `--disable goals`
on each isolated invocation, retaining four unchanged function tool schemas.
Each episode permits eight forwarded model requests, 90 seconds and 512 output
tokens per generation, with zero transport or quality retries and one episode
at a time. See [PLAN.md](PLAN.md) and [setup-summary.json](setup-summary.json).

Preparation commit `6d9aa224dee2cd6e75fff9fa090c98eae8227f90` received separate
Spec and Standards/technical-lead sign-offs before freeze and preregistration.
The 256-artifact manifest commitment is
`c7e52258b2c91027b4aeb4238d4605154ceb149c3cc14bea2f725800c1acd56c`;
the plan commitment is
`905a600efda06c6e542458166f9c7ff6b73e1895afa74d6c986d25ba1b7a5b49`.
Both were posted to [#569](https://github.com/mehrdadxzaker/Koto/issues/569)
before the first real-model submission. All frozen artifacts rehashed unchanged
after the cohort, including the client and model binaries.

The router is the verified 2.0.0a4 wheel from main
`d9a137b9af2b585ed4c1e006b5afa9182c3c4ba6`. V14 used an older router snapshot,
so this run does not isolate the effect of disabling goals.

## Outcomes

| Measure | Result |
| --- | ---: |
| Planned/evaluated cases | 16/16 |
| Forwarded local HTTP submissions | 105 |
| Observed `response.completed` generations | 103 |
| Structured calls / completed native commands | 92/90 |
| Actual implementation edits | 15 |
| Completed independent checker passes | 11 |
| Frozen mechanical passes | 9 |
| Acceptances after contract review | 6 |
| Normal native completions | 11 |
| Maximum native episode time | 53.901 seconds |
| Maximum generation output | 512 tokens |

Three ninth native follow-ups were rejected by the frozen relay before router
or model dispatch. They are excluded from the 105 forwarded submissions. Two
forwarded submissions returned local HTTP 500; the gateway retains their
completion/accounting status as unknown. Zero gateway answer-cache hits were
recorded; engine prompt-cache reuse is separately observed in usage records.

| Case | Requests | Checker exit | Mechanical pass | Inspection |
| --- | ---: | ---: | --- | --- |
| dev-clamp | 7 | 0 | yes | accepted |
| dev-strip-prefix | 8 | 0 | yes | accepted |
| dev-rotate-left | 5 | 0 | yes | accepted |
| dev-positive-counter | 8 | 0 | no | request cap; no normal completion |
| held-floor-mean | 8 | 1 | no | large-integer precision; request cap |
| held-population-count | 6 | 0 | yes | built-in-integer contract violation |
| held-primality | 6 | 0 | yes | built-in-integer contract violation |
| held-remove-ascii-vowels | 8 | 0 | yes | accepted |
| held-html-text-escape | 8 | 0 | yes | accepted |
| held-ascii-palindrome | 8 | 0 | no | request cap; no normal completion |
| held-invert-multimap | 6 | 0 | yes | accepted |
| held-pad-to-length | 6 | 0 | yes | built-in-integer contract violation |
| held-column-totals | 6 | 1 | no | ragged-row validation |
| held-hhmm-parser | 7 | 1 | no | non-ASCII digit acceptance |
| held-luhn-validation | 5 | 1 | no | non-ASCII digits; malformed call/replay failure |
| held-json-object | 3 | 1 | no | malformed call/replay failure; no edit |

The three built-in-integer defects accept custom `int` subclasses through
`isinstance(..., int)`. Their frozen goals/references require the built-in type.
Their literal checkers omitted this edge. The original checker-zero/mechanical
pass records remain unchanged; contract review withholds their acceptance.
No assertions were added or cases rerun during this treatment.

## Compatibility evidence and limits

All 105 retained requests preserve the four frozen schemas and native
instructions. Each episode retains one destination generation. All 89 observed
continuations preserve the tool names, argument strings and result linkage.
Three cap-final calls have no subsequent recorded request.

The Luhn and JSON episodes each reach 512 tokens inside an unterminated
`exec_command` argument string. The retained response marks the item and response
completed. Codex rejects those arguments without executing the calls, then
replays the unchanged strings with its parse-error output. The next local
response is HTTP 500 with `Failed to parse tool call arguments as JSON`.
The JSON episode therefore never edits the file. These traces establish the
observed truncation/replay failure chain; they do not identify the exact
generator-versus-parser responsibility without a raw upstream capture.

Repeated self-checks consume the request cap on three other episodes. Independent
checks also expose precision and input-validation errors. These remain failures
in the sixteen-case denominator. No setup changes, dropped cases, repair by the
operator, extra inference or retry followed these outcomes.

## Preparation, preservation and disposition

Before inference, a supplied-response control exposed a checker read boundary:
submitted Python could read outside the active trial inputs after leaving the
native tool sandbox. The correction limits content reads to interpreter/system
support and the active checker/solution pair, and disables Python site setup.
Owned home/temp sentinel controls retain the original failure and corrected
denial. All sixteen assertion-failing baselines and completed correct references
were revalidated. Process exit zero without assertion completion is still
rejected. Two failed sandbox preparations are retained. These controls use no
model inference and provide no model-quality evidence.

[outcome/case-ledger.json](outcome/case-ledger.json) contains the synthetic
implementations, executed commands, immutable artifact hashes, separate recorded
and inspected outcomes, and per-generation budgets.
[outcome/trial-summary.json](outcome/trial-summary.json) records aggregate counts.
Raw native request context, private references, original response streams, full
manifest, preregistration and protected inspections remain in an owner-only
local archive. Public hashes commit to those private originals; this publication
does not provide every raw input for independent public reproduction.

Earlier campaigns and all frozen inputs remain unchanged. Both owned stages
restored their isolated settings and closed listeners; no llama-server remains.
The live Codex settings and the primary dirty checkout match their starting
fingerprints. No model was downloaded, commercial evaluation run, history
collected for learning, qualification receipt installed or automatic coding
enabled. This failed qualification does not admit the setup to Koto's personal
model selection pool. Further real-model trials remain paused.
