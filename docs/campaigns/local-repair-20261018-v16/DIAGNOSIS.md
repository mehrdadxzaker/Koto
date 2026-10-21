# Tool completion at the generation limit

V15 retained two local generations ending at exactly 512 output tokens inside
an unterminated `exec_command` argument string. The responses claimed completed
items and responses. Native Codex rejected the arguments without executing
those calls and replayed the identical strings with its parse-error output.
The following local requests returned HTTP 500 while parsing tool-call JSON.
The JSON case made no edit. Other cases repeated checks until they exhausted
eight requests, including cases whose edited implementation passed the checker.
The full failed cohort remains in [PR #576](https://github.com/mehrdadxzaker/Koto/pull/576).

The retained router-to-client stream establishes this chain, but lacks raw
runtime-to-router capture. It does not by itself assign the initial truncation
to model sampling versus the runtime parser/emitter. A new real trial must
establish whether the revised combined setup avoids it.

## Red, green and controls

At the approved connect → request → inspect → disconnect seam, a minimized
loopback provider supplied `{"cmd":"python3 - <<` as completed arguments.
Before the fix the client received both the malformed completed call and
`response.completed`. A separate incremental fixture supplied the same pattern
through an arguments-done event; it too reached the client before the fix.
After the correction neither invalid terminal is delivered and the dispatched
work remains unknown. The adapter does not synthesize missing argument bytes.

The replay control also exposed a boundary gap. Without a completed status
field, invalid argument JSON passed admission then closed the connection inside
the adapter. Both status-bearing and plain replay now receive a controlled 503
before provider dispatch. A valid completed plain-function replay retains the
exact argument string and destination affinity.

Preparation review caught a mismatch between the rich app fixture and the
six-capability terminal route. The outgoing guard initially ran only with rich
tool translation enabled. The actual-profile native supplied-response control
reproduced that bypass with zero model inference. The correction now applies
validation alone to plain local Codex 0.160 Responses tool requests, leaving
their provider body, catalog and four native schemas unchanged. The corrected
control interrupts the malformed completion before delivery, executes no tool
and leaves the baseline assertion failing. A valid supplied call still edits
the disposable file, completes its assertions and preserves native continuation.
The unsupported temporary profile considered during preparation is retained;
it is not the frozen treatment.

Run the behavioral regressions with:

```sh
python -m unittest tests.test_codex_app_workflow -v
```

The new tests cover invalid item completion, incremental argument completion,
invalid replay with/without status, and valid argument preservation. Existing
tests retain custom/namespace/discovery behavior and local-only enforcement.
They use supplied external responses, not model inference. Private red/green
logs are committed by the frozen manifest.

The guidance asks for short complete commands, editing and checking separately
when needed, one concise imported-function check, and immediate completion after
success. No synthetic test can prove a model follows that instruction. The one
bounded canary, then gated held-out cases, supplies that evidence. Success still
requires an actual edit and completed independent assertions; truncated calls,
HTTP success or a checker-zero file after request exhaustion never qualify.
