import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { resolveNativeClientExecutable } from './onboarding.js';
import { resolveAgentExecutable } from './launch-preflight.js';
import { discoverLocalModels } from './local-models.js';
import { inspectProjectContext } from './project-inspection.js';
import { throwOnResourceExhaustion } from './bounded-fetch.js';

const SKILL_BYTES = 64 * 1024;
const MAX_SKILLS = 256;
const skillSources = new WeakMap();
const clean = (value, maximum = 512) => stripVTControlCharacters(String(value ?? ''))
  .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, maximum);
const abort = signal => signal?.throwIfAborted();
const inside = (root, file) => file === root || file.startsWith(`${root}${path.sep}`);
const validPath = value => typeof value === 'string' && !/[\x00-\x1f\x7f-\x9f{}]/.test(value);
const missing = error => ['ENOENT', 'ENOTDIR', 'EACCES'].includes(error?.code);
const recoverable = (error, signal) => { throwOnResourceExhaustion(error, 'tui_socket_exhausted'); abort(signal); };

async function readBounded(filename, maximum, signal) {
  abort(signal);
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum) throw new Error('Skill is not a bounded regular file.');
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const handle = await open(filename, flags);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || opened.size > maximum) {
      throw new Error('Skill changed while it was being opened.');
    }
    const buffer = Buffer.alloc(maximum + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      abort(signal);
      const result = await handle.read(buffer, bytes, buffer.length - bytes, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
    }
    const after = await handle.stat();
    if (bytes > maximum || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error('Skill exceeds the read limit or changed during reading.');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));
    if (content.includes('\0')) throw new Error('Skill is not a text document.');
    return content;
  } finally { await handle.close(); }
}

function frontmatter(content, fallback) {
  const header = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
  const value = key => {
    const found = header.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))?.[1]?.trim();
    if (!found || /^[>|][+-]?$/.test(found)) return '';
    return clean(found.replace(/^(['"])([\s\S]*)\1$/, '$2'), key === 'name' ? 128 : 384);
  };
  return { name: value('name') || fallback, description: value('description') || 'Installed skill instructions; select explicitly to read.' };
}

async function discoverSkills(project, signal, warnings) {
  const codexHome = process.env.CODEX_HOME && path.isAbsolute(process.env.CODEX_HOME) ? process.env.CODEX_HOME : path.join(homedir(), '.codex');
  const definitions = [
    ...(project ? [
      { directory: path.join(project, '.agents', 'skills'), provider: 'codex', scope: 'project' },
      { directory: path.join(project, '.codex', 'skills'), provider: 'codex', scope: 'project' },
      { directory: path.join(project, '.claude', 'skills'), provider: 'claude', scope: 'project' },
      { directory: path.join(project, 'skills'), provider: 'koto', scope: 'project' },
    ] : []),
    { directory: path.join(homedir(), '.agents', 'skills'), provider: 'codex', scope: 'user' },
    { directory: path.join(codexHome, 'skills'), provider: 'codex', scope: 'user' },
    { directory: path.join(homedir(), '.claude', 'skills'), provider: 'claude', scope: 'user' },
  ];
  const result = [], seen = new Set();
  let scanned = 0;
  async function visit(directory, root, definition, depth) {
    abort(signal);
    if (depth > 3 || scanned >= 1024 || result.length >= MAX_SKILLS) return;
    let stream;
    try { stream = await opendir(directory); }
    catch (error) { recoverable(error, signal); if (missing(error)) return; throw error; }
    for await (const entry of stream) {
      abort(signal);
      if (++scanned > 1024 || result.length >= MAX_SKILLS) break;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const filename = path.join(directory, entry.name);
      // Native skill installations may link one named skill directory. Follow
      // only that explicitly installed slot, and read its top-level SKILL.md;
      // never recursively walk an arbitrary symlink target.
      if (entry.isSymbolicLink()) {
        if (depth !== 0) continue;
        try {
          const target = await realpath(filename);
          const document = path.join(target, 'SKILL.md');
          const info = await lstat(document);
          if ((await lstat(target)).isDirectory() && info.isFile() && !info.isSymbolicLink()) {
            await visit(target, target, { ...definition, slot: entry.name }, 3);
          }
        } catch (error) { recoverable(error, signal); }
        continue;
      }
      if (entry.isFile() && entry.name === 'SKILL.md') {
        try {
          const canonical = await realpath(filename);
          if (!inside(root, canonical) || seen.has(canonical)) continue;
          const content = await readBounded(canonical, SKILL_BYTES, signal);
          const meta = frontmatter(content, path.basename(directory));
          const relative = definition.slot ?? (path.relative(root, directory).split(path.sep).join('/') || path.basename(directory));
          const id = `${definition.provider}:${definition.scope}:${relative.split('/').map(encodeURIComponent).join('/')}`;
          const item = { id, value: id, label: meta.name, name: meta.name, description: meta.description,
            provider: definition.provider, scope: definition.scope, path: canonical, status: 'installed',
            readiness: 'unverified', manualOnly: true };
          skillSources.set(item, { root, path: canonical });
          result.push(item); seen.add(canonical);
        } catch (error) { recoverable(error, signal); warnings.push(`Skipped unreadable skill ${clean(filename, 160)}.`); }
      } else if (entry.isDirectory()) await visit(filename, root, definition, depth + 1);
    }
  }
  for (const definition of definitions) {
    abort(signal);
    try {
      const root = await realpath(definition.directory);
      if (!(await lstat(root)).isDirectory()) continue;
      await visit(root, root, definition, 0);
    } catch (error) { recoverable(error, signal); if (!missing(error)) warnings.push(`Skill directory unavailable: ${clean(definition.directory, 160)}.`); }
  }
  if (scanned >= 1024 || result.length >= MAX_SKILLS) warnings.push('Skill discovery reached its bounded directory/item limit.');
  return result.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/** Reads only an object produced by discovery; a renderer cannot nominate a path.
 * Skill text is inert context. This function never runs hooks or skill commands.
 */
export async function readSkillContext(skill, { signal } = {}) {
  const source = skillSources.get(skill);
  if (!source || await realpath(source.path) !== source.path || !inside(source.root, source.path)) {
    throw new Error('Select a skill from the current installed-skill catalog.');
  }
  const full = await readBounded(source.path, SKILL_BYTES, signal);
  const bytes = Buffer.from(full);
  const excerpt = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 16 * 1024));
  return { id: skill.id, name: skill.name, path: source.path, provider: skill.provider, scope: skill.scope,
    content: excerpt, bytes: Math.min(bytes.length, 16 * 1024), truncated: bytes.length > 16 * 1024, manualOnly: true };
}

/** Local discovery only. Refreshing loopback runtime metadata is explicit and
 * performs at most three bounded HTTP metadata requests; no inference or login.
 */
export async function discoverTuiCatalog({ project, preferences = {}, signal, refreshModels = false } = {}) {
  abort(signal);
  const warnings = [], agents = [], models = [], connections = [], files = [];
  let context, branch;
  if (project) {
    try {
      context = await inspectProjectContext(project, { signal });
      branch = context.git?.branch;
      for (const relative of context.inventory.paths.slice(0, 2000)) {
        if (!validPath(relative) || relative.endsWith('/')) continue;
        files.push({ id: relative, value: relative, path: relative, label: relative, kind: 'file', status: 'available' });
      }
      if (context.inventory.truncated) warnings.push('Project file list is bounded; refine the path or use inspection to read a selected file.');
    } catch (error) { recoverable(error, signal); warnings.push(`Project file discovery: ${clean(error.message, 200)}`); }
  }
  const choices = [
    ...(preferences.coordinator ? [{ id: 'coordinator', ...preferences.coordinator, nativeKind: preferences.coordinator.kind, label: 'Koto coordinator' }] : []),
    ...(preferences.workers ?? []).slice(0, 8),
  ];
  const installed = new Map();
  for (const kind of ['codex', 'claude']) {
    abort(signal);
    try {
      const command = await resolveNativeClientExecutable(kind, preferences.nativeCommands?.[kind]);
      installed.set(kind, command);
      connections.push({ id: kind, value: kind, label: kind === 'codex' ? 'Codex / ChatGPT' : 'Claude Code / Claude',
        kind, command, status: 'installed', description: 'Native executable found; account and inference readiness unverified. Use /accounts to check.' });
    } catch (error) {
      recoverable(error, signal);
      connections.push({ id: kind, value: kind, label: kind, kind, status: 'unavailable', description: clean(error.message, 240) });
    }
  }
  for (const choice of choices) {
    abort(signal);
    const kind = choice.nativeKind ?? choice.kind;
    let command, status = 'configured', description;
    if (kind === 'local') description = 'Configured local model; runtime readiness is checked by explicit refresh.';
    else {
      try { command = choice.command ? await resolveAgentExecutable(choice.command) : installed.get(kind); }
      catch (error) { recoverable(error, signal); /* Explicit stale command is shown unavailable; no silent fallback. */ }
      status = command ? 'configured' : 'unavailable';
      description = command ? 'Configured native executable; account/inference readiness unverified.' : 'Configured executable is unavailable.';
    }
    agents.push({ id: clean(choice.id, 64), value: clean(choice.id, 64), label: clean(choice.label ?? choice.id, 128),
      kind, provider: kind, model: choice.model, command, status, description });
  }
  for (const entry of (preferences.localInstalls ?? []).slice(0, 32)) {
    abort(signal);
    let retained = false;
    try { const info = await lstat(entry.modelPath); retained = info.isFile() && !info.isSymbolicLink(); }
    catch (error) { recoverable(error, signal); /* Show stale retained choice honestly. */ }
    models.push({ id: clean(entry.id, 256), value: clean(entry.id, 256), label: clean(entry.label ?? entry.id, 256), kind: 'local',
      status: retained ? 'retained' : 'unavailable', description: retained ? 'Retained model weights; server readiness unverified.' : 'Retained model file is unavailable.', path: entry.modelPath });
  }
  const configuredModels = [...choices.map(choice => ({ id: choice.model, kind: choice.nativeKind ?? choice.kind })),
    ...(preferences.local?.model ? [{ id: preferences.local.model, kind: 'local' }] : [])];
  for (const model of configuredModels) {
    if (!model.id || models.some(item => item.id === model.id && item.kind === model.kind)) continue;
    models.push({ id: model.id, value: model.id, label: model.id, kind: model.kind, status: 'configured',
      description: 'Configured model identifier; installation and inference readiness unverified.' });
  }
  if (refreshModels) {
    const bounded = AbortSignal.any([AbortSignal.timeout(7000), ...(signal ? [signal] : [])]);
    const runtimes = await discoverLocalModels({ signal: bounded, llamaCommand: preferences.llamaCommand ?? 'llama-server' });
    abort(signal);
    for (const runtime of Object.values(runtimes)) {
      connections.push({ id: runtime.kind, value: runtime.kind, label: runtime.kind, kind: 'local',
        status: runtime.reachable ? 'ready' : runtime.executable ? 'installed' : 'unavailable',
        description: runtime.reachable ? 'Loopback metadata responded; inference not tested.' : clean(runtime.message ?? 'No running local endpoint.', 240),
        endpoint: runtime.endpoint });
      for (const model of runtime.models.slice(0, 128)) {
        const existing = models.find(item => item.id === model.id);
        if (existing) Object.assign(existing, { status: 'ready', description: `Listed by ${runtime.kind}; inference not tested.`, runtime: runtime.kind });
        else models.push({ id: model.id, value: model.id, label: model.id, kind: 'local', status: 'ready', runtime: runtime.kind,
          description: `Listed by ${runtime.kind}; inference not tested.` });
      }
    }
  }
  const skills = await discoverSkills(context?.projectRoot ?? project, signal, warnings);
  return { projectRoot: context?.projectRoot, coordinatorKind: preferences.coordinator?.kind,
    context, agents, models, skills, files, branch, connections, warnings };
}

const matchRank = (value, needle, trigger) => {
  let source = String(value ?? '').toLowerCase();
  if (trigger && source.startsWith(trigger)) source = source.slice(trigger.length);
  if (trigger === '@' && source.startsWith('{') && source.endsWith('}')) source = source.slice(1, -1);
  if (!needle) return 0;
  if (source === needle) return 4;
  if (source.startsWith(needle)) return 3;
  if (source.includes(needle)) return 2;
  let at = 0;
  for (const character of needle) { at = source.indexOf(character, at); if (at < 0) return -1; at += character.length; }
  return 1;
};
const list = value => Array.isArray(value) ? value : [];
const commandName = item => clean(typeof item === 'string' ? item.split(/\s/, 1)[0] : item.name ?? item.command ?? item.value, 96).replace(/^\//, '');
const mention = value => /\s/.test(value) ? `@{${value}}` : `@${value}`;

export function createTuiSuggestions({ getCatalog, getCommands, getSessions, getQueue } = {}) {
  return async ({ line = '', cursor = line.length, signal } = {}) => {
    abort(signal);
    const catalog = await getCatalog?.() ?? {};
    const prefix = line.slice(0, cursor);
    let replaceStart = cursor, query = '', entries = [], trigger = '';
    const match = prefix.match(/(?:^|\s)(@(\{[^}]*|[^\s]*))$/);
    if (match) {
      trigger = '@';
      replaceStart = cursor - match[1].length;
      query = match[2].replace(/^\{/, '').replace(/\}$/, '');
      const folders = new Set();
      for (const item of list(catalog.files)) {
        const relative = item.path ?? item.value;
        if (!validPath(relative)) continue;
        const parts = relative.split('/');
        for (let i = 1; i < parts.length; i += 1) folders.add(`${parts.slice(0, i).join('/')}/`);
        entries.push({ value: mention(relative), label: `@${relative}`, description: 'Project file · attach bounded source context', group: 'Files', insertText: `${mention(relative)} ` });
      }
      entries.unshift(...[...folders].map(folder => ({ value: mention(folder), label: `@${folder}`, group: 'Folders', description: 'Project folder · continue typing to choose a file', insertText: mention(folder) })));
      entries.unshift(...list(catalog.agents).map(agent => ({ value: `@agent:${agent.id}`, label: `@agent:${agent.id}`, group: 'Agents',
        description: `${agent.label} · ${agent.status} · selects context, does not start work`, disabled: agent.status === 'unavailable', insertText: `@agent:${agent.id} ` })));
    } else if (prefix.startsWith('/')) {
      const commandMatch = prefix.match(/^\/([^\s]*)$/);
      if (commandMatch) {
        trigger = '/';
        replaceStart = 0; query = commandMatch[1];
        entries = list(await getCommands?.()).map(item => {
          const name = commandName(item);
          return { value: `/${name}`, label: `/${name}${typeof item === 'object' && item.args ? ` ${item.args}` : ''}`,
            description: typeof item === 'string' ? '' : clean(item.description, 256), insertText: `/${name} `, group: 'Commands' };
        }).filter(item => item.value.length > 1);
      } else {
        const tokens = prefix.match(/^\/([^\s]+)\s+([\s\S]*)$/);
        if (!tokens) return [];
        const command = tokens[1], rest = tokens[2];
        const firstArgument = !/\s/.test(rest.trimStart());
        replaceStart = prefix.lastIndexOf(' ') + 1;
        query = prefix.slice(replaceStart);
        const option = (value, description = '', disabled = false, label = value) => ({ value: String(value), label: String(label), description, disabled, insertText: `${value} ` });
        if (command === 'mode' && firstArgument) entries = ['auto', 'ask', 'inspect', 'plan', 'build'].map(value => option(value, `Use ${value} mode`));
        else if ((command === 'agent' || command === 'add') && firstArgument) entries = ['codex', 'claude', 'local'].map(kind => {
          const connection = list(catalog.connections).find(item => item.id === kind);
          return option(kind, connection?.description ?? 'Configure an existing local model', connection?.status === 'unavailable');
        });
        else if (command === 'add' && /^(codex|claude|local)\s+\S*$/.test(rest)) {
          const kind = rest.split(/\s/, 1)[0];
          entries = list(catalog.models).filter(model => model.kind === kind).map(model => option(model.id, model.description, model.status === 'unavailable'));
        }
        else if (command === 'model' && firstArgument || command === 'models' && /^use\s+\S*$/.test(rest)) {
          entries = list(catalog.models).filter(model => command !== 'model' || !catalog.coordinatorKind || model.kind === catalog.coordinatorKind)
            .map(model => option(model.id, `${model.status} · ${model.description}`, model.status === 'unavailable'));
        } else if (command === 'models' && firstArgument) entries = ['add', 'use', 'pull', 'start', 'get'].map(value => option(value, 'Explicit local model action'));
        else if (['review', 'diff', 'integrate', 'resume', 'remove', 'attach', 'stop', 'resize', 'send', 'eof'].includes(command) && firstArgument) {
          const retained = await getSessions?.();
          const sessions = Array.isArray(retained) ? retained : retained?.agents ? [retained] : [];
          const candidates = [...list(catalog.agents), ...sessions.flatMap(session => list(session.agents))];
          const seen = new Set();
          entries = candidates.filter(item => item.id && !seen.has(item.id) && seen.add(item.id)).map(agent => option(agent.id, agent.description ?? agent.status ?? 'Retained agent'));
          if (command === 'stop') entries.unshift(option('all', 'Stop all owned work'));
        } else if (['session', 'sessions'].includes(command) && firstArgument) {
          entries = list(await getSessions?.()).map((session, index) => option(String(index + 1), session.directory ?? '', false, `${index + 1} · ${session.goal ?? 'Saved build'}`));
        } else if (['skill', 'skills'].includes(command) && firstArgument) {
          entries = list(catalog.skills).map(skill => option(skill.id, `${skill.provider} · ${skill.scope} · manual only · ${skill.description}`, false, skill.id));
        } else if (command === 'queue') {
          const queue = list(await getQueue?.());
          entries = ['edit', 'remove', 'send'].flatMap(action => queue.map((item, index) => option(`${action} ${index + 1}`, clean(typeof item === 'string' ? item : item.message ?? item.text, 160))));
          replaceStart = prefix.indexOf(' ') + 1; query = rest;
        }
      }
    }
    const needle = query.toLowerCase();
    // Match each field independently. Joining a duplicated value and label can
    // make an unrelated filename appear to contain a cross-field subsequence.
    // Preserve the original group/item ordering for equally ranked matches.
    return entries.map((item, order) => ({ item, order,
      rank: Math.max(...[item.value, item.label, item.description].map(field => matchRank(field, needle, trigger))) }))
      .filter(entry => entry.rank >= 0).sort((left, right) => right.rank - left.rank || left.order - right.order)
      .slice(0, 2000).map(({ item }) => ({ ...item, replaceStart, replaceEnd: cursor }));
  };
}
