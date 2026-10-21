"""Handled assertion syntax cannot supply the local finishing hint by itself."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz.codex_llama import CodexLlamaRequest
from hormuz.local_python_script import compile_script
from tests.test_local_harness_v5_transport_fast import synthetic_requests


CAUGHT_ONLY = '''from sample import transform
try:
    result = transform(3)
    assert result == 4
    print("authored check passed")
except Exception as error:
    print("private-check-failure", error)
'''
UNHANDLED = 'from sample import transform\nassert transform(3) == 4\n'


class HandledPythonVerificationTests(unittest.TestCase):
    def continued(self, script, *, profile='qwen-code.v10', successful=True):
        request = synthetic_requests()['saved_patch_without_later_command']
        request.update(reasoning={'effort': 'low'}, max_output_tokens=2048)
        adapter = CodexLlamaRequest(request, harness=profile)
        helper = next(tool for tool in adapter.value['tools']
                      if tool.get('parameters', {}).get('required') == ['script'])
        call = {'type': 'function_call', 'id': 'authored-check-item', 'call_id': 'authored-check-call',
                'name': helper['name'], 'arguments': json.dumps({'script': script}), 'status': 'completed'}
        native = json.loads(adapter.feed(json.dumps({'status': 'completed', 'output': [call]}).encode(),
                                        event_stream=False, final=True))['output'][0]
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        output = fixture['cases']['exec_success' if successful else 'exec_failure']['result']['output']
        request['input'] += [native, {'type': 'function_call_output', 'call_id': native['call_id'], 'output': output}]
        original = deepcopy(request)
        resumed = CodexLlamaRequest(request, harness=profile).value
        self.assertEqual(request, original)
        self.assertEqual(json.loads(native['arguments']), {'cmd': compile_script(script)})
        self.assertEqual(resumed['input'][-2], request['input'][-1])
        self.assertEqual(resumed['tool_choice'], request['tool_choice'])
        self.assertEqual(resumed['tools'], adapter.value['tools'])
        return resumed, resumed['input'][-1]['content'][0]['text']

    def test_only_handled_assertions_with_native_exit_zero_do_not_supply_finishing_hint(self):
        for profile in ('qwen-code.v9', 'qwen-code.v10'):
            for script, observed in ((CAUGHT_ONLY, False), (UNHANDLED, True),
                                     (CAUGHT_ONLY + '\nassert 1 == 1\n', True)):
                with self.subTest(profile=profile, observed=observed, script=script):
                    resumed, checkpoint = self.continued(script, profile=profile)
                    self.assertEqual(resumed['reasoning_budget_tokens'], 16 if observed and profile == 'qwen-code.v9' else 256)
                    expected = 'observed.' if observed else 'not observed.'
                    self.assertIn('Recognized assertion intent in the latest successful command: ' + expected, checkpoint)
                    self.assertNotIn('private-check-failure', checkpoint)
        # V8 has no assertion-intent finishing gate. Do not rewrite its contract
        # or claim this future fix caused the closed historical v8 outcome.
        resumed, _ = self.continued(CAUGHT_ONLY, profile='qwen-code.v8')
        self.assertEqual(resumed['reasoning_budget_tokens'], 16)
        resumed, _ = self.continued(UNHANDLED, successful=False)
        self.assertEqual(resumed['reasoning_budget_tokens'], 256)

    def test_all_handler_forms_are_conservative_without_exception_name_resolution(self):
        variants = [
            ('', 'except:', 'print("failure")'),
            ('', 'except Exception:', 'print("failure")'),
            ('', 'except BaseException:', 'print("failure")'),
            ('', 'except AssertionError:', 'print("failure")'),
            ('', 'except (KeyError, AssertionError):', 'print("failure")'),
            ('Alias = Exception\n', 'except Alias:', 'print("failure")'),
            ('Exception = ValueError\n', 'except Exception:', 'print("failure")'),
            ('', 'except UnknownHandler:', 'print("failure")'),
            ('', 'except ValueError:', 'print("failure")'),
            ('', 'except Exception:', 'raise'),
            ('', 'except* Exception:', 'print("failure")'),
        ]
        assertions = ('assert 1 == 1', 'unittest.TestCase().assertEqual(1, 1)',
                      'check.assertEqual(1, 1)')
        for prefix, handler, body in variants:
            for assertion in assertions:
                with self.subTest(prefix=prefix, handler=handler, assertion=assertion):
                    script = ('import unittest\ncheck = unittest.TestCase()\n' + prefix +
                              'try:\n    ' + assertion + '\n' + handler + '\n    ' + body + '\n')
                    resumed, checkpoint = self.continued(script)
                    self.assertEqual(resumed['reasoning_budget_tokens'], 256)
                    self.assertIn('Recognized assertion intent in the latest successful command: not observed.', checkpoint)

    def test_required_exception_then_outside_state_assertions_remain_eligible(self):
        script = '''from sample import transform
state = [3]
before = state[:]
try:
    transform(state)
except ValueError:
    pass
else:
    raise AssertionError("expected exception was not raised")
assert state == before
'''
        resumed, checkpoint = self.continued(script)
        self.assertEqual(resumed['reasoning_budget_tokens'], 256)
        self.assertIn('Recognized assertion intent in the latest successful command: observed.', checkpoint)
        for script in (
            'try:\n    pass\nexcept ValueError:\n    assert 1 == 1\n',
            'try:\n    pass\nexcept ValueError:\n    pass\nelse:\n    assert 1 == 1\n',
            'try:\n    pass\nfinally:\n    assert 1 == 1\n',
            'def uninvoked_check():\n    assert 1 == 1\n',
        ):
            with self.subTest(script=script):
                resumed, _ = self.continued(script)
                self.assertEqual(resumed['reasoning_budget_tokens'], 256)
        # Handler/else/finally assertions inside a handled outer body stay
        # unknown; visiting those branches must not cross an outer barrier.
        nested = ('try:\n    try:\n        pass\n    except ValueError:\n        assert 1 == 1\n'
                  '    else:\n        assert 1 == 1\n    finally:\n        assert 1 == 1\n'
                  'except Exception:\n    print("failure")\n')
        resumed, _ = self.continued(nested)
        self.assertEqual(resumed['reasoning_budget_tokens'], 256)

    def test_valid_generated_named_driver_still_supplies_eligible_assertion_syntax(self):
        from hormuz.local_python_named_checks import compile_named_feedback_checks

        request = synthetic_requests()['saved_patch_without_later_command']
        request.update(reasoning={'effort': 'low'}, max_output_tokens=2048)
        command = compile_named_feedback_checks({'module_path': 'sample.py', 'function': 'transform',
            'cases': [{'arguments': {'value': 3}, 'expected': 4}]})
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        request['input'] += [
            {'type': 'function_call', 'name': 'exec_command', 'call_id': 'named-check',
             'arguments': json.dumps({'cmd': command})},
            {'type': 'function_call_output', 'call_id': 'named-check',
             'output': fixture['cases']['exec_success']['result']['output']}]
        original = deepcopy(request)
        resumed = CodexLlamaRequest(request, harness='qwen-code.v9').value
        self.assertEqual(resumed['reasoning_budget_tokens'], 16)
        self.assertEqual(request, original)


if __name__ == '__main__':
    unittest.main()
