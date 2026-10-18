# Devstral v12: real canary pass, full qualification failed

The revised setup completed a real native Codex edit-and-check cycle. Its sole
canary passed in **65.470 seconds with five local model requests**. Only then
did the authorized remaining three development and twelve fresh held-out cases
run, once each. The complete battery accepted **5/16 cases**: **3/4 development**
and **2/12 held-out**. This setup does **not** qualify for automatic coding.

## Frozen correction and measured canary

The [plan](PLAN.md), [manifest](frozen-manifest.json), native instruction profile,
tools, checks, runtime, model and budget were frozen at commit
`8ffc263bc0e7e30881423f02b9254bec0a57000b` and published in the
[pre-inference checkpoint](https://github.com/mehrdadxzaker/hormuz/issues/569#issuecomment-6252552887).
The [preregistration](preregistration.json) binds the owner authorization and
reviews. V11 remains a retained, unrun preparation; it consumed no model trial.

V12 supplies concise, task-independent instructions through Codex's native
per-invocation `model_instructions_file` override, with guidance to use structured
shell calls, make simple permitted file writes, check behavior concisely and
finish promptly. No production routing code, tool schemas, model weights,
runtime flags, sandbox boundaries or live Codex settings changed.

The preparation test first failed against v10's retained 6,833-token preflight;
the actual revised native/engine preflight passed at 3,356 tokens. All seven
native tool definitions remain identical. In the actual canary, initial prompt
processing fell from **38,856.812 ms / 6,847 tokens** in v10 to
**19,296.205 ms / 3,370 tokens** in v12. Decoder throughput remained about
7.8 tokens/second. This is one observed canary comparison, not a general latency
or reliability estimate. The concise instructions saved initial prompt work;
they did not resolve dense-model decoding latency across the battery.

The [canary analysis](canary-analysis.json) and
[readable actual evidence](actual-episodes/dev-clamp/result.json) retain four
completed structured `exec_command` calls, three executed shell commands, an
actual implementation edit, successful model-authored assertions, an unchanged
independent checker moving from assertion exit 1 to completed assertions/exit 0,
and exactly one native `turn.completed` with exit 0. A hash-bound
[protected inspection](inspections/dev-clamp.json) accepted it before qualification.
The second model call supplied `justification` without `sandbox_permissions`;
native validation rejected it before execution, and the next model call removed
that argument. No escalation occurred. This recovery consumed part of the
five-request episode; it was not a new episode or provider retry.

## All cases and failures

| Case | Requests | Native seconds | Independent checker | Full acceptance |
| --- | ---: | ---: | --- | --- |
| dev-clamp | 5 | 65.470 | pass | pass |
| dev-strip-prefix | 5 | 55.800 | pass | pass |
| dev-rotate-left | 4 | 90.048 | pass | deadline failure |
| dev-positive-counter | 5 | 72.366 | pass | pass |
| held-triangular-number | 4 | 90.019 | pass | deadline failure |
| held-decimal-digit-sum | 5 | 90.063 | pass | deadline failure |
| held-euclidean-gcd | 5 | 90.033 | pass | deadline failure |
| held-ascii-rot13 | 6 | 90.016 | pass | deadline failure |
| held-mask-ascii-digits | 5 | 90.019 | pass | deadline failure |
| held-is-subsequence | 4 | 90.033 | pass | deadline failure |
| held-prefix-products | 4 | 30.870 | pass | pass |
| held-transpose-rectangle | 4 | 51.068 | pass | pass |
| held-flatten-one-level | 4 | 90.004 | pass | deadline failure |
| held-traffic-transition | 4 | 90.033 | pass | deadline failure |
| held-register-name | 5 | 90.043 | fail | incorrect edit and deadline |
| held-inverse-permutation | 3 | 90.010 | fail | no edit and deadline |

Fifteen cases edited the implementation, fourteen passed completed independent
assertions, and eleven expired at the 90-second probe deadline. Every deadline
case had native exit 1 and no `turn.completed`; correct code alone cannot pass
the frozen completion gate. Nine of those deadline cases had checker-passing
edits. No case was dropped, repaired by the operator, retried or retuned.

The retained ordinary model mistakes include a wrong expected ROT13 value in
a self-check and a missing import in the name-registration self-check. The
registration implementation shallow-copies a dictionary but mutates its original
names list, accepts a missing required key, and omits required list validation.
The inverse-permutation case spent its budget reading and printing baseline
behavior; its correction generation did not finish and its file stayed broken.
Protected failed inspections preserve these findings without grading them as
successes or modifying the frozen assertions.

## Transport evidence and limits

Across all sixteen episodes there were **72 local model requests**, **56
completed structured calls**, and **52 completed native command items**. All
56 completed calls have identical names and argument strings in the immediately
following native request. All recorded HTTP response statuses were 200 and every
raw SSE body matches its retained response digest and parsed events. This
demonstrates working executable-tool routing for this exact combination; it
does not demonstrate general model reliability or another client's compatibility.

There are 61 completed responses with final usage; their largest output is 478
tokens. The other eleven responses were interrupted at the deadline and have
unknown final usage, not zero usage. The configured cap remains 512 tokens.
The public engine SSE is retained, not unparsed generation tokens. The six-call
ROT13 work snapshot retains five attempt details because of the public API's
detail limit; its aggregate count covers all six and all six wire traces are
retained. No missing attempt detail is invented.

## Evidence, preservation and disposition

- [Qualification summary](qualification-summary.json): every planned case,
  native outcome, implementation, patch, independent result, operator finding,
  engine timing and aggregate metric.
- [Complete evidence archive](qualification-evidence.tar.gz) and
  [member index](evidence-index.json): all sixteen original episode directories,
  five positive and eleven negative protected inspections, and stage metadata.
  All 241 regular members round-trip to the private originals byte for byte.
  The canary remains expanded separately for convenient review.
- [Post-trial audit](post-trial-audit.json): all 238 frozen inputs unchanged,
  live Codex configuration still 11,790 bytes with SHA-256
  `428f5d89b103c14d4ad0f3e626dd96f3d6c8104c9fa94371b9db95277a617388`,
  isolated settings restored, owned engine/router stopped and listeners closed.
  No user configuration body, weights, credentials, private reference or checker
  implementation is included in the publication.
- [Offline evidence verifier](verify-evidence.py): checks the archive's member
  hashes, all recorded SSE bodies, inspection bindings, native terminal events
  and all-case aggregate outcomes without inference, network or extraction.

Local-only enforcement stayed active, answer-cache hits/provider retries/failover
were zero, coding readiness remained `unknown`, automatic task lists stayed
empty, and every probe was revoked. There is **no passing qualification receipt**
and **automatic coding remains disabled**. Old failed evidence is unchanged.
No further model trial or revised setup is implied by this failed qualification.
