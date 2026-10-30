# Koto in a terminal

Koto's command-line application includes a terminal user interface (TUI).
The composer, menus and review views belong to Koto itself, so the desktop
terminal and a standalone terminal use the same core and controls. No iTerm2
extension, terminal profile change or shell integration is required.

Use Node.js 22+ and open `koto` in an interactive terminal. From a source checkout,
`node bin/koto.js` opens the same application. An explicit project can be selected
with `koto start --project /absolute/project/path` or `/project PATH` inside Koto.

In an iTerm2 tab or window, launch the installed CLI:

```sh
koto
```

Or, from the root of a source checkout:

```sh
node bin/koto.js
```

## Input and menus

- Type `/` at the beginning of a prompt to browse commands. Continue typing to
  filter; use Up/Down, then Tab or Enter to insert the selected command. A second
  Enter submits the prompt. Escape closes the menu while preserving the draft.
- Type `@` at a word boundary to search actual project files and configured
  agents. Files with spaces use `@{path with spaces}`; agents use
  `@agent:AGENT_ID`. Folder completion narrows the file search. Mentioning an agent
  adds its context and does not start a worker.
- Ctrl+O previews selected file context before sending and lets you remove an
  attachment without losing the draft. Removing a referenced file also removes
  its mention token. `/context` previews or clears retained context afterward.
  Plain mode supports `/context add PATH` to select and preview a file before
  sending any model request; `/context add agent:ID` selects a configured agent.
- Ctrl+J or Alt+Enter inserts a newline. Bracketed paste retains pasted newlines
  in one draft. Enter sends the completed prompt.
- Ctrl+R searches this project's prompt history. Up/Down navigate choices;
  Escape dismisses the search. `/history` opens the history picker and
  `/history clear` removes the saved prompt history for the selected project.
- In lists, type to filter, use Up/Down to select, Right to expand details,
  Left to collapse, PageUp/PageDown to scroll, and Escape to return.
- While a coordinator turn runs, Enter queues a follow-up. `/queue` shows it;
  edit, remove or explicitly send the queued message after the turn. `/stop`
  stops the active turn. Ctrl+C stops active work; when idle it exits Koto.
- Native agent attachment keeps that client's own terminal controls. Ctrl+]
  detaches back to Koto without silently stopping the native agent.

## Project questions and authority

In Auto mode, questions about the selected project request bounded read-only
inspection and source-backed findings. `/inspect QUESTION` requests inspection
explicitly. The inspection summary identifies files and line ranges supplied
to the coordinator, truncation and citation validation. It does not establish
runtime acceptance or prove every file has been reviewed.

`/mode` selects Auto, Ask, Inspect, Plan or Build. Ask is discussion; Plan prepares
an editable proposal; Build still requires explicit approval before launching
workers. Plans retain their validated ownership and dependency rules. A file,
folder, agent or skill attachment never grants additional execution authority.

`/installed` browses actual agents, model choices, skills and connections.
`/installed refresh` explicitly checks running loopback model metadata. Installed,
configured, retained and ready are distinct states; model listing and a native
login alone do not establish successful inference or coding ability.

Skills come from supported project and native-provider skill directories.
Discovery reads bounded metadata and never runs skill commands or hooks. A cache
entry is not treated as proof that a plugin is enabled. `/skills` explicitly
selects a discovered skill, previews it and lets the user attach it as context.

## Available components

| Component | Surface |
| --- | --- |
| 1. Project inspection | Natural project questions and `/inspect` |
| 2. Visible modes | `/mode`, status line |
| 3. Command palette | `/` |
| 4. Mention picker | `@` |
| 5. Installed capabilities | `/installed`, `/models`, `/skills`, `/accounts` |
| 6. Multiline composer | Ctrl+J, Alt+Enter, bracketed paste |
| 7. Argument completion | Command-specific suggestions after a space |
| 8. Context attachments | `@`, Ctrl+O before sending, `/skills`, `/context` preview/remove/clear |
| 9. Persistent status | Selected project/branch, mode, coordinator/model and context |
| 10. Agent activity | Activity indicators and `/activity` |
| 11. Task tree | `/tasks`, retained statuses and dependencies |
| 12. Plan editor | Task selection, assignment/ownership/dependency edits, explicit approval |
| 13. Structured questions | Keyboard choices for setup, models and workflow decisions |
| 14. Approval panels | Exact native request details and explicit one-action decision |
| 15. Diff viewer | `/diff`, `/review`, file list with expanded diff |
| 16. Collapsible tool output | `/tools`, actual bounded tool records |
| 17. Response formatting | Headings, lists, code and word wrapping |
| 18. Follow-up queue | `/queue`, draft editing, removal and explicit send |
| 19. Session switcher | `/sessions`, saved project/goal/state preview |
| 20. History and search | Ctrl+R, `/history`, `/search` |
| 21. Recovery guidance | Errors, `/retry`, account/model/setup actions |
| 22. Completion summary | Actual task outcomes, changed files and verification limits |
| 23. Contextual hints | Footer/list controls and `/help` |
| 24. Accessibility | Plain output, no-color, ASCII input chrome and reduced animation |

## Terminal compatibility and local state

The interactive renderer uses standard terminal input and ANSI cursor control.
It restores owned raw-input, paste and cursor state on exit. Compatibility must
be observed in each host; source support alone is not a native-terminal result.
The terminal behavior described here is supported by Koto's shared TUI;
native iTerm2 acceptance has not yet been observed. These launch examples do
not establish runtime verification in iTerm2.

Use `KOTO_PLAIN=1 koto` or `KOTO_SCREEN_READER=1 koto` for ordinary line output and
numbered choices. `TERM=dumb` also selects plain input. `NO_COLOR=1` removes color;
`KOTO_ASCII=1` selects ASCII input borders; `KOTO_NO_ANIMATION=1` selects static
activity indicators. `/accessibility` changes the available presentation options.

Prompt history is local, bounded and stored separately for each canonical
project under Koto's private state directory. Setup answers, credentials and
approval decisions are excluded by the caller. It does not save a global
assistant/tool transcript. `KOTO_NO_HISTORY=1` disables history file reads/writes;
it does not delete prior saved history. `/history clear` removes that project's
saved prompts. The current-process transcript and tool views are bounded in
memory.

The GUI sidebar is optional. It navigates around the same terminal workflow;
these interactions do not require browser overlays or a second agent runtime.
