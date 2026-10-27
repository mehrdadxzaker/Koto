# Koto roadmap

Development order: **verify the core and npm installation → integrations → Koto UI**.
The repository contains only this product and supporting development material.

| Stage | Outcome | Status |
| --- | --- | --- |
| npm foundation | One Node.js package installs and executes through npm/npx | Source implemented and earlier local tarball installation observed; final artifact acceptance and registry release tracked separately |
| Core foundation | Explicit task graphs, optional final task, concurrent workers, dependency handoffs, results and cancellation | Implemented; source checks available, host behavior requires direct observation |
| Terminal project flow | Concurrent worktrees with output/input/resize/stop controls through platform helpers | macOS/Linux PTY and Windows ConPTY/Job Object source implemented; Linux terminal mechanics observed, full native journeys remain host acceptance work |
| Real agent cooperation | Codex/OpenCode capabilities, structured events, captured session IDs and native continuation | Earlier Mac pipe cooperation observed; current protocol/resume source implemented, successful native continuation not yet observed here |
| Coding collaboration | Review full contributions, enforce ownership, integrate only new deltas and explicitly acknowledge resolved conflicts | Implemented with retained receipts and session-wide cleanup/conflict gates; current resume/delta/resolution journey needs real-project acceptance |
| Launch setup | Guided helper setup and explicit agent/model/task/ownership choices with shared preflight | Implemented; installed native accounts, models and effective configuration remain host prerequisites |
| Core planning and recovery | Goal decomposition, richer artifacts and automatic crash recovery | Future work beyond explicit task plans and supported native continuation |
| IDE and host delivery | Plugins and supported CLI/app integrations call the same core | After core acceptance; no second surface is needed to establish core behavior |
| Koto UI | A dedicated user interface on top of the shared core | After core verification and delivery needs are established |

CI is configured for source/scope checks and host-helper compilation on macOS,
Linux and Windows with Node 22 and 24. Results must be attached to the reviewed
revision; matrix configuration alone is not a pass. Linux helper compilation and
Windows MinGW cross-compilation have been observed locally. Compilation does
not establish native terminal interaction, model quality or installed-package
behavior. Automated suites, fixtures and benchmark tooling remain outside the
active product.

The next acceptance work is the [real-agent user run](USER_ACCEPTANCE.md) using
the exact reviewed package, followed by a resumed contribution integrated as a
delta. Observe native interaction and cleanup on each claimed host. Preserve
failed and partial outcomes; registry publication remains a separate action.

See [project sessions](PROJECT_SESSIONS.md) for the shared interface,
[native sessions](NATIVE_SESSIONS.md) for continuation and protocol boundaries,
and [current evidence](CORE_STATUS.md) for successful and failed observations.
Core verification comes before selecting or building another UI/plugin.
