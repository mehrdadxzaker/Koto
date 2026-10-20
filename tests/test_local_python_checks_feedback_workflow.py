"""Run v7 generic check drivers serially in a read-only, network-denied sandbox."""
import hashlib
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import tempfile
import unittest

from hormuz.local_python_checks import compile_checks, compile_feedback_checks


@unittest.skipUnless(sys.platform == 'darwin' and Path('/usr/bin/sandbox-exec').is_file(),
                     'Requires the read-only macOS execution sandbox')
class LocalPythonChecksFeedbackWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='koto-check-feedback-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.project = self.root / 'owned-cwd'; self.project.mkdir()
        self.target = self.project / 'offsets.py'

    def spec(self, cases):
        return {'module_path': 'offsets.py', 'function': 'apply_offsets', 'cases': cases}

    def run_driver(self, spec, source, command=None):
        self.target.write_text(source)
        words = shlex.split(compile_feedback_checks(spec) if command is None else command)
        self.assertEqual(words[:2], ['python3', '-c']); self.assertEqual(len(words), 3)
        bootstrap = ('import resource,sys\n'
            'resource.setrlimit(resource.RLIMIT_CPU,(2,2))\n'
            'resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536))\n'
            'resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))\n'
            'exec(compile(sys.argv[1],"<generated-check-driver>","exec"))\n')
        environment = {'HOME': str(self.root), 'PATH': '/usr/bin:/bin',
            'LANG': 'en_US.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'}
        with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
            process = subprocess.Popen(['/usr/bin/sandbox-exec', '-p',
                '(version 1)(allow default)(deny network*)(deny file-write*)',
                sys.executable, '-I', '-B', '-c', bootstrap, words[2]],
                cwd=self.project, env=environment, stdin=subprocess.DEVNULL,
                stdout=stdout, stderr=stderr, start_new_session=True)
            try:
                process.wait(timeout=4)
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try: process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=1)
            stdout.seek(0); stderr.seek(0)
            result = {'exit': process.returncode,
                'stdout': stdout.read(8192).decode('utf-8', 'replace'),
                'stderr': stderr.read(8192).decode('utf-8', 'replace')}
        self.assertNotIn('sandbox_apply', result['stderr'], result)
        self.assertEqual(self.target.read_text(), source)
        self.assertFalse((self.project / '__pycache__').exists())
        return result

    def test_captured_semantic_error_is_real_exit_two_without_target_import_or_data(self):
        spec = self.spec([{'args': [[5], [2]], 'expected': [3], 'raises': 'ValueError'}])
        source = 'raise RuntimeError("target_must_not_be_imported")\n'
        result = self.run_driver(spec, source)
        self.assertEqual(result['exit'], 2, result)
        self.assertIn('KOTO_CHECK_INPUT_ERROR expected_xor_raises_required', result['stderr'])
        self.assertIn('exactly one of expected or raises', result['stderr'])
        self.assertNotIn('target_must_not_be_imported', result['stderr'])
        self.assertEqual(result['stdout'], '')

    def test_all_bindings_precede_first_call_and_do_not_repair_function_signature(self):
        spec = self.spec([{'args': [[5], [2]], 'expected': [3]},
                          {'args': [{'state': [5], 'offsets': [2]}], 'raises': 'ValueError'}])
        source = ('def apply_offsets(state, offsets):\n'
                  '    raise RuntimeError("target_called_before_all_case_bindings")\n')
        old = self.run_driver(spec, source, compile_checks(spec))
        self.assertIn('target_called_before_all_case_bindings', old['stderr'])
        result = self.run_driver(spec, source)
        self.assertEqual(result['exit'], 2, result)
        self.assertIn('KOTO_CHECK_INPUT_ERROR case_argument_binding', result['stderr'])
        self.assertIn('keep the task function signature', result['stderr'])
        self.assertNotIn('target_called_before_all_case_bindings', result['stderr'])
        self.assertNotIn('KOTO_PYTHON_CHECKS_PASSED', result['stdout'])

    def test_nested_single_list_and_named_arguments_are_called_exactly_as_supplied(self):
        single = self.run_driver(self.spec([{'args': [[1, 2]], 'expected': [2, 1]}]),
            'def apply_offsets(values):\n    return list(reversed(values))\n')
        self.assertEqual(single['exit'], 0, single)
        named = self.run_driver(self.spec([{'args': [], 'kwargs': {'state': 2, 'offsets': 3}, 'expected': 5}]),
            'def apply_offsets(state, offsets):\n    return state + offsets\n')
        self.assertEqual(named['exit'], 0, named)
        self.assertIn('cases=1 probes=0', named['stdout'])

    def test_expected_typeerror_inside_correctly_bound_target_is_still_checked(self):
        result = self.run_driver(self.spec([{'args': [[1]], 'raises': 'TypeError', 'unchanged_args': [0]}]),
            'def apply_offsets(values):\n    raise TypeError("expected_target_error")\n')
        self.assertEqual(result['exit'], 0, result)
        self.assertIn('KOTO_PYTHON_CHECKS_PASSED', result['stdout'])

    def test_wrong_expectation_fails_and_asks_recheck_before_code_changes(self):
        result = self.run_driver(self.spec([{'args': [2, 3], 'expected': 8}]),
            'def apply_offsets(left, right):\n    return left + right\n')
        self.assertNotEqual(result['exit'], 0, result)
        self.assertIn('recheck the expected value against the original task specification before editing code', result['stderr'])
        self.assertNotIn('KOTO_PYTHON_CHECKS_PASSED', result['stdout'])

    def test_tuple_results_keep_explicit_exact_equality(self):
        source = 'def apply_offsets():\n    return [(1, 2)]\n'
        spec = self.spec([{'args': [], 'expected': [[1, 2]]}])
        wrong = self.run_driver(spec, source)
        self.assertNotEqual(wrong['exit'], 0, wrong)
        spec['cases'][0]['expected_tuple_paths'] = [[0]]
        correct = self.run_driver(spec, source)
        self.assertEqual(correct['exit'], 0, correct)

    def test_identical_atomic_check_is_red_for_individual_validation_and_green_staged(self):
        spec = self.spec([{'args': [[5], [2]], 'expected': [3], 'same_as_arg': 0},
                          {'args': [[5], [6]], 'raises': 'ValueError', 'unchanged_args': [0]}])
        spec['atomic_batch'] = {'argument': 1, 'unchanged_args': [0]}
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
        command = compile_feedback_checks(spec)
        red = self.run_driver(spec, individual, command)
        self.assertNotEqual(red['exit'], 0, red)
        self.assertIn('atomic batch accepted after sequential late rejection', red['stderr'])
        green = self.run_driver(spec, staged, command)
        self.assertEqual(green['exit'], 0, green)
        self.assertIn('cases=2 probes=3', green['stdout'])
        self.assertIn('source_sha256=' + hashlib.sha256(staged.encode()).hexdigest(), green['stdout'])


if __name__ == '__main__':
    unittest.main()
