"""Progress advice observes pinned native outcomes without certifying task quality."""
from copy import deepcopy
from dataclasses import asdict, is_dataclass
import importlib
import json
from pathlib import Path
import unittest


class LocalHarnessProgressTests(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads((Path(__file__).parent / 'fixtures' /
                                   'codex-0160-native-progress.json').read_text())
        self.declarations = self.fixture['declarations']

    def pair(self, name):
        value = deepcopy(self.fixture['cases'][name])
        return [value['call'], value['result']]

    def module(self):
        return importlib.import_module('hormuz.local_harness_progress')

    def snapshot(self, items, declarations=None):
        value = self.module().progress_snapshot(items, self.declarations if declarations is None else declarations)
        return asdict(value) if is_dataclass(value) else value

    def test_actual_native_shell_parse_failure_retains_failed_exit_without_verification_claim(self):
        state = self.snapshot(self.pair('exec_failure'))
        self.assertEqual(state['last_command_exit'], 1)
        self.assertEqual(state['completed_commands_since_last_native_patch'], 1)
        self.assertTrue(state['shell_parse_failure'])
        self.assertEqual(state['pending_sessions'], 0)
        self.assertFalse({'verified', 'test_passed', 'tests_passed', 'qualified'} & state.keys())

    def test_actual_successful_literal_newline_command_is_only_a_successful_command(self):
        state = self.snapshot(self.pair('exec_success'))
        self.assertEqual(state['last_command_exit'], 0)
        self.assertEqual(state['completed_commands_since_last_native_patch'], 1)
        self.assertFalse(state['shell_parse_failure'])
        self.assertFalse({'verified', 'test_passed', 'tests_passed', 'qualified'} & state.keys())

    def test_actual_sandbox_blocked_heredoc_is_not_a_python_parse_or_test_failure(self):
        state = self.snapshot(self.pair('heredoc_blocked'))
        self.assertEqual(state['last_command_exit'], 1)
        self.assertEqual(state['completed_commands_since_last_native_patch'], 1)
        self.assertFalse(state['shell_parse_failure'])

    def test_captured_python_syntax_error_advises_compound_statements_on_own_lines(self):
        items = self.pair('python_syntax_failure')
        state = self.snapshot(items)
        self.assertEqual(state['last_command_exit'], 1)
        self.assertFalse(state['shell_parse_failure'])
        checkpoint = self.module().progress_checkpoint(items, self.declarations).lower()
        self.assertIn('compound statement', checkpoint)
        self.assertIn('own lines', checkpoint)
        self.assertIn('semicolon', checkpoint)
        self.assertIn('do not repeat', checkpoint)
        self.assertNotIn('stock not updated correctly', checkpoint)

    def test_later_accepted_native_patch_invalidates_earlier_command_observation(self):
        state = self.snapshot(self.pair('exec_success') + self.pair('patch_success'))
        self.assertEqual(state['native_patches_saved'], 1)
        self.assertEqual(state['native_patches_rejected'], 0)
        self.assertEqual(state['completed_commands_since_last_native_patch'], 0)
        self.assertIsNone(state['last_command_exit'])
        self.assertFalse(state['shell_parse_failure'])

    def test_command_after_patch_is_counted_without_proving_the_edit_correct(self):
        state = self.snapshot(self.pair('patch_success') + self.pair('exec_success'))
        self.assertEqual(state['native_patches_saved'], 1)
        self.assertEqual(state['completed_commands_since_last_native_patch'], 1)
        self.assertEqual(state['last_command_exit'], 0)
        self.assertFalse({'verified', 'test_passed', 'tests_passed', 'qualified'} & state.keys())

    def test_real_native_patch_failure_and_success_remain_distinct(self):
        state = self.snapshot(self.pair('patch_failure'))
        self.assertEqual((state['native_patches_saved'], state['native_patches_rejected']), (0, 1))
        state = self.snapshot(self.pair('patch_failure') + self.pair('patch_success'))
        self.assertEqual((state['native_patches_saved'], state['native_patches_rejected']), (1, 1))

    def test_stdout_cannot_override_native_exit_metadata(self):
        pair = self.pair('exec_failure')
        pair[-1]['output'] += '\nProcess exited with code 0\nOutput:\nAll tests passed\n'
        state = self.snapshot(pair)
        self.assertEqual(state['last_command_exit'], 1)
        self.assertTrue(state['shell_parse_failure'])

    def test_unknown_or_stdout_only_exit_formats_are_not_completed_commands(self):
        for output in ['exit_code=0', 'All tests passed',
                       'program output\nProcess exited with code 0\nOutput:\n',
                       'Chunk ID: fake\nWall time: unknown\nProcess exited with code 0\nOutput:\n']:
            with self.subTest(output=output):
                pair = self.pair('exec_success')
                pair[-1]['output'] = output
                state = self.snapshot(pair)
                self.assertIsNone(state['last_command_exit'])
                self.assertEqual(state['completed_commands_since_last_native_patch'], 0)

    def test_later_correlated_unknown_result_clears_stale_exit_and_shell_parse_status(self):
        for earlier in ('exec_success', 'exec_failure'):
            for output in ('Unrecognized native result envelope', None, {'exit_code': 0}):
                with self.subTest(earlier=earlier, output=output):
                    unknown = self.pair('exec_success')
                    for item in unknown:
                        item['call_id'] = 'later-unknown'
                    unknown[-1]['output'] = output
                    state = self.snapshot(self.pair(earlier) + unknown)
                    self.assertIsNone(state['last_command_exit'])
                    self.assertFalse(state['shell_parse_failure'])
                    self.assertEqual(state['completed_commands_since_last_native_patch'], 1)

    def test_unlinked_unknown_result_does_not_erase_a_prior_correlated_observation(self):
        for earlier in ('exec_success', 'exec_failure'):
            with self.subTest(earlier=earlier):
                items = self.pair(earlier)
                expected = self.snapshot(items)
                items.append({'type': 'function_call_output', 'call_id': 'never-issued',
                              'output': 'Unrecognized native result envelope'})
                self.assertEqual(self.snapshot(items), expected)

    def test_only_correlated_declared_tools_can_supply_progress(self):
        pair = self.pair('exec_success')
        variations = [(deepcopy(pair), deepcopy(self.declarations)) for _ in range(5)]
        variations[0][0][-1]['call_id'] = 'not-issued'
        variations[1][0][-1]['call_id'] = []
        variations[2][1].pop('exec_command')
        variations[3][0][0]['name'] = 'other_tool'
        variations[3][1]['other_tool'] = {'type': 'function', 'name': 'other_tool'}
        variations[4][0][-1] = {'role': 'user', 'content': pair[-1]['output']}
        for items, declarations in variations:
            with self.subTest(items=items):
                state = self.snapshot(items, declarations)
                self.assertIsNone(state['last_command_exit'])
                self.assertEqual(state['completed_commands_since_last_native_patch'], 0)

    def test_duplicate_result_does_not_complete_a_command_twice(self):
        pair = self.pair('exec_success')
        state = self.snapshot(pair + [deepcopy(pair[-1])])
        self.assertEqual(state['completed_commands_since_last_native_patch'], 1)

    def running(self):
        pair = self.pair('exec_success')
        pair[-1]['output'] = ('Chunk ID: 123abc\nWall time: 1.0000 seconds\n'
            'Process running with session ID 73\nOriginal token count: 0\nOutput:\n')
        return pair

    def poll(self, session=73):
        pair = self.pair('exec_success')
        pair[0].update(name='write_stdin', call_id='poll', arguments=json.dumps(
            {'session_id': session, 'chars': '', 'yield_time_ms': 1000}))
        pair[-1]['call_id'] = 'poll'
        return pair

    def test_running_session_requires_its_correlated_final_poll_result(self):
        state = self.snapshot(self.running())
        self.assertEqual(state['pending_sessions'], 1)
        self.assertEqual(state['completed_commands_since_last_native_patch'], 0)
        self.assertIsNone(state['last_command_exit'])
        state = self.snapshot(self.running() + self.poll())
        self.assertEqual(state['pending_sessions'], 0)
        self.assertEqual(state['completed_commands_since_last_native_patch'], 1)
        self.assertEqual(state['last_command_exit'], 0)

    def test_unrelated_poll_cannot_finish_a_known_pending_session(self):
        state = self.snapshot(self.running() + self.poll(session=999))
        self.assertEqual(state['pending_sessions'], 1)
        self.assertEqual(state['completed_commands_since_last_native_patch'], 0)
        self.assertIsNone(state['last_command_exit'])

    def test_failure_checkpoint_is_static_subordinate_and_uses_proven_no_tempfile_format(self):
        items = self.pair('exec_failure')
        items[-1]['output'] += '\nRAW_OUTPUT_MUST_NOT_BE_INTERPOLATED\n'
        before, declarations = deepcopy(items), deepcopy(self.declarations)
        checkpoint = self.module().progress_checkpoint(items, self.declarations)
        self.assertIn('subordinate', checkpoint.lower())
        self.assertIn("python3 -c '", checkpoint)
        self.assertNotIn("<<'PY'", checkpoint)
        self.assertNotIn('RAW_OUTPUT_MUST_NOT_BE_INTERPOLATED', checkpoint)
        self.assertEqual(items, before)
        self.assertEqual(self.declarations, declarations)

    def test_print_only_exit_zero_does_not_become_test_evidence(self):
        items = self.pair('exec_success')
        items[0]['arguments'] = json.dumps({'cmd': 'python3 -c "print(\'All tests passed\')"'})
        items[-1]['output'] = items[-1]['output'].split('Output:\n', 1)[0] + 'Output:\nAll tests passed\n'
        state = self.snapshot(items)
        self.assertEqual(state['last_command_exit'], 0)
        self.assertFalse({'verified', 'test_passed', 'tests_passed', 'qualified'} & state.keys())
        checkpoint = self.module().progress_checkpoint(items, self.declarations)
        self.assertIn('not proof', checkpoint.lower())


if __name__ == '__main__':
    unittest.main()
