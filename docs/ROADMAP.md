# Koto roadmap

Development order: **complete and accept the CLI → UIs and IDE plugins using the
same core**. The first CLI must cover onboarding and everyday project work,
including discovery, optional model acquisition, useful contributions and saved
work. Additional interfaces follow that accepted journey.

| Stage | Outcome | Status |
| --- | --- | --- |
| npm foundation | One Node.js package installs and executes through npm/npx | Source implemented; earlier local tarball installation observed. Final installed-artifact acceptance and registry publication remain separate gates. |
| Core foundation | Task graphs, bounded concurrent workers, dependency handoffs, results and cancellation | Implemented; source checks and actual host behavior are recorded separately. |
| Conversational CLI | Ordinary messages and coding goals, proposed agent/task/ownership plans and explicit build approval | Implemented in source on the shared core; the complete installed real-project journey remains under acceptance. |
| Subscription onboarding | Discover supported Codex/Claude installations and native logins; offer native sign-in and optional private client installation | Implemented in source. On this Mac, discovery observed an existing ChatGPT login and a Claude login requirement. These results do not establish inference entitlement or successful Claude work. |
| Optional local setup | Machine-aware model choices, pinned runtime/model downloads, verified reuse and guided selection | Implemented in source. One model download was verified; its attempted startup was refused because 0.95 GiB of free RAM was below the 1 GiB reserve. Successful local inference and commercial/local cooperation through this new path remain unverified. |
| Everyday continuity | Remember project/setup, select saved builds, review/integrate/resume without copied directories, and recover interrupted setup | Implemented in source; fresh and returning installed-user acceptance must verify useful work and retained state. |
| Terminal project flow | Concurrent worktrees with input, resize, independent stop and cleanup through host helpers | macOS/Linux PTY and Windows ConPTY/Job Object source implemented. Earlier Linux terminal mechanics were observed; the complete native interactive journey on every claimed platform remains required. |
| Native lifecycle and coding collaboration | Captured native identity, exact continuation, contribution ownership, approved integration attempts, reconciliation and subsequent integration deltas | Implemented in source. Earlier Mac pipe cooperation is retained; current exact-session continuation, cleanup and integration behavior require actual native acceptance. |
| Installed CLI acceptance | Fresh setup and returning use on a real project, commercial/local collaboration, recovery and independently checked useful changes | Open. The [acceptance guide](USER_ACCEPTANCE.md) defines the full journey; source checks, downloaded files and partial attempts cannot close it. |
| UIs and IDE plugins | Multiple delivery surfaces consuming the same discovery, planning, session, workspace and integration APIs | After complete CLI acceptance. No separate orchestration runtime or product state model. |

The current merged core baseline is `e2474c3`. The onboarding and everyday-use
source is being prepared against that baseline; its implementation status must
not be presented as a verified final installation. The prior dirty checkout and
historical outcomes remain preserved.

CI covers source/scope checks and host-helper compilation on macOS, Linux and
Windows with Node 22 and 24. Results must be bound to the reviewed revision.
Compilation does not establish native terminal interaction, local or commercial
inference, model quality, successful continuation or installed-package behavior.
Linux/Windows native-agent acceptance and Claude live inference remain open;
they have not been removed from the supported-platform qualification work.

One designated acceptance owner coordinates the live native run and issue #543
closure. Preserve failed and partial outcomes, qualify every platform claim, and
keep registry publication as a separate action. Automated suites, fixture demos
and benchmark machinery remain outside the active product.

See [guided use](GUIDED_SESSIONS.md), [project sessions](PROJECT_SESSIONS.md),
[native sessions](NATIVE_SESSIONS.md) and [current evidence](CORE_STATUS.md).
