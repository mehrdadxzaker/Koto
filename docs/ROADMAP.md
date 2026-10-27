# Koto roadmap

Development order: **core and npm installation → integrations → Koto UI**.
The repository contains only this product and supporting development material.

| Stage | Outcome | Status |
| --- | --- | --- |
| npm foundation | One package installs and executes through npm/npx without Python or platform-specific bootstrap | Package source implemented; registry release pending |
| Core foundation | Explicit task graphs, concurrent workers, dependency handoffs, results and cancellation | Initial implementation; CI checks source scope only |
| Real agent cooperation | Commercial and open-source agents contribute through verified worker adapters | Next; native adapters, permissions and bounded interoperability evidence needed |
| Coding collaboration | Concurrent native agents in isolated workspaces, terminal controls, artifact revisions and one integration owner | Immediate implementation gap alongside native adapters |
| Core planning and lifecycle | Goal decomposition, richer artifacts and recoverable sessions where adapters support them | Planned |
| IDE and host delivery | Plugins and supported CLI/app integrations call the same core | Later; each host needs an available integration interface |
| Koto UI | A dedicated user interface on top of the shared core | After core and delivery needs are established |

Current CI inspects source and scope. Automated suites, fixtures and package
execution are removed; CI results do not establish model quality, native-agent
support or installed-package behavior.
