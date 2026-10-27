import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SHA = /^[0-9a-f]{40,64}$/;
const LIMIT = 4 * 1024 * 1024;
const MANIFEST = 'workspaces.json';
let executablePromise;

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
export async function createProjectWorkspaces({ projectRoot, controlRoot, sessionId, agents } = {}) {
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

async function owned(workspace) {
  if (!workspace || typeof workspace !== 'object') throw failure('workspace_not_owned');
  const sessionRoot = await canonical(workspace.sessionRoot);
  await privateDirectory(sessionRoot);
  const manifestPath = join(sessionRoot, MANIFEST);
  const info = await lstat(manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024) throw failure('workspace_invalid_manifest');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.sessionRoot !== sessionRoot || !SHA.test(manifest.baseCommit)
      || !ID.test(manifest.sessionId) || manifest.sessionRoot !== join(manifest.controlRoot, manifest.sessionId)
      || manifest.workspaceRoot !== join(`${manifest.controlRoot}-worktrees`, manifest.sessionId)) {
    throw failure('workspace_invalid_manifest');
  }
  const known = [manifest.integration, ...Object.values(manifest.agents)].find(entry =>
    entry.path === workspace.path && entry.branch === workspace.branch && entry.sessionRoot === sessionRoot);
  if (!known || !inside(manifest.workspaceRoot, known.path) || inside(known.path, sessionRoot)
    || await canonical(known.path) !== known.path) throw failure('workspace_not_owned');
  const hooks = join(sessionRoot, 'disabled-hooks');
  await disabledHooks(hooks);
  const repo = await repository(known.path, hooks);
  if (repo.commonDir !== manifest.commonDir) throw failure('workspace_repository_changed');
  const branch = (await git(known.path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { hooks })).stdout.trim();
  if (branch !== known.branch) throw failure('workspace_branch_changed');
  const ancestor = await git(known.path, ['merge-base', '--is-ancestor', manifest.baseCommit, 'HEAD'], { hooks, allow: [0, 1] });
  if (ancestor.code !== 0) throw failure('workspace_base_changed');
  return { manifest, workspace: known, hooks };
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

async function inspect(context) {
  const { workspace, manifest, hooks } = context;
  const headCommit = (await git(workspace.path, ['rev-parse', 'HEAD'], { hooks })).stdout.trim();
  const before = await status(workspace.path, hooks);
  const conflicts = before.entries.filter(entry => /^(DD|AU|UD|UA|DU|AA|UU)$/.test(entry.code)).map(entry => entry.path);
  if (conflicts.length) return { ...workspace, baseCommit: manifest.baseCommit, headCommit,
    clean: false, status: before.entries, changedPaths: [], diff: '', untracked: [], conflicts, reviewToken: null };
  const indexState = (await git(workspace.path, ['ls-files', '--stage', '-z'], { hooks })).stdout;
  const tree = await captureTree(context);
  const diff = (await git(workspace.path, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames',
    manifest.baseCommit, tree, '--'], { hooks })).stdout;
  const changedPaths = (await git(workspace.path, ['diff', '--name-only', '-z', '--no-renames', manifest.baseCommit, tree, '--'], { hooks })).stdout.split('\0').filter(Boolean);
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
  const reviewToken = digest(JSON.stringify({ baseCommit: manifest.baseCommit, headCommit, tree, indexState, status: before.raw }));
  return { ...workspace, baseCommit: manifest.baseCommit, headCommit, tree,
    clean: !before.raw, status: before.entries, changedPaths, diff, untracked, conflicts: [], reviewToken };
}

/** Review all changes since the session base, including committed/untracked work.
 * Binary changes receive Git's explicit binary summary; the tree/token binds
 * their complete contents. This is a freshness check, not a security sandbox.
 */
export async function inspectWorkspace({ workspace } = {}) {
  return inspect(await owned(workspace));
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
export async function integrateWorkspace({ workspace, integration, baseCommit, expectedReviewToken } = {}) {
  if (typeof expectedReviewToken !== 'string' || !/^[a-f0-9]{64}$/.test(expectedReviewToken)) throw failure('workspace_review_required');
  const source = await owned(workspace), target = await owned(integration);
  if (source.manifest.sessionRoot !== target.manifest.sessionRoot || baseCommit !== source.manifest.baseCommit
    || source.workspace.path === target.workspace.path || target.workspace.path !== target.manifest.integration.path
    || source.workspace.path === source.manifest.integration.path) throw failure('workspace_integration_mismatch');
  const lockPath = join(source.manifest.sessionRoot, 'workspace-integration.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw failure('workspace_integration_locked', 'Another integration is active or its lock needs explicit recovery.');
    throw error;
  }
  try {
    await lock.writeFile(`${process.pid}\n`);
    if ((await status(target.workspace.path, target.hooks)).raw) throw failure('workspace_integration_dirty', 'Review or resolve existing integration changes first.');
    const cherryPick = (await git(target.workspace.path, ['rev-parse', '--git-path', 'CHERRY_PICK_HEAD'], { hooks: target.hooks })).stdout.trim();
    try { await lstat(resolve(target.workspace.path, cherryPick)); throw failure('workspace_conflict_pending'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const review = await inspect(source);
    if (review.reviewToken !== expectedReviewToken) throw failure('workspace_review_stale', 'The contribution changed; inspect and approve its new token.');
    await safeContribution(source, review);
    if (!review.changedPaths.length) return { status: 'unchanged', workspace: source.workspace, integration: target.workspace,
      snapshotCommit: null, reviewTree: review.tree,
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
    // One aggregate commit preserves the whole base-relative contribution,
    // including agent-authored commits, without replaying unrelated history.
    const contribution = (await git(source.workspace.path, [...identity, 'commit-tree', review.tree, '-p', baseCommit],
      { hooks: source.hooks, input: 'Koto: integrate reviewed contribution\n' })).stdout.trim();
    await owned(target.workspace);
    const result = await git(target.workspace.path, [...identity, 'cherry-pick', contribution], { hooks: target.hooks, allow: [0, 1] });
    const finalStatus = await status(target.workspace.path, target.hooks);
    const conflicts = finalStatus.entries.filter(entry => /^(DD|AU|UD|UA|DU|AA|UU)$/.test(entry.code)).map(entry => entry.path);
    if (result.code !== 0 && !conflicts.length) throw failure('workspace_integration_failed', result.stderr.trim() || 'Git did not complete integration; inspect the preserved worktree.');
    return { status: conflicts.length ? 'conflicts' : 'integrated', workspace: source.workspace, integration: target.workspace,
      snapshotCommit, contributionCommit: contribution, reviewTree: review.tree,
      integrationCommit: (await git(target.workspace.path, ['rev-parse', 'HEAD'], { hooks: target.hooks })).stdout.trim(),
      conflicts, statusEntries: finalStatus.entries };
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}
