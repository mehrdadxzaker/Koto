"""Pure bounded script compilation, schema and source roundtrip checks."""
import shlex
import unittest

from hormuz.local_python_script import (
    MAX_COMMAND_BYTES, MAX_SCRIPT_BYTES, SCRIPT_SCHEMA, ScriptSpecError, compile_script,
)


class LocalPythonScriptTests(unittest.TestCase):
    def test_shell_sensitive_source_survives_exactly_without_execution(self):
        payload = "'single' \"double\" $(touch forbidden) `touch forbidden` \\\\n literal; café 🐈\n"
        script = 'import sys\nvalue = ' + repr(payload) + '\nsys.stdout.write(value)\n'
        command = compile_script(script)
        self.assertEqual(shlex.split(command), ['python3', '-c', script])
        self.assertLessEqual(len(command.encode()), MAX_COMMAND_BYTES)
        self.assertEqual(SCRIPT_SCHEMA['type'], 'string')
        self.assertNotIn('KOTO_PYTHON_CHECKS_PASSED', command)

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



if __name__ == '__main__':
    unittest.main()
