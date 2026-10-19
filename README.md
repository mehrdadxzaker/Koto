# Koto

<img src="assets/koto-logo.png" alt="Koto wooden K logo" width="160" height="160" />

**Koto adds local models to the selection pool alongside the commercial model
you already use, then learns from your work which model should handle each prompt.**

Koto runs on your device and connects to your existing coding client. The client
keeps its editor, tools, permissions and agent loop. Initially, Koto chooses
between the client's selected commercial model and qualified local alternatives.
GPT, Gemini and Claude are possible commercial model families; actual support
depends on the client adapter and authorized provider connection. Codex is the
first implemented connection.

The core workflow is **history → scorecard → classifier → model execution →
observed outcome**. With separate consent, Koto maintains a personal scorecard
from retained tasks, independent checks or explicit feedback, latency, failures
and known costs. A small nearest-neighbor classifier runs locally without a
classifier model call. It first observes; automatic selection requires held-out
quality and latency validation. Unfamiliar work keeps the approved commercial
baseline. Hard local-only mode blocks when a suitable local choice is unavailable.

See [personal model selection](docs/PERSONAL_MODEL_SELECTION.md) for consent,
feedback, bounded local evaluations, validation, status and migration. Existing
manual [benchmark suites](docs/MODEL_SCORECARDS.md) remain an advanced tool.
Neither learning nor a scorecard grants missing local coding qualification.
Current experimental local coding setups remain unqualified; prior successful
controls and failed trials are retained as evidence.

Setup, verified model assets, streaming, tools, continuation affinity and safe
disconnect support this workflow. The CLI and skills plugin share their
implementation. See [product scope](docs/ROUTER_SCOPE.md) and
[shared setup](docs/SHARED_LOCAL_SETUP.md). Plugin installation alone does not
activate routing, download models or establish provider access.

## Install in your agent

The plugin manifests and shared CLI implementation are included in this source.
Installation remains subject to each coding client's plugin support and review.
Clone this repository or download and extract its source archive, then run the
commands below from the Koto source directory. Keep that directory available
while the plugins are installed.

### Codex

```sh
codex plugin marketplace add ./
codex plugin add koto@koto
```

Use a CLI with `codex plugin add` (checked on 0.160.0). Alternatively, after adding
the marketplace, select Koto in your client's plugin browser and install it.

### Gemini CLI

```sh
gemini extensions install ./
```

Restart the Gemini CLI session after installation.

### GitHub Copilot CLI

```sh
copilot plugin marketplace add ./
copilot plugin install koto@koto
```

### Claude Code

```sh
claude plugin marketplace add ./
claude plugin install koto@koto
```

Inside Claude Code, the equivalent commands start with `/plugin` instead of
`claude plugin`. Start a new session or reload plugins after installation.

### Cursor, OpenCode and other skill-capable agents

Use the [open Agent Skills installer](https://github.com/vercel-labs/skills)
(requires Node.js/npm). Choose your agent when prompted:

```sh
npx skills add ./ --skill koto
```

Or select it explicitly with `--agent cursor` or `--agent opencode`.

After installation, ask: **“Use Koto in this chat. Let me choose the configured
router or a qualified local model.”** Follow the [explicit chat workflow](docs/KOTO_CHAT.md)
to preserve the native model, account, plugins, MCP and reasoning. Normal-app
startup bridge activation is disabled. For an explicitly requested persistent
CLI connection, the skill checks the router, client version and qualification
before shared setup. Plugin installation installs instructions; the
router runtime and a qualified local model are separate prerequisites. The
implemented persistent connection supports Codex CLI 0.147.0 and the
[0.160.0 single-agent HTTP profile](docs/CODEX_0160.md), plus the
[isolated Codex app engine 0.162.0-alpha.17.2 qualification](docs/CODEX_APP_COMPATIBILITY.md) with
plugins, MCP discovery and reasoning enabled. Other agents can
use the skill to manage that connection; their own inference-routing adapters
are not implemented. See [installation, updates, removal and compatibility](docs/AGENT_INSTALLATION.md).

## Source evaluation

Use Python 3.11 or later in a virtual environment:

```sh
python3 -m venv .venv-koto
. .venv-koto/bin/activate
python -m pip install .
python -m koto --help
python -m unittest tests.test_execution_destination_workflow tests.test_connected_client_lifetime_workflow
```

For an existing installation, follow the [Koto migration notes](docs/KOTO_REBRAND.md)
before replacing the former Python distribution or plugin.

Installation may download Python dependencies. Tests require loopback access;
they use temporary files and processes with synthetic credentials. They do not
contact external model providers or change your active coding-client settings.

For deliberate setup, copy `config.example.json` to `koto.json`, set the
environment token named by its local identity, and review:

```sh
koto --config koto.json client connect codex --dry-run
koto --config koto.json client connect codex
koto client status codex
koto client disconnect codex
```

The example is deliberately unqualified and blocks inference until a real local
route has been qualified. It does not install a model or claim a known-good
runtime. See [admission](docs/LOCAL_ROUTE_ADMISSION.md),
[connection lifetime](docs/CONNECTED_CLIENT_LIFETIME.md) and [support](SUPPORT.md).

## Product limits

Local-only blocks every intercepted model path from cloud execution, including
helpers. It does not control unrelated coding-client tools, plugins or network
connections. Personal selection considers the selected commercial baseline and eligible
qualified local routes; unknown evidence uses the permitted baseline or blocks. Continuing
tool and provider state retains destination affinity.

Codex subscription access is not established by login or these tests. There is
no automatic fallback to billable API usage. Unknown costs remain unknown.

Inspect [cloud authorization readiness](docs/CLOUD_READINESS.md) before changing
settings with `koto --config koto.json client cloud-readiness codex`.
The opt-in [native Codex catalog](docs/NATIVE_CODEX_CATALOG.md) adds separate
gateway/native authentication for discovery. Separately enabled
[native Responses](docs/NATIVE_CODEX_RESPONSES.md) adds bounded HTTP/SSE inference,
continuation isolation and process-scoped usage with unknown plan cost.
The read-only receipt distinguishes declared API access from the two separately
authorized ChatGPT plan paths and reports their remaining blockers.

[Optional local history](docs/LOCAL_HISTORY.md) adds encrypted, redacted text
review and spending estimates on your device. Collection starts disabled;
`koto --config koto.json history enable` opts in for future intercepted
requests. Use `history list`, `history show`, `history insights`, `history export`,
`history delete` and `history disable` to control retained data. History collection alone does not enable classifier learning or cloud upload; exports are explicitly decrypted files.

The 2.0 development line retires standalone apps, hosted/enterprise front doors,
billing and PostgreSQL deployment support. [Migration and rollback](docs/MIGRATION_2.md)
describe the breaking changes. Existing releases, local user data and cloud
resources are not deleted by this repository cleanup.
[Operational resource cleanup remains open](docs/OPERATIONS_CLEANUP.md).

Use [CONTRIBUTING.md](CONTRIBUTING.md), [SUPPORT.md](SUPPORT.md),
[SECURITY.md](SECURITY.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Plugin capabilities

The skills-only plugin now offers focused diagnosis, observed request explanations,
bounded local model probes, advisory recommendations, privacy/budget staging,
usage insights and safe restoration. See the [capability contract](docs/PLUGIN_CAPABILITIES.md)
and [command workflow](skills/koto/references/capabilities.md) for coverage and limits.
