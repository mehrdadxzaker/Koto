# Concurrent project sessions

`koto project` runs installed agent executables in separate Git worktrees,
using the shared scheduler and session core. The guided launcher, plan commands
and future delivery surfaces consume that same core. Codex and OpenCode profiles
observe their declared structured protocols; ordinary commands retain their own
input and output contract. A process exit, native turn completion and a correct
code change are separate facts.

See [current evidence](CORE_STATUS.md) for observed results, including the earlier
Mac pipe collaboration and later transport observations. The presence of an
implementation or a successful helper compilation does not establish a complete
native-agent journey on every platform.

## Start actual agents

Run `koto`, choose **Start an agent session**, and select a clean, committed Git
project. Supply a goal, agent count, deadlines, exact installed clients and models,
and a task with literal file/directory ownership for each agent. Existing account
authorization, local model servers and native permissions must already be set up.
The launcher does not install models or choose a fallback provider.

Choose **Interactive terminal** for the native interface and its prompts, or
**Structured pipe** for native JSON lifecycle and captured-session continuation.
Build the current platform helper explicitly when requested. On Windows, setup
comes before repository inspection because both Git preflight and project agents
use the helper's Job Object ownership, including pipe agents. macOS and Linux
require the helper for PTY agents. See [installation](INSTALLATION.md).

The launcher uses the shared preflight to inspect the repository, executable,
transport and declared local-runtime prerequisites. The summary shows the exact
command, task, model and ownership; type `start` to approve that launch.
Preflight does not establish login, model availability or effective provider
configuration. See [guided sessions](GUIDED_SESSIONS.md) for the complete flow.

For authored plans, use `koto plan build` to declare native runtime/model/task
choices without assembling argument arrays. Then inspect and launch the result:

```sh
koto plan build /private/tasks.json /private/prepared-plan.json
koto plan check /private/prepared-plan.json
koto project start /private/prepared-plan.json
```

[Launch setup](LAUNCH_SETUP.md) documents the task format and local OpenCode
configuration checks. Raw executable plans remain available for other commands.
Only an explicit `native` adapter declaration enables structured observation;
a command's filename does not supply that declaration. The public
`createAgentProfile()` and `buildProjectPlan()` APIs create it with the argv.

For a prepared plan that has already been inspected and approved,
`--start --headless` supplies launch approval and exits after the commands settle.
It does not approve generated edits. Each invocation launches once, with no
automatic retry; a native CLI may make internal retries within its deadline.

## Supervise, inspect and integrate

Pipe output is tagged by agent and stdout/stderr, with terminal control bytes
removed from display. Declared native adapters observe bounded stdout JSONL;
stderr is not treated as native lifecycle. Native terminal screen output appears
only for an attached agent and is never parsed as a completion or session ID.

- `:status` shows process/native states, captured native IDs and worktrees.
- `:stop AGENT` or `:stop all` stops owned processes and retains partial edits.
- `:send AGENT TEXT` and `:eof AGENT` send input where the command supports it.
  Pipe stdin must remain open with `inputMode: "pipe"` for interactive sends.
- `:attach AGENT` attaches the native terminal. **Ctrl-]** returns to Koto.
- `:resize AGENT COLS ROWS` sets PTY dimensions. Outer-terminal resizes are also
  forwarded to the attached agent.
- `:review AGENT` or `:inspect AGENT` shows the next integration delta and records
  a review token. After prior integration, previously accepted changes are excluded.
- `:integrate AGENT [TOKEN]` applies that exact reviewed delta to the separate
  integration worktree after every agent finishes and cleanup is confirmed.
- `:resolve AGENT COMMIT` acknowledges an exact reviewed conflict-resolution commit.
- `:pending` inspects an unresolved integration attempt and its current Git state.
- `:reconcile RESOLUTION TOKEN` explicitly acknowledges a reviewed attempt outcome.
- `:quit` stops remaining owned work and retains the session and worktrees.

For pipes, `inputMode` defaults to `closed`: optional `input` is written and then
EOF is sent. This allows Codex exec to finish reading its appended stdin. PTY
input defaults to `pipe`. A terminal EOF request sends the current terminal's
EOF character; in raw mode it is only a byte, not a guarantee that the native
client will exit. Native permission policy stays with that client; Koto supplies
no approval bypass. See [native protocol boundaries](NATIVE_SESSIONS.md).

Saved sessions support the same operations without relaunching an agent:

```sh
koto project status /private/session/directory
koto project inspect /private/session/directory codex1
koto project integrate /private/session/directory codex1 --approve REVIEW_TOKEN
```

Changed work needs a new review token. Contributions outside declared ownership
are refused. Integration preserves existing agent commits, snapshots reviewed
dirty work on the agent branch, and applies one aggregate delta to the session
integration branch. It never updates the original project branch. Reapplying an
already integrated tree is refused. Changed symlinks, submodules, custom Git
filters/merge drivers and ambiguous cleanup require explicit handling.

If integration conflicts, resolve and review the files in the printed integration
worktree, finish the Git cherry-pick, and leave it clean. Acknowledge the exact
resulting commit before resuming or integrating further work:

```sh
koto project resolve /private/session/directory codex1 --approve FULL_COMMIT_SHA
```

Koto checks the retained conflict receipt and original history before recording
your approval. It does not resolve conflicts or create that commit. Locks and
ambiguous outcomes are preserved; deleting them to force replay is not recovery.

## Reconcile an interrupted integration

An integration attempt is retained before Koto can change Git. Only after the
observed result is saved in the session can the attempt be cleared. This also
applies when acknowledging a manually resolved conflict. If Git changes but a
later save fails, the attempt stays unresolved and blocks further integration
and continuation. Git and the session record are separate stores; this does not
make them one atomic transaction.

Run `koto project pending <session-directory>` after an interrupted integration
or interrupted conflict acknowledgment, or when Koto reports an unresolved
integration attempt. It inspects the retained
attempt without starting an agent or changing Git. Further integration and
native-session continuation remain blocked until reconciliation succeeds:

```sh
koto project pending /private/session/directory
```

The output includes the approved contribution, original and current refs, owner
status, retained result when available, possible resolutions and a fresh review
token. Inspect the displayed worktrees and diff before choosing a resolution:

- `record-result` acknowledges an observed, verified integration receipt and
  saves it to the session. It does not infer success from a commit appearing.
- `not-applied` acknowledges that the target remains unchanged and has no
  pending cherry-pick. Source changes remain available for a new review.

Only resolutions supported by the current evidence are offered. An active owner,
changed refs or unresolved Git state prevents reconciliation. Approve exactly
the state you inspected:

```sh
koto project reconcile /private/session/directory --resolution record-result --approve ATTEMPT_REVIEW_TOKEN
```

Reconciliation retains an audit record. It never repeats the integration,
modifies project content, rolls back work or resumes an agent. A rejected token
requires a fresh inspection. If neither resolution is available, retain the
attempt and inspect the worktrees explicitly; do not delete the marker to retry.
Reconciliation does not restart the agent; continuation requires an explicit
later `koto project resume`.

A crash before the intent is retained can leave a lease without an inspectable
attempt. A crash during reconciliation can also leave its own lease. These cases,
or a changed target without a valid saved receipt, require manual investigation;
the commands do not guess that a lease is stale or invent a successful result.

## Continue a captured native session

Choose **Resume a native agent session** in the launcher, or use:

```sh
koto project resume /private/session/directory codex1 --prompt "Make the improvement you proposed in our previous turn."
```

Review the exact continuation and approve with `start`. The core uses the
captured native ID, originating worktree, executable path, model, account and
policy arguments. It does not choose the latest native conversation or replay
the original task. A supported structured invocation with an explicit model and
retained native history is required. Terminal screens expose no trusted native
ID, and ephemeral native sessions cannot be resumed through this API.

Every attempt and native outcome is retained. After a continuation, review shows
the delta from the agent's last accepted snapshot; integration does not reapply
its earlier contribution. Missing IDs, changed origin fields, unresolved
conflicts or unconfirmed process cleanup produce explicit refusals. See
[native sessions](NATIVE_SESSIONS.md) for the exact adapter contracts.

## Boundaries and retained data

Controls default to `~/.koto/sessions`; worktrees live in the sibling
`~/.koto/sessions-worktrees` directory. An explicit `controlRoot` must be outside
Git worktrees. Private state and events contain prompts, native output, workspace
paths and process results. They are local files, not telemetry. Koto does not
publish or automatically delete them; uninstalling Koto does not remove them.

Worktrees separate branches and writable directories; they do not sandbox agents.
Native agents retain their host permissions. POSIX pipe commands own a process
group, and PTY helpers own a separate session. Descendants that detach from that
boundary are outside its containment. Windows project helpers use Job Objects
for both pipe and ConPTY workloads. Missing or unconfirmed cleanup blocks resume
and every integration, including contributions from peers that succeeded.
A crashed active session remains unresolved and is not automatically replayed.

On macOS, cleanup requires two complete empty scans of the owned session while
the direct child remains unreaped, followed by a successful exact-child reap.
An incomplete process observation resets that scan sequence; lost child or
session identity remains a permanent refusal. Final cleanup events retain the
first structural and observation operation and errno, plus whether the
observation was resolved, so a refusal can be investigated without clearing it.

This core includes native protocol observation, explicit continuation and platform
terminal/process implementations. It does not supply provider billing, a GUI or
an IDE plugin. Use the [acceptance run](USER_ACCEPTANCE.md) to record the actual
native interaction and integration behavior on the selected host.
