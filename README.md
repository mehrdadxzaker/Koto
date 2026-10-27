# Koto

<img src="https://raw.githubusercontent.com/mehrdadxzaker/Koto/main/assets/koto-logo.png" alt="Koto logo" width="128" height="128" />

**One shared core that lets commercial and open-source agents work together.**

Install Koto with npm or run it with npx, then use the same core through your
CLI, an IDE plugin, or Koto's own UI. The development order is **core and npm
installation → delivery integrations → Koto UI**.

This repository contains only that product and its supporting tests, examples,
documentation and tooling. The previous Python router, enterprise modules,
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
koto demo
```

Or run that tarball without a global installation:

```sh
npx --yes --package ./mehrdadxzaker-koto-3.0.0-alpha.0.tgz koto demo
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
JSON assignment on stdin and return text on stdout. The bundled `demo` uses
three deterministic fixture workers: two independent contributions feed a final
integration and check. It makes no model calls.

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

## Product boundaries

- **Core:** task dependencies, scheduling, worker lifecycle, handoffs and results.
- **CLI:** the current npm executable and a headless way to use the core.
- **IDE plugins:** later delivery through VS Code and other IDEs.
- **Koto UI:** a later interface to the same core.

Codex, Claude Code and similar clients may participate through explicit agent
or delivery adapters when implemented. IDE extensions, native-agent adapters
and Koto's UI are not implemented in this initial slice.

Read the [scope](https://github.com/mehrdadxzaker/Koto/blob/main/docs/SCOPE.md), [architecture](https://github.com/mehrdadxzaker/Koto/blob/main/docs/ARCHITECTURE.md),
[roadmap](https://github.com/mehrdadxzaker/Koto/blob/main/docs/ROADMAP.md) and [migration boundary](https://github.com/mehrdadxzaker/Koto/blob/main/docs/MIGRATION.md).

## Development

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run test:package
```

Development checks use a pinned TypeScript compiler and Node declaration files;
these are development dependencies and are not needed to install or run Koto.
Tests use fixture processes, temporary directories and the actual packed npm
artifact, including strict TypeScript consumer checks. CI is configured to run
the checks on Windows, macOS and Linux with Node 22 and 24. Local checks pass on
Linux with Node 22.23.4 and Node 24.19.0. See the exact revision's
[CI results](https://github.com/mehrdadxzaker/Koto/actions/workflows/ci.yml) for
hosted-platform evidence; the process-ownership limits in the security policy
apply on every platform.

See [contributing](https://github.com/mehrdadxzaker/Koto/blob/main/CONTRIBUTING.md), [support](https://github.com/mehrdadxzaker/Koto/blob/main/SUPPORT.md),
[security](https://github.com/mehrdadxzaker/Koto/blob/main/SECURITY.md) and the [license](https://github.com/mehrdadxzaker/Koto/blob/main/LICENSE).
