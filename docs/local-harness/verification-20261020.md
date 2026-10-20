# Six-task diagnosis and fresh verification — October 20, 2026

**Fresh run: baseline 4/6; adapted 5/6. Across both corrected runs: 8/12 in each arm.** The optional guidance has not shown a consistent coding advantage. These repeated, previously observed cases are diagnostic evidence, not independent held-out qualification.

The original 0/6 versus 0/6 comparison included two integration defects. Both fixes are present in the tested candidate: Codex receives its native editing tool, and native patch history can continue the same bounded probe. All twelve fresh episodes saved an edit and completed normally. Automatic local coding remains disabled.

| Task | Baseline | Adapted | Baseline time | Adapted time |
| --- | --- | --- | --- | --- |
| signed-ceiling | Pass | Pass | 46.5 s | 45.0 s |
| literal-first | Pass | Pass | 23.8 s | 27.0 s |
| adjacent-groups | Pass | Pass | 28.9 s | 33.4 s |
| interval-union | Pass | Pass | 63.6 s | 43.0 s |
| atomic-stock | Fail | Fail | 31.1 s | 33.0 s |
| stable-key-unique | Fail | Pass | 23.8 s | 33.0 s |

Median episode time was 30.001 seconds for baseline and 33.220 seconds for adapted. There were no failed tool commands, probe rejections or episode timeouts. Time includes native client and tool execution. No episode ran its own check command: every native trace contains a source read and an edit, followed by a final answer. Independent checks therefore remain essential.

## Feedback loop and confirmed causes

The saved original outputs were rerun through all twelve unchanged, sandboxed independent checkers in 0.410 seconds: **0/12 passed**, with assertion failures against unchanged broken sources. The smallest original case, adapted `literal-first`, fails its checker after the native trace reads the source and finishes with an intention to edit. The same case passes after the integration fixes.

The two integration regressions were then rerun against the original source commit `522ed7f8`: both failed in 2.891 seconds. Against the corrected installed wheel, the same two regressions and three probe-boundary tests passed in 3.129 seconds.

| Boundary | Original signal | Corrected behavior |
| --- | --- | --- |
| Setup to public model catalog | `AssertionError: None != 'freeform'` | Runtime schema 3 exposes native `apply_patch`, independently of thinking support. |
| Native patch to probe continuation | HTTP 403 `probe_request_mismatch` instead of 200 | Declared native custom calls and results continue the same probe; legacy/undeclared history, replays and changed tasks stay rejected. |

The regression commands name the real call-site seams:

```sh
python -m unittest -v \
  tests.test_coding_output_workflow.CodingOutputWorkflowTests.test_v5_setup_uses_bounded_non_thinking_flags_and_stays_unqualified \
  tests.test_coding_output_workflow.CodingOutputWorkflowTests.test_v4_probe_accepts_native_patch_result_without_granting_automatic_coding \
  tests.test_coding_probe_fast
```

The tests run serially with synthetic localhost dependencies; they do not measure model quality. The [integration diagnosis](integration-fixes.md) also records the controlled native catalog experiment and captured continuation replay.

The initial ranked hypotheses covered missing continuation results, blocked editing, premature final answers and insufficient budgets. The catalog and probe failures above are confirmed integration causes. Missing stdout serialization was not established. Premature final answers were observed, but attributing the original total failure to model ability was confounded by the missing editing tool. The budget is not a sufficient explanation: five original failures completed early, and all fresh episodes completed under the unchanged limits.

## Remaining model defects

Both fresh stock implementations validate and deduct one request at a time. They raise on insufficient stock only after earlier deductions, leaving the input mutated when a batch fails. The checker catches this at `assert x == {'a': 5, 'b': 2}`. Correct behavior requires validating the complete batch, including cumulative quantities, before committing any deduction.

The baseline unique-record implementation uses a set for field values and raises `TypeError: unhashable type: 'list'`. The adapted implementation passes the same checks in this run. In the [earlier corrected run](post-fix-results.md), both unique-record implementations failed and the adapted grouping implementation had a syntax error. Those failures remain preserved; no saved output was hand-repaired or substituted.

The three fresh failures reproduce through the original checkers in 0.402 seconds: nine independent checks pass and three fail. These are errors in the saved model-generated implementations, with successful native edits and turn completion. They are separate from the repaired catalog and continuation failures.

## Controls, validation and evidence

The fresh comparison used the same installed Qwen3-14B-Q4_K_M, llama.cpp b11617, stock Codex 0.160.0 and corrected Koto 2.0.0a8 wheel as the earlier corrected run. All six specifications, initial sources, checker predicates and asset hashes were preserved. Each case/arm had one fresh episode, with no quality retry or treatment tuning. Native request profiles matched within every pair.

The runner used the same baseline-first-three, adapted-six, baseline-last-three order, serial inference, 16-request and 90-second episode ceilings, and 2,048 output tokens per request. There were 36 total model submissions. Codex retained its instructions, tools, approvals and execution loop. No model download, cloud inference, history-consent change or automatic qualification occurred.

All three connection lifetimes restored disposable settings and closed owned listeners. Normal Codex settings and frozen source artifacts were unchanged. No debug instrumentation or runtime source changes were introduced by this verification.

All 171 packaged source files were rechecked byte-for-byte against the corrected source. The retained complete installed-wheel log was rehashed and matches its receipt: **55 fast plus 582 workflow tests, 637 total**. That full suite was not repeated for this documentation-only verification; the five affected regressions were rerun. The earlier full-suite timing failure and clean rerun remain disclosed in the existing validation record.

- [Fresh outcomes and cleanup](verification-20261020/comparison.json)
- [Frozen tasks, source and asset identities](verification-20261020/frozen-plan.json)
- [Native traces and saved source hashes](verification-20261020/trace-manifest.json)
- [Verification receipt](verification-20261020/validation.json)
- [Earlier corrected comparison](post-fix-results.md) and [original failed comparison](results.md)

Complete raw artifacts remain in the local `koto-local-harness-comparison-20261020-verification` directory. The independent audit, reproducible saved-run replay helper and regression receipts remain in `koto-six-task-diagnosis-20261020` beside the source checkout. Published traces exclude runtime control files and credentials.

Tested source commit: `bba6ecc05db5e7cf83ecdc3bc5655e6f3be66e4d`.
Candidate wheel SHA-256: `f0c939e66cc3f3bfc57778e0316269e85be7c41b1d9df6a32159f24edb26b5e1`.
Fresh frozen-plan SHA-256: `3b1be9cd762808713ef136fbb3a73171041b078be4c47fffe4cc37016886c73a`.
