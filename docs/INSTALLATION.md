# Install Koto

Koto uses one local runtime through two entry points: the CLI and an agent
plugin. They share configuration, downloaded models, connection ownership and
updates. A plugin is a convenient setup interface; it does not need a separate
router or model engine.

## Install the runtime directly

Use Python 3.11–3.14 and a reviewed Koto wheel or source revision. Install into
a dedicated tool environment, then use its `koto` executable from any directory.
For example, with an existing pipx installation:

```sh
pipx install /absolute/path/to/reviewed/koto_router-VERSION-py3-none-any.whl
koto --version
koto config path
koto init --dry-run
koto init
```

Substitute the actual reviewed wheel filename. A source checkout can be installed
with `pipx install /absolute/path/to/reviewed/koto-checkout`. Do not assume an
unpublished package exists in a public package index. The version printed by
the installed command should match the selected artifact.

`init` chooses a pinned runtime for the actual operating system, architecture
and supported Codex executable. Preview shows model/runtime sources, download
sizes and private paths. Setup requests confirmation before downloading models
or connecting a client; installation does not enable history or learning.

| Machine | Bundled first-run profile |
| --- | --- |
| Apple Silicon Mac (`Darwin/arm64`) | Codex CLI 0.160.0; existing explicitly selected app engine profile also retained |
| Intel Mac (`Darwin/x86_64`) | Codex CLI 0.160.0, macOS x64 runtime |
| Linux x64 (`Linux/x86_64`) | Codex CLI 0.160.0, upstream Ubuntu x64 CPU runtime |
| Linux ARM64 (`Linux/aarch64`) | Codex CLI 0.160.0, upstream Ubuntu ARM64 CPU runtime |

Linux distributions must satisfy the upstream Ubuntu binary's runtime/library
requirements. A matching OS and architecture selects assets; it does not prove
hardware capacity, model quality or a passing fresh-machine task. Unsupported
combinations stop before downloading or changing settings. Explicit reviewed
catalogs remain available and must match the actual machine and client.

The Windows package entrypoints support help, version, configuration-path and
contract inspection. Native Windows connection/model ownership is not implemented;
it still returns a structured platform error. Windows users can evaluate the
Linux path within WSL2, installing Python, Codex and Koto in the same Linux
environment. Native Windows installers with full runtime control remain a
product target and require a Windows security/process implementation.

## Install through an agent plugin

Install the host's [Koto plugin](AGENT_INSTALLATION.md), then explicitly request
Koto setup. The agent should:

1. Detect the selected `koto` executable and inspect its version and available
   commands. Reuse that installation when compatible.
2. If absent, help install the user-selected reviewed wheel or source into a
   dedicated tool environment using the same direct installation above.
3. Run `koto init --dry-run`, explain its actual paths/downloads, and invoke
   setup only under the user's requested scope and the host's execution rules.
4. Use the same CLI for status, model operations and disconnect.

Where a plugin host cannot execute local commands, provide the direct install
handoff. Loading a skill does not execute an installer or grant model-download,
history, account or workspace permissions. The host retains tools, editing,
permissions and its agent loop.

## Updates, removal and moving machines

Update the runtime through the tool environment that owns it; update plugin
instructions through the host's plugin manager. Disconnect with the owning
runtime before replacement or removal. Both paths preserve configuration,
history and downloaded models unless separately inspected deletion is requested.
See [restart and removal](CLI_BOOTSTRAP.md#interruption-restart-and-removal).

Install the same runtime/plugin revision on another machine, then run that
machine's setup preview. Credentials, absolute asset paths, active connection
journals and setup-bound qualification are machine-local. Copying a config or
successful receipt from another machine cannot qualify a new setup.

## Distribution direction

The intended product has native per-user installers for macOS, Windows and
Linux, with the interpreter/dependencies included, plus plugin-assisted setup
of the same core. A desktop management interface can use this core for models,
connections and status; it does not need a second chat app or coding-agent loop.
The current deliverable is the CLI/plugin foundation, not a native desktop app.
Adding that interface and installer signing remains a separately scoped product
step under the existing [router boundary](ROUTER_SCOPE.md).

CI exercises a fresh wheel installation on Linux, macOS and Windows before its
focused/full suites. Those checks download no models and establish entrypoint
installation only. Actual model/client/provider/fresh-user qualification and
the [release acceptance hold](RELEASING.md#current-acceptance) remain separate.
