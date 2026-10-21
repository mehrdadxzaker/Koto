"""Verification intent is syntax, separate from command success or task quality."""
import shlex
import unittest


class PythonVerificationIntentTests(unittest.TestCase):
    def test_direct_assertion_is_distinguished_from_printed_or_commented_examples(self):
        from hormuz.local_verification import has_python_assertions

        self.assertTrue(has_python_assertions("python3 -c 'assert 1 == 1'"))
        self.assertFalse(has_python_assertions("python3 -c 'value = [1]; print(value)'"))
        self.assertFalse(has_python_assertions("python3 -c 'print(\"assert value\")\n# assert value'"))

    def test_imported_unittest_assertion_calls_are_recognized_without_accepting_arbitrary_methods(self):
        from hormuz.local_verification import has_python_assertions

        self.assertTrue(has_python_assertions(
            "python3 -c 'import unittest as checks; checks.TestCase().assertEqual(1, 1)'"))
        self.assertTrue(has_python_assertions(
            "python3 -c 'from unittest import TestCase as Case; Case().assertRaises(ValueError, operation)'"))
        self.assertFalse(has_python_assertions("python3 -c 'arbitrary.assertEqual(1, 1)'"))
        self.assertFalse(has_python_assertions("python3 -c 'import unittest; unittest.TestCase().assertPretend(1)'"))

    def test_reassigned_unittest_names_are_unknown_receivers(self):
        from hormuz.local_verification import has_python_assertions

        self.assertFalse(has_python_assertions(
            "python3 -c 'import unittest; unittest = arbitrary; unittest.TestCase().assertEqual(1, 1)'"))
        self.assertFalse(has_python_assertions(
            "python3 -c 'from unittest import TestCase; TestCase = arbitrary; TestCase().assertEqual(1, 1)'"))

    def test_unknown_shell_disabled_invalid_and_oversized_forms_stay_conservative(self):
        from hormuz.local_verification import has_python_assertions

        commands = [None, b'python3 -c assert', '', 'python3 checks.py',
            "python3 -O -c 'assert True'", "python3 -OO -c 'assert True'",
            "env PYTHONOPTIMIZE=1 python3 -c 'assert True'",
            "python3 -c 'assert True' && echo done", "python3 -c 'assert False' || true",
            "python3 -c 'assert True'; echo done", "python3 -c 'assert True' > result.txt",
            "python3 -c 'assert True' &", "python3 <<'PY'\nassert True\nPY",
            'python3 -c "assert $(command)"', "python3 -c 'assert `command`'",
            "python3 -c 'assert ('", "python3 -c 'assert True", "python3 -c 'assert True\x00'",
            "python3 -c 'assert True\ud800'", 'python3 -c ' + ' ' * (128 * 1024),
            'python3 -c ' + shlex.quote('assert True\n#' + 'x' * (32 * 1024)),
            'python3 -c ' + shlex.quote('assert True\n' + 'x=0;' * 1500)]
        for index, command in enumerate(commands):
            with self.subTest(index=index):
                self.assertFalse(has_python_assertions(command))
        source = 'assert True\n#' + 'x' * (32 * 1024 - len('assert True\n#'))
        self.assertTrue(has_python_assertions('python3 -c ' + shlex.quote(source)))
        self.assertTrue(has_python_assertions("python3 -c 'assert \";\" == \";\"'"))


if __name__ == '__main__':
    unittest.main()
