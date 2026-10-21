"""Phase compute hints fail closed on unresolved or unsuccessful tool work."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz.codex_llama import CodexLlamaRequest
from hormuz.local_harness_progress import progress_snapshot
from tests.test_local_harness_v5_transport_fast import synthetic_requests


class LocalHarnessV8PhaseTests(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())

    def command(self, call_id, *, result='exec_success', name='exec_command', arguments=None):
        return [
            {'type': 'function_call', 'name': name, 'call_id': call_id,
             'arguments': json.dumps({'cmd': "python3 -c 'assert True'"} if arguments is None else arguments)},
            {'type': 'function_call_output', 'call_id': call_id,
             'output': self.fixture['cases'][result]['result']['output']}]

    def post_edit_success(self):
        request = synthetic_requests()['saved_patch_without_later_command']
        request.update(reasoning={'effort': 'low'}, max_output_tokens=2048)
        request['input'] += self.command('initial-check')
        return request

    def budget(self, request, *, profile='qwen-code.v8'):
        return CodexLlamaRequest(request, harness=profile).value['reasoning_budget_tokens']

    def test_low_effort_allocates_budget_to_solving_between_native_phases(self):
        for effort, solving in [('minimal', 128), ('low', 256)]:
            with self.subTest(effort=effort):
                initial = synthetic_requests()['no_tool_history']
                initial.update(reasoning={'effort': effort}, max_output_tokens=2048)
                original = deepcopy(initial)
                self.assertEqual(self.budget(initial), 32)
                self.assertEqual(initial, original)
                read = deepcopy(initial)
                read['input'] += self.command('read-source', arguments={'cmd': 'cat solution.py'})
                self.assertEqual(self.budget(read), solving)
                edited = synthetic_requests()['saved_patch_without_later_command']
                edited.update(reasoning={'effort': effort}, max_output_tokens=2048)
                self.assertEqual(self.budget(edited), 64)
                edited['input'] += self.command('post-edit-check')
                self.assertEqual(self.budget(edited), 16)

    def test_initial_or_saved_patch_hint_never_hides_uncertain_tool_work(self):
        for phase in ('initial', 'saved-patch'):
            for problem in ('unbound', 'unknown-kind', 'unresolved', 'malformed', 'rejected', 'pending'):
                with self.subTest(phase=phase, problem=problem):
                    request = synthetic_requests()['no_tool_history' if phase == 'initial'
                                                   else 'saved_patch_without_later_command']
                    request.update(reasoning={'effort': 'low'}, max_output_tokens=2048)
                    pair = self.command('uncertain')
                    if problem == 'unbound':
                        pair = pair[1:]
                    elif problem == 'unknown-kind':
                        pair = [{'type': 'future_tool_output', 'call_id': 'uncertain', 'output': 'unknown'}]
                    elif problem == 'unresolved':
                        pair = pair[:1]
                    elif problem == 'malformed':
                        pair[1]['output'] = 'Unrecognized host response; completion unavailable.'
                    elif problem == 'rejected':
                        pair = synthetic_requests()['repeated_malformed_patch']['input'][1:3]
                    else:
                        pair[1]['output'] = pair[1]['output'].replace(
                            'Process exited with code 0', 'Process running with session ID 12345')
                    request['input'] += pair
                    self.assertEqual(self.budget(request), 256)

    def test_other_efforts_string_inputs_and_old_profiles_keep_their_budgets(self):
        for effort, expected in [('none', 0), ('medium', 512), ('high', 1024),
                                 ('xhigh', 1024), ('max', 1024)]:
            for stage in ('no_tool_history', 'saved_patch_without_later_command'):
                with self.subTest(effort=effort, stage=stage):
                    request = synthetic_requests()[stage]
                    request.update(reasoning={'effort': effort}, max_output_tokens=2048)
                    self.assertEqual(self.budget(request), expected)
        for stage in ('no_tool_history', 'saved_patch_without_later_command'):
            request = synthetic_requests()[stage]
            request.update(reasoning={'effort': 'low'}, max_output_tokens=2048)
            for profile in ('qwen-code.v' + str(i) for i in range(1, 8)):
                with self.subTest(stage=stage, profile=profile):
                    self.assertEqual(self.budget(request, profile=profile), 1024)
        self.assertEqual(self.budget({'input': 'Repair the function.',
            'reasoning': {'effort': 'low'}, 'max_output_tokens': 2048}), 256)
        limited = synthetic_requests()['saved_patch_without_later_command']
        limited.update(reasoning={'effort': 'low'}, max_output_tokens=32)
        self.assertEqual(self.budget(limited), 16)

    def test_later_patch_rejection_restores_recovery_budget(self):
        request = self.post_edit_success()
        self.assertEqual(self.budget(request), 16)
        request['input'] += synthetic_requests()['repeated_malformed_patch']['input'][1:3]
        self.assertEqual(self.budget(request), 256)

    def test_any_unresolved_call_keeps_recovery_budget_after_other_commands_complete(self):
        request = self.post_edit_success()
        request['input'] += self.command('still-unresolved')[:1]
        self.assertEqual(self.budget(request), 256)
        request['input'] += self.command('other-completed')
        self.assertEqual(self.budget(request), 256)

    def test_malformed_or_unknown_latest_tool_result_does_not_inherit_success(self):
        for kind in ('malformed', 'unknown', 'unbound'):
            with self.subTest(kind=kind):
                request = self.post_edit_success()
                pair = self.command('latest')
                if kind == 'malformed':
                    pair[1]['output'] = 'Unrecognized host response; completion unavailable.'
                elif kind == 'unknown':
                    request['tools'].append({'type': 'function', 'name': 'other_tool',
                        'parameters': {'type': 'object'}})
                    pair[0]['name'] = 'other_tool'
                else:
                    pair = pair[1:]
                request['input'] += pair
                self.assertEqual(self.budget(request), 256)

    def test_successful_recovery_restores_hint_and_old_profiles_and_none_stay_exact(self):
        request = self.post_edit_success()
        request['input'] += self.command('failure', result='exec_failure')
        self.assertEqual(self.budget(request), 256)
        request['input'] += self.command('successful-recovery')
        self.assertEqual(self.budget(request), 16)
        for profile in ('qwen-code.v' + str(i) for i in range(1, 8)):
            with self.subTest(profile=profile):
                self.assertEqual(self.budget(request, profile=profile), 1024)
        request['reasoning']['effort'] = 'none'
        self.assertEqual(self.budget(request), 0)

    def test_running_session_blocks_hint_until_its_correlated_successful_exit(self):
        request = self.post_edit_success()
        pending = self.command('start-pending')
        pending[1]['output'] = pending[1]['output'].replace(
            'Process exited with code 0', 'Process running with session ID 12345')
        request['input'] += pending + self.command('another-success')
        self.assertEqual(self.budget(request), 256)
        request['input'] += self.command('poll', name='write_stdin', arguments={'session_id': 12345})
        self.assertEqual(self.budget(request), 16)

    def test_default_progress_dictionary_has_no_phase_metadata(self):
        request = self.post_edit_success()
        adapter = CodexLlamaRequest(request)
        observed = progress_snapshot(adapter.value['input'], adapter.declarations)
        self.assertEqual(set(observed), {'native_patches_saved', 'native_patches_rejected',
            'completed_commands_since_last_native_patch', 'last_command_exit', 'pending_sessions',
            'shell_parse_failure', 'python_syntax_failure', 'repeated_command_completions'})

    def test_unknown_shorthand_role_preserves_default_progress_and_full_effort(self):
        unknown = [{'role': []}]
        self.assertEqual(progress_snapshot(unknown, {}), progress_snapshot([], {}))
        request = synthetic_requests()['no_tool_history']
        request.update(reasoning={'effort': 'low'}, max_output_tokens=2048)
        request['input'] += unknown
        self.assertEqual(self.budget(request), 256)


if __name__ == '__main__':
    unittest.main()
