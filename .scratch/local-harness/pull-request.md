## Summary

Local Codex coding could omit the native editing tool, then reject its post-edit
history during qualification. Expose native `apply_patch` independently of the
non-thinking profile and accept its custom-call history in declared v3/v4 probe
envelopes. Keep Codex in charge of instructions, tools, approvals and execution.

```text
Codex -> Koto admission -> optional qwen_code_v1 shaping -> local Qwen
      <- native apply_patch and accepted tool continuations <------
```

The optional Open Interpreter-inspired Qwen guidance/compact replay remains
experimental and default off. Its destination/evidence identity stays pinned;
automatic coding remains disabled for the tested route.

## Evidence

- **Before:** the original paired study completed 0/6 repairs in either arm.
  **After both integration fixes:** baseline **4/6**, adapted **3/6**. All twelve
  episodes saved edits and completed normally. The guidance showed no coding
  improvement; remaining failures were syntax, stock-validation and unhashable-key
  errors. These are separate from the repaired transport/admission failures.
- Deterministic native replay changed from bare `apply_patch`/exit 2/no edit to a
  saved native patch and normal completion. The public probe regression changed
  from HTTP 403 after that patch to an accepted continuation, while retaining
  legacy-envelope, replay and changed-task rejection.
- **55 fast + 582 workflow tests passed** against the exact installed candidate wheel outside the source checkout. All 171 packaged files match final source. Source-scope and version checks passed. An unchanged cleanup timing test failed on the first full attempt, then passed in isolation and in the fresh complete run; that failure is retained in validation metadata.
- All six tasks/checks and installed client/runtime/model hashes match the
  original study. Both arms used the same native profile, fixed sampling, serial
  inference and 16-request/90-second episode limits, with no quality retries.
  All three owned connection lifetimes restored settings and closed listeners;
  normal Codex settings were unchanged.

See [the paired rerun](docs/local-harness/post-fix-results.md),
[integration diagnosis](docs/local-harness/integration-fixes.md), and
[full outcomes and traces](docs/local-harness/post-fix/comparison.json).
The original failed study remains separately retained. Six stochastic samples
per arm are exploratory evidence and do not qualify automatic coding.

## Merge Danger

**Door:** two-way. Disconnect owned connections before selecting a previous
profile. Changed host tool profiles still require matching qualification evidence.
No persisted user state is migrated.

**Blast Radius:** local-coding. Non-thinking schema-3 Codex/llama routes expose the
existing native patch tool; declared v3/v4 probes accept its history. Optional
Qwen guidance affects only explicitly selected routes. Desktop activation and
automatic coding permission are not granted by this change.
