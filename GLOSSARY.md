# Domain terms

- **Core:** Shared task coordination, worker lifecycle, handoffs and results.
- **Agent:** Runtime with instructions, tools, context, permissions and session
  state. Its model is one component of its execution.
- **Model:** Inference engine accessed through a local runtime or provider.
- **Worker adapter:** Connects an agent runtime to a core assignment and reports
  results and lifecycle state.
- **Worker lifetime:** The interval from starting owned work until its execution,
  communication and owned-process cleanup have settled.
- **Contribution:** An agent's changes offered for review and integration into
  the shared result.
- **Integration attempt:** One explicitly approved effort to apply a reviewed
  contribution, including its retained outcome or unresolved state.
- **Reconciliation:** Explicit review of an unresolved integration attempt to
  acknowledge its observed outcome without repeating the work.
- **Delivery adapter:** Exposes the core inside a CLI, IDE plugin or Koto UI.
- **Workflow:** Explicit goal, agent registry, dependent tasks and resource bounds.
- **Handoff:** Output from a declared dependency passed to a downstream worker.
- **Acceptance check:** Independent evidence that the requested result is correct;
  a successful process exit alone does not supply it.
