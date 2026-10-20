# Qwen v3 versus v4 comparison — October 20, 2026

**V3: 3/6 successful repairs. V4: 1/6. The a18 candidate did not improve coding
performance in this frozen run.** V4 still failed stock rollback and list-valued
uniqueness keys. A correct saved implementation and a completed native turn are
reported separately:

| Measure | V3 | V4 |
| --- | --- | --- |
| Saved implementation passes unchanged independent checker | 4/6 | 3/6 |
| Native turn completes normally with client exit 0 | 4/6 | 2/6 |
| Both conditions, within the original controls | 3/6 | 1/6 |
| Median elapsed time | 105.938 s | 180.004 s |
| Recorded tool errors | 9 | 24 |

The task table reports that combined verdict. Times include unsuccessful episodes:

| Case | V3 | V4 | V3 time | V4 time |
| --- | --- | --- | --- | --- |
| signed-ceiling | Pass | Fail | 79.899 s | 180.008 s |
| literal-first | Pass | Fail | 143.091 s | 180.005 s |
| adjacent-groups | Fail | Fail | 131.976 s | 180.013 s |
| interval-union | Pass | Pass | 75.808 s | 72.711 s |
| atomic-stock | Fail | Fail | 42.770 s | 180.003 s |
| stable-key-unique | Fail | Fail | 180.005 s | 48.285 s |

Both grouping outputs pass the independent checker, but neither native turn
completed. V4 signed-ceiling also passes its checker without a completed turn.
Conversely, V3 stock and V4 uniqueness completed normally while their saved code
failed the checker. The runner's process label `termination: completed` alone
does not establish native turn completion: several nonzero client exits lack a
`turn.completed` event.

V4 stock made twelve model requests and completed eleven identical failing
commands. Literal `\n` text reached Python, producing `SyntaxError: unexpected
character after line continuation character`; intended assertions did not run.
No native patch was saved, and its final source equals the initial faulty
fixture. V3 stock did edit and finish, but its rollback-state assertion failed.
Both uniqueness outputs still use a set for key values and raise `TypeError`
for list-valued keys. These failures remain in the published record.

The [independent audit](v4-comparison-20261020/independent-audit.json) reran all
twelve frozen checkers against the saved outputs and matched every recorded
exit code: seven passing implementations and five failing implementations.
That audit classifies captured command syntax and assertion text; it does not
execute captured shell commands or establish assertion sensitivity.

The separate [authored-check replay](v4-comparison-20261020/authored-checks/replay-summary.json)
is now complete. Four serial sandbox executions replayed two unchanged Python
payloads against the frozen initial and saved new source, with zero model
requests. V4's [interval check](v4-comparison-20261020/authored-checks/adapted-interval-union-audit.json)
and [uniqueness check](v4-comparison-20261020/authored-checks/adapted-stable-key-unique-audit.json)
each completed successfully in the actual native run, fail by assertion against
the initial source, and pass against the saved candidate. This is meaningful
defect sensitivity, with observed assertion execution. The uniqueness payload
checks empty/scalar records and missing keys; it omits unhashable values, so its
passing assertions coexist with the independent list-key failure. It does not
establish complete specification coverage.

No baseline episode supplied a replayable completed assertion check. The other
four V4 episodes' intended checks failed in command/Python syntax and receive no
assertion credit. The [earlier replay attempt](v4-comparison-20261020/authored-checks/denied-attempt-summary.json)
returned sandbox exit 71 before assertion observation. It remains infrastructure
history, with no assertion credit; the later permitted audit did not regenerate
model outputs or rewrite the preserved payloads.

Both arms used installed Qwen3-14B-Q4_K_M, stock Codex 0.160.0 and llama.cpp
b11617. Each episode received 180 seconds, sixteen requests and 2,048 output
tokens per request through explicit development probe v5. Execution was serial,
with one frozen sample per task/arm and no quality retry. Task specifications,
initial fixtures, independent checks, developer instructions and native tool
profiles were unchanged; the native profiles matched between every pair.
The [frozen-integrity audit](v4-comparison-20261020/frozen-integrity.json) rehashed
all 155 frozen artifacts and four physical asset pins successfully.

Candidate: source `480e1c6b95c83591cd5ebd48e11c5df318962980`, runtime
`2.0.0a18`; wheel SHA-256
`02d89baff47da4e29addb813db22ea80bf66523198eb7e75fee3426db2c00c34`.
This candidate passed **104 focused tests: 98 fast and six workflow tests**
against the private installed wheel outside the source checkout. The
[focused-validation receipt](v4-comparison-20261020/a18-focused-validation.json)
was recorded from completed tool outputs; no separate raw stdout log was saved.
That is not a full-suite validation claim. The
[a18 package-parity receipt](v4-diagnosis-20261020/package-parity-a18.json)
verifies 172 runtime/configuration files across source, wheel, private
installation and source distribution. The
[wire audit](v4-diagnosis-20261020/v4-wire-compatibility-a18.json) retains the old
v1–v3 transformations. Runtime regressions and package parity do not establish
coding quality.

All three connection lifetimes reported restored disposable settings and closed
owned listeners. The audit read back the disposable settings and verified the
normal-settings hash. Automatic coding remained disabled and coding evidence
remained empty. Codex retained its tools, approvals, sandbox and execution loop.

The [development diagnosis](v4-development-diagnosis-20261020.md) retains the
earlier a16/a17 pilots and this failure. It also records the installed-template
role-inclusion proof and a later **zero-inference** native one-line
`assertRaises` red/patch/green control. A separate v5 formatting simplification
is proposed from that control; it has not been measured in this comparison.
These are known development tasks used during tuning, not held-out evidence or
ordinary 90-second qualification. Earlier studies remain separate.

Subsequent v5 failures, the typed v6 adapter, and the retained interrupted a20
attempt are documented in the [v6 diagnosis](v6-development-diagnosis-20261020.md).
They do not alter this frozen v3/v4 result.

See the [comparison](v4-comparison-20261020/comparison.json),
[frozen plan](v4-comparison-20261020/frozen-plan.json),
[publication manifest](v4-comparison-20261020/manifest.json), and
[prior v3 study](v3-comparison-20261020.md).
