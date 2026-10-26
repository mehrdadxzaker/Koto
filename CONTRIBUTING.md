# Contributing

Work on the shared orchestration core, npm installation, CLI, IDE plugins or
Koto's own UI. Supporting documentation, tests and tooling must serve those
components. Read the [scope](docs/SCOPE.md) and [architecture](docs/ARCHITECTURE.md).
Build the core before additional delivery surfaces.

## Development

Use Node.js 22 or later and npm:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run test:package
```

Keep core behavior independent of an IDE or UI. Delivery adapters call the same
core. Agent runtimes own their model access, tools and permissions; worker
adapters describe the capabilities they actually support.

Test meaningful public behavior with synthetic workers and temporary storage.
Cover dependency handoffs, concurrency, failures, deadlines, cancellation and
installed-package behavior when changing those paths. Do not require paid model
calls or provider credentials for routine checks. A fixture result does not
establish real-agent quality or compatibility.

Do not add unrelated products, campaign archives, old runtime compatibility
layers or a second installation system. Earlier implementations remain in Git
history. Preserve unrelated local work and never check in credentials or private
workflows. See [security](SECURITY.md).

## Review

Describe the concrete problem, resulting behavior and validation. Identify any
changed workflow or adapter contract. Keep current support separate from planned
integrations. Discuss major architecture changes with the maintainer; the owner
has already established the product boundary in [scope](docs/SCOPE.md).

Community review is best effort. Follow the [code of conduct](CODE_OF_CONDUCT.md).
