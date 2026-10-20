"""Execute only generic generated drivers in a read-only, network-denied sandbox."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import py_compile
import shlex
import subprocess
import sys
import tempfile
import unittest

from hormuz.local_python_checks import compile_checks


INDIVIDUAL = '''def apply_offsets(state, offsets):
    for value in offsets:
        if value < 0 or value > state[0]:
            raise ValueError("rejected")
    state[0] -= sum(offsets)
    return state
'''
PARTIAL = '''def apply_offsets(state, offsets):
    for value in offsets:
        if value < 0 or value > state[0]:
            raise ValueError("rejected")
        state[0] -= value
    return state
'''
STAGED = '''def apply_offsets(state, offsets):
    proposed = state[0]
    for value in offsets:
        if value < 0 or value > proposed:
            raise ValueError("rejected")
        proposed -= value
    state[0] = proposed
    return state
'''


@unittest.skipUnless(sys.platform == 'darwin' and Path('/usr/bin/sandbox-exec').is_file(),
                     'Requires the read-only macOS execution sandbox')
class LocalPythonChecksWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='koto-python-checks-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.project = self.root / 'owned-cwd'
        self.project.mkdir()
        self.target = self.project / 'offsets.py'

    def spec(self, *, atomic=True):
        value = {'module_path': 'offsets.py', 'function': 'apply_offsets', 'cases': [
            {'args': [[5], [2]], 'expected': [3], 'same_as_arg': 0, 'unchanged_args': [1]},
            {'args': [[5], [6]], 'raises': 'ValueError', 'unchanged_args': [0, 1]}]}
        if atomic:
            value['atomic_batch'] = {'argument': 1, 'unchanged_args': [0]}
        return value

    def run_driver(self, spec, source, *, command=None, timestamp=None):
        self.target.write_text(source)
        if timestamp is not None:
            os.utime(self.target, (timestamp, timestamp))
        command = compile_checks(spec) if command is None else command
        words = shlex.split(command)
        self.assertEqual(words[:2], ['python3', '-c'])
        self.assertEqual(len(words), 3)
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
                    try:
                        process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=1)
            stdout.seek(0); stderr.seek(0)
            result = {'exit': process.returncode, 'stdout': stdout.read(8192).decode('utf-8', 'replace'),
                      'stderr': stderr.read(8192).decode('utf-8', 'replace')}
        self.assertNotIn('sandbox_apply', result['stderr'], result)
        self.assertEqual(self.target.read_text(), source)
        return result

    def test_composition_catches_cumulative_and_partial_mutation_after_base_checks_pass(self):
        for source in (INDIVIDUAL, PARTIAL):
            with self.subTest(source=hashlib.sha256(source.encode()).hexdigest()):
                baseline = self.run_driver(self.spec(atomic=False), source)
                self.assertEqual(baseline['exit'], 0, baseline)
                composed = self.run_driver(self.spec(), source)
                self.assertNotEqual(composed['exit'], 0, composed)
                self.assertIn('AssertionError', composed['stderr'])
                self.assertNotIn('KOTO_PYTHON_CHECKS_PASSED', composed['stdout'])

    def test_identical_compiled_command_is_red_then_green_after_private_staging(self):
        command = compile_checks(self.spec())
        red = self.run_driver(self.spec(), INDIVIDUAL, command=command)
        self.assertNotEqual(red['exit'], 0, red)
        green = self.run_driver(self.spec(), STAGED, command=command)
        self.assertEqual(green['exit'], 0, green)
        self.assertIn('cases=2 probes=3', green['stdout'])
        self.assertIn('source_sha256=' + hashlib.sha256(STAGED.encode()).hexdigest(), green['stdout'])
        self.assertEqual(compile_checks(self.spec()), command)

    def test_atomic_claim_requires_a_state_changing_prefix_then_late_rejection(self):
        spec = self.spec()
        spec['cases'][0] = {'args': [[5], []], 'expected': [5], 'same_as_arg': 0}
        result = self.run_driver(spec, STAGED)
        self.assertNotEqual(result['exit'], 0, result)
        self.assertIn('provide better cases', result['stderr'])
        self.assertNotIn('KOTO_PYTHON_CHECKS_PASSED', result['stdout'])

    def test_derived_probe_budget_is_eight_and_every_sequence_has_at_most_three_calls(self):
        spec = self.spec()
        spec['cases'] = [{'args': [[5], [value]], 'expected': [5 - value], 'same_as_arg': 0}
                         for value in (1, 2, 3, 4)] + [spec['cases'][1]]
        result = self.run_driver(spec, STAGED)
        self.assertEqual(result['exit'], 0, result)
        self.assertIn('cases=5 probes=8', result['stdout'])

    def test_derived_rejection_does_not_assume_exception_priority(self):
        source = STAGED.replace('if value < 0 or value > proposed:',
            'if proposed < 5 and value > proposed:\n            raise TypeError("later rejection")\n        if value < 0 or value > proposed:')
        result = self.run_driver(self.spec(), source)
        self.assertEqual(result['exit'], 0, result)

    def test_fresh_saved_bytes_override_a_stale_same_size_timestamp_cache(self):
        source = 'def apply_offsets(state, offsets):\n    return 11\n'
        spec = {'module_path': 'offsets.py', 'function': 'apply_offsets',
                'cases': [{'args': [[], []], 'expected': 11}]}
        self.target.write_text(source)
        timestamp = self.target.stat().st_mtime
        cache = Path(importlib.util.cache_from_source(str(self.target)))
        py_compile.compile(str(self.target), cfile=str(cache), doraise=True)
        self.assertTrue(cache.is_file())
        changed = source.replace('11', '22')
        spec['cases'][0]['expected'] = 22
        second = self.run_driver(spec, changed, timestamp=timestamp)
        self.assertEqual(second['exit'], 0, second)
        self.assertIn(hashlib.sha256(changed.encode()).hexdigest(), second['stdout'])

    def test_resolved_symlink_outside_cwd_is_rejected_before_import(self):
        outside = self.root / 'outside.py'
        outside.write_text(STAGED)
        linked = self.project / 'linked.py'
        linked.symlink_to(outside)
        spec = self.spec(atomic=False); spec['module_path'] = 'linked.py'
        result = self.run_driver(spec, STAGED)
        self.assertNotEqual(result['exit'], 0, result)
        self.assertIn('outside the host working directory', result['stderr'])

    def test_target_cannot_write_in_the_read_only_test_sandbox(self):
        source = 'from pathlib import Path\nPath("forbidden").write_text("no")\n' + STAGED
        result = self.run_driver(self.spec(), source)
        self.assertNotEqual(result['exit'], 0, result)
        self.assertIn('PermissionError', result['stderr'])
        self.assertNotIn('KOTO_PYTHON_CHECKS_PASSED', result['stdout'])
        self.assertFalse((self.project / 'forbidden').exists())

    def test_tuple_results_require_explicit_paths_and_nested_conversion_is_deepest_first(self):
        source = 'def apply_offsets():\n    return [(1, 2), (3, 4)]\n'
        spec = {'module_path': 'offsets.py', 'function': 'apply_offsets',
                'cases': [{'args': [], 'expected': [[1, 2], [3, 4]]}]}
        wrong_type = self.run_driver(spec, source)
        self.assertNotEqual(wrong_type['exit'], 0, wrong_type)
        spec['cases'][0]['expected_tuple_paths'] = [[0], [1]]
        explicit = self.run_driver(spec, source)
        self.assertEqual(explicit['exit'], 0, explicit)
        nested_source = 'def apply_offsets():\n    return ((1, (2,)), (3,))\n'
        spec['cases'][0] = {'args': [], 'expected': [[1, [2]], [3]],
                            'expected_tuple_paths': [[], [0], [0, 1], [1]]}
        nested = self.run_driver(spec, nested_source)
        self.assertEqual(nested['exit'], 0, nested)


if __name__ == '__main__':
    unittest.main()
