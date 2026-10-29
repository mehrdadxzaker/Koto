# Koto for VS Code and Cursor

A native project/session sidebar and terminal for Koto's existing CLI. Reuse your
native Codex subscription, optional local models, projects and saved sessions.
Account discovery, planning, coding, review, integration and continuation stay in
that CLI. No provider API key or second Koto account is required for subscription
use, and native credentials remain with their native clients.

This extension is an implementation preview. Source/package checks and actual
installed VS Code/Cursor workflow observations are separate acceptance evidence;
packaging alone does not establish native agent access or useful coding work.

## Install

Install the reviewed `koto-0.1.0.vsix` with **Extensions: Install from VSIX…** in
VS Code or Cursor, then open the Koto activity-bar icon. The extension contains
the exact `@mehrdadz/koto@3.0.0-alpha.1` CLI payload. It does not need a global
Koto installation or run npm during activation.

Requirements:

- A desktop IDE with VS Code API 1.100 or later, a trusted local folder and Git.
- An installed Node.js 22 or later. Koto discovers a local executable; optionally
  choose its absolute path in the **Koto: Node Path** User setting.
- The host's existing compiler/developer tools for the explicitly requested
  terminal-helper setup. Koto does not install a compiler automatically.
- For subscription coding, the native Codex client and its native ChatGPT login.
  The normal CLI onboarding discovers existing logins and offers guided setup.

Browser, virtual and remote workspaces are outside this first extension surface.
The extension refuses those hosts before launching a local CLI. Compatibility
with a VS Code API does not by itself qualify another IDE or operating system.

## Use Koto

1. Choose **Koto: Open Project** to select a workspace folder or use the native
   folder picker. Selecting a tree item only chooses navigation.
2. Choose **Koto: Set Up Terminal Support** when the sidebar reports it missing.
   This builds the matching helper with the installed host tools.
3. Choose **Koto: Open Koto**. The native IDE terminal runs the real CLI. First
   run discovers your native subscription login and offers optional local
   models; returning runs reuse Koto's saved setup.
4. Describe work, inspect its proposed tasks and ownership, then explicitly
   approve the build in Koto. Review and integrate the actual contributions
   through the CLI's existing controls.
5. Use **Koto: Open Saved Session** or its tree-item action to open that retained
   selection in the CLI. Use `/sessions`, `/resume`, `/review` and `/integrate`
   at Koto's appropriate prompts. The extension never types those commands into
   an arbitrary terminal prompt or automatically replays an agent task.

During a running build, the CLI uses its existing `:review AGENT`,
`:integrate AGENT`, `:stop AGENT/all` and `:quit` controls. Review and integration
are separate explicit actions. Koto retains worktrees and captures the native
conversation for a later requested continuation.

The extension owns one Koto CLI at a time. Switching asks to stop the current
owner first. **Koto: Stop Koto CLI**, terminal close and extension deactivation
request owned cleanup. A `cleanup_unconfirmed` outcome blocks replacement;
inspect the retained session instead of forcing a retry. The child runner also
owns bounded EOF cleanup if the IDE terminates its extension host before normal
deactivation can finish. Process liveness or terminal disposal alone does not
establish cleanup or useful work.

## Shared state

The default state is Koto's existing `~/.koto`. Projects and saved sessions come
from the shared core's protected preferences/session records. The extension
stores only navigation bookmarks in its local IDE presentation state. It does
not copy credentials, models or conversations into IDE settings or project files.

**Koto: State Directory** optionally selects another absolute private directory
in User settings. Both runtime and state settings use only User values;
workspace settings cannot redirect them. Stop the current CLI before applying
such changes. Account setup and optional model downloads stay inside Koto's
normal interactive choices.

## Build a reviewable VSIX

From this directory with Node.js 22+ and npm:

```sh
npm ci
npm run check
npm run build
npm run package
```

The build stages the pinned CLI's exact 54 payloads into `dist/core` and verifies
the tracked integrity manifest. VSIX packaging includes that frozen payload and
the host adapter; it excludes build tools and dependency trees. Source syntax,
payload identity and native installed workflow acceptance remain distinct. The
repository does not use automated suites, fixture agents or benchmarks.

See the [Koto CLI guide](https://github.com/mehrdadxzaker/Koto/blob/main/docs/GUIDED_SESSIONS.md)
for the shared workflow and
[project-session controls](https://github.com/mehrdadxzaker/Koto/blob/main/docs/PROJECT_SESSIONS.md)
for retained review, integration and recovery boundaries.
