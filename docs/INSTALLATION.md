# npm installation

Koto requires Node.js 22 or later with npm. The Node.js core has no runtime
dependencies, required build step or installation hook. Optional Mac PTY support
ships versioned C source and requires a separate explicit local helper build
using an existing Apple toolchain; package installation never builds it. The release
target is Windows, macOS and Linux. CI runs source and scope checks on those
platforms with Node 22 and 24 and compiles the optional helper on Mac; it does
not execute installed packages or workers.
Process cleanup is separate from sandboxing; see the
[execution boundaries](ARCHITECTURE.md#lifecycle-and-execution-boundaries).

## Local package

The registry package is not published yet. From this checkout:

```sh
npm pack
```

Copy the resulting `mehrdadxzaker-koto-3.0.0-alpha.0.tgz` to another machine with
Node.js and npm, then install or run it:

```sh
npm install --global ./mehrdadxzaker-koto-3.0.0-alpha.0.tgz
koto --version
```

For execution without global installation:

```sh
npx --yes --package ./mehrdadxzaker-koto-3.0.0-alpha.0.tgz koto --help
```

Registry publication will enable installation by package name. The intended name
in `package.json` is `@mehrdadxzaker/koto`; ownership/availability and the release
must be verified before documenting a published command as working.

## Agent and delivery dependencies

Real workflows require separately configured agent runtimes. The generic process
worker expects Koto's JSON-stdin/text-stdout contract. It is not a native Codex
or Claude Code integration. On Windows use an actual executable or `$node` with
a script path; `.cmd` and `.bat` wrappers require a dedicated adapter.

Project sessions additionally require Git on an absolute PATH entry and a clean
Git project. They run separately installed command executables using the exact
argument arrays in your plan, rather than imposing the JSON worker protocol.
Use [launch setup](LAUNCH_SETUP.md) to prepare native command arguments from
explicit runtime/model/task/ownership choices and inspect readiness with
`koto plan check`. The shared core repeats preflight before creating workspaces.
See [project sessions](PROJECT_SESSIONS.md) for launch approval, concurrent
worktrees, terminal controls, review tokens and conflict handling. Pipes are the
default; [experimental Mac PTY](MAC_TERMINALS.md) is opt-in and remains unverified
with actual native terminals. The prior real Mac pipe cooperation and the later
failed Linux attempt are recorded in [current evidence](CORE_STATUS.md).
Native protocol adapters and native session resume remain open. Windows project
pipe exits report unconfirmed descendant cleanup and block automatic integration.

IDE plugins and Koto's UI will be separate ways to use the installed core. They
are planned and no placeholder package is installed today.

Use `npm uninstall --global @mehrdadxzaker/koto` to remove a global installation.
Koto creates no startup hooks or model downloads. Project sessions retain private
control/output files and Git branches/worktrees; uninstalling the package does
not delete them. Inspect and preserve that work before any explicit cleanup.
