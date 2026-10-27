# Build through the Koto conversation

Run `koto` in an interactive terminal. Describe what you want to build, choose
the agents that should help, review their proposed work, and launch them together.
Each coding task gets an isolated Git worktree. Bringing its changes into the
integration branch remains an explicit operator action.

This is the current alpha implementation for [#543](https://github.com/mehrdadxzaker/Koto/issues/543),
which remains open for the complete installed native-agent journey. The native
Codex, Claude and local-tool paths described here are implemented; their presence
does not mean that every account, model or operating system has been qualified.
See [observed behavior and limits](#observed-behavior-and-limits).

## Open Koto and connect an account

Install the package from an approved source revision or local tarball, then run:

```sh
koto
```

Koto discovers installed Codex and Claude clients and asks those clients for their
login metadata. An existing suitable account becomes the conversation default.
You can enter a message immediately; project selection happens when coding needs
a project. A greeting is sent to the connected model, not interpreted as a folder.

If an account needs setup, enter:

```text
/connect
```

Choose Codex for an existing ChatGPT subscription or Claude for a Claude
subscription. The installed native client owns sign-in and credentials. Koto
offers its native sign-in flow after you choose it; it does not copy credentials,
use an API-key fallback, or bypass native permission prompts. If the client is
missing, Koto provides its official installation instructions rather than silently
installing another client. Ctrl-] cancels an attached PTY sign-in and returns to
Koto; pipe sign-in requires Ctrl-] followed by Enter, as its prompt explains.

**Login found is not confirmed model access.** Discovery checks metadata and
local prerequisites. The native client confirms entitlement and availability
when an actual request is made. A read-only or unavailable native state directory
needs attention in that client's supported account-owned environment; Koto does
not move credentials to work around it.

## Optionally add a local model

```text
/local
```

Local setup is skippable. It shows running models, retained weights, actual host
RAM and available storage, then offers these initial options:

| Model | Approximate download | Estimated working memory | Minimum host RAM |
| --- | ---: | ---: | ---: |
| Qwen3 4B | 3 GiB | 5 GiB | 8 GiB |
| Qwen3 8B | 6 GiB | 9 GiB | 16 GiB |
| Qwen3 14B | 10 GiB | 14 GiB | 24 GiB |

These are fit estimates for one model with an 8K context, not performance or
coding-quality guarantees. Other apps, runtime settings and model overhead affect
available headroom. Exact publisher file sizes are displayed when available.

Choose a runtime:

- **Ollama:** reuse an already running official app and its native model cache.
  After your approval, its native pull acquires the selected `qwen3` model. If
  Ollama is missing or stopped, Koto links to the official app and asks you to
  install or open it before continuing.
- **llama.cpp:** reuse an installed `llama-server`, or approve a build of pinned
  official source using your installed Git, CMake and C/C++ toolchain. Guided
  source acquisition currently supports macOS and Linux. Model setup resolves a
  single Q4_K_M GGUF from the official Qwen publisher, binds its immutable revision
  and SHA-256, and verifies the download. Retained matching assets are reused.

Runtime compilation, model download and owned server startup have separate
concrete approvals. Unavailable metadata, unknown digests, missing tools or failed
downloads produce a recovery message; Koto does not choose another source or
model silently. The managed llama server is CPU-only, loopback-only and guarded
by sampled memory information. Missing guard metrics stop it. This is not an OS
memory quota or GPU-memory guarantee.

Setup can add the selected model to your coding team and optionally use it for
the Koto conversation. A healthy server only establishes that the model is listed;
coding readiness requires actual use. Local models use Koto's workspace file and
command tool loop, with explicit command approval. Compatible models outside this
initial catalog remain an advanced configuration path.

## Choose a team, project and goal

```text
/team
/projects
```

`/team` adds Codex, Claude or a running local model, selects its model, and removes
unwanted workers. Up to eight configured workers are retained. If no workers are
configured, a build defaults to two instances of the selected coordinator.

`/projects` offers remembered projects or a folder path. Choose a clean existing
Git project, or enter `new PATH` and confirm creation of an empty project. Koto
does not initialize your entire Downloads or home folder, stage existing files,
stash unrelated work, or discard edits. A current usable Git project can become
the default when a coding request is made.

Describe the goal normally, or use an explicit build request:

```text
/build Add task priorities and a readable summary to this project.
```

The real coordinator proposes tasks, configured agents/models, owned paths,
dependencies and concurrency. Choose `edit` to revise the assignment, select a
different configured worker/model, change ownership or dependencies, adjust
concurrency, or change the summary. Invalid edits leave the last valid plan
intact. The revised plan is displayed again; no coding workers start until you
type `build` at the launch prompt. Cancelling a plan retains the conversation.

## Work, stop and review

The terminal shows agent/model identity, a working spinner and activity from
actual events, including waiting, approval, failure and stopped states. Native
action requests require an explicit decision; Enter denies. Worktree separation
does not reduce the commands' OS permissions and is not a hostile-code sandbox.

While a build runs, you can still talk to the coordinator. Additional coding
goals wait for the current build's review and return to the conversation. Use
these session controls:

| Control | Action |
| --- | --- |
| `:status` | Show the current session and agents. |
| `:stop AGENT` | Stop one selected agent; retain its partial edits. |
| `:stop all` | Stop the current workers. |
| `:review AGENT` | Display the contribution diff. |
| `:integrate AGENT` | Explicitly apply the contribution just reviewed. |
| `:pending` | Inspect an unresolved integration attempt. |
| `:help` | Show available session controls. |
| `:quit` | Leave the session terminal, stopping remaining owned work. |

Integration uses a token bound to the displayed review and current Git state.
Changed work must be reviewed again. Contributions enter a separate integration
workspace, not your original checkout or `main`. Conflicts remain visible and
must be resolved and committed deliberately. Dependent agents receive retained
task results and workspace references; prior changes are not automatically
merged into another worker's worktree.

Outside a build terminal, `/stop` interrupts the coordinator turn. `/quit` exits
Koto after stopping owned work and an owned local server. A pre-existing Ollama
app or external model server remains under its original owner's control.

## Return, continue and recover

Koto remembers account/model choices, the team, recent projects and the last
build. On startup it checks availability again and reports missing accounts or
local assets without silently substituting a model. Use:

```text
/review
/resume
```

`/review` displays the last session's agents and actual diffs, then offers explicit
integration. It also exposes a retained integration attempt for inspection and
only offers reconciliation that the core can justify from the current Git state.
Reconciliation records the reviewed observed result or acknowledges that it was
not applied; it does not replay the operation. Conflict acknowledgement requires
the manually reviewed, committed resolution.

`/resume` selects a retained agent and asks what it should do next. After your
explicit approval, it continues the recorded native conversation or supported
local history in the original worktree, using the original agent/model and
permission policy. The core checks runtime, identity, workspace and cleanup
before launch. Missing or changed native history is an error, not a request to
start the provider's latest session.

Settled stopped work can retain a continuation; incomplete or unsafe history can
remain reviewable without being resumable. Unconfirmed cleanup, unresolved
conflicts and pending integration receipts block continuation. If an owner crashes
while the saved session is marked active, automatic reclamation is not implemented:
retain the files and inspect the recorded session and owned processes manually.
Koto does not guess a stale lock or replay interrupted work.

Preferences and retained conversations live under `~/.koto` by default; the
absolute `KOTO_STATE_DIR` override selects a private state location. Session logs,
saved local context, diffs and native output may contain private project content.
Native credentials remain with their clients. `/forget-session` removes only the
last-session shortcut after confirmation; it does not delete saved files or edits.

## Observed behavior and limits

- The earlier Mac run at `50dcdcf7` demonstrated actual Codex plus local
  OpenCode/Qwen cooperation through pipes, overlapping execution and two reviewed
  integrations. It does not qualify the newer Codex app-server, Claude stream,
  direct local-tool loop or onboarding journey described here.
- The current Linux host reports an existing ChatGPT login, but its managed
  read-only Codex state prevents native app-server initialization before inference.
  Installed Claude is not signed in. No successful native generation from either
  current adapter is claimed on that host.
- The pinned llama.cpp source build completed on Linux and its real executable
  reported version/help. No new weight acquisition or local inference was observed
  there; runtime compilation is separate from local-model coding acceptance.
- macOS/Linux PTY and Windows ConPTY helper implementations are separate from
  this structured conversational flow. A compiled helper does not qualify native
  interactive behavior on that platform. Terminal screens are not parsed to
  infer completion or approval. See [native sessions](NATIVE_SESSIONS.md) and
  [current evidence](CORE_STATUS.md) for the older explicit native profiles.

Full installed fresh-user and returning-user acceptance, including actual native
permissions, commercial/local cooperation, interruption and reviewed useful code,
remains tracked in #543. Missing provider cost stays unknown. No benchmark or
speedup claim follows from these observations. IDE plugins and additional UIs
come after the accepted CLI and use the same core.
