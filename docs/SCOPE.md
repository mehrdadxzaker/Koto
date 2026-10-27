# Koto product scope

Owner decision: October 26, 2026.

Koto has one shared core that lets commercial and open-source agents work
together. Users install it through npm or run it through npx. They can then use
the same core through a CLI, an IDE plugin or Koto's own UI as those delivery
surfaces become available.

The repository contains these components and the documentation, assets and
source tooling needed to develop and deliver them:

1. Shared orchestration core and worker adapters.
2. Cross-platform npm/npx installation and CLI.
3. IDE plugins consuming the core.
4. Koto's own UI consuming the core.

The core and npm installation come first. Additional delivery integrations and
the UI follow. A host such as Codex or Claude Code can be an agent runtime,
a delivery surface, or both through explicitly implemented adapters.
The scope guard reserves `plugins/` and `ui/` for those later deliveries without
adding placeholder implementations.

The previous Python router, finance/portfolio/enterprise modules, hosted-service
products, model-specific experiments, historical campaigns, skills-only packages
and operational cleanup work are outside the active tree. Git history retains
earlier source; do not add an archive directory or a second product runtime.

Node.js is the installed runtime. Installing Koto must not require a separate
Python setup, compiler, shell-specific bootstrap or mandatory local-model
download. Agent runtimes and their accounts or model assets remain separately
configured dependencies.

See [architecture](ARCHITECTURE.md), [installation](INSTALLATION.md),
[roadmap](ROADMAP.md) and [migration](MIGRATION.md).
