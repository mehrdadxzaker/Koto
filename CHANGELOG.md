# Changelog

## 3.0.0-alpha.0 — unreleased npm development line

- Replace the previous Python-router product with a shared Node.js orchestration
  core and an npm/npx CLI distribution.
- Add explicit cooperative task graphs, bounded concurrent workers and dependency
  handoffs, with failure and cancellation outcomes.
- Add a deterministic headless demo and installed-tarball verification.
- Ship public TypeScript declarations with strict packed-package consumer checks
  and verify the core/CLI on Linux with Node 22 and 24.
- Restrict the active repository to the core, CLI, future IDE plugins and Koto UI,
  with their supporting documentation, tests and tooling.
- Remove the previous router, enterprise modules, model experiments, campaign
  archives and skills-only packaging from the active tree.

This npm package is not published yet. Earlier source and releases remain in
[Git history](https://github.com/mehrdadxzaker/Koto/commits/main) and
[releases](https://github.com/mehrdadxzaker/Koto/releases).
See [migration](docs/MIGRATION.md).
