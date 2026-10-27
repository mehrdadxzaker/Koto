// A separate explicit dispatch after the operator has reviewed stage one's diff.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.OBS_OPERATION !== 'integrate') throw new Error('explicit_integration_dispatch_required');
const root = process.env.OBS_ROOT, token = process.env.OBS_REVIEW_TOKEN;
if (!root || !/^[a-f0-9]{64}$/.test(token ?? '')) throw new Error('reviewed_token_required');
process.env.KOTO_STATE_DIR = path.join(root, 'state');
const prior = JSON.parse(readFileSync(path.join(root, 'evidence', 'observation.json'), 'utf8'));
const original = prior.inspections?.contributor;
if (prior.candidate !== process.env.OBS_CANDIDATE || prior.root !== root || prior.platform !== process.platform
  || !original || token !== original.reviewToken || original.outsideOwnership.length
  || !original.integrationChangedPaths.length) throw new Error('reviewed_observation_mismatch');
const api = await import(pathToFileURL(path.join(root, 'install', 'node_modules', '@mehrdadxzaker', 'koto', 'src', 'index.js')));
await api.resolveTerminalHelper({ directory: path.join(root, 'state', 'native') });
const state = api.readProjectSession(prior.sessionRoot);
if (state.active || state.agents.some(a => ['pending', 'running'].includes(a.status))) throw new Error('restored_session_not_settled');
const now = await api.inspectProjectSession(prior.sessionRoot, 'contributor');
if (now.reviewToken !== token || now.tree !== original.tree || now.headCommit !== original.headCommit
  || now.outsideOwnership.length || now.integrationDiff !== original.integrationDiff) throw new Error('restored_review_changed');
const projectState = () => {
  const git = args => execFileSync('git', ['-C', path.join(root, 'project'), '-c',
    `core.hooksPath=${path.join(root, 'disabled-hooks')}`, ...args],
  { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
  return { head: git(['rev-parse', 'HEAD']), status: git(['status', '--porcelain=v1', '--untracked-files=all']) };
};
const projectBefore = projectState();
if (projectBefore.head !== prior.candidate || projectBefore.status) throw new Error('original_project_changed');
const record = { schemaVersion: 1, candidate: prior.candidate, stageOneRoot: root,
  sourceArtifactId: process.env.OBS_ARTIFACT_ID, sourceArtifactDigest: process.env.OBS_ARTIFACT_DIGEST,
  approvedReviewToken: token, before: now, projectBefore, startedAt: new Date().toISOString() };
try {
  record.result = await api.integrateProjectSession(prior.sessionRoot, 'contributor', { approve: token });
  record.after = await api.inspectProjectSession(prior.sessionRoot, 'contributor');
  if (record.result.status !== 'integrated') process.exitCode = 1;
} catch (error) {
  record.error = error.code ?? error.message;
  process.exitCode = 1;
} finally {
  try {
    record.projectAfter = projectState();
    if (JSON.stringify(record.projectAfter) !== JSON.stringify(projectBefore)) {
      record.error ??= 'original_project_changed'; process.exitCode = 1;
    }
  } catch (error) { record.error ??= 'original_project_read_failed'; process.exitCode = 1; }
  record.finishedAt = new Date().toISOString();
  writeFileSync(path.join(root, 'evidence', 'integration.json'), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}
