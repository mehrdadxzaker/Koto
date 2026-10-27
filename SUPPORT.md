# Support

Koto is experimental software with best-effort community support.

| Component | Current status |
| --- | --- |
| npm package and CLI | Package source and CLI implemented; registry publication pending |
| Node.js | Requires version 22 or later |
| TypeScript | Public declarations included; automated consumer checks removed |
| Platforms | Windows, macOS and Linux are targets; CI checks source and scope with Node 22 and 24 |
| Core | Explicit task graphs, optional final task, process workers, dependency handoffs, bounded concurrency and lifecycle control |
| External command sessions | Local implementation runs configured executable/argv commands over pipes; native protocol parsing and PTY are absent |
| Project workspaces | Separate Git worktrees and branches per command, plus a separate integration branch; worktrees do not restrict OS access |
| Terminal collaboration | Streamed output, input/EOF, individual/all stop, review tokens and explicit integration; one actual Mac pipe-based workflow observed |
| Agent observation | Codex and OpenCode with local Qwen3-14B contributed on one Mac; broader platform, model and native-protocol qualification remains open |
| Process ownership | POSIX group cleanup implemented; self-detached descendants are outside ownership and Windows cleanup remains best effort |
| IDE plugins | Planned |
| Koto UI | Planned |

Agent runtimes, provider accounts, subscriptions, local models and their system
requirements are separate from installing Koto. A worker's exit code does not
establish answer quality. Workflows must supply their own acceptance checks.
Current CI provides source and scope evidence only; automated suites, fixtures
and package-execution checks are removed.

Project sessions additionally require Git and separately configured agent CLIs.
Native interactive prompts may need a PTY and therefore may not work over these
pipes. Raw input forwarding does not implement a provider's approval protocol.
See [project sessions](docs/PROJECT_SESSIONS.md).

The [recorded Mac demonstration](https://github.com/mehrdadxzaker/Koto/pull/613)
includes 25.4 seconds of overlapping native execution and two reviewed
contributions integrated without conflict. Its two Codex and two local CLI
invocations include an initial quoting failure and revision. The task-board
application ran manually with four tasks and 25% completion. This is not a
benchmark, a cost comparison or evidence of PTY support.

For bugs, include package version, Node version, OS and a synthetic reproduction.
Use [GitHub issues](https://github.com/mehrdadxzaker/Koto/issues). Report
vulnerabilities through the [private security path](SECURITY.md).

Previous Python releases are outside this development line; see
[migration](docs/MIGRATION.md). No release or provider compatibility is inferred
from the source cleanup.
