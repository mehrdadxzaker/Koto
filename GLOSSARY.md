# Domain terms

- **Core:** Shared task coordination, worker lifecycle, handoffs and results.
- **Agent:** Runtime with instructions, tools, context, permissions and session
  state. Its model is one component of its execution.
- **Model:** Inference engine accessed through a local runtime or provider.
- **Worker adapter:** Connects an agent runtime to a core assignment and reports
  results and lifecycle state.
- **Delivery adapter:** Exposes the core inside a CLI, IDE plugin or Koto UI.
- **Workflow:** Explicit goal, agent registry, dependent tasks and resource bounds.
- **Handoff:** Output from a declared dependency passed to a downstream worker.
- **Acceptance check:** Independent evidence that the requested result is correct;
  a successful process exit alone does not supply it.
