import { stripVTControlCharacters } from 'node:util';
import { readProjectSession, inspectProjectSession, integrateProjectSession,
  finalizeProjectSessionIntegration, inspectProjectContributionAttempt,
  reconcileProjectContributionAttempt } from '../src/index.js';

const visible = value => stripVTControlCharacters(String(value))
  .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const uncertain = outcome => typeof outcome?.error === 'string'
  && /(?:^|_)cleanup_unconfirmed$/.test(outcome.error);
const cleanupUnknown = agent => uncertain(agent.result) || uncertain(agent.commandOutcome)
  || (agent.attempts ?? []).some(attempt => uncertain(attempt.result) || uncertain(attempt.commandOutcome));
const say = (write, value) => write(`${visible(value)}\n`);
const cancelled = signal => { if (signal?.aborted) throw Object.assign(new Error('Session selection cancelled.'), { code: 'chat_cancelled' }); };

function showSession(state, write) {
  say(write, `Saved project: ${state.projectRoot}\nGoal: ${state.goal}\nIntegration workspace: ${state.integration.path}`);
  for (const agent of state.agents) {
    say(write, `${agent.id}: ${agent.nativeKind ?? agent.native?.kind ?? 'command'}${agent.model ?? agent.native?.model ? ` / ${agent.model ?? agent.native.model}` : ''} — ${agent.status}${agent.integration ? `; integration ${agent.integration.status}` : ''}${cleanupUnknown(agent) ? '; cleanup unconfirmed' : ''}\n  ${agent.task}`);
  }
}

function showReview(review, write) {
  say(write, `\n${review.agentId}: ${review.agentStatus}\n${review.integrationDiff ?? review.diff}`);
  if (review.contributionBaseCommit !== review.baseCommit) say(write, `Contribution since the last integrated snapshot: ${review.contributionBaseCommit}`);
  if (review.untracked?.length) say(write, `Untracked paths: ${review.untracked.map(item => item.path).join(', ')}`);
  if (review.outsideOwnership.length) say(write, `Outside declared ownership: ${review.outsideOwnership.join(', ')}`);
  if (review.conflicts?.length) say(write, `Conflicts: ${review.conflicts.join(', ')}`);
}

async function chooseAgent(state, ask, write) {
  const answer = (await ask('Agent to inspect (id or number; Enter returns)> ')).trim();
  if (!answer || answer === 'cancel') return undefined;
  const agent = state.agents.find(item => item.id === answer)
    ?? (/^[1-9][0-9]*$/.test(answer) ? state.agents[Number(answer) - 1] : undefined);
  if (!agent) { say(write, 'Choose an agent listed in this saved session.'); return undefined; }
  return agent;
}

async function recoverContribution(sessionRoot, attempt, ask, write, signal) {
  say(write, `An integration attempt needs attention before another integration or resume.\nAgent: ${attempt.agentId}; operation: ${attempt.operation}; phase: ${attempt.phase}\nSource HEAD: ${attempt.current.sourceHead}\nIntegration HEAD: ${attempt.current.integrationHead}\nPreviously approved integration HEAD: ${attempt.before.integrationHead}`);
  for (const [name, entries] of [['Source changes', attempt.current.sourceStatus], ['Integration changes', attempt.current.integrationStatus]]) {
    say(write, `${name}: ${entries.length ? entries.map(item => `${item.code} ${item.path}${item.originalPath ? ` (from ${item.originalPath})` : ''}`).join('\n  ') : 'clean'}`);
  }
  if (attempt.current.cherryPickHead) say(write, `Cherry-pick still present: ${attempt.current.cherryPickHead}`);
  if (attempt.observedResult) say(write, `Retained Git receipt: ${attempt.observedResult.status}; integration commit ${attempt.observedResult.integrationCommit}${attempt.observedResult.conflicts?.length ? `; conflicts: ${attempt.observedResult.conflicts.join(', ')}` : ''}`);
  if (attempt.evidenceError) say(write, `Inspection needs attention: ${attempt.evidenceError}`);
  if (attempt.ownerLive || !attempt.possibleResolutions.length) {
    say(write, attempt.ownerLive
      ? 'The recorded operation owner is active. Return to that session; this view will not interrupt or replay it.'
      : 'No safe reconciliation is available. Inspect the retained session and Git state manually; no changes were made.');
    return false;
  }
  showReview(await inspectProjectSession(sessionRoot, attempt.agentId), write);
  say(write, 'record-result records the observed retained receipt. not-applied acknowledges the inspected unchanged target. Neither choice reruns the operation.');
  const answer = (await ask(`After reviewing these observations, type ${attempt.possibleResolutions.join(' or ')}; Enter returns> `)).trim();
  cancelled(signal);
  if (!attempt.possibleResolutions.includes(answer)) return false;
  const result = await reconcileProjectContributionAttempt(sessionRoot, { resolution: answer, approve: attempt.reviewToken });
  say(write, `Integration attempt ${result.status}: ${result.resolution}.`);
  return true;
}

/** Inspect retained work. Mutations require a newly displayed, token-bound approval. */
export async function reviewSavedSession({ sessionRoot, ask, write, signal } = {}) {
  if (!sessionRoot) { say(write, 'No saved project session yet. Start a build first.'); return undefined; }
  cancelled(signal);
  let state = readProjectSession(sessionRoot);
  showSession(state, write);
  const pending = await inspectProjectContributionAttempt(sessionRoot);
  if (pending) {
    if (!await recoverContribution(sessionRoot, pending, ask, write, signal)) return undefined;
    state = readProjectSession(sessionRoot);
  }
  const agent = await chooseAgent(state, ask, write);
  if (!agent) return undefined;
  cancelled(signal);
  const review = await inspectProjectSession(sessionRoot, agent.id);
  showReview(review, write);
  if (state.active || state.agents.some(item => ['pending', 'running'].includes(item.status))) {
    say(write, 'This session is active or interrupted before settling. Review is available; integration requires the owning session to settle first. If its owner exited unexpectedly, retain the work and inspect the recorded session manually; this command cannot reclaim it.');
    return undefined;
  }
  if (state.agents.some(cleanupUnknown)) {
    say(write, 'Owned-process cleanup is unconfirmed. Partial changes are retained; integration and continuation remain blocked until ownership is inspected.');
    return undefined;
  }
  if (agent.integration?.status === 'conflicts') {
    say(write, `Resolve and commit the conflicts manually in ${state.integration.path}. This command only acknowledges your reviewed resolution.`);
    const commit = (await ask('Resolved integration commit (full SHA; Enter returns)> ')).trim();
    if (!commit) return undefined;
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Enter the complete resolved integration commit SHA.');
    if ((await ask(`Type resolve to acknowledge reviewed commit ${commit}> `)).trim() !== 'resolve') return undefined;
    cancelled(signal);
    const result = await finalizeProjectSessionIntegration(sessionRoot, agent.id, { approveIntegrationCommit: commit });
    say(write, `${agent.id}: ${result.status}. Integration workspace: ${result.integration.path}`);
    return { sessionRoot, integration: result.integration, status: result.status };
  }
  if (state.agents.some(item => item.integration?.status === 'conflicts')) {
    say(write, 'Another contribution has unresolved conflicts. Select that agent and resolve its integration first.');
    return undefined;
  }
  if (!['succeeded', 'failed', 'cancelled'].includes(agent.status) || review.outsideOwnership.length) {
    say(write, 'This contribution cannot be integrated in its current state. The core retains the edits for inspection.');
    return undefined;
  }
  if ((await ask(`Type integrate to apply this exact reviewed contribution from ${agent.id}; Enter returns> `)).trim() !== 'integrate') return undefined;
  cancelled(signal);
  const result = await integrateProjectSession(sessionRoot, agent.id, { approve: review.reviewToken });
  say(write, `${agent.id}: ${result.status}. Integration workspace: ${result.integration.path}`);
  if (result.conflicts?.length) say(write, `Conflicts: ${result.conflicts.join(', ')}. Resolve them in the integration workspace; original agent edits are retained.`);
  return { sessionRoot, integration: result.integration, status: result.status };
}

function resumeReason(agent) {
  if ((agent.attempts?.length ?? 0) >= 32) return 'recorded attempt limit reached';
  if (agent.nativeKind === 'local') {
    return agent.localSessionId && agent.localContinuation && !agent.localContinuationUnavailableReason
      && agent.localContinuation.sessionId === agent.localSessionId ? undefined
      : agent.localContinuationUnavailableReason ?? 'no safe local continuation retained';
  }
  if (agent.nativeKind === 'codex' || agent.nativeKind === 'claude') {
    return agent.nativeSessionId && agent.nativeOrigin ? undefined : 'no native conversation retained';
  }
  return agent.nativeState?.ended && agent.nativeState.resumable && !agent.nativeState.protocolError
    ? undefined : 'this transport has no retained native continuation';
}

/** Pick an explicit next turn; preparing/running it remains the shared core's job. */
export async function selectResumeRequest({ sessionRoot, ask, write, signal } = {}) {
  if (!sessionRoot) { say(write, 'No saved project session yet. Start a build first.'); return undefined; }
  cancelled(signal);
  const state = readProjectSession(sessionRoot);
  showSession(state, write);
  if (await inspectProjectContributionAttempt(sessionRoot)) {
    say(write, 'An integration attempt needs reconciliation. Use /review to inspect it before resuming.');
    return undefined;
  }
  if (state.active || state.agents.some(agent => ['pending', 'running'].includes(agent.status))) {
    say(write, 'The saved session has not settled. Return to its owning process if it is still running. If it exited unexpectedly, retain the work and inspect the recorded session manually; this command cannot reclaim it. No interrupted request was replayed.');
    return undefined;
  }
  if (state.agents.some(cleanupUnknown)) {
    say(write, 'Owned-process cleanup is unconfirmed. Inspect the retained owned process before continuing; no agent was launched.');
    return undefined;
  }
  if (state.agents.some(agent => agent.integration?.status === 'conflicts')) {
    say(write, 'Resolve the integration conflicts through /review before resuming an agent.');
    return undefined;
  }
  state.agents.forEach((agent, index) => say(write, `${index + 1}. ${agent.id}: ${resumeReason(agent) ?? 'continuation retained; runtime/account/workspace will be checked before launch'}`));
  const agent = await chooseAgent(state, ask, write);
  if (!agent) return undefined;
  const reason = resumeReason(agent);
  if (reason) { say(write, `Cannot continue ${agent.id}: ${reason}. Its partial work remains available for /review.`); return undefined; }
  const prompt = (await ask(`What should ${agent.id} do next? Enter cancels> `)).trim();
  if (!prompt) return undefined;
  if (Buffer.byteLength(prompt) > 12_000 || prompt.includes('\0')) throw new Error('Keep the continuation request within 12,000 bytes.');
  say(write, 'This continues the recorded conversation in its original worktree, with the original agent, model and permissions. It does not replay the previous request.');
  if ((await ask(`Type resume to launch the next turn for ${agent.id}> `)).trim() !== 'resume') return undefined;
  cancelled(signal);
  return { sessionRoot, agentId: agent.id, prompt };
}
