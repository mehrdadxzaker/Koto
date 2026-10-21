"""V10 retains the requested effort allocation independently of native progress."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz.codex_llama import CodexLlamaRequest
from tests.test_local_harness_v5_transport_fast import synthetic_requests


class LocalHarnessV10EffortTests(unittest.TestCase):
    def states(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        requests = synthetic_requests()
        saved = requests['saved_patch_without_later_command']

        def command(script, *, result='exec_success', pending=False):
            output = fixture['cases'][result]['result']['output']
            if pending:
                output = output.replace('Process exited with code 0', 'Process running with session ID 17')
            return [
                {'type': 'function_call', 'name': 'exec_command', 'call_id': 'latest-command',
                 'arguments': json.dumps({'cmd': script})},
                {'type': 'function_call_output', 'call_id': 'latest-command', 'output': output}]

        histories = {
            'initial': requests['no_tool_history']['input'],
            'saved_patch': saved['input'],
            'verified': saved['input'] + command("python3 -c 'assert True'"),
            'print_only': saved['input'] + command("python3 -c 'print(1)'"),
            'failed': saved['input'] + command("python3 -c 'assert False'", result='exec_failure'),
            'pending': saved['input'] + command("python3 -c 'assert True'", pending=True),
            'unresolved': saved['input'] + command("python3 -c 'assert True'")[:1],
            'rejected_patch': requests['repeated_malformed_patch']['input'],
            'unbound_later': saved['input'] + command("python3 -c 'assert True'") + [
                {'type': 'function_call_output', 'call_id': 'unbound', 'output': 'unknown'}],
        }
        return {name: {**deepcopy(requests['no_tool_history']), 'input': deepcopy(history)}
                for name, history in histories.items()}

    def adapt(self, request, *, effort='low', output=2048, profile='qwen-code.v10'):
        request = deepcopy(request)
        request.update(reasoning={'effort': effort}, max_output_tokens=output)
        original = deepcopy(request)
        value = CodexLlamaRequest(request, harness=profile).value
        self.assertEqual(request, original)
        self.assertEqual(value['tool_choice'], original['tool_choice'])
        self.assertEqual(value['max_output_tokens'], output)
        self.assertEqual(value['reasoning'], original['reasoning'])
        return value

    def test_v10_effort_allocations_remain_constant_across_native_states(self):
        allocations = {'none': 0, 'minimal': 128, 'low': 256, 'medium': 512,
                       'high': 1024, 'xhigh': 1024, 'max': 1024}
        for state, request in self.states().items():
            for effort, expected in allocations.items():
                with self.subTest(state=state, effort=effort):
                    value = self.adapt(request, effort=effort)
                    self.assertEqual(value['reasoning_budget_tokens'], expected)
                    self.assertEqual(value['chat_template_kwargs']['enable_thinking'], effort != 'none')

    def test_output_limits_still_bound_effort_without_phase_specific_cuts(self):
        bounds = [(1, 1), (32, 16), (64, 32), (128, 64)]
        states = self.states()
        for state in ('initial', 'saved_patch', 'verified', 'pending', 'failed'):
            for output, expected in bounds:
                for effort in ('minimal', 'low', 'medium', 'high'):
                    with self.subTest(state=state, output=output, effort=effort):
                        value = self.adapt(states[state], effort=effort, output=output)
                        self.assertEqual(value['reasoning_budget_tokens'], expected)
                value = self.adapt(states[state], effort='none', output=output)
                self.assertEqual(value['reasoning_budget_tokens'], 0)
        for state in ('initial', 'verified'):
            value = self.adapt(states[state], effort='high', output=1024)
            self.assertEqual(value['reasoning_budget_tokens'], 512)

    def test_v8_and_v9_phase_behavior_is_unchanged(self):
        expected = {
            'initial': (32, 32), 'saved_patch': (64, 64), 'verified': (16, 16),
            'print_only': (16, 256), 'failed': (256, 256), 'pending': (256, 256),
            'unresolved': (256, 256), 'rejected_patch': (256, 256), 'unbound_later': (256, 256)}
        for state, request in self.states().items():
            for profile, budget in zip(('qwen-code.v8', 'qwen-code.v9'), expected[state]):
                with self.subTest(state=state, profile=profile):
                    self.assertEqual(self.adapt(request, profile=profile)['reasoning_budget_tokens'], budget)

    def test_checkpoint_feedback_native_history_and_catalog_still_survive(self):
        states = self.states()
        markers = {
            'saved_patch': 'Native patches saved: 1',
            'verified': 'Recognized assertion intent in the latest successful command: observed.',
            'print_only': 'Recognized assertion intent in the latest successful command: not observed.',
            'pending': 'pending sessions: 1', 'failed': 'latest command exit: 1'}
        baseline_tools = self.adapt(states['initial'])['tools']
        for state, marker in markers.items():
            with self.subTest(state=state):
                request = states[state]
                value = self.adapt(request)
                self.assertEqual(value['tools'], baseline_tools)
                native = CodexLlamaRequest(request).value['input']
                self.assertEqual(len(value['input']) - 1, len(native))
                for actual, original in zip(value['input'][:-1], native):
                    if original.get('type') == 'function_call':
                        # Existing profile canonicalization may reorder JSON
                        # fields, but cannot change any native argument value.
                        self.assertEqual(json.loads(actual['arguments']), json.loads(original['arguments']))
                        self.assertEqual({key: item for key, item in actual.items() if key != 'arguments'},
                                         {key: item for key, item in original.items() if key != 'arguments'})
                    else:
                        self.assertEqual(actual, original)
                self.assertIn(marker, value['input'][-1]['content'][0]['text'])
        string = deepcopy(states['initial'])
        string['input'] = 'Original request.'
        self.assertEqual(self.adapt(string)['reasoning_budget_tokens'], 256)


if __name__ == '__main__':
    unittest.main()
