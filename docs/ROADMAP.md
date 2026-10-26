# Koto roadmap

Development order: **core and npm installation → integrations → Koto UI**.
The repository contains only this product and supporting development material.

| Stage | Outcome | Status |
| --- | --- | --- |
| npm foundation | One package installs and executes through npm/npx without Python or platform-specific bootstrap | Local tarball and package verification in this slice; registry release pending |
| Core foundation | Explicit task graphs, concurrent workers, dependency handoffs, results and cancellation | Initial implementation with fixture-based tests |
| Real agent cooperation | Commercial and open-source agents contribute through verified worker adapters | Next; native adapters, permissions and bounded interoperability evidence needed |
| Coding collaboration | Isolated workspaces, artifact revisions, one integration owner and independent checks | Planned |
| Core planning and lifecycle | Goal decomposition, richer artifacts and recoverable sessions where adapters support them | Planned |
| IDE and host delivery | Plugins and supported CLI/app integrations call the same core | Later; each host needs an available integration interface |
| Koto UI | A dedicated user interface on top of the shared core | After core and delivery needs are established |

The deterministic demo proves a handoff changes the final result. It does not
establish model quality, native-agent support or a published npm release.
Platform claims follow actual CI and installed-package results.
