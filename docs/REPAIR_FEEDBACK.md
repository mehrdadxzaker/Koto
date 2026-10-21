# Repair instructions and feedback candidate

`repair-feedback.v1` is an opt-in maintainer candidate in
[`tools/local_repair_mcp.py`](../tools/local_repair_mcp.py). It supplies the
instructions and three project-bound MCP tools for a future independently
reviewed native repair campaign. It never starts a model, coding client or
router, changes connection settings, emits qualification evidence or grants
automatic coding. The native client retains its agent loop.

The instructions require deriving expected results from the specification,
covering relevant edge cases, and distinguishing a mistaken model-written test
from an implementation defect. A failure response identifies its origin as
`model_written_tests`, retains the actual diagnostic and asks for a justified
source or test correction. Copying actual into expected, weakening assertions
or dropping requirements to make tests pass is prohibited. These instructions
cannot establish that an expectation or implementation is correct.

The tools enforce the following finite behavior within one episode:

| Observation | Tool behavior |
| --- | --- |
| Identical failed source/check pair, including a return to an earlier pair | Reuse the diagnostic, execute no checker, stop the session with `repeated_failed_check` |
| Identical passing source/check pair | Return the cached result without executing checks |
| Saving identical source | Perform no write and preserve the current source's passing result |
| Saving different source | Invalidate the current passing result and require checks of the new bytes |
| Four distinct check executions fail | Stop with `check_budget_exhausted` |
| Checker timeout, unavailable/invalid result or source changes during checks | Stop with an explicit failure |
| Sixteen tool calls consumed | Refuse further work with `tool_call_budget_exhausted` |

`must_stop` remains latched for the session. It cannot be cleared by changing
checks, saving another implementation or asking to read the file. Successful
model-written checks always retain `independent_checks: unobserved` and
`automatic_admission_effect: none`. Checker output is diagnostic data, not a
specification or instruction. No oracle is read or edited by the feedback layer.

## Offline inspection and future use

Print the candidate instructions without reading a project or running a process:

```sh
python tools/local_repair_mcp.py --instructions
```

For a future authorized campaign, the explicit MCP command accepts `--project`,
`--private-root` and `--check-python`. The project must be below the campaign's
private root; checker Python must be outside it. File operations target only the
existing, regular, owned `solution.py` with exactly one hard link. Check execution retains the
macOS `sandbox-exec` campaign policy: no network or writes, campaign-root reads
denied except for the selected project. Each checker has a four-second wall
deadline, CPU/file/descriptor limits and owned-process cleanup. Other operating
systems cannot execute this checker. The policy is inherited campaign isolation,
not a general-purpose sandbox or a promise to hide every other readable file.

This is a changed instruction/tool treatment. Freeze the script, exported
instructions, raw native request profile and full case/check inventory in a new
campaign with fresh held-out tasks before any future inference. It cannot reuse
or relabel a receipt from the older treatment. The existing
[sixteen-case qualification gate](LOCAL_CODING_QUALIFICATION.md) and
[2,048-token/90-second profile](BOUNDED_CODING_OUTPUT.md) are unchanged. Repair
steps inside one bounded episode are not campaign quality retries.

The regression suite uses fake checker outcomes and mocked process operations
only. It verifies the MCP responses, source writes, repeat suppression, limits
and cleanup. It establishes no improvement in real-model quality. Historical
campaigns and failures remain unchanged; automatic coding remains disabled.
