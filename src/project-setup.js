import { lstat, mkdir, opendir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { startCommand } from './command-session.js';
import { inspectLaunchProject, resolveAgentExecutable } from './launch-preflight.js';

const SHA = /^[0-9a-f]{40,64}$/;
const OUTPUT_LIMIT = 1024 * 1024;

function failure(code, message, directory, createAvailable = false) {
  return Object.assign(new Error(message), { code, directory, createAvailable });
}

function selectedDirectory(value) {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/.test(value)
    || Buffer.byteLength(value) > 4096) {
    throw failure('project_directory_invalid', 'Choose a project folder path of at most 4096 bytes, without control characters.');
  }
  let selected = value.trim();
  const quoted = (selected.startsWith('"') && selected.endsWith('"'))
    || (selected.startsWith("'") && selected.endsWith("'"));
  if (quoted) selected = selected.slice(1, -1);
  else if (/^["']|["']$/.test(selected)) {
    throw failure('project_directory_invalid', 'Finish or remove the surrounding quote marks, then retry this folder path.');
  }
  if (selected === '~') selected = homedir();
  else if (selected.startsWith('~' + path.sep) || selected.startsWith('~/')) selected = path.join(homedir(), selected.slice(2));
  else if (selected.startsWith('~')) {
    throw failure('project_directory_invalid', 'Use ~/ for your home folder, or enter the full project folder path.');
  }
  if (!selected.trim()) throw failure('project_directory_invalid', 'Choose a named project folder.');
  return path.resolve(selected);
}

async function existingDirectory(directory) {
  try {
    const information = await lstat(directory);
    if (information.isSymbolicLink()) {
      let destination;
      try { destination = await realpath(directory); }
      catch { throw failure('project_directory_redirected_unavailable', 'That symbolic link has an unavailable destination. Choose the actual project folder or a new folder path.', directory); }
      return { exists: true, redirected: true, directory: destination, information };
    }
    if (!information.isDirectory()) {
      throw failure('project_directory_not_folder', 'That path is a file. Choose a project folder or a new folder name.', directory);
    }
    return { exists: true, redirected: false, directory: await realpath(directory), information };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, directory };
    if (error.code?.startsWith('project_')) throw error;
    throw failure('project_directory_unavailable', 'That folder cannot be inspected. Check its permissions or choose another project folder.', directory);
  }
}

async function firstEntry(directory) {
  let opened;
  try {
    opened = await opendir(directory);
    return await opened.read();
  } catch {
    throw failure('project_directory_unavailable', 'That folder cannot be read. Check its permissions or choose another project folder.', directory);
  } finally { await opened?.close(); }
}

async function requireEmpty(directory) {
  if (await firstEntry(directory)) {
    throw failure('project_creation_target_not_empty',
      'That folder already contains files. Open it as an existing Git project, or choose an empty folder for the new project. Nothing was moved or committed.', directory);
  }
}

async function requireOnlyOwnedMetadata(directory) {
  const opened = await opendir(directory);
  try {
    for (;;) {
      const entry = await opened.read();
      if (!entry) return;
      if (entry.name !== '.git') {
        throw failure('project_creation_target_changed',
          'Files appeared while preparing the new project. They were preserved and were not committed. Inspect this folder before retrying.', directory);
      }
    }
  } finally { await opened.close(); }
}

async function rejectContainer(directory) {
  let home;
  try { home = await realpath(homedir()); }
  catch { home = path.resolve(homedir()); }
  const locations = [path.parse(directory).root, home,
    ...['Desktop', 'Documents', 'Downloads', 'Library', 'Music', 'Pictures', 'Movies']
      .map(name => path.join(home, name))];
  const key = value => ['darwin', 'win32'].includes(process.platform) ? value.toLowerCase() : value;
  const protectedDirectories = new Set(locations.map(key));
  for (const location of locations) {
    try { protectedDirectories.add(key(await realpath(location))); }
    catch { /* Missing personal container folders remain protected by name. */ }
  }
  if (protectedDirectories.has(key(directory))) {
    throw failure('project_creation_named_folder_required',
      'Create a named project folder inside this location, such as Downloads/my-project. Koto will not initialize your home or a personal container folder as a project.', directory);
  }
}

function gitEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' };
}

async function git(executable, cwd, args, { hooks, input, allow = [0] } = {}) {
  const controller = new AbortController();
  const output = [];
  let bytes = 0, exceeded = false, inputRejected = false;
  const config = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
    '-c', 'core.splitIndex=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0',
    '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false'];
  if (hooks) config.push('-c', 'core.hooksPath=' + hooks);
  const handle = startCommand({ id: 'prepareProject', command: executable, cwd, env: gitEnvironment(),
    args: [...config, ...args], timeoutMs: 10_000, signal: controller.signal,
    onEvent(event) {
      if (event.type !== 'output' || exceeded) return;
      bytes += Buffer.byteLength(event.text);
      if (bytes > OUTPUT_LIMIT) { exceeded = true; controller.abort(); return; }
      if (event.stream === 'stdout') output.push(event.text);
    } });
  if (input !== undefined && input.length > 0 && !handle.send(input)) { inputRejected = true; handle.stop(); }
  handle.endInput();
  const result = await handle.completion;
  if (result.error === 'cleanup_unconfirmed') {
    throw failure('project_git_cleanup_unconfirmed', 'Git process cleanup could not be confirmed. Inspect its state before retrying; the project folder was retained.', cwd);
  }
  if (inputRejected) throw failure('project_git_input_failed', 'Git could not receive setup input. The folder was retained for inspection.', cwd);
  if (exceeded) throw failure('project_git_output_limit', 'Git exceeded the bounded setup output limit. Inspect the retained project folder before retrying.', cwd);
  if (result.error === 'timeout') throw failure('project_git_timeout', 'Git setup exceeded 10 seconds. Inspect the retained folder and resolve slow storage before retrying.', cwd);
  if ((result.error && result.error !== 'exit_failed') || !allow.includes(result.exitCode)) {
    throw failure('project_git_failed', 'Git could not prepare this project. Inspect the retained folder with Git before retrying; no user files were staged or discarded.', cwd);
  }
  return { code: result.exitCode, stdout: output.join('') };
}

async function installedGit(directory) {
  let executable;
  try { executable = await resolveAgentExecutable(process.platform === 'win32' ? 'git.exe' : 'git'); }
  catch { throw failure('project_git_unavailable', 'Install Git on an absolute PATH entry, then retry this project folder.', directory); }
  const relative = path.relative(directory, executable);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw failure('project_git_executable_overlap', 'Git must be installed outside the new project folder.', directory);
  }
  return executable;
}

/**
 * Existing Git projects are inspected without writes. Creation is a separate,
 * explicitly approved operation and accepts only an absent or empty target.
 * An empty-tree initial commit never stages or commits user files.
 * On setup failure, folders and metadata remain available for inspection.
 */
export async function prepareProject({ directory, create = false, approveCreate = false } = {}) {
  if (typeof create !== 'boolean' || typeof approveCreate !== 'boolean') {
    throw failure('project_setup_options_invalid', 'Project creation and its approval must be explicit boolean options.');
  }
  const selected = selectedDirectory(directory);
  const current = await existingDirectory(selected);
  if (!create) {
    if (!current.exists) {
      throw failure('project_directory_missing', 'That project folder does not exist. Choose an existing project or explicitly create this new folder.', selected, true);
    }
    try { return { ...await inspectLaunchProject(current.directory), created: false }; }
    catch (error) {
      error.directory = current.directory;
      error.createAvailable = error.code === 'launch_git_repository_required' && !await firstEntry(current.directory);
      throw error;
    }
  }
  if (current.redirected) {
    throw failure('project_creation_redirected', 'Choose the actual new folder path rather than a symbolic link. The existing link was preserved.', selected);
  }
  let parent;
  try {
    parent = await realpath(path.dirname(selected));
    if (!(await lstat(parent)).isDirectory()) throw new Error('not_directory');
  } catch {
    throw failure('project_parent_unavailable', 'Choose a new folder inside an existing, writable parent folder. Koto does not create a chain of parent folders.', selected);
  }
  const projectRoot = current.exists ? current.directory : path.join(parent, path.basename(selected));
  if (projectRoot.split(path.sep).some(part => part.toLowerCase() === '.git')) {
    throw failure('project_creation_git_metadata_path', 'Choose a project folder outside Git metadata directories.', projectRoot);
  }
  await rejectContainer(projectRoot);
  if (current.exists) {
    if (process.getuid && current.information.uid !== process.getuid()) {
      throw failure('project_creation_owner_mismatch', 'Choose an empty folder owned by your account. Koto will not initialize another account’s folder.', projectRoot);
    }
    await requireEmpty(projectRoot);
  }
  const executable = await installedGit(projectRoot);
  const containing = await git(executable, parent, ['rev-parse', '--git-dir'], { allow: [0, 128] });
  if (containing.code === 0) {
    throw failure('project_creation_nested_repository', 'That location is inside another Git repository. Open the existing project or choose a folder outside it.', projectRoot);
  }
  if (!approveCreate) {
    throw failure('project_creation_approval_required', 'Approve creating this empty project folder, Git metadata and an empty initial commit before continuing.', projectRoot, true);
  }
  if (!current.exists) {
    try { await mkdir(projectRoot, { mode: 0o755 }); }
    catch {
      throw failure('project_creation_directory_failed', 'The new folder could not be created or appeared during approval. Recheck this path and its permissions before retrying.', projectRoot);
    }
  }
  await requireEmpty(projectRoot);
  const gitDirectory = path.join(projectRoot, '.git');
  try { await mkdir(gitDirectory, { mode: 0o700 }); }
  catch {
    throw failure('project_creation_target_changed', 'Git metadata appeared during preparation. It was preserved; inspect the folder before retrying.', projectRoot);
  }
  await requireOnlyOwnedMetadata(projectRoot);
  await git(executable, parent, ['init', '--initial-branch=main', '--template=', '--', projectRoot]);
  const hooks = path.join(gitDirectory, 'koto-disabled-hooks');
  await mkdir(hooks, { mode: 0o700 });
  await requireOnlyOwnedMetadata(projectRoot);
  const tree = (await git(executable, projectRoot, ['mktree'], { hooks, input: '' })).stdout.trim();
  if (!SHA.test(tree)) throw failure('project_initial_tree_invalid', 'Git did not return an empty tree identity. Inspect the retained folder before retrying.', projectRoot);
  const identity = ['-c', 'user.name=Koto', '-c', 'user.email=koto@localhost'];
  const baseCommit = (await git(executable, projectRoot, [...identity, 'commit-tree', tree],
    { hooks, input: 'Initialize empty Koto project\n' })).stdout.trim();
  if (!SHA.test(baseCommit)) throw failure('project_initial_commit_invalid', 'Git did not return an initial commit identity. Inspect the retained folder before retrying.', projectRoot);
  // A lease refuses any concurrently created branch; no existing ref is replaced.
  await git(executable, projectRoot, ['update-ref', 'refs/heads/main', baseCommit, '0'.repeat(baseCommit.length)], { hooks });
  const inspected = await inspectLaunchProject(projectRoot);
  if (inspected.baseCommit !== baseCommit) throw failure('project_created_head_changed', 'The project changed during preparation. Inspect it before launching agents; no files were removed.', projectRoot);
  return { ...inspected, created: true };
}
