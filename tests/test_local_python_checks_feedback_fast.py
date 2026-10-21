"""Pure v7 check-feedback compilation and AST checks; no generated execution."""
import ast
from copy import deepcopy
import hashlib
import json
import shlex
import unittest
from unittest.mock import patch

from hormuz import local_python_checks as checks


class LocalPythonChecksFeedbackTests(unittest.TestCase):
    def spec(self):
        return {'module_path': 'offsets.py', 'function': 'apply_offsets', 'cases': [
            {'args': [[5], [2]], 'expected': [3], 'same_as_arg': 0},
            {'args': [[5], [6]], 'raises': 'ValueError', 'unchanged_args': [0, 1]}],
            'atomic_batch': {'argument': 1, 'unchanged_args': [0]}}

    def program(self, spec):
        words = shlex.split(checks.compile_feedback_checks(spec))
        self.assertEqual(words[:2], ['python3', '-c'])
        self.assertEqual(len(words), 3)
        ast.parse(words[2])
        return words[2]

    def test_old_schema_program_and_representative_atomic_command_keep_exact_bytes(self):
        values = [(checks.PROGRAM, 'f1bd49e0f42b01b234cd04e3f4e5222e857afda39286f155fbb3b00d7c726258'),
            (json.dumps(checks.CHECKS_SCHEMA, sort_keys=True, separators=(',', ':')),
             '9c49ec793066235ecaf3defef7b04eb16aeb69261b924b65c8c87881ab6b4ac8'),
            (checks.compile_checks(self.spec()), 'b1be99c276ab1373399b1ef30bcd1d9a052912d031bd8ac594f536768392e022')]
        for text, digest in values:
            self.assertEqual(hashlib.sha256(text.encode()).hexdigest(), digest)

    def test_schema_is_independent_and_explicit_about_call_shape_and_optional_fields(self):
        schema = checks.FEEDBACK_CHECKS_SCHEMA
        self.assertIsNot(schema, checks.CHECKS_SCHEMA)
        case = schema['properties']['cases']['items']
        self.assertIsNot(case, checks.CHECKS_SCHEMA['properties']['cases']['items'])
        self.assertIn('one item per positional parameter', case['properties']['args']['description'])
        self.assertIn('nested', case['properties']['args']['description'])
        self.assertIn('args:[]', case['properties']['kwargs']['description'])
        self.assertIn('only when applicable', case['description'])
        self.assertIn('small focused', schema['description'])
        self.assertNotIn('$ref', json.dumps(schema))
        self.assertEqual(case['properties']['raises']['enum'], sorted(checks.ERROR_NAMES))

    def test_all_case_bindings_are_checked_before_any_target_call_and_error_handler(self):
        program = self.program(self.spec())
        tree = ast.parse(program)
        preflight = next(node for node in tree.body if isinstance(node, ast.For)
                         and 'bind(' in ast.unparse(node))
        self.assertIn('inspect.signature(_target)', program)
        self.assertIn('_signature.bind(*_case["args"], **_case.get("kwargs", {}))', program)
        self.assertIn('KOTO_CHECK_INPUT_ERROR', ast.unparse(preflight))
        self.assertIn('keep the task function signature', ast.unparse(preflight))
        calls = [node for node in tree.body if any(isinstance(part, ast.Call)
                 and isinstance(part.func, ast.Name) and part.func.id == '_target'
                 for part in ast.walk(node))]
        self.assertTrue(calls)
        self.assertTrue(all(tree.body.index(preflight) < tree.body.index(node) for node in calls))
        self.assertFalse(any(isinstance(part, ast.Call) and isinstance(part.func, ast.Name)
                             and part.func.id == '_target' for part in ast.walk(preflight)))
        handlers = [node for node in ast.walk(preflight) if isinstance(node, ast.ExceptHandler)]
        self.assertEqual([ast.unparse(node.type) for node in handlers], ['TypeError'])

    def test_result_and_missing_exception_feedback_rechecks_original_spec_without_answers(self):
        program = self.program(self.spec())
        self.assertIn('recheck the expected value against the original task specification before editing code', program)
        self.assertIn('recheck the expected exception against the original task specification before editing code', program)
        self.assertIn('_check.assertEqual(_result, _expected', program)
        self.assertIn('_check.assertIs(_result, _args', program)
        self.assertIn('atomic batch accepted after sequential late rejection', program)
        self.assertIn('for _index, _saved in _before.items():', program)

    def test_semantic_invalid_arguments_produce_static_error_only_command(self):
        spec = self.spec(); spec['cases'][0]['args'] = {'sensitive_sentinel': 'never embed me'}
        program = self.program(spec)
        self.assertIn('KOTO_CHECK_INPUT_ERROR invalid_arguments', program)
        self.assertNotIn('sensitive_sentinel', program)
        self.assertNotIn('never embed me', program)
        self.assertNotIn('offsets.py', program)
        tree = ast.parse(program)
        imports = [alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names]
        self.assertEqual(imports, ['sys'])
        self.assertFalse(any(isinstance(node, (ast.For, ast.FunctionDef, ast.ClassDef)) for node in ast.walk(tree)))
        self.assertNotIn('exec(', program)
        self.assertIn('sys.exit(2)', program)
        with self.assertRaisesRegex(checks.CheckSpecError, 'invalid_arguments'):
            checks.compile_checks(spec)

    def test_real_semantic_errors_receive_feedback_and_unchanged_v6_still_raises(self):
        variants = []
        value = self.spec(); value['extra'] = True; variants.append((value, 'invalid_spec_fields'))
        value = self.spec(); value['cases'][0].pop('args'); variants.append((value, 'invalid_case_fields'))
        value = self.spec(); value['cases'][0]['raises'] = 'ValueError'; variants.append((value, 'expected_xor_raises_required'))
        value = self.spec(); value['cases'][1]['raises'] = 'SystemExit'; variants.append((value, 'unsupported_exception'))
        value = self.spec(); value['cases'][0]['same_as_arg'] = 8; variants.append((value, 'invalid_identity_arg_index'))
        value = self.spec(); value['cases'][1]['unchanged_args'] = [8]; variants.append((value, 'invalid_unchanged_arg_indices'))
        value = self.spec(); value['cases'][0]['expected_tuple_paths'] = [[8]]; variants.append((value, 'tuple_path_out_of_range'))
        value = self.spec(); value['cases'][0]['expected_tuple_paths'] = [[0]]; variants.append((value, 'tuple_path_target_not_list'))
        value = self.spec(); value['atomic_batch']['unchanged_args'] = [1]; variants.append((value, 'invalid_atomic_state_indices'))
        for spec, code in variants:
            with self.subTest(code=code):
                self.assertIn('KOTO_CHECK_INPUT_ERROR ' + code, self.program(spec))
                with self.assertRaisesRegex(checks.CheckSpecError, '^' + code + '$'):
                    checks.compile_checks(spec)

    def test_only_explicit_semantic_error_codes_are_caught_and_no_submitted_text_is_copied(self):
        for code in ('expected_xor_raises_required', 'invalid_arguments', 'tuple_path_out_of_range',
                     'invalid_atomic_batch', 'unknown_future_error', 'spec_too_large', 'invalid_module_path'):
            error = checks.CheckSpecError(code)
            with self.subTest(code=code), patch.object(checks, '_normalize', side_effect=error):
                if code in ('expected_xor_raises_required', 'invalid_arguments', 'tuple_path_out_of_range', 'invalid_atomic_batch'):
                    self.assertIn('KOTO_CHECK_INPUT_ERROR ' + code, self.program(self.spec()))
                else:
                    with self.assertRaises(checks.CheckSpecError) as observed:
                        checks.compile_feedback_checks(self.spec())
                    self.assertIs(observed.exception, error)

    def test_resource_path_function_encoding_and_count_errors_remain_hard(self):
        variants = ['{', '{"module_path":"a.py","module_path":"b.py"}', 'NaN']
        for field, value in [('module_path', '../x.py'), ('function', 'bad()'), ('cases', []),
                             ('cases', [{'args': [], 'expected': None}] * 17)]:
            spec = self.spec(); spec[field] = value; variants.append(spec)
        spec = self.spec(); spec['cases'][0]['expected'] = '\ud800'; variants.append(spec)
        spec = self.spec(); spec['cases'][0]['expected'] = 'x' * checks.MAX_BYTES; variants.append(spec)
        spec = self.spec(); spec['cases'][0]['expected_tuple_paths'] = [[]] * 33; variants.append(spec)
        spec = self.spec(); spec['cases'][0]['expected_tuple_paths'] = [[0] * 9]; variants.append(spec)
        for spec in variants:
            with self.subTest(kind=type(spec).__name__), self.assertRaises(checks.CheckSpecError):
                checks.compile_feedback_checks(spec)

    def test_compilation_keeps_input_data_and_probe_plan_unchanged(self):
        spec = self.spec(); before = deepcopy(spec)
        program = self.program(spec)
        tree = ast.parse(program)
        embedded = next(node.value for node in tree.body if isinstance(node, ast.Assign)
                        and any(isinstance(t, ast.Name) and t.id == '_spec' for t in node.targets))
        self.assertEqual(json.loads(ast.literal_eval(embedded.args[0])), spec)
        probes = next(node.value for node in tree.body if isinstance(node, ast.Assign)
                      and any(isinstance(t, ast.Name) and t.id == '_probes' for t in node.targets))
        self.assertEqual(ast.literal_eval(probes), [[0, 0], [0, 0, 0], [0, 1]])
        self.assertEqual(spec, before)
        self.assertLessEqual(len(checks.compile_feedback_checks(spec).encode()), checks.MAX_COMMAND_BYTES)


if __name__ == '__main__':
    unittest.main()
