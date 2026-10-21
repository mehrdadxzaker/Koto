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

- **Before:** original paired study 0/6 in both arms, confounded by integration
  defects. **After both fixes:** the first corrected run scored baseline **4/6**,
  adapted **3/6**; fresh verification scored baseline **4/6**, adapted **5/6**.
  Both arms total **8/12** across the corrected runs. There is no consistent
  guidance advantage. These repeated development cases are diagnostic evidence,
  not independent held-out qualification.
- All twelve fresh episodes saved an edit and completed normally, with 36 serial
  submissions and no failed tool commands or probe rejections. The three failures
  were batch rollback in both stock implementations and baseline list-key
  hashability. No fresh episode ran its own test command; independent checks
  caught the failures. All saved outputs and unchanged checks remain retained.
- Both targeted regressions failed against the original code: missing freeform
  editor and HTTP 403 after native patch history. The same two regressions plus
  three probe-boundary tests passed against the corrected installed wheel. The
  gates still reject legacy/undeclared history, replays and changed tasks, while
  ordinary unqualified coding stays blocked.
- The retained **55 fast + 582 workflow tests (637 total)** passed against that
  installed wheel outside the checkout. Its full log was rehashed and all 171
  packaged files rechecked against source. This follow-up changes documentation
  and evidence only; it reran the five affected regressions and the real paired
  comparison. The earlier cleanup timing failure and clean full rerun remain
  disclosed in validation metadata.
- The same six tasks/checks and installed client/runtime/model hashes were used.
  Native profiles match within each pair. Sampling and 16-request/90-second
  episode limits stayed fixed, with no quality retries or treatment tuning.
  Settings restoration and listener cleanup passed; normal Codex settings were
  unchanged. Independent fix/report review found no actionable issues.

See [fresh verification and diagnosis](docs/local-harness/verification-20261020.md),
[the first corrected run](docs/local-harness/post-fix-results.md), and
[integration fixes](docs/local-harness/integration-fixes.md).
The original failed study remains separately retained.

## Merge Danger

**Door:** two-way. Disconnect owned connections before selecting a previous
profile. Changed host tool profiles still require matching qualification evidence.
No persisted user state is migrated.

**Blast Radius:** local-coding. Non-thinking schema-3 Codex/llama routes expose the
existing native patch tool; declared v3/v4 probes accept its history. Optional
Qwen guidance affects only explicitly selected routes. Desktop activation and
automatic coding permission are not granted by this change.
