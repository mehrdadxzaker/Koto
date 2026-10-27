# Changelog

## 3.0.0-alpha.0 — unreleased npm development line

- Replace the previous Python-router product with a shared Node.js orchestration
  core and an npm/npx CLI distribution.
- Add explicit cooperative task graphs, bounded concurrent workers and dependency
  handoffs, with failure and cancellation outcomes.
- Ship public TypeScript declarations for the core API.
- Remove automated suites, fixtures, the headless demo and package-execution
  tooling; retain source and scope checks in CI.
- Restrict the active repository to the core, CLI, future IDE plugins and Koto UI,
  with their supporting documentation, assets and source tooling.
- Remove the previous router, enterprise modules, model experiments, campaign
  archives and skills-only packaging from the active tree.

This npm package is not published yet. Earlier source and releases remain in
[Git history](https://github.com/mehrdadxzaker/Koto/commits/main) and
[releases](https://github.com/mehrdadxzaker/Koto/releases).
See [migration](docs/MIGRATION.md).
