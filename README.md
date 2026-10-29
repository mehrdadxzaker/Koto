<div align="center">
  <img src="assets/koto-logo.png" alt="Koto's wooden K-shaped stringed-instrument logo" width="168" height="168" />
  <h1>Koto</h1>
</div>

<p align="center">
  <a href="https://github.com/mehrdadxzaker/Koto/stargazers"><img src="assets/badge-github.svg" alt="Star Koto on GitHub" height="20" /></a>
  <a href="LICENSE"><img src="assets/badge-license.svg" alt="License: Apache-2.0" height="20" /></a>
  <a href="https://github.com/mehrdadxzaker/Koto/actions/workflows/ci.yml"><img src="https://github.com/mehrdadxzaker/Koto/actions/workflows/ci.yml/badge.svg?branch=main" alt="Source checks" height="20" /></a>
</p>

<p align="center"><strong>English</strong> · <a href="README.fa.md" lang="fa">فارسی</a></p>

<p align="center"><a href="https://skills.sh/mehrdadxzaker/koto/koto"><img src="https://skills.sh/b/mehrdadxzaker/koto" alt="Koto on skills.sh" /></a></p>

<p align="center"><strong>Run multiple coding agents together, in one coordinated workspace.</strong></p>
<p align="center">Give each agent an isolated Git worktree, follow its output, review its changes, and bring the results together.</p>

<p align="center"><a href="#quick-start">Quick start</a> · <a href="#how-it-works">How it works</a> · <a href="#contributing">Contribute</a> · <a href="docs/PROJECT_SESSIONS.md">Session guide</a></p>

Koto brings commercial and open-source coding agents into one workflow. Open the
CLI, choose an existing subscription or an optional local model, describe your
project, and review an editable plan before work starts. Agents work in isolated
Git worktrees; you review their contributions before integrating them.

**Available now:** guided setup, remembered choices and saved sessions, concurrent
project work, native terminal controls, supported conversation continuation and
approval-based integration. **Koto is alpha software.** The recorded CLI
acceptance is tracked in [#543](https://github.com/mehrdadxzaker/Koto/issues/543);
[installation and release notes](docs/INSTALLATION.md) track npm publication and
registry verification separately. IDE plugins and Koto's own UI are the next
delivery phase, using the same JavaScript core.

## How it works

![Koto workflow: start from one clean Git commit, run Codex and OpenCode in separate worktrees, review each diff, then approve changes into a separate integration branch.](assets/collaboration-flow.svg)

| You need to… | Koto provides |
| --- | --- |
| Start with your existing setup | Codex/ChatGPT and Claude Code discovery, native sign-in or private client installation, plus optional verified local model/runtime downloads |
| Decide how agents work together | Editable plans with agents, models, tasks, contribution paths and dependencies; explicit launch approval |
| Keep edits apart | One branch and worktree per agent, starting from the same commit |
| See and control work | Live output, process/native status, per-agent stop, native terminal input, resize and detach |
| Decide what to keep | Contribution diffs, approval bound to current contents, and integration into a separate worktree |
| Return to earlier work | Remembered setup and saved builds; supported exact-conversation continuation and review of later integration deltas |
| Use another interface later | Shared discovery, planning, session and integration APIs with TypeScript declarations |

### Observed with real agents

The [recorded CLI acceptance](docs/CORE_STATUS.md) includes fresh and returning
Mac use with Codex/ChatGPT and a downloaded local Qwen3 4B model, useful changes,
reviewed integration and conversation continuation. Linux ARM64 Docker records
native interaction, useful reviewed work, integration and cleanup, with a writer
timeout retained. Windows records useful native work, same-conversation follow-up
and separate explicit integration. Final CLI attach/detach/stop/quit controls
were observed across all three hosts; the Mac record combines a retained
handoff/deadline partial with a separate ordinary stop/quit observation.

These are bounded task and lifecycle observations. Earlier failures remain in
the evidence. Live Claude inference, unexercised conditional setup/recovery
branches, general coding quality and actual provider cost are not established.
See [current evidence](docs/CORE_STATUS.md) and the
[acceptance guide](docs/USER_ACCEPTANCE.md) for the exact scope and limits.

## Quick start

Choose Homebrew, the Linux installer, or npm/npx. Project work needs Git on an absolute PATH
entry and a clean, committed Git repository. Koto can discover existing native
clients or offer their private installation and native sign-in. You can use a
subscription, a local model, or both; a local-model download is optional.

### 1. Open Koto

With Homebrew:

```sh
brew tap mehrdadxzaker/koto https://github.com/mehrdadxzaker/Koto.git
brew install mehrdadxzaker/koto/koto
koto
```

On x64 or ARM64 GNU/Linux, the installer acquires its own verified Node runtime:

```sh
curl -fsSL --connect-timeout 10 --max-time 30 \
  https://raw.githubusercontent.com/mehrdadxzaker/Koto/main/install.sh | sh
"$HOME/.local/bin/koto"
```

The installer uses `~/.local/share/koto` and `~/.local/bin`, prints PATH guidance
when needed, and preserves account/model/project state on uninstall. See
[installation](docs/INSTALLATION.md) for Linux prerequisites, custom locations,
updates and removal. Both routes package the published alpha CLI.

With **Node.js 22+ and npm** already installed:

```sh
npm install --global @mehrdadz/koto@alpha
koto
```

Without a global installation:

```sh
npx --yes @mehrdadz/koto@alpha
```

To select the exact prerelease version instead of following the `alpha` tag:

```sh
npm install --global @mehrdadz/koto@3.0.0-alpha.0
koto
```

These commands name the alpha distribution; publication and registry-install
verification are separate release steps recorded in the
[installation notes](docs/INSTALLATION.md). The Node core has no runtime
dependencies, required build step or install hooks.

### Use Koto inside Codex or Claude Code

Install the optional **Koto** skill for your coding agents:

```sh
npx skills add mehrdadxzaker/koto -g
```

Choose Codex, Claude Code, or both in the installer. Omit `-g` to install only
in the current project. Start a new agent conversation, then use:

| Agent | Example |
| --- | --- |
| Codex | `$koto plan the work for this project` |
| Claude Code | `/koto plan the work for this project` |

The skill runs the published CLI and keeps Koto's editable plans, isolated
worktrees and reviewed integration. A CLI installation is optional: the skill
uses a pinned `npx` command. The installed skill is simply **Koto**; the GitHub
address in the install command identifies its source. See
[skill installation](docs/INSTALLATION.md#koto-skill-for-codex-and-claude-code)
for agent selection, updates and troubleshooting.

<details>
<summary>Run from source or install a local tarball</summary>

Run directly from the checkout:

```sh
git clone https://github.com/mehrdadxzaker/Koto.git
cd Koto
node bin/koto.js
```

Or build and install the local package from that checkout:

```sh
npm pack --ignore-scripts
npm install --global ./mehrdadz-koto-3.0.0-alpha.0.tgz
koto
```

See [installation](docs/INSTALLATION.md) for local npm/npx usage and
[the migration guide](docs/MIGRATION.md) if an older Python `koto` command is on
your PATH.

</details>

### 2. Choose your setup and project

The first-run conversation discovers supported Codex and Claude Code accounts.
Choose an existing login, open the client's native sign-in flow, or approve a
private client installation when needed. Native credentials remain with the
client; subscription use does not require a provider API key. Login discovery
does not establish access to every model or remaining provider usage.

Optional local setup shows model size, license and memory guidance. After your
confirmation, Koto acquires a pinned llama.cpp runtime and verifies the selected
model download. Verified assets are reused on later launches. Koto runs one
managed local model server at a time and stops it when it exits. Startup remains
subject to current memory and storage checks.

Choose a project folder, create one with `new PATH` after confirmation, or enter
`later` to keep chatting. Existing project work requires a clean committed
repository. Use `/project PATH` or `/new PATH` to change it later.

**Native helper prerequisites:** package installation never compiles a helper
or downloads a compiler. The host helper is built explicitly with installed
tools and verified before use:

| Host | Existing prerequisites | Helper use |
| --- | --- | --- |
| macOS | Apple command-line developer tools and SDK | PTY agents |
| Linux | System C compiler, libc development headers, procfs and allowed pidfd syscalls | PTY agents |
| Windows 10 1809 or newer | Visual Studio C++ tools and a matching Windows SDK | All project agents and repository preflight, including pipe mode |

The guided launcher's **Set up terminal support** option performs this build.
With the installed CLI, you can also use:

```sh
koto terminal build
koto terminal info
```

See [installation](docs/INSTALLATION.md#build-the-host-helper) for helper paths,
version matching and platform requirements. These are process-ownership
mechanisms; they do not grant an OS sandbox.

### 3. Describe, edit and approve the work

Type a message or describe what you want to build. A coding request produces a
plan with agents, models, tasks and contribution paths. Type `edit` to change
assignments, configured agent/model choices, ownership or dependencies, or remove
a task. Koto validates the revised plan and displays it again. Type `build` to
launch the reviewed plan through the shared core.

| During a project session | Action |
| --- | --- |
| `:status` | Show agent and worktree status |
| `:attach AGENT` | Enter a native terminal; Ctrl-] returns to Koto |
| `:resize AGENT 120 36` | Resize a native terminal; attached terminals also follow the outer terminal |
| `:stop AGENT` / `:stop all` | Stop owned work and retain partial edits |
| `:review AGENT` | Display and remember the contribution the next integration would apply |
| `:integrate AGENT` | Apply that displayed contribution after all agents finish and cleanup is confirmed |
| `:quit` | Stop remaining work, retain the build and return to the conversation or launcher |

Answer native terminal permission prompts inside the intended agent's terminal.
Koto adds no permission bypass. Integration writes to the **session's separate
integration worktree**, never directly to your original project branch. Changed
contributions must be reviewed again. Conflicts remain available for manual Git
resolution and explicit acknowledgement. Review the integrated result and run
your application before deciding how to bring it into your normal branch.

### 4. Return to saved work

Open `koto` again to use remembered account, project, model and worker choices.
`/sessions` selects a saved build; `/review`, `/integrate` and `/resume` select an
agent and guide the next action without copied session-directory paths.
Supported continuation keeps the original conversation and worktree. After an
integration, the next review covers only subsequent changes. Missing native
identity, unresolved conflicts or unconfirmed cleanup block continuation or
integration.

Use `/accounts`, `/agents`, `/models` and `/help` to inspect choices. `/models add`
opens guided acquisition; `/models use MODEL_ID` selects a downloaded model.
See [guided sessions](docs/GUIDED_SESSIONS.md) for the everyday journey and recovery.
For explicit Codex/OpenCode profiles, pipe modes and scripted plans, use
`koto setup` and the [project-session guide](docs/PROJECT_SESSIONS.md).
No hand-written JSON plan is required for normal setup.

## Current boundaries

| Area | Current behavior |
| --- | --- |
| Terminal transport | Pipes, macOS/Linux PTYs and Windows ConPTY; helper prerequisites apply. Native terminal screens are not parsed as structured completion or identity. |
| Native lifecycle | Supported structured Codex/OpenCode profiles capture native IDs and outcomes for explicit continuation. Capabilities depend on the selected adapter and mode. |
| Permissions | Native clients retain their permission policy. Declared ownership is advisory during execution; worktrees are not an OS sandbox. |
| Outcomes | Process exit, native completion and code correctness are separate. Changes still need review and actual application use. |
| Cancellation | Owned process/session or Job Object cleanup must be confirmed. `cleanup_unconfirmed` blocks resume and integration. |
| Recovery | No automatic task replay, conflict decision or worktree deletion. Pending integration outcomes require explicit reconciliation; native clients may perform their own retries. |
| Evidence | Source/helper CI, package identity and actual task outcomes are separate. Observed platform/client limits are recorded in the acceptance documents. |
| Delivery | CLI and shared API are implemented; IDE plugins and Koto's own UI remain planned. Alpha publication and registry-install verification are separate release steps. |

Private choices normally live in `~/.koto/preferences.json`; `KOTO_STATE_DIR`
selects another private absolute state directory for the guided journey. Session
state retains prompts, native output and workspace paths. Default control files
live under `~/.koto/sessions`, with worktrees under `~/.koto/sessions-worktrees`;
explicit control storage must remain outside project worktrees. Uninstalling
Koto does not delete this work. Keep credentials and private sessions out of
commits and issue reports. Read [security](SECURITY.md) and
[session boundaries](docs/PROJECT_SESSIONS.md#boundaries-and-retained-data).

## One core, multiple interfaces

```js
import { createProjectSession } from '@mehrdadz/koto';

const session = await createProjectSession(plan, {
  onEvent: event => renderEvent(event)
});
const result = await session.run();
```

The shared API also includes discovery, plan building and revision, retained
session inspection, explicit continuation, token-approved integration and
reconciliation. Generic workflows use the JSON-stdin/text-stdout worker
contract; project sessions launch the native commands declared in their plan.

The order is **accepted CLI journey → UIs and IDE plugins using the same core**.
Each delivery consumes the same operations and product state. Scheduling,
workspace ownership, native lifecycle and integration remain in the shared
core. See the [architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md) and
[product scope](docs/SCOPE.md).

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md), choose a focused improvement, and
record the behavior you directly observe. The repository currently uses source
and scope checks; automated suites and fixture demos are removed.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

| Start here | Responsibility |
| --- | --- |
| [src/core.js](src/core.js) | Task-graph validation, scheduling, dependencies and cancellation |
| [src/project-session.js](src/project-session.js) | Project plan, session lifecycle, events and operator controls |
| [src/command-session.js](src/command-session.js) | Streamed executable lifecycle, input, bounds and cleanup |
| [src/project-workspaces.js](src/project-workspaces.js) | Worktree ownership, diff capture, review tokens and integration |
| [src/process-agent.js](src/process-agent.js) | Generic JSON worker protocol |
| [bin/chat.js](bin/chat.js) · [bin/project.js](bin/project.js) | Guided conversation and terminal delivery through the shared APIs |
| [src/index.js](src/index.js) · [src/core.d.ts](src/core.d.ts) | Public exports and TypeScript declarations |

Keep model credentials, permission enforcement and provider-specific behavior in
the appropriate native runtime/adapter. Keep new interfaces thin. For defects,
include revision, Node version, OS and a sanitized reproduction in
[GitHub issues](https://github.com/mehrdadxzaker/Koto/issues). For private security
reports, follow [SECURITY.md](SECURITY.md).

Translations are welcome: keep commands and technical identifiers unchanged,
align content with this English README, and add reciprocal language links.

[Support](SUPPORT.md) · [Maintainers](MAINTAINERS.md) ·
[Code of conduct](CODE_OF_CONDUCT.md) · [Apache-2.0 license](LICENSE)
