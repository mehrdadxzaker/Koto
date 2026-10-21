"""Run named check drivers in the existing bounded, read-only execution fixture."""
import hashlib
from pathlib import Path
import sys
import unittest

from hormuz.local_python_named_checks import compile_named_feedback_checks
from tests import test_local_python_checks_feedback_workflow as feedback


@unittest.skipUnless(sys.platform == 'darwin' and Path('/usr/bin/sandbox-exec').is_file(),
                     'Requires the read-only macOS execution sandbox')
class LocalPythonNamedChecksWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.driver = feedback.LocalPythonChecksFeedbackWorkflowTests()
        self.driver.setUp()
        self.addCleanup(self.driver.doCleanups)

    def spec(self, cases):
        return {'module_path': 'offsets.py', 'function': 'apply_offsets', 'cases': cases}

    def run_driver(self, spec, source, command=None):
        if command is None:
            command = compile_named_feedback_checks(spec)
        return self.driver.run_driver(spec, source, command=command)

    def test_identical_named_atomic_command_rejects_both_defects_and_accepts_staging(self):
        spec = self.spec([
            {'arguments': {'state': [5], 'offsets': [2]}, 'expected': [3], 'same_as': 'state'},
            {'arguments': {'offsets': [6], 'state': [5]}, 'raises': 'ValueError',
             'unchanged': ['state']},
        ])
        spec['atomic_batch'] = {'argument': 'offsets', 'unchanged': ['state']}
        partial = ('def apply_offsets(state, offsets):\n'
            '    for value in offsets:\n'
            '        if value < 0 or value > state[0]:\n'
            '            raise ValueError("rejected")\n'
            '        state[0] -= value\n'
            '    return state\n')
        individual = ('def apply_offsets(state, offsets):\n'
            '    for value in offsets:\n'
            '        if value < 0 or value > state[0]:\n'
            '            raise ValueError("rejected")\n'
            '    state[0] -= sum(offsets)\n'
            '    return state\n')
        staged = ('def apply_offsets(state, offsets):\n'
            '    proposed = state[0]\n'
            '    for value in offsets:\n'
            '        if value < 0 or value > proposed:\n'
            '            raise ValueError("rejected")\n'
            '        proposed -= value\n'
            '    state[0] = proposed\n'
            '    return state\n')
        command = compile_named_feedback_checks(spec)
        for name, source, reason in (
                ('partial mutation', partial, 'atomic batch changed state on error'),
                ('individual prevalidation', individual,
                 'atomic batch accepted after sequential late rejection')):
            with self.subTest(defect=name):
                result = self.run_driver(spec, source, command)
                self.assertNotEqual(result['exit'], 0, result)
                self.assertIn(reason, result['stderr'])
                self.assertNotIn('KOTO_PYTHON_CHECKS_PASSED', result['stdout'])
        result = self.run_driver(spec, staged, command)
        self.assertEqual(result['exit'], 0, result)
        self.assertIn('cases=2 probes=3', result['stdout'])
        self.assertIn('source_sha256=' + hashlib.sha256(staged.encode()).hexdigest(), result['stdout'])

    def test_argument_key_order_keeps_named_values_and_the_requested_identity(self):
        spec = self.spec([
            {'arguments': {'state': [5], 'offsets': [2]}, 'expected': [3], 'same_as': 'state'},
            {'arguments': {'offsets': [1], 'state': [5]}, 'expected': [4], 'same_as': 'state'},
        ])
        body = ('def apply_offsets(state, offsets):\n'
                '    state[0] -= sum(offsets)\n')
        command = compile_named_feedback_checks(spec)
        copied = self.run_driver(spec, body + '    return list(state)\n', command)
        self.assertNotEqual(copied['exit'], 0, copied)
        self.assertIn('identity mismatch', copied['stderr'])
        self.assertNotIn('KOTO_PYTHON_CHECKS_PASSED', copied['stdout'])
        identical = self.run_driver(spec, body + '    return state\n', command)
        self.assertEqual(identical['exit'], 0, identical)
        self.assertIn('cases=2 probes=0', identical['stdout'])

    def test_missing_or_misspelled_parameter_is_rejected_before_any_target_call(self):
        source = ('def apply_offsets(state, offsets):\n'
                  '    raise RuntimeError("target_called_before_case_binding")\n')
        for name, arguments in (
                ('missing', {'state': [5]}),
                ('misspelled', {'state': [5], 'offests': [2]})):
            with self.subTest(arguments=name):
                spec = self.spec([
                    {'arguments': arguments, 'expected': [3]},
                    {'arguments': arguments, 'raises': 'RuntimeError', 'unchanged': ['state']},
                ])
                result = self.run_driver(spec, source)
                self.assertEqual(result['exit'], 2, result)
                self.assertIn('KOTO_CHECK_INPUT_ERROR case_argument_binding', result['stderr'])
                self.assertNotIn('target_called_before_case_binding', result['stderr'])
                self.assertNotIn('KOTO_PYTHON_CHECKS_PASSED', result['stdout'])

    def test_omitted_defaults_and_keyword_only_parameter_keep_the_actual_signature(self):
        spec = self.spec([
            {'arguments': {'state': [7]}, 'expected': [1], 'same_as': 'state'},
            {'arguments': {'state': [9]}, 'expected': [3], 'same_as': 'state'},
        ])
        source = ('def apply_offsets(*, state, offsets=(2,), scale=3):\n'
                  '    state[0] -= sum(offsets) * scale\n'
                  '    return state\n')
        result = self.run_driver(spec, source)
        self.assertEqual(result['exit'], 0, result)
        self.assertIn('cases=2 probes=0', result['stdout'])

    def test_positional_only_parameter_is_rejected_before_target_execution(self):
        spec = self.spec([{'arguments': {'state': [5], 'offsets': [2]}, 'raises': 'TypeError',
                           'unchanged': ['state']}])
        source = ('def apply_offsets(state, /, offsets):\n'
                  '    raise RuntimeError("positional_only_target_called")\n')
        result = self.run_driver(spec, source)
        self.assertEqual(result['exit'], 2, result)
        self.assertIn('KOTO_CHECK_INPUT_ERROR case_argument_binding', result['stderr'])
        self.assertNotIn('positional_only_target_called', result['stderr'])
        self.assertNotIn('KOTO_PYTHON_CHECKS_PASSED', result['stdout'])

    def test_correctly_bound_target_typeerror_remains_a_real_expected_exception(self):
        spec = self.spec([{'arguments': {'offsets': [2], 'state': [5]}, 'raises': 'TypeError',
                           'unchanged': ['state', 'offsets']}])
        source = ('def apply_offsets(*, state, offsets):\n'
                  '    raise TypeError("expected_target_error")\n')
        result = self.run_driver(spec, source)
        self.assertEqual(result['exit'], 0, result)
        self.assertIn('KOTO_PYTHON_CHECKS_PASSED', result['stdout'])
        self.assertIn('cases=1 probes=0', result['stdout'])
        self.assertNotIn('KOTO_CHECK_INPUT_ERROR', result['stderr'])


if __name__ == '__main__':
    unittest.main()
