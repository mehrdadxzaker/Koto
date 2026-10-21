"""Bounded script compilation and ordinary host-interpreter verification."""
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from hormuz.local_python_script import (
    MAX_COMMAND_BYTES, MAX_SCRIPT_BYTES, SCRIPT_SCHEMA, ScriptSpecError, compile_script,
)


class LocalPythonScriptTests(unittest.TestCase):
    def run_host_script(self, script, *, module_source=None):
        with tempfile.TemporaryDirectory(prefix='koto-script-') as directory:
            if module_source is not None:
                Path(directory, 'saved_target.py').write_text(module_source)
            words = shlex.split(compile_script(script))
            # Use this test's Python, preserving the exact compiled code argument.
            return subprocess.run([sys.executable, *words[1:]], cwd=directory,
                                  capture_output=True, text=True, timeout=5)

    def test_shell_sensitive_source_survives_exactly_without_execution(self):
        payload = "'single' \"double\" $(touch forbidden) `touch forbidden` \\\\n literal; café 🐈\n"
        script = 'import sys\nvalue = ' + repr(payload) + '\nsys.stdout.write(value)\n'
        with patch('subprocess.run', side_effect=AssertionError('compiler executed code')):
            command = compile_script(script)
        self.assertEqual(shlex.split(command), ['python3', '-c', script])
        self.assertLessEqual(len(command.encode()), MAX_COMMAND_BYTES)
        self.assertEqual(SCRIPT_SCHEMA['type'], 'string')
        self.assertNotIn('KOTO_PYTHON_CHECKS_PASSED', command)
        with tempfile.TemporaryDirectory(prefix='koto-script-shell-') as directory:
            result = subprocess.run(command, shell=True, executable='/bin/sh', cwd=directory,
                                    capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, payload)
            self.assertFalse(Path(directory, 'forbidden').exists())

    def test_source_bounds_use_utf8_bytes_and_reject_unrepresentable_arguments(self):
        exact = '#' + 'é' * ((MAX_SCRIPT_BYTES - 2) // 2) + ' '
        self.assertEqual(shlex.split(compile_script(exact))[2], exact)
        for value, message in [(None, 'invalid_script'), ([], 'invalid_script'),
                               ('', 'invalid_script'), ('pass\x00', 'invalid_script'),
                               ('\ud800', 'invalid_script'),
                               ('é' * (MAX_SCRIPT_BYTES // 2 + 1), 'script_too_large')]:
            with self.subTest(kind=type(value).__name__, error=message):
                with self.assertRaisesRegex(ScriptSpecError, '^' + message + '$'):
                    compile_script(value)
        # Quote expansion is bounded independently from the source size.
        with self.assertRaisesRegex(ScriptSpecError, '^command_too_large$'):
            compile_script("'" * MAX_SCRIPT_BYTES)

    def test_multiline_compound_assertion_checks_the_saved_modules_rollback(self):
        script = '''import copy
import saved_target
state = {'first': 1, 'second': 2}
before = copy.deepcopy(state)
try:
    saved_target.replace(state, [('first', 3), ('second', -1)])
except ValueError:
    pass
else:
    raise AssertionError('expected rejection')
assert state == before, 'partial mutation after rejection'
'''
        buggy = '''def replace(state, changes):
    for key, value in changes:
        if value < 0:
            raise ValueError('negative replacement')
        state[key] = value
'''
        repaired = '''def replace(state, changes):
    pending = dict(state)
    for key, value in changes:
        if value < 0:
            raise ValueError('negative replacement')
        pending[key] = value
    state.update(pending)
'''
        failed = self.run_host_script(script, module_source=buggy)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn('partial mutation after rejection', failed.stderr)
        passed = self.run_host_script(script, module_source=repaired)
        self.assertEqual(passed.returncode, 0, passed.stderr)
        self.assertEqual(passed.stdout, '')

    def test_equal_unhashable_values_are_checked_against_the_saved_function(self):
        script = '''import saved_target
assert saved_target.distinct([[1], [1], {'x': 2}, {'x': 2}]) == [[1], {'x': 2}]
'''
        buggy = '''def distinct(values):
    return list(dict.fromkeys(values))
'''
        repaired = '''def distinct(values):
    result = []
    for value in values:
        if value not in result:
            result.append(value)
    return result
'''
        failed = self.run_host_script(script, module_source=buggy)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn('unhashable type', failed.stderr)
        passed = self.run_host_script(script, module_source=repaired)
        self.assertEqual(passed.returncode, 0, passed.stderr)
        self.assertEqual(passed.stdout, '')

    def test_interpreter_failures_remain_real_failures_without_success_feedback(self):
        for script, error in [('assert False, "observed failure"', 'AssertionError'),
                              ('if True\n    pass\n', 'SyntaxError')]:
            with self.subTest(error=error):
                result = self.run_host_script(script)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(error, result.stderr)
                self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    unittest.main()
