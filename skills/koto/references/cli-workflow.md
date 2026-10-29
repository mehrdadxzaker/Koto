# Published CLI workflow

These commands target `@mehrdadz/koto@3.0.0-alpha.1`. Use their full pinned prefix;
repository `main` may describe newer behavior. Run actual CLI commands, not a
substitute API callback or a hand-written claim of their result.
Use the private empty invocation directory from SKILL.md as the command working
directory, with absolute paths back to the real project and private artifacts.

## Prepare a useful plan without launching

1. Resolve the actual Git project root, inspect its relevant files and establish
   the user's goal and permitted paths. Preserve a dirty project; report its
   preflight blocker instead of committing, stashing or reverting user work.
2. Write a private UTF-8 task JSON file outside that project. Use real paths,
   tasks and selected models. Include:
   - `schemaVersion: 1`, absolute `project`, and the user's concrete `goal`.
   - Finite `timeoutMs` (for example `300000`) and explicit `maxConcurrency`.
   - `agents`: a bounded list, normally one or two genuinely independent workers.
     Each has a unique `id`, concrete `task`, and nonoverlapping `owns` paths
     relative to the project. Assign narrow files/directories rather than `.`.
   - For the Codex preset: `runtime: "codex"`, `auth: "chatgpt"`, an explicit
     `model`, an observed executable `command`, `transport: "pipe"`, and native
     `sandbox: "workspace-write"` or `"read-only"` appropriate to the task.
     Use the user's model choice or an observed model setting, not a guessed
     entitlement. If no choice is known, obtain it before building the preset.
   - Keep these preset assignments independent (`dependsOn: []`). For ordered
     work, prepare the next plan after reviewing the earlier result; this
     release's preset builder does not carry dependency assignments through.
3. Choose a new absolute output filename for the prepared plan. In the commands
   below, replace `TASKS_JSON` and `PLAN_JSON` with those actual quoted paths:

```sh
npx --yes --registry=https://registry.npmjs.org/ --package=@mehrdadz/koto@3.0.0-alpha.1 -- koto plan build "TASKS_JSON" "PLAN_JSON"
npx --yes --registry=https://registry.npmjs.org/ --package=@mehrdadz/koto@3.0.0-alpha.1 -- koto plan check "PLAN_JSON"
```

`plan build` creates a new private file and refuses an existing destination.
Inspect its exact executable, argv, task, ownership, transport, deadlines and
environment exclusions. These two commands are already noninteractive;
`--headless` is a project-session flag, not a `plan` flag. They start no agent or
model. A declared local prerequisite may receive one loopback connection probe.

Return both absolute file paths, the generated assignments/argv and the actual
preflight output. `ok: true` covers checked prerequisites; native login, model
access and permissions remain unverified. A blocked check is a recorded result,
not permission to change settings or fabricate readiness. Stop here when the
user requested preparation only.

### Other selected runtimes and prerequisites

The published builder accepts `codex`, `opencode` and explicit raw `command`
presets. `runtime: "claude"` is not a builder preset; use Koto's interactive
workflow for guided Claude/local-agent selection rather than inventing argv.
OpenCode local presets need an explicit `provider/model`, an existing absolute
`localRuntime.configFile`, and a matching loopback `localRuntime.endpoint`.
The host's `OPENCODE_CONFIG` must already select that file. Preflight does not
prove that a listener loaded the model or that native configuration is local-only.

PTY plans require an explicitly built matching host helper. Windows also needs
the helper for pipe plans. Preflight never builds it. When a build is authorized,
the published operation is the same pinned prefix followed by `terminal build`.
Keep prerequisite installation, native sign-in and optional model downloads
under their own user authorization; use a real terminal for interactive setup.

## Start only authorized work

For a user-authorized noninteractive run of the inspected pipe plan:

```sh
npx --yes --registry=https://registry.npmjs.org/ --package=@mehrdadz/koto@3.0.0-alpha.1 -- koto project start "PLAN_JSON" --start --headless
```

`--start` supplies launch approval; it is not a dry run. `--headless` has no
interactive approval/input channel. If native permission or sign-in is needed,
report the boundary and use a user-operated terminal, preserving native rules.
Interactive sessions use the same command without `--headless`; omit `--start`
when the user will approve at Koto's terminal prompt.

Bound the owning process to the plan deadline plus reasonable cleanup time.
On cancellation, signal only that owned process and await its cleanup result.
Read the printed `Session:` directory and retained result; preserve failures and
unconfirmed cleanup rather than retrying automatically or killing other clients.

## Inspect and integrate retained contributions

Use actual printed session directories and agent IDs in place of `SESSION_DIR`
and `AGENT`. These inspection commands launch no agent:

```sh
npx --yes --registry=https://registry.npmjs.org/ --package=@mehrdadz/koto@3.0.0-alpha.1 -- koto project status "SESSION_DIR"
npx --yes --registry=https://registry.npmjs.org/ --package=@mehrdadz/koto@3.0.0-alpha.1 -- koto project inspect "SESSION_DIR" "AGENT"
```

Review the current contribution and verify its usefulness with the project's
permitted checks. After user-authorized integration, pass the exact fresh review
token printed by `project inspect` in place of `REVIEW_TOKEN`:

```sh
npx --yes --registry=https://registry.npmjs.org/ --package=@mehrdadz/koto@3.0.0-alpha.1 -- koto project integrate "SESSION_DIR" "AGENT" --approve "REVIEW_TOKEN"
```

All agents must settle with confirmed cleanup. A changed contribution needs a
new review; integration writes its separate session integration worktree, never
the original branch. Conflicts or an unresolved integration attempt require
inspection (`project pending`) and a real reviewed resolution; preserve locks
and receipts instead of forcing a retry. Continuing work uses the captured
original session through Koto's explicit resume flow, followed by fresh review
and integration of only the new delta. Never choose an unrelated latest native
conversation or replay a failed task automatically.
