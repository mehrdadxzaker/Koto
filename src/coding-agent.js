import { createCodexAppServerSession } from './codex-app-server.js';
import { createClaudeAgentSession } from './claude-agent-session.js';
import { createLocalAgentSession } from './local-agent.js';

/** One surface-independent coding-agent boundary, with per-action approval. */
export function createCodingAgentSession(options) {
  if (!options || !['codex', 'claude', 'local'].includes(options.kind)) throw new TypeError('Choose codex, claude or local.');
  if (options.kind === 'local') return createLocalAgentSession(options);
  // Identity comes from the host-selected session, never a native tool's text.
  // It lets every surface identify and stop only the requesting worker.
  const onApproval = async request => (await options.onApproval?.(Object.freeze({ ...request,
    agentId: options.id ?? options.kind }))) === true ? 'approve' : 'deny';
  return options.kind === 'codex'
    ? createCodexAppServerSession({ ...options, onApproval })
    : createClaudeAgentSession({ ...options, onApproval });
}
