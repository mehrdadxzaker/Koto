# Support

Koto is experimental software with best-effort community support.

| Component | Current status |
| --- | --- |
| npm package and CLI | Guided CLI and local package implemented; alpha release installation path in the [installation guide](docs/INSTALLATION.md). Registry publication and fresh-install acceptance have their own release record. |
| Node.js | Requires version 22 or later |
| TypeScript | Public declarations included; automated consumer checks removed |
| Platforms | Recorded native/control observations cover macOS, Linux ARM64 in Docker and native Windows. CI checks source and compiles helpers on Windows, macOS and Linux with Node 22/24. See exact versions and limits in [current evidence](docs/CORE_STATUS.md). |
| Core | Explicit task graphs, optional final task, process workers, dependency handoffs, bounded concurrency and lifecycle control |
| External command sessions | Explicit executable/argv commands use pipes or native terminals; structured Codex/OpenCode profiles expose their declared lifecycle capabilities. Terminal screen output remains uninterpreted. |
| Project workspaces | Separate Git worktrees and branches per command, plus a separate integration branch; worktrees do not restrict OS access |
| Terminal collaboration | Native input, resize, attach/detach, individual/all stop, reviewed integration and retained work were observed within the recorded CLI acceptance scope. |
| Agent observation | Useful commercial/local contributions, native controls and reviewed integration have named source/host records. Conditional client branches and general model coding qualification retain their stated limits. |
| Process ownership | POSIX process/session ownership and Windows Job/ConPTY cleanup; unconfirmed cleanup stays explicit and blocks conflicting continuation/integration. Worktrees are not an OS sandbox. |
| IDE plugins | Planned |
| Koto UI | Planned |

Agent accounts and permissions remain native. The guided CLI discovers existing
subscription logins, offers native setup/sign-in, and can acquire optional local
models and a pinned runtime. No provider API key is required for the supported
subscription journey. A worker's exit code does not establish answer quality;
review contributions and check the resulting application independently.
Current CI provides source/scope and helper-compilation evidence; automated
suites and fixture demos are outside the active product.

Project sessions require Git and supported native clients. Building terminal
helpers requires the existing host toolchain described in
[installation](docs/INSTALLATION.md#build-the-host-helper). Native clients keep
their authentication and permission controls. See
[project sessions](docs/PROJECT_SESSIONS.md) and
[native sessions](docs/NATIVE_SESSIONS.md).

The [recorded Mac demonstration](https://github.com/mehrdadxzaker/Koto/pull/613)
includes 25.4 seconds of overlapping native execution and two reviewed
contributions integrated without conflict. Its two Codex and two local CLI
invocations include an initial quoting failure and revision. The task-board
application ran manually with four tasks and 25% completion. Later native
terminal, onboarding and platform observations are recorded in
[issue #543](https://github.com/mehrdadxzaker/Koto/issues/543). Earlier failures,
partial outcomes and unknown costs remain preserved; these tasks do not
establish a benchmark comparison or general model coding qualification.

For bugs, include package version, Node version, OS and a synthetic reproduction.
Use [GitHub issues](https://github.com/mehrdadxzaker/Koto/issues). Report
vulnerabilities through the [private security path](SECURITY.md).

Previous Python releases are outside this development line; see
[migration](docs/MIGRATION.md). No release or provider compatibility is inferred
from the source cleanup.
