# Migration to the npm core

This development line replaces the earlier Python router product with a Node.js
orchestration core and npm/npx CLI distribution. It is a breaking product change;
the old Python configuration, router commands, skills manifests and model
qualification receipts are not inputs to the new workflow format.

The old active source is recoverable at Git commit
`bd63aabc79fba779a60a6172f0adbab4acbaa29d`. Earlier evidence, campaigns and release
descriptions remain in Git history and published releases rather than an archive
inside this repository. Old architecture restrictions are superseded by the
current [product scope](SCOPE.md).

Repository cleanup does not uninstall an existing Python installation, stop its
processes, edit IDE/client settings, delete user models or data, or retire remote
resources. Use the version that owns an existing installation to disconnect it
before uninstalling it. Keep old configuration and data private if needed for
rollback. The new CLI does not inspect or migrate that state automatically.

Install the new local npm package and verify `koto --version`. Python and npm
versions may both provide a command named `koto`; remove the old command or
adjust PATH deliberately. The npm version is `3.0.0-alpha.0` and the old Python
line is `2.0.0a52`.

IDE plugins, native-agent adapters and Koto's UI will be delivered against the
new core. Earlier skills-only packages do not establish those integrations.
