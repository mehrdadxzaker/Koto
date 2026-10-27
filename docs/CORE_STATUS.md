# Current core delivery evidence

[Issue #543](https://github.com/mehrdadxzaker/Koto/issues/543) tracks the core
delivery. The implementation below is available for acceptance; successful
native interaction on every target host has not been observed. Core verification
comes before another UI or plugin. No registry release is claimed.

## Implemented source

- Shared concurrent scheduling, separate Git worktrees, bounded output/input,
  per-agent stop controls and retained results.
- A guided CLI for explicit agent/model/task/ownership choices, shared preflight,
  terminal-helper setup, session launch, retained review and native continuation.
  Preflight starts no model and changes no native account configuration.
- Platform terminal helpers for macOS and Linux PTYs and Windows ConPTY. The
  Windows helper also owns pipe commands through a Job Object. Helpers are built
  explicitly using existing host tools and verified before launch; compilation
  does not occur during an agent launch.
- Structured Codex and OpenCode observers with declared capabilities, captured
  native session IDs, completion/failure state and available token usage.
  Native terminal screens remain human interfaces; Koto does not scrape them
  for session identity, completion or permission decisions.
- Explicit native resume in the original worktree and captured conversation.
  Origin settings and the exact native ID must match. Resume requires settled
  process cleanup and never substitutes a latest session or retries automatically.
- Complete contribution review and token-approved integration into a separate
  branch. A resumed contribution applies only the delta since its retained
  successful snapshot. Receipts bind the reviewed tree and source/target history.
- Explicit conflict resolution acknowledgement: the operator resolves and commits
  in the integration worktree, then approves its exact current commit. Pending
  conflicts or any unconfirmed agent cleanup block further integration and resume.
  The original checkout is not updated, and ambiguous outcomes retain a lock.

See [native sessions](NATIVE_SESSIONS.md) for the protocol and continuation
boundaries, and [project sessions](PROJECT_SESSIONS.md) for the shared API and CLI.

## Current observations

On Linux, the platform helper was compiled with GCC 14 and used through Koto's
terminal transport. Two actual interactive Bash terminals accepted input and
reported resized dimensions; stopping the first left the second responsive.
Both completed with confirmed cleanup and observed process disappearance.
Installed Codex CLI 0.163.0 also ran `--version` through the PTY and exited zero
with confirmed cleanup. These observations establish terminal mechanics and
executable launch, not a completed native model task or approval interaction.

The Windows native helper passed a MinGW cross-compilation check. That checks
source compilation, not the Windows MSVC builder, ConPTY execution or Job Object
cleanup on a Windows host. CI is configured to run source/scope checks and build
the host helper on macOS, Linux and Windows with Node 22 and 24. A configured
matrix is not a recorded passing run; final CI evidence is recorded separately.

No successful native model turn or native resume has been observed in this Linux
workspace. OpenCode is not installed here, so its current preset and effective
local-model configuration have not been exercised against an installed client.
Source/scope checks, helper compilation and protocol-source inspection do not
establish those outcomes. No automated suites, simulated-agent demonstrations
or benchmark machinery are part of this delivery.

## Earlier evidence retained

The tracker records a real Mac Codex plus local OpenCode/Qwen pipe flow: **25.4
seconds of overlapping native execution**, two reviewed contributions integrated,
and the resulting application run manually. It also retains a failed quoting
attempt and its revision. This establishes that particular pipe setup; it does
not qualify the new terminal backends or native continuation.

On October 27, 2026, an earlier Linux run launched **two actual Codex CLI 0.163.0
processes concurrently** for documentation contributions under a 90-second
deadline. Both reported native connection errors: **zero completed turns and no
changed paths**. Owned process-group cleanup after SIGTERM was confirmed. No
Koto retry or integration followed. A later actual Codex app-server attempt
exited before initialization because its native state location was read-only;
cleanup was confirmed. Neither failed attempt counts as native acceptance.

Before the Linux and Windows terminal backends were added, direct plan/preflight
observation generated explicit Codex arguments, found the installed executable,
and reported the dirty checkout and the then Mac-only PTY restriction. No agent
or model was launched by preflight. The old platform restriction does not
describe the current terminal implementation.

An earlier local tarball installed outside the checkout through npm on Linux
with Node 24.19.0. The installed CLI reported `3.0.0-alpha.0` and checked the
prepared pipe plan; offline `npm exec --package <tarball> -- koto --version` also
succeeded. The initial packaging command used the wrong directory and an
unwritable default cache and failed before producing a package. Explicit source
and private cache paths resolved those setup errors. This evidence applies to
that earlier artifact, not automatically to the final package or native journey.

## Acceptance still required

Use [the user acceptance run](USER_ACCEPTANCE.md) with the exact reviewed package
from the handoff. It covers two real native terminals, prompt input, resize and
detach, stopping one agent while the other continues, retained contribution
review/integration, and continuation of a captured structured native session.
Also review and integrate a subsequent change after an earlier successful
integration to observe the delta behavior. Preserve failed and partial outcomes.

Each claimed operating system needs its own native execution and cleanup
observation; host-helper compilation alone is insufficient. Record the final
package installation and CI results against the reviewed source revision.
Registry publication is a separate explicit action. UI/plugin work follows
core acceptance and is not a substitute for it.
