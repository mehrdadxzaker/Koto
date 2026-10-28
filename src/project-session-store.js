import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const CONTRIBUTION_ATTEMPT_FILE = 'contribution-attempt.json';
export const ATTEMPT_LIMIT = 128 * 1024;
const STATE_LIMIT = 1024 * 1024;

const fail = code => { throw new Error(code); };

export function syncDirectory(directory) {
  // Windows does not expose directory fsync through Node. File contents are
  // flushed there; neither platform promises an atomic Git + JSON transaction.
  if (process.platform === 'win32') return;
  const fd = openSync(directory, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function readPrivateJson(filename, limit = STATE_LIMIT) {
  const before = lstatSync(filename);
  if (!before.isFile() || before.isSymbolicLink()) fail('project_invalid_private_record');
  const fd = openSync(filename, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || info.size > limit
      || process.platform !== 'win32' && ((info.mode & 0o022) !== 0 || process.getuid && info.uid !== process.getuid())) {
      fail('project_invalid_private_record');
    }
    const bytes = Buffer.alloc(limit + 1);
    let count = 0, read;
    while (count < bytes.length && (read = readSync(fd, bytes, count, bytes.length - count, null)) > 0) count += read;
    if (count > limit) fail('project_invalid_private_record');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count)));
  } finally { closeSync(fd); }
}

export function writePrivateJson(filename, value, { limit = STATE_LIMIT, exclusive = false } = {}) {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(contents) > limit) fail('project_state_limit');
  const temporary = exclusive ? filename : path.join(path.dirname(filename), `.project-${randomUUID()}.tmp`);
  let fd, created = false;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    created = true;
    writeFileSync(fd, contents);
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    if (!exclusive) renameSync(temporary, filename);
    syncDirectory(path.dirname(filename));
  } finally {
    if (fd !== undefined) closeSync(fd);
    // An exclusively created intent remains evidence even after a short write.
    if (!exclusive && created) {
      try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

export function removePrivateRecord(filename) {
  unlinkSync(filename);
  syncDirectory(path.dirname(filename));
}

export function persist(state) {
  writePrivateJson(path.join(state.sessionRoot, 'project-session.json'), state);
}

export function readState(sessionRoot) {
  const state = readPrivateJson(path.join(sessionRoot, 'project-session.json'));
  if (state?.kind !== 'koto-project-session' || state.schemaVersion !== 1
    || typeof state.sessionRoot !== 'string' || path.resolve(state.sessionRoot) !== path.resolve(sessionRoot)
    || !Array.isArray(state.agents)) fail('project_invalid_session');
  return state;
}

export function agentRecord(state, id) {
  const record = state.agents.find(agent => agent.id === id);
  if (!record) fail('project_unknown_agent');
  return record;
}

export function assertNoContributionAttempt(sessionRoot) {
  try { lstatSync(path.join(sessionRoot, CONTRIBUTION_ATTEMPT_FILE)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  fail('project_contribution_attempt_unresolved');
}

export function hasUnconfirmedCleanup(agent) {
  const unknown = outcome => typeof outcome?.error === 'string' && /(?:^|_)cleanup_unconfirmed$/.test(outcome.error);
  return unknown(agent.result) || unknown(agent.commandOutcome)
    || (agent.attempts ?? []).some(attempt => unknown(attempt.result) || unknown(attempt.commandOutcome));
}

export function requireSettled(state, { allowConflicts = false } = {}) {
  if (state.active || state.agents.some(agent => ['pending', 'running'].includes(agent.status))) fail('project_session_must_finish_before_integration');
  if (state.agents.some(hasUnconfirmedCleanup)) fail('project_agent_cleanup_not_confirmed');
  if (!allowConflicts && state.agents.some(agent => agent.integration?.status === 'conflicts')) fail('project_integration_conflicts_unresolved');
}

export function lease(sessionRoot, { allowPending = false, purpose = 'session' } = {}) {
  if (!allowPending) assertNoContributionAttempt(sessionRoot);
  const filename = path.join(sessionRoot, 'integration.lock');
  let fd;
  try { fd = openSync(filename, 'wx', 0o600); }
  catch { fail('project_integration_busy_or_interrupted'); }
  const info = { kind: 'koto-project-lease', schemaVersion: 1, ownerPid: process.pid,
    leaseId: randomUUID(), purpose, createdAt: new Date().toISOString() };
  try { writeFileSync(fd, `${JSON.stringify(info)}\n`); fsyncSync(fd); syncDirectory(sessionRoot); }
  catch (error) { closeSync(fd); throw error; }
  // Another process can finish an ambiguous attempt between the precheck and
  // exclusive creation. Consult the marker again while holding our lease.
  try { if (!allowPending) assertNoContributionAttempt(sessionRoot); }
  catch (error) { closeSync(fd); removePrivateRecord(filename); throw error; }
  let closed = false;
  const release = () => {
    if (closed) return;
    closed = true;
    closeSync(fd);
    const saved = readPrivateJson(filename, 4096);
    if (saved.leaseId !== info.leaseId) fail('project_integration_lease_changed');
    removePrivateRecord(filename);
  };
  return Object.assign(release, info);
}
