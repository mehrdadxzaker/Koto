# Terminal UI acceptance record

## October 30 PR completion checkpoint

The installed private CLI candidate at
`7d7e5013b41ea7299358cd9c8414781ad411cf43` completed a fresh macOS ARM64
PTY journey using the existing ChatGPT subscription through the real Codex CLI.
The archive SHA-256 is
`a5f49c0aca64ba71518aa47e4afb5139f50ff19a26683eca5bfcbf903f91f5ad`;
all 62 shipped files matched that Git revision, archive and installation in
bytes and executable modes. This development archive retains the package's
alpha.3 version string; it is not the published alpha.3 release.

Starting with bare `koto` inside a project subdirectory discovered the project
and subscription, offered optional local models and configured one Codex
worker. After explicit plan approval, that worker made a one-line version-alias
change in a real Koto checkout. Guided review displayed the exact diff,
including JavaScript backticks; explicit contribution approval and merge
approval put the reviewed commit on the original project branch. The CLI
exited normally. A new bare `koto` process reopened saved work, continued the
same native conversation in the same worktree, and made a one-line help update.
The second review contained only that new change. Its approved merge reached
the original branch; the project, worker and integration worktrees were clean.
All three version aliases and the updated help were independently observed.

Session `s-mvv9hvba-adbcd774` retained native Codex conversation
`01a18de9-b0ea-7263-a3ed-61f760950322`. The native session ID, workspace,
origin, executable, account and adapter kind matched across the two successful
attempts. Approved original-branch commits were
`faa19be6e02274a9b78f6a517d6c61f8f3584454` and
`0de2463ded01340cfa70cd8aae39be280a91e12a`. Both CLI processes exited zero,
without cleanup signals, and their owned process groups were absent afterward.
Private raw transcripts, installed-file inventory, saved session snapshots and
manual Git/CLI observations retain these bindings.

Earlier observations remain separate: one candidate was cancelled before
worker launch after exposing an unwanted second default worker; another PTY
controller converted Enter into a draft newline until its outer terminal was
put in raw mode. A later candidate completed its first merge but exposed
Markdown parsing of literal diff backticks. Those records were preserved;
the successful journey above used the corrected candidate and controller.

The subsequent `0dd1b43` source change affects only native permission display
in `bin/chat.js` and `bin/project.js`: JSON escapes invisible controls, chat
prints the request literally, and an incomplete request cannot expose an
approval choice. It received independent source review and source/scope checks;
the installed journey above is not relabeled as runtime acceptance of this
later permission-display change. The candidate used no native permission
request. Earlier native approval observations below keep their original scope.

The final source also repairs the five PR review findings: inspection rejects
custom Git filters before status; model choices respect the coordinator
provider; skill identities include their discovery root; plain mode disables
animated build activity; local inspection prompts fit the adapter's actual
input budget. The scope check fingerprints all 54 immutable IDE archive entries
without requiring new source modules to exist in that older frozen archive.
Published archives and their distribution pins remain unchanged.

Repository instructions prohibit automated suites. Three subsequently added
TUI suite files and their npm test script were removed from the active tree;
their commits remain in Git history. No suite, fixture agent, benchmark or load
test was run during this completion. `npm run check` and manual product
observations are reported separately from exact-head and exact-main CI.
Linux/Windows native TUI, screen-reader software and final desktop GUI
acceptance have not been added by this checkpoint.

## October 28 component observations

October 28, 2026. The code snapshot for this record is
`bf3754a3491cbbe98f51eec60325e975dcb0549b`. This document records implementation
and particular observations; it is not itself a runtime test.

Koto implements the 24 terminal components below in the shared command-line
application. Actual acceptance used macOS ARM64, interactive PTYs, the unsigned
desktop terminal and real Codex sessions. Observations span several source
revisions; subsequent corrections and their negative evidence are retained
separately. A source check or package comparison does not repeat a native flow.

## Component observations

| # | Component | Actual observation | Boundary / remaining subpaths |
| --- | --- | --- | --- |
| 1 | Project inspection | Real Codex turns inspected bounded source excerpts, identified concrete source issues and answered a keyboard-controls question with file/line references. | Excerpt membership was checked; this is not semantic proof or a complete repository audit. Other providers were not exercised. |
| 2 | Visible modes | Inspect was selected through numbered choices; status reflected Inspect, Plan and Build during actual work. | Every mode-switch combination was not repeated. |
| 3 | Slash palette | Actual `/` menus, filtering, insertion and subsequent command submission were observed. | The initial fast-Enter race was corrected; alternate terminal key mappings remain separate. |
| 4 | Mention picker | Exact `@docs/TUI.md` selection was repeated after fixing ranking, then used in a real source-backed request. | Folder limits were exercised; filenames with spaces and every agent-reference variant were not. |
| 5 | Installed capabilities | `/installed` opened actual configured agent records and their unverified-readiness details. `/skills` filtered a discovered `repo-cartographer` skill and previewed its real metadata. A narrow terminal listed actual Codex/Claude connections and paged their details. | Native executable discovery is not inference acceptance. Model refresh and every installation source were not independently qualified. |
| 6 | Multiline composer | Actual multiline, bracketed-paste and Unicode drafts were captured; a multiline request was submitted. | Every terminal profile's Alt+Enter mapping and maximum-size paste were not exercised. |
| 7 | Argument completion | Command-specific completion is implemented; real command controls were submitted, including `/queue edit 1`. | A typed complete argument alone does not prove every argument-picker branch. Dedicated model/agent completion remains unobserved. |
| 8 | Context attachments | Ctrl+O previewed an unsent file excerpt with Right details. Removing it removed the mention and preserved prose. A 43-file folder exceeded the eight-item limit while preserving the prior reference and original draft. Explicit skill attachment changed the footer to one reference; `/context clear` returned it to zero. Plain mode also selected, printed and removed an actual file excerpt. | No hook or model call was needed for local preview. Context/approval ownership overlap is source-reviewed, not separately native-reproduced. |
| 9 | Persistent status | Project/branch, coordinator/default model, mode, references, queue count and running/pending counts were observed. | An unknown native default model is not presented as a known model identity. Offline/model-change transitions were not all repeated. |
| 10 | Agent activity | Actual coordinator and worker events showed working, responding, pending, approval-needed, approved, completed and finished states. | Activity and process liveness are not correctness verdicts or hidden reasoning disclosure. |
| 11 | Task tree | `/tasks` expanded actual running/pending tasks and paged through assignments, dependencies and workspace details. | Both tasks had no dependencies; a blocked dependency graph was not exercised. |
| 12 | Plan editor | Two real tasks were proposed; concurrency changed from two to one, the edit was validated, task editing was visited, and launch was explicitly approved. | Task removal and each invalid-plan rejection were not separately exercised. |
| 13 | Structured questions | Searchable keyboard choices were used for plans, retained sessions, context removal, skills and native approval. Numbered choices were used in plain mode. | Fresh account installation, login and model download/manual-GGUF setup were not rerun in this TUI acceptance. |
| 14 | Approval panels | The exact native `wc` request, cwd, reason, 60-second window and expiry were shown. A fresh request was explicitly approved once, completed, and reported 121 lines in `docs/TUI.md`. | The first request expired and was denied; it is retained as failed evidence. Persistent-policy amendments are not granted. |
| 15 | Diff viewer | Both actual worker contributions were expanded/scrolled, reviewed, and explicitly integrated in the retained integration workspace. | Oversized previews, binary-only changes, conflicts and stale-review rejection were not native-qualified by this small-diff run. Partial previews cannot authorize integration through the TUI. |
| 16 | Tool output | `/tools` expanded actual completed native command details; the resumed approval run recorded the approved command's completion. | Output-tail truncation and every filter/eviction boundary were not induced. |
| 17 | Response formatting | Real numbered/bulleted source-backed responses and wrapped plans/diffs were displayed; Unicode composition was observed. | Grapheme/truncation code was corrected after source findings. Pathological long output remains outside these bounded observations. |
| 18 | Follow-up queue | A follow-up was entered during planning, appeared as queued, and `/queue edit 1` restored that exact message as a draft without sending it automatically. | Explicit Send, Remove and Clear subpaths have not all been independently observed. |
| 19 | Session switcher | Actual retained work was searched, expanded, selected and resumed in the original worker workspace. | Missing/foreign-project shortcuts and every project-switch variant were not exercised. |
| 20 | History and search | Ctrl+R found actual retained prompts after restart; `/search context` opened results from the actual current-process transcript. | History opt-out/clear and every search filter were not separately repeated. No global assistant/tool transcript is automatically saved as prompt history. |
| 21 | Recovery guidance | A rejected 43-file context selection preserved valid state. A nonexistent project returned ENOENT guidance; `/status` confirmed the original project and zero references. `/retry` reported that no failed request existed. An expired approval was reported and a new explicit request succeeded. | Retrying an actual failed model request, credential reconnection, socket exhaustion and cleanup-uncertain recovery were not induced. |
| 22 | Completion summary | The actual goal, changed documentation paths, two worker outcomes, retained integration and observed command receipts were reported with explicit verification limits. | Agent success is not acceptance. No test-suite result was inferred or fabricated. |
| 23 | Contextual hints | Actual composer, menu, expanded-detail and approval hints matched the controls exercised, including Ctrl+O. | Alternate keyboard layouts and every host-specific shortcut remain separate observations. |
| 24 | Accessibility and fallback | Final TERM=dumb/plain mode kept empty Enter idle, selected numbered Inspect, previewed/removed context, preserved the project after an error, returned to Auto and exited zero. A 45-column/14-row terminal with NO_COLOR, ASCII borders and static activity showed the palette and paged connection details without overflow, then exited zero. Ctrl+C during context preview exited 130 and restored owned paste/raw/cursor state. | Actual screen-reader software and iTerm2/Terminal.app/Linux/Windows runs remain unobserved. |

## Real worker and permission receipts

Session `s-mvsn3i2n-51144c5e` ran two actual Codex workers at concurrency one.
`terminalDocs` owned `docs/TUI.md`; `desktopDocs` owned `docs/DESKTOP_UI.md`.
Both completed. Their displayed diffs were reviewed and explicitly integrated
as `e1cc4194f051ddb322b4005f96a9f1ab3dbd8c77` and
`861aa747a8e721192b449c1ea69333d0b95488cf`; the reviewed documentation landed
on this branch as `e157e4265c53f8fcaad9d2eb0a6460410ed43905` and
`8f33bbecf74d1857f2957f53c6bc79dc320535dd`.

The first resumed native approval waited 60.005 seconds and recorded
`approved: 0, denied: 1`; its command was not run. The deadline-aware repeat
was approved in 16.734 seconds, executed `/usr/bin/wc -l docs/TUI.md`, reported
121 lines, and recorded `approved: 1, denied: 0`. The first failure is not
reclassified as successful because the repeat passed.

## Corrections and delivery scope

Actual use exposed incorrect exact-mention ranking, fast-Enter timing,
empty plain-input text, startup/history handoff loss and an unclear native
approval deadline. Corrections are in `9e556f9`, `712d79a` and `499d98d`.
Draft-context ownership/cancellation and pre-send previews are in `bf3754a`.
Original transcripts, screenshot timing, previous package receipts and a
failure ledger are retained privately; bounded source findings are kept
distinct from reproduced runtime failures.

An unsigned Mac QA app has 61 core/resource files and six desktop payloads
compared byte-for-byte to the `bf3754a` code snapshot. Its desktop bundle is
separate from the npm package. A later documentation-only commit does not alter
those runtime files. Source/scope checks and exact-head CI are reported
separately from native observations.

The final GUI screenshot attempt was blocked because the Mac was locked and
the accessibility surface was unavailable. Earlier actual GUI screenshots and
menu/model observations remain evidence for their captured revisions; they are
not relabeled as a final `bf3754a` GUI runtime repeat. Final plain, narrow and
context interactions were captured in actual PTYs against the code snapshot.

No automated suite, simulated worker, fixture agent, load test or benchmark
was added or run for this acceptance. The work does not publish npm, tags,
signed/notarized desktop binaries or a cross-platform TUI release.

Koto's TUI uses standard terminal input and ANSI controls; no iTerm2 plugin is
required by the implementation. Native iTerm2 acceptance has not been observed.
See [terminal controls](TUI.md) and [desktop scope](DESKTOP_UI.md).
