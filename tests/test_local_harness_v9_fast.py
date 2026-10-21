"""Verification observations guide v9 without changing native authority."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz.codex_llama import CodexLlamaRequest
from tests.test_local_harness_v5_transport_fast import synthetic_requests


class LocalHarnessV9Tests(unittest.TestCase):
    def completed_command(self, command, *, failure=False):
        request = synthetic_requests()['saved_patch_without_later_command']
        request.update(reasoning={'effort': 'low'}, max_output_tokens=2048)
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        output = fixture['cases']['exec_failure' if failure else 'exec_success']['result']['output']
        request['input'] += [
            {'type': 'function_call', 'name': 'exec_command', 'call_id': 'check',
             'arguments': json.dumps({'cmd': command})},
            {'type': 'function_call_output', 'call_id': 'check', 'output': output}]
        return request

    def test_explicit_profile_preserves_the_native_python_script_transport(self):
        request = synthetic_requests()['no_tool_history']
        request.update(reasoning={'effort': 'low'}, max_output_tokens=2048)
        original = deepcopy(request)
        adapted = CodexLlamaRequest(request, harness='qwen-code.v9').value
        previous = CodexLlamaRequest(request, harness='qwen-code.v8').value
        self.assertEqual(adapted['tools'], previous['tools'])
        self.assertEqual(adapted['reasoning_budget_tokens'], 32)
        self.assertEqual(request, original)

    def test_printing_a_normal_example_keeps_the_solving_allowance(self):
        request = self.completed_command('python3 -c "import solution; stock = {\'apple\': 10, \'banana\': 5}; '
            'requests = [(\'apple\', 3), (\'banana\', 2)]; solution.consume_stock(stock, requests); print(stock)"')
        original = deepcopy(request)
        self.assertEqual(CodexLlamaRequest(request, harness='qwen-code.v9').value['reasoning_budget_tokens'], 256)
        self.assertEqual(CodexLlamaRequest(request, harness='qwen-code.v8').value['reasoning_budget_tokens'], 16)
        self.assertEqual(request, original)

    def test_failed_authored_exception_check_can_add_an_unspecified_requirement(self):
        request = self.completed_command("python3 -c 'import solution; assert True'", failure=True)
        request['input'][-1]['output'] += (
            '\nKeyError: "Key c not found"\nDuring handling of the above exception, another exception occurred:\n'
            'AssertionError\n')
        adapted = CodexLlamaRequest(request, harness='qwen-code.v9').value
        message = adapted['input'][-1]['content'][0]['text']
        self.assertIn('not required by the original specification', message)
        self.assertIn('KeyError', message)
        self.assertIn('assertRaises', message)
        self.assertNotIn('Changing quoting', message)
        previous = CodexLlamaRequest(request, harness='qwen-code.v8').value
        self.assertIn('Changing quoting', previous['input'][-1]['content'][0]['text'])
        self.assertEqual(adapted['reasoning_budget_tokens'], 256)

    def test_successful_printout_prompts_actual_verification(self):
        request = self.completed_command("python3 -c 'print(42)'")
        adapted = CodexLlamaRequest(request, harness='qwen-code.v9').value
        message = adapted['input'][-1]['content'][0]['text']
        self.assertIn('Recognized assertion intent in the latest successful command: not observed.', message)
        self.assertIn('Run compact assertions', message)
        self.assertNotIn('Recognized assertion intent',
            CodexLlamaRequest(request, harness='qwen-code.v8').value['input'][-1]['content'][0]['text'])


if __name__ == '__main__':
    unittest.main()
