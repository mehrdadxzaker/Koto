# Koto documentation

Koto is experimental local model selection for existing coding clients. It
learns from separately consented, checked task history and considers the user's
selected commercial model alongside qualified local alternatives. Codex is the
first implemented routing connection. The [support matrix](../SUPPORT.md)
defines the current evidence and version boundaries.

## Start here

| Goal | Guide |
| --- | --- |
| Understand the product and its limits | [Product scope](ROUTER_SCOPE.md) and [README](../README.md) |
| Install the shared runtime directly or through a plugin | [Installation and platforms](INSTALLATION.md) |
| Install the skills plugin | [Agent installation and compatibility](AGENT_INSTALLATION.md) |
| Understand history, learning and selection | [Personal model selection](PERSONAL_MODEL_SELECTION.md) |
| Use an explicitly launched native Codex session | [Native personal sessions](NATIVE_PERSONAL_SESSIONS.md) |
| Explicitly run an experimental native coding task in a chosen workspace | [Native coding sessions](NATIVE_CODING_SESSIONS.md) |
| Inspect setup and safe restoration | [Shared local setup](SHARED_LOCAL_SETUP.md) and [connection lifetime](CONNECTED_CLIENT_LIFETIME.md) |
| Review retained history and privacy controls | [Local history](LOCAL_HISTORY.md) |
| Understand local-model qualification | [Route admission](LOCAL_ROUTE_ADMISSION.md) and [bounded coding probes](BOUNDED_CODING_PROBES.md) |
| Migrate an existing installation | [2.0 migration](MIGRATION_2.md) and [Koto migration notes](KOTO_REBRAND.md) |
| Make a first contribution | [First-contribution guide](FIRST_CONTRIBUTION.md) |
| Find work and its acceptance gates | [Roadmap](ROADMAP.md) |
| Understand versions and prepare a release | [Versioning](VERSIONING.md) and [releasing](RELEASING.md) |

Plugin installation is separate from routing support. Installation does not
start a router, fetch a model or qualify a local coding route. Learning starts
in observation mode; automatic selection needs validation. Synthetic fixtures
prove behavior under test, not real-model quality or provider/account access.

For questions, use [Discussions](https://github.com/mehrdadxzaker/Koto/discussions).
Report reproducible defects through the [issue chooser](https://github.com/mehrdadxzaker/Koto/issues/new/choose).
Use the [private security path](../SECURITY.md) for vulnerabilities.
