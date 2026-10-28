# Proposed next milestone: Koto Session Workspace

Status: proposal following completed [CLI acceptance #543](https://github.com/mehrdadxzaker/Koto/issues/543).

Deliver the first Koto workspace UI as a locally installed VS Code extension.
Use a reusable presentation layer and a small editor adapter so a later
standalone Koto UI can consume the same application operations. VS Code is the
recommended first host; the roadmap has not previously committed to an IDE.

The user outcome is one complete project journey: choose an existing account or
optional local model, describe a goal, edit and approve a plan, supervise native
agents, review their changes, integrate an approved contribution, and return to
the saved session. Start with one local Git project and the existing supported
agent profiles.

## Deliverables

1. **Shared application operations.** Extract recent-session discovery, project
   selection and saved-build actions from the CLI into the core application
   layer. The CLI and extension read the same retained session records. Reuse
   the existing proposal revision, session lifecycle, review, integration and
   continuation APIs. Keep scheduling and workspace ownership in the core.
2. **Reusable workspace UI.** Show account/prerequisite readiness, the editable
   plan, agent activity and cleanup state, retained sessions, and contribution
   diffs. Use explicit launch and integration actions. Render unknown and
   unsupported states honestly, with keyboard access and editor theme support.
3. **VS Code host adapter.** Add commands, a workspace view, native diff views
   and one terminal per agent. Validate messages at the UI boundary; keep
   credentials, executable launch and review-token checks in the host/core.
   Forward native input and resize through the existing terminal session API.
   Preserve native sign-in and permission ownership.
4. **Installed delivery and lifecycle.** Produce an installable extension,
   document core/helper prerequisites and bind the shipped core version. Stop
   and await owned work on ordinary extension shutdown. Retain explicit cleanup
   uncertainty after a crash, along with the existing continuation/integration
   blocks.

The public API supports live control of sessions created by its caller and
retained inspection from disk. It does not expose cross-process live attachment
to a CLI-owned session. In this milestone, the extension owns the sessions it
launches; other sessions appear as retained history/status. A live-session broker
would require a separate ownership and protocol design.

## Delivery slices

1. Extract the shared application operations; open real retained sessions and
   diffs in a read-only editor view.
2. Add plan editing/approval, one owned live build, native terminal interaction,
   independent stop and explicit reviewed integration.
3. Add returning-session continuation and later contribution integration; finish
   packaging, accessibility and host-shutdown handling.

Use a named first acceptance host, preferably the existing Mac environment.
Extend supported IDE/OS claims only after observing those installed combinations.
Registry installation/onboarding acceptance is a prerequisite for binding the
extension to a released core package; publication is handled by its own release
transaction.

## Acceptance

- Install the extension and its declared core package outside the source
  checkout. Discover actual account, model and helper readiness, including a
  clear missing-prerequisite path.
- On a real project, edit a proposed plan and revalidate it before explicit
  launch. Run two actual supported agents with separate worktrees; demonstrate
  native input/resize and stopping one while the other continues useful work.
- Inspect actual diffs in the editor, reject a stale review token, and integrate
  the explicitly approved current contribution into the separate integration
  worktree. The original checkout remains under its owner's control.
- Reopen the project and select the same retained session. Resume the exact
  native identity where the profile supports it, then review/integrate only the
  new contribution. Show unsupported continuation explicitly.
- Verify ordinary shutdown cleans owned processes, terminals and listeners.
  Verify interrupted or unconfirmed cleanup is visible and blocks unsafe
  continuation/integration. Closing a view must not silently discard work.
- Read the same retained session through CLI and IDE without duplicate session
  state or competing live owners. Check keyboard navigation, themes and bounded
  output handling on the installed first host.

Record package/source versions, host, observed results and failures separately
from CI. Follow the repository's direct-observation policy; do not add automated
suites, fixture agents or benchmarks to satisfy this milestone.

## Later milestones

After this editor slice is accepted, add a standalone Koto UI host reusing the
presentation/application layers, then additional IDE adapters. Multi-window live
session ownership, remote workspaces and broader host distribution need their
own explicit contracts and acceptance.

References: [roadmap](ROADMAP.md), [architecture](ARCHITECTURE.md),
[scope](SCOPE.md), [public API](../src/core.d.ts),
[VS Code webviews](https://code.visualstudio.com/api/extension-guides/webview) and
[terminal API](https://code.visualstudio.com/api/references/vscode-api#Pseudoterminal).
