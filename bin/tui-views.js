import { cellWidth, graphemes, terminalText, wrapText } from './tui-text.js';

const clean = value => terminalText(value);
const MARKDOWN_SOURCE_UNITS = 256 * 1024;
const MARKDOWN_SOURCE_LINES = 6000;
function boundedText(value, maximum, unit = 'bytes') {
  const source = String(value);
  const total = unit === 'bytes' ? Buffer.byteLength(source) : source.length;
  if (total <= maximum) return { text: source, displayed: total, total, truncated: false };
  let text = '', used = 0;
  // Include a small lookahead, so a grapheme intersecting the boundary is
  // rejected whole even if it continues past this bounded segmenter input.
  for (const part of graphemes(source.slice(0, maximum + 256))) {
    const size = unit === 'bytes' ? Buffer.byteLength(part.text) : part.text.length;
    if (used + size > maximum) break;
    text += part.text; used += size;
  }
  return { text, displayed: used, total, truncated: true };
}
function wrapLine(line, columns, continuation = '') {
  if (cellWidth(line) <= columns) return [line];
  if (!continuation) return wrapText(line, columns);
  const lines = [], words = line.split(/(\s+)/);
  let current = '';
  for (const word of words) {
    if (cellWidth(current + word) <= columns) { current += word; continue; }
    if (current.trim()) { lines.push(current.trimEnd()); current = continuation; }
    if (!word.trim()) continue;
    for (const part of graphemes(word)) {
      if (cellWidth(current + part.text) > columns && current.trim()) { lines.push(current); current = continuation; }
      current += part.text;
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines;
}

function prepareMarkdown(text) {
  const source = clean(text);
  const bounded = boundedText(source, MARKDOWN_SOURCE_UNITS, 'units');
  const sourceLines = bounded.text.split('\n');
  const visibleLines = sourceLines.slice(0, MARKDOWN_SOURCE_LINES);
  return { bounded, sourceLines, visibleLines, totalLines: source.split('\n').length,
    truncated: bounded.truncated || visibleLines.length < sourceLines.length };
}

/** Whether every sanitized source line fits the renderer's presentation bounds.
 * This pure check uses the same preparation as rendering, including CR/tab and
 * terminal-control normalization; it does not establish semantic diff review. */
export function canRenderMarkdownCompletely(text) {
  return !prepareMarkdown(text).truncated;
}

/** Bounded text presentation, not an HTML renderer or terminal escape parser. */
export function renderMarkdown(text, { columns = process.stdout.columns ?? 80, plain = false, noColor = process.env.NO_COLOR !== undefined } = {}) {
  columns = Math.max(12, Math.min(300, Number(columns) || 80)) - 1;
  const color = !plain && !noColor && process.env.TERM !== 'dumb';
  const ink = (value, code) => color ? `\x1b[${code}m${value}\x1b[0m` : value;
  let code = false;
  const { bounded, sourceLines, visibleLines, totalLines, truncated } = prepareMarkdown(text);
  const rendered = visibleLines.flatMap(line => {
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) { code = !code; return [ink(code ? `── ${fence[1] || 'code'} ──` : '────────', '2')]; }
    if (code) return wrapLine(`  ${line}`, columns, '  ').map(value => ink(value, '2'));
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) return wrapLine(heading[1], columns).map(value => ink(value, '1;36'));
    line = line.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');
    const indent = line.match(/^(\s*(?:[-*+] |\d+\. ))/)?.[1]?.length ?? 0;
    return wrapLine(line, columns, ' '.repeat(Math.min(indent, 12))).map(value =>
      value.replace(/\*\*([^*\n]+)\*\*/g, (_, part) => ink(part, '1')).replace(/`([^`\n]+)`/g, (_, part) => ink(part, '36')));
  });
  if (truncated) rendered.push(
    `[Response display truncated: ${visibleLines.length} of ${totalLines} source lines shown; ${bounded.truncated ? 'the final displayed line may be an excerpt' : `${sourceLines.length - visibleLines.length} source lines omitted`}.]`);
  return rendered.join('\n');
}

export function planItems(proposal) {
  const tasks = proposal?.tasks ?? [];
  if (!Array.isArray(tasks) || tasks.length > 8) throw new RangeError('A plan must contain at most eight tasks; no partial plan is displayed.');
  return tasks.map((task, index) => ({ value: task.id, id: task.id,
    label: `${index + 1}. ${clean(task.id)} · ${clean(task.label ?? task.worker ?? '')}`,
    description: `${clean(task.task).slice(0, 180)}${task.dependsOn?.length ? ` · after ${task.dependsOn.map(clean).join(', ')}` : ''}`,
    detail: `Assignment\n${clean(task.task)}\n\nOwner: ${clean(task.worker ?? task.label)}\nFiles: ${(task.owns ?? []).map(clean).join(', ')}\nDependencies: ${(task.dependsOn ?? []).map(clean).join(', ') || 'none'}\nModel: ${clean(task.model ?? 'native default')}` }));
}

export function taskItems(state) {
  const agents = state?.agents ?? [];
  if (!Array.isArray(agents) || agents.length > 32) throw new RangeError('The retained task list exceeds the supported 32-agent display; no partial list is displayed.');
  return agents.map(agent => {
    const activity = agent.activity?.description ?? agent.activity?.activity ?? agent.nativeStatus;
    const dependencies = agent.dependsOn ?? agent.dependencies ?? [];
    const status = clean(agent.status ?? 'unknown');
    return { value: agent.id, id: agent.id, label: `${clean(agent.id)} · ${status}`,
      description: `${clean(activity ?? agent.task ?? '')}${dependencies.length ? ` · after ${dependencies.map(clean).join(', ')}` : ''}`,
      detail: `Agent: ${clean(agent.id)}\nStatus: ${status}\nTask: ${clean(agent.task)}\nDependencies: ${dependencies.map(clean).join(', ') || 'none'}\nWorkspace: ${clean(agent.workspace?.path ?? agent.workspace ?? agent.cwd ?? agent.worktree)}\nObserved activity: ${clean(activity ?? 'unobserved')}\nIntegration: ${clean(agent.integration?.status ?? 'not integrated')}\nResult: ${clean(agent.result?.error ?? agent.result?.status ?? 'none')}` };
  });
}

export function diffItems(review) {
  const raw = typeof review === 'string' ? review : review?.integrationDiff ?? review?.diff;
  if (typeof raw !== 'string') return [{ value: '__diff_unavailable__', label: 'Diff unavailable',
    description: 'No textual diff was provided; this does not establish that no files changed.', detail: 'Inspect the retained contribution before accepting changes.' }];
  const diff = clean(raw);
  const allChunks = diff.split(/(?=^diff --git )/m).filter(chunk => chunk.trim());
  const total = allChunks.length;
  if (!total) {
    const conflicts = Array.isArray(review?.conflicts) ? review.conflicts : [];
    return [{ value: '__diff_empty__', label: conflicts.length ? 'Diff unavailable while conflicts remain' : 'Empty textual diff',
      description: conflicts.length ? `${conflicts.length} unresolved conflict path(s); no change verdict is available.` : '0 textual file sections returned; changed-path and binary/metadata records remain separate evidence.',
      detail: conflicts.map(clean).join('\n') }];
  }
  const chunks = allChunks.slice(0, 256);
  const items = chunks.map((chunk, index) => {
    const name = chunk.match(/^\+\+\+ b\/(.+)$/m)?.[1] ?? chunk.match(/^--- a\/(.+)$/m)?.[1]
      ?? chunk.match(/^diff --git (.*)$/m)?.[1] ?? `Diff ${index + 1}`;
    const lines = chunk.split('\n');
    const added = lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
    const removed = lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length;
    const preview = boundedText(chunk, 128 * 1024);
    return { value: String(index + 1), label: name,
      description: `+${added} −${removed}${preview.truncated ? ` · detail excerpt ${preview.displayed}/${preview.total} bytes` : ''}`,
      detail: preview.text + (preview.truncated ? `\n[Diff detail truncated: ${preview.displayed} of ${preview.total} bytes shown; ${preview.total - preview.displayed} bytes omitted.]` : ''),
      displayedBytes: preview.displayed, totalBytes: preview.total, truncated: preview.truncated };
  });
  const partialDetails = items.filter(item => item.truncated).length;
  const omitted = total - chunks.length;
  const summary = `Showing ${chunks.length} of ${total} textual file sections${omitted ? `; ${omitted} sections omitted` : ''}${partialDetails ? `; ${partialDetails} displayed file details are excerpts` : ''}.`;
  items.unshift({ value: '__diff_summary__', label: `Diff · ${chunks.length}/${total} file sections`, description: summary,
    detail: `${summary}\nFile additions/removals count the complete provided sections; details are bounded previews. An excerpt is not a complete review.`,
    displayedFiles: chunks.length, totalFiles: total, truncated: omitted > 0 || partialDetails > 0 });
  if (omitted) items.push({ value: '__diff_omitted__', label: `${omitted} additional file sections omitted`,
    description: 'The file-list display limit was reached; inspect the full retained contribution separately.',
    detail: `Only the first ${chunks.length} of ${total} file sections are listed in this view. The remaining ${omitted} sections have not been displayed.`, truncated: true });
  return items;
}

export function formatCompletion(state = {}) {
  const agents = state.agents ?? [];
  const completed = agents.filter(agent => agent.status === 'succeeded').length;
  const failed = agents.filter(agent => agent.status === 'failed').length;
  const unresolved = agents.filter(agent => ['pending', 'running', 'blocked'].includes(agent.status));
  const lines = ['Work summary', `Goal: ${clean(state.goal ?? state.summary ?? 'Selected work')}`];
  if (agents.length) lines.push(`Agents: ${completed}/${agents.length} succeeded${failed ? `; ${failed} failed` : ''}${unresolved.length ? `; ${unresolved.length} unresolved` : ''}`);
  const files = state.changedFiles ?? state.integrationChangedPaths ?? state.changedPaths ?? state.files;
  if (Array.isArray(files)) {
    lines.push(`Changed files reported: ${files.length ? files.slice(0, 64).map(item => clean(typeof item === 'string' ? item : item.path)).join(', ') : '0'}`);
    if (files.length > 64) lines.push(`[Changed-file summary truncated: 64 of ${files.length} paths shown; ${files.length - 64} omitted.]`);
  } else if (typeof state.diff === 'string' || typeof state.integrationDiff === 'string') {
    const diff = diffItems(state);
    const names = diff.filter(item => /^\d+$/.test(item.value)).map(item => item.label);
    if (names.length) {
      lines.push(`File names represented in textual diff: ${names.slice(0, 64).map(clean).join(', ')}`);
      const summary = diff[0];
      lines.push(`Diff file-name summary: ${Math.min(64, names.length)}/${summary.totalFiles ?? names.length} file sections represented${names.length > 64 || summary.truncated ? ' · bounded preview' : ''}.`);
    } else lines.push('Changed files: not reported; the provided textual diff has no file sections.');
  } else lines.push('Changed files: not reported in this result.');
  for (const agent of agents) lines.push(`  ${clean(agent.id)}: ${clean(agent.result?.error ?? agent.status)}${agent.integration ? ` · integration ${clean(agent.integration.status)}` : ''}`);
  const checks = Array.isArray(state.verification) ? state.verification : Array.isArray(state.checks) ? state.checks : [];
  if (checks.length) {
    lines.push('Observed verification:');
    for (const check of checks.slice(0, 32)) {
      const record = check && typeof check === 'object' ? check : undefined;
      lines.push(`  ${clean(typeof check === 'string' ? check : record?.command ?? record?.name ?? record?.id ?? 'Unnamed recorded check')}${record ? ` · ${clean(record.status ?? record.conclusion ?? 'outcome unreported')}` : ''}`);
    }
    if (checks.length > 32) lines.push(`[Verification summary truncated: 32 of ${checks.length} records shown; ${checks.length - 32} omitted.]`);
  } else lines.push('Verification: no independent acceptance evidence is attached to this summary; agent completion alone is not acceptance.');
  if (state.outsideOwnership?.length) lines.push(`Outside planned ownership: ${state.outsideOwnership.map(clean).join(', ')}`);
  lines.push('Next: /tasks for retained task state, /review for changes, /integrate for an explicit reviewed integration.');
  return lines.join('\n');
}

export function formatError(error) {
  const code = clean(error?.code ?? 'operation_failed');
  const message = clean(error?.message ?? error);
  let recovery = 'Review the details, correct the selected setup, then retry explicitly.';
  if (/cleanup_unconfirmed|cleanup_not_confirmed/.test(code + message)) recovery = 'Inspect owned process cleanup before continuing. Replacement or integration stays blocked.';
  else if (/socket_exhausted|EADDRNOTAVAIL|EMFILE|ENFILE/.test(code + message)) recovery = 'Stop new requests and inspect socket/file-descriptor capacity. Do not retry in a loop.';
  else if (/auth|login|credential|subscription/.test(code + message)) recovery = 'Open /accounts to inspect the native login, then retry explicitly.';
  else if (/model|endpoint|runtime/.test(code + message)) recovery = 'Use /models or /catalog refresh to inspect installed models and loopback runtime readiness.';
  else if (/project|git|workspace/.test(code + message)) recovery = 'Confirm the selected folder and Git state with /project. Existing edits are preserved.';
  else if (/coordinator|native_|timeout/.test(code + message)) recovery = 'Use /agent to reconnect the configured coordinator, /model to change its model, or retry the request explicitly.';
  return `Operation needs attention · ${code}\n${message}\n${recovery}`;
}
