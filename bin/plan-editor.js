import { stripVTControlCharacters } from 'node:util';

const visible = value => stripVTControlCharacters(String(value ?? ''))
  .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const cancellation = value => ['cancel', '/cancel', '/quit'].includes(value.toLowerCase());
const taskChanges = proposal => proposal.tasks.map(({ id, worker, task, owns, dependsOn }) =>
  ({ id, worker, task, owns: [...owns], dependsOn: [...dependsOn] }));

/** Local proposal editing only. The caller still asks for launch approval.
 * `revise` must use the coordinator that created the proposal; it validates
 * every edit against that proposal's original configured workers and budget.
 */
export async function editBuildProposal({ proposal, revise, ask, write } = {}) {
  if (!proposal || typeof revise !== 'function' || typeof ask !== 'function' || typeof write !== 'function') {
    throw new TypeError('A build proposal, coordinator revise function and terminal ask/write functions are required.');
  }
  let current = proposal;
  const print = message => write(`${visible(message)}\n`);
  const read = async prompt => {
    const answer = await ask(prompt);
    if (typeof answer !== 'string' || Buffer.byteLength(answer) > 65_536 || answer.includes('\0')) {
      throw new Error('Enter a shorter text response without control characters.');
    }
    return answer.trim();
  };
  const review = () => {
    print(`\nBuild plan: ${current.summary}`);
    print(`Project: ${current.project.projectRoot}\nBase: ${current.project.baseCommit}`);
    print(`Concurrent tasks: ${current.plan.maxConcurrency}; overall build timeout: ${Math.ceil(current.plan.timeoutMs / 1_000)}s`);
    current.tasks.forEach((task, index) => {
      print(`\n${index + 1}. ${task.id} — ${task.label}${task.model ? ` / ${task.model}` : ''}`);
      print(`   ${task.task}\n   Owns: ${task.owns.join(', ')}\n   After: ${task.dependsOn.length ? task.dependsOn.join(', ') : 'none'}`);
      const execution = current.plan.agents.find(agent => agent.id === task.id);
      print(`   Task timeout: ${Math.ceil(execution.timeoutMs / 1_000)}s`);
    });
    for (const warning of current.warnings ?? []) print(`Note: ${warning}`);
    print('Workers use separate Git worktrees. Changes return for your review and explicit integration.');
  };
  const chooseTask = async () => {
    const answer = await read(`Task number [1-${current.tasks.length}] (Enter returns): `);
    if (!answer || cancellation(answer)) return undefined;
    if (!/^\d+$/.test(answer) || Number(answer) < 1 || Number(answer) > current.tasks.length) {
      throw new Error('Choose a task number from the displayed plan.');
    }
    return Number(answer) - 1;
  };

  for (;;) {
    review();
    const command = (await read('Enter keeps this plan; edit changes it; cancel returns to chat: ')).toLowerCase();
    if (!command || ['keep', 'done', 'review'].includes(command)) return current;
    if (cancellation(command)) return undefined;
    if (!['edit', 'e'].includes(command)) {
      print('Choose edit, cancel, or press Enter to continue with this plan.');
      continue;
    }
    for (;;) {
      print('\nEdit: 1 task assignment · 2 worker/model · 3 owned paths · 4 dependencies · 5 concurrency · 6 summary');
      const field = await read('Field [1-6]; Enter reviews; cancel discards this build: ');
      if (!field) break;
      if (cancellation(field)) return undefined;
      try {
        if (field === '5') {
          const answer = await read(`Concurrent tasks [${current.plan.maxConcurrency}], between 1 and ${current.tasks.length}: `);
          if (!answer || cancellation(answer)) continue;
          if (!/^\d+$/.test(answer)) throw new Error('Enter a whole number of concurrent tasks.');
          current = revise(current, { maxConcurrency: Number(answer) });
        } else if (field === '6') {
          const summary = await read('New plan summary (Enter keeps current): ');
          if (summary && !cancellation(summary)) current = revise(current, { summary });
        } else if (['1', '2', '3', '4'].includes(field)) {
          const index = await chooseTask();
          if (index === undefined) continue;
          const tasks = taskChanges(current);
          const selected = tasks[index];
          if (field === '1') {
            print(`Current assignment: ${selected.task}`);
            const task = await read('New assignment (Enter keeps current): ');
            if (!task || cancellation(task)) continue;
            selected.task = task;
          } else if (field === '2') {
            current.workers.forEach((worker, workerIndex) => print(`${workerIndex + 1}. ${worker.label}${worker.model ? ` / ${worker.model}` : ''}`));
            const answer = await read('Configured worker number (Enter keeps current): ');
            if (!answer || cancellation(answer)) continue;
            if (!/^\d+$/.test(answer) || Number(answer) < 1 || Number(answer) > current.workers.length) {
              throw new Error('Choose one of the configured workers shown above.');
            }
            selected.worker = current.workers[Number(answer) - 1].id;
          } else if (field === '3') {
            print(`Current paths: ${selected.owns.join(', ')}`);
            print('Enter literal project-relative paths one at a time; no globs. A single . owns the whole project.');
            const owns = [];
            while (owns.length < 64) {
              const item = await read(owns.length ? 'Another owned path (Enter finishes): ' : 'New owned path (Enter keeps current): ');
              if (cancellation(item)) { owns.length = 0; break; }
              if (!item) break;
              owns.push(item);
            }
            if (!owns.length) continue;
            selected.owns = owns;
          } else {
            const choices = current.tasks.filter(task => task.id !== selected.id);
            if (!choices.length) {
              print('This is the only task; it has no dependencies.');
              continue;
            }
            choices.forEach((task, taskIndex) => print(`${taskIndex + 1}. ${task.id}: ${task.task}`));
            print(`Current dependencies: ${selected.dependsOn.join(', ') || 'none'}`);
            const answer = await read('Dependency numbers, separated by commas; none clears; Enter keeps current: ');
            if (!answer || cancellation(answer)) continue;
            if (answer.toLowerCase() === 'none') selected.dependsOn = [];
            else {
              const numbers = answer.split(',').map(value => value.trim());
              if (numbers.some(value => !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > choices.length)) {
                throw new Error('Choose dependency numbers from the displayed list, or none.');
              }
              selected.dependsOn = [...new Set(numbers.map(value => choices[Number(value) - 1].id))];
            }
          }
          current = revise(current, { tasks });
        } else {
          print('Choose a numbered field from 1 to 6.');
          continue;
        }
        print('Plan updated locally. No coding agents have started.');
      } catch (error) {
        if (error?.code === 'chat_cancelled' || error?.name === 'AbortError') throw error;
        print(`Edit not applied: ${error.message}`);
      }
    }
  }
}
