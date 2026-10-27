# Prepare and inspect a launch plan

`koto plan build` turns explicit agent, model, task and file-ownership choices
into the existing project-session format. It does not invent subtasks, choose
a provider, start a model or infer approval. The CLI and future interfaces use
the same `buildProjectPlan()` and `preflightProjectPlan()` core APIs.
For guided setup without a JSON file, run `koto` and follow
[guided sessions](GUIDED_SESSIONS.md).

Save a task specification outside the project. For example, this assigns one
real Codex client an explicit contribution to Koto:

```json
{
  "schemaVersion": 1,
  "project": "/absolute/path/to/Koto",
  "goal": "Improve the project launch instructions.",
  "agents": [
    {
      "id": "docs",
      "runtime": "codex",
      "model": "gpt-6.1-sol",
      "auth": "chatgpt",
      "task": "Clarify the existing launch controls and their limitations without claiming unobserved native support.",
      "owns": ["docs/PROJECT_SESSIONS.md"]
    }
  ]
}
```

The model must be explicitly selected and available to the configured account.
Native presets default to `transport: "pty"`; build the helper for the current
macOS, Linux or Windows host explicitly with `koto terminal build`.
Windows also needs the helper for pipe agents and repository preflight.
See [installation prerequisites](INSTALLATION.md#build-the-host-helper).
Set `transport: "pipe"` for a noninteractive command. Codex then uses `exec
--json`; OpenCode uses `run --format json`. Pipe mode cannot answer a native
terminal prompt.

```sh
koto plan build /private/tasks.json /private/prepared-plan.json
koto plan check /private/prepared-plan.json
koto project start /private/prepared-plan.json
```

`build` creates a new file with private permissions and refuses an existing
destination. Inspect the generated JSON: it contains the exact executable,
argv, task, ownership, transport, deadline and environment exclusions.
The plan is private because tasks and paths may contain project information.
The session still requires explicit launch approval and separate review-token
approval for integration. See [project sessions](PROJECT_SESSIONS.md).

## Native command presets

The Codex preset requires `auth: "chatgpt"`, selects the explicit model and
OpenAI provider, and excludes API-key/base-URL environment overrides. It does
not read, copy or change credentials. Its sandbox defaults to `workspace-write`;
`read-only` is the other accepted value. Interactive mode uses native
`on-request` approvals and `--no-daemon`; noninteractive mode does not load the
user configuration but retains native authentication and rules. Interactive
mode keeps native configuration, plugins, tools and permission enforcement.
The command options were inspected using Codex CLI 0.163.0 help; this does not
qualify model access or the interactive journey. The versioned profile metadata
also declares Codex's structured lifecycle protocol for pipe mode. Its captured
native ID can be continued explicitly after confirmed cleanup; terminal mode
does not infer such an ID from screen output.

For the OpenCode local preset, choose the exact configured `provider/model`
and declare its existing configuration and loopback runtime:

```json
{
  "id": "local",
  "runtime": "opencode",
  "model": "local/my-configured-model",
  "localRuntime": {
    "configFile": "/private/opencode-local.json",
    "endpoint": "http://127.0.0.1:8080/v1"
  },
  "task": "An explicit independent task for this model.",
  "owns": ["src/a-selected-file.js"]
}
```

The existing host `OPENCODE_CONFIG` must select that exact file. Koto does not
set it or write a replacement. The file must be plain JSON with the requested
provider in its single-element `enabled_providers`, the requested model in
`provider[provider].models`, and the matching loopback URL in
`provider[provider].options.baseURL`. JSONC and environment/file substitutions
are not interpreted by this preflight. Other explicit config-content/directory
environment overrides are refused. Each native client's own configuration may
merge additional project or organization settings, so the check explicitly
leaves effective native configuration and local-only inference **unverified**.
Inspect those settings in the installed OpenCode version before launch.
OpenCode's argv and JSON event envelope follow the referenced upstream client
contract in [native sessions](NATIVE_SESSIONS.md). That source contract does not
establish model access or successful native interaction on a particular host;
see [current evidence](CORE_STATUS.md) and the [acceptance run](USER_ACCEPTANCE.md).

The builder adds no model fallback, installs no runtime, and makes no inference
request. A configured loopback listener is a prerequisite, not proof that the
requested model is loaded or that a provider has no remote fallback.
Native permissions, credentials and any provider routing remain native.

`runtime: "command"` preserves an explicit `command` and `args` for another
client. It supplies no native capability claim. Optional executable paths,
per-agent deadlines and terminal dimensions use the existing plan fields.

## What preflight establishes

The check reports every discovered blocking prerequisite in one result:

- Missing Git or agent executables, unsupported shell wrappers and relative
  executable paths that would resolve differently inside a worktree.
- A project that is not a committed, clean Git repository root.
- An unavailable PTY platform or mismatched/missing helper build.
- Missing/mismatched declared local configuration and a loopback runtime that
  is not accepting connections.

It also marks overlapping ownership and native account/model/permission readiness
as unverified. `ok: true` only means the
checked prerequisites passed; it never means the native journey is qualified.
Project preflight requires an absolute executable path or a bare command found
on an absolute PATH entry; a former raw `./agent` command must be made absolute.
Windows preflight verifies the explicitly built helper used for Job Object
ownership, including pipe commands. Missing or mismatched helpers block launch;
preflight never builds one. Retained `cleanup_unconfirmed` outcomes block resume
and integration on every platform.
The local endpoint check opens and immediately closes one TCP connection. It
does not send an HTTP request, authenticate, download or run a model.

Preflight creates no worktree and changes no settings. Git inspection disables
optional index writes and fsmonitor. Conditions can change after the check;
session setup and launch must still enforce their own validation. Workspaces,
review, cancellation and integration continue through the shared session core.
