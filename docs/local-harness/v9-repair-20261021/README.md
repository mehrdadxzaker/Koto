# Frozen v8/v9 repair comparison

**V9 did not improve coding performance in this study. Neither requested target
was fixed by this candidate.** Across three paired repeats of the same six tasks, v8 achieved
**10/18 full successes** and v9 **1/18**. V9 remains on hold, unqualified and
default off; no automatic coding route was activated.

The [audited episode export](episode-outcomes.json) retains all 36 outcomes,
including failures and their durations. Full success requires a changed
implementation, passing unchanged original checks, normal native completion and
client exit 0. A passing saved implementation alone is not a completed episode.

| All-six endpoint | v8 | v9 |
| --- | ---: | ---: |
| Full success | 10/18 | 1/18 |
| Saved checker passed | 10/18 | 3/18 |
| Normal native completion | 11/18 | 3/18 |

The predeclared repair criterion required **3/3 strict full successes for each
v9 target**, with both targets required. It was not met.

| Target | v8 full /3 | v9 full /3 | v8 saved checker /3 | v9 saved checker /3 | v8 native /3 | v9 native /3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Stock rollback | 0 | 0 | 0 | 0 | 1 | 2 |
| List-key uniqueness | 3 | 0 | 3 | 0 | 3 | 0 |

| Repeat | Baseline/adapted assignment | v8 full /6 | v9 full /6 |
| --- | --- | ---: | ---: |
| 1 | v8/v9 | 3 | 0 |
| 2 | v9/v8 | 3 | 1 |
| 3 | v8/v9 | 4 | 0 |

| Task | v8 full /3 | v9 full /3 |
| --- | ---: | ---: |
| Signed ceiling division | 2 | 1 |
| Literal first replacement | 3 | 0 |
| Adjacent grouping | 2 | 0 |
| Interval union | 0 | 0 |
| Atomic stock rollback | 0 | 0 |
| Stable list-key uniqueness | 3 | 0 |

Median recorded turn duration, including failures, was 91.8 seconds for v8 and
180.0 seconds for v9. Submitted requests totaled 76 and 90 respectively. These
are descriptive measurements of these runs, without general performance claims.

Scores follow the actual profile, including the swapped second pair. The frozen
block schedule, installed Qwen3-14B-Q4_K_M, Codex 0.160.0, engine b11617, six
goals, starting sources and independent checks were unchanged. Each episode
allowed 180 seconds, 16 requests and 2048 output tokens at native low effort.
Inference was serial, with no quality retries, retuning or historical pooling.
The [verification and controls record](pre-study-verification-controls.json)
binds candidate `2.0.0a36`, source `2a0a5f0a6f348cea7f307c100d21265f07648fd4`,
its wheel and the frozen protocol hashes.

The [target observations](target-failure-observations.json) distinguish rejected
edits, unchanged implementations, insufficient cumulative validation, a missing
import and failed native completion. Candidate rollback sometimes completed
normally with incorrect saved code. Two candidate grouping implementations
passed their saved checks but failed native completion after stream disconnects;
the cause remains unresolved. These observations do not establish that all
failures were semantic or rule out a transport problem.

Recorded patch-rejection lists include attempts visible in native stderr even
when JSONL item events are sparse or absent. Missing item events do not prove
that no tool call or edit attempt occurred. Derived helpers restore native tool
identities, so these events cannot directly identify which model-facing helper
was selected. No causal helper-selection claim follows from this comparison.
The [authored-command audit](post-study-audit/independent-authored-command-observations.json)
also separates recorded results from assertion syntax, prints and coverage.

The [independent integrity audit](post-study-audit/independent-integrity.json)
replayed all **36 original saved checks once**, serially; every result agreed.
Frozen artifacts and saved evidence remained unchanged, controls matched, nine
owned connection lifetimes closed and normal settings remained unchanged. The
complete installed-wheel verification passed **280 fast tests and 683 workflow
tests**. Separate parity records matched 630 default/v1–v8 request outputs and
177 source/wheel/site payload files. These tests verify implementation
boundaries and compatibility; they do not demonstrate coding benefit.

Separate retained diagnostics remain available for [a32](a32-diagnostic.json),
[a33](a33-diagnostic.json), [a34](a34-diagnostic.json),
[a35](a35-diagnostic.json) and [a36](a36-diagnostic.json). None enters the paired
scores. A35's interrupted full suite is not a full verification pass. The a36
decision to measure an unchanged candidate did not declare either target fixed.

Codex retained its instructions, tools, tool choice, approvals, sandbox,
execution and continuation loop. Cleanup evidence covers owned resources.
Three repetitions on known development tasks do not establish held-out quality,
general causal improvement or ordinary 90-second coding qualification. Read the
[audit limitations](post-study-audit/independent-limitations.json),
[primary-target audit](post-study-audit/independent-primary-targets.json),
[secondary audit](post-study-audit/independent-secondary-summary.json),
[episode export manifest](episode-outcomes-manifest.json) and
[audit manifest](post-study-audit/manifest.json) for the exact evidence boundaries.
