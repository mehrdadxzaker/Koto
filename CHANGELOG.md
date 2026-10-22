# Changelog

## Unreleased

- Add opt-in Qwen v11/v12 type-constraint treatments for fresh qualification,
  preserving the failed v11 outcome, older profiles and ordinary coding denial.
- Support the existing bounded setup-v5 profile in the native acceptance tool,
  preserving legacy limits and keeping probes separate from qualification.
- Cover latest-user prompt extraction and ASCII/multibyte UTF-8 size limits
  through the public prompt-feature boundary.
- Add a synthetic checked-feedback file example, separating offline check
  validation from applying feedback to consented retained history.
- Remove unused imports from private identity configuration and retained schema
  helpers, preserving configuration behavior, schema definitions and stored data.
- Add repository discovery metadata, documentation navigation, a first-contribution
  guide, component labels, maintainer information and contributor credits.
- Add a branded social-preview asset and public entry points for community work.

These changes do not publish a runtime or plugin release and do not expand
client, model or platform qualification. The source runtime version remains
defined in `pyproject.toml`; see the [versioning policy](docs/VERSIONING.md).

For earlier published versions, use
[GitHub releases](https://github.com/mehrdadxzaker/Koto/releases).
The [2.0 migration guide](docs/MIGRATION_2.md) describes the active source
product's breaking changes and retired surfaces. Older release descriptions
do not establish support for the current development line.
