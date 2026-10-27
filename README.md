# Koto

<img src="https://raw.githubusercontent.com/mehrdadxzaker/Koto/main/assets/koto-logo.png" alt="Koto logo" width="128" height="128" />

**One shared core that lets commercial and open-source agents work together.**

Install Koto with npm or run it with npx and use its CLI. IDE plugins and Koto's
own UI are later consumers of the same core. The development order is **core and npm
installation → delivery integrations → Koto UI**.

This repository contains only that product and its supporting documentation,
assets and source tooling. The previous Python router, enterprise modules,
model experiments, campaign archives and skills-only distribution are removed
from the active tree.

## Installation

Requires Node.js 22 or later and npm. The package has no runtime dependencies,
install scripts, Python prerequisite or platform-specific model download.
Windows, macOS and Linux are the target platforms.

The npm package is prepared locally and has not been published to the registry.
Build a distributable from this checkout:

```sh
npm pack
```

Install the resulting tarball globally:

```sh
npm install --global ./mehrdadxzaker-koto-3.0.0-alpha.0.tgz
koto --help
```

Or run that tarball without a global installation:

```sh
npx --yes --package ./mehrdadxzaker-koto-3.0.0-alpha.0.tgz koto --help
```

The intended registry name is `@mehrdadxzaker/koto`; availability and publication
remain release steps. See [installation](https://github.com/mehrdadxzaker/Koto/blob/main/docs/INSTALLATION.md).

## Current core and CLI

The initial core validates a task graph, runs ready tasks concurrently, passes
explicit dependency outputs between workers and returns an attributed result.
The CLI exposes that same core:

```sh
koto validate /absolute/path/to/workflow.json
koto run /absolute/path/to/workflow.json
```

A workflow explicitly names its worker executables and tasks. Workers receive a
JSON assignment on stdin and return text on stdout. `finalTask` is optional;
independent task graphs return individual results without a final text output.

Agent runtimes and their model/provider access are configured separately. The
process-worker protocol is a foundation for real adapters; it does not make
Codex, Claude Code or another native CLI speak that protocol automatically.
A successful worker process establishes completion, not the correctness of its
answer. Application-specific acceptance checks belong in the workflow.

The core API is exported from the npm package with TypeScript declarations:

```js
import { runWorkflow, validateWorkflow } from '@mehrdadxzaker/koto';

validateWorkflow(workflow);
const result = await runWorkflow(workflow, { cwd: process.cwd() });
```

## Project sessions

The local implementation adds concurrent external commands in separate Git
worktrees, with streamed output, per-command stop/input controls and a separate
integration branch:

Run `koto` or `koto start` in a terminal for the [guided launcher](docs/GUIDED_SESSIONS.md).
It collects a project, agents, models, tasks and ownership without a JSON file.
Prepared plans remain available for scripted use:

```sh
koto project start /absolute/path/to/plan.json
koto project inspect /absolute/path/to/session agent_id
koto project integrate /absolute/path/to/session agent_id --approve REVIEW_TOKEN
koto project status /absolute/path/to/session
koto project resume /absolute/path/to/session agent_id --prompt "Continue the reviewed task"
```

Use `koto plan build <tasks.json> <new-plan.json>` to prepare executable arguments
from explicit agent, model, task and ownership choices. `koto plan check` reports
missing executables, dirty repositories and terminal/local-runtime prerequisites;
session setup uses the same core preflight. See [launch setup](docs/LAUNCH_SETUP.md).

The guided launcher offers interactive terminals or structured native streams.
macOS and Linux use PTYs; Windows uses ConPTY and a Job Object for owned
process cleanup. Build the platform helper explicitly with `koto terminal build`
using installed developer tools. Windows also uses the helper for pipe sessions.
Launch retains native authentication and permissions. All agents must finish
and settle cleanup before an inspected review token can authorize integration.
Conflicts remain visible and the original checkout is not updated. Worktrees
separate edits, not OS access.

[Codex and OpenCode lifecycle adapters](docs/NATIVE_SESSIONS.md) observe native
JSON events, retain session identity and reported usage, and continue an exact
session in its original worktree. Terminal screens remain uninterpreted.
After a contribution is integrated, a resumed agent's next review and integration
cover only its new changes. Unknown cleanup and unresolved conflicts block both
continuation and integration.

[Issue #543](https://github.com/mehrdadxzaker/Koto/issues/543) records a real Mac
Codex/OpenCode pipe collaboration and two reviewed integrations. A later Linux
two-Codex attempt failed on native connection errors and produced no changes;
owned process-group cleanup completed. Direct Linux terminal input, resize and
independent-stop observations also passed. Native interactive acceptance on each
platform is recorded separately from compilation. See [current evidence](docs/CORE_STATUS.md),
the [acceptance run](docs/USER_ACCEPTANCE.md) and [project sessions](docs/PROJECT_SESSIONS.md).

## Product boundaries

- **Core:** task dependencies, scheduling, worker lifecycle, handoffs and results.
- **CLI:** workflow execution and terminal project sessions using the core.
- **IDE plugins:** later delivery through VS Code and other IDEs.
- **Koto UI:** a later interface to the same core.

Other clients can be configured as explicit external commands when their installed
CLI supports the chosen arguments and transport. Codex/OpenCode lifecycle
interpretation requires an explicit native profile; arbitrary command exit is
only process completion. IDE extensions and Koto's separate UI follow core
acceptance.

Read the [scope](https://github.com/mehrdadxzaker/Koto/blob/main/docs/SCOPE.md), [architecture](https://github.com/mehrdadxzaker/Koto/blob/main/docs/ARCHITECTURE.md),
[roadmap](https://github.com/mehrdadxzaker/Koto/blob/main/docs/ROADMAP.md) and [migration boundary](https://github.com/mehrdadxzaker/Koto/blob/main/docs/MIGRATION.md).

## Development

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

`npm run check` inspects source scope, package metadata, runtime imports and
documentation links. CI runs these source checks on Windows, macOS and Linux
with Node 22 and 24. Automated suites, fixtures and package-execution checks are
removed. A passing source check does not establish runtime or provider support.
The process-ownership limits in the security policy apply on every platform.

See [contributing](https://github.com/mehrdadxzaker/Koto/blob/main/CONTRIBUTING.md), [support](https://github.com/mehrdadxzaker/Koto/blob/main/SUPPORT.md),
[security](https://github.com/mehrdadxzaker/Koto/blob/main/SECURITY.md) and the [license](https://github.com/mehrdadxzaker/Koto/blob/main/LICENSE).
