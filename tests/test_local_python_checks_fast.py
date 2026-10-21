"""Pure compiler/AST checks only. Never execute generated Python or a host tool."""
import ast
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import shlex
import socket
import subprocess
import unittest
from unittest.mock import patch

from hormuz.local_python_checks import CheckSpecError, ERROR_NAMES, MAX_BYTES, CHECKS_SCHEMA, compile_checks


class LocalPythonChecksTests(unittest.TestCase):
    def spec(self):
        return {'module_path': 'offsets.py', 'function': 'apply_offsets',
                'cases': [{'args': [[10], [2, None]], 'raises': 'TypeError', 'unchanged_args': [0, 1]}]}

    def program(self, spec):
        words = shlex.split(compile_checks(spec))
        self.assertEqual(words[:2], ['python3', '-c'])
        self.assertEqual(len(words), 3)
        return words[2]

    def embedded(self, spec):
        tree = ast.parse(self.program(spec))
        value = next(x.value for x in tree.body if isinstance(x, ast.Assign)
                     and any(isinstance(t, ast.Name) and t.id == '_spec' for t in x.targets))
        return json.loads(value.args[0].value)

    def test_compilation_has_no_execution_import_target_file_or_network_effects(self):
        spec = self.spec()
        before = deepcopy(spec)
        with patch.object(subprocess, 'Popen', side_effect=AssertionError('subprocess forbidden')), \
             patch.object(socket, 'socket', side_effect=AssertionError('network forbidden')), \
             patch.object(importlib.util, 'spec_from_file_location', side_effect=AssertionError('target import forbidden')), \
             patch('builtins.open', side_effect=AssertionError('filesystem access forbidden')):
            program = self.program(spec)
        self.assertEqual(spec, before)
        ast.parse(program)

    def test_only_saved_module_bytes_are_executed_without_cached_imports_or_redefinition(self):
        program = self.program(self.spec())
        tree = ast.parse(program)
        self.assertIn('_source_bytes = _file.read_bytes()', program)
        self.assertIn('compile(_source_bytes, str(_file), "exec")', program)
        self.assertIn('sys.dont_write_bytecode = True', program)
        self.assertNotIn('def apply_offsets', program)
        self.assertNotIn('.exec_module(', program)


    def test_exception_then_unchanged_assertion_is_after_handler_and_unexpected_errors_propagate(self):
        tree = ast.parse(self.program(self.spec()))
        loop = next(x for x in tree.body if isinstance(x, ast.For))
        branch = next(x for x in loop.body if isinstance(x, ast.If))
        handler = next(x for x in branch.body if isinstance(x, ast.Try))
        self.assertIsInstance(handler.handlers[0].type, ast.Name)
        self.assertEqual(handler.handlers[0].type.id, '_expected_error')
        self.assertTrue(any(isinstance(x, ast.Raise) for x in handler.orelse))
        self.assertFalse(handler.finalbody)
        unchanged = next(x for x in loop.body if isinstance(x, ast.For))
        self.assertIsInstance(unchanged, ast.For)
        self.assertGreater(loop.body.index(unchanged), loop.body.index(branch))
        self.assertIn('_check.assertEqual(_args[_index], _saved', ast.unparse(unchanged).replace("'", '"'))

    def test_arguments_kwargs_and_snapshots_are_deepcopied_inside_each_case(self):
        loop = next(x for x in ast.parse(self.program(self.spec())).body if isinstance(x, ast.For))
        self.assertEqual(ast.unparse(loop.body[0].value), "copy.deepcopy(_case['args'])")
        self.assertEqual(ast.unparse(loop.body[1].value), "copy.deepcopy(_case.get('kwargs', {}))")
        self.assertIsInstance(loop.body[2].value, ast.DictComp)
        self.assertIn('copy.deepcopy(_args[index])', ast.unparse(loop.body[2]))

    def test_resolved_cwd_containment_is_checked_before_saved_module_exec(self):
        tree = ast.parse(self.program(self.spec()))
        guard = next(i for i, x in enumerate(tree.body) if isinstance(x, ast.If)
                     and 'is_relative_to' in ast.unparse(x.test))
        execute = next(i for i, x in enumerate(tree.body) if isinstance(x, ast.Expr)
                       and isinstance(x.value, ast.Call) and isinstance(x.value.func, ast.Name) and x.value.func.id == 'exec')
        self.assertLess(guard, execute)
        self.assertIn('resolve(strict=True)', self.program(self.spec()))

    def test_shell_metacharacters_unicode_and_template_markers_stay_json_data(self):
        spec = self.spec()
        text = '\n"\' ; $(touch SHOULD_NOT_EXIST); `id` Ω ERROR_NAMES_LITERAL SPEC_LITERAL PROBE_PLAN_LITERAL'
        spec['cases'] = [{'args': [text], 'expected': text}]
        self.assertEqual(self.embedded(spec), spec)
        self.assertEqual(self.embedded(json.dumps(spec)), spec)

    def test_expected_null_false_and_zero_are_present_expectations(self):
        for value in (None, False, 0):
            spec = self.spec()
            spec['cases'] = [{'args': [], 'expected': value}]
            self.assertEqual(self.embedded(spec)['cases'][0]['expected'], value)

    def test_missing_expected_is_not_an_expected_null(self):
        for case in ({'args': []}, {'args': [], 'expected': None, 'raises': 'TypeError'}):
            spec = self.spec(); spec['cases'] = [case]
            with self.assertRaisesRegex(CheckSpecError, 'expected_xor_raises_required'):
                compile_checks(spec)

    def test_identity_is_optional_success_only_and_uses_native_object_identity(self):
        spec = self.spec()
        spec['cases'] = [{'args': [[10], []], 'expected': [10], 'same_as_arg': 0}]
        self.assertIn('_check.assertIs(_result, _args[_case["same_as_arg"]]', self.program(spec))
        spec['cases'][0] = {'args': [[10], []], 'raises': 'TypeError', 'same_as_arg': 0}
        with self.assertRaisesRegex(CheckSpecError, 'identity_requires_success'):
            compile_checks(spec)

    def test_kwargs_are_data(self):
        spec = self.spec(); spec['cases'] = [{'args': [], 'kwargs': {'value': None}, 'expected': None}]
        self.assertEqual(self.embedded(spec), spec)

    def test_only_whitelisted_builtin_errors_are_accepted(self):
        spec = self.spec()
        for name in sorted(ERROR_NAMES):
            spec['cases'][0]['raises'] = name
            self.program(spec)
        for name in ('BaseException', 'Exception', 'SystemExit', 'KeyboardInterrupt', 'CustomError', None, []):
            spec['cases'][0]['raises'] = name
            with self.assertRaisesRegex(CheckSpecError, 'unsupported_exception'):
                compile_checks(spec)

    def test_paths_must_be_lexically_relative_python_files(self):
        for path in ('/tmp/x.py', '../x.py', 'a/../x.py', './x.py', 'a//x.py',
                     'a\\x.py', 'C:x.py', 'x.py\x00', 'x.py\n', 'x.txt', '', '.py/../x.py'):
            with self.subTest(path=path):
                spec = self.spec(); spec['module_path'] = path
                with self.assertRaisesRegex(CheckSpecError, 'invalid_module_path'):
                    compile_checks(spec)
        spec = self.spec(); spec['module_path'] = 'sub folder/δ.py'
        self.program(spec)

    def test_function_is_one_identifier(self):
        for name in ('x.y', 'x()', 'lambda', 'with', '', 'a; b', '1x'):
            spec = self.spec(); spec['function'] = name
            with self.assertRaisesRegex(CheckSpecError, 'invalid_function'):
                compile_checks(spec)

    def test_closed_fields_and_typed_arguments(self):
        variants = []
        x = self.spec(); x['code'] = 'print(1)'; variants.append(x)
        x = self.spec(); x['cases'][0]['function'] = 'other'; variants.append(x)
        x = self.spec(); x['cases'][0]['args'] = {}; variants.append(x)
        x = self.spec(); x['cases'][0]['kwargs'] = []; variants.append(x)
        for spec in variants:
            with self.assertRaises(CheckSpecError):
                compile_checks(spec)

    def test_indices_are_unique_existing_positional_arguments_and_not_booleans(self):
        for value in ([True], [-1], [2], [0, 0], '0', None):
            spec = self.spec(); spec['cases'][0]['unchanged_args'] = value
            with self.assertRaises(CheckSpecError):
                compile_checks(spec)
        for value in (True, -1, 2, None, '0'):
            spec = self.spec(); spec['cases'] = [{'args': [[], []], 'expected': [], 'same_as_arg': value}]
            with self.assertRaises(CheckSpecError):
                compile_checks(spec)

    def test_sixteen_cases_allowed_seventeen_and_empty_rejected(self):
        spec = self.spec(); spec['cases'] *= 16
        self.program(spec)
        spec['cases'].append(deepcopy(spec['cases'][0]))
        with self.assertRaisesRegex(CheckSpecError, 'invalid_case_count'):
            compile_checks(spec)
        spec['cases'] = []
        with self.assertRaisesRegex(CheckSpecError, 'invalid_case_count'):
            compile_checks(spec)

    def test_byte_limit_is_exact_for_json_text_and_object_input(self):
        spec = {'module_path': 'offsets.py', 'function': 'apply_offsets', 'cases': [{'args': [], 'expected': ''}]}
        overhead = len(json.dumps(spec, separators=(',', ':')).encode())
        spec['cases'][0]['expected'] = 'x' * (MAX_BYTES - overhead)
        text = json.dumps(spec, separators=(',', ':'))
        self.assertEqual(len(text.encode()), MAX_BYTES)
        self.program(spec); self.program(text)
        spec['cases'][0]['expected'] += 'x'
        with self.assertRaises(CheckSpecError):
            compile_checks(spec)
        with self.assertRaises(CheckSpecError):
            compile_checks(text + ' ')

    def test_depth_eight_is_allowed_nine_rejected(self):
        spec = self.spec(); value = 'leaf'
        for _ in range(5): value = [value]
        spec['cases'] = [{'args': [], 'expected': value}]
        self.program(spec)
        spec['cases'][0]['expected'] = [value]
        with self.assertRaisesRegex(CheckSpecError, 'json_too_deep'):
            compile_checks(spec)

    def test_duplicate_keys_nonfinite_and_nonjson_values_are_rejected(self):
        for text in ('{"module_path":"a.py","module_path":"b.py"}', 'NaN', 'Infinity'):
            with self.assertRaises(CheckSpecError): compile_checks(text)
        for value in (float('nan'), float('inf'), (), {1}, object()):
            spec = self.spec(); spec['cases'][0]['args'] = [value]
            with self.assertRaises(CheckSpecError): compile_checks(spec)

    def test_cyclic_python_inputs_fail_bounded_validation(self):
        spec = self.spec(); value = []; value.append(value)
        spec['cases'][0]['args'] = [value]
        with self.assertRaisesRegex(CheckSpecError, 'json_too_deep'):
            compile_checks(spec)

    def test_function_length_and_generated_command_byte_caps(self):
        spec = self.spec(); spec['function'] = 'x' * 128
        self.program(spec)
        spec['function'] += 'x'
        with self.assertRaisesRegex(CheckSpecError, 'invalid_function'):
            compile_checks(spec)
        spec = self.spec(); spec['cases'] = [{'args': [], 'expected': "'" * 32000}]
        with self.assertRaisesRegex(CheckSpecError, 'command_too_large'):
            compile_checks(spec)

    def test_simple_schema_closes_structural_fields_without_recursive_references(self):
        self.assertFalse(CHECKS_SCHEMA['additionalProperties'])
        case = CHECKS_SCHEMA['properties']['cases']['items']
        self.assertFalse(case['additionalProperties'])
        self.assertFalse(CHECKS_SCHEMA['properties']['atomic_batch']['additionalProperties'])
        encoded = json.dumps(CHECKS_SCHEMA)
        self.assertNotIn('$ref', encoded)
        self.assertNotIn('oneOf', encoded)
        self.assertIn('exactly one', case['description'])
        self.assertIn('expected_tuple_paths', case['properties'])

    def test_tuple_paths_are_explicit_bounded_list_targets(self):
        spec = self.spec(); spec['cases'] = [{'args': [], 'expected': [[1, [2]], [3]],
            'expected_tuple_paths': [[], [0], [0, 1]]}]
        self.assertEqual(self.embedded(spec), spec)
        for paths in ([[0], [0]], [[True]], [[-1]], [[9]], [[0, 0]], None, ["0"]):
            spec['cases'][0]['expected_tuple_paths'] = paths
            with self.assertRaises(CheckSpecError):
                compile_checks(spec)
        spec['cases'][0]['expected_tuple_paths'] = [[]] * 33
        with self.assertRaisesRegex(CheckSpecError, 'invalid_tuple_paths'):
            compile_checks(spec)
        spec = self.spec(); spec['cases'][0]['expected_tuple_paths'] = []
        with self.assertRaisesRegex(CheckSpecError, 'tuple_paths_require_expected'):
            compile_checks(spec)

    def test_atomic_fields_require_list_batches_and_distinct_nonempty_state_indices(self):
        base = {'argument': 1, 'unchanged_args': [0]}
        for atomic in (None, {}, {'argument': 1}, {**base, 'extra': True},
                       {'argument': True, 'unchanged_args': [0]},
                       {'argument': 1, 'unchanged_args': []},
                       {'argument': 1, 'unchanged_args': [1]},
                       {'argument': 1, 'unchanged_args': [0, 0]}):
            spec = self.spec(); spec['atomic_batch'] = atomic
            with self.assertRaises(CheckSpecError): compile_checks(spec)
        spec = self.spec(); spec['atomic_batch'] = base
        with self.assertRaisesRegex(CheckSpecError, 'success_and_error'):
            compile_checks(spec)
        spec['cases'].append({'args': [[10], [2]], 'expected': [12]})
        self.program(spec)
        spec['cases'][0]['args'][1] = None
        with self.assertRaisesRegex(CheckSpecError, 'requires_list_argument'):
            compile_checks(spec)

    def test_derived_plan_is_bounded_and_uses_only_matching_provided_batches(self):
        spec = self.spec()
        spec['cases'] = [{'args': [[5], [2]], 'expected': [3]},
                         {'args': [[5], [6]], 'raises': 'ValueError'},
                         {'args': [[9], [10]], 'raises': 'ValueError'}]
        spec['atomic_batch'] = {'argument': 1, 'unchanged_args': [0]}
        tree = ast.parse(self.program(spec))
        plan = ast.literal_eval(next(x.value for x in tree.body if isinstance(x, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == '_probes' for t in x.targets)))
        self.assertEqual(plan, [[0, 0], [0, 0, 0], [0, 1]])
        self.assertLessEqual(len(plan), 8)
        self.assertTrue(all(2 <= len(sequence) <= 3 for sequence in plan))


if __name__ == '__main__':
    unittest.main()
