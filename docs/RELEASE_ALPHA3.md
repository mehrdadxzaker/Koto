# CLI 3.0.0-alpha.3 release

The guided Codex workflow from [#634](https://github.com/mehrdadxzaker/Koto/pull/634)
was merged normally as `deccdd62d9b05943e5a9b75b74df732cf5e6801d`. Its tree matches
the reviewed head. All eight exact-main source checks and all four installation
observations passed on their first attempts. Those installation observations
still used the earlier public alpha.2 pins; they do not qualify alpha.3 delivery.

## Frozen publication artifact

- Package: `@mehrdadz/koto@3.0.0-alpha.3`.
- SHA-256: `3e0686a1578a3df30d65d55a8789715df00c84e2d878ccd8ed3e76251839ee39`.
- SHA-512 integrity: `sha512-SNIv1ANMT0wqOOZyN0JgN0sevLFIw5ax8wW+hl+Faqmaq1V6edj/zE6KSjgIuQ81C7X6m9yKBrblfngkgcZuaQ==`.
- Packed source: `69359551c75dd5114c868cceb16235ef024708c7`, tree
  `5d8882608acb82fe2778254da55fe820618a39be`.

Independent review matched all 54 archive payloads to that source's contents and
permissions. All 51 runtime payloads match the exact merged code and the
[native-qualified candidate](GUIDED_WORKFLOW_VERIFICATION.md). Only the two README
publication copies differ. A fresh offline npm installation matched all 54 and
passed the installed version/help controls. An initial private audit-controller
word-marker mismatch was retained separately; native commands had exited 0 and
the corrected source-matched observation passed in another fresh prefix.

Native npm publication was accepted with exit 0 after native approval. npm first
reported processing: three immediate reads and a later independent version request
could not yet see the version. Those observations are preserved. After processing,
anonymous metadata and archive downloads matched the frozen publication, including
all 54 payloads and permissions. Both `latest` and `alpha` select alpha.3; each
native mutation was performed once, without republishing after delayed visibility.

## Published Homebrew and Linux distribution

The alpha.3 recipes were merged normally in
[#635](https://github.com/mehrdadxzaker/Koto/pull/635) as
`e067e0ff27e1c3957c0714fbb71ca3f901215ac3`. Its tree matches the reviewed head.
All eight exact-main [source checks](https://github.com/mehrdadxzaker/Koto/actions/runs/41068302234)
and all four [distribution observations](https://github.com/mehrdadxzaker/Koto/actions/runs/41068302233)
passed on their first attempts. Retained installation artifacts independently
bound the observed CLI to the frozen alpha.3 archive, recipe commit and clean
project state.

Those distribution observations cover Homebrew on macOS ARM64 and Intel, and the
Linux installer on x64 and ARM64. They establish installation/payload identity,
planning/preflight and owned uninstall behavior on those runners. Native-agent
readiness was explicitly unverified there; the four installation successes do
not establish four native Codex coding workflows. The local Mac journey below
is a separate acceptance observation. The recipes retain the existing Node pin.

## Documentation main check reconciliation

The fresh Homebrew record merged in
[#636](https://github.com/mehrdadxzaker/Koto/pull/636) as
`0bf6ea44fb05af3226cda973fa9ce5e6014088be`, with the reviewed tree and expected
parents. Its first source workflow reported success, but Ubuntu Node 22 job
`124113762610` returned contradictory metadata: `in_progress`, `success` and a
completion timestamp. The original job/check responses remain an unknown status
observation; they are not rewritten as terminal success.

One GitHub exact-job rerun created
[CI attempt 2](https://github.com/mehrdadxzaker/Koto/actions/runs/41070720238/attempts/2)
on that same merge commit and ref. Replacement Ubuntu Node 22 job `124126300542`
and its IDE-package/required dependents completed successfully. The five other
source rows retained their original execution timestamps under new provider IDs;
they are carried-forward results, not five new executions. All 12 latest checks
now have consistent `completed`/`success` metadata. The four
[distribution observations](https://github.com/mehrdadxzaker/Koto/actions/runs/41070720180)
remain on attempt 1, with independently inspected artifacts. No check conclusion
was manually changed, protection bypassed or release republished.

This resolves the current qualification uncertainty while preserving the
historical contradiction. The [CLI closure matrix](CORE_STATUS.md#current-codex-cli-closure)
records the accepted #543 contract separately from individual conditional
branches and historical native-platform observations.

## Fresh Homebrew guided workflow

Observed on October 30, 2026 on macOS ARM64. The host used Node 24.22.2 from the
existing Homebrew `24.22.2_1` keg and the exact published alpha.3 package above.

1. Preserve and verify the existing alpha.2 Koto keg backup. Fast-forward only
   the clean canonical tap to the merged alpha.3 recipe. Ordinarily uninstall
   Koto, confirm its keg and global wrapper are absent, then install from a new
   private download cache. No forced removal, dependency cleanup or untap.
2. Compare all 54 installed payloads with the frozen public archive in contents,
   size, permissions and complete file inventory. Verify the global Homebrew
   wrapper and run its actual version/help controls. The wrapper selects Node24;
   all 17 bounded installation commands exited 0 and confirmed child cleanup.
3. Invoke literal `koto` from `bin` inside a clean clone of the actual Koto project
   at packed source `69359551c75dd5114c868cceb16235ef024708c7`, on the named original
   branch `codex-workflow`. No project flag, copied setup or agent/session path is
   supplied. Koto selects the canonical project, automatically discovers and uses
   the existing native ChatGPT login, and accepts declining optional models.
   Credentials stay with the native client; the observation controller neither
   inspects nor copies credential files and supplies no provider API key.
4. Request one Codex worker owning only `bin/koto.js`. Review the one-worker plan
   and type `build`. Codex adds `-V` to the existing version-alias array. Completion
   opens the guided diff automatically. Type `approve` to accept that exact
   contribution, inspect the separate original-project/branch diff, and type
   `merge` to put it on the original branch. No agent ID, `:review` or manual Git
   merge command is needed.
5. Manually run `--version`, `-v` and `-V` in the original project. Each returns
   its expected alpha.3 version. The original HEAD equals the approved integration
   commit; the original, worker and integration workspaces are clean, with changes
   confined to `bin/koto.js`.
6. Quit ordinarily and reopen bare `koto` in the project. The saved-work choices
   appear automatically. Select Resume, describe the next task, inspect the
   continuation and type `start`. The original native conversation ID, worktree,
   origin fingerprint, executable, account binding and native kind are preserved.
7. Codex changes only the help line to list all three aliases. The guided diff
   shows only that new line, excluding the earlier integration. Type `approve`,
   inspect the original-branch preview and type `merge`. The original HEAD advances
   to this second approved integration commit. Manually check help and all three
   version flags in the original project, then quit ordinarily.

Both native attempts succeeded, both reviewed merges updated the captured
original branch, and the second contribution was exactly one help-line change.
The original, worker and integration workspaces were clean at the final positive
snapshot; only `bin/koto.js` differed from the project base. Both CLI invocations
exited 0 without cleanup signals, and their supervised groups were observed
absent. An independent process inspection also observed the known native workers
and controllers absent, with no active process using the owned worktree paths or
working directories.

One native inspection command initially passed an option-like pattern to `rg`
and failed. The agent recovered with a subsequent inspection and produced the
requested change. That failed activity remains in the transcript; the successful
coding turn does not mean every intermediate native command succeeded.

The installation preserved all three existing Node kegs (`24.22.1`, `24.22.2` and
`24.22.2_1`), the selected Node opt link and binary identity, default Koto state,
and the verified alpha.2 backup. Fresh setup, session metadata and verification
worktrees used a private Koto profile; user projects and credentials were not
replaced. These two verification contributions remain in the separate real-
project clone and do not modify the frozen published CLI.

Private evidence retains actual prompts, displayed diffs, explicit approvals,
original/integration commits, continuity comparisons and process-lifecycle
receipts. Native IDs, account credentials and private machine paths are not
published. The earlier candidate's declined/dirty/stale merge and project-switch
observations remain in [its own record](GUIDED_WORKFLOW_VERIFICATION.md); they
are not relabeled as new Homebrew observations.

Existing optional skill, UI and IDE delivery pins remain independently frozen.
This CLI release does not imply new native UI/IDE, Linux/Windows coding, live
Claude, model-download or general model-quality acceptance. Earlier local-model
failures stay in their [historical record](CODEX_CLI_VERIFICATION.md).
