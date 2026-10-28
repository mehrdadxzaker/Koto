# Koto desktop: sidebar and terminal

This desktop host displays the real Koto CLI in one interactive terminal. The
sidebar lists actual project folders and retained build shortcuts from Koto's
preferences. It does not create another coordinator, scheduler or agent store.

## Run from this checkout

Install Node.js 22.12 or newer with npm and the native helper's documented host
build tools. Desktop dependencies are isolated here; the core npm package stays
dependency-free.

```sh
cd ui/desktop
npm ci
npm run build
npm start
```

The first launch checks existing terminal support. Choose **Set up terminal
support** to compile Koto's pinned platform helper using tools already installed
on your computer. Nothing downloads or installs a compiler. The helper's source
and binary identity are checked before each CLI launch.

Choose a project with the sidebar's folder picker, then open its Koto terminal.
The CLI keeps account discovery, native sign-in, model choices, plan approval,
native terminal attachment, review and integration. Selecting a retained build
selects that existing record; it does not automatically resume an agent or run
work. Use the CLI's `/resume`, `/review` and `/integrate` controls when appropriate.

Only one desktop CLI runs at a time. Switching projects asks before stopping it.
The desktop can inspect shortcuts written by a separately running CLI; it cannot
take control of that other process or attach to its live terminal.

## Local application bundle

```sh
npm run pack -- --config.directories.output=/absolute/path/to/koto-desktop-build
```

The resulting application includes this checkout's `bin/`, `src/`, package
metadata and existing Koto logo under its resources. It does not silently
substitute a registry core.
The initial bundle is an unsigned local build, without auto-update, signing,
notarization or installer/public-release qualification.

## Lifecycle and resource bounds

- Terminal input and resizing are forwarded to Koto's existing owned platform
  helper. Native agent permissions and credentials remain in the CLI workflow.
- Ordinary stop/quit first attempts to signal the same captured POSIX CLI
  process identity so Koto can close its own resources. It waits up to 12 seconds,
  then uses the outer helper's bounded stop path if needed. Windows uses the
  owned helper path; desktop Windows behavior needs its own installed observation.
- Confirmed cleanup is required before replacing a CLI. Unconfirmed cleanup
  remains visible, blocks replacement, and keeps the window open on ordinary
  quit. Closing or crashing a renderer stops its owned CLI; it does not restart
  that CLI automatically.
- The CLI reserves exit code 74 for unconfirmed nested cleanup. That exit,
  unexpected signals, deadlines and forced helper fallback remain unconfirmed
  in the desktop even if the outer helper confirms its own physical cleanup.
  The outer terminal's cleanup record alone cannot establish the inner agent
  lifecycle. Shutdown rejects queued/new launches and further terminal input
  while allowing output acknowledgements to drain.
- The existing terminal transport has a one-hour invocation deadline and an
  8 MiB output bound. The desktop keeps a 256 KiB recent-output tail and at most
  256 KiB of unacknowledged output. A stalled renderer stops the CLI with an
  explicit error rather than growing the queue indefinitely. The recent tail
  is not a saved full terminal transcript or complete terminal-screen replay.
- The renderer has no Node integration, shell access, generic IPC or remote
  navigation. The main process validates sender identity, project/session IDs,
  input size and dimensions. All UI assets are packaged locally.

For a fresh local acceptance observation, `KOTO_DESKTOP_DATA_DIR` may name an
existing canonical private directory owned by the current account. It changes
only Electron's application/session data location. `KOTO_STATE_DIR` independently
selects the core's protected state directory; native client homes and account
credentials remain with their clients.

`NO_COLOR`, `TERM=dumb` and `KOTO_NO_ANIMATION=1` control CLI presentation.
The desktop passes the operating system's reduced-motion preference as the
animation opt-out when starting a CLI.

Source checks and a bundle build are not installed native-agent acceptance.
Record the actual desktop host, source revision, native interactions and cleanup
observations separately before claiming that combination is supported.
