import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { connect } from 'node:net';
import path from 'node:path';
import { validateProjectPlan } from './project-session.js';
import { resolveTerminalHelper } from './terminal-helper.js';
import { inspectLaunchProject, resolveAgentExecutable } from './launch-preflight.js';

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,255}$/;
const API_ENV = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'AZURE_OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE'];
const fail = code => { throw new Error(code); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function absoluteFile(value) {
  return typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0') && value.length <= 4096;
}

function localEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { fail('project_invalid_local_endpoint'); }
  if (typeof value !== 'string' || value.length > 4096 || !['http:', 'https:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash) fail('project_invalid_local_endpoint');
  return url.href.replace(/\/$/, '');
}

/** Prerequisites are declarations, never configuration changes or model-start instructions. */
export function normalizeProjectPrerequisites(value, agentIds) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('project_invalid_prerequisites');
  const allowed = new Set(agentIds);
  const result = {};
  for (const [id, requirement] of Object.entries(value)) {
    if (!allowed.has(id) || !requirement || typeof requirement !== 'object' || Array.isArray(requirement)
        || Object.keys(requirement).some(key => !['configFile', 'localEndpoint', 'model'].includes(key))) fail('project_invalid_prerequisites');
    const item = {};
    if (requirement.configFile !== undefined) {
      if (!absoluteFile(requirement.configFile)) fail('project_invalid_prerequisite_file');
      item.configFile = requirement.configFile;
    }
    if (requirement.localEndpoint !== undefined) item.localEndpoint = localEndpoint(requirement.localEndpoint);
    if (requirement.model !== undefined) {
      if (typeof requirement.model !== 'string' || !MODEL.test(requirement.model) || !requirement.model.includes('/')) fail('project_invalid_native_model');
      item.model = requirement.model;
    }
    if (Object.keys(item).length === 0) fail('project_invalid_prerequisites');
    Object.defineProperty(result, id, { value: item, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

/** Expand an explicit task/model/ownership plan into reviewable native argv. No agent is launched. */
export function buildProjectPlan(source) {
  if (!source || !Array.isArray(source.agents)) fail('project_invalid_plan');
  const prerequisites = normalizeProjectPrerequisites(source.prerequisites, source.agents.map(agent => agent?.id));
  const agents = source.agents.map(agent => {
    if (!agent || !['codex', 'opencode', 'command'].includes(agent.runtime)) fail('project_unknown_runtime');
    if (agent.runtime === 'command') return { ...agent };
    if (typeof agent.model !== 'string' || !MODEL.test(agent.model)) fail('project_explicit_model_required');
    if (agent.unsetEnv !== undefined && (!Array.isArray(agent.unsetEnv)
        || agent.unsetEnv.some(key => typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)))) fail('project_invalid_environment');
    if (agent.args !== undefined || agent.input !== undefined || agent.inputMode !== undefined) fail('project_native_preset_argv_conflict');
    const transport = agent.transport ?? 'pty';
    if (!['pty', 'pipe'].includes(transport)) fail('project_invalid_transport');
    const common = { id: agent.id, command: agent.command ?? agent.runtime, task: agent.task, owns: agent.owns,
      transport, timeoutMs: agent.timeoutMs, ...(agent.terminal === undefined ? {} : { terminal: agent.terminal }),
      native: { kind: agent.runtime, protocol: transport === 'pty' ? 'terminal' : 'jsonl', model: agent.model,
        account: agent.runtime === 'codex' ? 'chatgpt' : 'host',
        ...(agent.runtime === 'codex' ? { sandbox: agent.sandbox ?? 'workspace-write' } : {}) },
      inputMode: transport === 'pty' ? 'pipe' : 'closed' };
    if (agent.runtime === 'codex') {
      if (agent.auth !== 'chatgpt') fail('project_codex_chatgpt_auth_required');
      const sandbox = agent.sandbox ?? 'workspace-write';
      if (!['read-only', 'workspace-write'].includes(sandbox)) fail('project_unsupported_native_policy');
      const args = transport === 'pty' ? ['--no-daemon', '--ask-for-approval', 'on-request'] : ['exec', '--json', '--ignore-user-config'];
      args.push('--model', agent.model, '--sandbox', sandbox, '-c', 'model_provider="openai"', '-c', 'forced_login_method="chatgpt"', '{prompt}');
      return { ...common, args, unsetEnv: [...new Set([...API_ENV, ...(agent.unsetEnv ?? [])])] };
    }
    if (agent.sandbox !== undefined) fail('project_opencode_sandbox_unsupported');
    if (!agent.model.includes('/')) fail('project_opencode_provider_model_required');
    if (!agent.localRuntime || !absoluteFile(agent.localRuntime.configFile)) fail('project_local_runtime_required');
    const requirement = { configFile: agent.localRuntime.configFile, localEndpoint: localEndpoint(agent.localRuntime.endpoint), model: agent.model };
    if (own(prerequisites, agent.id)) fail('project_duplicate_prerequisites');
    Object.defineProperty(prerequisites, agent.id, { value: requirement, enumerable: true, configurable: true, writable: true });
    const args = transport === 'pty' ? ['--model', agent.model, '--prompt', '{prompt}'] : ['run', '--format', 'json', '--model', agent.model, '{prompt}'];
    return { ...common, args, unsetEnv: agent.unsetEnv ?? [] };
  });
  const plan = validateProjectPlan({ ...source, agents });
  return { ...plan, ...(Object.keys(prerequisites).length ? { prerequisites } : {}) };
}

async function readConfig(filename) {
  const handle = await open(filename, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 512 * 1024) fail('project_config_not_regular_or_too_large');
    const buffer = Buffer.alloc(512 * 1024 + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 512 * 1024) fail('project_config_too_large');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
  } finally { await handle.close(); }
}

async function endpointListening(endpoint) {
  const url = new URL(endpoint);
  return new Promise(resolve => {
    // Resolve localhost ourselves so this read-only probe cannot contact an external host.
    const socket = connect({ host: url.hostname === '[::1]' ? '::1' : '127.0.0.1',
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) });
    let complete = false;
    const finish = result => { if (!complete) { complete = true; socket.destroy(); resolve(result); } };
    socket.setTimeout(1000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/** Read-only readiness checks. Never builds helpers, writes config, launches agents or calls a model. */
export async function preflightProjectPlan(source) {
  return preflight(source, true);
}

/** Runtime prerequisites for a separately validated, retained owned workspace. */
export async function preflightProjectRuntime(source) {
  return preflight(source, false);
}

async function preflight(source, checkProject) {
  const plan = validateProjectPlan(source);
  const prerequisites = normalizeProjectPrerequisites(source.prerequisites, plan.agents.map(agent => agent.id));
  const checks = [];
  const executables = {};
  const add = (id, status, message, agentId) => checks.push({ id, status, message, ...(agentId ? { agentId } : {}) });
  if (checkProject) try {
    await inspectLaunchProject(plan.project, { nativeHelperDirectory: plan.nativeHelperDirectory });
    add('repository', 'ready', 'The project has a committed HEAD and a clean worktree.');
  } catch (error) {
    const known = typeof error.code === 'string' && /^launch_[a-z0-9_]+$/.test(error.code);
    add('repository', 'blocked', known ? error.message : 'The repository could not be inspected within the read-only preflight limit.');
  }
  if (plan.agents.some(agent => agent.transport === 'pty') || process.platform === 'win32') {
    try {
      await resolveTerminalHelper({ directory: plan.nativeHelperDirectory });
      add('terminal_helper', 'ready', 'The explicitly built platform terminal helper matches this Koto source.');
    } catch (error) {
      const code = typeof error.code === 'string' && /^[a-z][a-z0-9_]+$/.test(error.code) ? error.code : 'pty_unavailable';
      add('terminal_helper', 'blocked', `Terminal/process transport is unavailable: ${code}. Run koto terminal build on this host.`);
    }
  }
  for (const agent of plan.agents) {
    try {
      const command = await resolveAgentExecutable(agent.command === '$node' ? process.execPath : agent.command,
        { unsetEnv: agent.unsetEnv });
      Object.defineProperty(executables, agent.id, { value: command, enumerable: true });
      add('executable', 'ready', 'The selected executable is available.', agent.id);
    } catch {
      add('executable', 'blocked', 'The selected executable is missing, relative, non-executable, or a shell wrapper unsupported by direct spawn.', agent.id);
    }
    const requirement = own(prerequisites, agent.id) ? prerequisites[agent.id] : undefined;
    if (!requirement) continue;
    if (requirement.configFile) {
      try {
        const config = await readConfig(requirement.configFile);
        if (requirement.model) {
          const configEnv = agent.unsetEnv.includes('OPENCODE_CONFIG') ? undefined : process.env.OPENCODE_CONFIG;
          if (!absoluteFile(configEnv) || await realpath(configEnv) !== await realpath(requirement.configFile)
              || ['OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG_DIR'].some(key => process.env[key] && !agent.unsetEnv.includes(key))) {
            fail('project_opencode_config_not_selected');
          }
          const separator = requirement.model.indexOf('/');
          const provider = requirement.model.slice(0, separator), model = requirement.model.slice(separator + 1);
          const selected = config?.provider?.[provider];
          if (!Array.isArray(config?.enabled_providers) || config.enabled_providers.length !== 1 || config.enabled_providers[0] !== provider
              || !selected?.models || !own(selected.models, model) || typeof selected?.options?.baseURL !== 'string'
              || localEndpoint(selected.options.baseURL) !== requirement.localEndpoint) fail('project_opencode_local_config_mismatch');
          add('configuration', 'ready', 'OPENCODE_CONFIG selects a JSON file declaring the requested model and loopback provider URL.', agent.id);
          add('native_configuration', 'unverified', 'OpenCode may merge native project or organization settings; inspect its effective configuration. Endpoint and file checks do not prove local-only inference.', agent.id);
        } else add('configuration', 'ready', 'The declared JSON configuration file is readable.', agent.id);
      } catch { add('configuration', 'blocked', 'The declared JSON configuration is unavailable, mismatched, or not selected by OPENCODE_CONFIG. No settings were changed.', agent.id); }
    }
    if (requirement.localEndpoint) {
      const listening = await endpointListening(requirement.localEndpoint);
      add('local_runtime', listening ? 'ready' : 'blocked', listening ? 'A loopback listener accepts connections; model availability and inference are unverified.' : 'The configured loopback runtime is not accepting connections. Start the intended runtime separately.', agent.id);
    }
  }
  for (let left = 0; left < plan.agents.length; left += 1) for (let right = left + 1; right < plan.agents.length; right += 1) {
    const a = plan.agents[left], b = plan.agents[right];
    if (a.owns.some(one => b.owns.some(two => one === '.' || two === '.' || one === two || one.startsWith(`${two}/`) || two.startsWith(`${one}/`)))) {
      add('ownership_overlap', 'unverified', `${a.id} and ${b.id} have overlapping declared ownership; integration may conflict.`);
    }
  }
  add('native_readiness', 'unverified', 'Native login, supported CLI flags, permissions, model access, and completion require observation with the selected client. No agent or model was launched.');
  return { schemaVersion: 1, ok: !checks.some(check => check.status === 'blocked'), checks, executables };
}
