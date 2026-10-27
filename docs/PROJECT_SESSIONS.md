# Concurrent project sessions

`koto project` runs caller-selected real executable commands in separate Git
worktrees. It reuses the shared scheduler and exposes a small terminal consumer
of the session API. It does not translate provider protocols or manufacture
agent replies. [Issue #543](https://github.com/mehrdadxzaker/Koto/issues/543)
records real Mac Codex/OpenCode pipe cooperation and two reviewed integrations.
The optional Mac PTY transport is a separate implementation awaiting native
terminal verification; see [current evidence](CORE_STATUS.md).

## Run actual agents

Start from a clean, committed Git project. Agent runtimes, account authorization,
local model server and native permissions must already be configured. The plan
below invokes actual Codex and OpenCode commands; it is not a fallback worker or
an offline demonstration. Use the exact native executable paths on the host if
its PATH does not identify the intended installations.

For native command presets, use `koto plan build <tasks.json> <new-plan.json>`
to declare each runtime, model, task and ownership without assembling argv.
`koto plan check <plan.json>` reports repository, executable, transport and
declared local-runtime prerequisites. `project start` displays the same checks
before approval, and session creation repeats them before making worktrees.
The checks do not qualify native login, effective provider configuration or
model access. See [launch setup](LAUNCH_SETUP.md). The raw format below remains
available for explicitly configured commands.

Save the plan privately outside the project, and replace project/control paths
and task ownership with the intended existing project. OpenCode must use the
already reviewed **local-only Qwen3-14B configuration**; no default commercial
provider or paid fallback may remain in that configuration. Its actual model
identifier comes from that existing configuration, rather than an invented
Koto model name. Codex uses its existing ChatGPT account and the explicitly
selected model/effort below.

```json
{
  "schemaVersion": 1,
  "project": "/absolute/path/to/existing-project",
  "controlRoot": "/absolute/private/path/to/koto-sessions",
  "goal": "Improve the working Koto terminal collaboration flow without adding automated tests.",
  "maxConcurrency": 2,
  "timeoutMs": 300000,
  "agents": [
    {
      "id": "codex",
      "command": "codex",
      "args": ["exec", "--json", "--ignore-user-config", "--model", "gpt-6.1-sol", "-c", "model_reasoning_effort=\"medium\"", "-c", "model_provider=\"openai\"", "-c", "forced_login_method=\"chatgpt\"", "--sandbox", "workspace-write", "{prompt}"],
      "unsetEnv": ["OPENAI_API_KEY", "CODEX_API_KEY", "AZURE_OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_BASE"],
      "inputMode": "closed",
      "task": "Review and clarify the launch setup instructions against the implemented core without claiming unobserved native support. Do not run automated tests.",
      "owns": ["docs/LAUNCH_SETUP.md"]
    },
    {
      "id": "qwen",
      "command": "opencode",
      "args": ["run", "--format", "json", "{prompt}"],
      "inputMode": "closed",
      "task": "Clarify the existing Mac terminal controls and detach behavior while retaining the explicit native-verification limitation. Do not run automated tests.",
      "owns": ["docs/MAC_TERMINALS.md"]
    }
  ]
}
```

The sample tasks improve this actual product when the selected project contains
this implementation. They are independent contributions from the same Git
base. The operator reviews both and integrates them serially.

Using the new local checkout and Node 24:

```sh
node /absolute/path/to/new-koto-checkout/bin/koto.js project start /private/path/to/plan.json
```

The terminal lists commands, tasks and ownership, then requires `start`. For an
already approved, exactly inspected plan, `--start --headless` supplies launch
approval and exits after both commands end. It does not approve their generated
edits. Each executable is invoked once; Koto performs no retry. A native CLI may
make multiple requests or internal retries within its process deadline.

Use the intended source revision or installed package for the commands above.
The older frozen Python-based Mac Koto build does not contain this interface.

## Supervise, inspect and integrate

Pipe output is tagged by agent and stdout/stderr, with terminal control bytes
removed from display. Native PTY screen output appears only for an explicitly
attached agent. Neither form is interpreted as completion or permission records.
The terminal supports:

- `:status` — process and workspace status.
- `:stop AGENT` or `:stop all` — stop owned processes and retain partial edits.
- `:send AGENT TEXT` and `:eof AGENT` — send input/EOF where the native executable
  supports it. Set `inputMode: "pipe"` to retain stdin for these controls.
- `:attach AGENT` — foreground an opt-in Mac PTY; Ctrl-] detaches to Koto controls.
- `:resize AGENT COLS ROWS` — resize an opt-in Mac PTY. Outer-terminal resizes
  also forward to the currently attached agent.
- `:inspect AGENT` — show the complete base-relative diff and a review token.
- `:integrate AGENT TOKEN` — apply that exact reviewed contribution to the
  separate integration worktree after every agent finishes and settles cleanup.
- `:quit` — stop remaining owned work and retain worktrees.

For pipes, `inputMode` defaults to `closed`: optional `input` is written, then EOF is sent.
This matters for Codex exec, which otherwise waits for appended piped stdin.
TTY prompts and full-screen terminals require the experimental Mac PTY transport,
whose `inputMode` defaults to `pipe`. See [Mac terminals](MAC_TERMINALS.md) for
the explicit helper build and unverified native-operation boundary. Native
permission policy remains native; Koto never adds an approval bypass. Headless
permission denials remain failures to inspect.

After the terminal exits, the printed session directory supports the same
review operations without launching an agent:

```sh
node /path/to/koto/bin/koto.js project inspect /private/session/directory codex
node /path/to/koto/bin/koto.js project integrate /private/session/directory codex --approve REVIEW_TOKEN
```

A changed contribution requires a new token. Changes outside declared `owns`
paths are refused. Integration snapshots dirty work on its owned agent branch,
preserves existing agent commits, and cherry-picks one aggregate contribution
into the session's integration branch. The original project branch is never
updated. A conflict remains in the integration worktree, with conflicted paths
reported; resolve it there with ordinary Git before proceeding. Reapplying an
already integrated tree is refused. Changed symlinks, submodules, custom Git
filters/merge drivers and ambiguous cleanup require manual handling.
Unconfirmed cleanup from any agent blocks integration of every contribution,
including contributions from agents that otherwise succeeded.

## Boundaries and retained data

Controls default to `~/.koto/sessions`; worktrees live in the sibling
`~/.koto/sessions-worktrees` directory. Explicit `controlRoot` must be outside
existing worktrees. Private state and events contain prompts, native output,
workspace paths and process results. They are local files, not telemetry, and
must not be published as-is. Koto never deletes these worktrees automatically.

Worktrees provide separate branches and writable directories, not a security
sandbox. Native agents keep their host permissions and may access other paths
if their own policy permits it. On POSIX, cancellation owns the process group;
self-detached descendants remain outside that boundary. Windows project pipe
termination is best effort; every exit retains `cleanup_unconfirmed` and blocks
integration because descendant cleanup cannot be verified. A crashed session remains
unresolved and cannot automatically integrate or replay work.

This implementation provides ordinary pipes and an optional experimental Mac
PTY. It does not provide native continuation, structured permission-state parsing,
provider billing, a GUI or an IDE plugin. Process success is not a correctness
verdict. The observed Mac pipe cooperation, failed Linux attempt and remaining
native/platform verification are described in [current evidence](CORE_STATUS.md).
