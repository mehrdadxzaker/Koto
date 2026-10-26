# Releasing Koto

Koto's current router is an experimental 2.0 development line. The last legacy
Hormuz stable release, `v1.8.0`, includes retired desktop products; it is not the
current router distribution. The runtime and skills plugin have independent
versions, defined by the [versioning policy](VERSIONING.md).

## Current acceptance

Source delivery and passing CI do not complete the product contract.
[#543](https://github.com/mehrdadxzaker/Koto/issues/543) still requires a complete
passing local coding setup, separately consented representative checked history,
held-out selection benefit and actual supported provider/client/plugin/fresh-user
operation. Native subscription sessions include fresh read-only text and
experimental [workspace-scoped coding](NATIVE_CODING_SESSIONS.md). The coding
command still requires real-host enforcement and exact client/model qualification
before it can establish the complete coding journey.
[#536](https://github.com/mehrdadxzaker/Koto/issues/536) coordinates completion
and [#523](https://github.com/mehrdadxzaker/Koto/issues/523) remains the product
epic. Preserve failed and unrun observations and their consumed budgets.

The owner retained the full contract and held publication until remaining issues
and checks pass. An alpha label or a candidate bundle does not bypass that hold.

## Prepare one source revision

Choose the affected component and inspect its identity:

```sh
python tools/version.py check
python tools/release.py plan runtime
python tools/release.py plan plugin
```

When preparing a release, use the version tool's dry run, review the appropriate
compatibility change, then apply it in a PR. Do not change historical versions,
qualification profiles or schema versions as part of a release-number bump.
Keep the changelog's Unreleased section current with behavior and limitations.
Follow [contributing](../CONTRIBUTING.md) for review and installed-wheel checks.

The **Release candidate** workflow accepts a component and a successful full CI
push-run ID. It runs on `main`, checks the exact source commit, repository,
workflow, full Python 3.11–3.14 matrix, build and protected `CI / required` result.
Focused draft checks cannot supply release evidence. Runtime candidates reuse
the already tested CI wheel and sdist; the workflow does not rebuild them.
Plugin candidates package tracked skills and their documentation from that same
source revision. The workflow has read-only repository permissions and uploads
candidates; it creates no tag or release.

For local inspection, start with a committed source tree and the distributions
from its accepted CI run:

```sh
python tools/release.py prepare runtime --artifacts dist --notes CHANGELOG.md --output /tmp/koto-runtime-candidate
python tools/release.py verify /tmp/koto-runtime-candidate
python tools/release.py prepare plugin --notes CHANGELOG.md --output /tmp/koto-plugin-candidate
python tools/release.py verify /tmp/koto-plugin-candidate
```

Output directories must be new. Preparation rejects tracked source changes and
leaves existing output untouched. The candidate contains distribution files,
release notes, `manifest.json` and `SHA256SUMS`. The versioned manifest records
component/version/channel/tag, the source commit and artifact sizes and hashes.
All candidates explicitly retain `publishing_approved: false`.

Candidate verification checks consistency and integrity without importing package
code or extracting archive members. A checksum detects changes relative to the
manifest; it is not a publisher signature, an independent build attestation,
proof of model quality or authorization to publish. Retain the workflow's
separate CI evidence alongside the candidate.

## Skills distribution and future marketplaces

The plugin ZIP preserves existing portable and host manifests, license, skills,
icons and referenced documentation. Its inventory binds the plugin and runtime
versions, source commit and packaged file hashes. It contains no bundled router,
model weights or executable activation wiring. Repository-source links that
cannot travel with a skills-only package point to the immutable source revision.

This is a portable distribution artifact for review and future registry adapters.
Actual marketplace submission, discovery, permission review, signatures and
install verification depend on the chosen marketplace. Trading, payments and
agent-to-agent execution are not implemented by the package format. A marketplace
entry must distinguish loading instructions from routing/model support and must
preserve the CLI's consent and qualification boundaries.

## Promote the reviewed bytes

After the full issue contract, exact-source review, technical-lead sign-off,
required main CI, package checks and supported installation evidence pass:

1. Verify the retained candidate and its CI evidence again. Check that the
   version/tag is unused and the changelog matches the candidate.
2. Create the planned immutable tag on the candidate's source commit, using the
   repository's existing owner/tag rules. Independent plugin tags use `plugin-v`.
   The declarative tag-policy files cover both streams; review and reconcile
   live policy before relying on a new prefix. Candidate tooling never changes
   live protections.
3. Create a draft GitHub release with the candidate's existing artifacts,
   `manifest.json`, notes and checksums. Use the plan's `github_prerelease` and
   `make_latest` values.
   Verify tag, source, asset bytes and support claims before publication.
4. Publish that reviewed draft only after the retained publication hold is
   satisfied. Register a package or marketplace artifact separately when that
   destination and its authorization are established.

Do not overwrite published assets or move a version tag. Fix a defect in a new
version and document the migration or rollback. Disconnect with the owning
runtime before downgrade; retain user configuration, history and model assets
according to the existing removal guidance.

## Maintainer-tool contracts and rollback

Release plans, candidates, plugin inventories and CI verification results use
versioned Koto schemas. These are maintainer artifacts, separate from runtime
configuration, installed qualification and user history. Unsupported schema
versions are rejected. Regenerate a candidate after changing its source or
format; never relabel existing evidence. Removing these source tools and the
candidate workflow restores the previous manual release process without a
runtime or user-data migration. Keep previously published records intact.

Synthetic frozen compatibility fixtures preserve the accepted
[candidate](../tests/fixtures/release-candidate-v1.json),
[plugin inventory](../tests/fixtures/plugin-bundle-v1.json) and
[CI result](../tests/fixtures/release-ci-v1.json) contracts. The verifier tests
read the frozen candidates independently of the current candidate writers.
