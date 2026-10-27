import path from 'node:path';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,511}$/;
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const CHATGPT_UNSET_ENV = Object.freeze([
  'OPENAI_API_KEY', 'CODEX_API_KEY', 'AZURE_OPENAI_API_KEY',
  'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'AZURE_OPENAI_ENDPOINT',
]);

/** Suggestions for an explicit caller choice, never an implicit model switch. */
export const AGENT_PROFILE_DEFAULTS = Object.freeze({
  codex: Object.freeze({ recommendedModel: 'gpt-6.1-sol', recommendedEffort: 'medium', timeoutMs: 300_000 }),
  opencode: Object.freeze({ timeoutMs: 300_000 }),
});

const DESCRIPTIONS = Object.freeze({
  codex: Object.freeze({ kind: 'codex', name: 'Codex', verifiedCliVersion: '0.164.0',
    commandMode: 'exec', transport: 'pipe', inputMode: 'closed',
    accountChoices: Object.freeze(['host', 'chatgpt']) }),
  opencode: Object.freeze({ kind: 'opencode', name: 'OpenCode', verifiedCliVersion: '1.19.4',
    commandMode: 'run', transport: 'pipe', inputMode: 'closed',
    accountChoices: Object.freeze(['host']) }),
});

function fail(code, message) {
  const error = new Error(message);
  error.name = 'AgentProfileError';
  error.code = code;
  throw error;
}

function text(value, maximum) {
  return typeof value === 'string' && value.trim().length > 0
    && !value.includes('\0') && Buffer.byteLength(value) <= maximum;
}

/** Metadata describes an argv profile, not discovery or native qualification. */
export function describeAgentProfile(kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(DESCRIPTIONS, kind)) {
    fail('agent_profile_kind_invalid', 'Choose a Codex or OpenCode profile.');
  }
  return DESCRIPTIONS[kind];
}

/** Build one explicit ProjectAgentPlan without launching or configuring a CLI.
 * Commands retain their own agent loop and permissions. These profiles use the
 * verified noninteractive native exec/run modes, not Koto's JSON worker protocol.
 * Account/model availability stays with the selected host installation.
 */
export function createAgentProfile({ kind, id, command, model, effort, task, owns,
  account = 'host', timeoutMs = 300_000 } = {}) {
  describeAgentProfile(kind);
  if (typeof id !== 'string' || !ID.test(id)) {
    fail('agent_profile_id_invalid', 'Use a unique agent id starting with a letter, followed by letters, digits, underscores or hyphens (up to 64 characters).');
  }
  if (!text(command, 4096) || !path.isAbsolute(command) || /\.(?:cmd|bat)$/i.test(command)) {
    fail('agent_profile_command_invalid', 'Select the absolute path to the installed executable; .cmd and .bat launchers need a separately configured executable wrapper.');
  }
  if (!text(task, 65_536)) fail('agent_profile_task_invalid', 'Provide a nonempty task of at most 64 KiB.');
  if (!Array.isArray(owns) || owns.length < 1 || owns.length > 64
    || owns.some(value => !text(value, 4096) || value.includes('\\') || value.startsWith('/')
      || value.split('/').some(part => part === '..' || part === '.git')
      || (value !== '.' && path.posix.normalize(value).replace(/\/$/, '') !== value.replace(/\/$/, '')))) {
    fail('agent_profile_ownership_invalid', 'Declare 1 to 64 project-relative file or directory paths; use forward slashes and exclude parent paths and .git.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
    fail('agent_profile_timeout_invalid', 'Choose a command timeout from 1 to 3600000 milliseconds.');
  }
  if (model !== undefined && (typeof model !== 'string' || !MODEL.test(model))) {
    fail('agent_profile_model_invalid', 'Use the exact native model identifier, without spaces or shell quoting.');
  }
  if (!DESCRIPTIONS[kind].accountChoices.includes(account)) {
    fail('agent_profile_account_invalid', 'Codex supports host configuration or an explicitly selected ChatGPT login; OpenCode uses its host provider configuration.');
  }

  let args;
  let unsetEnv;
  if (kind === 'codex') {
    if (effort !== undefined && !EFFORTS.has(effort)) {
      fail('agent_profile_effort_invalid', 'Choose a Codex reasoning effort supported by your model: none, minimal, low, medium, high or xhigh.');
    }
    args = ['exec', '--json'];
    if (model !== undefined) args.push('--model', model);
    if (effort !== undefined) args.push('-c', `model_reasoning_effort=${JSON.stringify(effort)}`);
    if (account === 'chatgpt') {
      // This explicit choice requires native ChatGPT authentication instead of
      // accepting API-key fallback. Stored login and approval policy stay native.
      args.push('-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"');
      unsetEnv = [...CHATGPT_UNSET_ENV];
    }
    args.push('--sandbox', 'workspace-write', '{prompt}');
  } else {
    if (effort !== undefined) fail('agent_profile_effort_invalid', 'Configure OpenCode model-specific effort in its native configuration.');
    if (model === undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]*\/.+/.test(model)) {
      fail('agent_profile_model_required', 'OpenCode requires an explicit configured provider/model identifier, such as your local provider alias and model.');
    }
    args = ['run', '--format', 'json', '--model', model, '--dir', '{workspace}', '{prompt}'];
  }
  return { id, command, args, task, owns: [...owns], timeoutMs,
    transport: 'pipe', inputMode: 'closed', ...(unsetEnv ? { unsetEnv } : {}) };
}
