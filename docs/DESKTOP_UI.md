# Koto desktop workspace

Koto's first desktop surface is a project/session sidebar and one interactive
Koto CLI. The same CLI owns coordination, planning, native agent terminals,
review and approved integration. The desktop does not implement another agent
scheduler or convert terminal output into a model transcript.

Status: implementation preview with bounded macOS ARM64 observations below.
This is not a signed/notarized or cross-platform desktop release.
The existing npm alpha remains a separate frozen release; this source change
does not replace an already published package.

## Run from source

Node.js 22+, npm and Git are required. Desktop dependencies are isolated under
`ui/desktop`; the root core and CLI keep their dependency-free installation.

```sh
cd ui/desktop
npm ci
npm run build
npm start
```

The host needs Koto's matching native terminal helper. Use the desktop's explicit
terminal-support setup action, or build it from the same source using:

```sh
node bin/koto.js terminal build
```

A helper build uses the host's existing compiler/SDK. It does not install
developer tools. See [installation prerequisites](INSTALLATION.md#build-the-host-helper).

## Interface

Slash menus, mentions, plans and review controls run inside the shared terminal
UI. See the [terminal UI documentation](TUI.md) for the terminal-controls
reference. Sharing these controls does not establish native desktop or iTerm2
acceptance beyond the recorded observations below.

- Open a project with the native folder picker, then open its Koto CLI.
- The sidebar lists actual known projects and saved session shortcuts. Selecting
  a retained session chooses it for the CLI's existing saved-work commands; it
  does not launch or resume an agent automatically.
- Type directly into the terminal. All Koto onboarding, account, model, plan,
  review and approval prompts remain interactive.
- `/help` lists conversation commands. During project work, `:attach AGENT`
  opens that agent's native terminal and Ctrl-] returns to Koto.
- Switching a running CLI requires confirmation and successful cleanup before
  the replacement starts. Closing the window stops its owned work and awaits
  cleanup. A cleanup uncertainty is shown and prevents replacement.

The sidebar is navigation around the CLI. This preview owns one CLI at a time;
it does not attach to an unrelated CLI process running elsewhere.

## Agent indicators

Small provider glyphs identify the coordinator and configured agents. A spinner
means the observed activity is in progress. Labels distinguish waiting for a
response, responding, command/tool activity, approvals, completion and failure.
A running native process with no activity observation stays explicitly
unobserved; it is not labeled as thinking or correct.

Colors follow `NO_COLOR` and `TERM=dumb`. Set `KOTO_NO_ANIMATION=1` to keep static
activity indicators, including in a native terminal. Desktop reduced-motion
settings apply when opening the next CLI.

## Delivery boundary

The desktop has its own dependencies and package version, and bundles the exact
core/CLI source used for its build. Its helper must match those sources. Core npm
publication, signed/notarized desktop distribution, automatic updates, multiple
live workspaces and live attachment to an existing external CLI are separate
delivery work.

See [architecture](ARCHITECTURE.md), [session controls](GUIDED_SESSIONS.md) and the
[UI milestone proposal](UI_IDE_MILESTONE.md).

## Recorded Mac preview observations

On October 28, 2026, the unsigned built app was opened outside the checkout with
private app/Koto state and existing native account ownership preserved:

- Explicit terminal-support setup compiled the matching packaged helper.
- Native folder selection opened the real Koto project, and its sidebar entry
  survived an ordinary app close/reopen.
- Fresh CLI onboarding discovered the existing Codex login; local model setup
  was declined. Returning startup reached the selected project conversation.
- A real Codex response showed the provider glyph and successive working-spinner
  frames. No build, worker launch, code edit or tool action was requested.
- A draft started during a response retained its insertion point: typing
  `/he`, waiting for the response, then typing `lp` executed `/help` correctly.
- Sidebar collapse/reopen and font changes resized the terminal. Settings and
  reduced-motion selection worked through the native app controls.
- Stop CLI showed the ordinary stopped state. The 16 recorded CLI, helper,
  Codex and MCP child process identities were absent afterward.
- Source/scope checks and the desktop production build passed. Packaged core,
  CLI and desktop payloads were compared against the source files.

Initial actual runs exposed terminal geometry clipping, a requested stop shown
as `exit_failed`, and a retained draft whose cursor reset to its beginning.
Those observations were retained, the causes corrected, and the affected
interactions repeated successfully.

The fresh private setup had no saved build shortcuts. Saved-session selection
was source-reviewed but not observed with a retained build in this desktop run.
Worker native-TUI attachment, forced cleanup/crash paths, reduced-motion during
an active model response, Windows/Linux desktop operation and signed/notarized
installation remain unobserved. The earlier CLI acceptance is not expanded by
these desktop observations.
