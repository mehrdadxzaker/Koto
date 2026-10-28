# Koto product scope

Owner decision: October 26, clarified October 28, 2026.

Koto has one shared core that lets commercial and open-source agents work
together. Users install it through npm or run it through npx. They can then use
the same core through a CLI, an IDE plugin or Koto's own UI as those delivery
surfaces become available.

The repository contains these components and the documentation, assets and
source tooling needed to develop and deliver them:

1. Shared orchestration core and worker adapters.
2. Cross-platform npm/npx installation and CLI, Homebrew/Linux packaging of the
   same published CLI, and an optional agent skill that invokes it.
3. IDE plugins consuming the core.
4. Koto's own UI consuming the core.

The core, npm installation and a smooth CLI onboarding/everyday journey come
first. Validate fresh and returning users on a real project before building UIs
and IDE plugins. A host such as Codex or Claude Code can be an agent runtime,
a delivery surface, or both through explicitly implemented adapters.
The scope guard reserves `plugins/` and `ui/` for those later deliveries without
adding placeholder implementations.

The optional `skills/koto` delivery makes Koto available inside Codex and Claude
Code through the Skills CLI. Its installed name is `koto` and its display name
is Koto. It contains instructions and references, not another engine, account
store or agent launcher. Runtime actions use the published npm CLI. Native
subscription credentials remain with their clients, and local downloads and
project launches retain the CLI's normal choices and approval boundaries.

The previous Python router, finance/portfolio/enterprise modules, hosted-service
products, model-specific experiments, historical campaigns, skills-only packages
and operational cleanup work are outside the active tree. Git history retains
earlier source; do not add an archive directory or a second product runtime.

Homebrew acquires its Node dependency; the Linux installer acquires a pinned,
digest-verified official Node runtime. Both install the exact published CLI
archive recorded in `install/manifest.json`. They manage delivery and executable
discovery, not orchestration or user credentials. The Linux installer owns only
its selected installation directory and command link; account/model/project
state remains separate and survives uninstall.

Node.js is the installed runtime. Installing Koto must not require a separate
Python setup, compiler, shell-specific bootstrap or mandatory local-model
download. The CLI discovers supported native agents and subscription logins,
offers their native installation/sign-in, remembers choices, and optionally
acquires verified local models and a pinned runtime. Native credentials remain
with their clients. Provider API keys are not required for subscription use.
Advanced scripted workflows can retain separately configured dependencies.

See [architecture](ARCHITECTURE.md), [installation](INSTALLATION.md),
[roadmap](ROADMAP.md) and [migration](MIGRATION.md).
