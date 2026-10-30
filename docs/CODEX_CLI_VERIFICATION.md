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

The initial native-qualified candidate completed this journey:

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

That candidate used the existing Qwen3 4B cache and llama.cpp runtime:

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
Its ordinary quit returned code 0. A separate process readback found no owned
CLI, worker or cached model-runtime processes remaining.

## Existing Ollama correction and final candidate

Review found a protocol mistake in the new external-worker readiness path:
it required llama.cpp's `/health` response from an Ollama server. Actual discovery
could add the model, but approving its task then incorrectly reported that the
original model was unavailable. The real CLI reproduced this in 11.148 seconds,
then 4.907 seconds with discovery omitted. A valid inspection-task version
reproduced it in 6.535 seconds. The same server returned `/health` 404 while
`/api/tags` and `/v1/models` returned 200 with the exact requested model.

The correction uses one bounded, loopback-only model-list request for an already
configured server. It preserves the exact approved model/endpoint, the existing
public API and declarations, and the strict health check for Koto-owned llama.cpp
startup. The common model-list route is part of
[Ollama's documented compatibility API](https://docs.ollama.com/api/openai-compatibility).

The final packed candidate was freshly installed and onboarded again. The same
Codex worker completed a third coding turn in its original conversation and
worktree, refining one `/accounts` help line. The incremental diff was reviewed
and integrated explicitly. Both managed and Ollama worker configurations were
remembered; no managed local runtime started for Codex use. The original project
and reviewed integration remained clean, with changes confined to `bin/koto.js`.

For the actual Ollama feedback, the Mac CLI used Ollama `0.40.13` on Linux ARM64
in a temporary local Docker VM container. It imported the already cached Qwen3
4B GGUF; no model was downloaded. The corrected CLI completed the same valid
read-only task: native `read_file` inspection, final `ready`, exact original model
`koto-cli-verification:latest` and endpoint `http://127.0.0.1:11434/v1`, ordinary
exit 0. All configured worker model/endpoint pairs stayed unchanged, and the
inspection worktree was clean. This bounded CPU observation took 122.806 seconds;
it is not a performance benchmark or general model-quality claim.

An earlier response-only probe forbade the native inspection required by coding
workers. Although its model returned `ready`, Koto rejected it with
`local_agent_required_inspection_missing`; that failed probe is preserved and is
not counted as successful worker use. The valid inspection task above was
reproduced against both the old and corrected packages.

Official Mac CLI and app archives matched their published hashes but failed
native signature verification. Neither was launched or resigned. The Linux
archive passed its full published SHA-256 check. Its private container had
CPU 2, RAM 8 GiB, PID limit 128, loopback-only port publication, cloud disabled,
read-only runtime/weight mounts, a private model store and a 20-minute cleanup
guard. The external server remained running after Koto's quit, then its owner
gracefully stopped and removed it. Port 11434 closed, host Ollama/key paths stayed
absent, and runtime bytes/modes stayed unchanged. Docker Desktop was restored to
its original stopped state after checking there were no unrelated containers.
This is Mac Koto-to-Linux-backend protocol evidence, not native Linux Koto or
native Mac Ollama qualification.

## Evidence boundaries

The initial two-turn Codex journey used the private archive with SHA-256
`63d0488aa9655b4a5a5444867fb5a67cd4c3cce59979ea20bbee26f180b49858`.
An intermediate archive changed only the English/Persian READMEs, retaining all
51 runtime files and modes. Its SHA-256 is
`38e0e3c338ea361647d925e2400385b175398612ef403bb91d9a631d01f287db`.
Fresh onboarding was repeated from that archive in a new empty private
state directory and completed with ordinary exit 0.

The final corrected archive has SHA-256
`44c8d16330133578c60eefbbd8215a9faeac99635eb0e33924440ca16216479b`.
All 51 installed runtime files and modes match the final source. Its runtime
delta from the earlier candidate is confined to `bin/chat.js` and
`src/local-models.js`. Its own fresh onboarding, actual Ollama task, third Codex
coding continuation, incremental review and integration were observed above.
Earlier native evidence is retained separately rather than relabeled.
The final package also repeated explicit managed-model selection, a read-only
`ready` response and ordinary exit 0. Strict llama.cpp startup remained usable
after the shared metadata refactor.
The final physical readback found no owned CLI/model/Docker processes, no known
Codex worker PID, and neither model port accepting connections. Docker's socket
and host Ollama/key directory remained absent.

Private transcripts preserve command inputs, outputs, lifecycle receipts,
original negative controls and native ID comparisons without publishing account
credentials. An earlier candidate's separate coding observation is retained but
does not substitute for this final candidate's native journey.

Private-controller mistakes were retained: consuming a project prompt before
waiting for it, expecting `Koto:` instead of the actual `Koto>` response, and
copying preferences without preserving required mode 600.
Corrected runs used fresh onboarding state or the same real cached model and
completed ordinarily; these controller errors are not presented as Koto failures.

Per repository policy, no automated suites, fixture demos or benchmarks were
added or run. Regression feedback used actual bounded CLI invocations, followed
by `npm run check`, diff review and independent source/package review. Temporary
controllers and receipts remain in a private, clearly marked debug directory.

This does not establish general coding quality, live Claude use, a fresh model
download, a two-model mismatch scenario, or native Linux/Windows Koto CLI workflows for
these changes. Those platform and release gates remain separate from this Mac
candidate observation. No UI or IDE implementation or native acceptance was added
by this work.
