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
  const manifest = { schemaVersion: 1, sessionId, projectRoot: project.root, baseCommit,
    commonDir: project.commonDir, controlRoot: canonicalControl, sessionRoot, workspaceRoot,
    ...(nativeHelperDirectory === undefined ? {} : { nativeHelperDirectory }),
    integration: entry('integration'), agents: Object.fromEntries(ids.map(id => [id, entry(`agent-${id}`)])) };
  await writeManifest(manifest);
  for (const workspace of [manifest.integration, ...Object.values(manifest.agents)]) {
    await git(project.root, ['worktree', 'add', '--no-track', '-b', workspace.branch, workspace.path, baseCommit], { hooks });
  }
  if ((await status(project.root, hooks)).raw
    || (await git(project.root, ['rev-parse', 'HEAD'], { hooks })).stdout.trim() !== baseCommit) {
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

async function saveIntegrationReceipt(source, receipt) {
  const temporary = join(source.manifest.sessionRoot, `.integration-${randomUUID()}.tmp`);
  const saved = { kind: 'koto-workspace-integration', schemaVersion: 1,
    baseCommit: source.manifest.baseCommit, receipt: {
      status: 'integrated', workspace: receipt.workspace, integration: receipt.integration,
      snapshotCommit: receipt.snapshotCommit, contributionCommit: receipt.contributionCommit,
      contributionBaseCommit: receipt.contributionBaseCommit,
      reviewTree: receipt.reviewTree, integrationCommit: receipt.integrationCommit,
    } };
  try {
    await writeFile(temporary, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, receiptPath(source));
  } finally { await rm(temporary, { force: true }); }
}

async function saveConflictReceipt(source, receipt) {
  const temporary = join(source.manifest.sessionRoot, `.integration-conflict-${randomUUID()}.tmp`);
  const saved = { kind: 'koto-workspace-conflict', schemaVersion: 1,
    baseCommit: source.manifest.baseCommit, receipt: {
      status: 'conflicts', workspace: receipt.workspace, integration: receipt.integration,
      snapshotCommit: receipt.snapshotCommit, contributionCommit: receipt.contributionCommit,
      contributionBaseCommit: receipt.contributionBaseCommit, reviewTree: receipt.reviewTree,
      integrationCommit: receipt.integrationCommit,
      conflictsHash: digest(JSON.stringify(receipt.conflicts)),
    } };
  try {
    await writeFile(temporary, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, conflictReceiptPath(source));
  } finally { await rm(temporary, { force: true }); }
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

async function integrateOwnedWorkspace({ workspace, integration, baseCommit, expectedReviewToken, previousIntegration } = {}) {
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
    await lock.writeFile(`${process.pid}\n`);
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
    // Once cherry-pick starts, command/stream/status failures can follow a
    // completed Git mutation. Retain the lease unless an explicit conflict or
    // a durably recorded success settles the outcome.
    preserveLock = true;
    const result = await git(target.workspace.path, [...identity, 'cherry-pick', contribution], { hooks: target.hooks, allow: [0, 1] });
    const finalStatus = await status(target.workspace.path, target.hooks);
    const conflicts = finalStatus.entries.filter(entry => /^(DD|AU|UD|UA|DU|AA|UU)$/.test(entry.code)).map(entry => entry.path);
    if (result.code !== 0 && !conflicts.length) throw failure('workspace_integration_failed', result.stderr.trim() || 'Git did not complete integration; inspect the preserved worktree.');
    const receipt = { status: conflicts.length ? 'conflicts' : 'integrated', workspace: source.workspace, integration: target.workspace,
      snapshotCommit, contributionCommit: contribution, contributionBaseCommit, reviewTree: review.tree,
      integrationCommit: (await git(target.workspace.path, ['rev-parse', 'HEAD'], { hooks: target.hooks })).stdout.trim(),
      conflicts, statusEntries: finalStatus.entries };
    try {
      if (receipt.status === 'integrated') await saveIntegrationReceipt(source, receipt);
      else await saveConflictReceipt(source, receipt);
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
  approveIntegrationCommit } = {}) {
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
    await lock.writeFile(`${process.pid}\n`);
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
    preserveLock = true;
    try {
      await saveIntegrationReceipt(source, receipt);
      await rm(conflictReceiptPath(source), { force: true });
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
