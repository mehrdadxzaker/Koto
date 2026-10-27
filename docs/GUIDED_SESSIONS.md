# Talk to Koto and build with agents

Running `koto` now opens a persistent **conversation**, backed by an installed,
logged-in Codex or Claude CLI, or a configured local model. A greeting is sent
to that real coordinator; it is not interpreted as a directory. Conversation
does not require a Git project. Coding requests produce a plan for review,
with project selection or explicit creation only when needed.

```sh
node bin/koto.js
```

Type a message or describe what you want to build. `/help` lists controls.
`/agent codex`, `/agent claude` and `/agent local` select the coordinator;
`/model MODEL` selects its model. Codex uses its existing ChatGPT login and
Claude uses its native subscription login. Koto does not copy credentials or
substitute a paid API provider. Native permission requests require an explicit
operator decision when the native CLI asks.

Use `/new PATH` to create an empty project after confirmation, or `/project PATH`
to select an existing clean Git repository. Existing folder contents are never
automatically committed, stashed or discarded. The coding coordinator proposes
tasks for configured agents; `/agents`, `/add codex`, `/add claude` and
`/add local MODEL` manage those choices. Review the actual assignments and type
`build` before execution. Each task receives an isolated worktree and live
agent/model status, spinner and observed activity.

During execution, `:stop AGENT` stops one agent, `:review AGENT` displays its
contribution and `:integrate AGENT` explicitly applies the displayed review.
The integration branch remains separate from the original checkout. Native
continuation retains the originating session and worktree; unresolved cleanup
or conflicts remain explicit and block further application.

Local model controls are `/models` for discovery, `/models pull MODEL` for an
explicit Ollama download, `/models get URL FILE SHA256` for verified GGUF
weights, and `/models start GGUF` for an owned llama.cpp server. Compatible
models need their actual weights and supported architecture. `/runtime build
COMMIT` explicitly builds llama.cpp from an exact official source commit with
already installed development tools. No compiler or model is downloaded just
by opening Koto. The local coding agent has real workspace file tools and asks
before executing commands; model responses are never simulated.

Native sessions, local context and partial outcomes remain private product
state. CLI choices live in `~/.koto/preferences.json`; `KOTO_STATE_DIR` can select
another private absolute state directory. Unknown provider costs remain unknown.
Source checks and helper compilation do not establish successful model execution;
actual host observations are recorded separately in the delivery tracker.

## Advanced manual session setup

Run `koto setup` in a terminal to open the explicit configuration wizard. From a
source checkout, use `node bin/koto.js setup`. `koto --help` prints command help.

Choose **Start an agent session**, then supply a clean, committed Git project,
goal, agent count and deadline. For each agent, select Codex or OpenCode, its
installed executable, model, task and literal file/directory ownership.
No JSON file or hand-written argument array is required.

Each agent has two interaction modes:

| Mode | Use it for | Native lifecycle |
| --- | --- | --- |
| Interactive terminal | Native screens, permission prompts and direct keyboard input | Screen text is not interpreted as a session ID or completion event. |
| Structured pipe | A bounded noninteractive task followed by an exact native-session continuation | Koto reads the client's structured events and retains the originating native session ID when exposed. |

Codex can use an explicitly selected existing ChatGPT login or the existing
native host configuration. OpenCode requires an explicit configured
`provider/model`. For a local OpenCode model, select **Configured local model
server** and supply the existing JSON configuration and loopback URL. The file
must already be selected by `OPENCODE_CONFIG`. Koto checks declared prerequisites
without changing credentials, configuration or native permission policy.
Provider settings may be merged by the native client; file and listener checks
do not prove local-only inference. See [launch setup](LAUNCH_SETUP.md).

Interactive terminals use the helper for the current platform. If it has not
been built, the launcher offers **Build the helper now using installed tools**
or **Return to the menu**. The build is explicit and downloads no compiler.
**Set up terminal support** in the main menu performs the same operation.
The default private directory is `~/.koto/native`; a custom directory must be
absolute and outside Git worktrees.
On Windows, this setup comes before repository inspection and applies to pipe
agents too, because those processes also use the helper's Job Object ownership.

Repository, executable, transport and declared runtime checks run through the
shared core before creating agent workspaces. Review the complete launch
summary and type `start`. No agent is launched while configuring the plan.

During the session:

- `:status` displays agent states, process IDs and worktrees.
- `:attach codex1` opens that agent's native terminal. **Ctrl-]** returns to Koto.
- Resizing the outer terminal resizes the attached agent. `:resize codex1 120 36`
  also sets dimensions explicitly.
- `:stop codex1` stops that owned agent; `:stop all` stops all session agents.
- `:review codex1` displays the changes the next integration would apply and
  remembers the review. After an earlier integration, this is the new delta.
- `:integrate codex1` applies that displayed contribution after all agents finish
  and cleanup is confirmed. A changed contribution must be reviewed again.
- `:resolve codex1 FULL_COMMIT_SHA` acknowledges an exact, reviewed conflict
  resolution commit in the integration worktree.
- `:help` lists controls; `:quit` returns to the launcher and retains worktrees.

Native prompts remain native: attach to the intended agent to answer them.
Koto does not add permission bypasses. A native process exit or completed turn
does not establish the correctness of its changes.

Integration writes only into the separate session integration worktree.
Conflicts and unconfirmed cleanup remain visible; the original checkout is not
updated. **Review a saved session** displays its retained diff and asks for
explicit integration approval.

If integration conflicts, resolve and review them in the printed integration
worktree, finish the Git cherry-pick, and leave that worktree clean. Acknowledge
the exact resulting commit with:

```sh
koto project resolve "/printed/session/directory" AGENT --approve FULL_COMMIT_SHA
```

The command records your approval after checking the retained conflict and Git
history; it does not choose a resolution or create a commit. The session cannot
apply another contribution from that agent until this acknowledgement succeeds.
Do not delete its integration receipt or lock to force a retry.

Choose **Resume a native agent session** to continue a retained structured-pipe
session. Supply the printed Koto session directory, agent ID and a new prompt.
Koto uses the captured native session ID and originating workspace, executable,
model and account selection, and shows the continuation for launch approval.
It never chooses a client's latest session. An absent ID, unsupported native
protocol, active or unresolved cleanup, or incompatible retained state is a
refusal to resume, not an invitation to replay the original task. Interactive
terminal sessions do not expose structured native IDs to Koto.

Resume preserves earlier attempts and integrations. Once a continuation is
reviewed, integration applies only the changes since that agent's last accepted
snapshot, so the first contribution is not applied again. `koto project status
"/printed/session/directory"` displays retained process and native outcomes,
native IDs, attempts and integration status without starting a process.

Private state retains prompts, native output and workspace paths. Keep it local;
report the compact outcome requested in the [acceptance run](USER_ACCEPTANCE.md)
instead of sharing complete transcripts.
