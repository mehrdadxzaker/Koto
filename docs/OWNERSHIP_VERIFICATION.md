# Worker ownership and contribution recovery observations

Observed on macOS arm64 with Node 25.2.1 on 2026-10-27, using the refactor based
on PR #615 at `3d0cf8862923d43a31db633b731e37545eacde1e`.
These are direct operations on real shells, Git and the actual changed source.
No automated suites, fixture agents, model requests or benchmark campaign ran.

## Worker lifetime

- Two Bash pipe sessions accepted input. Stopping one left the other able to
  run Git and exit. Both direct process IDs disappeared.
- The current Mac native helper built with the installed Apple toolchain. Two
  Bash PTYs accepted input and resize; stopping one preserved its peer. Both
  workloads disappeared and helper cleanup was confirmed.
- An initial pipe cancellation returned `cleanup_unconfirmed`: a group probe
  returned `EPERM`, followed by `ESRCH`. This occurred outside the sandbox too.
  The owner now treats an inconclusive probe as pending within its existing
  deadline and accepts only positive disappearance evidence. The follow-up
  cancellation confirmed cleanup; an actual sleep deadline returned `timeout`
  with confirmed cleanup. The earlier negative observation was retained.
- The strict JSON worker adapter ran actual `git diff --stat` over this refactor,
  returned its text and settled after cleanup.

These observations do not establish Windows or Linux runtime behavior, native
model task quality, or cleanup of descendants that escape the owned group/session.
Invalid native helper evidence and absent Windows direct-pipe ownership remain
unconfirmed; a kill signal alone does not qualify cleanup.

## Approved contribution

A disposable checkout of the actual Koto base supplied the project. A source
worker checked the refactored JavaScript, and the real source edits were reviewed
through the project API. Original project content remained unchanged.

- Making only the retained session record immutable let Git integration finish
  but prevented recording its result. The pending attempt survived, the saved
  session still lacked its receipt, and another integration was blocked.
- A subsequent actual source edit invalidated the earlier reconciliation token.
  Fresh explicit `record-result` approval saved the validated receipt, archived
  the attempt and cleared the marker. Integration HEAD did not move. The new
  source edit remained as the next contribution delta.
- Making that owned source index immutable prevented the next Git apply. The
  target stayed unchanged. Explicit `not-applied` reconciliation preserved the
  source edits; a new review and approval then integrated only that delta.
- All temporary immutable flags were cleared in `finally` blocks, and all
  started worker handles were stopped and awaited. Evidence and worktrees were
  retained for inspection.

Reconciliation does not make Git and JSON one transaction. A pre-intent lease
crash, a crashed reconciliation lease, or a changed target without a valid
receipt still requires explicit manual investigation. See
[project reconciliation](PROJECT_SESSIONS.md#reconcile-an-interrupted-integration).
