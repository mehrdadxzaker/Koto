# Installed CLI and native-core acceptance

Use the exact reviewed package and installation command supplied with the
handoff, outside the source checkout. The steps below call that installed
command `koto`. Record its version, artifact digest and source revision before
starting. Use a real project and small changes you actually want; check the
result with that project's normal tools. Preserve existing native accounts,
private source and all failed or partial outcomes.

One designated acceptance owner coordinates live native work and the issue #543
completion decision. Avoid overlapping acceptance runs against the same model,
ports or project. On macOS, use Node.js 22+, Git and enough current free memory
for the selected model. The advanced PTY slice also needs existing developer
tools to build the host helper. Native interactive behavior on Linux and Windows
must be observed on those actual hosts before claiming equivalent acceptance.

## Current Codex CLI checkpoint — October 30, 2026

Issue [#543](https://github.com/mehrdadxzaker/Koto/issues/543) is closed as
completed for its owner-confirmed CLI delivery contract. The
[current acceptance matrix](CORE_STATUS.md#current-codex-cli-closure) combines
the retained acquisition/cooperation and native-platform evidence with the
[published alpha.3 fresh Homebrew Codex workflow](RELEASE_ALPHA3.md).
The checklist below remains a manual observation guide; unexercised conditional
branches keep their individual evidence status.

## Earlier observation checkpoint — October 28, 2026

These labels describe the named installed observations, not a blanket pass for
all instructional or conditional branches below. Exact artifact bindings,
digests, costs and earlier failures remain recorded in
[core status](CORE_STATUS.md) and
[#543](https://github.com/mehrdadxzaker/Koto/issues/543).

- **Passed — Mac fresh CLI, `8291701`:** empty Koto application state, discovery
  and use of the existing native ChatGPT/Codex subscription, actual pinned
  runtime/Qwen3 4B acquisition, an edited/reviewed plan, useful local/native
  project contributions, explicit review/integration, normal quit and confirmed
  cleanup were observed. Fresh application state retained the host's existing
  account and dependencies; it was not a clean-machine installation of every
  native dependency.
- **Passed — Mac returning use, `8291701`, within the observed scope:** actual
  returning `npm exec` remembered the project, account, model, workers and saved
  session. `/models add` verified the same retained model without another
  download; this was not acquisition of a second asset. `/resume` performed a
  useful follow-up in the existing local conversation and integrated only its
  reviewed delta; this was not a new build. Normal quit, confirmed owned cleanup
  and closed-listener observations were retained. The distinct new-build,
  another-model acquisition/selection and conditional selector items below keep
  their individual evidence status.
- **Passed — Mac native interaction and structured continuation, `8291701`:**
  two actual Codex terminals demonstrated native input, resize/detach,
  independent peer stop, useful work, explicit review/integration and confirmed
  cleanup. A separate structured native CLI observation preserved the captured
  identity and original worktree through explicit continuation and follow-up
  integration delta. These observations cover different declared protocols
  within the overall acceptance run; terminal-only adapters are not thereby
  claimed to expose captured identity or structured resume.
- **Accepted — Linux native behavior, review and cleanup, `8291701`:** actual
  OpenCode/Qwen terminals demonstrated native input and permission handling,
  resize/detach, independent peer stop, useful corrected work, explicit
  review/integration and confirmed terminal/server cleanup. The designated
  acceptance owner accepted that slice with the writer's command result retained
  separately as `failed`/`timeout`: its final native reply preceded the deadline,
  while its TUI process remained open. The reader's intentional cancellation and
  the aggregate failed result are also retained. Accepted behavior/review/cleanup
  and the failed/timeout process result remain separate granular outcomes.
- **Passed — Windows native startup and actual CLI controls, `05d1650`:**
  independently reviewed idle and controls-only observations verified input,
  redraw/resize, independent stop, actual `:attach`/Ctrl-] detach, ordinary
  control/input return and confirmed owned cleanup. Intentional cancellation
  remains inner `cancelled`/exit 1 and outer `failed`/exit 1; driver/first error
  were absent. No useful task or integration was performed in these slices.
  Native startup acquired `rg.exe`; no fully offline or pristine desktop-terminal
  claim is made.
- **Failed — first Windows useful task, `05d1650`:** a 600-second native request
  timeout, zero tools, no edits/empty diffs and a later incorrect cleanup-versus-
  correctness reply left no accepted contribution or integration. Model-stage
  PTY/runtime cleanups were confirmed. Its original CLI complement sent no
  controls because of a controller marker mismatch; outer cleanup was confirmed
  but its inner outcome remained unknown. Later controls success does not erase
  that record.
- **Rejected — Windows useful-task retry, `05d1650`:**
  [run 40611815027](https://github.com/mehrdadxzaker/Koto/actions/runs/40611815027)
  completed three reads and two edits, but placed two notes inside an existing
  sentence; the correction duplicated the note. The malformed change was
  rejected. A stop-time memory-monitor `TypeError` occurred before contributor
  and server final cleanup records. Reader cleanup was confirmed; their last
  retained phases were `wait_job begin`. The session remained active/locked,
  without a final review token or authorized integration; its CLI complement
  was skipped. The original error-code value was not captured.
- **Verified — package and source/helper CI, `0635143`:** all 53 committed-source,
  worktree, tar and installed payloads matched bytes, sizes and modes. The exact
  head passed all seven CI checks on attempt 1. These are artifact/source results,
  not native task acceptance.
- **Observed — installed client-setup cancellation, `0635143`:** on Node 25.2.1,
  an actual public setup call handled numeric AbortError code 20 as
  `native_client_install_cancelled` without creating an installation directory.
  Completed installation/sign-in was not observed. The earlier failed Windows
  run's raw error-code value remains uncaptured.
- **Accepted — Windows native work and controlled cleanup, `0635143`:**
  [run 40615660295](https://github.com/mehrdadxzaker/Koto/actions/runs/40615660295)
  produced a useful correct 32-word operator note with a final newline; all 89
  original files were unchanged. Native history verified same-conversation
  read/write follow-up after independent reader stop. Both PTYs and llama had
  confirmed final cleanup; the session was inactive without product locks.
  Planned controlled stop remains canonical as `cancelled`/exit 1. The note was
  accepted despite terse coverage of some prompt details; this is bounded task
  evidence, not general coding qualification.
- **Verified — explicit Windows integration, `0635143`:** a separate no-model
  [run 40618740981](https://github.com/mehrdadxzaker/Koto/actions/runs/40618740981)
  applied the approved contribution in its separate integration worktree.
  Original files remained unchanged, no integration delta remained and the
  session was inactive without pending locks. Public evidence rehydration
  refused the bundle because a legitimate integration receipt was absent from
  its sealing allowlist; authenticated private review accepted the complete
  integration evidence. No repeat integration is needed.
- **Failed — recorded Windows CLI Ctrl-] handoff, `0635143`:** the follow-on complement
  in run 40615660295 lacked the exact detach-return marker. Inner stopping began
  13 ms after Ctrl-] and CLI exit 1 followed within 126 ms, before any subsequent
  status/stop/quit/recovery input. Cleanup was confirmed; functional return was
  not. Instrumented no-model
  [diagnosis 40619541347](https://github.com/mehrdadxzaker/Koto/actions/runs/40619541347)
  completed on frozen `0635143`, localizing second readline/raw-mode setup to
  stdin `EPIPE` with confirmed cleanup. It is diagnosis, not acceptance, and does
  not establish the underlying Windows cause. This failed handoff remains
  recorded; conditional checklist branches retain individual status.
- **Verified — current CLI repair package/source CI, `caa5ca6`:** only the two
  internal CLI files changed versus `0635143`; all native/runtime/core payloads
  remain unchanged. All 53 payload identities and seven exact-head CI checks on
  attempt 1 are verified. The explicit input-owner handoff and failed-control
  cleanup changes have cleared source review.
- **Accepted — final Windows idle CLI controls, `caa5ca6`:** independently reviewed
  [run 40620884045](https://github.com/mehrdadxzaker/Koto/actions/runs/40620884045)
  verified two distinct attach/resize/detach returns, three requested status
  readbacks of the same native PID, explicit stop, settled controls and explicit
  quit. Both helper protocols and owned cleanups were confirmed, with inactive
  state, no locks or native conversations, and no fallback or deadline. Raw VT
  redraw repetitions are not extra handoff cycles. Intentional cancellation
  remains native `cancelled`/exit 1 and outer `failed`/exit 1/`exit_failed`.
- **Accepted — final Linux idle CLI controls, `caa5ca6`:** two attach/resize/detach/
  status cycles, explicit stop and quit completed in 47.1 seconds with confirmed
  native/outer cleanup, no owned processes or native conversations, and no
  deadline or forced CLI kill. The native result is `cancelled`/exit 0 and the
  aggregate CLI exit 1 retains intentional stop. Owned-container removal was
  verified through corrected absence metadata without rerunning the observation;
  the original false parser result is preserved.
- **Accepted — combined final Mac idle CLI controls, `caa5ca6`:** two handoffs,
  status and stop were observed in a first run that reached its 60-second
  controller deadline before quit; deadline SIGINT ended the idle controls with
  exit 1. That partial record retains no quit claim.
  A separate 13.404-second status/stop/settled-prompt/quit complement ended by
  ordinary child exit 1 without controller signals or deadline, with native
  `cancelled`/exit 0, confirmed native/outer cleanup, inactive state, zero owned
  processes, no native conversations and clean worktrees. These two records
  satisfy the observed scope together; they are not a single uninterrupted run.
  Independent review checked the complement's 21 referenced hashes, 53 payloads
  and all 89 original files' bytes/modes.

The recorded CLI acceptance scope is complete within these named observations.
The final controls observations used idle OpenCode without model tasks or
integration. Earlier accepted model work retains its actual IDs; no model tasks
were repeated. Functional return to controls is verified without a pristine
screen-repaint or desktop-terminal claim.

Earlier actual Mac/Linux records remain on `8291701`, Windows startup/controls
on `05d1650`, and useful Windows work/cleanup/integration on `0635143`.
Current `caa5ca6` changes only CLI ownership handling, while all native/runtime/core
payloads remain byte-identical to `0635143`. The original IDs and limited branch
statuses remain intact; new source equivalence is not fresh model execution.
Exact package/inventory, source CI, final control receipts and prior failures are
detailed in [core status](CORE_STATUS.md). Delivery-head, protected-merge,
exact-main and issue-completion results remain in #543.

Claude was found requiring native sign-in; live Claude inference remains
unverified. Conditional native installation/sign-in, recovery, saved-build
selection, model-selection and integration-conflict branches retain their
individual evidence status. An unexercised branch remains unverified rather than
being inferred from the observations above. Earlier low-memory refusals, interrupted downloads, model-output failures, Windows startup/cleanup failures and corrections remain
linked from core status. The local tool-selection/read-scope and EOF-newline
misses are preserved. These bounded documentation tasks do not establish general
coding qualification, and actual provider dollar cost is unknown.

## 1. Complete fresh-user onboarding

Use a new private `KOTO_STATE_DIR` for Koto's product choices while retaining the
real native clients' own account state. Install the reviewed artifact outside
its checkout, then run:

```sh
koto --version
koto
```

Complete and record each item:

- [ ] Koto discovers actual supported installations and explains observed login
  readiness. Select an existing subscription without an API key. If needed,
  exercise native sign-in or explicitly approved private client installation;
  record an unexercised branch as unverified.
- [ ] Open the optional model choices, inspect the size/license/memory guidance,
  approve a selected model, and observe its pinned runtime and verified weights
  being acquired or reused. Record actual downloaded and reused assets.
- [ ] Observe that the local server loads the selected model and completes a
  real task. A downloaded file, healthy endpoint or model listing alone does not
  satisfy this item. If memory prevents startup, retain the refusal and stop
  this branch until normal resources are available.
- [ ] Choose an existing clean, committed project, or approve a named empty
  project through `new PATH`. Confirm that ordinary conversation also works
  when project selection is postponed.
- [ ] Describe useful project work in ordinary language. Review Koto's proposed
  agents, models, tasks and ownership paths. Use `edit` to change a real
  assignment/ownership choice, verify the revised plan, and type `build` to launch.
  Invalid dependencies/paths must leave the last valid plan unchanged.
- [ ] Observe actual commercial and local contributions through the same core,
  including overlapping execution when the plan allows it. Answer native
  permission requests where required and keep attributable outcomes.
- [ ] Inspect each contribution, independently check useful changes with the
  project's normal tools, and explicitly integrate accepted work. Verify that
  integration uses its separate worktree and respects ownership and cleanup.
- [ ] Exit cleanly and verify that owned processes/listeners are settled while
  project work, reviewed results and product choices remain available.

## 2. Return to saved work

- [ ] Reopen the same installed `koto` with the same private state directory.
  Account/model choices and the project are remembered; first-run onboarding
  does not repeat.
- [ ] Use `/sessions` to view the project's retained builds. When more than one
  exists, choose an earlier build and verify its actual goal and agents.
- [ ] Use `/review` and its agent selector without supplying a session path.
  Inspect the retained contribution. `/integrate` must display a current review
  and require explicit `integrate` approval before applying it.
- [ ] Use `/resume`, select the originating saved agent, provide a follow-up and
  approve the continuation. Verify its recorded native identity, worktree, model
  and account; apply the exact-session and integration-delta criteria below.
- [ ] Use `/models add` to retain another selected asset when resources permit.
  `/models` must list retained choices, and `/models use MODEL_ID` selects one
  managed model at a time. Prior downloads and saved contributions remain.
- [ ] Start another useful build with the remembered setup and check its result.

## 3. Verify interruption and recovery

Keep failures and recoveries as separate observations. Do not replace a failed
attempt with the final successful transcript.

- [ ] A dirty or unsuitable project produces an actionable message, permits
  choosing another folder and preserves existing changes. Project creation
  requires explicit confirmation and never commits existing folder contents.
- [ ] A missing native client, unavailable login or cancelled sign-in leaves
  project choices and saved work available. `/accounts` exposes the applicable
  installation or native sign-in recovery.
- [ ] An interrupted or failed optional model setup preserves subscription
  setup and valid retained assets, with `/models add` or `/models use MODEL_ID`
  available for recovery. No unrequested provider fallback occurs.
- [ ] A memory refusal preserves verified weights and starts no model process.
  Once normal resources are available, selecting that retained model reuses its
  assets. Do not lower protections or stop unrelated processes for acceptance.
- [ ] Stop an active turn, exit and reopen. Confirm settled owned cleanup,
  inspectable partial work and explicit continuation rather than automatic replay.
- [ ] If malformed preferences are encountered, verify that the offered reset
  preserves a backup and retains native accounts and saved session state.
- [ ] Unknown cleanup or unresolved integration prevents new conflicting work
  and remains visible until its observed outcome is explicitly reconciled.

## 4. Exercise both real native terminals

Keep the existing native-terminal criteria as a separate part of this run. Run
`koto setup` for the advanced manual launcher. Choose **Set up terminal support**;
verify the matching helper or explicitly build it with installed tools.

Choose **Start an agent session** on the real project with two actual supported
CLI agents and a bounded deadline. The manual launcher includes Codex and
OpenCode presets. If using OpenCode, retain its existing configured provider,
model, JSON configuration and local endpoint. Choose **Interactive terminal**
for both, give them separate useful tasks and ownership paths, and ask each to
wait for your native prompt response before editing. Review the summary and
type `start`. The manual launcher remains an advanced path; normal onboarding
and model acquisition are covered above.

1. Run `:status`: both agents should have different worktrees and running states.
2. Run `:attach codex1`, answer its native prompt, and press **Ctrl-]** to return.
   Do the same with `:attach opencode2`.
3. Attach again and resize the terminal window. The native screen should follow
   the size change. Detach; Koto controls and ordinary typing should be restored.
4. While OpenCode is still working, run `:stop codex1`. OpenCode must continue.
   Codex's partial work must remain inspectable; no changes should be applied to
   the original checkout.
5. Let OpenCode finish its task, then quit its native TUI normally, or stop it
   explicitly. Run `:review opencode2`. Check the actual changes and any
   project-specific correctness requirements. If you accept them, run
   `:integrate opencode2`. Integration must wait for every agent's confirmed
   cleanup and write only to the printed integration worktree.

Keep the printed session directory. `:quit` returns to the launcher. The
**Review a saved session** option must show the same retained changes.

## 5. Continue an exact native session

Native terminal screens do not expose a reliable conversation ID. Use a short
**Structured pipe** task for this part, within the same acceptance run:

1. Start a new session on the clean original project with one Codex agent in
   **Structured pipe** mode and an explicit model identifier. Ask it to inspect
   a specific file, explain one improvement, and make no edits yet. Let it finish
   normally. `:status` must show a completed native turn and a captured native ID.
2. Retain the printed Koto session directory, then `:quit`.
3. Choose **Resume a native agent session**. Enter that directory and `codex1`.
   Ask it to make the improvement it just proposed. Inspect the resumed command
   and approve with `start`. It must use the recorded native session ID and the
   same worktree; it must not restart the original assignment or select a latest
   session belonging to another task.
4. Review the resulting change and integrate only if you accept it. Resume that
   saved agent once more with a small follow-up you want. After it finishes,
   review must show only its new change since the accepted snapshot; integration
   must not apply the first contribution again. A missing native ID or
   failed/unknown cleanup must produce an explicit refusal.

If OpenCode native continuation is part of your intended daily flow, perform
the same inspect-then-resume step with OpenCode and its configured model. Keep
any failed or partial outcome in your feedback; do not replace it with a retry
and report only the retry.

If an actual integration conflict occurs, keep the failed outcome. Resolve and
review the conflict in the printed integration worktree, finish the Git
cherry-pick, and leave it clean. Then record approval of its exact full commit:

```sh
koto project resolve "/printed/session/directory" AGENT --approve FULL_COMMIT_SHA
```

Koto must verify the retained conflict before accepting that resolution. This
command acknowledges your reviewed commit; it does not resolve or commit files.
There is no need to manufacture a conflict for this run.

## Acceptance record

For every checklist item, record **passed**, **failed**, **partial** or
**unverified**, with the exact installed artifact, source revision and host.
Include fresh onboarding, model acquisition and inference, useful real-project
contributions, returning-user selection, interruption/recovery and settled
owned cleanup. Preserve the failed low-memory startup independently of any
later successful run.

Also send a short result for: **two agents running**, **native prompt input**,
**resize/detach**, **stop one while the other continues**, **retained review and
integration**, **native session resume**, and **follow-up integration delta**.
Include any conflict-resolution result if one occurred. Include OS, Node/Koto/native CLI
versions and any fixed error code shown. State which agent/model was selected,
but omit credentials, full transcripts, private paths and source content.

The designated acceptance owner uses this evidence for issue #543 closure.
Source checks, helper compilation, account discovery, package installation and
download verification remain separate observations. They do not turn an
unobserved native interaction, useful model result or complete user journey
into a pass. UIs and IDE plugins follow complete CLI acceptance.
