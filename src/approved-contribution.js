import { appendFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inspectWorkspace, integrateWorkspace, finalizeWorkspaceIntegration,
  inspectWorkspaceContributionAttempt, releaseWorkspaceContributionAttempt } from './project-workspaces.js';
import { CONTRIBUTION_ATTEMPT_FILE, ATTEMPT_LIMIT, readPrivateJson, writePrivateJson,
  removePrivateRecord, readState, persist, agentRecord, requireSettled, lease } from './project-session-store.js';

const activeAttempts = new Set();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { throw new Error(code); };
const pendingPath = root => path.join(root, CONTRIBUTION_ATTEMPT_FILE);
const sameWorkspace = (left, right) => left?.path === right?.path && left?.branch === right?.branch && left?.sessionRoot === right?.sessionRoot;
const sameResult = (left, right) => hash(left) === hash(right);
const previousIntegration = record => record.lastSuccessfulIntegration ?? (record.integration?.status === 'integrated' ? record.integration : undefined);

export async function inspectContribution(state, id) {
  const record = agentRecord(state, id);
  const review = await inspectWorkspace({ workspace: record.workspace, previousIntegration: previousIntegration(record) });
  const outsideOwnership = [...new Set([...review.changedPaths, ...(review.integrationChangedPaths ?? [])])]
    .filter(filename => !record.owns.some(prefix => prefix === '.' || filename === prefix || filename.startsWith(`${prefix}/`)));
  return { ...review, agentId: id, agentStatus: record.status, owns: record.owns, outsideOwnership };
}

function readAttempt(root) {
  let attempt;
  try { attempt = readPrivateJson(pendingPath(root), ATTEMPT_LIMIT); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (attempt?.kind !== 'koto-contribution-attempt' || attempt.schemaVersion !== 1
    || !/^[a-f0-9-]{36}$/.test(attempt.attemptId ?? '') || attempt.sessionRoot !== root
    || !['integrate', 'resolve'].includes(attempt.operation)
    || !Number.isSafeInteger(attempt.ownerPid) || attempt.ownerPid < 1
    || !['running', 'receipt-retained', 'state-recorded', 'unresolved'].includes(attempt.phase)
    || ![attempt.before?.sourceHead, attempt.before?.integrationHead, attempt.before?.reviewTree,
      attempt.before?.contributionBaseCommit, attempt.baseCommit].every(value => /^[a-f0-9]{40,64}$/.test(value ?? ''))) {
    fail('project_contribution_attempt_invalid');
  }
  return attempt;
}

function retainAttempt(attempt, { exclusive = false } = {}) {
  writePrivateJson(pendingPath(attempt.sessionRoot), attempt, { limit: ATTEMPT_LIMIT, exclusive });
}

function archiveAttempt(attempt, resolution) {
  // Retain the full intent and outcome after releasing the blocking marker.
  // Rewriting the same archive on an explicit retry is harmless and bounded.
  writePrivateJson(path.join(attempt.sessionRoot, `contribution-attempt-${attempt.attemptId}.json`),
    { ...attempt, resolution, reconciledAt: new Date().toISOString() }, { limit: ATTEMPT_LIMIT });
}

function recordResult(state, id, result, attempt, onEvent) {
  const record = agentRecord(state, id);
  // State may already contain the outcome if only logging/marker cleanup failed.
  // Do not reserve another event sequence or infer an outcome from a ref.
  if (attempt && record.lastContributionAttemptId === attempt.attemptId) {
    if (!sameResult(record.integration, result)) fail('project_contribution_record_changed');
    return;
  }
  record.integration = result;
  if (result.status === 'integrated') record.lastSuccessfulIntegration = result;
  if (attempt) record.lastContributionAttemptId = attempt.attemptId;
  const message = { type: 'integration', agentId: id, status: result.status, sessionId: state.sessionId,
    sequence: (state.eventSequence ?? 0) + 1, time: new Date().toISOString() };
  state.eventSequence = message.sequence;
  persist(state);
  const filename = path.join(state.sessionRoot, 'events.jsonl');
  const line = `${JSON.stringify(message)}\n`;
  let size = 0;
  try { size = lstatSync(filename).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (size + Buffer.byteLength(line) > 80 * 1024 * 1024) fail('project_event_limit');
  appendFileSync(filename, line, { mode: 0o600 });
  try { Promise.resolve(onEvent?.(Object.freeze(message))).catch(() => {}); } catch { /* state is authoritative */ }
}

async function contribute(sessionRoot, id, options, operation) {
  const initial = readState(sessionRoot);
  const release = lease(initial.sessionRoot, { purpose: 'contribution' });
  let attempt, retainedIntent = false;
  try {
    const state = readState(initial.sessionRoot);
    requireSettled(state, { allowConflicts: operation === 'resolve' });
    const record = agentRecord(state, id);
    const attemptId = randomUUID();
    if (operation === 'integrate') {
      if (!['succeeded', 'failed', 'cancelled'].includes(record.status)) fail('project_agent_not_reviewable');
      if (typeof options.approve !== 'string' || !/^[a-f0-9]{64}$/.test(options.approve)) fail('project_review_token_required');
      const review = await inspectContribution(state, id);
      if (review.outsideOwnership.length) fail('project_changes_outside_declared_ownership');
      if (options.approve !== review.reviewToken) fail('project_review_changed');
      if (record.integration?.status === 'integrated' && record.integration.reviewTree === review.tree) fail('project_contribution_already_integrated');
    } else if (record.integration?.status !== 'conflicts') fail('project_integration_has_no_conflicts');
    const contributionAttempt = { id: attemptId, beforeMutation(before) {
      if (attempt) fail('project_contribution_attempt_already_started');
      attempt = { kind: 'koto-contribution-attempt', schemaVersion: 1, attemptId, operation,
        sessionId: state.sessionId, sessionRoot: state.sessionRoot, agentId: id, baseCommit: state.baseCommit,
        workspace: record.workspace, integration: state.integration, before,
        approval: operation === 'integrate' ? options.approve : options.approveIntegrationCommit,
        ...(operation === 'resolve' ? { conflictIntegration: record.integration } : {}),
        ownerPid: process.pid, leaseId: release.leaseId, phase: 'running', startedAt: new Date().toISOString() };
      retainAttempt(attempt, { exclusive: true });
      retainedIntent = true;
      activeAttempts.add(attemptId);
    } };
    const result = operation === 'integrate'
      ? await integrateWorkspace({ workspace: record.workspace, integration: state.integration,
        baseCommit: state.baseCommit, expectedReviewToken: options.approve,
        previousIntegration: previousIntegration(record), contributionAttempt })
      : await finalizeWorkspaceIntegration({ workspace: record.workspace, integration: state.integration,
        conflictIntegration: record.integration, approveIntegrationCommit: options.approveIntegrationCommit, contributionAttempt });
    if (attempt) {
      attempt.phase = 'receipt-retained';
      attempt.result = result;
      retainAttempt(attempt);
    }
    recordResult(state, id, result, attempt, options.onEvent);
    if (attempt) {
      attempt.phase = 'state-recorded';
      retainAttempt(attempt);
      archiveAttempt(attempt, 'record-result');
      removePrivateRecord(pendingPath(state.sessionRoot));
    }
    return result;
  } catch (error) {
    if (retainedIntent) {
      attempt.phase = 'unresolved';
      attempt.error = String(error.code ?? error.message ?? 'project_contribution_failed').slice(0, 1024);
      // Saving this status may fail too. The original durable intent continues
      // to block integration/resume; never replace the real failure with success.
      try { retainAttempt(attempt); } catch { /* pre-mutation marker remains */ }
      throw Object.assign(new Error('project_contribution_attempt_unresolved', { cause: error }),
        { code: 'project_contribution_attempt_unresolved', attemptId: attempt.attemptId });
    }
    throw error;
  } finally {
    try { release(); }
    finally {
      if (retainedIntent) {
        activeAttempts.delete(attempt.attemptId);
        // Only after all operation/lease work has finished can a surviving
        // process release its retained attempt for explicit reconciliation.
        try {
          const retained = readAttempt(initial.sessionRoot);
          if (retained?.attemptId === attempt.attemptId) {
            retained.endedAt = new Date().toISOString();
            retainAttempt(retained);
          }
        } catch { /* a running marker remains conservatively blocked */ }
      }
    }
  }
}

export function integrateApprovedContribution(root, id, options = {}) { return contribute(root, id, options, 'integrate'); }
export function finalizeApprovedContribution(root, id, options = {}) { return contribute(root, id, options, 'resolve'); }

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

async function observe(state, attempt, ownReconciliation) {
  const record = agentRecord(state, attempt.agentId);
  if (attempt.sessionId !== state.sessionId || !sameWorkspace(attempt.workspace, record.workspace)
    || !sameWorkspace(attempt.integration, state.integration)) fail('project_contribution_identity_changed');
  let reconciliationLease = null;
  try {
    const saved = readPrivateJson(path.join(state.sessionRoot, 'contribution-reconcile.lock'), 4096);
    if (!ownReconciliation || saved.reconciliationId !== ownReconciliation) reconciliationLease = saved;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const ownerLive = activeAttempts.has(attempt.attemptId) || (!attempt.endedAt && processAlive(attempt.ownerPid))
    || Boolean(reconciliationLease && Number.isSafeInteger(reconciliationLease.ownerPid) && processAlive(reconciliationLease.ownerPid));
  const observation = await inspectWorkspaceContributionAttempt({ workspace: record.workspace, integration: state.integration, attempt });
  const possibleResolutions = [];
  if (!ownerLive && !reconciliationLease && observation.current.sourceReviewToken) {
    if (observation.observedResult) possibleResolutions.push('record-result');
    else if (!observation.receiptPresent && observation.current.integrationHead === attempt.before.integrationHead
      && !observation.current.integrationStatus.length && !observation.current.cherryPickHead) possibleResolutions.push('not-applied');
  }
  const reviewToken = hash({ attempt, state, observation, ownerLive, reconciliationLease });
  return { attemptId: attempt.attemptId, agentId: attempt.agentId, operation: attempt.operation,
    phase: attempt.phase, ownerPid: attempt.ownerPid, ownerLive, reviewToken, before: attempt.before,
    current: observation.current, possibleResolutions,
    ...(observation.observedResult ? { observedResult: observation.observedResult } : {}),
    ...(reconciliationLease ? { evidenceError: 'project_contribution_reconciliation_lease_retained' }
      : observation.receiptError ? { evidenceError: observation.receiptError } : {}) };
}

export async function inspectProjectContributionAttempt(sessionRoot) {
  const state = readState(sessionRoot);
  const attempt = readAttempt(state.sessionRoot);
  return attempt ? observe(state, attempt) : null;
}

function releaseInterruptedLease(root, attempt) {
  const filename = path.join(root, 'integration.lock');
  let saved;
  try { saved = readPrivateJson(filename, 4096); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (saved?.kind !== 'koto-project-lease' || saved.leaseId !== attempt.leaseId
    || saved.ownerPid !== attempt.ownerPid || saved.purpose !== 'contribution') fail('project_contribution_lease_changed');
  removePrivateRecord(filename);
}

export async function reconcileProjectContributionAttempt(sessionRoot, { approve, resolution, onEvent } = {}) {
  if (typeof approve !== 'string' || !/^[a-f0-9]{64}$/.test(approve)
    || !['record-result', 'not-applied'].includes(resolution)) fail('project_contribution_reconciliation_required');
  const initial = readState(sessionRoot);
  const recoveryLock = path.join(initial.sessionRoot, 'contribution-reconcile.lock');
  const reconciliationId = randomUUID();
  // A crashed reconciliation retains this lease too. No lock is guessed stale
  // or silently stolen: it remains evidence for explicit manual investigation.
  writePrivateJson(recoveryLock, { ownerPid: process.pid, reconciliationId,
    createdAt: new Date().toISOString() }, { exclusive: true, limit: 4096 });
  try {
    const state = readState(initial.sessionRoot);
    requireSettled(state, { allowConflicts: true });
    const attempt = readAttempt(state.sessionRoot);
    if (!attempt) fail('project_contribution_attempt_missing');
    const view = await observe(state, attempt, reconciliationId);
    if (view.ownerLive) fail('project_contribution_attempt_active');
    if (view.reviewToken !== approve) fail('project_contribution_review_changed');
    if (!view.possibleResolutions.includes(resolution)) fail('project_contribution_resolution_unavailable');
    // This never runs a Git apply/reset/commit. Only a validated receipt can
    // repair the project record; an unchanged target only permits not-applied.
    if (resolution === 'record-result') recordResult(state, attempt.agentId, view.observedResult, attempt, onEvent);
    await releaseWorkspaceContributionAttempt({ workspace: attempt.workspace, integration: attempt.integration,
      attempt, observedResult: view.observedResult });
    releaseInterruptedLease(state.sessionRoot, attempt);
    archiveAttempt({ ...attempt, ...(view.observedResult ? { result: view.observedResult } : {}),
      reconciliationApproval: approve, reconciledObservation: view.current }, resolution);
    removePrivateRecord(pendingPath(state.sessionRoot));
    return { status: 'reconciled', attemptId: attempt.attemptId, resolution,
      ...(view.observedResult ? { integration: view.observedResult } : {}) };
  } finally {
    if (readPrivateJson(recoveryLock, 4096).reconciliationId !== reconciliationId) fail('project_contribution_reconciliation_lease_changed');
    removePrivateRecord(recoveryLock);
  }
}
