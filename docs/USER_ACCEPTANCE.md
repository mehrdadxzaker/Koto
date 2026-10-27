# One acceptance run for the shared core

Use the exact reviewed installation command supplied with the handoff, so this
run does not use an older `koto`. The steps below call that installed command
`koto`. Use a clean, committed project and two small, non-overlapping changes you
actually want. Existing native accounts and model settings remain in place.

On the Mac, have Node.js 22+, Git, the Apple command-line developer tools, Codex
and OpenCode available. Start the configured local model server before choosing
it. Know its exact OpenCode `provider/model`, existing JSON configuration path
and loopback provider URL. Koto does not install models or change credentials.

## 1. Open the installed core

```sh
koto --version
koto
```

Choose **Set up terminal support**. Keep the default directory unless you use a
different private helper directory. An existing matching helper is verified;
otherwise choose **Build the helper now using installed tools**.

Choose **Start an agent session**. Select your project, two agents and a
10-minute deadline. Use Codex with your existing ChatGPT account and OpenCode
with your configured local model. Choose **Interactive terminal** for both.
Give each agent a separate task and ownership path. For example, use two
documentation improvements you want in that project. Ask each to inspect its
part, ask you before editing, and wait for your answer. Review the summary and
type `start`.

## 2. Exercise both real terminals

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

## 3. Continue an exact native session

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

## What to send back

Send a short result for: **two agents running**, **native prompt input**,
**resize/detach**, **stop one while the other continues**, **retained review and
integration**, **native session resume**, and **follow-up integration delta**.
Include any conflict-resolution result if one occurred. Include OS, Node/Koto/native CLI
versions and any fixed error code shown. State which agent/model was selected,
but omit credentials, full transcripts, private paths and source content.

This user run supplies the remaining host evidence. Source checks, helper
compilation and package installation are separate observations and do not turn
an unobserved native interaction into a pass.
