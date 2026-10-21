# Commercial agent and local proposal handoff

On October 21, 2026, a commercial Codex agent delegated one bounded part of a real
Koto repair to the installed `Qwen3-14B-Q4_K_M` model. The public installed
`2.0.0a43` proposal interface returned the accepted suggestion in **8.515 seconds**.
The commercial agent reviewed and integrated the local contribution, then checked
the resulting code.

## Task and execution boundary

The repair concerns a SQLite failure during native router startup. The local
model authored a complete outer exception handler with a separate `sqlite3.Error`
catch that returns the fixed `native_router_storage_unavailable` error. The
commercial agent integrated that handler verbatim in `hormuz/native_router.py`
and added the corresponding error allowlist entry in
`hormuz/codex_native_session.py`.

The commercial agent retained the existing Codex model, login, tools, permissions
and settings. The local model received only the selected task context and returned
text. It had no filesystem or tool execution authority. Reviewing, applying edits
and testing remained commercial-agent responsibilities.

The public CLI uses a separate connected owner and an explicit local model:

```sh
koto chat propose --router-home "$KOTO_ROUTER_HOME" \
  --model Qwen3-14B-Q4_K_M --prompt-file "$TASK_FILE" \
  --max-output-tokens 1024 --effort none --timeout-seconds 180
```

Those variables identify the separate router home and a private authorized task
file. The operation sends one fresh, text-only Responses request with explicit
proposal selection. It returns a `hormuz.chat-proposal` receipt with
`purpose: proposal`, `review_required: true` and `applied: false`. The configured
90-second upstream cap still applies despite the longer CLI deadline. See
[the proposal contract](KOTO_CHAT.md#delegate-a-proposal-for-commercial-review).

## Retained failures and review

The first role-prefaced request was rejected before dispatch: audited provider
and work-attempt counts were both zero. Version a41 removed task-hint matching
only for explicit proposals, preserving the alias, transport, policy and resource
checks.

Across the subsequent **four real provider dispatches**, one request timed out
after 90.144 seconds and retained an unknown outcome. Two HTTP 200 responses
failed proposal validation. Capturing the second established that its text block
included an empty `logprobs` list; a43 added that exact response shape without
accepting nonempty or malformed values. A
captured suggestion made no effective change, so commercial review rejected it.
One explicit review-feedback request then returned the accepted handler. There
were no automatic retries, and none of the preceding failures was converted into
a successful handoff.

The pinned SQLite acceptance checks, generic-error control and all seven native
router lifecycle tests passed: **10 tests in 5.723 seconds**. Final installed
`2.0.0a44` verification passed **332 checks**: 305 fast tests and 27 affected
proposal, routing, ordinary-chat and native lifecycle workflow tests. All 178
runtime payload files matched source, wheel and installation; runtime imports
came from that installation. This was affected-workflow verification, not the
full suite. The full Python matrix is tracked in [PR #594's checks](https://github.com/mehrdadxzaker/Koto/pull/594/checks).

An initial packaging check was interrupted because its private runner lacked a
macOS child-process startup guard. Its owned processes were closed and its
incomplete result retained. The corrected runner passed the same unchanged
checks. No model request was made by either verification run.

The normal Codex configuration remained unchanged. Independent inspection
confirmed the accepted handler matches the local suggestion verbatim, the
acceptance test stayed unchanged, and every owned router and model stopped.

This evidence covers one supervised repair through a text-proposal handoff,
rather than a native Codex subagent RPC. During this handoff, no benchmark
campaign, independent coding qualification or automatic model selection was
performed.

## Evidence identities

- Unchanged acceptance test SHA-256: `4d5f26c147985f04f90fc58bd683de5832bac28ee2c1ae53640a80063bc42bf2`.
- Accepted local proposal SHA-256: `66467e7c8e2c37229f106cb86533fa0f71746d56fdb201be20971c13b6cd9673`.
- Integrated runtime wheel SHA-256: `b62cd19537981f6441fe21ac8703e82660970331fd9ff37f396fc2727559065c`.
- Unchanged normal configuration SHA-256: `858fda4ee8b0938286530aad49117b2b0995e43245d3a23828878ead2061f462`.

Prompts, provider responses, private paths and credentials remain outside this
public report.
