# Mac terminal transport

Koto's shared project-session core includes an optional macOS PTY backend.
**Build it with the intended Mac's existing SDK before use; real-agent Mac PTY
operation is still unverified.** The earlier Codex/OpenCode Mac demonstration
used pipes; it does not verify this terminal backend. Linux and Windows use
their own helpers through the same core interface.

## Prepare the exact source and helper

On the Mac, use the exact reviewed installation command supplied with the
handoff. The commands below call that installation `koto`:

```sh
koto --version
koto terminal --help
```

If using a source checkout, compare its `git rev-parse HEAD` with the supplied
commit and invoke that checkout's `bin/koto.js`. Node.js 22+, Git and an already
installed Apple command-line developer toolchain are required for this explicit
build. Nothing downloads or installs a compiler. The guided launcher also
exposes **Set up terminal support**; see the [acceptance run](USER_ACCEPTANCE.md).

Build explicitly into a private absolute directory outside Git worktrees:

```sh
koto terminal build --directory /absolute/private/path/koto-native
koto terminal info --directory /absolute/private/path/koto-native
```

`build` compiles Koto's versioned C source with the selected Apple clang and
records source, architecture, compiler and binary identity. `info` verifies that
existing build without compiling. Unrecognized files are preserved rather than
overwritten. A changed helper source needs a matching build.

## Opt real agents into PTY transport

Start with a complete [project plan](PROJECT_SESSIONS.md) for a clean, committed
project. Keep its required `project`, `goal`, agent `command`/`args`, `task` and
`owns` fields. These are the additional fields, not a complete runnable plan:

```json
{
  "nativeHelperDirectory": "/absolute/private/path/koto-native",
  "maxConcurrency": 2,
  "agents": [
    {
      "id": "codex",
      "transport": "pty",
      "terminal": { "columns": 100, "rows": 30 },
      "inputMode": "pipe"
    },
    {
      "id": "local",
      "transport": "pty",
      "terminal": { "columns": 100, "rows": 30 },
      "inputMode": "pipe"
    }
  ]
}
```

The guided launcher and native plan profiles provide interactive Codex and
OpenCode arguments. For a raw plan, check the installed clients' `--help` before
choosing foreground interactive arguments. Preserve the authorized accounts,
local-only model configuration and native permission policy; Koto adds no
approval bypass or provider fallback. [Native sessions](NATIVE_SESSIONS.md)
describes the supported profiles and capabilities.

PTY dimensions default to 80 columns by 24 rows. PTY stdin defaults to `pipe`,
so it remains open for operator input; ordinary pipe transport still defaults
to `closed`. An explicit `closed` mode sends EOF after optional initial input.

## Operate from a real terminal

```sh
koto project start /absolute/private/path/pty-plan.json
```

Review the listed plan and type `start`. The CLI prints each worktree and the
private session directory. In the Koto controls:

| Control | Action |
| --- | --- |
| `:attach codex` | View and interact with that running PTY agent; **Ctrl-]** detaches back to Koto controls. |
| `:resize codex 120 36` | Set columns and rows. Resizing the outer terminal also updates the attached agent. |
| `:send codex TEXT` | Send a line without attaching. |
| `:eof codex` | Send the terminal's EOF input; the native CLI decides how to handle it. |
| `:stop codex` / `:stop all` | Request owned cleanup while retaining worktrees and partial edits. |
| `:review codex` / `:integrate codex` | Review and explicitly approve integration after all session commands finish and settle cleanup. |

Attachment requires terminal stdin/stdout. Native screen output is shown only
for the attached agent; other output remains in bounded private session logs
and tails. Detaching normally restores the outer input mode and display.

## Ownership and current limits

The helper supervises an **OS terminal session**, distinct from both Koto's
saved project-session ID and any native provider conversation ID. A missing or
unconfirmed cleanup acknowledgment is reported as `cleanup_unconfirmed` and
blocks integration and resume throughout the project session. Worktrees and
process ownership are not a hostile-code sandbox; agents keep their native host
permissions. Self-detached processes are outside the ordinary owned-session
boundary. Hard host death
cannot restore the dead host's terminal, and helper death cannot prove cleanup.

Mac acceptance must use actual Codex/OpenCode agents: answer a native prompt,
resize, stop one while the other continues, and confirm owned cleanup before
reviewing/integrating their changes. Follow [the acceptance run](USER_ACCEPTANCE.md)
and retain failed or partial outcomes. Source inspection and the earlier pipe
result do not establish native Mac terminal behavior.

The common terminal API selects a macOS PTY helper, a Linux PTY helper using
procfs/pidfds, or a Windows ConPTY helper with Job Object ownership. Windows
project pipe commands also use its helper. Each host builds its own helper with
existing tools; a Mac build cannot be reused on another platform. The shared
[architecture](ARCHITECTURE.md) describes these boundaries and
[current evidence](CORE_STATUS.md) records what has actually been observed.

The terminal transport leaves native permission prompts and screen interaction
with the native CLI. It does not scrape a reliable conversation ID or completion
state from the display. Structured Codex/OpenCode pipe profiles separately expose
native events and exact captured-session continuation; use those profiles for
the [native resume flow](NATIVE_SESSIONS.md).
