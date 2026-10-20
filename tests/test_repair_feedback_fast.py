"""Only fake execution: mistaken expectations and bounded repair feedback."""
from copy import deepcopy
import unittest

from tests.repair_feedback_fixture import MemoryProject, check_result, repair


class RepairFeedbackFastTests(unittest.TestCase):
    def setUp(self):
        self.project = MemoryProject()
        self.tools = repair.RepairTools(self.project)

    def check(self, text='assert value == 1'):
        return self.tools.call('check_source', {'checks': text})

    def save(self, content='value = 1\n'):
        return self.tools.call('save_source', {'content': content, 'requirements': ['Return the required value']})

    def test_mistaken_expectation_can_be_corrected_without_rewriting_correct_source(self):
        self.project.check.side_effect = [check_result(1), check_result()]
        failure, error = self.check('assert value == 2')
        self.assertTrue(error)
        self.assertEqual(failure['state'], 'failed_your_tests')
        self.assertEqual(failure['result_origin'], 'model_written_tests')
        self.assertEqual(failure['stderr'], 'AssertionError: actual != expected')
        self.assertIn('Re-derive expected values from the specification', failure['next_action'])
        success, error = self.check('assert value == 1')
        self.assertFalse(error)
        self.assertEqual(success['state'], 'passed_your_tests')
        self.assertEqual(success['independent_checks'], 'unobserved')
        self.assertEqual(success['automatic_admission_effect'], 'none')
        self.assertEqual(self.project.saves, [])
        self.assertEqual(self.project.check.call_count, 2)

    def test_identical_failed_check_stops_without_another_execution(self):
        self.project.check.return_value = check_result(1)
        self.check()
        value, error = self.check()
        self.assertTrue(error)
        self.assertEqual(value['reason'], 'repeated_failed_check')
        self.assertTrue(value['must_stop'])
        self.assertFalse(value['checked'])
        self.assertEqual(value['cached_result']['check_exit_code'], 1)
        stopped, error = self.save('value = 2\n')
        self.assertTrue(error)
        self.assertTrue(stopped['must_stop'])
        self.assertEqual(self.project.saves, [])
        self.project.check.assert_called_once()

    def test_returning_to_a_previous_failed_pair_stops_oscillation(self):
        self.project.check.return_value = check_result(1)
        self.check()
        self.save('value = 2\n')
        self.check()
        self.save('value = 1\n')
        value, error = self.check()
        self.assertTrue(error)
        self.assertEqual(value['reason'], 'repeated_failed_check')
        self.assertEqual(self.project.check.call_count, 2)

    def test_changed_checks_cannot_extend_the_four_execution_budget(self):
        self.project.check.return_value = check_result(1)
        for number in range(4):
            value, error = self.check(f'assert value == {number}')
            self.assertTrue(error)
        self.assertEqual(value['reason'], 'check_budget_exhausted')
        self.assertEqual(value['remaining_check_runs'], 0)
        self.check('assert value == 99')
        self.assertEqual(self.project.check.call_count, 4)

    def test_final_allowed_check_can_succeed(self):
        self.project.check.side_effect = [check_result(1)] * 3 + [check_result()]
        for number in range(4):
            value, error = self.check(f'assert value == {number}')
        self.assertFalse(error)
        self.assertFalse(value['must_stop'])
        self.assertEqual(value['state'], 'passed_your_tests')
        self.assertEqual(value['remaining_check_runs'], 0)

    def test_unchanged_save_and_duplicate_passing_check_preserve_success(self):
        self.check()
        saved, error = self.save()
        self.assertFalse(error)
        self.assertFalse(saved['saved'])
        self.assertTrue(saved['current_source_passed_your_tests'])
        cached, error = self.check()
        self.assertFalse(error)
        self.assertTrue(cached['cached'])
        self.assertFalse(cached['checked'])
        read, _ = self.tools.call('read_source', {})
        self.assertTrue(read['current_source_passed_your_tests'])
        self.assertEqual(self.project.saves, [])
        self.project.check.assert_called_once()

    def test_changed_source_cannot_inherit_success(self):
        self.check()
        self.save('value = 2\n')
        read, _ = self.tools.call('read_source', {})
        self.assertFalse(read['current_source_passed_your_tests'])
        self.project.check.return_value = check_result(1)
        value, error = self.check()
        self.assertTrue(error)
        self.assertEqual(value['state'], 'failed_your_tests')

    def test_external_changes_and_syntax_errors_remain_repairable(self):
        self.check()
        for source in ['', 'def broken(:\n']:
            with self.subTest(source=source):
                self.project.source = source
                value, error = self.tools.call('read_source', {})
                self.assertFalse(error)
                self.assertFalse(value['current_source_passed_your_tests'])
                self.assertEqual(value['source'], source)
        self.save('value = 3\n')
        self.assertEqual(self.project.source, 'value = 3\n')

    def test_diagnostic_mutation_cannot_turn_a_cached_failure_into_success(self):
        self.project.check.return_value = check_result(1)
        value, _ = self.check()
        value['check_exit_code'] = 0
        self.project.check.return_value['check_exit_code'] = 0
        cached, error = self.check()
        self.assertTrue(error)
        self.assertEqual(cached['cached_result']['check_exit_code'], 1)

    def test_timeout_stops_even_when_exit_code_is_zero(self):
        self.project.check.return_value = check_result(0, timed_out=True)
        value, error = self.check()
        self.assertTrue(error)
        self.assertEqual(value['reason'], 'checker_timeout')
        self.check('assert True')
        self.project.check.assert_called_once()

    def test_invalid_checker_results_stop_instead_of_reporting_success(self):
        for invalid in [None, {}, check_result(True),
                        {**check_result(), 'timed_out': 0},
                        {**check_result(), 'stderr': 'x' * 32769}]:
            with self.subTest(invalid=type(invalid).__name__):
                self.tools = repair.RepairTools(self.project)
                self.project.check.return_value = deepcopy(invalid)
                value, error = self.check()
                self.assertTrue(error)
                self.assertEqual(value['reason'], 'invalid_checker_result')

    def test_checker_or_source_integrity_failure_stops_the_session(self):
        self.project.check.side_effect = OSError('mock checker unavailable')
        value, error = self.check()
        self.assertTrue(error)
        self.assertEqual(value['reason'], 'checker_unavailable')
        self.assertEqual(value['remaining_check_runs'], 3)
        self.tools = repair.RepairTools(self.project)

        def changed(_):
            self.project.source = 'value = 99\n'
            return check_result()

        self.project.check.side_effect = changed
        value, error = self.check()
        self.assertTrue(error)
        self.assertEqual(value['reason'], 'source_changed_during_checks')

    def test_invalid_arguments_and_syntax_never_execute_checks_or_save(self):
        for tool, arguments in [('check_source', []), ('check_source', {'checks': ''}),
                                ('check_source', {'checks': 'def broken(:'}),
                                ('save_source', {'content': 'x=1', 'requirements': []}),
                                ('save_source', {'content': 'x=1', 'requirements': ['x' * 513]}),
                                ('read_source', {'extra': True})]:
            with self.subTest(tool=tool, arguments=arguments):
                with self.assertRaises((ValueError, SyntaxError)):
                    self.tools.call(tool, arguments)
        self.assertEqual(self.project.saves, [])
        self.project.check.assert_not_called()

    def test_repeated_reads_have_a_finite_call_budget(self):
        for _ in range(16):
            _, error = self.tools.call('read_source', {})
            self.assertFalse(error)
        value, error = self.tools.call('read_source', {})
        self.assertTrue(error)
        self.assertEqual(value['reason'], 'tool_call_budget_exhausted')
        self.project.check.assert_not_called()


if __name__ == '__main__':
    unittest.main()
