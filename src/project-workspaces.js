import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { resolveTerminalHelper } from './terminal-helper.js';
import { startTerminalCommand } from './terminal-session.js';
import { verifyWindowsPrivateDirectory } from './windows-native-helper.js';
import { writePrivateJson as retainJson, removePrivateRecord, assertNoContributionAttempt } from './project-session-store.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SHA = /^[0-9a-f]{40,64}$/;
const LIMIT = 4 * 1024 * 1024;
const MANIFEST = 'workspaces.json';
const RECEIPT_LIMIT = 64 * 1024;
let executablePromise;
const workspaceTransport = new AsyncLocalStorage();

function failure(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  return error;
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function checkedId(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) throw failure('workspace_invalid_id', label);
  return value;
}

function digest(value) { return createHash('sha256').update(value).digest('hex'); }

function helperDirectory(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !isAbsolute(value) || !value.trim() || value.includes('\0') || Buffer.byteLength(value) > 4096) {
    throw failure('workspace_invalid_helper_directory');
  }
  return resolve(value);
}

async function windowsGit(cwd, executable, args, { env, allow, input, limit }) {
  const body = Buffer.from(input ?? '');
  const context = workspaceTransport.getStore();
  if (!context) throw failure('workspace_transport_missing');
  context.helper ??= resolveTerminalHelper({ directory: context.directory });
  const helperPath = await context.helper;
  const stdout = [], stderr = [];
  let bytes = 0, reason, completed = false, inputFinished = false;
  const handle = startTerminalCommand({ id: 'workspace-git', command: executable, args, cwd,
    env: environment(env), helperPath, transport: 'pipe', timeoutMs: 30_000,
    onEvent(event) {
      if (event.type !== 'output' || reason) return;
      bytes += Buffer.byteLength(event.text);
      if (bytes > limit) { reason = failure('workspace_git_output_limit'); handle.stop(); return; }
      (event.stream === 'stderr' ? stderr : stdout).push(event.text);
    } });
  const pending = handle.completion.then(result => { completed = true; return result; });
  // Preserve NUL-delimited Git input and respect the transport's bounded frame
  // queue. Yield between frames so native Git can consume long path lists.
  const feed = (async () => {
    let offset = 0;
    while (!completed && !reason && offset < body.length) {
      const end = Math.min(offset + 16_384, body.length);
      if (handle.send(body.subarray(offset, end))) offset = end;
      await new Promise(accept => setTimeout(accept, 5));
    }
    while (!completed && !reason) {
      if (handle.endInput()) { inputFinished = true; return; }
      await new Promise(accept => setTimeout(accept, 5));
    }
  })();
  const completion = await pending;
  await feed;
  // A process exit alone cannot establish that Git's descendants were stopped.
  if (completion.error === 'cleanup_unconfirmed') throw failure('workspace_git_cleanup_unconfirmed');
  if (reason) throw reason;
  if (completion.error && completion.error !== 'exit_failed') throw failure(`workspace_git_${completion.error}`);
  if (!inputFinished) throw failure('workspace_git_input_failed');
  const result = { code: completion.exitCode, stdout: stdout.join(''), stderr: stderr.join('') };
  if (!allow.includes(result.code)) throw failure('workspace_git_failed', result.stderr.trim() || `Git exited ${result.code}`);
  return result;
}

function gitExecutable() {
  executablePromise ??= (async () => {
    for (const directory of (process.env.PATH ?? '').split(delimiter)) {
      // Never search the worker's current directory or relative PATH entries.
      if (!directory || !isAbsolute(directory)) continue;
      const candidate = join(directory, process.platform === 'win32' ? 'git.exe' : 'git');
      try {
        const executable = await realpath(candidate);
        if (!(await lstat(executable)).isFile()) continue;
        await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return executable;
      } catch { /* Continue through explicitly absolute PATH entries. */ }
    }
    throw failure('workspace_git_unavailable', 'Install Git on an absolute PATH entry.');
  })();
  return executablePromise;
}

// Do not inherit Git directory/index/config redirections from the calling shell.
function environment(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', ...extra };
}

async function git(cwd, args, { hooks, env, allow = [0], input, limit = LIMIT } = {}) {
  const executable = await gitExecutable();
  const config = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
    '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', 'core.quotePath=false',
    '-c', 'core.splitIndex=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'rerere.enabled=false'];
  if (hooks) config.push('-c', `core.hooksPath=${hooks}`);
  if (process.platform === 'win32') return windowsGit(cwd, executable, [...config, ...args], { env, allow, input, limit });
  return new Promise((accept, reject) => {
    const child = spawn(executable, [...config, ...args], { cwd, shell: false,
      detached: process.platform !== 'win32', windowsHide: true, env: environment(env), stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    let bytes = 0, settled = false, reason, killTimer, closeTimer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(closeTimer);
      if (error) reject(error); else accept(result);
    };
    const kill = (signal) => {
      try {
        if (process.platform === 'win32') child.kill(signal);
        else if (child.pid) process.kill(-child.pid, signal);
      } catch { /* A process may have already exited. */ }
    };
    const stop = (code) => {
      if (reason) return;
      reason = failure(code);
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 250);
      closeTimer = setTimeout(() => {
        kill('SIGKILL'); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
        finish(reason);
      }, 1_500);
    };
    const timer = setTimeout(() => stop('workspace_git_timeout'), 30_000);
    const consume = (target, data) => {
      bytes += data.length;
      if (bytes > limit) return stop('workspace_git_output_limit');
      target.push(data);
    };
    child.stdout.on('data', data => consume(stdout, data));
    child.stderr.on('data', data => consume(stderr, data));
    child.stdout.on('error', () => stop('workspace_git_output_failed'));
    child.stderr.on('error', () => stop('workspace_git_output_failed'));
    child.stdin.on('error', () => stop('workspace_git_input_failed'));
    child.on('error', () => finish(failure('workspace_git_unavailable')));
    child.once('close', code => {
      const result = { code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
      if (reason) finish(reason);
      else if (!allow.includes(code)) finish(failure('workspace_git_failed', result.stderr.trim() || `Git exited ${code}`));
      else finish(null, result);
    });
    child.stdin.end(input);
  });
}

async function canonical(path) {
  if (typeof path !== 'string' || !path.trim() || path.includes('\0')) throw failure('workspace_invalid_path');
  return realpath(resolve(path));
}

async function repository(path, hooks) {
  const root = await canonical(path);
  if (inside(root, await gitExecutable())) throw failure('workspace_git_executable_overlap');
  const options = { hooks };
  const top = await canonical((await git(root, ['rev-parse', '--show-toplevel'], options)).stdout.trim());
  if (top !== root) throw failure('workspace_project_root_required', 'Select the repository root, not a nested directory.');
  if ((await git(root, ['rev-parse', '--show-superproject-working-tree'], options)).stdout.trim()) {
    throw failure('workspace_submodule_unsupported');
  }
  const common = (await git(root, ['rev-parse', '--git-common-dir'], options)).stdout.trim();
  const commonDir = await canonical(resolve(root, common));
  // Custom clean filters and merge drivers can execute repository-configured programs.
  const custom = await git(root, ['config', '--name-only', '--get-regexp', String.raw`^(filter\..*|merge\..*\.driver)$`],
    { ...options, allow: [0, 1] });
  if (custom.stdout.trim()) throw failure('workspace_custom_git_driver_unsupported', 'Custom Git filters and merge drivers require a separately reviewed integration.');
  return { root, commonDir };
}

async function privateDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()
    || (process.platform !== 'win32' && ((info.mode & 0o022) !== 0
      || (process.getuid && info.uid !== process.getuid())))) throw failure('workspace_control_not_private');
  if (process.platform === 'win32') {
    try { await verifyWindowsPrivateDirectory(path); }
    catch (error) {
      if (error.code === 'windows_pty_build_cleanup_unconfirmed') throw error;
      throw failure('workspace_control_not_private', 'Workspace control storage must be owned by this user with no untrusted writers. Choose a private directory under the user profile. No permissions were changed.');
    }
  }
}

async function disabledHooks(path) {
  await privateDirectory(path);
  if ((await readdir(path)).length) throw failure('workspace_hooks_directory_changed');
}

async function status(path, hooks) {
  const raw = (await git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'], { hooks })).stdout;
  const entries = [];
  const parts = raw.split('\0');
  for (let i = 0; i < parts.length; i += 1) {
    if (!parts[i]) continue;
    const code = parts[i].slice(0, 2), path = parts[i].slice(3);
    const entry = { code, path };
    if (/[RC]/.test(code)) entry.originalPath = parts[++i];
    entries.push(entry);
  }
  return { raw, entries };
}

async function writeManifest(manifest) {
  await writeFile(join(manifest.sessionRoot, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

/** Create isolated branches/worktrees. Nothing is ever removed automatically. */
export async function createProjectWorkspaces(options = {}) {
  const directory = helperDirectory(options.nativeHelperDirectory);
  return workspaceTransport.run({ directory }, () => createWorkspaces({ ...options, nativeHelperDirectory: directory }));
}

async function createWorkspaces({ projectRoot, controlRoot, sessionId, agents, nativeHelperDirectory } = {}) {
  checkedId(sessionId, 'sessionId');
  if (!Array.isArray(agents) || agents.length < 1 || agents.length > 16) throw failure('workspace_invalid_agents');
  const ids = agents.map(agent => checkedId(agent?.id, 'agent id'));
  if (new Set(ids).size !== ids.length) throw failure('workspace_duplicate_agent');
  const project = await repository(projectRoot);
  const initial = await status(project.root);
  if (initial.raw) throw failure('workspace_project_dirty', 'Commit or preserve all project changes before starting an isolated session.');
  const baseCommit = (await git(project.root, ['rev-parse', '--verify', 'HEAD^{commit}'])).stdout.trim();
  if (!SHA.test(baseCommit)) throw failure('workspace_invalid_base');
  const projectBranch = (await git(project.root, ['symbolic-ref', '--quiet', 'HEAD'], { allow: [0, 1] })).stdout.trim() || null;
  const control = resolve(controlRoot ?? join(tmpdir(), 'koto-project-control'));
  await mkdir(control, { recursive: true, mode: 0o700 });
  const canonicalControl = await canonical(control);
  await privateDirectory(canonicalControl);
  const containing = await git(canonicalControl, ['rev-parse', '--show-toplevel'], { allow: [0, 128] });
  if (containing.code === 0 || inside(project.root, canonicalControl) || inside(canonicalControl, project.root)) {
    throw failure('workspace_control_overlap', 'Control files must be outside project worktrees.');
  }
  const workspaceParent = `${canonicalControl}-worktrees`;
  await mkdir(workspaceParent, { recursive: true, mode: 0o700 });
  if (await canonical(workspaceParent) !== workspaceParent) throw failure('workspace_path_redirected');
  await privateDirectory(workspaceParent);
  if ((await git(workspaceParent, ['rev-parse', '--show-toplevel'], { allow: [0, 128] })).code === 0) {
    throw failure('workspace_control_overlap', 'Workspace storage must be outside existing worktrees.');
  }
  const sessionRoot = join(canonicalControl, sessionId);
  const workspaceRoot = join(workspaceParent, sessionId);
  await mkdir(sessionRoot, { mode: 0o700 });
  await mkdir(workspaceRoot, { mode: 0o700 });
  const hooks = join(sessionRoot, 'disabled-hooks');
  await mkdir(hooks, { mode: 0o700 });
  const entry = name => ({ path: join(workspaceRoot, name), branch: `koto/${sessionId}/${name}`, sessionRoot });
  const manifest = { schemaVersion: 1, sessionId, projectRoot: project.root, projectBranch, baseCommit,
    commonDir: project.commonDir, controlRoot: canonicalControl, sessionRoot, workspaceRoot,
    ...(nativeHelperDirectory === undefined ? {} : { nativeHelperDirectory }),
    integration: entry('integration'), agents: Object.fromEntries(ids.map(id => [id, entry(`agent-${id}`)])) };
  await writeManifest(manifest);
  for (const workspace of [manifest.integration, ...Object.values(manifest.agents)]) {
    await git(project.root, ['worktree', 'add', '--no-track', '-b', workspace.branch, workspace.path, baseCommit], { hooks });
  }
  if ((await status(project.root, hooks)).raw
    || (await git(project.root, ['rev-parse', 'HEAD'], { hooks })).stdout.trim() !== baseCommit
    || ((await git(project.root, ['symbolic-ref', '--quiet', 'HEAD'], { hooks, allow: [0, 1] })).stdout.trim() || null) !== projectBranch) {
    throw failure('workspace_project_changed', 'The project changed during preparation; created worktrees were preserved.');
  }
  return manifest;
}

async function workspaceMetadata(workspace) {
  if (!workspace || typeof workspace !== 'object') throw failure('workspace_not_owned');
  const sessionRoot = await canonical(workspace.sessionRoot);
  await privateDirectory(sessionRoot);
  const manifestPath = join(sessionRoot, MANIFEST);
  let manifest;
  try { manifest = await readPrivateJson(manifestPath, 128 * 1024); }
  catch { throw failure('workspace_invalid_manifest'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || manifest.schemaVersion !== 1 || manifest.sessionRoot !== sessionRoot
      || typeof manifest.baseCommit !== 'string' || !SHA.test(manifest.baseCommit)
      || typeof manifest.controlRoot !== 'string' || !isAbsolute(manifest.controlRoot)
      || typeof manifest.sessionId !== 'string' || !ID.test(manifest.sessionId)
      || manifest.sessionRoot !== join(manifest.controlRoot, manifest.sessionId)
      || manifest.workspaceRoot !== join(`${manifest.controlRoot}-worktrees`, manifest.sessionId)
      || !manifest.agents || typeof manifest.agents !== 'object' || Array.isArray(manifest.agents)
      || !manifest.integration || typeof manifest.integration !== 'object'
      || (manifest.nativeHelperDirectory !== undefined
        && helperDirectory(manifest.nativeHelperDirectory) !== manifest.nativeHelperDirectory)) {
    throw failure('workspace_invalid_manifest');
  }
  const known = [manifest.integration, ...Object.values(manifest.agents)].find(entry =>
    entry && entry.path === workspace.path && entry.branch === workspace.branch && entry.sessionRoot === sessionRoot);
  if (!known || !inside(manifest.workspaceRoot, known.path) || inside(known.path, sessionRoot)
    || await canonical(known.path) !== known.path) throw failure('workspace_not_owned');
  const hooks = join(sessionRoot, 'disabled-hooks');
  await disabledHooks(hooks);
  return { manifest, workspace: known, hooks };
}

async function withWorkspaceTransport(workspace, operation) {
  const { manifest } = await workspaceMetadata(workspace);
  return workspaceTransport.run({ directory: manifest.nativeHelperDirectory, sessionRoot: manifest.sessionRoot }, operation);
}

async function owned(workspace) {
  const context = await workspaceMetadata(workspace);
  const { manifest, workspace: known, hooks } = context;
  const transport = workspaceTransport.getStore();
  if (!transport || transport.sessionRoot !== manifest.sessionRoot
    || transport.directory !== manifest.nativeHelperDirectory) throw failure('workspace_manifest_changed');
  const repo = await repository(known.path, hooks);
  if (repo.commonDir !== manifest.commonDir) throw failure('workspace_repository_changed');
  const branch = (await git(known.path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { hooks })).stdout.trim();
  if (branch !== known.branch) throw failure('workspace_branch_changed');
  const ancestor = await git(known.path, ['merge-base', '--is-ancestor', manifest.baseCommit, 'HEAD'], { hooks, allow: [0, 1] });
  if (ancestor.code !== 0) throw failure('workspace_base_changed');
  return context;
}

async function indexPath(context) {
  const { workspace, hooks, manifest } = context;
  const requested = resolve(workspace.path, (await git(workspace.path, ['rev-parse', '--git-path', 'index'], { hooks })).stdout.trim());
  const path = join(await canonical(dirname(requested)), basename(requested));
  if (!inside(manifest.commonDir, path)) throw failure('workspace_index_redirected');
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw failure('workspace_index_redirected');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const flags = (await git(workspace.path, ['ls-files', '-v', '-z'], { hooks })).stdout.split('\0');
  if (flags.some(entry => entry && /^[a-zS]/.test(entry))) {
    throw failure('workspace_hidden_index_entries', 'Clear assume-unchanged/skip-worktree flags before reviewing contributions.');
  }
  return path;
}

// A private temporary index captures the effective tree without changing the
// caller's index. Git objects are retained; no worktree files are rewritten.
async function captureTree(context) {
  const { workspace, manifest, hooks } = context;
  const temporary = await mkdtemp(join(manifest.sessionRoot, 'review-index-'));
  const index = join(temporary, 'index');
  const env = { GIT_INDEX_FILE: index };
  try {
    const originalIndex = await indexPath(context);
    try { await copyFile(originalIndex, index); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await git(workspace.path, ['read-tree', 'HEAD'], { hooks, env });
    }
    await git(workspace.path, ['add', '-A', '--', '.'], { hooks, env });
    return (await git(workspace.path, ['write-tree'], { hooks, env })).stdout.trim();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function sameWorkspace(left, right) {
  return left?.path === right.path && left?.branch === right.branch
    && left?.sessionRoot === right.sessionRoot;
}

function receiptPath(context) {
  return join(context.manifest.sessionRoot, `integration-${digest(context.workspace.branch)}.json`);
}

function conflictReceiptPath(context) {
  return join(context.manifest.sessionRoot, `integration-conflict-${digest(context.workspace.branch)}.json`);
}

function receiptBinding(receipt) {
  const workspace = value => ({ path: value?.path, branch: value?.branch, sessionRoot: value?.sessionRoot });
  return JSON.stringify({ workspace: workspace(receipt.workspace), integration: workspace(receipt.integration),
    snapshotCommit: receipt.snapshotCommit, contributionCommit: receipt.contributionCommit,
    contributionBaseCommit: receipt.contributionBaseCommit,
    integrationBaseCommit: receipt.integrationBaseCommit,
    reviewTree: receipt.reviewTree, integrationCommit: receipt.integrationCommit });
}

async function readPrivateJson(filename, limit) {
  let file;
  try {
    const before = await lstat(filename);
    if (!before.isFile() || before.isSymbolicLink()) throw failure('workspace_integration_receipt_invalid');
    file = await open(filename, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
    const info = await file.stat();
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || info.size > limit || (process.platform !== 'win32'
      && ((info.mode & 0o022) !== 0 || process.getuid && info.uid !== process.getuid()))) {
      throw failure('workspace_integration_receipt_invalid');
    }
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > limit) throw failure('workspace_integration_receipt_invalid');
    return JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } finally { await file?.close(); }
}

// A caller cannot select an arbitrary delta parent. Require the exact retained
// successful receipt, then verify its objects still belong to both histories.
async function integrationBasis(source, previousIntegration, suppliedTarget) {
  let saved, receiptPresent = false;
  try { saved = await readPrivateJson(receiptPath(source), RECEIPT_LIMIT); receiptPresent = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (receiptPresent && (!saved || typeof saved !== 'object' || Array.isArray(saved)
    || saved.kind !== 'koto-workspace-integration' || saved.schemaVersion !== 1
    || saved.baseCommit !== source.manifest.baseCommit
    || !saved.receipt || typeof saved.receipt !== 'object' || Array.isArray(saved.receipt)
    || saved.receipt.status !== 'integrated')) {
    throw failure('workspace_integration_receipt_invalid');
  }
  if (previousIntegration === undefined) {
    if (receiptPresent) throw failure('workspace_previous_integration_required', 'Use the retained successful integration as the baseline for this contribution.');
    return source.manifest.baseCommit;
  }
  const previous = previousIntegration;
  if (!previous || previous.status !== 'integrated'
    || !sameWorkspace(previous.workspace, source.workspace)
    || !sameWorkspace(previous.integration, source.manifest.integration)
    || ![previous.snapshotCommit, previous.contributionCommit, previous.reviewTree, previous.integrationCommit].every(value => typeof value === 'string' && SHA.test(value))
    || previous.contributionBaseCommit !== undefined && !SHA.test(previous.contributionBaseCommit)) {
    throw failure('workspace_previous_integration_invalid');
  }
  if (receiptPresent) {
    if (receiptBinding(saved.receipt) !== receiptBinding(previous)) throw failure('workspace_previous_integration_changed');
  } else {
    // Older sessions saved the receipt in the project record before the
    // workspace layer retained its own copy. Accept only that exact record.
    let state;
    try { state = await readPrivateJson(join(source.manifest.sessionRoot, 'project-session.json'), 1024 * 1024); }
    catch { throw failure('workspace_previous_integration_unrecognized'); }
    const record = state?.kind === 'koto-project-session' && state.schemaVersion === 1
      && state.sessionRoot === source.manifest.sessionRoot && Array.isArray(state.agents)
      ? state.agents.find(agent => sameWorkspace(agent.workspace, source.workspace)) : undefined;
    if (![record?.integration, record?.lastSuccessfulIntegration].some(receipt => receipt?.status === 'integrated'
      && receiptBinding(receipt) === receiptBinding(previous))) throw failure('workspace_previous_integration_unrecognized');
  }
  const target = suppliedTarget ?? await owned(source.manifest.integration);
  const sourceOptions = { hooks: source.hooks };
  const targetOptions = { hooks: target.hooks };
  const snapshotTree = (await git(source.workspace.path, ['rev-parse', `${previous.snapshotCommit}^{tree}`], sourceOptions)).stdout.trim();
  const contributionTree = (await git(source.workspace.path, ['rev-parse', `${previous.contributionCommit}^{tree}`], sourceOptions)).stdout.trim();
  const parent = (await git(source.workspace.path, ['show', '-s', '--format=%P', previous.contributionCommit], sourceOptions)).stdout.trim();
  const previousBase = previous.contributionBaseCommit ?? source.manifest.baseCommit;
  const sourceAncestor = await git(source.workspace.path, ['merge-base', '--is-ancestor', previous.snapshotCommit, 'HEAD'], { ...sourceOptions, allow: [0, 1] });
  const baseAncestor = await git(source.workspace.path, ['merge-base', '--is-ancestor', previousBase, previous.snapshotCommit], { ...sourceOptions, allow: [0, 1] });
  const targetAncestor = await git(target.workspace.path, ['merge-base', '--is-ancestor', previous.integrationCommit, 'HEAD'], { ...targetOptions, allow: [0, 1] });
  if (snapshotTree !== previous.reviewTree || contributionTree !== previous.reviewTree
    || parent !== previousBase || sourceAncestor.code !== 0 || baseAncestor.code !== 0 || targetAncestor.code !== 0) {
    throw failure('workspace_previous_integration_changed', 'The retained contribution or integration history changed; inspect and recover it explicitly.');
  }
  return previous.snapshotCommit;
}

async function saveIntegrationReceipt(source, receipt, attemptId) {
  retainJson(receiptPath(source), { kind: 'koto-workspace-integration', schemaVersion: 1,
    baseCommit: source.manifest.baseCommit, ...(attemptId ? { attemptId } : {}),
    receipt: { ...receipt } }, { limit: RECEIPT_LIMIT });
}

async function saveConflictReceipt(source, receipt, attemptId, target) {
  const current = await contributionTargetState(target);
  if (current.head !== receipt.integrationCommit || current.cherryPickHead !== receipt.contributionCommit
    || JSON.stringify(current.entries) !== JSON.stringify(receipt.statusEntries)) throw failure('workspace_attempt_conflicts_changed');
  retainJson(conflictReceiptPath(source), { kind: 'koto-workspace-conflict', schemaVersion: 1,
    baseCommit: source.manifest.baseCommit, ...(attemptId ? { attemptId } : {}),
    targetStateToken: current.stateToken,
    receipt: { ...receipt, conflictsHash: digest(JSON.stringify(receipt.conflicts)) } }, { limit: RECEIPT_LIMIT });
}

async function noCherryPick(target) {
  const filename = (await git(target.workspace.path, ['rev-parse', '--git-path', 'CHERRY_PICK_HEAD'], { hooks: target.hooks })).stdout.trim();
  try { await lstat(resolve(target.workspace.path, filename)); throw failure('workspace_conflict_pending'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function inspect(context, previousIntegration, suppliedBasis) {
  const { workspace, manifest, hooks } = context;
  const contributionBaseCommit = suppliedBasis ?? await integrationBasis(context, previousIntegration);
  const headCommit = (await git(workspace.path, ['rev-parse', 'HEAD'], { hooks })).stdout.trim();
  const before = await status(workspace.path, hooks);
  const conflicts = before.entries.filter(entry => /^(DD|AU|UD|UA|DU|AA|UU)$/.test(entry.code)).map(entry => entry.path);
  if (conflicts.length) return { ...workspace, baseCommit: manifest.baseCommit, headCommit, contributionBaseCommit,
    clean: false, status: before.entries, changedPaths: [], diff: '', integrationChangedPaths: [], integrationDiff: '', untracked: [], conflicts, reviewToken: null };
  const indexState = (await git(workspace.path, ['ls-files', '--stage', '-z'], { hooks })).stdout;
  const tree = await captureTree(context);
  const diff = (await git(workspace.path, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames',
    manifest.baseCommit, tree, '--'], { hooks })).stdout;
  const changedPaths = (await git(workspace.path, ['diff', '--name-only', '-z', '--no-renames', manifest.baseCommit, tree, '--'], { hooks })).stdout.split('\0').filter(Boolean);
  const integrationDiff = contributionBaseCommit === manifest.baseCommit ? diff
    : (await git(workspace.path, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', contributionBaseCommit, tree, '--'], { hooks })).stdout;
  const integrationChangedPaths = contributionBaseCommit === manifest.baseCommit ? changedPaths
    : (await git(workspace.path, ['diff', '--name-only', '-z', '--no-renames', contributionBaseCommit, tree, '--'], { hooks })).stdout.split('\0').filter(Boolean);
  const untracked = [];
  for (const item of before.entries.filter(entry => entry.code === '??')) {
    const info = await lstat(join(workspace.path, item.path));
    const blob = (await git(workspace.path, ['rev-parse', `${tree}:${item.path}`], { hooks })).stdout.trim();
    untracked.push({ path: item.path, bytes: info.size, blob,
      kind: info.isSymbolicLink() ? 'symlink' : info.isFile() ? 'file' : 'directory' });
  }
  const after = await status(workspace.path, hooks);
  if (after.raw !== before.raw || tree !== await captureTree(context)
    || indexState !== (await git(workspace.path, ['ls-files', '--stage', '-z'], { hooks })).stdout
    || headCommit !== (await git(workspace.path, ['rev-parse', 'HEAD'], { hooks })).stdout.trim()) {
    throw failure('workspace_changed_during_review', 'Stop the agent and inspect again.');
  }
  const reviewToken = digest(JSON.stringify({ baseCommit: manifest.baseCommit, contributionBaseCommit, headCommit, tree, indexState, status: before.raw }));
  return { ...workspace, baseCommit: manifest.baseCommit, contributionBaseCommit, headCommit, tree,
    clean: !before.raw, status: before.entries, changedPaths, diff, integrationChangedPaths, integrationDiff, untracked, conflicts: [], reviewToken };
}

/** Review all changes since the session base, including committed/untracked work.
 * Binary changes receive Git's explicit binary summary; the tree/token binds
 * their complete contents. This is a freshness check, not a security sandbox.
 */
export async function inspectWorkspace({ workspace, previousIntegration } = {}) {
  return withWorkspaceTransport(workspace, async () => inspect(await owned(workspace), previousIntegration));
}

async function noProjectOperation(context, directory) {
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
    const filename = (await git(directory, ['rev-parse', '--git-path', name], { hooks: context.hooks })).stdout.trim();
    try {
      await lstat(resolve(directory, filename));
      throw failure('project_merge_git_operation_pending', 'Finish or preserve the existing Git merge, rebase or cherry-pick before merging approved Koto changes.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function approvedIntegrationHistory(context, integrationCommit) {
  const { manifest, hooks, workspace } = context;
  const archives = (await readdir(manifest.sessionRoot)).filter(name => /^contribution-attempt-[a-f0-9-]{36}\.json$/.test(name));
  const changed = () => failure('project_merge_integration_changed', 'The integration history contains changes without a retained approval receipt. Keep the workspaces and review this merge manually.');
  if (archives.length > 1024) throw changed();
  const approved = new Map();
  for (const name of archives) {
    let attempt;
    try { attempt = await readPrivateJson(join(manifest.sessionRoot, name), 128 * 1024); }
    catch { throw changed(); }
    const receipt = attempt?.result;
    if (attempt?.resolution !== 'record-result' || receipt?.status !== 'integrated') continue;
    if (attempt.kind !== 'koto-contribution-attempt' || attempt.schemaVersion !== 1
      || attempt.sessionRoot !== manifest.sessionRoot || attempt.sessionId !== manifest.sessionId
      || attempt.baseCommit !== manifest.baseCommit
      || !Object.hasOwn(manifest.agents, attempt.agentId)
      || !sameWorkspace(receipt.integration, workspace)
      || !sameWorkspace(receipt.workspace, manifest.agents[attempt.agentId])
      || !sameWorkspace(attempt.workspace, receipt.workspace) || !sameWorkspace(attempt.integration, workspace)
      || ![receipt.integrationCommit, receipt.integrationBaseCommit].every(value => typeof value === 'string' && SHA.test(value))) throw changed();
    if (attempt.operation === 'integrate') {
      if (receipt.integrationBaseCommit !== attempt.before?.integrationHead || !/^[a-f0-9]{64}$/.test(attempt.approval ?? '')) throw changed();
    } else if (attempt.operation === 'resolve') {
      // A conflict-resolution commit has its own explicit full-commit approval.
      if (attempt.approval !== receipt.integrationCommit || receipt.resolvedFromCommit !== attempt.conflictIntegration?.integrationCommit
        || receipt.integrationBaseCommit !== attempt.conflictIntegration?.integrationBaseCommit) throw changed();
    } else throw changed();
    const previous = approved.get(receipt.integrationCommit);
    if (previous && previous !== receipt.integrationBaseCommit) throw changed();
    approved.set(receipt.integrationCommit, receipt.integrationBaseCommit);
  }
  const lines = (await git(workspace.path, ['rev-list', '--first-parent', '--parents', '--max-count=1025',
    integrationCommit, '--not', manifest.baseCommit], { hooks })).stdout.trim().split('\n').filter(Boolean);
  if (lines.length > 1024) throw changed();
  let cursor = integrationCommit;
  for (const line of lines) {
    const [commit, parent, ...others] = line.split(' ');
    if (commit !== cursor || !parent || others.length || approved.get(commit) !== parent) throw changed();
    cursor = parent;
  }
  if (cursor !== manifest.baseCommit) throw changed();
}

async function projectMergeSnapshot({ integration, projectRoot, projectBranch, expectedProjectCommit, integrationCommit }) {
  const context = await owned(integration);
  const { manifest, hooks } = context;
  if (manifest.projectRoot !== projectRoot || manifest.projectBranch !== projectBranch
    || typeof projectBranch !== 'string' || !projectBranch.startsWith('refs/heads/')
    || /^refs\/heads\/koto\/[^/]+\/(?:integration|agent-.+)$/.test(projectBranch)) {
    throw failure('project_merge_origin_unavailable', 'This saved build has no supported original-branch binding. Keep its integration workspace and merge it manually, or start a new build from your own project.');
  }
  const integrationHead = (await git(integration.path, ['rev-parse', 'HEAD'], { hooks })).stdout.trim();
  if (Array.isArray(integrationCommit)) {
    if (integrationCommit.length < 1 || integrationCommit.length > 8 || !integrationCommit.includes(integrationHead)) {
      throw failure('project_merge_integration_changed', 'The integration head is not a retained approved contribution.');
    }
    integrationCommit = integrationHead;
  }
  if (![expectedProjectCommit, integrationCommit].every(value => typeof value === 'string' && SHA.test(value))) {
    throw failure('project_merge_integration_changed', 'The retained merge target is invalid. Inspect the saved build before continuing.');
  }
  const original = await repository(projectRoot, hooks);
  if (original.root !== projectRoot || original.commonDir !== manifest.commonDir) throw failure('workspace_repository_changed');
  if ((await git(original.root, ['config', '--bool', '--get', 'merge.verifySignatures'], { hooks, allow: [0, 1] })).stdout.trim() === 'true') {
    throw failure('project_merge_signature_policy_unsupported', 'This project requires verified commit signatures. Review and merge the Koto integration with your normal signature-verification workflow.');
  }
  const originalContext = { ...context, workspace: { path: original.root, branch: projectBranch, sessionRoot: manifest.sessionRoot } };
  await indexPath(originalContext);
  await indexPath(context);
  await noProjectOperation(context, original.root);
  await noProjectOperation(context, integration.path);
  const branch = (await git(original.root, ['symbolic-ref', '--quiet', 'HEAD'], { hooks, allow: [0, 1] })).stdout.trim();
  const beforeCommit = (await git(original.root, ['rev-parse', 'HEAD'], { hooks })).stdout.trim();
  if (branch !== projectBranch || beforeCommit !== expectedProjectCommit) {
    throw failure('project_merge_original_changed', 'Your project branch or commit changed since this build started or last merged. Keep the Koto workspaces; review and merge manually, or start a new build from the current project.');
  }
  if ((await status(original.root, hooks)).raw) {
    throw failure('project_merge_original_dirty', 'Your project has local changes. Commit or preserve them with your normal Git workflow, then ask Koto to merge again. Nothing was stashed or discarded.');
  }
  if ((await status(integration.path, hooks)).raw
    || (await git(integration.path, ['rev-parse', 'HEAD'], { hooks })).stdout.trim() !== integrationCommit) {
    throw failure('project_merge_integration_changed', 'The reviewed integration workspace changed. Inspect and recover its recorded approved commit before merging.');
  }
  await approvedIntegrationHistory(context, integrationCommit);
  const ancestor = await git(original.root, ['merge-base', '--is-ancestor', beforeCommit, integrationCommit], { hooks, allow: [0, 1] });
  if (ancestor.code !== 0) {
    throw failure('project_merge_original_changed', 'The project and approved integration have diverged. Koto only fast-forwards a clean unchanged original branch; review this merge manually.');
  }
  const tree = (await git(integration.path, ['rev-parse', 'HEAD^{tree}'], { hooks })).stdout.trim();
  const diff = (await git(integration.path, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', beforeCommit, integrationCommit, '--'], { hooks })).stdout;
  const changedPaths = (await git(integration.path, ['diff', '--name-only', '-z', '--no-renames', beforeCommit, integrationCommit, '--'], { hooks })).stdout.split('\0').filter(Boolean);
  // Recheck every observed Git store before returning an approval-bound view.
  if ((await status(original.root, hooks)).raw || (await status(integration.path, hooks)).raw
    || (await git(original.root, ['rev-parse', 'HEAD'], { hooks })).stdout.trim() !== beforeCommit
    || (await git(original.root, ['symbolic-ref', '--quiet', 'HEAD'], { hooks, allow: [0, 1] })).stdout.trim() !== branch
    || (await git(integration.path, ['rev-parse', 'HEAD'], { hooks })).stdout.trim() !== integrationCommit) {
    throw failure('project_merge_review_changed', 'The project changed while preparing the merge. Review it again before approving.');
  }
  const view = { status: beforeCommit === integrationCommit ? 'already-merged' : 'ready', projectRoot,
    branch: projectBranch.slice('refs/heads/'.length), beforeCommit, integrationCommit, changedPaths, diff };
  return { ...view, reviewToken: digest(JSON.stringify({ manifest, view, tree })) };
}

/** Observe the original checkout and approved integration; no branch is changed. */
export async function inspectWorkspaceProjectMerge(options) {
  return withWorkspaceTransport(options.integration, () => projectMergeSnapshot(options));
}

/** One ordinary, explicitly approved fast-forward. Unknown outcomes stay owned
 * by the caller's durable intent; no reset, stash, retry or rollback is performed.
 */
export async function mergeWorkspaceProject(options) {
  return withWorkspaceTransport(options.integration, async () => {
    const view = await projectMergeSnapshot(options);
    if (view.reviewToken !== options.approve) throw failure('project_merge_review_changed', 'The displayed merge changed. Review the current changes before approving again.');
    if (view.status === 'already-merged') return view;
    await options.beforeMutation(view);
    const current = await projectMergeSnapshot(options);
    if (current.reviewToken !== view.reviewToken) throw failure('project_merge_review_changed', 'The project changed after approval. Inspect the retained merge attempt before continuing.');
    const context = await owned(options.integration);
    await git(view.projectRoot, ['-c', 'submodule.recurse=false', '-c', 'protocol.allow=never',
      '-c', 'merge.autoStash=false',
      'merge', '--ff-only', '--no-autostash', '--no-edit', '--no-stat', '--no-squash', '--commit', view.integrationCommit],
    { hooks: context.hooks, env: { GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `branch.${view.branch}.mergeOptions`, GIT_CONFIG_VALUE_0: '' } });
    await projectMergeSnapshot({ ...options, expectedProjectCommit: view.integrationCommit });
    return { ...view, status: 'merged' };
  });
}

async function contributionTargetState(target) {
  const options = { hooks: target.hooks };
  const head = (await git(target.workspace.path, ['rev-parse', 'HEAD'], options)).stdout.trim();
  const tree = (await git(target.workspace.path, ['rev-parse', 'HEAD^{tree}'], options)).stdout.trim();
  const entries = await status(target.workspace.path, target.hooks);
  const index = (await git(target.workspace.path, ['ls-files', '--stage', '-z'], options)).stdout;
  const diff = (await git(target.workspace.path, ['diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-renames', 'HEAD', '--'], options)).stdout;
  const cherry = await git(target.workspace.path, ['rev-parse', '--verify', '-q', 'CHERRY_PICK_HEAD'], { ...options, allow: [0, 1] });
  const cherryPickHead = cherry.code === 0 ? cherry.stdout.trim() : null;
  return { head, tree, entries: entries.entries, cherryPickHead,
    stateToken: digest(JSON.stringify({ head, tree, status: entries.raw, index, diff, cherryPickHead })) };
}

/** Private recovery observation: inspect the workspace's own receipt, even when
 * its successful baseline is ahead of project-session.json. Observed refs alone
 * never establish success. A receipt must name this precise retained attempt.
 */
export async function inspectWorkspaceContributionAttempt({ workspace, integration, attempt }) {
  return withWorkspaceTransport(workspace, async () => {
    const source = await owned(workspace), target = await owned(integration);
    if (!sameWorkspace(attempt.workspace, source.workspace) || !sameWorkspace(attempt.integration, target.workspace)
      || source.manifest.sessionRoot !== target.manifest.sessionRoot
      || !sameWorkspace(target.workspace, source.manifest.integration)
      || source.workspace.path === target.workspace.path
      || attempt.baseCommit !== source.manifest.baseCommit) throw failure('workspace_integration_mismatch');
    const review = await inspect(source, undefined, attempt.before.contributionBaseCommit);
    const currentTarget = await contributionTargetState(target);
    let saved, observedResult, receiptError;
    for (const filename of [receiptPath(source), conflictReceiptPath(source)]) {
      let candidate;
      try { candidate = await readPrivateJson(filename, RECEIPT_LIMIT); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (candidate?.attemptId !== attempt.attemptId) continue;
      if (saved) throw failure('workspace_attempt_receipts_ambiguous');
      saved = candidate;
    }
    if (saved) {
      try {
        const receipt = saved.receipt;
        if (saved.schemaVersion !== 1 || saved.baseCommit !== attempt.baseCommit
          || !['integrated', 'conflicts'].includes(receipt?.status)
          || saved.kind !== (receipt.status === 'integrated' ? 'koto-workspace-integration' : 'koto-workspace-conflict')
          || !sameWorkspace(receipt.workspace, source.workspace) || !sameWorkspace(receipt.integration, target.workspace)
          || ![receipt.snapshotCommit, receipt.contributionCommit, receipt.reviewTree, receipt.integrationCommit,
            receipt.contributionBaseCommit].every(value => typeof value === 'string' && SHA.test(value))
          || receipt.reviewTree !== attempt.before.reviewTree
          || receipt.contributionBaseCommit !== attempt.before.contributionBaseCommit
          || receipt.integrationCommit !== currentTarget.head) throw failure('workspace_attempt_receipt_changed');
        const options = { hooks: source.hooks };
        const snapshotTree = (await git(source.workspace.path, ['rev-parse', `${receipt.snapshotCommit}^{tree}`], options)).stdout.trim();
        const contributionTree = (await git(source.workspace.path, ['rev-parse', `${receipt.contributionCommit}^{tree}`], options)).stdout.trim();
        const parent = (await git(source.workspace.path, ['show', '-s', '--format=%P', receipt.contributionCommit], options)).stdout.trim();
        const sourceAncestor = await git(source.workspace.path, ['merge-base', '--is-ancestor', receipt.snapshotCommit, 'HEAD'], { ...options, allow: [0, 1] });
        const startingSource = await git(source.workspace.path, ['merge-base', '--is-ancestor', attempt.before.sourceHead, 'HEAD'], { ...options, allow: [0, 1] });
        const targetAncestor = await git(target.workspace.path, ['merge-base', '--is-ancestor', attempt.before.integrationHead, 'HEAD'], { hooks: target.hooks, allow: [0, 1] });
        if (snapshotTree !== receipt.reviewTree || contributionTree !== receipt.reviewTree
          || parent !== receipt.contributionBaseCommit || sourceAncestor.code !== 0
          || startingSource.code !== 0 || targetAncestor.code !== 0) throw failure('workspace_attempt_history_changed');
        if (receipt.status === 'integrated') {
          if (currentTarget.entries.length || currentTarget.cherryPickHead) throw failure('workspace_attempt_target_changed');
          await integrationBasis(source, receipt, target);
          if (attempt.operation === 'resolve' && receipt.resolvedFromCommit !== attempt.conflictIntegration?.integrationCommit) {
            throw failure('workspace_attempt_resolution_changed');
          }
        } else if (attempt.operation !== 'integrate' || !Array.isArray(receipt.conflicts) || !receipt.conflicts.length
          || saved.receipt.conflictsHash !== digest(JSON.stringify(receipt.conflicts))
          || saved.targetStateToken !== currentTarget.stateToken
          || currentTarget.cherryPickHead !== receipt.contributionCommit
          || JSON.stringify(currentTarget.entries) !== JSON.stringify(receipt.statusEntries)
          || currentTarget.entries.some(entry => entry.code === '??')) throw failure('workspace_attempt_conflicts_changed');
        const { conflictsHash, ...result } = receipt;
        observedResult = result;
      } catch (error) { receiptError = error.code ?? error.message; }
    }
    const finalReview = await inspect(await owned(source.workspace), undefined, attempt.before.contributionBaseCommit);
    if (finalReview.reviewToken !== review.reviewToken || finalReview.headCommit !== review.headCommit
      || (await contributionTargetState(await owned(target.workspace))).stateToken !== currentTarget.stateToken) {
      throw failure('workspace_changed_during_review');
    }
    return { current: { sourceHead: review.headCommit, integrationHead: currentTarget.head,
      sourceTree: review.tree ?? null, integrationTree: currentTarget.tree,
      sourceStatus: review.status, integrationStatus: currentTarget.entries,
      cherryPickHead: currentTarget.cherryPickHead, sourceReviewToken: review.reviewToken,
      integrationStateToken: currentTarget.stateToken }, observedResult, receiptError,
      receiptPresent: Boolean(saved), receiptToken: saved ? digest(JSON.stringify(saved)) : null };
  });
}

/** Remove only this settled attempt's retained mechanism lock/acknowledgement.
 * The contribution owner holds its reconciliation lease and pending marker.
 */
export async function releaseWorkspaceContributionAttempt({ workspace, integration, attempt, observedResult }) {
  await withWorkspaceTransport(workspace, async () => {
    const source = await owned(workspace), target = await owned(integration);
    if (!sameWorkspace(attempt.workspace, source.workspace) || !sameWorkspace(attempt.integration, target.workspace)) throw failure('workspace_integration_mismatch');
    const filename = join(source.manifest.sessionRoot, 'workspace-integration.lock');
    try {
      const saved = await readPrivateJson(filename, 4096);
      if (saved?.attemptId !== attempt.attemptId || saved.ownerPid !== attempt.ownerPid) throw failure('workspace_attempt_lock_changed');
      removePrivateRecord(filename);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (attempt.operation === 'resolve' && observedResult?.status === 'integrated') {
      try {
        const conflict = await readPrivateJson(conflictReceiptPath(source), RECEIPT_LIMIT);
        if (receiptBinding(conflict.receipt) !== receiptBinding(attempt.conflictIntegration)) throw failure('workspace_conflict_receipt_changed');
        removePrivateRecord(conflictReceiptPath(source));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  });
}

async function safeContribution(context, review) {
  if (!review.changedPaths.length) return;
  const attributes = (await git(context.workspace.path, ['check-attr', '-z', '--stdin', 'filter', 'merge'],
    { hooks: context.hooks, input: `${review.changedPaths.join('\0')}\0` })).stdout.split('\0');
  for (let i = 0; i + 2 < attributes.length; i += 3) {
    const [, attribute, value] = attributes.slice(i, i + 3);
    if ((attribute === 'filter' && !['unspecified', 'unset'].includes(value))
      || (attribute === 'merge' && !['unspecified', 'unset', 'set', 'text', 'binary', 'union'].includes(value))) {
      throw failure('workspace_custom_git_driver_unsupported', 'Changed paths use a custom Git filter or merge driver.');
    }
  }
  const entries = (await git(context.workspace.path, ['ls-tree', '-r', '-z', review.tree], { hooks: context.hooks })).stdout.split('\0');
  for (const entry of entries) {
    if (!entry) continue;
    const divider = entry.indexOf('\t');
    const metadata = entry.slice(0, divider), path = entry.slice(divider + 1);
    if (!review.changedPaths.includes(path)) continue;
    if (metadata.startsWith('160000 ')) throw failure('workspace_submodule_change_unsupported');
    if (metadata.startsWith('120000 ')) throw failure('workspace_symlink_change_unsupported',
      'Changed symlinks require manual review/integration, including their destination symlink chains.');
  }
}

/** Apply an explicitly reviewed contribution into the separate integration
 * branch. The caller must stop the agent and obtain operator approval first.
 * Conflicts remain visible in the integration worktree; no automatic abort,
 * overwrite, branch deletion or mutation of the original project occurs.
 */
export async function integrateWorkspace(options = {}) {
  return withWorkspaceTransport(options.workspace, () => integrateOwnedWorkspace(options));
}

async function integrateOwnedWorkspace({ workspace, integration, baseCommit, expectedReviewToken, previousIntegration, contributionAttempt } = {}) {
  if (typeof expectedReviewToken !== 'string' || !/^[a-f0-9]{64}$/.test(expectedReviewToken)) throw failure('workspace_review_required');
  const source = await owned(workspace), target = await owned(integration);
  if (source.manifest.sessionRoot !== target.manifest.sessionRoot || baseCommit !== source.manifest.baseCommit
    || source.workspace.path === target.workspace.path || target.workspace.path !== target.manifest.integration.path
    || source.workspace.path === source.manifest.integration.path) throw failure('workspace_integration_mismatch');
  const lockPath = join(source.manifest.sessionRoot, 'workspace-integration.lock');
  let lock, preserveLock = false;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw failure('workspace_integration_locked', 'Another integration is active or its lock needs explicit recovery.');
    throw error;
  }
  try {
    await lock.writeFile(contributionAttempt ? `${JSON.stringify({ ownerPid: process.pid, attemptId: contributionAttempt.id })}\n` : `${process.pid}\n`);
    await lock.sync();
    if (!contributionAttempt) assertNoContributionAttempt(source.manifest.sessionRoot);
    try {
      await lstat(conflictReceiptPath(source));
      throw failure('workspace_conflict_resolution_required', 'Explicitly acknowledge the resolved integration commit before applying another contribution from this workspace.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if ((await status(target.workspace.path, target.hooks)).raw) throw failure('workspace_integration_dirty', 'Review or resolve existing integration changes first.');
    await noCherryPick(target);
    const contributionBaseCommit = await integrationBasis(source, previousIntegration, target);
    const review = await inspect(source, previousIntegration, contributionBaseCommit);
    if (review.reviewToken !== expectedReviewToken) throw failure('workspace_review_stale', 'The contribution changed; inspect and approve its new token.');
    await safeContribution(source, { ...review, changedPaths: review.integrationChangedPaths });
    if (!review.integrationChangedPaths.length) return { status: 'unchanged', workspace: source.workspace, integration: target.workspace,
      snapshotCommit: previousIntegration?.snapshotCommit ?? null, reviewTree: review.tree, contributionBaseCommit,
      integrationCommit: (await git(target.workspace.path, ['rev-parse', 'HEAD'], { hooks: target.hooks })).stdout.trim(), conflicts: [] };
    await owned(source.workspace);
    await indexPath(source);
    const integrationHead = (await git(target.workspace.path, ['rev-parse', 'HEAD'], { hooks: target.hooks })).stdout.trim();
    await contributionAttempt?.beforeMutation({ sourceHead: review.headCommit,
      integrationHead,
      reviewTree: review.tree, contributionBaseCommit });
    await git(source.workspace.path, ['add', '-A', '--', '.'], { hooks: source.hooks });
    const stagedTree = (await git(source.workspace.path, ['write-tree'], { hooks: source.hooks })).stdout.trim();
    if (stagedTree !== review.tree || stagedTree !== await captureTree(source)
      || review.headCommit !== (await git(source.workspace.path, ['rev-parse', 'HEAD'], { hooks: source.hooks })).stdout.trim()) {
      throw failure('workspace_review_stale', 'The contribution changed while staging; no integration was attempted.');
    }
    const identity = ['-c', 'user.name=Koto', '-c', 'user.email=koto@localhost'];
    const dirty = await git(source.workspace.path, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--quiet', '--exit-code'], { hooks: source.hooks, allow: [0, 1] });
    await owned(source.workspace);
    let snapshotCommit = review.headCommit;
    if (dirty.code === 1) {
      snapshotCommit = (await git(source.workspace.path, [...identity, 'commit-tree', review.tree, '-p', review.headCommit],
        { hooks: source.hooks, input: 'Koto: snapshot reviewed contribution\n' })).stdout.trim();
      // Lease the exact owned ref instead of committing whichever branch a
      // concurrent command might happen to leave checked out.
      await git(source.workspace.path, ['update-ref', `refs/heads/${source.workspace.branch}`, snapshotCommit, review.headCommit], { hooks: source.hooks });
    }
    await owned(source.workspace);
    if ((await git(source.workspace.path, ['rev-parse', 'HEAD^{tree}'], { hooks: source.hooks })).stdout.trim() !== review.tree) throw failure('workspace_review_stale');
    // The first aggregate applies the complete base-relative contribution.
    // A resumed agent contributes only the delta since its retained successful
    // snapshot, so its earlier changes are not applied a second time.
    const contribution = (await git(source.workspace.path, [...identity, 'commit-tree', review.tree, '-p', contributionBaseCommit],
      { hooks: source.hooks, input: 'Koto: integrate reviewed contribution\n' })).stdout.trim();
    await owned(target.workspace);
    await noCherryPick(target);
    if ((await status(target.workspace.path, target.hooks)).raw
      || (await git(target.workspace.path, ['rev-parse', 'HEAD'], { hooks: target.hooks })).stdout.trim() !== integrationHead) {
      throw failure('workspace_integration_changed');
    }
    // Once cherry-pick starts, command/stream/status failures can follow a
    // completed Git mutation. Retain the lease unless an explicit conflict or
    // a durably recorded success settles the outcome.
    preserveLock = true;
    const result = await git(target.workspace.path, [...identity, 'cherry-pick', contribution], { hooks: target.hooks, allow: [0, 1] });
    const finalStatus = await status(target.workspace.path, target.hooks);
    const conflicts = finalStatus.entries.filter(entry => /^(DD|AU|UD|UA|DU|AA|UU)$/.test(entry.code)).map(entry => entry.path);
    if (result.code !== 0 && !conflicts.length) throw failure('workspace_integration_failed', result.stderr.trim() || 'Git did not complete integration; inspect the preserved worktree.');
    const receipt = { status: conflicts.length ? 'conflicts' : 'integrated', workspace: source.workspace, integration: target.workspace,
      snapshotCommit, contributionCommit: contribution, contributionBaseCommit, integrationBaseCommit: integrationHead, reviewTree: review.tree,
      integrationCommit: (await git(target.workspace.path, ['rev-parse', 'HEAD'], { hooks: target.hooks })).stdout.trim(),
      conflicts, statusEntries: finalStatus.entries };
    try {
      if (receipt.status === 'integrated') await saveIntegrationReceipt(source, receipt, contributionAttempt?.id);
      else await saveConflictReceipt(source, receipt, contributionAttempt?.id, target);
    } catch {
      // Git already changed the target. Preserve the lease on receipt failure
      // so another invocation cannot automatically replay an ambiguous apply.
      throw failure('workspace_integration_receipt_failed', 'Integration changed the target but its receipt could not be retained. Inspect the preserved integration lock and worktree before further integration.');
    }
    preserveLock = false;
    return receipt;
  } finally {
    await lock.close();
    if (!preserveLock) await rm(lockPath);
  }
}

/** Explicitly acknowledge an operator-reviewed manual conflict resolution.
 * Ancestry establishes continuity, not semantic correctness: approval must name
 * the exact clean target commit the operator has reviewed as the resolution.
 * No Git commit, checkout, merge, reset or automatic conflict decision occurs.
 */
export async function finalizeWorkspaceIntegration(options = {}) {
  return withWorkspaceTransport(options.workspace, () => finalizeOwnedWorkspaceIntegration(options));
}

async function finalizeOwnedWorkspaceIntegration({ workspace, integration, conflictIntegration,
  approveIntegrationCommit, contributionAttempt } = {}) {
  if (typeof approveIntegrationCommit !== 'string' || !SHA.test(approveIntegrationCommit)) {
    throw failure('workspace_resolution_commit_required');
  }
  const source = await owned(workspace), target = await owned(integration);
  if (source.manifest.sessionRoot !== target.manifest.sessionRoot
    || source.workspace.path === target.workspace.path
    || target.workspace.path !== target.manifest.integration.path
    || source.workspace.path === source.manifest.integration.path) throw failure('workspace_integration_mismatch');
  const conflict = conflictIntegration;
  if (!conflict || conflict.status !== 'conflicts'
    || !sameWorkspace(conflict.workspace, source.workspace)
    || !sameWorkspace(conflict.integration, target.workspace)
    || ![conflict.snapshotCommit, conflict.contributionCommit, conflict.reviewTree, conflict.integrationCommit].every(value => typeof value === 'string' && SHA.test(value))
    || conflict.contributionBaseCommit !== undefined && !SHA.test(conflict.contributionBaseCommit)
    || !Array.isArray(conflict.conflicts) || !conflict.conflicts.length
    || conflict.conflicts.some(filename => typeof filename !== 'string')) {
    throw failure('workspace_conflict_receipt_invalid');
  }
  const lockPath = join(source.manifest.sessionRoot, 'workspace-integration.lock');
  let lock, preserveLock = false;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw failure('workspace_integration_locked', 'Another integration is active or its lock needs explicit recovery.');
    throw error;
  }
  try {
    await lock.writeFile(contributionAttempt ? `${JSON.stringify({ ownerPid: process.pid, attemptId: contributionAttempt.id })}\n` : `${process.pid}\n`);
    await lock.sync();
    if (!contributionAttempt) assertNoContributionAttempt(source.manifest.sessionRoot);
    let saved, receiptPresent = false;
    try { saved = await readPrivateJson(conflictReceiptPath(source), RECEIPT_LIMIT); receiptPresent = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (receiptPresent) {
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)
        || saved.kind !== 'koto-workspace-conflict' || saved.schemaVersion !== 1
        || saved.baseCommit !== source.manifest.baseCommit || !saved.receipt
        || saved.receipt.status !== 'conflicts'
        || receiptBinding(saved.receipt) !== receiptBinding(conflict)
        || saved.receipt.conflictsHash !== digest(JSON.stringify(conflict.conflicts))) {
        throw failure('workspace_conflict_receipt_changed');
      }
    } else {
      // A previously released version may have retained the conflict only in
      // the project record. Require that exact private record in this case.
      let state;
      try { state = await readPrivateJson(join(source.manifest.sessionRoot, 'project-session.json'), 1024 * 1024); }
      catch { throw failure('workspace_conflict_receipt_unrecognized'); }
      const record = state?.kind === 'koto-project-session' && state.schemaVersion === 1
        && state.sessionRoot === source.manifest.sessionRoot && Array.isArray(state.agents)
        ? state.agents.find(agent => sameWorkspace(agent.workspace, source.workspace)) : undefined;
      if (record?.integration?.status !== 'conflicts'
        || receiptBinding(record.integration) !== receiptBinding(conflict)
        || JSON.stringify(record.integration.conflicts) !== JSON.stringify(conflict.conflicts)) {
        throw failure('workspace_conflict_receipt_unrecognized');
      }
    }
    await noCherryPick(target);
    if ((await status(target.workspace.path, target.hooks)).raw) throw failure('workspace_integration_dirty', 'Finish and commit the manual resolution before approving it.');
    const targetHead = (await git(target.workspace.path, ['rev-parse', 'HEAD'], { hooks: target.hooks })).stdout.trim();
    if (targetHead !== approveIntegrationCommit || targetHead === conflict.integrationCommit) {
      throw failure('workspace_resolution_commit_changed', 'Approve the exact new integration commit after reviewing the manual resolution.');
    }
    const sourceHead = (await git(source.workspace.path, ['rev-parse', 'HEAD'], { hooks: source.hooks })).stdout.trim();
    const snapshotTree = (await git(source.workspace.path, ['rev-parse', `${conflict.snapshotCommit}^{tree}`], { hooks: source.hooks })).stdout.trim();
    const contributionTree = (await git(source.workspace.path, ['rev-parse', `${conflict.contributionCommit}^{tree}`], { hooks: source.hooks })).stdout.trim();
    const parent = (await git(source.workspace.path, ['show', '-s', '--format=%P', conflict.contributionCommit], { hooks: source.hooks })).stdout.trim();
    const contributionBaseCommit = conflict.contributionBaseCommit ?? source.manifest.baseCommit;
    const sourceAncestor = await git(source.workspace.path, ['merge-base', '--is-ancestor', conflict.snapshotCommit, sourceHead], { hooks: source.hooks, allow: [0, 1] });
    const basisAncestor = await git(source.workspace.path, ['merge-base', '--is-ancestor', contributionBaseCommit, conflict.snapshotCommit], { hooks: source.hooks, allow: [0, 1] });
    const targetAncestor = await git(target.workspace.path, ['merge-base', '--is-ancestor', conflict.integrationCommit, targetHead], { hooks: target.hooks, allow: [0, 1] });
    if (snapshotTree !== conflict.reviewTree || contributionTree !== conflict.reviewTree
      || parent !== contributionBaseCommit || sourceAncestor.code !== 0 || basisAncestor.code !== 0 || targetAncestor.code !== 0) {
      throw failure('workspace_conflict_history_changed');
    }
    await owned(source.workspace);
    await owned(target.workspace);
    await noCherryPick(target);
    if ((await status(target.workspace.path, target.hooks)).raw
      || (await git(target.workspace.path, ['rev-parse', 'HEAD'], { hooks: target.hooks })).stdout.trim() !== targetHead
      || (await git(source.workspace.path, ['rev-parse', 'HEAD'], { hooks: source.hooks })).stdout.trim() !== sourceHead) {
      throw failure('workspace_resolution_commit_changed');
    }
    const receipt = { ...conflict, status: 'integrated', integrationCommit: targetHead,
      contributionBaseCommit, conflicts: [], statusEntries: [], resolvedFromCommit: conflict.integrationCommit };
    // No project content changes, but a partially retained acknowledgement must
    // not silently permit replay of the previously conflicted contribution.
    await contributionAttempt?.beforeMutation({ sourceHead, integrationHead: targetHead,
      reviewTree: conflict.reviewTree, contributionBaseCommit });
    preserveLock = true;
    try {
      await saveIntegrationReceipt(source, receipt, contributionAttempt?.id);
      try { removePrivateRecord(conflictReceiptPath(source)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    } catch {
      throw failure('workspace_integration_receipt_failed', 'The resolution acknowledgement could not be fully retained. Inspect the preserved integration lock before further integration.');
    }
    preserveLock = false;
    return receipt;
  } finally {
    await lock.close();
    if (!preserveLock) await rm(lockPath);
  }
}
