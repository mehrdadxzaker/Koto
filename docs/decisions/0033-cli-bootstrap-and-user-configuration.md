# 0033: CLI bootstrap with a user default and explicit project selection

Status: implemented software slice; installed-product acceptance is a separate gate.

The owner requested runtime installation and model download in first run,
directory-independent configuration, explicit project overrides, and clean
installed-product coverage of setup, a useful task, interruption, restart and
removal.

`koto init` composes the existing acquisition and shared setup owners. It installs
pinned assets sequentially after an explicit interactive confirmation or
`--yes`. Preview is offline and creates no configuration or asset state. Nested
missing default directories are allowed, with disk space measured at the nearest
existing ancestor. Download resumption, locks, checksums, extraction, credentials
and process authority remain with their existing owners.

The user default is `XDG_CONFIG_HOME/koto/config.json`, falling back to
`~/.config/koto/config.json`. Explicit `--config` or `--project` wins over the
absolute `KOTO_CONFIG` / `HORMUZ_CONFIG` environment overrides. A project is
explicitly selected as `DIR/.koto/config.json`, without searching untrusted
working directories or merging credentials and policies. Generated references
are absolute. The old working-directory fallback is deliberately retired;
existing configurations remain accessible through explicit paths.

First run connects a private control home beside that configuration. Normal
Codex settings and authentication remain unchanged. `status` and explicit text
tasks resolve that same profile; `off` reuses the existing generation-bound chat
owner. An owner conflict stops the newly created connection. The existing CLI
client lifetime defaults and plugin behavior remain available separately.

Bootstrap selects a separate 0.160.0 text catalog based on the existing local
transport and existing verified llama.cpp/Qwen3-4B bytes. The old 0.160 coding
catalog stays reproducible. Interactive task selection does not supply coding
evidence or automatic routing permission. Unsupported clients block before
transfer. History and learning keep their existing separate consent.

Real fresh-machine evidence found loading took about 66.5 seconds on a 7 GiB
hosted Mac, exceeding the historical 60-second startup budget. A version-6
setup profile and managed-runtime version 4 permit up to 120 seconds for this
text-only first run. Earlier profile versions retain their bounds; version 6
requires interactive tasks and absent coding evidence. Runtime arguments,
request bounds, and inference timeouts otherwise remain unchanged.

The 32K case subsequently reached its unchanged 90-second text-task deadline.
Version-7 setup and managed-runtime version 5 make `context_tokens` explicit;
the starter catalog selects 8,192 context tokens, 2,048 output tokens and a
64 KiB request envelope. Earlier versions retain their original context and
bounds. The original timeout remains failed evidence. The acceptance prompt,
independent check and task deadline stay unchanged for the smaller context.

Cancellation during startup now restores and stops the exact generation while
the connection owner's lock remains held. No wrapper can accidentally adopt a
different generation for cleanup. Assets and configuration remain on ordinary
disconnect and uninstall, preserving ADR 0032's inspected-removal boundary.

Routine checks use external synthetic fixtures through public CLI and router
seams. A separate opt-in fresh macOS job installs the exact built wheel outside
the checkout, obtains actual assets, interrupts/resumes transfer, runs one frozen
independent text check, restarts offline, and verifies disconnect/removal. It
retains original failures and has bounded resource consumption. Passing routine
CI does not substitute for running this gate or establish general coding or
hardware qualification.

Existing receipt and journal versions remain valid. Setup-profile v6 / managed
runtime v4 fixtures freeze the wider startup contract; v7 / v5 fixtures freeze
the explicit context contract. Older readers reject new versions. Before rollback, disconnect through the
current owner and retain generated files. Use an earlier reviewed setup profile
in a separate config; older CLIs require an explicit absolute config path.
See [CLI bootstrap](../CLI_BOOTSTRAP.md) for the exact user flow and boundaries.
