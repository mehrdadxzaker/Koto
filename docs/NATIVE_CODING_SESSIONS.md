# Explicit native coding sessions

`koto chat code` launches one fresh terminal-native Codex task in a workspace
chosen by the caller. This experimental source workflow has synthetic
integration coverage. It does not establish real-account entitlement, native
host sandbox enforcement, local-model quality or platform support. The
[support matrix](../SUPPORT.md) and existing failed or incomplete coding
campaigns remain authoritative.

## Choose the workspace

Prepare the existing account and reviewed Koto configuration described in
[native personal sessions](NATIVE_PERSONAL_SESSIONS.md). Then explicitly select
an existing absolute workspace directory:

```sh
koto --config /absolute/path/koto.json chat code \
  --workspace /absolute/path/project \
  --executable /absolute/path/codex \
  --client-home /absolute/path/native-codex-home \
  --prompt-file /absolute/path/task.txt
```

The `code` command authorizes native writes to that workspace. It has no default
workspace and rejects missing directories, relative paths, the filesystem root
and a workspace containing the selected native home. Symlinks resolve to their
canonical directory. The directory identity is checked again before the native
thread and turn start. Native files can still be read according to Codex's own
sandbox; this is not a filesystem-read isolation boundary.

This first workflow accepts terminal Codex CLI **0.160.0**. The desktop app
engine is excluded from this coding surface. Codex owns authentication, model
execution, tools, file edits and its agent loop. Koto launches app-server with
`workspace-write`, tool network access disabled, temporary-directory write
exceptions disabled and approval policy `never`. Both thread and turn use the
same canonical workspace. Koto requires the returned thread sandbox, cwd and
approval policy to match before submitting the task. An absent or different
sandbox report stops with `native_sandbox_unverified`. This protocol check does
not prove that a real host enforces the operating-system sandbox.

`--actor`, `--model`, prompt-file `-` and the bounded `--timeout-seconds` options
work as on `chat route`. Saved client settings and authentication files are not
rewritten. The existing `chat route` command retains fresh read-only text work
in its private temporary workspace.

## Select only qualified local coding routes

The native commercial model must have one authorized alias in the Koto
configuration. Observation mode and insufficient learned evidence retain that
baseline. Automatic selection requires checked, activated selector validation
for the exact coding host context, including the chosen workspace identity.
Text-task validation and another workspace's coding validation cannot authorize
this choice. Hard `local_only` mode stops when no eligible local can be selected.

An explicit `--model LOCAL_ALIAS` requests an already qualified local. Its
managed runtime must already be ready and the route must be admitted for
automatic `code_change` work with Responses, streaming and the pinned native
tool transport. Its valid coding receipt must bind the observed native client
version. Missing, failed or mismatched coding evidence stops before thread
creation; a prompt-free readiness probe cannot supply coding evidence. Koto
does not run a new qualification campaign or download/start a managed model.

The session's owned router enforces the complete coding request profile again
when Codex submits a local request. A qualifying model name, task label or host
context cannot authorize changed instructions, tools or limits. A rejected
request causes no local inference. Actual local execution needs settled owned
router receipts; a native completion alone leaves it unverified. A local failure
never triggers an automatic commercial retry.

## Check outcomes and handle interruption

History collection and learning remain separate opt-ins. Use the existing
`history enable`, `history learning enable`, `history show`, `history feedback`
and `history learning validate` commands from the personal-session guide.
Koto records the initial prompt and returned answer under the existing history
privacy rules. It does not collect repository files or native tool state for
replay, and does not submit history for another model to grade automatically.
An execution receipt establishes observed execution, not correctness of edited
code. Supply independent checks or explicit user feedback before using that
outcome as learning evidence.

There is one fresh turn, with no resume or replay. Unsupported approval or
other client-action callbacks stop with `native_client_action_required` and an
unknown outcome. Cancellation, protocol failure or a deadline can leave partial
native edits in the caller's workspace. Koto stops owned processes and retains
the unknown outcome; it does not undo those edits or resubmit the task. Review
the workspace before continuing. The native cleanup receipt covers only the
original owned process group, as on the text surface.

## Contract, migration and rollback

Coding receipts use **`koto.native-task` version 2**. The required `context`
object has these exact fields:

| Field | Meaning |
| --- | --- |
| `domain` | `codex-app-server-host.v2` |
| `task_type` | `code_change`, established by the explicit command |
| `workspace_sha256` | SHA-256 of canonical path, device and directory inode |
| `sandbox_mode` | `workspace-write` |
| `tool_network_access` | `false` |
| `approval_policy` | `never` |

The [v2 compatibility fixture](../tests/fixtures/native-task-v2.json) defines
this public boundary. The path is not included in this public context.
Changing directory identity invalidates reuse; the hash does not describe file
contents or certify that code has stayed unchanged. The internal v2 host-profile
digest includes this context, native binary/account/control facts and existing
local qualification/catalog controls. Workspace content, hidden native
instructions and tool state remain outside that digest.

Legacy `chat route` receipts and the default text envelope remain
`koto.native-task` v1, with the original v1 host-context computation. Both versions
are advertised and validated. Early failures remain `koto.native-task-error`
v1. Encrypted native history remains v4, and personal-selection receipts retain
their version; the existing opaque profile field carries the new digest. No
history, database, configuration or failed qualification receipt is rewritten.
Consumers must explicitly support v2 before ingesting coding receipts.

To roll back, stop active coding sessions and review any retained workspace
edits, then use `chat route` with its original read-only boundary. Older runtime
versions lack `chat code` and must reject v2 coding receipts instead of treating
them as text work. Preserve historical v1/v2 evidence; do not relabel coding
observations or copy their selector validation into a text host context.
