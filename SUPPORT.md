# Support

Koto is experimental software with best-effort community support.

| Component | Current status |
| --- | --- |
| npm package and CLI | Package source and CLI implemented; registry publication pending |
| Node.js | Requires version 22 or later |
| TypeScript | Public declarations included; automated consumer checks removed |
| Platforms | Windows, macOS and Linux are targets; CI checks source and scope with Node 22 and 24 |
| Core | Explicit task graphs, process workers, dependency handoffs, bounded concurrency and lifecycle control |
| Agent integrations | A generic process-worker protocol; native commercial/open-source adapters need implementation and interoperability evidence |
| Worker isolation | Shared working directory; POSIX process-group cleanup implemented, Windows descendant cleanup needs stronger ownership |
| Native coding workflow | Concurrent native agents, isolated workspaces and terminal controls remain to be implemented |
| IDE plugins | Planned |
| Koto UI | Planned |

Agent runtimes, provider accounts, subscriptions, local models and their system
requirements are separate from installing Koto. A worker's exit code does not
establish answer quality. Workflows must supply their own acceptance checks.
Current CI provides source and scope evidence only; automated suites, fixtures
and package-execution checks are removed.

For bugs, include package version, Node version, OS and a synthetic reproduction.
Use [GitHub issues](https://github.com/mehrdadxzaker/Koto/issues). Report
vulnerabilities through the [private security path](SECURITY.md).

Previous Python releases are outside this development line; see
[migration](docs/MIGRATION.md). No release or provider compatibility is inferred
from the source cleanup.
