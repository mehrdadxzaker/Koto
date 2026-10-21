"""Native command observations do not establish verification execution or quality."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz.local_harness_progress import progress_snapshot


class NativeVerificationIntentTests(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        self.declarations = self.fixture['declarations']

    def command(self, call_id, command, *, result='exec_success'):
        return [{'type': 'function_call', 'name': 'exec_command', 'call_id': call_id,
                 'arguments': json.dumps({'cmd': command})},
                {'type': 'function_call_output', 'call_id': call_id,
                 'output': self.fixture['cases'][result]['result']['output']}]

    def patch(self, call_id='saved-patch'):
        pair = deepcopy([self.fixture['cases']['patch_success']['call'],
                         self.fixture['cases']['patch_success']['result']])
        for item in pair:
            item['call_id'] = call_id
        return pair

    def test_latest_success_observes_assertion_intent_only_when_requested(self):
        for command, expected in [("python3 -c 'assert True'", True), ("python3 -c 'print(1)'", False)]:
            with self.subTest(command=command):
                items = self.command('completed', command)
                original = deepcopy(items)
                baseline = {'native_patches_saved': 0, 'native_patches_rejected': 0,
                    'completed_commands_since_last_native_patch': 1, 'last_command_exit': 0,
                    'pending_sessions': 0, 'shell_parse_failure': False, 'python_syntax_failure': False,
                    'repeated_command_completions': 1}
                attempts = {**baseline, 'last_attempt_command_succeeded': True,
                    'last_attempt_patch_saved': False, 'tool_history_seen': True, 'unresolved_tool_calls': 0}
                self.assertEqual(progress_snapshot(items, self.declarations), baseline)
                self.assertEqual(progress_snapshot(items, self.declarations, include_attempts=True), attempts)
                self.assertEqual(progress_snapshot(items, self.declarations, include_verification=True),
                    {**baseline, 'latest_command_verification_intent': expected})
                self.assertEqual(progress_snapshot(items, self.declarations,
                    include_attempts=True, include_verification=True),
                    {**attempts, 'latest_command_verification_intent': expected})
                self.assertEqual(items, original)

    def test_later_uncertain_failed_or_unbound_work_cannot_inherit_assertion_intent(self):
        first = self.command('earlier-success', "python3 -c 'assert True'")
        failed = self.command('failed', "python3 -c 'assert False'", result='exec_failure')
        malformed = self.command('malformed', "python3 -c 'assert True'")
        malformed[-1]['output'] = 'No recognized native completion metadata.'
        pending = self.command('pending', "python3 -c 'assert True'")
        pending[-1]['output'] = pending[-1]['output'].replace(
            'Process exited with code 0', 'Process running with session ID 12345')
        unbound = self.command('unbound', "python3 -c 'assert True'")[-1:]
        unfinished = self.command('unfinished', "python3 -c 'assert True'")[:1]
        rejected = [self.fixture['cases']['patch_failure']['call'], self.fixture['cases']['patch_failure']['result']]
        for later in (failed, malformed, pending, unbound, unfinished, rejected,
                      [{'type': 'future_tool_output', 'call_id': 'future'}],
                      [{'type': 'function_call_output', 'call_id': [], 'output': 'unknown'}]):
            with self.subTest(kind=later[-1].get('type'), call_id=later[-1].get('call_id')):
                self.assertFalse(progress_snapshot(first + later, self.declarations,
                    include_verification=True)['latest_command_verification_intent'])
        message = {'type': 'message', 'role': 'developer', 'content': 'Inspect actual host feedback.'}
        self.assertTrue(progress_snapshot(first + [message], self.declarations,
            include_verification=True)['latest_command_verification_intent'])

    def test_pending_completion_uses_its_originating_command_and_patch_generation(self):
        def pending(command):
            pair = self.command('start', command)
            pair[-1]['output'] = pair[-1]['output'].replace(
                'Process exited with code 0', 'Process running with session ID 12345')
            return pair

        poll = [{'type': 'function_call', 'name': 'write_stdin', 'call_id': 'poll',
                 'arguments': json.dumps({'session_id': 12345})},
                {'type': 'function_call_output', 'call_id': 'poll',
                 'output': self.fixture['cases']['exec_success']['result']['output']}]
        asserting = pending("python3 -c 'assert True'")
        printing = pending("python3 -c 'print(1)'")
        failed_poll = deepcopy(poll)
        failed_poll[-1]['output'] = self.fixture['cases']['exec_failure']['result']['output']
        patch = self.patch()
        cases = [
            ('pending', asserting, False),
            ('assert-origin', asserting + poll, True),
            ('print-origin', printing + poll, False),
            ('patch-before-command', patch + asserting + poll, True),
            ('patch-after-pending-start', asserting + patch + poll, False),
            ('patch-before-running-result', asserting[:1] + patch + asserting[1:] + poll, False),
            ('failed-poll', asserting + failed_poll, False),
            ('unbound-poll', asserting + poll[1:], False),
        ]
        for name, items, expected in cases:
            with self.subTest(name=name):
                observed = progress_snapshot(items, self.declarations, include_verification=True)
                self.assertIs(observed.pop('latest_command_verification_intent'), expected)
                self.assertEqual(observed, progress_snapshot(items, self.declarations))


if __name__ == '__main__':
    unittest.main()
