# Open Koto and start working

Run the installed CLI:

```sh
koto
```

`koto start` opens the same conversation. From a source checkout, use
`node bin/koto.js`. Setup runs once; later launches remember your account
selection, downloaded models, project and saved builds.

## First launch

Koto finds supported Codex and Claude Code installations and asks each native
client for its login status. Choose a listed account to reuse your ChatGPT or
Claude subscription. If sign-in is needed, Koto can open that client's native
sign-in flow. If the client is missing, you can approve installing its official
package into Koto's private directory. An existing native login is a discovery
result; model access and remaining usage are established when you start work.
No provider API key is required, and native credentials remain with the client.
You can skip subscription setup and configure a local model instead.

Next, choose whether to add an open-source model. The optional list shows model
sizes, licenses and memory guidance. After your confirmation, Koto acquires a
pinned llama.cpp runtime and verifies the selected model download. Existing
verified assets are reused. You can skip local setup and use your subscription.

Choose a project folder, or enter `new PATH` to create an empty project after
confirmation. Enter `later` to keep chatting without a project. An existing
project must be a clean, committed Git repository. If it needs attention, Koto
explains the problem and lets you choose again; your files stay available for
you to review. Use `/project PATH` or `/new PATH` to change the project later.

When setup finishes, type a message or describe the work you want. Conversation
does not require a project. A coding request produces a proposed plan with
agents, models, tasks and contribution paths. Type `edit` to change an assignment,
choose a configured agent/model, revise ownership/dependencies, edit the summary
or concurrency, or remove a task.
Koto validates the revised plan and displays it again. Type `build` to launch.
The configured agents work through the shared core in isolated
worktrees, with observed progress and native permission requests when needed.

## Everyday use

Returning users enter the conversation with their saved setup. Koto checks the
selected native login. On a returning launch, a managed local model starts only
for a local coordinator. With Codex as coordinator, remembered downloads or local
workers do not start a model while you enter the conversation or review a proposed
plan. A build starts its matching managed model after you approve a local task.
A local continuation can start its original model for readiness checks before
the separate agent-launch confirmation. Koto preserves the task's exact model and
endpoint; an unavailable original binding gets recovery guidance rather than a
substitute model. Downloaded assets remain available while their model is stopped.
Already-running Ollama servers stay under your control; Koto reuses the chosen
model without starting another runtime.

Use `/accounts` to rediscover subscriptions or open native sign-in. `/agents`
shows the configured workers; `/add codex`, `/add claude` and `/add local MODEL`
add choices. `/agent codex`, `/agent claude` and `/agent local` choose the
coordinator, and `/model MODEL` changes its model. `/help` lists the controls.

During a build, `:stop AGENT` stops one agent, `:review AGENT` displays its
contribution, and `:integrate AGENT` applies that displayed contribution after
approval and confirmed cleanup. `:quit` returns to the conversation and retains
the build. Integration writes to the separate integration worktree.

You can keep talking to the coordinator at `Agents>` while workers run. Ordinary
text or `:chat TEXT` sends a real coordinator turn with bounded, observed worker
status and activity. `:chat-stop` cancels that turn and its queued messages while
workers continue. Native permission requests still need explicit approval.
Replies wait while an attached native terminal owns the screen. The coordinator
has an eight-message queue; requests for another build enter a separate queue of
at most eight goals. After `:quit`, each goal gets a new plan for review before
any new workers start. These queues are for the current conversation and are not
replayed after exit.

The next build uses the selected saved build's clean, reviewed integration
workspace when it has accepted contributions. Koto verifies the retained receipts,
owned worktrees and recorded target commit before planning. Active agents,
unconfirmed cleanup, conflicts or an unresolved integration attempt block this
continuation. Unreviewed worker edits remain in their original worktrees; they
are never carried forward automatically. The new base is checked again at launch.
Your selected project remains the returning setup default, and its earlier saved
builds remain in `/sessions`. The reviewed build base is used only for the current
conversation and plan; each subsequent build revalidates its selected saved
session, including any reviewed changes inherited in that session's original base.

Saved work is available without copying session directories:

| Command | Action |
| --- | --- |
| `/sessions` | Show the current project's saved builds; choose one when several exist. |
| `/review` | Choose a saved agent and inspect its contribution. |
| `/integrate` | Choose an agent, inspect its current diff and type `integrate` to accept it. |
| `/resume` | Choose a saved agent, describe its next task and approve the exact continuation. |

You can supply the agent ID to `/review`, `/integrate` or `/resume` to skip the
agent selector. Supported continuation keeps the originating native session,
worktree, model and account. After integration, the next review covers only the
agent's subsequent changes. Missing native identity, unresolved conflicts or
unconfirmed cleanup require attention before continuation or integration.

## Local models and recovery

Use `/models` to list downloaded choices and reachable local runtimes.
`/models add` opens the guided download choices again; `/models use MODEL_ID`
selects a downloaded model for new local work. Koto retains multiple downloaded
assets and runs one managed model server at a time. Selecting another managed
model updates configured local workers; retained sessions keep their recorded
model identity.

Model suitability guidance uses system memory, while startup also checks current
available memory and enforces a reserve. On macOS this uses the system's
memory-pressure estimate; raw free pages are retained separately as diagnostics.
If startup is refused, the verified download
remains available. Free resources through your normal tools, then use
`/models use MODEL_ID` to try the selected asset again. Subscription setup and
saved work remain available. Koto reports unavailable accounts and interrupted
setup with recovery actions; malformed preferences can be preserved as a backup
before restarting onboarding.

For an existing local setup, `/models pull MODEL` uses an installed Ollama
runtime, `/models start GGUF` starts the configured llama.cpp binary with selected
weights, and `/models get URL FILE SHA256` downloads an explicitly selected GGUF.
`/runtime build COMMIT` is an advanced source-build option using installed
development tools. The guided model path acquires a verified runtime binary.
The local coding agent begins with a required native read-only inspection call,
then uses its normal workspace tools and asks before commands. Tool-like text
inside an ordinary reply is never executed. A missing native tool call or
truncated response remains a visible failure.
Managed startup waits for its first memory check, then makes one readiness probe
and at most three retries with 5/10/20-second backoff plus jitter, respecting `Retry-After` and
the startup deadline. The core's `startupMaxRetries` option is an explicit
advanced budget; the CLI uses the bounded default. Socket exhaustion stops
further requests immediately.
If native startup fails, the CLI preserves its last 8 KiB of startup output in
a private log and displays its path. Inference output is not added to that log.

Private choices live in `~/.koto/preferences.json`; `KOTO_STATE_DIR` selects
another private absolute state directory. Session state contains prompts,
native output and workspace paths. Keep it local. Unknown usage and provider
costs remain unknown. See the [acceptance guide](USER_ACCEPTANCE.md) and
[current evidence](CORE_STATUS.md) for observed behavior and remaining gates.

## Advanced manual session setup

Run `koto setup` in a terminal to open the separate explicit configuration wizard. From a
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
