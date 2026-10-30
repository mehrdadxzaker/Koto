# Everyday Codex CLI verification

Observed on October 29, 2026 on macOS ARM64 with Node 24.22.2. This record
qualifies the unreleased `3.0.0-alpha.2` CLI candidate. The public npm,
Homebrew and Linux installations still select `3.0.0-alpha.1`.

## Reproduced friction and fixes

| Actual command or journey | Before | After |
| --- | --- | --- |
| Return with Codex coordinator and a saved local worker | `Starting local model Qwen3 4B…` before `You>` | Codex prompt without starting the model |
| `koto --help` | Everyday conversational controls were absent | `/help`, build, saved work, review, integration, resume, accounts and optional models are discoverable |
| `koto project status ABSENT_SESSION` | Exit 2 with only `{"error":"koto_command_failed"}` | Exit 2 with `project_session_not_found`, a static explanation, the requested directory and recovery guidance |

The startup and missing-session reproductions each completed in under a second.
Removing the local worker or the legacy managed-model binding removed the startup
symptom, while the download inventory could remain. Source inspection confirmed
that startup used the configured worker list and managed-model binding
as its trigger. Runtime startup now follows local intent: explicit local
coordination, an approved plan containing local work, or a local continuation.

Missing-session diagnosis separately ruled out terminal formatting and a general
loss of all project errors. The identical request in a TTY was opaque, while an
unknown-agent request retained its typed error. Only `ENOENT` for the requested
session's exact `project-session.json` is classified. The final candidate kept
real valid-status output and unrelated unknown-agent output byte-identical.
Other filesystem and native error details remain private.

Review caught two follow-on risks: explicit local-coordinator selection needed
its own startup path, and a saved local task must not load a different selected
model. The first was reproduced as `local_agent_request_failed` after `/agent
local`; the fixed selection loaded the cached model and answered `ready`.
Approved and retained agents keep their exact model and endpoint. Lazy startup
does not rebind unrelated local workers; explicit model selection owns rebinding.

## Real project journey

A clean clone of Koto at `09bbb8d811bb698710c8b39712d5d4f4f76bbb75`
was used as the actual project. A freshly packed candidate was installed into a
private npm prefix, and all 51 runtime files and their modes were compared with
the source. Existing native ChatGPT authorization was discovered automatically;
no provider API key was supplied or authentication file copied. Optional model
download was declined during fresh onboarding.

The final candidate completed this journey:

1. Open `koto`, select the discovered ChatGPT account and the real project.
2. Request one Codex task to improve the project's actual `bin/koto.js` help.
   Review the proposed single-task plan and type `build`.
3. Use `:review improveTopLevelHelp` to inspect the help-only contribution,
   then `:integrate improveTopLevelHelp` to approve it.
4. Run the resulting project's `node bin/koto.js --help` from the integration
   workspace and inspect the actual output.
5. Exit with `:quit`, then `/quit`, and restart the installed CLI.
6. Use `/sessions`, `/review improveTopLevelHelp` and `/resume improveTopLevelHelp`.
   Request a one-line clarification of the help already written, then type
   `start` after reviewing the continuation.
7. Review the incremental one-line diff and explicitly integrate it.

Both native turns succeeded. The recorded native conversation ID and worker
workspace were unchanged across the restart. The second review contained only
the change since the first integration. Both contributions touched only
`bin/koto.js`; the resulting integration workspace was clean, and the original
project remained clean. This verifies this bounded code contribution and
continuation, rather than inferring correctness from a process exit.

For the returning run, genuine saved local-model configuration and cached assets
from the prior real workflow were copied into the private profile alongside the
new native session. Returning, saved-work review and Codex continuation did not
start that model. An independent process readback during review found no cached
runtime process. This was saved-configuration reuse, not a new download test.

## Local work and lifecycle controls

The same final candidate used the existing Qwen3 4B cache and llama.cpp runtime:

- Explicit `/agent local` loaded the model, completed a bounded read-only
  conversational request and exited ordinarily with code 0.
- A proposed local README inspection was canceled. The model remained stopped.
- Approving a subsequent single-local-task plan started the matching model
  after approval. Its `read_file` tool read the real README; it correctly reported
  Koto's name and coordinated-coding purpose within the requested word limit.
  The contribution review showed no file changes.
- Ordinary quit stopped the owned runtime; an independent process readback
  confirmed its absence.

A cold local continuation loaded the original model and preserved its conversation
ID, exact endpoint and worktree. Its factual answer failed: it claimed the project
was "TaskManager" rather than Koto. The saved continuation after that answer
contained only the latest turn; this observation does not establish why the
earlier factual context was absent. Runtime/session continuity is therefore
recorded separately from unsuccessful factual recall. The original wrong answer
is retained, and the successful first inspection does not erase it.
A further short recall probe was explicitly stopped while awaiting a response;
its recorded cancellation is not a successful continuation result.
Final ordinary quit returned code 0. A separate process readback found no owned
CLI, worker or cached model-runtime processes remaining.

## Evidence boundaries

The native journey used the private archive with SHA-256
`63d0488aa9655b4a5a5444867fb5a67cd4c3cce59979ea20bbee26f180b49858`.
The final documentation-inclusive archive is identified separately below. Its
only changed payloads are the English and Persian READMEs; all 51 runtime files
and modes remain identical to the native-verified package and current source.
Its SHA-256 is
`38e0e3c338ea361647d925e2400385b175398612ef403bb91d9a631d01f287db`.
Fresh onboarding was repeated from that final archive in a new empty private
state directory and completed with ordinary exit 0.
Private transcripts preserve command inputs, outputs, lifecycle receipts,
original negative controls and native ID comparisons without publishing account
credentials. An earlier candidate's separate coding observation is retained but
does not substitute for this final candidate's native journey.

Two private-controller mistakes were retained: consuming a project prompt before
waiting for it, and expecting `Koto:` instead of the actual `Koto>` response.
Corrected runs used fresh onboarding state or the same real cached model and
completed ordinarily; neither controller error is presented as a Koto failure.

Per repository policy, no automated suites, fixture demos or benchmarks were
added or run. Regression feedback used actual bounded CLI invocations, followed
by `npm run check`, diff review and independent source/package review. Temporary
controllers and receipts remain in a private, clearly marked debug directory.

This does not establish general coding quality, live Claude use, a fresh model
download, a two-model mismatch scenario, or native Linux/Windows behavior for
these changes. Those platform and release gates remain separate from this Mac
candidate observation. UI and IDE runtimes were not changed by this work.
