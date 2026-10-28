# Native agent sessions

Koto runs the installed Codex or OpenCode CLI in an isolated project worktree.
The CLI owns its model loop, provider login, tools and permission policy. A native
profile declares which output protocol Koto may observe; an arbitrary executable
does not become a native agent because its name contains `codex` or `opencode`.

`createAgentProfile()` accepts `transport: 'pipe' | 'pty'`. Pipe profiles use
`codex exec --json` or `opencode run --format json`. Terminal profiles open the
native interactive interface with live input and resize. A terminal remains a
human interface: Koto does not infer permission requests, session IDs, token usage
or completion by scraping its screen.

| Capability | Codex JSONL | OpenCode JSONL | Native terminal |
| --- | --- | --- | --- |
| Capture native session ID | `thread.started.thread_id` | `sessionID` in native events | Unsupported |
| Observe completion | `turn.completed` and successful process exit | Final `step_finish` with `part.reason: "stop"` and successful process exit | Unsupported |
| Observe failure | `turn.failed`, errors and process outcome | `error` and process outcome | Process outcome only |
| Token usage | `turn.completed.usage` | `step_finish.part.tokens` and cost | Unsupported |
| Structured permission request | Unsupported | Unsupported | Unsupported |
| Structured permission denial | Command item with `status: "declined"` | Unsupported | Unsupported |
| Human permission interaction | Native exec policy | Native run policy | Native interface through live terminal input |
| Exact captured-session resume | Supported when a persistent ID and explicit model were captured | Supported when an ID and explicit model were captured | Unsupported |

OpenCode's run command handles permission requests internally; its JSONL protocol
does not emit a permission-request event. Koto does not promote stderr warnings
into permission decisions. Neither JSONL adapter exposes an approval-response API.
In the terminal, approvals remain visibly owned by the selected native CLI.

The observer handles partial lines, ignores stderr, and bounds individual records
to 1 MiB, the observed stdout stream to 8 MiB, and event count to 100,000. It keeps
counts and numeric usage, not copies of prompts, model messages or tool output.
Unavailable usage fields are `null`; an unreported cost is not displayed as zero.
Unknown event types are ignored for forward compatibility. Invalid JSON, invalid
IDs, ID changes and exceeded bounds invalidate the structured observation; they
cannot produce a trusted completion or resumable identity. Native raw output is
still subject to the separate project event-log and command-output bounds.

Process success and native completion are separate facts. A clean exit without a
native completion marker is `unknown`, a cancelled command is `interrupted`, and
native or process failures are `failed`. A tool failure is not automatically a
failed agent turn, and a completed turn is not evidence that the requested code is
correct. Transient Codex diagnostics may be followed by an explicit successful
turn; a native `turn.failed` remains a failed invocation.

## Continuing the same native context

`resumeProjectSession(sessionRoot, agentId, { prompt })` continues the captured ID in
the same retained worktree. It requires a settled project with confirmed process
cleanup and an explicit follow-up prompt. It does not silently restart the initial
task or select the provider's latest session.

The stored native observation binds its identity to the adapter kind and protocol,
the resolved executable path, the original argument templates, the exact model,
account choice, effort and sandbox metadata, environment-variable removals, and
worktree path. Changing those origin fields invalidates resume. The invocation
must have an explicit model; host-default model selection cannot be resumed by
this API. Ephemeral Codex sessions are not resumable. The original plan arguments
remain unchanged across attempts; each continuation is recorded separately.
Custom argv must use the supported native exec/run form with a final `{prompt}`
argument. Its preceding arguments may reference `{workspace}`; other dynamic
project, goal, agent or prompt references in that prefix are not resumable.

The continuation keeps the originating flags and uses these native forms:

```text
codex exec [originating options] resume SESSION_ID -- FOLLOW_UP_PROMPT
opencode run [originating options] --session SESSION_ID -- FOLLOW_UP_PROMPT
```

Each invocation passes arguments directly to the executable, without a shell.
The follow-up is one literal argument, including braces or leading hyphens. The
observer requires the resumed process to emit the same native ID before accepting
completion. A continuation that fails before emitting its ID retains the previously
captured identity for another explicit attempt after confirmed cleanup. Native history
must still exist in the selected installation; Koto does not reconstruct or copy
the provider's private history. It never substitutes `--last`, `--continue`, a
different model, another account, or a new worktree when continuation fails.

The binding is an integrity check on Koto's saved origin fields, not a snapshot of
external credentials, provider aliases, executable contents or host configuration.
Those remain owned by the host. Native credentials are not copied into the saved
state to create this binding.

## Protocol references and verification

The Codex observer follows the official
[exec event definitions](https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs).
The `codex exec resume --help` and parent-option placement were checked against
installed Codex 0.163.0 without invoking a model. Codex interactive profiles use
`--no-daemon`, `--ask-for-approval on-request`, and an explicit native sandbox.

OpenCode's envelope and event names were inspected in its official
[v1.19.4 run implementation](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/cli/cmd/run.ts).
This version rejects a missing explicitly requested session instead of selecting
another one. The [interactive command](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/cli/cmd/tui.ts)
accepts `--model` and `--prompt`. Source inspection establishes the implemented
contract; it does not establish a successful provider run on a particular host.

Native acceptance requires actual installed, authenticated agents: run a small
task, inspect its native ID and completed turn, continue that saved agent with a
follow-up that depends on its earlier conversation, and inspect the resulting
change in the retained worktree. Terminal acceptance additionally requires seeing
the native interface, sending input, resizing it and stopping it with confirmed
cleanup. Follow the product's guided project flow and saved-session controls;
neither a fixture process nor terminal escape output counts as native acceptance.
