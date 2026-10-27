# Concurrent project sessions

`koto project` runs caller-selected real executable commands in separate Git
worktrees. It reuses the shared scheduler and exposes a small terminal consumer
of the session API. It does not translate provider protocols or manufacture
agent replies.

A [recorded macOS demonstration](https://github.com/mehrdadxzaker/Koto/pull/613)
used this implementation tree with Codex and OpenCode running local Qwen3-14B.
Their executions overlapped for 25.4 seconds while contributing separate modules
to a task-board CLI. Both diffs were inspected and approved with review tokens,
and both contributions were integrated without conflict. The application then
ran manually with four tasks and 25% completion. The record retains the initial
local shell-quoting failure and its revision: two Codex and two local CLI
invocations in total. This is one observed pipe-based workflow on that Mac,
not a benchmark or qualification of other platforms, models or native protocols.

## Run actual agents

Start from a clean, committed Git project. Agent runtimes, account authorization,
local model server and native permissions must already be configured. The plan
below invokes actual Codex and OpenCode commands; it is not a fallback worker or
an offline demonstration. Use the exact native executable paths on the host if
its PATH does not identify the intended installations.

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
      "task": "Add a read-only session.outputTail(agentId) API returning the last 64 KiB of that agent's live output; update public declarations. Keep raw output private and bounded. Do not change terminal rendering or run automated tests.",
      "owns": ["src/project-session.js", "src/core.d.ts"]
    },
    {
      "id": "qwen",
      "command": "opencode",
      "args": ["run", "--format", "json", "{prompt}"],
      "inputMode": "closed",
      "task": "Make :status print a concise terminal table with agent id, process status, pid and worktree path instead of JSON. Update the controls help text. Keep all existing controls and do not change core files or run automated tests.",
      "owns": ["bin/project.js"]
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

The project-session source is available on `main`; use that checkout or a newly
packed local tarball. Older installed Koto builds may lack this command. Registry
publication remains pending.

## Supervise, inspect and integrate

Output is tagged by agent and stdout/stderr. Terminal control bytes are removed
from display; native bytes are not interpreted as completion or permission
records. The terminal supports:

- `:status` — process and workspace status.
- `:stop AGENT` or `:stop all` — stop owned processes and retain partial edits.
- `:send AGENT TEXT` and `:eof AGENT` — pipe input only, where that executable
  supports it. Set `inputMode: "pipe"` to retain stdin for these controls.
- `:inspect AGENT` — show the complete base-relative diff and a review token.
- `:integrate AGENT TOKEN` — apply that exact reviewed contribution to the
  separate integration worktree after all agent processes finish.
- `:quit` — stop remaining owned work and retain worktrees.

`inputMode` defaults to `closed`: optional `input` is written, then EOF is sent.
This matters for Codex exec, which otherwise waits for appended piped stdin.
Prompts that require a TTY, password entry or a full-screen terminal are not
supported. Native permission policy remains native; Koto never adds an approval
bypass. Headless permission denials remain failures to inspect.

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

## Boundaries and retained data

Controls default to `~/.koto/sessions`; worktrees live in the sibling
`~/.koto/sessions-worktrees` directory. Explicit `controlRoot` must be outside
existing worktrees. Private state and events contain prompts, native output,
workspace paths and process results. They are local files, not telemetry, and
must not be published as-is. Koto never deletes these worktrees automatically.

Worktrees provide separate branches and writable directories, not a security
sandbox. Native agents keep their host permissions and may access other paths
if their own policy permits it. On POSIX, cancellation owns the process group;
self-detached descendants remain outside that boundary. Windows interruption
is best effort and reports unconfirmed cleanup. A crashed session remains
unresolved and cannot automatically integrate or replay work.

This implementation is pipes only. It does not provide native continuation,
structured permission-state parsing, PTY support, provider billing, a GUI or an
IDE plugin. Process success is not a correctness verdict. The recorded Mac run
adds one actual simultaneous-agent and reviewed-integration observation to source
inspection. It does not establish model quality, comparative latency, cost
savings or general platform support. Current CI checks source and scope only.
