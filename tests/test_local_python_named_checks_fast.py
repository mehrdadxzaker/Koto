"""Named check data compiles without guessing arguments or executing target code."""
from copy import deepcopy
import ast
import json
import shlex
import unittest

from hormuz.local_python_checks import CheckSpecError
from hormuz.local_python_named_checks import NAMED_CHECKS_SCHEMA, compile_named_feedback_checks


class LocalPythonNamedChecksTests(unittest.TestCase):
    def spec(self, cases=None):
        return {'module_path': 'offsets.py', 'function': 'apply_offsets', 'cases': cases or [
            {'arguments': {'state': [5], 'offsets': [2]}, 'expected': [3], 'same_as': 'state'},
            {'arguments': {'offsets': [6], 'state': [5]}, 'raises': 'ValueError', 'unchanged': ['state']}]}

    def source(self, spec):
        words = shlex.split(compile_named_feedback_checks(spec))
        self.assertEqual(words[:2], ['python3', '-c'])
        self.assertEqual(len(words), 3)
        ast.parse(words[2])
        return words[2]

    def test_schema_has_closed_disjoint_success_and_error_objects_with_required_named_arguments(self):
        success, error = NAMED_CHECKS_SCHEMA['properties']['cases']['items']['oneOf']
        self.assertEqual(success['required'], ['arguments', 'expected'])
        self.assertEqual(error['required'], ['arguments', 'raises'])
        self.assertIn('same_as', success['properties'])
        self.assertNotIn('same_as', error['properties'])
        self.assertNotIn('expected_tuple_paths', error['properties'])
        self.assertNotIn('raises', success['properties'])
        self.assertNotIn('expected', error['properties'])
        for branch in (success, error):
            self.assertFalse(branch['additionalProperties'])
            self.assertEqual(branch['properties']['arguments']['type'], 'object')
        self.assertIn('sequential rejection', NAMED_CHECKS_SCHEMA['properties']['atomic_batch']['description'])

    def test_key_order_does_not_change_compilation_or_mutate_supplied_cases(self):
        spec = self.spec()
        original = deepcopy(spec)
        other = deepcopy(spec)
        for case in other['cases']:
            case['arguments'] = dict(reversed(list(case['arguments'].items())))
        self.assertEqual(compile_named_feedback_checks(spec), compile_named_feedback_checks(other))
        self.assertEqual(spec, original)
        source = self.source(spec)
        self.assertIn('inspect.signature', source)
        self.assertIn('.bind(**', source)
        self.assertIn('case_argument_binding', source)

    def test_recoverable_case_errors_are_static_exit_two_without_submitted_data_or_target_import(self):
        original = self.spec()
        original['module_path'] = 'private_target_marker.py'
        original['function'] = 'private_function_marker'
        variants = {}
        both = deepcopy(original); both['cases'][0]['raises'] = 'ValueError'; variants['both_outcomes'] = both
        neither = deepcopy(original); del neither['cases'][0]['expected']; variants['no_outcome'] = neither
        identity_error = deepcopy(original); identity_error['cases'][1]['same_as'] = 'state'; variants['error_identity'] = identity_error
        tuple_error = deepcopy(original); tuple_error['cases'][1]['expected_tuple_paths'] = [[]]; variants['error_tuple'] = tuple_error
        extra = deepcopy(original); extra['cases'][0]['args'] = []; variants['legacy_args'] = extra
        mismatch = deepcopy(original); del mismatch['cases'][1]['arguments']['state']; variants['different_names'] = mismatch
        missing = deepcopy(original); del missing['cases'][0]['arguments']; variants['missing_arguments'] = missing
        bad_name = deepcopy(original); bad_name['cases'][0]['same_as'] = 'absent'; variants['unknown_identity'] = bad_name
        duplicate = deepcopy(original); duplicate['cases'][1]['unchanged'] = ['state', 'state']; variants['duplicate_unchanged'] = duplicate
        for label, spec in variants.items():
            with self.subTest(case=label):
                source = self.source(spec)
                self.assertIn('KOTO_CHECK_INPUT_ERROR', source)
                self.assertNotIn('private_target_marker', source)
                self.assertNotIn('private_function_marker', source)
                tree = ast.parse(source)
                self.assertEqual([alias.name for n in ast.walk(tree) if isinstance(n, ast.Import)
                                  for alias in n.names], ['sys'])
                self.assertTrue(any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                    and n.func.attr == 'exit' and len(n.args) == 1 and isinstance(n.args[0], ast.Constant)
                    and n.args[0].value == 2 for n in ast.walk(tree)))

    def test_identity_rollback_and_composition_names_must_reference_supplied_arguments(self):
        original = self.spec()
        original['atomic_batch'] = {'argument': 'offsets', 'unchanged': ['state']}
        self.assertIn('atomic batch accepted after sequential late rejection', self.source(original))
        for atomic in ({'argument': 'absent', 'unchanged': ['state']},
                       {'argument': 'offsets', 'unchanged': ['absent']},
                       {'argument': 'offsets', 'unchanged': ['offsets']},
                       {'argument': 'offsets', 'unchanged': []}):
            with self.subTest(atomic=atomic):
                spec = deepcopy(original); spec['atomic_batch'] = atomic
                self.assertNotIn('_typed_check_saved_target', self.source(spec))

    def test_explicit_none_expected_and_tuple_paths_remain_data(self):
        source = self.source(self.spec([{'arguments': {}, 'expected': None}]))
        self.assertIn('null', source)
        source = self.source(self.spec([{'arguments': {}, 'expected': [[1, 2]],
                                       'expected_tuple_paths': [[0]]}]))
        self.assertIn('expected_tuple_paths', source)

    def test_template_markers_in_values_remain_literal_data(self):
        marker = 'SPEC_LITERAL ERROR_NAMES_LITERAL PROBE_PLAN_LITERAL'
        source = self.source(self.spec([{'arguments': {'value': marker}, 'expected': marker}]))
        tree = ast.parse(source)
        assignment = next(n for n in tree.body if isinstance(n, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == '_spec' for t in n.targets))
        encoded = json.loads(ast.literal_eval(assignment.value.args[0]))
        self.assertEqual(encoded['cases'][0]['args'], [marker])
        self.assertEqual(encoded['cases'][0]['expected'], marker)

    def test_template_markers_are_also_valid_literal_parameter_names(self):
        names = ['SPEC_LITERAL', 'NAMED_ARGUMENTS_LITERAL', 'ERROR_NAMES_LITERAL', 'PROBE_PLAN_LITERAL']
        source = self.source(self.spec([{'arguments': dict.fromkeys(names, 1), 'expected': None}]))
        tree = ast.parse(source)
        assignment = next(n for n in tree.body if isinstance(n, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == '_argument_names' for t in n.targets))
        self.assertEqual(ast.literal_eval(assignment.value), tuple(sorted(names)))

    def test_existing_json_path_and_size_boundaries_stay_hard_failures(self):
        for spec in (self.spec([{'arguments': {'value': 'x' * 32768}, 'expected': 0}]),
                     {'module_path': '../outside.py', 'function': 'f',
                      'cases': [{'arguments': {}, 'expected': None}]}):
            with self.subTest(spec_kind='oversize' if spec['module_path'] == 'offsets.py' else 'path'):
                with self.assertRaises(CheckSpecError):
                    compile_named_feedback_checks(spec)
        duplicate = '{"module_path":"x.py","module_path":"y.py","function":"f","cases":[{"arguments":{},"expected":null}]}'
        with self.assertRaises(CheckSpecError):
            compile_named_feedback_checks(duplicate)


if __name__ == '__main__':
    unittest.main()
