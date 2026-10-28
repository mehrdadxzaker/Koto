# Selected milestone: Koto sidebar and terminal

The first UI is a standalone desktop window with a left project/session sidebar
and one interactive Koto CLI. The user selected this smaller surface after the
Orca review. It supersedes the earlier proposal to build a VS Code workspace
view first. IDE plugins remain later delivery hosts for the same core.

The CLI remains the coordinator. Its existing commands own setup, optional local
models, editable plans, explicit launch approval, isolated agent worktrees,
native terminal attachment, contribution review, approved integration and saved
work. The desktop provides navigation and an interactive terminal around that
journey; it does not introduce another scheduler or agent protocol.

## Deliverables

1. **Desktop host.** Run the real CLI through the matching owned native terminal
   helper. Keep a single live CLI owner, validate the renderer bridge, and await
   cleanup before switching projects or closing the window. Show cleanup
   uncertainty and block replacement when cleanup is unconfirmed.
2. **Sidebar.** Open an existing project through the native folder picker and
   show actual known projects and retained session shortcuts. Selecting saved
   work never launches, resumes or integrates an agent automatically.
3. **Terminal presentation.** Add compact provider glyphs, readable activity
   labels and bounded animated spinners to the existing CLI activity view.
   Distinguish response, command/tool, approval and unknown native activity.
   Support plain output, no-color and reduced-motion modes, and preserve native
   terminal attachment and input ownership.
4. **Installed preview.** Build the desktop with its exact core/CLI sources and
   keep desktop dependencies separate from the dependency-free npm core.
   Document native helper prerequisites and source/package identities.

The desktop owns only the CLI it launches. Cross-process attachment to an
unrelated CLI, concurrent live workspaces, separate agent pane grids, a visual
plan editor, built-in code/diff editors, remote/mobile access and automatic
updates are outside this first selected interface.

## Acceptance

Start with the existing Mac environment. Record actual observations separately
from source/CI checks:

- Open the built desktop outside its source folder and operate its real CLI.
- Select a real project and verify native keyboard input, pane resize and focus.
- Complete or reuse actual account setup without copying provider credentials.
- Observe a real coordinator response with the provider identity and activity
  indicators; preserve unobserved states rather than inventing thinking.
- Exercise sidebar selection and retained history with the existing explicit
  CLI review/resume controls. Saved selection must not start workers.
- Verify no-color/reduced-motion behavior, narrow-window navigation, keyboard
  access and clear prerequisite/error states.
- Close or stop the owned CLI and independently check process/helper cleanup.
  Record any interrupted or unconfirmed outcome without treating it as success.
- Confirm the built app contains the exact reviewed core/CLI bytes and that npm
  installation/publication remains its own versioned release transaction.

Follow the repository's direct-observation policy. Do not add automated suites,
fixture agents or benchmarks to satisfy this milestone. A source preview is not
a signed/notarized or cross-platform desktop release.

## Later delivery

After this interface is accepted, add IDE hosts and richer views only where they
improve the same workflow. Shared application operations should remain in the
core; host adapters own their window/editor/terminal presentation. A future live
session broker needs an explicit ownership and reconnection contract.

See [desktop use](DESKTOP_UI.md), [roadmap](ROADMAP.md),
[architecture](ARCHITECTURE.md) and [public API](../src/core.d.ts).
