# V9 executed tools and repaired the file; completion gate failed

The owner-authorized actual-model canary ran once on the sealed, reviewed
[date-bound checkpoint](DATE_BINDING.md). Native Codex executed **five shell
commands**, made the correct `solution.py` edit and passed the unchanged
independent checker. Baseline assertions exited 1; after the real edit, the
checker exited 0 with every assertion completed. The inspected implementation
contains only the requested clamp function, with no oracle, process, assertion
or receipt interference.

**The canary failed `local-repair.v1`.** It exhausted eight local model requests
and exited 1 after 28,534 ms. The ninth request was rejected by the fixed cap
before model dispatch. There was no normal native exit zero, quality/provider
retry or remaining qualification case. All three remaining development and
twelve held-out cases remain unrun. No receipt is installed and automatic
coding stays disabled. Passing the independent checker does not override this
failed completion requirement.

## Tool compatibility evidence

Every engine response contains one structured `exec_command` call, with normal
engine completion and fewer than 512 output tokens. The first seven calls'
names and argument strings appear unchanged in the following native request.
The eighth has no admitted continuation because of the request cap. All eight
requests retained one work and local destination generation, with no trace
errors or fallback. Arguments contain real newline characters, without escaped
newline substitution by the router.

The model supplied three invalid patch bodies: missing context/add/remove line
prefixes, a missing hunk header, and an invalid separator. Native Codex returned
specific patch errors that are present unchanged in subsequent model inputs.
The model also requested GNU `cat -A`, which macOS rejected. It finally rewrote
the correct function through `echo`, then read it back on its eighth request.
It did not reach its own behavior check or final answer.

This demonstrates executable tools and a real independently checked repair on
this model/engine/Codex combination. The remaining observed failure is the
model's tool-argument and platform behavior under the fixed request budget.
There is no demonstrated router loss, JSON/newline corruption, token truncation
or dropped tool/template input. This is not a general claim that the model
cannot code, nor a unique attribution of v7's unretained raw generation.

## Preserved checkpoints and boundaries

The original native rejection is retained separately with **zero** model
submissions. The owner's October 18 approval was valid; the stale expected date
was a harness preparation error, fixed before any v9 model inference. It is not
hidden or counted as a passing model trial.

The corrected checkpoint was published and independently approved at
`0d765f432bda6fd8a2e4785c241ad0d03c919d03` before inference. Its manifest
`cbf14614671100565d6e2454e3ae5480a3dd4a0f4482e6a4094a0a006a185b1b`
preserves all 210 original input records, the identical v9 coding plan and the
8-request/90-second/512-token bounds. No actual model request was retried.

Raw public engine SSE, exact requests, native events, implementation, patch and
independent results are retained under
[native-episodes/dev-clamp](native-episodes/dev-clamp/result.json), with
[per-submission analysis](native-analysis.json) and
[independent failure inspection](failure-inspection.json).
Both owned listeners closed and the private settings were restored. The owner's
live Codex configuration remained byte-identical. Hard local-only enforcement,
unknown coding readiness, an empty automatic task list and all prior failures
remain preserved. The broader edit/check-and-normal-completion goal and complete
development/held-out qualification are still unmet.
