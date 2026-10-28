/** This registry describes existing host actions; it never executes a model suggestion. */
export const TUI_COMMANDS = [
  ['help', '', 'Commands and keyboard shortcuts'],
  ['inspect', '[QUESTION]', 'Read the selected project and cite actual source evidence'],
  ['ask', 'QUESTION', 'Discuss without automatically inspecting or changing the project'],
  ['mode', '[auto|ask|inspect|plan|build]', 'Choose how ordinary messages are handled'],
  ['plan', 'GOAL', 'Prepare and edit a read-only proposal without launching workers'],
  ['build', 'GOAL', 'Prepare a plan, review it, then explicitly launch agents'],
  ['project', '[PATH]', 'Select an existing project folder'],
  ['new', 'PATH', 'Create an empty Git project after confirmation'],
  ['installed', '[refresh]', 'Browse actual agents, models, skills and connections'],
  ['skills', '[NAME]', 'Browse discovered skills; explicitly attach one to a prompt'],
  ['context', '[clear|remove PATH]', 'Preview or remove attached files and skills'],
  ['agent', '[KIND] [EXECUTABLE]', 'Choose a coordinator using an installed client'],
  ['model', '[MODEL]', 'Choose an available model or enter a native model identifier'],
  ['agents', '', 'Browse configured agent identities and readiness'],
  ['accounts', '', 'Discover native subscription logins or sign in'],
  ['add', 'KIND [MODEL] [EXECUTABLE]', 'Configure an agent using an actual installation'],
  ['remove', 'AGENT', 'Remove one configured worker'],
  ['models', '[add|use|pull|start|get]', 'Inspect or explicitly set up local models'],
  ['sessions', '[NUMBER]', 'Search saved work and preview its project and state'],
  ['review', '[AGENT]', 'Browse a retained contribution and its diff'],
  ['diff', '[AGENT]', 'Open the contribution diff viewer'],
  ['integrate', '[AGENT]', 'Review and explicitly approve a contribution'],
  ['resume', '[AGENT]', 'Continue retained work in its original workspace'],
  ['tasks', '', 'Browse the selected build task tree and dependencies'],
  ['activity', '', 'Browse observed agent activity and elapsed time'],
  ['tools', '', 'Search and expand actual tool activity and output'],
  ['queue', '', 'Edit, send or remove queued follow-up messages'],
  ['history', '', 'Search this project’s prompt history'],
  ['search', '[TEXT]', 'Search this process’s bounded transcript'],
  ['status', '', 'Show the selected project, mode, coordinator and context'],
  ['retry', '', 'Explicitly retry the last failed conversation request'],
  ['accessibility', '[plain|standard|motion|still]', 'Choose plain output or reduced animation'],
  ['runtime', 'build COMMIT', 'Explicitly build a pinned llama.cpp runtime'],
  ['setup', '', 'Open advanced manual session setup'],
  ['stop', '', 'Stop the active coordinator turn'],
  ['quit', '', 'Stop owned work and exit'],
].map(([name, args, description]) => Object.freeze({ name, command: `/${name}`, args, description }));

export const TUI_HELP = `Talk naturally: project questions inspect files; coding requests prepare a plan.
Press / for commands, @ for project files and agents. Menus use arrows, Tab and Enter.
Ctrl+J or Alt+Enter adds a line; Ctrl+R searches history; Esc dismisses a menu.
While busy, Enter queues a follow-up; /queue lets you edit or remove it.
Ctrl+C stops owned work and exits. Native agent attachment uses Ctrl+] to return.

${TUI_COMMANDS.map(item => `  ${item.command} ${item.args}`.padEnd(45) + item.description).join('\n')}
`;
