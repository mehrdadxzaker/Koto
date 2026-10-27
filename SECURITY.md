# Security policy

Report vulnerabilities through GitHub's [private reporting form](https://github.com/mehrdadxzaker/Koto/security/advisories/new).
Include the package revision and a synthetic reproduction. Keep credentials,
private prompts, responses, workflows and raw logs out of public issues.

A workflow is executable configuration: running it starts the commands it names
with the current user's permissions and inherited environment. Koto does not
sandbox those workers. Review workflows before running them and use an isolated
environment for untrusted work. Validation checks the workflow structure; it
does not authorize or inspect the behavior of its commands.

Koto invokes executable arguments without a shell and bounds runtime and output.
Generic workflow assignments use stdin; their lifecycle events contain metadata
and their final results include potentially private worker output. Project
sessions run native clients through pipes or terminals and retain private event
logs containing their output. Fixed runtime errors do not copy worker stderr.
Native permissions, credentials and tool restrictions remain with the selected
client and its execution environment. A worktree or declared ownership path is
not a filesystem or network sandbox.

Generic workflow workers have no persistent transcript store. Project sessions
retain prompts, native output, native session IDs, worktree paths and attempt
outcomes locally. Treat those files as private; installation, uninstall and
routine session exit do not publish or automatically delete them. There is no
automatic retry or crash replay. Explicit native resume requires a captured
structured ID, matching retained origin and confirmed cleanup, and continues
that exact conversation. It never selects the latest session or reconstructs
provider history from a terminal screen. The origin binding does not snapshot
credentials, executable contents or external provider configuration.

POSIX pipe workers clean their owned process group before settling. macOS and
Linux PTY helpers supervise a separate session and bind cleanup metadata to its
owned identity. Descendants that detach from the owned group/session are outside
that boundary. Windows project sessions use an explicitly built helper with
Job Object ownership for both pipe and ConPTY workloads. A missing trusted final
cleanup record remains unconfirmed. Any retained unconfirmed project outcome
blocks resume and integration of every contribution.

The generic workflow process adapter is distinct from the project helper: its
Windows active cancellation uses best-effort `taskkill`, and descendant cleanup
after the direct parent exits is not guaranteed. Workers must await or stop their
children. Custom JavaScript adapters must cooperate with their AbortSignal.
Windows command scripts require an executable or Node-script wrapper; Koto does
not turn on a shell to run them.

Platform helpers are compiled only by an explicit build action using installed
tools. Installation and preflight do not download or compile anything. Source and
binary identities are checked before use, and build artifacts belong outside
project worktrees. These checks establish the selected artifact, not protection
against other code already running with the same user's authority.

Integration requires a fresh review token and settled process ownership. It
writes to the session integration worktree, preserving the original checkout.
Conflicts remain for manual review; acknowledging a resolution checks the exact
clean commit and retained history, not semantic correctness. Preserve interrupted
locks and ambiguous outcomes for explicit recovery instead of forcing a replay.

Experimental software has not received an independent security audit. See the
current [support boundaries](SUPPORT.md).
