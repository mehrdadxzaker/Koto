# Faster Qwen candidate: correct edit, request-cap failure, no qualification

The newly authorized canary used the frozen **Qwen3-Coder-30B-A3B-Instruct
Q4_K_M** setup once. It was substantially faster than the retained Devstral
measurement, executed six shell commands, made a correct implementation edit
and passed completed independent assertions. It nevertheless **failed**: eight
requests were exhausted before normal native completion. Codex exited 1 at
**42.395 seconds**, with `error` and `turn.failed`, and no `turn.completed`.
The remaining three development and twelve held-out cases **did not run**.

## Frozen setup and authorization

The [plan](PLAN.md) and [236-input manifest](frozen-manifest.json) were frozen at
`118548a6743d9ef1b38f2072e57b3bf02930be2a`, approved by Spec and
Standards/AI technical-lead reviews, and
[published before inference](https://github.com/mehrdadxzaker/hormuz/issues/569#issuecomment-6253534506).
Protected [preregistration](preregistration.json) binds that checkpoint, the
owner's single-canary authorization, exact digests, zero prior completions and
the stronger normal-native-completion inspection gate.

The same verified local Qwen artifact that failed the older v8/v9 treatments was
selected on retained same-host speed and executable-tool evidence. This is a
separately frozen native instruction treatment, not a retry or relabelling of
those outcomes. It uses byte-identical v12 concise client/developer guidance,
unchanged managed runtime flags and all seven native tool schemas. The limits
remain **8 requests / 90 seconds / 512 output tokens per generation**, with
zero quality/provider retries. No model download, weight/template edit, warm-up,
extra completion or live user settings change occurred.

V13 remains an [unrun preparation](../local-repair-20261018-v13/UNRUN.json).
Independent pre-inference review exposed two confounded checker negatives.
The original freeze remains unchanged. V14 explicitly inherits the same still
unexposed task goals/baselines and strengthens those checkers. The same wrong
fixtures pass v13 and fail v14 by assertion; all sixteen correct private
references still pass. No model result informed this correction. See the
[replacement record](preparation-replacement.json) and sensitivity controls.

## Actual canary sequence

Every model response completed its HTTP/SSE generation and included a structured
call. All eight recorded HTTP statuses were 200. The output-token cap was not
reached: the largest generation was 329 tokens, all eight final usages are
known, and total recorded output was 1,399 tokens.

| Request | Structured call | Observed behavior | Output tokens |
| --- | --- | --- | ---: |
| 1 | exec_command | read the broken file | 92 |
| 2 | exec_command | replace it with the correct four-line clamp | 109 |
| 3 | exec_command | print normal/boundary/error results | 226 |
| 4 | exec_command | print additional negative/zero results | 201 |
| 5 | update_goal | recorded result: goal tools require a persistent thread | 143 |
| 6 | exec_command | reread the unchanged corrected file | 162 |
| 7 | exec_command | print the earlier checks again | 329 |
| 8 | update_goal | repeat completion status; no following request body retained | 137 |

The native session was launched with `--ephemeral`, while its registered tool
schemas advertised goal tools. The engine returned `update_goal` with
`{"status":"complete"}` on requests five and eight despite the instruction to
avoid goals for this task. The first recorded tool output says
`Goal tools require a persistent thread.` It continued rereading/retesting
instead of delivering a tool-free final response. The second goal result is
unobserved in a following request, because the recorder rejected the ninth
attempted submission with HTTP 400 **before router/model dispatch**.

The public probe reports eight submissions, `exhausted`, with 47,459 ms remaining
when inspected. This is request-cap exhaustion, not a 90-second deadline or
generation truncation. Six shell commands completed with exit 0; no malformed
patch body, unsupported shell flag or failed command occurred in this trial.
The three model-authored checks printed values rather than asserting them.
They are retained as print-based checks, separate from independent assertions.

The [protected failure inspection](failure-inspections/dev-clamp.json) confirms
a pure clamp edit with no oracle, assertion, process or receipt interference.
The unchanged independent checker moved from assertion exit 1 to completed
assertions/exit 0. These facts do not override the failed normal-completion gate.

## Speed, transport and limits

The first actual prompt was **3,595 tokens / 4,651.370 ms**, versus the retained
Devstral v12 canary's **3,370 tokens / 19,296.205 ms**. Qwen decoded between
**37.95 and 42.30 tokens/second**, median **40.15**, versus approximately 7.8 for
Devstral. These are observations from different frozen setups in single trials,
not a general successful-repair latency estimate. The faster candidate resolved
the observed generation-speed constraint in this attempt; completion/tool
selection still prevented acceptance.

All **seven** calls with a recorded following native request preserve their
names and argument strings exactly. The eighth has no retained follow-up and
is not falsely counted as verified continuation. All raw public SSE bodies
match their response digests and parsed events. The public work snapshot keeps
five of eight attempt details because of its bounded detail limit; aggregate
counts and all eight wire traces remain available. No missing detail is invented.
Provider retries, failovers and answer-cache hits were zero.

This demonstrates actual executable-tool transport for the combination, not
full autonomous repair reliability. Raw public engine SSE is retained, not
unparsed generation tokens; it cannot uniquely assign the structured-output
decisions to generation versus the engine parser. No dropped or mutated call
is observed in the seven continuation pairs.

## Preservation and disposition

[Per-request analysis](canary-analysis.json), [complete actual episode](actual-episodes/dev-clamp/result.json),
[byte index](evidence-index.json) and [offline verifier](verify-evidence.py)
retain the exact native request/output, raw SSE, implementation/patch, checker
receipts and protected inspection. The verifier performs no inference, network
access, submitted-code execution or private-reference reads.

The [post-trial audit](post-trial-audit.json) rehashes all **236 v14** and **229
unrun v13** frozen inputs unchanged. The real Codex configuration still has
11,790 bytes and SHA-256
`428f5d89b103c14d4ad0f3e626dd96f3d6c8104c9fa94371b9db95277a617388`.
The probe was revoked, isolated settings restored, owned router/runtime stopped
and listeners closed. Prior failed evidence and product code are unchanged.
Publication contains no weights, credentials, configuration bodies or private
correct reference implementations.

The [qualification disposition](qualification-disposition.json) records **16
planned / 1 evaluated / 0 accepted** cases and all fifteen unrun case identities.
There is **no passing receipt or automatic coding activation**. Local-only
enforcement, unknown coding readiness and empty automatic task lists remain in
force. No second canary, changed toolset, operator repair or qualification episode
was run after this failure.
