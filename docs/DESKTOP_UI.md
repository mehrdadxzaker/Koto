# Koto desktop workspace

Koto's first desktop surface is a project/session sidebar and one interactive
Koto CLI. The same CLI owns coordination, planning, native agent terminals,
review and approved integration. The desktop does not implement another agent
scheduler or convert terminal output into a model transcript.

Status: implementation preview. Platform observations, source identity and
packaging boundaries must be recorded before claiming a supported desktop release.
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
