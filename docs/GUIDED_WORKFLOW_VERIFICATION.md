# Guided Codex workflow verification

Observed on October 29, 2026, on macOS ARM64 with Node 24.22.2. The installed
`3.0.0-alpha.3` candidate adds current-project selection and guided review,
original-branch merge and native continuation through the shared core.
Public alpha.2, Homebrew/Linux recipes, optional skill and IDE previews keep
their existing frozen pins. This record does not claim publication of alpha.3.

## Installed candidate

The private npm archive has SHA-256
`a6a9caed17c5b5d7e275c453b369dc7b7923851fb5d7e54bf14c71ccfb410ca9`.
All 54 payloads match the source and installed package in bytes, sizes and
permissions. No dependency or install hook was added. Source/scope checks passed.
The exact candidate was installed offline into a new private prefix. Earlier
unpublished candidates were retained separately; they observed initial account
and project discovery only and are not relabeled as coding/merge acceptance.

The actual project was a clean clone of Koto at
`fe4b67b78374ed0aefdc4135862da39f0808e5d5`, on a named original branch
`my=project`. Its package version remains alpha.2; the controller is the alpha.3
candidate. The branch deliberately exercised a valid `=` name, and retained
local `merge.autoStash=true` and `branch.my=project.mergeOptions=--squash --no-commit`.
Per-command settings preserved the explicitly approved fast-forward behavior.
The private Koto profile was empty. Native authorization used the real account
home; credentials were neither read nor copied, and no API key was supplied.

## Actual guided journey

1. Open the installed candidate with no project arguments from the project's
   `bin` subdirectory. Koto selects the canonical project root and automatically
   reuses the existing ready ChatGPT login through Codex. Decline optional models;
   no project-path prompt, model download or second worker is required.
2. Describe a change in ordinary text. Review a one-worker plan owning only
   `bin/koto.js`, then type `build`. Codex adds `-V` to the existing version alias
   array, preserving the exact-one-argument guard and help text.
3. Completion automatically closes the worker terminal and opens the guided diff.
   No `:review` or agent-ID entry is needed. The original branch is still clean
   at its starting commit. Type `approve` to integrate the displayed contribution.
   The original branch still does not move at this step.
4. Inspect the separate original-project/branch preview and its full diff. Decline
   the first merge; the original commit remains unchanged and the integration is
   retained. Exercise the dirty-project and changed-branch refusals below, restore
   only the owned observation inputs, then choose Merge and type `merge`.
5. The original branch fast-forwards to the exact approved integration commit.
   Manually run the project's `--version`, `-v` and `-V` commands there; all return
   its expected alpha.2 version. No stash is created. A shared-core follow-up
   inspection selects this updated original project for a new build.
6. Quit ordinarily and reopen the installed candidate with no project arguments.
   The current-project saved-work menu opens automatically. Choose Resume, enter
   the next task, inspect the continuation and type `start`; no session path or
   agent ID is needed for this single-agent build.
7. In the same captured Codex conversation/worktree, update only the help line to
   list all three version aliases. Guided review shows just that one new line,
   excluding the first integration. Type `approve`, inspect the new aggregate
   diff, then `merge`. The original branch advances to the second approved commit.
   Manually verify help and all three version flags in the original project.
8. Quit ordinarily. A separate invocation of literal `koto` through the installed
   npm bin on PATH also selects the nested current project and opens its saved
   choices without flags. Both coding invocations used the same installed entry
   under the managed Node 24 interpreter; neither supplied a project argument.

The two native attempts succeeded. Native conversation ID, worktree, origin
fingerprint, executable, account and native kind were identical across restart.
The original, worker and integration workspaces were clean at the positive-flow
snapshot; only `bin/koto.js` differed from the project base. The original HEAD
matched each approved integration commit. Repeating the exact completed approval
returned `already-merged` without applying it twice. Both coding invocations and
the later navigation observations exited normally without forced cleanup.

## Actual recovery and project boundaries

- Declining merge preserved the original HEAD and all approved integration work.
- An untracked operator note made the actual original project dirty. Guided Merge
  refused with actionable guidance; the note and original HEAD were unchanged and
  no stash appeared. The owned note was archived privately and removed explicitly.
- A preview token captured before switching the original branch was refused by
  the installed core API. The guided menu also explained the branch mismatch.
  Switching back to the original clean branch allowed a fresh preview and merge.
- A second real project clone selected its own canonical root despite the earlier
  remembered project. The prior saved build stayed retained under its project.
- Outside Git, Koto asked before opening the remembered project. Answering No did
  not open another project's saved-work menu.
- Temporarily moving the actual retained session directory produced its missing-
  metadata error plus `/sessions` and `/project` recovery guidance, then reached
  the conversation prompt. The directory was restored unchanged after ordinary
  quit; no session metadata was invented or rewritten to bypass the error.
- After the positive-flow snapshot, an explicit operator README commit advanced
  the original branch independently. Merge inspection refused
  `project_merge_original_changed`, preserving that commit. This later operator
  commit is distinct from the two native contributions and remains retained.
- A genuine older alpha.2 session refused automatic merge-back without inventing
  its missing original-branch binding. The older review/resume APIs keep their
  established contract; no new live continuation of that older session was run.

## Source guarantees and limits

Shared-core review verified approval-bound original branch/HEAD/worktree checks,
private receipts for every integration edge, bounded history inspection, explicit
no-autostash/no-squash fast-forwards, controlled literal branch config keys,
hook/custom-driver/index protections and retained ambiguous merge intents. Missing
or manually inserted integration history fails closed. These source findings do
not claim a live crash/reconciliation experiment or an adversarial concurrent Git
race test. Ordinary Git locks and before/after checks do not make Git and JSON one
atomic store. A configured signature-verification policy or unsupported history
requires the operator's normal manual merge workflow.

The native observations cover one Codex worker and two small changes on this Mac.
They do not establish general coding quality, native Linux/Windows behavior,
live Claude, multiple-agent merge-back, downloads, UI/IDE acceptance or a new
Homebrew release. Existing alpha.2 local-model failures and evidence remain in
[the earlier record](CODEX_CLI_VERIFICATION.md). No automated suites, fixtures,
benchmarks, stress tests or model campaigns were added or run. Private transcripts
retain exact prompts, diffs, approvals, branch/ref snapshots and cleanup evidence;
native IDs, credentials and private machine paths are not published.
