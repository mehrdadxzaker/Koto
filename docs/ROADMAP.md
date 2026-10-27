# Koto roadmap

Development order: **core and npm installation → integrations → Koto UI**.
The repository contains only this product and supporting development material.

| Stage | Outcome | Status |
| --- | --- | --- |
| npm foundation | One package installs and executes through npm/npx without Python or platform-specific bootstrap | Package source implemented; registry release pending |
| Core foundation | Explicit task graphs, optional final task, concurrent workers, dependency handoffs, results and cancellation | Implemented; CI checks source scope only |
| Terminal project flow | Configured external commands run concurrently in Git worktrees, with output/input/stop controls and explicit reviewed integration | Mac pipe flow observed; optional Mac PTY source implemented, native PTY observation pending |
| Real agent cooperation | Commercial and open-source agents contribute through supported command/protocol integrations | Mac Codex/OpenCode pipe cooperation observed; native protocols, resume and broader platform qualification remain open |
| Coding collaboration | Review complete contributions, enforce declared integration ownership and expose conflicts in a separate worktree | Two Mac contributions reviewed/integrated; every agent must settle cleanup before integration; Windows launch blocked pending owned-process cleanup |
| Launch setup | Explicit agent/model/task/ownership choices expand into inspectable commands with shared preflight | Implemented; native account/model/effective-configuration readiness remains separately observable |
| Core planning and lifecycle | Goal decomposition, richer artifacts and recoverable sessions where adapters support them | Planned beyond explicit plan building |
| IDE and host delivery | Plugins and supported CLI/app integrations call the same core | Later; each host needs an available integration interface |
| Koto UI | A dedicated user interface on top of the shared core | After core and delivery needs are established |

Current CI inspects source and scope. Automated suites, fixtures and package
execution are removed; CI results do not establish model quality, native-agent
support or installed-package behavior. Optional Mac helper compilation is also
a source check, not native terminal verification.

The runnable local interface and remaining limits are described in
[project sessions](PROJECT_SESSIONS.md). [Current evidence](CORE_STATUS.md)
preserves successful and failed observations and the remaining delivery gaps.
Later plugins and UIs use the same API.
