# Maintainers

[Mehrdad Zaker (@mehrdadxzaker)](https://github.com/mehrdadxzaker) is the current
maintainer and product owner. Review and community support are best effort.

| Component | Location |
| --- | --- |
| Orchestration core | `src/core.js` |
| Process-worker adapter | `src/process-agent.js` |
| Project-session coordination and public exports | `src/project-session.js`, `src/index.js` |
| External command lifecycle and output | `src/command-session.js` |
| Git worktrees, review and integration ownership | `src/project-workspaces.js` |
| CLI and npm distribution | `bin/`, `package.json` |
| Source and scope checks | `tools/check-scope.js`, `.github/workflows/ci.yml` |
| Product documentation | `docs/`, `README.md` |

IDE plugins and Koto's UI will consume the same core when implemented. They do
not have placeholder packages or current support claims.

The project-session flow is implemented locally and awaits a real Mac agent
demonstration. Its commands use raw argv and ordinary pipes; native protocol
adapters, PTY and platform qualification are not supplied. Preserve this boundary
when reporting source checks. See [project sessions](docs/PROJECT_SESSIONS.md).

Changes should fit [scope](docs/SCOPE.md) and provide inspectable verification.
Repository permissions and branch protections remain under their current
owners. See [contributing](CONTRIBUTING.md), [contributors](CONTRIBUTORS.md)
and [security](SECURITY.md).
