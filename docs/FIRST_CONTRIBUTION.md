# Your first Koto contribution

You can help with documentation, synthetic bug reproductions, tests or code.
Routine development checks need no model-provider account, paid inference or
model download. Installing Python dependencies may require Internet access.
Koto is experimental; read the [support boundaries](../SUPPORT.md) before
describing an environment or model as supported.

## Choose one small task

Browse [good first issues](https://github.com/mehrdadxzaker/Koto/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
or [help wanted](https://github.com/mehrdadxzaker/Koto/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22help%20wanted%22).
Read the starting files and acceptance criteria. Leave a comment if you want
to work on an issue so others can see it is in progress. For a small typo fix,
a focused PR is enough; discuss larger ideas before implementation.

Useful first changes include clarifying a command in a guide, improving a
synthetic reproduction, or adding a missing input case to an existing public
validation test. A new client adapter or real-model qualification campaign
needs separate scope and evidence; it is not a routine first task.

## Set up a checkout

Use CPython 3.11–3.14 and a POSIX shell. Fork the repository on GitHub if you
do not have push access, clone your fork and enter its directory. Contributors
with push access can clone the upstream repository:

```sh
git clone https://github.com/mehrdadxzaker/Koto.git koto
cd koto
git switch -c docs/my-first-contribution
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --editable .
python -m koto --help
```

If you already have a dirty checkout, use a separate checkout or worktree and
keep unrelated work intact. The example branch name can describe your change.
This setup does not connect to or modify your active coding client.

## Make a change and check it

For a documentation correction, edit the nearest guide, then check local links
and source scope:

```sh
python tools/verify_router_scope.py
python tools/version.py check
git diff --check
```

For a small classifier validation change, begin with its existing fast tests:

```sh
python -m unittest tests.test_personal_selection_fast -v
```

That module uses synthetic inputs and no network, models or subprocesses.
Workflow tests may start bounded disposable loopback servers and processes;
they do not need real model providers. Follow [CONTRIBUTING.md](../CONTRIBUTING.md)
to choose the affected test module and run final installed-wheel verification
for behavior or packaging changes. Do not connect your personal client or
enable retained history just to make a documentation change.

## Open a pull request

Commit the focused change and push your branch to your fork or the upstream
repository you can access. Open a PR against `main` and fill in the template:
link the issue, describe the resulting behavior, list exact checks and results,
and state any unverified platform/model behavior. Use a draft while work or
checks remain unfinished. Maintainers review the exact commit before merge;
response times are best effort.

Use synthetic values in public reports. Never attach real credentials, retained
conversations, private configs or databases. See [SECURITY.md](../SECURITY.md)
for private reports and [MAINTAINERS.md](../MAINTAINERS.md) for review ownership.
You may add your preferred public name or handle to
[CONTRIBUTORS.md](../CONTRIBUTORS.md) for code, docs, testing or review work.
