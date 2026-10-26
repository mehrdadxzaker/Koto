# Support

Koto is experimental software with best-effort community support.

| Component | Current status |
| --- | --- |
| npm package and CLI | Local tarball installation and execution; registry publication pending |
| Node.js | Requires version 22 or later; verified locally on Linux with Node 22.23.4 and 24.19.0 |
| TypeScript | Public declarations checked with TypeScript 5.9.3 under strict NodeNext and Bundler consumer resolution |
| Platforms | Windows, macOS and Linux are CI targets; local results apply to the platform tested |
| Core | Explicit task graphs, process workers, dependency handoffs, bounded concurrency and lifecycle control |
| Agent integrations | A generic process-worker protocol; native commercial/open-source adapters need implementation and interoperability evidence |
| Worker isolation | No sandbox; POSIX process-group cleanup is tested locally, while Windows descendant cleanup needs stronger ownership and OS verification |
| IDE plugins | Planned |
| Koto UI | Planned |

Agent runtimes, provider accounts, subscriptions, local models and their system
requirements are separate from installing Koto. A worker's exit code does not
establish answer quality. Workflows must supply their own acceptance checks.

For bugs, include package version, Node version, OS and a synthetic reproduction.
Use [GitHub issues](https://github.com/mehrdadxzaker/Koto/issues). Report
vulnerabilities through the [private security path](SECURITY.md).

Previous Python releases are outside this development line; see
[migration](docs/MIGRATION.md). No release or provider compatibility is inferred
from the source cleanup.
