# Frozen v8/v10 repair comparison

The predeclared criterion was not met; the requested two-target repair remains incomplete.

All 36 episodes and failures are retained in the [audited export](episode-outcomes.json).
Full success requires a changed saved implementation, unchanged passing original checks, normal native completion and client exit 0.
Saved-code checker success alone is not a completed native episode.

| All-six endpoint | v8 | v10 |
| --- | ---: | ---: |
| Full success | 7/18 | 3/18 |
| Saved checker passed | 10/18 | 3/18 |
| Normal native completion | 9/18 | 4/18 |

| Target | v8 full /3 | v10 full /3 | v8 saved /3 | v10 saved /3 | v8 native /3 | v10 native /3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Stock rollback | 0 | 0 | 0 | 0 | 2 | 1 |
| List-key uniqueness | 1 | 0 | 3 | 0 | 1 | 0 |

| Repeat | Assignment | v8 full /6 | v10 full /6 |
| --- | --- | ---: | ---: |
| 1 | v8/v10 | 3 | 0 |
| 2 | v10/v8 | 2 | 2 |
| 3 | v8/v10 | 2 | 1 |

Scores follow the actual profile, including the swapped second pair. Both used the same installed candidate,
Qwen3-14B-Q4_K_M, Codex 0.160.0 and engine b11617. The original six goals, starting sources, checks and native instructions were frozen unchanged.
Each episode allowed 180 seconds, 16 requests and 2048 output tokens at low effort. Inference was serial, with no quality/startup retry, retuning or historical pooling.

All 36 original saved check replays agreed. Nine owned connection lifetimes closed; normal Codex settings and frozen evidence remained unchanged.
The full installed wheel passed 292 fast and 684 workflow tests.
See [verification and controls](pre-study-verification-controls.json) and [integrity audit](post-study-audit/independent-integrity.json).

Codex retained instructions, original tools and tool choice, approvals, sandbox, execution, continuations and the agent loop.
V10 remains default off and unqualified for ordinary coding. These n=3 observations on reused tasks establish no held-out, general causal or ordinary 90-second qualification.
A37 ran no paired study and is only a compatibility/verification reference. Earlier negative results remain separate.
Authored-command observations describe static syntax and recorded feedback, not coverage or assertion execution.
See the [audit limitations](post-study-audit/independent-limitations.json).

Native JSONL can omit rejected patch attempts that are recorded in native stderr. Zero recorded tool items therefore does not establish zero attempted calls; helper-alias provenance and unrecorded failure causes remain unknown.
