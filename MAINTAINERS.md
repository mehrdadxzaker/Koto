# Maintainers and project governance

[Mehrdad Zaker (@mehrdadxzaker)](https://github.com/mehrdadxzaker) is the current
maintainer and project owner. Community support and PR review are best effort;
there is no guaranteed response time. Use public issues and discussions for
non-sensitive work and [SECURITY.md](SECURITY.md) for private vulnerabilities.

## Ownership and review

The current maintainer coordinates all components; the labels below route work
by subject. They do not imply separate teams or implemented client support.

| Component | Starting points | Issue label |
| --- | --- | --- |
| Personal selection and scorecards | `hormuz/personal_selection.py`, [selection guide](docs/PERSONAL_MODEL_SELECTION.md) | `area:selection` |
| Local history and consent | `hormuz/local_history.py`, [history guide](docs/LOCAL_HISTORY.md) | `area:history` |
| Client connection and routing | `hormuz/connected_client.py`, [connection lifetime](docs/CONNECTED_CLIENT_LIFETIME.md) | `area:client` |
| Skills and agent installation | `skills/`, `plugin.json`, [installation guide](docs/AGENT_INSTALLATION.md) | `area:plugin` |
| Documentation and examples | `README.md`, `docs/` | `area:docs`, `documentation` |
| Tests, builds and CI | `tests/`, `tools/`, `.github/workflows/ci.yml` | `area:testing` |

Changes should fit the [product scope](docs/ROUTER_SCOPE.md) and one verifiable
issue outcome. Existing contract, privacy and qualification rules in
[CONTRIBUTING.md](CONTRIBUTING.md) apply. Required checks and technical-lead
review of the exact head must pass before merging; this page does not change
repository permissions or branch protections. A merged implementation is not
independent evidence of real-model quality or release qualification.

## Decisions and a larger role

Discuss major behavior, scope or compatibility changes in an issue before
implementation. Record accepted architectural decisions in `docs/decisions/`
with the evidence and migration boundary needed by reviewers. The project
owner resolves product-scope and release decisions.

Contributors can grow responsibility by making focused changes, reproducing
defects and reviewing work in an area over time. If you would like to maintain
a component, open a discussion describing the area and your contributions.
The current maintainer reviews the proposal and explicitly agrees any role
or access change. Contribution count does not automatically grant permissions.

See [contributor credits](CONTRIBUTORS.md) and the
[code of conduct](CODE_OF_CONDUCT.md).
