# Koto roadmap

Checkpoint: October 28, 2026.

Development order: **complete and accept the CLI → UIs and IDE plugins using the
same core**. The CLI covers onboarding, subscription discovery, optional local
setup, useful project work and retained sessions. Additional interfaces follow
the accepted journey and consume the same core operations and product state.

**Proposed next milestone:** [Koto Session Workspace](UI_IDE_MILESTONE.md), a
reusable workspace UI delivered first through a VS Code extension. It covers
plan approval, owned native terminals, reviewed integration and returning work
through the existing core. A standalone UI host follows the accepted editor
slice. This is a proposal; implementation and installed-host acceptance are
still required.

| Stage | Outcome | Recorded status |
| --- | --- | --- |
| npm foundation | One Node.js package installs and executes through npm/npx | Implemented. Reviewed tarball installation, payload matching and actual returning `npm exec` use were observed. Registry publication remains separate. |
| Core foundation | Task graphs, bounded concurrent workers, dependency handoffs, results and cancellation | Recorded package/CI, cancellation, native work and cleanup results remain intact. Current `caa5ca6` changes only internal CLI raw-input ownership handling; native/runtime/core payloads are unchanged from `0635143`. |
| Conversational CLI | Ordinary messages and coding goals, proposed agent/task/ownership plans and explicit build approval | Actual Mac first-run use completed goal entry, plan editing, build approval and useful local/native contributions on a real project. |
| Subscription onboarding | Discover supported Codex/Claude installations and native logins; offer native sign-in and optional private client installation | Actual Mac discovery selected the existing ChatGPT/Codex account and later native work used it. Claude was found requiring sign-in; live Claude inference and unexercised sign-in/install branches remain unverified. |
| Optional local setup | Machine-aware choices, pinned runtime/model acquisition, verified reuse and guided selection | Actual fresh Mac runtime/Qwen3 4B downloads, verification, model startup and useful structured-tool work were observed. Returning setup verified the retained model without another download. Earlier refusals and failures remain recorded. |
| Everyday continuity | Remember project/setup, select saved builds, review/integrate/resume without copied directories, and recover interrupted setup | Actual returning Mac CLI remembered the account, project, model, workers and saved session. Local continuation preserved its conversation and integrated only the reviewed delta. Conditional recovery branches retain their individual evidence status. |
| Terminal project flow | Concurrent worktrees with input, resize/detach, independent stop and owned cleanup | Earlier native work retains its actual candidate IDs. Final `caa5ca6` idle CLI handoff/stop/quit controls are accepted on Windows, macOS and Linux; Mac combines the retained two-handoff deadline partial with a separate ordinary stop/quit complement. |
| Native lifecycle and coding collaboration | Captured native identity, exact continuation, contribution ownership, approved integration, reconciliation and later integration deltas | Mac structured exact-ID continuation/delta is recorded. Windows native history shows same-conversation read/write follow-up and separate explicit integration. Terminal-only protocols are not claimed to expose Koto-captured structured resume. |
| Installed CLI acceptance | Fresh and returning real-project use, commercial/local work, recovery and independently checked useful changes | Recorded acceptance scope is complete: Mac fresh/returning and structured continuation, accepted Linux native work/review/cleanup with writer timeout retained, Windows useful work/integration, and final three-host CLI controls. Conditional branches retain individual status. |
| UIs and IDE plugins | Multiple delivery surfaces consuming shared discovery, planning, session, workspace and integration APIs | Next delivery phase after the recorded CLI acceptance. No separate orchestration runtime or duplicate product state model. No UI/IDE delivery is claimed by the CLI observations. |

The first Windows useful-task run,
[40607563837](https://github.com/mehrdadxzaker/Koto/actions/runs/40607563837),
failed with a native request timeout, zero tools/edits and a later incorrect
cleanup-versus-correctness reply. Its model-stage cleanup passed. Its CLI
complement sent no controls because of a controller prompt-marker mismatch;
outer cleanup was confirmed, but the retained inner outcome remained unknown.
A controller-only correction left the `05d1650` product unchanged.

The later
[controls-only run](https://github.com/mehrdadxzaker/Koto/actions/runs/40611356162)
verified actual CLI status, attach, native resize, exact detach, ordinary input
return, stop and quit with confirmed cleanup. No useful model task or integration
was performed. Canonical exit 1 from intentional cancellation remains recorded.
The actual
[useful-task retry 40611815027](https://github.com/mehrdadxzaker/Koto/actions/runs/40611815027)
completed native reads/edits but placed two notes inside an existing sentence;
the malformed contribution was rejected. A stop-time memory-monitor `TypeError`
then prevented contributor/server final cleanup records. Reader cleanup was
confirmed; the retained session stayed active/locked with no final token or
integration. The original error-code value was not captured.

Prior runtime head `0635143` has a fresh verified Mac-created tarball and all
53 source/worktree/tar/installed payloads matched bytes, sizes and modes. The
verified delta is two payloads versus `05d1650` and six versus `8291701`.
[Exact-head CI attempt 1](https://github.com/mehrdadxzaker/Koto/actions/runs/40615191353)
passed all seven checks. An actual installed setup-cancellation call on Node
25.2.1 returned `native_client_install_cancelled` for numeric AbortError code 20
and created no installation directory. It did not complete installation/sign-in
or identify the uncaptured code in the earlier failed Windows run.

The actual
[separate-note native run 40615660295](https://github.com/mehrdadxzaker/Koto/actions/runs/40615660295)
produced an accepted correct 32-word operator note, with all 89 original files
unchanged. Native history verified a same-conversation read/write follow-up after
independent reader stop. Both PTYs and llama had confirmed cleanup. A separate
no-model [integration run](https://github.com/mehrdadxzaker/Koto/actions/runs/40618740981)
verified explicit integration, unchanged originals, no remaining delta and an
inactive unlocked session. Public evidence rehydration was refused because the
seal allowlist omitted a legitimate integration receipt; authenticated private
review accepted the complete integration evidence.

The follow-on `0635143` CLI complement failed Ctrl-] return, with confirmed
cleanup. Instrumented diagnosis localized second readline/raw-mode setup to
stdin `EPIPE`, without establishing the underlying Windows failure code or
independent console closure. The trace remains diagnosis rather than acceptance.

Current reviewed head `caa5ca6` changes only `bin/attach-terminal.js` and
`bin/project.js`: explicit successful replacement-input ownership is acknowledged,
otherwise prior raw mode is restored; real input loss or partial-control failure
stops owned work, and final stdin cleanup handles constructor-before-return
failure. No private readline internals are used.

All 53 package payloads match source/worktree/tar/installation; 51 are unchanged
from `0635143`, and 45 from `8291701`. All native/runtime/core payloads are
unchanged from `0635143`. All seven exact-head
[CI checks](https://github.com/mehrdadxzaker/Koto/actions/runs/40620443063) passed
on attempt 1. Actual uninstrumented Windows and Linux idle CLI observations
accepted two attach/detach/status cycles followed by stop/quit. The accepted Mac
record combines two handoffs/status/stop in a retained controller-deadline
partial with a separate 13.404-second ordinary stop/quit complement. Both helper
cleanups, inactive sessions and empty native histories were verified. Windows
retains intentional native `cancelled`/exit 1 and outer `failed`/exit 1; Linux and
the Mac complement retain native `cancelled`/exit 0 and ordinary aggregate CLI
exit 1. Linux container-absence metadata was corrected from the retained false
original without a rerun. No model tasks were repeated. Earlier work and
integration keep their actual candidate IDs under explicit source-path review.

The earlier `05d1650` candidate passed all seven exact-head source/helper checks on
[CI attempt 2](https://github.com/mehrdadxzaker/Koto/actions/runs/40606511625/attempts/2).
The original preflight timeout and cleanup uncertainty remain in the record.
Source CI does not establish native interaction, inference, useful work or model
quality. Exact source, package, CI and platform bindings are maintained in
[current evidence](CORE_STATUS.md). The `05d1650` Windows-created first failed-task tarball and Mac-created tarball
have distinct digests with the same 53 payloads. The `0635143` Mac archive
has its own verified inventory and binding; these artifacts remain separate. The recorded source checks do
not preclaim a later final PR head or merged-main outcome.

The prior `05d1650` Windows repair had 49 of 53 payloads unchanged versus
`8291701`. The verified `0635143` inventory has 51 unchanged versus
`05d1650` and 47 unchanged versus `8291701`. The shared cancellation/monitor
failure fix affects all platforms. Reviewed normal command/resource/ownership
paths remain equivalent, while changed error paths need execution evidence.
Prior Mac/Linux/Windows observations retain their actual candidate IDs. The
`0635143` native work, controlled cleanup and integration have their own accepted
records. Current `caa5ca6` package/CI proof and the accepted actual control-return
observations remain separate evidence layers. Exact control receipts, including
the distinct Windows-created and Mac-created archive bindings, are in
[core status](CORE_STATUS.md). Delivery-head/main and issue-completion results
are tracked separately in #543.

Fresh Mac onboarding means empty Koto application state with the host's existing
native account and dependencies, not a clean-machine installation of every
dependency. The observations are bounded documentation tasks, not general coding
qualification. Actual provider cost remains unknown. Earlier memory refusals,
download interruptions, model-output failures, Windows cleanup failure and
corrections remain linked from [core status](CORE_STATUS.md); later successes do
not erase them.

One designated acceptance owner coordinates live native work and issue #543
completion against the [acceptance guide](USER_ACCEPTANCE.md). The exact delivery
head, protected merge, exact-main and issue ledger are maintained in
[#543](https://github.com/mehrdadxzaker/Koto/issues/543). Preserve failed and
partial outcomes and qualify each platform/protocol claim. Registry publication
is a separate explicit release action. Automated suites, fixture demos and
benchmark machinery remain outside the active product.

See [guided use](GUIDED_SESSIONS.md), [project sessions](PROJECT_SESSIONS.md),
[native sessions](NATIVE_SESSIONS.md) and [current evidence](CORE_STATUS.md).
