# Independent review record

Fixed point: `f199955e8811d9f932256c9a794509b5adddeba3` (Koto main).
Initial implementation: `db164402`. Experiment corrections: `176f429d`.
Two independent reviewers inspected the committed diffs, read-only, using the
Ask Matt code-review workflow. Neither ran models or supplied quality outcomes.

## Standards

Initial findings: two documented breaches and one experiment-isolation judgment.
The runner accepted any nonzero initial check rather than an independently
observed failed assertion; server startup preceded its cleanup guard; and
model-authored files survived between episodes. All three were corrected.

Follow-up at `176f429d`: no remaining actionable Standards findings. Baselines
distinguish assertion failure from runtime error and retain diagnostics; project
reset avoids following directory links and preserves completed snapshots; owned
server/process lifetimes have cleanup guards. Focused regression tests cover
workspace reset, checker timeout, deleted source and runtime failure retention.

## Spec

Initial findings: two. Reusing a partially reset project could confound the paired
treatment; checker timeouts and deleted source could abort without an outcome.
Both were corrected before the final comparison. The interrupted pilot remains
separate from the final frozen study, and its treatment was not tuned.

Follow-up at `176f429d`: no remaining actionable Spec findings. The reviewer
confirmed default-off selection, distinct qualification identity and preservation
of host ownership. A candidate concerning the unique-record task baseline was
withdrawn after checking the committed corrected case.

Final findings: Standards **0**; Spec **0**. These reviews assess source and scope;
the separate execution results establish what was actually tested.
