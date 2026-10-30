import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { startCommand } from './command-session.js';
import { startTerminalCommand } from './terminal-session.js';
import { resolveTerminalHelper } from './terminal-helper.js';

const SHA = /^[0-9a-f]{40,64}$/;
const GIT_OUTPUT_LIMIT = 1024 * 1024;
const GIT_TIMEOUT_MS = 10_000;

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function unsupportedLauncher(command) {
  return /\.(?:cmd|bat)$/i.test(command);
}

/** Resolve an installed executable without starting it or invoking a shell. */
export async function resolveAgentExecutable(command, { unsetEnv = [] } = {}) {
  if (typeof command !== 'string' || !command.trim() || command.includes('\0') || Buffer.byteLength(command) > 4096) {
    throw failure('launch_invalid_executable', 'Choose one installed executable name or absolute path; enter its arguments separately.');
  }
  if (unsupportedLauncher(command)) {
    throw failure('launch_shell_launcher_unsupported', 'Shell .cmd/.bat launchers are unsupported. Choose the agent\'s native executable or an explicit interpreter executable.');
  }
  if (!Array.isArray(unsetEnv) || unsetEnv.length > 32
      || unsetEnv.some(key => typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key))) {
    throw failure('launch_invalid_environment', 'Unset environment names must be a bounded array of valid variable names.');
  }
  const absolute = path.isAbsolute(command);
  if (!absolute && /[/\\]/.test(command)) {
    throw failure('launch_absolute_executable_required', 'Use an absolute executable path or its name on PATH; relative executable paths are not supported.');
  }
  const names = process.platform === 'win32' && !path.extname(command)
    ? [`${command}.exe`, `${command}.com`] : [command];
  // Match the command's planned environment rather than resolving a PATH
  // entry that launch explicitly removes. Absolute executable paths still work.
  const searchPath = unsetEnv.includes('PATH')
    ? (process.platform === 'win32' ? '' : '/usr/bin:/bin') : process.env.PATH ?? '';
  const candidates = absolute ? names : searchPath.split(path.delimiter)
    .filter(directory => directory && path.isAbsolute(directory))
    .flatMap(directory => names.map(name => path.join(directory, name)));
  let shellLauncherFound = false;
  for (const candidate of candidates) {
    try {
      const executable = await realpath(candidate);
      if (unsupportedLauncher(executable)) { shellLauncherFound = true; continue; }
      if (process.platform === 'win32' && !/\.(?:exe|com)$/i.test(executable)) continue;
      if (!(await lstat(executable)).isFile()) continue;
      await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return executable;
    } catch { /* Continue through existing files on absolute PATH entries. */ }
  }
  if (process.platform === 'win32' && !absolute && !path.extname(command)) {
    for (const directory of searchPath.split(path.delimiter)) {
      if (!directory || !path.isAbsolute(directory)) continue;
      for (const suffix of ['.cmd', '.bat']) {
        try { if ((await lstat(path.join(directory, `${command}${suffix}`))).isFile()) shellLauncherFound = true; }
        catch { /* Missing shell shims are not executables. */ }
      }
    }
  }
  if (shellLauncherFound) {
    throw failure('launch_shell_launcher_unsupported', 'Only a shell .cmd/.bat launcher was found. Choose the agent\'s native executable or an explicit interpreter executable.');
  }
  throw failure('launch_executable_not_found', `Executable ${JSON.stringify(command)} is unavailable. Install it first, add its directory to PATH, or choose an absolute executable path${process.platform === 'win32' ? ' ending in .exe or .com' : ' with execute permission'}.`);
}

function gitEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' };
}

// Reuse the owned-process lifecycle. These commands inspect only; agents,
// provider help/version commands, compilers and workspace creation stay outside preflight.
async function git(executable, cwd, args, allow = [0], nativeHelperDirectory) {
  const controller = new AbortController();
  const output = { stdout: [], stderr: [] };
  let bytes = 0, exceeded = false;
  const helperPath = process.platform === 'win32' ? await resolveTerminalHelper({ directory: nativeHelperDirectory }) : undefined;
  const start = helperPath ? startTerminalCommand : startCommand;
  const handle = start({ id: 'launchGit', command: executable, cwd, env: gitEnvironment(),
    ...(helperPath ? { helperPath, transport: 'pipe' } : {}),
    args: ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
      '-c', 'core.splitIndex=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...args],
    timeoutMs: GIT_TIMEOUT_MS, signal: controller.signal,
    onEvent(event) {
      if (event.type !== 'output' || exceeded) return;
      bytes += Buffer.byteLength(event.text);
      if (bytes > GIT_OUTPUT_LIMIT) { exceeded = true; controller.abort(); return; }
      output[event.stream].push(event.text);
    } });
  handle.endInput();
  const result = await handle.completion;
  if (result.error === 'cleanup_unconfirmed') {
    throw failure('launch_git_cleanup_unconfirmed', 'Git inspection did not confirm process cleanup. No agents were started; inspect the remaining Git process before retrying.');
  }
  if (exceeded) throw failure('launch_git_output_limit', 'Git inspection exceeded its output limit. Inspect this repository with Git before retrying.');
  if (result.error === 'timeout') throw failure('launch_git_timeout', 'Git inspection took longer than 10 seconds. Resolve slow or unavailable repository storage before retrying.');
  if (result.error && result.error !== 'exit_failed' || !allow.includes(result.exitCode)) {
    throw failure('launch_git_failed', 'Git could not inspect this project. Run `git status` in the selected directory and resolve its reported error before retrying.');
  }
  return { code: result.exitCode, stdout: output.stdout.join('') };
}

/** Find the current working tree without requiring a clean index or a first commit. */
export async function discoverProjectRoot(directory = process.cwd(), { nativeHelperDirectory } = {}) {
  if (typeof directory !== 'string' || !directory.trim() || /[\x00-\x1f\x7f]/.test(directory)
    || Buffer.byteLength(directory) > 4096) {
    throw failure('launch_invalid_project', 'Choose an existing project folder path without control characters.');
  }
  let current;
  try {
    current = await realpath(path.resolve(directory));
    if (!(await lstat(current)).isDirectory()) throw new Error('not_directory');
  } catch {
    throw failure('launch_project_unavailable', 'The current project folder is unavailable. Choose an existing, readable directory.');
  }
  // Discover only Git metadata boundaries, never project configuration. This
  // also lets us reject a project-owned Git executable before invoking it when
  // the user launches Koto from a nested source folder.
  let candidate = current;
  for (let depth = 0; ; depth += 1) {
    if (depth >= 256) throw failure('launch_project_depth_limit', 'Open Koto closer to the project root.');
    let found = false;
    try { await lstat(path.join(candidate, '.git')); found = true; }
    catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
        throw failure('launch_project_unavailable', 'Git metadata could not be inspected. Check this project folder before continuing.');
      }
    }
    if (found) break;
    const parent = path.dirname(candidate);
    if (parent === candidate) return undefined;
    candidate = parent;
  }
  let executable;
  try { executable = await resolveAgentExecutable(process.platform === 'win32' ? 'git.exe' : 'git'); }
  catch { throw failure('launch_git_unavailable', 'Install Git and add its executable directory to an absolute PATH entry before opening this project.'); }
  if (inside(candidate, executable)) {
    throw failure('launch_git_executable_overlap', 'Git must be installed outside the project. Select a PATH that resolves Git to its installed executable.');
  }
  const top = await git(executable, current, ['rev-parse', '--show-toplevel'], [0], nativeHelperDirectory);
  let root;
  try {
    root = await realpath(top.stdout.trim());
    if (!(await lstat(root)).isDirectory()) throw new Error('not_directory');
  } catch {
    throw failure('launch_project_unavailable', 'Git reported an unavailable project root. Resolve the repository path before continuing.');
  }
  if (inside(root, executable)) {
    throw failure('launch_git_executable_overlap', 'Git must be installed outside the project. Select a PATH that resolves Git to its installed executable.');
  }
  return root;
}

/** Inspect the same clean, committed repository root required by project workspaces. */
export async function inspectLaunchProject(projectPath = process.cwd(), { nativeHelperDirectory } = {}) {
  if (typeof projectPath !== 'string' || !projectPath.trim() || projectPath.includes('\0') || Buffer.byteLength(projectPath) > 4096) {
    throw failure('launch_invalid_project', 'Choose the root directory of an existing Git repository.');
  }
  let projectRoot;
  try {
    projectRoot = await realpath(path.resolve(projectPath));
    if (!(await lstat(projectRoot)).isDirectory()) throw new Error('not_directory');
  } catch {
    throw failure('launch_project_unavailable', 'The selected project directory is unavailable. Choose an existing, readable Git repository root.');
  }
  let executable;
  try { executable = await resolveAgentExecutable(process.platform === 'win32' ? 'git.exe' : 'git'); }
  catch { throw failure('launch_git_unavailable', 'Install Git and add its executable directory to an absolute PATH entry before launching Koto.'); }
  if (inside(projectRoot, executable)) {
    throw failure('launch_git_executable_overlap', 'Git must be installed outside the project. Select a PATH that resolves Git to its installed executable.');
  }
  const run = (args, allow) => git(executable, projectRoot, args, allow, nativeHelperDirectory);
  const top = await run(['rev-parse', '--show-toplevel'], [0, 128]);
  if (top.code !== 0 || !top.stdout.trim()) {
    throw failure('launch_git_repository_required', 'Choose an existing Git working tree. For a new project, initialize Git and create its first commit before launching Koto.');
  }
  let topRoot;
  try { topRoot = await realpath(top.stdout.trim()); }
  catch { throw failure('launch_project_unavailable', 'Git reported an unavailable project root. Resolve the repository path before retrying.'); }
  if (topRoot !== projectRoot) {
    throw failure('launch_project_root_required', `Choose the repository root ${JSON.stringify(topRoot)} rather than a nested directory.`);
  }
  if ((await run(['rev-parse', '--show-superproject-working-tree'])).stdout.trim()) {
    throw failure('launch_submodule_unsupported', 'Launching inside a Git submodule is unsupported. Choose a standalone repository root.');
  }
  const custom = await run(['config', '--name-only', '--get-regexp', String.raw`^(filter\..*|merge\..*\.driver)$`], [0, 1]);
  if (custom.stdout.trim()) {
    throw failure('launch_custom_git_driver_unsupported', 'This repository configures custom Git filters or merge drivers. They require a separately reviewed integration before Koto can create workspaces.');
  }
  const head = await run(['rev-parse', '--verify', 'HEAD^{commit}'], [0, 1, 128]);
  const baseCommit = head.stdout.trim();
  if (head.code !== 0 || !SHA.test(baseCommit)) {
    throw failure('launch_initial_commit_required', 'Create the project\'s first Git commit before launching isolated agent workspaces.');
  }
  const status = await run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']);
  if (status.stdout) {
    throw failure('launch_project_dirty', 'Commit or preserve all staged, unstaged and untracked project changes before launching Koto. Run `git status` to review them; Koto will not stash or discard them.');
  }
  const branch = (await run(['symbolic-ref', '--quiet', '--short', 'HEAD'], [0, 1])).stdout.trim();
  return { projectRoot, baseCommit, ...(branch ? { branch } : {}) };
}
