# Open Koto and start a session

With this source checkout and Node.js 22 or newer, run:

```sh
node bin/koto.js
```

`koto` with no arguments opens a persistent terminal menu. `koto start` opens
the same launcher; `koto --help` intentionally prints command help. An actual
terminal is required for the menu.

Choose **Start an agent session**, then supply the existing clean Git project,
goal, number of agents and deadline. For each agent, select Codex or OpenCode,
its installed executable, model, task and literal file/directory ownership.
Koto checks the repository and executable paths before showing the full launch
summary. Type `start` only after reviewing that summary. No model is called
while you are configuring the session, and no JSON file needs to be written.
The same core preflight also checks prepared [launch plans](LAUNCH_SETUP.md).
Windows project launch is blocked until owned-process cleanup can be confirmed.

Codex can use its existing ChatGPT login explicitly or its existing native
configuration. OpenCode requires an explicit configured `provider/model`; its
native configuration and any local model server must already be available.
Koto does not log in, change native permission policy, download models or
create a fallback provider. These profiles invoke real `codex exec` and
`opencode run` over pipes. They are distinct from the experimental full-screen
[Mac PTY transport](MAC_TERMINALS.md).

During the session:

- `:status` displays agent states, process IDs and worktrees.
- `:stop codex1` stops that owned agent; `:stop all` stops the session's agents.
- `:review codex1` displays its complete contribution and remembers the review.
- `:integrate codex1` explicitly applies the displayed contribution after all
  agents finish. The core checks that its review token still matches; a changed
  contribution must be reviewed again. An explicit token remains supported.
- `:help` lists controls; `:quit` returns to the launcher and retains worktrees.

Integration writes into the separate session integration worktree. Conflicts
and unconfirmed cleanup remain visible; the original checkout is not updated.
The menu also offers **Review a saved session**, with explicit integration
approval after displaying its diff. Private state retains the exact goal,
commands, tasks, output and worktree paths; do not publish it as-is.

This launcher has been opened directly in a terminal. That observation does not
establish a new native-agent run, Mac PTY behavior or all-platform support. The
earlier actual Codex/OpenCode pipe run is separate evidence.
