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

## Current observation checkpoint — October 27, 2026

Account discovery on this Mac found an existing Codex ChatGPT login. Claude Code
was found outside PATH and reported that native sign-in was required. These are
account-status observations, not successful model requests.

The first guided local setup acquired and verified a model download, then
refused startup because observed free RAM was approximately 0.95 GiB, below the
1 GiB reserve. The verified assets were retained. That run used raw macOS free
pages; the subsequent source uses the system memory-pressure estimate while
retaining the same reserve and separate raw metric. The revised guard still
requires actual runtime acceptance. Successful local inference
through this new onboarding path has not yet been observed. This partial result
does not establish commercial/local cooperation or complete installed acceptance.
Claude live inference and the full Linux/Windows native journeys also remain
unverified. Earlier evidence remains recorded in [core status](CORE_STATUS.md)
and issue #543.

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
