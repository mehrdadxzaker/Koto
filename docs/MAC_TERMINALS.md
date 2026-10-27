# Experimental Mac terminal transport

This branch adds optional Darwin PTY sessions to the shared project-session
core. **Actual Darwin compilation and real-agent PTY operation are still
pending.** The earlier Codex/OpenCode Mac demonstration used pipes; it does not
verify this terminal backend.

## Prepare the exact source and helper

On the Mac, use the reviewed commit supplied with the handoff:

```sh
git clone --branch codex/mac-interactive-sessions https://github.com/mehrdadxzaker/Koto.git Koto-mac
cd Koto-mac
git rev-parse HEAD
node bin/koto.js terminal --help
```

Compare `HEAD` with the supplied commit before proceeding. Use this checkout's
CLI rather than an older installed `koto`. Node.js 22+, Git and an already
installed Apple command-line developer toolchain are required for this opt-in
build. Nothing downloads or installs a compiler.

Build explicitly into a private absolute directory outside Git worktrees:

```sh
node bin/koto.js terminal build --directory /absolute/private/path/koto-native
node bin/koto.js terminal info --directory /absolute/private/path/koto-native
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

Confirm the actual Mac installations' `codex --help` and `opencode --help`
before choosing their foreground interactive arguments. This guide does not
invent native TUI flags or replace an agent with a stand-in. Preserve the
authorized accounts, local-only model configuration and native permission
policy; Koto adds no approval bypass or provider fallback.

PTY dimensions default to 80 columns by 24 rows. PTY stdin defaults to `pipe`,
so it remains open for operator input; ordinary pipe transport still defaults
to `closed`. An explicit `closed` mode sends EOF after optional initial input.

## Operate from a real terminal

```sh
node bin/koto.js project start /absolute/private/path/pty-plan.json
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
| `:inspect codex` / `:integrate codex TOKEN` | Review and explicitly integrate after all session commands finish. |

Attachment requires terminal stdin/stdout. Native screen output is shown only
for the attached agent; other output remains in bounded private session logs
and tails. Detaching normally restores the outer input mode and display.

## Ownership and current limits

The helper supervises an **OS terminal session**, distinct from both Koto's
saved project-session ID and any native provider conversation ID. A missing or
unconfirmed cleanup acknowledgment is reported as `cleanup_unconfirmed` and
blocks automatic integration. Worktrees and process ownership are not a
hostile-code sandbox; agents keep their native host permissions. Self-detached
processes are outside the ordinary owned-session boundary. Hard host death
cannot restore the dead host's terminal, and helper death cannot prove cleanup.

The next observation must use actual Codex/OpenCode agents on the Mac: answer a
native prompt, resize, stop one while the other continues, and confirm owned
cleanup before reviewing/integrating their changes. No PTY readiness claim
follows from source inspection or the previous pipe-based run.

This new transport rejects Linux and Windows. Their existing pipe mode remains
available; earlier Linux PTY work is separate and not integrated here. Native
continuation, provider permission-state parsing and semantic completion
recognition are not implemented by this generic terminal transport.
