# Repository scope

Koto is a shared orchestration core for commercial and open-source agents.
The only product components are the core and its worker adapters, npm/npx
installation, CLI, IDE plugins and Koto's own UI. Tests, examples, assets,
documentation and tooling must support those components.

Build the core and npm installation first; additional delivery surfaces follow.
All delivery surfaces consume the same core. Use the current Node.js package;
do not restore the former Python router, enterprise modules, skills-only
distribution, model campaigns or archive trees. Git history retains them.

Run `npm run check`, `npm test` and `npm run test:package` for relevant runtime or
packaging changes. Keep fixtures independent of provider accounts and model
downloads. Do not claim native-agent, platform, IDE or UI support without its
implementation and verification. See [scope](docs/SCOPE.md) and
[architecture](docs/ARCHITECTURE.md).
