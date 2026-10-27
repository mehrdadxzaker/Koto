# Current core delivery evidence

[Issue #543](https://github.com/mehrdadxzaker/Koto/issues/543) is the delivery
tracker. This page distinguishes observed behavior from implemented source and
the remaining requirements. No registry release is claimed.

## Observed behavior

The tracker records a real Mac Codex plus local OpenCode/Qwen pipe flow: **25.4
seconds of overlapping native execution**, two reviewed contributions integrated,
and the resulting application run manually. It also retains a failed quoting
attempt and its revision. This establishes that specific pipe setup; it does
not establish PTY behavior or general platform support.

On October 27, 2026, the current Linux work used Koto to launch **two actual
Codex CLI 0.163.0 processes concurrently** for documentation contributions under
a 90-second deadline. Both reported native connection errors. The outcome
was **zero completed turns and no changed paths**. Owned process-group cleanup
after SIGTERM was confirmed. No Koto retry or integration followed. This failed
attempt demonstrates launch/deadline/cleanup handling in that environment,
not successful native coding or model access.

The plan builder and preflight were also exercised directly against the actual
Linux workspace. They generated explicit Codex arguments, found the installed
Codex executable and reported the dirty repository and unsupported Mac PTY
transport. No agent or model was launched by that preflight.

A fresh local tarball installed outside the checkout through npm on Linux with
Node 24.19.0. The installed CLI reported `3.0.0-alpha.0` and successfully checked
the actual prepared pipe plan, leaving native model access unverified. Offline
`npm exec --package <tarball> -- koto --version` also succeeded. The initial
packaging command used the wrong directory and an unwritable default cache; it
failed before producing a package. Explicit source and private cache paths
resolved those command setup errors. This is local tarball installation evidence,
not a registry release or a successful installed native-agent journey.

## Implemented source

- Shared concurrent scheduling, separate Git worktrees, bounded output/input,
  per-agent stop controls and retained results.
- Complete contribution inspection and explicit review-token integration into
  a separate branch. Every agent must finish and settle cleanup first;
  unconfirmed cleanup from any agent blocks integration of all contributions.
- Explicit native command plan building and shared launch preflight before
  workspace creation. A passing preflight does not prove native readiness.
- Optional Mac PTY source with byte input, resize, foreground attachment and
  owned-session cleanup reporting. It requires an explicit helper build using
  the existing Apple toolchain. Source compilation is separate from native use.
- Windows project pipe exits explicitly retain `cleanup_unconfirmed`; automatic
  integration is blocked until a suitable owned-process implementation exists.

Source/scope checks and helper compilation do not establish model quality,
native terminal operation, installed-package behavior or platform qualification.
No automated suites, simulated-agent demonstrations or benchmark machinery are
part of this delivery.

## Remaining delivery requirements

1. Observe actual Mac native prompt input, resize, terminal restoration and
   stopping one agent while another continues, followed by review/integration
   only after verified cleanup.
2. Implement native capability/event handling, retained native session IDs and
   resume with the originating session's context.
3. Reconcile Linux PTY work and implement Windows ConPTY with owned-process
   termination; observe the intended native journeys on each claimed platform.
4. Complete a configured real-agent project flow using the installed package
   outside the source checkout. Registry publication remains a separate explicit action.
5. Select the first UI/plugin with the owner and implement it as a thin consumer
   of the same core APIs.

OpenCode is unavailable in the current Linux workspace. Its new command preset,
effective local-only configuration and model availability remain unverified
against an installed client. The earlier Mac pipe result does not qualify the
new preset or the optional PTY transport.
