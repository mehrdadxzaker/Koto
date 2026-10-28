# Install Koto

Koto requires Node.js 22 or later with npm. The Node.js core has no runtime
dependencies, required build step or installation hook. Native process helpers
ship as versioned C source for macOS, Linux and Windows. Build the host helper
explicitly with an already installed toolchain; package installation never
compiles it or downloads a compiler. CI is configured to run source and scope
checks and compile each platform helper with Node 22 and 24. Compilation is
separate from native-agent acceptance; observed results are recorded in
[current evidence](CORE_STATUS.md).
Process cleanup is separate from sandboxing; see the
[execution boundaries](ARCHITECTURE.md#lifecycle-and-execution-boundaries).

## Alpha release installation

The alpha release channel is `@mehrdadz/koto@alpha`. Install it globally
and open the guided CLI:

```sh
npm install --global @mehrdadz/koto@alpha
koto
```

Or open it without a global installation:

```sh
npx --yes @mehrdadz/koto@alpha
```

To pin the first alpha version explicitly:

```sh
npm install --global @mehrdadz/koto@3.0.0-alpha.0
```

Alpha releases can change. Source, native-platform and registry-installation
acceptance are recorded separately in [current evidence](CORE_STATUS.md). A
release command here does not establish that its registry publication or fresh
installation has completed.

## Koto skill for Codex and Claude Code

Use the same installation style as [Hallmark](https://github.com/Nutlope/hallmark#install):

```sh
npx skills add mehrdadxzaker/Koto -g
```

The installer discovers the `koto` skill and lets you choose your agents. For
Codex and Claude Code explicitly:

```sh
npx skills add mehrdadxzaker/Koto -g --skill koto --agent codex claude-code
```

Leave off `-g` for a project installation. The Skills CLI currently requires
Node.js 22.20 or later. Its canonical skill directory is `.agents/skills/koto`
(under your home directory for `-g`); it links Claude Code's
`.claude/skills/koto` to that copy. Use the installer's `--copy` option if your
environment does not support symlinks. Existing skills with the same name may
be replaced: inspect the installer's destination summary before confirming.

Start a new Codex or Claude Code conversation in your project. Invoke
`$koto plan the work for this project` in Codex or
`/koto plan the work for this project` in Claude Code. You can also ask your
agent to use Koto in ordinary language. Codex shows the display name **Koto**;
the skill identifier and command are `koto`. If it is missing, check
`npx skills list -g` (without `-g` for project installs), confirm the selected
agent and installation scope, then restart the agent.

The skill is an optional set of [instructions](../skills/koto/SKILL.md) over the
existing CLI. It uses the exact published `@mehrdadz/koto@3.0.0-alpha.0` release
through `npx`, so an old `koto` executable on your PATH cannot silently select a
different runtime. It invokes the package from a private empty directory to
avoid npm selecting a same-named source project. The first invocation needs
registry access and may prompt
for the host agent's normal tool permission. No global CLI install, new Koto
account or provider API key is required for subscription use. For guided account
discovery or optional local-model setup, open Koto in a real terminal:

```sh
npx --yes --registry=https://registry.npmjs.org/ --package=@mehrdadz/koto@3.0.0-alpha.0 -- koto
```

Downloads and native sign-in follow the CLI's normal guided choices. In a host
agent chat, Koto can build and check a project plan without launching work;
launching agents and integrating reviewed contributions are separate actions.
The skill does not grant extra filesystem, network or account access.

Keep the skill current or remove it with:

```sh
npx skills update koto -g
npx skills remove koto -g
```

Use the scope in which you installed it when listing or removing. Updating the
skill does not replace your global CLI. Its pinned runtime changes only when a
reviewed skill update selects another published version.

Find Koto on [skills.sh](https://skills.sh/mehrdadxzaker/koto/koto). The directory
uses the repository address for provenance; the installed skill is named
**Koto**. The Skills CLI reports anonymous install telemetry for discovery and
security audits; set `DISABLE_TELEMETRY=1` to opt out. See the official
[Skills CLI documentation](https://skills.sh/docs/cli).

The npm package remains scoped as `@mehrdadz/koto`: the unscoped npm name `koto`
already belongs to another package. This does not change the `koto` executable,
the skill name or the Koto product name. A bare `npx skills add Koto` is not a
supported source address in the Skills CLI.

## Package from source

From a reviewed source checkout:

```sh
npm pack
```

Copy the resulting `mehrdadz-koto-3.0.0-alpha.0.tgz` to another machine with
Node.js and npm, then install or run it:

```sh
npm install --global ./mehrdadz-koto-3.0.0-alpha.0.tgz
koto --version
```

For execution without global installation:

```sh
npx --yes --package ./mehrdadz-koto-3.0.0-alpha.0.tgz koto --help
```

Local packaging and installation do not publish to the npm registry.

## Agent and delivery dependencies

Run `koto` for normal setup. It discovers existing Codex/ChatGPT and Claude Code
subscription logins, offers native installation/sign-in when needed, and remembers
the selected client. Missing clients install into Koto's private versioned
directory rather than a global npm location. No provider API key is required.

Optional local-model choices show size, license and memory guidance. Koto checks
storage, downloads immutable digest-verified weights, acquires a verified
llama.cpp binary release and retains its libraries. Existing matching assets
are reused. `/models add` repeats that guided selection; `/models use MODEL_ID`
chooses among downloaded models. One managed local model server is active at a
time and is stopped when Koto exits.

Scripted workflows can use separately configured agent runtimes. The generic process
worker expects Koto's JSON-stdin/text-stdout contract. Project sessions instead
run installed native clients. On
Windows use an actual executable or `$node` with a script path; `.cmd` and `.bat`
wrappers are not launched through a shell.

Project sessions additionally require Git on an absolute PATH entry and a clean
Git project. They run separately installed command executables using the exact
argument arrays in your plan, rather than imposing the JSON worker protocol.
Use [launch setup](LAUNCH_SETUP.md) to prepare native command arguments from
explicit runtime/model/task/ownership choices and inspect readiness with
`koto plan check`. The shared core repeats preflight before creating workspaces.
See [guided sessions](GUIDED_SESSIONS.md) to launch without preparing JSON, and
[project sessions](PROJECT_SESSIONS.md) for terminal controls, review tokens and
conflict handling. Structured Codex/OpenCode profiles observe native lifecycle
and capture exact session IDs for explicit continuation. Interactive terminals
provide live native input and resize; their screen text is not a machine-readable
session protocol. See [native sessions](NATIVE_SESSIONS.md) for those boundaries.

## Build the host helper

```sh
koto terminal build
koto terminal info
```

The guided launcher's **Set up terminal support** option performs the same
explicit build or verifies an existing matching artifact. It never starts a
model. The builders target x64 and arm64; native behavior still requires
observation on the selected host:

| Host | Existing prerequisites | Helper use |
| --- | --- | --- |
| macOS | Apple command-line developer tools and SDK | PTY agents |
| Linux | System C compiler, libc development headers, procfs and allowed pidfd syscalls | PTY agents |
| Windows 10 1809 or newer | Visual Studio C++ tools and a matching Windows SDK | All project agents and repository preflight, including pipe mode |

Artifacts are versioned by source digest in the private `~/.koto/native`
directory. To choose another private directory outside Git worktrees, pass
`--directory ABS_PATH`; use that same value as the plan's
`nativeHelperDirectory`. The Windows guided launcher offers setup before Git
inspection, and retains the selected directory for launch. A package/source
upgrade may require another explicit build. Never replace a mismatched artifact
or delete an interrupted build lock without inspecting it.

Windows project helpers assign workloads to owned Job Objects; terminal mode
uses ConPTY. POSIX PTY helpers own a separate session. These mechanisms manage
process lifetime rather than limiting filesystem or network permissions.
Retained `cleanup_unconfirmed` outcomes block resume and integration on every
platform. Follow the [acceptance run](USER_ACCEPTANCE.md) for actual host evidence.

IDE plugins and Koto's UI will be separate ways to use the installed core. They
are planned and no placeholder package is installed today.

Use `npm uninstall --global @mehrdadz/koto` to remove a global installation.
Koto creates no startup hooks; model downloads occur only after a selected guided
installation or explicit advanced acquisition command. Project sessions retain private
control/output files and Git branches/worktrees; uninstalling the package does
not delete them. Inspect and preserve that work before any explicit cleanup.
