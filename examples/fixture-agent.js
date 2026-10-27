// Deterministic protocol fixture, not a model or a provider adapter.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const assignment = JSON.parse(input);
const role = process.argv[2];
if (role === 'analyze') process.stdout.write('19');
else if (role === 'review') process.stdout.write('23');
else if (role === 'integrate') {
  const { analyze, review } = assignment.inputs;
  if (analyze !== '19' || review !== '23') throw new Error('missing_contributions');
  const answer = Number(analyze) + Number(review);
  if (answer !== 42) throw new Error('acceptance_failed');
  process.stdout.write(`Checked result: ${answer}; contributions: analyst=19, reviewer=23.`);
} else throw new Error('unknown_role');
