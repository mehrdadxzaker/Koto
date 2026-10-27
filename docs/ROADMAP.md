# Koto roadmap

Development order: **core and npm installation → integrations → Koto UI**.
The repository contains only this product and supporting development material.

| Stage | Outcome | Status |
| --- | --- | --- |
| npm foundation | One package installs and executes through npm/npx without Python or platform-specific bootstrap | Package source implemented; registry release pending |
| Core foundation | Explicit task graphs, optional final task, concurrent workers, dependency handoffs, results and cancellation | Implemented; CI checks source scope only |
| Terminal project flow | Configured external commands run concurrently in Git worktrees, with output/input/stop controls and explicit reviewed integration | Implemented using pipes; one actual Mac agent workflow observed |
| Real agent cooperation | Commercial and open-source agents contribute through supported command/protocol integrations | Codex and OpenCode/local Qwen3-14B observed on one Mac; native protocol adapters, PTY and broader qualification remain open |
| Coding collaboration | Review complete contributions, enforce declared integration ownership and expose conflicts in a separate worktree | Two contributions inspected and token-approved into an integration branch on one Mac; broader platform observation pending |
| Core planning and lifecycle | Goal decomposition, richer artifacts and recoverable sessions where adapters support them | Planned |
| IDE and host delivery | Plugins and supported CLI/app integrations call the same core | Later; each host needs an available integration interface |
| Koto UI | A dedicated user interface on top of the shared core | After core and delivery needs are established |

Current CI inspects source and scope. Automated suites, fixtures and package
execution are removed; CI results do not establish model quality, native-agent
support or installed-package behavior.

The runnable local interface and remaining limits are described in
[project sessions](PROJECT_SESSIONS.md). Later plugins and UIs use the same API.
The recorded Mac workflow establishes one manual observation, not a benchmark
or a model-quality, speed or cost comparison.
