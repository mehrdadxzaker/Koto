import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { buildProjectPlan, preflightProjectPlan } from '../src/project-plan.js';

const help = `Prepare an explicit native-agent project plan

  koto plan build <tasks.json> <new-plan.json>
  koto plan check <plan.json>

build expands selected Codex/OpenCode runtimes, models, tasks and ownership
into reviewable argv. It writes a new private file and never launches an agent.
check reports repository, executable, terminal and declared local prerequisites.
It does not authenticate, download models, change settings or call a model.
Start an inspected plan with koto project start <plan.json>.
`;

async function readJson(filename) {
  const file = await open(filename, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK));
  try {
    if (!(await file.stat()).isFile()) throw new Error('project_plan_not_regular_file');
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 1024 * 1024) throw new Error('project_plan_too_large');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
  } finally { await file.close(); }
}

/** CLI rendering and file handling only; plan policy and readiness live in the core. */
export async function runPlanCli(args, { write } = {}) {
  if (!args.length || args.length === 1 && args[0] === '--help') { write(help); return 0; }
  if (args[0] === 'build' && args.length === 3) {
    const plan = buildProjectPlan(await readJson(args[1]));
    const file = await open(args[2], 'wx', 0o600);
    try { await file.writeFile(`${JSON.stringify(plan, null, 2)}\n`); }
    finally { await file.close(); }
    write('Prepared a new private plan. Inspect its commands, task ownership, models and prerequisites before starting it.\n');
    return 0;
  }
  if (args[0] === 'check' && args.length === 2) {
    const result = await preflightProjectPlan(await readJson(args[1]));
    write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }
  write(help);
  return 2;
}
