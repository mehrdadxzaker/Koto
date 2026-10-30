# Koto in VS Code and Cursor

Koto's IDE preview adds project and saved-session navigation around the real
Koto CLI. The extension is named **Koto**, version `0.1.0`. It bundles the
published `@mehrdadz/koto@3.0.0-alpha.1` core; it does not introduce another
coordinator, model loop or integration engine.

**Status — October 29, 2026:** the installed preview journey was observed in
Visual Studio Code `1.144.0` and Cursor `3.27.22` on macOS ARM64: shared setup,
actual coding, review/integration, exact-session continuation, stop, reload,
terminal close and app restart. These are bounded observations on the existing
Mac with native accounts and retained model assets. Earlier failures and actual
candidate identities are preserved in the verification record below. Other
IDE/OS combinations and Marketplace publication are outside this verification.

The [released CLI](https://github.com/mehrdadxzaker/Koto/releases/tag/v3.0.0-alpha.1)
has its own installed workflow evidence in
[#543](https://github.com/mehrdadxzaker/Koto/issues/543). IDE acceptance is a
separate observation and must use the actual packaged extension.

## Install the preview

This preview is installed from a VSIX built from a reviewed source checkout.
It is not yet a Marketplace installation. Building needs Node.js 22 or newer
and npm:

```sh
cd plugins/vscode
npm ci --ignore-scripts
npm run package
```

The package command runs the extension's source checks and build step before
creating `koto-0.1.0.vsix`. The build verifies all 54 published core payloads,
including their contents and POSIX permission modes, against the pinned
integrity manifest and stages them under `dist/core`. It refuses a changed or
incomplete dependency rather than substituting the working checkout's core.

In the IDE's Command Palette, choose **Extensions: Install from VSIX...** and
select that file. Alternatively, from the directory containing it, use the
installed host's command:

```sh
code --install-extension ./koto-0.1.0.vsix
```

For Cursor:

```sh
cursor --install-extension ./koto-0.1.0.vsix
```

If Cursor opens its **Agents** window, choose its native **IDE** button, then
open the real project. The observed Cursor profile reused its cached native
Cursor account; Codex subscription authentication remains with Codex. If the
activity bar is hidden, use **Koto: Focus on Projects and Sessions View** from
the Command Palette to show Koto's project/session view.

The extension runs a separate local Node.js 22+ process. It discovers Node,
including Homebrew's `node@24`, without using the IDE's embedded runtime as the
CLI runtime. If discovery fails, use **Koto: Node Path** in the IDE's User
settings to select an absolute Node executable. Workspace settings cannot
choose a runtime or redirect Koto state. A global `koto` installation is
optional because the VSIX contains its pinned CLI.

## Open a project and work

Use a trusted local folder in the desktop IDE. Restricted Mode, remote
workspaces, browser hosts and virtual filesystems are unavailable in this
preview. These restrictions also apply when commands are invoked directly.

1. Open the **Koto** activity-bar view. **Koto: Open Project** chooses a local
   folder using the host's picker. Project work needs a clean, committed Git
   repository and the CLI's normal prerequisites.
2. If prompted, choose **Koto: Set Up Terminal Support**. This explicitly builds
   the matching native helper with developer tools already installed on the
   host. It does not download a compiler. See
   [helper prerequisites](INSTALLATION.md#build-the-host-helper).
3. Choose **Koto: Open Koto** to open the selected project's interactive CLI.
   Account discovery, native sign-in, optional model choices and plan approval
   use the same guided CLI as the terminal installation. Normal use does not
   require writing JSON or assembling a launch command.
4. Describe the work, inspect the proposed plan and explicitly approve launch.
   Use the native agent prompts where required, then use the CLI's existing
   review and integration commands to inspect and approve contributions.
5. Return through **Koto: Open Saved Session** or select saved work in the
   sidebar and choose **Koto: Open Koto**. Selection alone starts no agent.
   `/sessions`, `/resume`, `/review` and `/integrate` remain CLI operations.
   Continuation uses the originating supported native session; integration
   requires a fresh review of the subsequent contribution.

The extension reuses Koto's existing preferences, local assets, projects and
sessions in `~/.koto`, or the selected private **Koto: State Directory** User
setting. Native credentials stay with their clients. No provider API key is
required for subscription use. The extension adds navigation bookmarks and a
private host ownership receipt/lease; it does not copy credentials, models or
the product's session store. A discovered login is not proof of usable model
access until an actual native request succeeds.

| Command Palette action | Purpose |
| --- | --- |
| Koto: Open Koto | Open the selected project or saved-session CLI |
| Koto: Open Project | Choose a local project without launching an agent |
| Koto: Open Saved Session | Choose retained work for explicit CLI continuation |
| Koto: Refresh Projects and Sessions | Read current shared Koto state |
| Koto: Set Up Terminal Support | Build the matching helper with existing tools |
| Koto: Stop Koto CLI | Stop the CLI owned by this IDE controller |

## Stop, return and recover

Each IDE controller owns one live CLI. Switching to another project requires
stopping that CLI and confirming cleanup first. It cannot take over an
unrelated CLI or a native terminal launched elsewhere.

**Koto: Stop Koto CLI**, terminal closure and extension shutdown request bounded
cleanup of the owned CLI. A separate transport runner can finish shutdown after
the extension host disconnects. Its private `terminal-owner.json` receipt and
lease retain the observed outcome across a host reload; they are ownership
records, not another product session database.

A failure to confirm cleanup blocks replacement. An unexpected runner exit,
forced shutdown or the CLI's `cleanup_unconfirmed` outcome must remain visible;
closing a terminal pane does not establish successful nested agent cleanup.
Inspect the receipt path shown by the extension and the retained Koto session
before recovery. Do not remove the lease to force a second owner while the
original workload may still be alive. No task is replayed automatically and
worktrees remain available for review.

The installed-host observations separately checked ordinary stop, terminal
closure, window reload, app quit/restart and owned process/helper/model cleanup
on the two recorded Mac hosts. The detailed records below preserve actual
candidate identities and raw outcomes. The source design alone does not
establish any unobserved host or failure path.

## Shared core and delivery boundary

The published alpha archive is immutable. Its SHA-256 is
`52673651a84c3daa9989e667a4e583403bd693f6e5d7b8c3772c5136d5c4b18c`.
Updating repository guides or extension code does not change that release.
The extension build consumes the frozen archive's original 54 payloads,
including its packaged README files, rather than repacking the current source.

The manifest's VS Code API requirement is `>=1.100.0`; that declaration is not
qualification of every compatible IDE. Linux/Windows IDE operation, other
VS Code forks, JetBrains, remote development, browser use, Marketplace
publication and automatic updates need their own implementation and evidence.
Existing CLI platform records do not qualify an IDE host.

Follow the repository's direct-observation policy: source checks and package
identity are separate from actual native coding, useful output, session
continuation and cleanup. No automated suites, simulated workers or benchmarks
are part of this preview. See [architecture](ARCHITECTURE.md),
[guided use](GUIDED_SESSIONS.md) and [session boundaries](PROJECT_SESSIONS.md).

## Recorded native observations

The requested host journeys were observed across the candidates below. Each
record retains its actual candidate, host and outcome:

| Host and candidate | Observed result and remaining boundary |
| --- | --- |
| VS Code `1.144.0`, macOS ARM64, candidate 3 | Actual helper setup, automatic native ChatGPT discovery without an API key, and retained Qwen3 4B loading passed. The Codex `versionAlias` task made a useful edit; its diff was reviewed and explicitly integrated, with the original project clean. |
| Same candidate, first local task | `versionFlagNote` failed with `local_agent_output_limit` at limit `2048` and created no file. This failed attempt remains in the record. Loading the model alone did not establish a useful contribution. |
| Same candidate, ordinary GUI quit | The helper reported normal exit 0 and confirmed cleanup. Independent checks found the owned runner, CLI and model processes absent and the model port refused connections. This does not substitute for terminal-close or reload observations. |
| VS Code, candidate 4, saved work | A stale saved-session refresh was corrected. The Codex agent resumed the captured exact native conversation successfully. Its subsequent contribution was reviewed and explicitly integrated as an incremental delta. |
| Same candidate, local follow-up | The original failed local attempt was retained. An explicitly shorter `/no_think` follow-up resumed the same local conversation and used `read_file`/`write_file` across three real model requests to create a useful owned 109-byte note. It was reviewed and integrated alongside the Codex contribution. The changed prompt and earlier failure remain disclosed; this is not general model qualification. |
| Same candidate, reload and close | Actual **Reload Window** and separate terminal closure each released all four captured owned process identities, cleared the lease and left model port `18089` refusing connections. Explicit stop and reopen also cleared a stale active-session selection. |
| Same candidate, intentional Stop display | Physical cleanup passed, but the IDE showed a misleading exit-130 error on intentional stop. The backend's raw `failed`/`130`/`exit_failed` observation remains canonical. |
| VS Code, candidate 5, presentation fix | Actual explicit Stop produced no IDE exit-130 error notification. All four captured owned identities were absent, the lease cleared and the model port refused connections. Only the confirmed-stopped PTY presentation uses exit 0; the raw backend `failed`/`130`/`exit_failed` outcome is retained. |
| Cursor `3.27.22`, macOS ARM64, initial activation | The earlier login screen was an extra/default window boundary. The host's native IDE button reached the private IDE profile, where the Koto sidebar activated and showed one shared project, one saved session, the core version and ready helper. That activation-only observation preceded coding verification. |
| Cursor, candidate 5, returning use and work | The actual CLI reused shared preferences, native ChatGPT access and the same retained Qwen3 4B model without another model/runtime installation. It resumed the captured exact Codex conversation for its fourth attempt, made a useful owned project CLI help-description change, and passed manual flag checks with exit 0. The new incremental diff was reviewed and explicitly integrated. No new local contribution is claimed for this Cursor turn. |
| Same candidate, reload and quit | Actual **Reload Window** while the CLI/model were active released all four captured identities, cleared the lease and left port `18089` refusing connections. App quit completed after its confirmation dialog; its bounded wrapper exited 0 with confirmed cleanup. |
| Same candidate, full restart and fifth Codex turn | After full app quit/restart, the native IDE button and saved-session picker reopened the same project, preferences and retained Qwen model without automatically replaying an agent. An explicit `/resume versionAlias` continued the same captured Codex conversation for its fifth successful turn. Under a no-command constraint it honestly recalled the last saved version change; this was conversation recall, not fresh file inspection. |
| Same candidate, separate terminal close | All four previously live owned identities were absent afterward, the lease cleared, the owner recorded `stopped`, and port `18089` refused connections. Both observed IDE apps were then quit gracefully; their bounded wrappers exited 0 with confirmed cleanup. |

Across these observations, Codex completed five successful turns: three coding
turns and two read-only turns. The local worker had one failed attempt and one
successful follow-up. The three model requests within that successful local
attempt are not three separate accepted contributions. These counts describe
this bounded journey; they do not establish general coding quality.

Candidate 5 retains candidate 4's identical client, runner and all 54 published
core payloads. Its frontend changes only the confirmed-Stop presentation, with
an accompanying changelog entry. Candidate 4's work/continuation records remain
candidate 4 observations; candidate 5 separately verifies the Stop display and
Cursor work/lifecycle paths. Canonical backend exit 130 is preserved wherever
recorded, alongside the independently confirmed physical cleanup.

The CLI release, desktop preview and earlier Linux/Windows native records keep
their original identities and failures. These Mac IDE observations do not
relabel those executions or qualify unobserved clients, operating systems,
sign-in branches or forced-failure cleanup paths. Retained assets were reused;
this was not a fresh OS or a new model download.

The observed final candidate 5 VSIX, `koto-0.1.0-candidate5.vsix`, has SHA-256:
`5cb13b397e409376aa876620d3b3b4a8bd0b4c9db1c6a9156cd4b99e17b80254`.
Its exact core payload inventory remains separately bound to the frozen CLI
archive above.
