// Temporary manual observation binding. Importing this module starts no workload.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const MODEL = Object.freeze({ catalogId: 'qwen-compact', repository: 'Qwen/Qwen3-4B-GGUF',
  revision: 'bc640142c66e1fdd12af0bd68f40445458f3869b', filename: 'Qwen3-4B-Q4_K_M.gguf',
  bytes: 2497280256, sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5' });
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v, min, max, name) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) fail(`reviewed_${name}_required`);
};
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : object(value) ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
    : JSON.stringify(value);
export function inferenceHash(settings) {
  return sha256(canonical({ modelSha256: MODEL.sha256,
    contextSize: settings.runtime?.contextSize, cacheRamMiB: settings.runtime?.cacheRamMiB,
    outputTokens: settings.native?.outputTokens, nativeModelOptions: settings.native?.modelOptions,
    providerTimeoutMs: settings.native?.providerOptions?.timeout,
    chunkTimeoutMs: settings.native?.providerOptions?.chunkTimeout, nativeSteps: 4 }));
}
export function validateSettings(s, { candidate, platform = 'win32', requireGates = true } = {}) {
  if (!object(s) || s.schemaVersion !== 1 || s.approvedForExecution !== true
    || !/^[a-f0-9]{40}$/.test(s.candidate ?? '') || s.candidate !== candidate) fail('reviewed_candidate_required');
  if (canonical(s.model) !== canonical(MODEL)) fail('reviewed_model_pin_changed');
  if (!object(s.candidateApi) || !hex(s.candidateApi.localModelsSha256) || !hex(s.candidateApi.coreTypesSha256)) fail('reviewed_candidate_api_required');
  if (!object(s.runtime) || !object(s.native) || !object(s.bounds) || !object(s.tasks)) fail('reviewed_bounds_required');
  const r = s.runtime, n = s.native, b = s.bounds;
  integer(r.contextSize, 4096, 16384, 'context');
  integer(r.memoryLimitBytes, 3 * 1024 ** 3, 8 * 1024 ** 3, 'rss');
  integer(r.minimumFreeBytes, 3 * 1024 ** 3, 6 * 1024 ** 3, 'reserve');
  integer(r.startupTimeoutMs, 30_000, 120_000, 'startup_deadline');
  integer(r.startupMaxRetries, 0, 3, 'startup_retries');
  integer(r.timeoutMs, r.startupTimeoutMs, 1_800_000, 'runtime_deadline');
  // Root's pending final product exposes and reports cacheRamMiB. Verify both
  // exact candidate source hashes and the runtime's reported value before agents.
  integer(r.cacheRamMiB, 0, 512, 'cache_ram_mib');
  if (!object(n.providerOptions) || Object.keys(n.providerOptions).sort().join(',') !== 'chunkTimeout,headerTimeout,timeout'
    || !object(n.modelOptions)) fail('reviewed_native_options_required');
  integer(n.providerOptions.timeout, 60_000, 600_000, 'provider_deadline');
  integer(n.providerOptions.headerTimeout, 60_000, n.providerOptions.timeout, 'header_deadline');
  integer(n.providerOptions.chunkTimeout, 15_000, n.providerOptions.timeout, 'chunk_deadline');
  integer(n.outputTokens, 128, 2048, 'native_output_tokens');
  integer(n.steps, 4, 4, 'native_steps');
  if (n.providerOptions.headerTimeout !== n.providerOptions.timeout) fail('reviewed_header_timeout_mismatch');
  // Model options must be exact reviewed JSON, not paths, executable hooks, or provider selection.
  if (Buffer.byteLength(JSON.stringify(n.modelOptions)) > 8192
    || Object.keys(n.modelOptions).some(k => /url|endpoint|api.?key|token|auth|command|plugin|mcp/i.test(k))) fail('native_model_options_out_of_scope');
  integer(b.minimumAvailableBytes, 10 * 1024 ** 3, 12 * 1024 ** 3, 'available_memory');
  integer(b.minimumCpus, 4, 4, 'cpu_admission');
  integer(b.freeDiskBeforeAssetsBytes, 6 * 1024 ** 3, 12 * 1024 ** 3, 'asset_disk');
  integer(b.freeDiskBeforeStartBytes, 3 * 1024 ** 3, b.freeDiskBeforeAssetsBytes, 'start_disk');
  integer(b.agentTimeoutMs, 60_000, 1_500_000, 'agent_deadline');
  integer(b.projectTimeoutMs, b.agentTimeoutMs, 1_560_000, 'project_deadline');
  integer(b.observationTimeoutMs, b.projectTimeoutMs + 30_000, 1_800_000, 'observation_deadline');
  if (r.timeoutMs > b.observationTimeoutMs || n.providerOptions.timeout > b.agentTimeoutMs) fail('reviewed_deadline_order');
  integer(b.acquisitionTimeoutSeconds, 60, 900, 'acquisition_deadline');
  integer(b.assetAttemptTimeoutSeconds, 30, 600, 'asset_attempt_deadline');
  integer(b.maxRawBytes, 1024 ** 2, 128 * 1024 ** 2, 'raw_output_bound');
  for (const id of ['reader','contributor']) {
    if (typeof s.tasks[id] !== 'string' || !s.tasks[id].trim() || Buffer.byteLength(s.tasks[id]) > 4096
      || /[\x00-\x1f\x7f]/.test(s.tasks[id])) fail('reviewed_single_line_task_required');
  }
  if (!Array.isArray(s.operations) || s.operations.length < 5 || s.operations.length > 20) fail('reviewed_operations_required');
  let elapsed = 0, sends = 0, readerStopped = false, afterStop = false;
  const resized = new Set(), initial = new Set();
  for (const op of s.operations) {
    if (!object(op) || !['wait','send','resize','stop'].includes(op.action)) fail('reviewed_operation_invalid');
    if (op.action === 'wait') { integer(op.ms, 250, 600_000, 'operation_wait'); elapsed += op.ms; continue; }
    if (!['reader','contributor'].includes(op.agentId)) fail('reviewed_operation_agent');
    if (op.action === 'send') {
      if (++sends > 4 || op.agentId === 'reader' && readerStopped) fail('reviewed_send_bound');
      const text = op.task === true ? s.tasks[op.agentId] : op.text;
      if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 4096 || /[\x00-\x1f\x7f]/.test(text)) fail('reviewed_single_line_input_required');
      if (op.task === true) { if (initial.has(op.agentId)) fail('reviewed_duplicate_initial_task'); initial.add(op.agentId); }
      if (readerStopped && op.agentId === 'contributor') afterStop = true;
    } else if (op.action === 'resize') {
      integer(op.columns, 60, 180, 'terminal_columns'); integer(op.rows, 15, 60, 'terminal_rows'); resized.add(op.agentId);
    } else {
      if (op.agentId !== 'reader' || readerStopped) fail('reviewed_peer_stop_order'); readerStopped = true;
      elapsed += 15_000;
    }
  }
  if (!afterStop || resized.size !== 2 || initial.size !== 2 || elapsed + 90_000 > b.projectTimeoutMs) fail('reviewed_operation_coverage_or_deadline');
  if (requireGates) {
    const mac = s.gates?.mac;
    if (!object(mac) || mac.route !== 'normal-cli-commercial-plus-local-api' || mac.candidate !== candidate
      || mac.modelSha256 !== MODEL.sha256 || !hex(mac.evidenceReceiptSha256)
      || typeof mac.evidenceId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(mac.evidenceId)
      || mac.operatorReviewed !== true || mac.usefulCooperationReviewed !== true || mac.cleanupConfirmed !== true) fail('reviewed_mac_cooperation_evidence_required');
    // Mac's successful normal CLI/local-agent route is a different evidence
    // layer. It is NOT asserted to be an OpenCode native inference-equivalence run.
    if (platform === 'win32') {
      const linux = s.gates?.linux;
      if (!object(linux) || linux.route !== 'linux-docker-opencode-native' || linux.candidate !== candidate
        || linux.modelSha256 !== MODEL.sha256 || linux.inferenceSettingsSha256 !== inferenceHash(s)
        || !hex(linux.reviewedSettingsSha256) || !hex(linux.evidenceReceiptSha256) || !hex(linux.reviewToken)
        || typeof linux.evidenceId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(linux.evidenceId)
        || linux.operatorReviewed !== true || linux.usefulContributionReviewed !== true
        || linux.cleanupConfirmed !== true || linux.nativeInputAndResizeVerified !== true
        || linux.integrationConfirmed !== true) fail('reviewed_linux_native_evidence_required');
    }
  }
  return s;
}
export function loadSettings(filename, expectedHash, options) {
  if (!hex(expectedHash)) fail('reviewed_settings_hash_required');
  const bytes = readFileSync(filename);
  if (bytes.length > 65536 || sha256(bytes) !== expectedHash) fail('reviewed_settings_bytes_changed');
  const settings = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return validateSettings(settings, options);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, filename, expectedHash, candidate] = process.argv.slice(2);
  if (mode === 'fingerprint') {
    const bytes = readFileSync(filename); if (bytes.length > 65536) fail('settings_size_bound');
    process.stdout.write(`${JSON.stringify({ settingsSha256: sha256(bytes), inferenceSettingsSha256: inferenceHash(JSON.parse(bytes)) })}\n`);
  } else if (mode === 'validate') {
    const settings = loadSettings(filename, expectedHash, { candidate, platform: 'win32' });
    process.stdout.write(`${JSON.stringify(settings)}\n`);
  } else fail('settings_command_required');
}
