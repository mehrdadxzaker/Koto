# Security policy

Report vulnerabilities through GitHub's [private reporting form](https://github.com/mehrdadxzaker/Koto/security/advisories/new).
Include the package revision and a synthetic reproduction. Keep credentials,
private prompts, responses, workflows and raw logs out of public issues.

A workflow is executable configuration: running it starts the commands it names
with the current user's permissions and inherited environment. Koto does not
sandbox those workers. Review workflows before running them and use an isolated
environment for untrusted work. Validation checks the workflow structure; it
does not authorize or inspect the behavior of its commands.

Koto invokes executable arguments without a shell, transfers assignments through
stdin and bounds runtime and output. Lifecycle events contain metadata; the final
result includes worker output and must be handled as potentially private data.
Worker stderr is not copied into fixed runtime errors. Native agent permissions,
credentials and tool restrictions remain the responsibility of the worker and
its execution environment.

The initial core has no persistent transcript store, automatic retry or crash
replay. POSIX process workers clean their owned process group before settling,
including after a direct worker exits. Self-detached descendants outside that
group are not contained. Windows active cancellation uses best-effort
`taskkill`; descendant cleanup after a parent has exited is not guaranteed
without stronger OS job ownership. Workers must await or stop their children.
Custom JavaScript adapters must cooperate with their AbortSignal. Windows
command scripts require an executable or Node-script wrapper; Koto does not
turn on a shell to run them.

Experimental software has not received an independent security audit. See the
current [support boundaries](SUPPORT.md).
