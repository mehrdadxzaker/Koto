# CLI first run and configuration selection

`koto init` installs the verified llama.cpp runtime and a pinned Qwen3-4B GGUF,
then connects a private Codex control home through the existing acquisition,
credential and connection owners. Normal Codex settings and authentication stay
in their original home. Use `koto chat ask` for explicit text work. This does not
install another agent loop or qualify autonomous coding.

## Install and begin

The first-run catalogs currently require Darwin arm64, Python 3.11–3.14, and
an existing Codex CLI **0.160.0** or the explicitly selected
**0.162.0-alpha.17.2** app engine. Other versions stop before asset transfer.
This is an experimental text-task envelope; it is not support for every current
Codex release, Linux, Windows, normal desktop startup, or automatic coding.

Install the source in a virtual environment as described in the
[README](../README.md#source-evaluation), or install a reviewed wheel into a
dedicated tool environment. An editable repository install is not installed
product acceptance. The real lifecycle test below installs the built wheel in
a new environment outside the checkout.

```sh
koto init --dry-run
koto init
koto config path
koto status
```

Use `--executable /absolute/path/to/codex` when the matching client is not on
PATH. The preview lists sources, licenses, download sizes, disk requirements,
configuration and connection locations. A fresh acquisition transfers about
2.51 GB. It reserves up to another 1 GiB for runtime extraction plus a 64 MiB
margin. Available disk space is checked; a successful check alone does not
establish available RAM or model quality.

Interactive setup asks once before downloading and changing the private control
home. For unattended setup, review `--dry-run`, then explicitly use `--yes`.
The transfer is bound to the catalog shown before consent; a changed catalog
stops setup before writing or downloading, so it can be reviewed again.
Without a terminal or `--yes`, init stops without downloading or changing
settings. Completed assets are verified and reused. `--offline --yes` requires
the matching verified assets and never downloads.

An explicit `--catalog` must declare the supported client transport and an
interactive profile with no coding evidence. Request bytes plus output tokens
must leave at least 1,024 tokens in that profile's runtime context, including
older 32K profiles. Other reviewed catalogs remain available through `client acquire`;
init rejects them before downloading or changing settings.

```sh
koto init --yes
koto chat ask --prompt-file /absolute/path/to/handoff-note.txt --effort low --max-output-tokens 512
koto status --routing
koto off
koto init --offline --yes
```

The text command reports the actual local model and execution destination.
The starter profile uses an 8,192-token context and at most 2,048 output tokens
for short text tasks; it does not reserve the historical 32K context on a small
machine. It admits at most 4,096 serialized provider-request bytes, conservatively
budgeted as one input token per byte, plus the output allowance and additional
chat-template headroom. Oversized requests stop before model submission. Version
7 validates that request bytes plus output tokens leave at least 1,024 context
tokens for that framing; historical profiles keep their previous limits.
The independent acceptance task keeps its original 90-second deadline.
Connection health and a completed response are separate from task quality.
The bootstrap text profile leaves coding evidence absent and automatic coding
disabled. History collection and learning remain separate opt-ins; init
preserves existing choices and does not enable either.

## One default across directories

Configuration selection has this precedence:

1. `--config PATH` or `--project DIR` (mutually exclusive).
2. `KOTO_CONFIG`, then the compatibility variable `HORMUZ_CONFIG`.
3. `$XDG_CONFIG_HOME/koto/config.json`, or `~/.config/koto/config.json`.

The environment overrides must be absolute paths; `~` is expanded. An explicit
`--config ./file.json` is relative to the current directory by deliberate choice.
An explicit project uses `DIR/.koto/config.json`. Overrides select one complete
configuration; credentials, policies and model destinations are not implicitly
merged. A missing or invalid explicit configuration fails instead of falling
back to the user profile.

```sh
koto config path
koto --project /absolute/path/to/project init --dry-run
koto --project /absolute/path/to/project init
koto --project /absolute/path/to/project chat ask --prompt-file /absolute/path/to/note.txt
koto --config /absolute/path/to/another.json status
```

Koto does not search the current directory or its ancestors for `koto.json`,
`hormuz.json`, or `.koto/config.json`. Entering a repository cannot silently
change a user's selected provider or execute its configuration.
Add a generated project's private `.koto/` directory to its ignore rules before
setup; the config's sibling state directory contains local credentials.

Assets default to `$XDG_DATA_HOME/koto/assets`, or
`~/.local/share/koto/assets`. An explicit `init --directory PATH` selects a
different private asset directory.
Use a trusted parent directory: paths other users can replace, including links
inserted during directory creation, are rejected before transfer.
Config, runtime, model, credential, and ledger
references generated by setup are absolute, so they remain usable after `cd`.
The default private client home is the selected configuration path with
`.codex` appended. `koto status` and `chat ask` resolve that same home. The
existing generation-bound chat owner makes `koto off` find and stop it.
Only one explicit chat owner can be active for a native Codex home; a different
active owner blocks new activation and the new connection is stopped.

Advanced `init --client-home PATH` deliberately selects another client home.
Use the returned status/disconnect commands and `chat ask --router-home PATH`
for that override. Existing `client setup/connect/status/disconnect` commands
retain their own client-home defaults and historical catalogs.
Status with an explicit `--client-home`, and `chat ask/models/propose` with an
explicit `--router-home`, use that connection directly. Unused configuration
environment overrides cannot block those commands.

## Interruption, restart and removal

Ctrl-C or SIGTERM stops the owned download worker, retains verified partial
progress, and returns 130. Repeat the same `init` to resume. Interrupted runtime
startup uses the connection owner's generation lock to stop its processes and
restore owned settings. Corruption or changed configuration is preserved and
reported; init does not overwrite it to guess the intended state.

Disconnect before uninstalling the environment that owns a live connection:

```sh
koto off
python -m pip uninstall koto-router
```

Use that tool environment's Python. If installed through a tool manager, use
its uninstall command after `koto off`. Removal stops owned resources and removes
entry points. It deliberately retains configuration, history, credentials and
downloaded model generations for inspection or reuse, following the
[asset retention decision](decisions/0032-client-matched-local-asset-acquisition.md).
Asset deletion is a separate exact-path action; there is no automatic purge.

## Test the installed product on a fresh machine

The optional `clean_install` input of the existing CI workflow starts a fresh
`macos-15` hosted runner by default, independently of the full Python matrix.
Development runs use focused checks; set `full_checkpoint=true` for the final
matrix, which also runs automatically when a PR is marked ready. The explicit `clean_install_runner` choice
also permits `macos-15-xlarge`, a billed 14 GiB accelerated Mac when the account
enables larger runners. It installs pinned Codex CLI 0.160.0, creates a new tool
environment, installs the exact build job's wheel, and runs this standalone
checker outside the repository:

```sh
python tools/verify_bootstrap_install.py dist/koto_router-*.whl \
  --executable /absolute/path/to/codex \
  --workspace /absolute/path/to/new-disposable-directory
```

The checker imports no repository or test modules. It checks user-level
configuration from unrelated directories, explicit project selection, read-only
preview, interruption of a real model transfer, resume and runtime installation,
one independently checked extraction task, disconnect, offline restart, closed
endpoints, and package removal. Native preferences and retained assets are
checked after removal. The original task output and failed stages are retained;
there are no automatic task retries or passing synthetic replacements.
After a runtime-start failure, the checker stops the connection and captures
one bounded, prompt-free engine diagnostic using the installed startup arguments.
That diagnostic cannot change the original failed result or submit a task.
After a text-task failure it retains content-free request timings and resource
observations, and still checks restart and removal. Those later stages cannot
turn the failed task or overall journey into a pass.

One artifact transfer runs at a time. Download and subprocess deadlines remain
finite; the real acceptance job has a 35-minute bound and always attempts owned
cleanup. It retains the result and original logs in
`koto-clean-install-evidence` for 14 days. This is opt-in because it downloads
real model weights and executes a model. Routine tests continue to use bounded
loopback stand-ins, and the complete Python matrix remains the final checkpoint.
A synthetic pass or an unexecuted acceptance script is not a clean
machine pass. Real acceptance does not establish broad hardware support,
autonomous coding quality, provider eligibility or marketplace activation.

The [7 GiB / three-CPU fresh-Mac run](https://github.com/mehrdadxzaker/Koto/actions/runs/39865317567/job/120126450853)
passed real acquisition, interrupted transfer, setup, offline restart and removal,
but its original extraction reached the 90-second deadline. The engine remained
CPU-active, memory compression/swap activity was present, and no provider headers
or bytes arrived before cleanup. These observations do not establish a passing
task or prove one root cause. That machine remains failed acceptance evidence;
a result on a larger machine cannot qualify this smaller envelope.

The narrowed engine diagnostic kept the same pinned assets, 8K context, request,
and 90-second deadline. [Automatic offloading](https://github.com/mehrdadxzaker/Koto/actions/runs/39871388731/job/120146509741)
returned the checked JSON in 77.665 seconds: 4.954 seconds for the 73-token
prompt and 72.642 seconds for 28 generated tokens. The log reported Metal layers
with Flash Attention falling back to CPU. [Explicit CPU execution](https://github.com/mehrdadxzaker/Koto/actions/runs/39871961078/job/120148392735)
returned the same checked JSON in 47.941 seconds, with the same input/output token
counts. These are bounded diagnostics on fresh VMs, rather than general hardware
performance claims or substitutes for the installed-product lifecycle.

The new managed-runtime v5 checks macOS's local `kern.hv_vmm_present` indicator
once, with a two-second bound. A confirmed VM selects `--n-gpu-layers 0` for the
text bootstrap. Physical Macs, unavailable/unknown observations, other platforms,
and historical managed profiles retain automatic device selection. The frozen
task, output allowance, reasoning, and 90-second task deadline are unchanged.
The lifecycle evidence records the VM observation and selected device mode.

## Migration and rollback

Earlier CLIs looked for `koto.json` or `hormuz.json` in the working directory.
Use `koto --config /absolute/path/to/that.json ...` or set an absolute
`KOTO_CONFIG` to keep an existing configuration. Init creates a new user profile
only when explicitly requested; it does not import or rewrite a repository file.
Never copy a generated JSON without its private credential/state references.

Acquisition/setup receipts and connection journals retain their existing
versions. The new text catalogs use setup-profile version 7 and managed-runtime
version 5, with an explicit bounded `context_tokens` declaration, the same
verified runtime/model bytes and a 120-second startup limit. Earlier profiles
keep their bounds and 32K context. Version 6 / managed version 4 retain the
startup-only extension; the original fresh-Mac task timeout at 32K is preserved.
Compatibility inputs are frozen in the [setup fixture](../tests/fixtures/local-setup-profile-v7.json)
and [managed-runtime fixture](../tests/fixtures/managed-llama-profile-v5.json).
Versions 6 and 7 permit only explicit interactive text work with absent coding
evidence. Older readers reject new versions instead of reinterpreting them.
Disconnect with the owning version before rollback and retain user files. Use
an older reviewed profile in a separate config when downgrading; pass its
absolute path to earlier CLIs whose defaults differ.
