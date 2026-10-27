# Repository scope

Koto is a shared orchestration core for commercial and open-source agents.
The only product components are the core and its worker adapters, npm/npx
installation, CLI, IDE plugins and Koto's own UI. Assets,
documentation and tooling must support those components.

Build the core and npm installation first; additional delivery surfaces follow.
All delivery surfaces consume the same core. Use the current Node.js package;
do not restore the former Python router, enterprise modules, skills-only
distribution, model campaigns or archive trees. Git history retains them.

The owner removed automated suites, fixture demos and benchmark tooling from
the active product. Do not add or run test suites. Run `npm run check` for source
and scope checks, and demonstrate changed product behavior directly where the
required agents and permissions are available. Describe what was observed and
what remains unsupported. Do not claim native-agent, platform, IDE or UI support
without its implementation and verification. See [scope](docs/SCOPE.md) and
[architecture](docs/ARCHITECTURE.md).
