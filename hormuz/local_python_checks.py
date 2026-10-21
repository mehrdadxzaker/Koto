"""Pure bounded check-data compiler; only the host executes the resulting command.

This module neither imports target code nor executes the generated command.
The existing host remains responsible for approval, sandboxing and execution.
"""
import json
import keyword
import math
import re
import shlex


MAX_BYTES = 32 * 1024
MAX_DEPTH = 8  # The root object is depth zero.
MAX_CASES = 16
MAX_COMMAND_BYTES = 128 * 1024
MAX_DERIVED_PROBES = 8
MAX_TUPLE_PATHS = 32
ERROR_NAMES = frozenset({'ValueError', 'TypeError', 'KeyError', 'IndexError',
    'RuntimeError', 'OverflowError', 'ZeroDivisionError', 'AssertionError'})
IDENTIFIER = re.compile(r'[A-Za-z_][A-Za-z0-9_]*\Z')

CHECKS_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'properties': {
        'module_path': {'type': 'string', 'minLength': 1, 'maxLength': 1024,
                        'description': 'Relative .py path inside the host working directory.'},
        'function': {'type': 'string', 'maxLength': 128, 'pattern': '^[A-Za-z_][A-Za-z0-9_]*$'},
        'cases': {'type': 'array', 'minItems': 1, 'maxItems': MAX_CASES, 'items': {
            'type': 'object', 'additionalProperties': False,
            'description': 'Use real positional args and optional kwargs. Provide exactly one of expected or raises; expected:null is an explicit None expectation. No code or replacement function.',
            'properties': {
                'args': {'type': 'array', 'items': {}},
                'kwargs': {'type': 'object', 'additionalProperties': {}},
                'expected': {'description': 'Exact expected JSON value. An explicit null expects None.'},
                'raises': {'type': 'string', 'enum': sorted(ERROR_NAMES)},
                'unchanged_args': {'type': 'array', 'uniqueItems': True,
                                   'items': {'type': 'integer', 'minimum': 0}},
                'same_as_arg': {'type': 'integer', 'minimum': 0},
                'expected_tuple_paths': {'type': 'array', 'maxItems': MAX_TUPLE_PATHS,
                    'uniqueItems': True,
                    'description': 'Index paths into expected lists to convert explicitly to tuples, deepest first. [[0],[1]] marks two children; [[]] marks the root. No implicit result conversion.',
                    'items': {'type': 'array', 'maxItems': MAX_DEPTH,
                              'items': {'type': 'integer', 'minimum': 0}}},
            }, 'required': ['args'],
        }},
        'atomic_batch': {'type': 'object', 'additionalProperties': False,
            'description': 'Opt in only when batches represent ordered operations whose concatenation must preserve sequential rejection. At most eight composition probes use supplied batches; requires observed late-error coverage. Atomicity alone does not imply this property.',
            'properties': {'argument': {'type': 'integer', 'minimum': 0},
                'unchanged_args': {'type': 'array', 'minItems': 1, 'uniqueItems': True,
                                   'items': {'type': 'integer', 'minimum': 0}}},
            'required': ['argument', 'unchanged_args']},
    }, 'required': ['module_path', 'function', 'cases'],
    'description': 'JSON only: at most 32 KiB, depth eight (root zero), sixteen cases. No code or function definitions.',
}


class CheckSpecError(ValueError):
    """A bounded validation message; never includes submitted data."""


def require(condition, code):
    if not condition:
        raise CheckSpecError(code)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate_json_key')
        result[key] = value
    return result


def _reject_constant(_):
    raise CheckSpecError('nonfinite_number')


def _json_shape(value, depth=0, nodes=None):
    if nodes is None:
        nodes = [0]
    nodes[0] += 1
    # Every JSON node requires at least one byte, so this cannot exclude a
    # valid 32-KiB document and bounds traversal of Python object inputs.
    require(nodes[0] <= MAX_BYTES, 'too_many_json_nodes')
    require(depth <= MAX_DEPTH, 'json_too_deep')
    kind = type(value)
    if kind is dict:
        require(len(value) <= MAX_BYTES, 'object_too_large')
        for key, child in value.items():
            require(type(key) is str and len(key) <= MAX_BYTES, 'invalid_json_key')
            nodes[0] += len(key) + 1
            require(nodes[0] <= MAX_BYTES, 'spec_too_large')
            _json_shape(child, depth + 1, nodes)
    elif kind is list:
        require(len(value) <= MAX_BYTES, 'array_too_large')
        for child in value:
            _json_shape(child, depth + 1, nodes)
    elif kind is str:
        require(len(value) <= MAX_BYTES, 'string_too_large')
        nodes[0] += len(value)
        require(nodes[0] <= MAX_BYTES, 'spec_too_large')
    elif kind is float:
        require(math.isfinite(value), 'nonfinite_number')
    else:
        require(value is None or kind in (bool, int), 'non_json_value')
        if kind is int:
            require(value.bit_length() <= MAX_BYTES * 4, 'integer_too_large')


def _normalize(spec):
    if type(spec) is str:
        require(len(spec) <= MAX_BYTES, 'spec_too_large')
        try:
            require(len(spec.encode('utf-8')) <= MAX_BYTES, 'spec_too_large')
            spec = json.loads(spec, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
        except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as error:
            if isinstance(error, CheckSpecError):
                raise
            raise CheckSpecError('invalid_json') from None
    _json_shape(spec)
    try:
        encoded = json.dumps(spec, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        require(len(encoded.encode('utf-8')) <= MAX_BYTES, 'spec_too_large')
    except (UnicodeError, ValueError, OverflowError) as error:
        if isinstance(error, CheckSpecError):
            raise
        raise CheckSpecError('invalid_json_encoding') from None
    require(type(spec) is dict, 'spec_must_be_object')
    require(set(spec) <= {'module_path', 'function', 'cases', 'atomic_batch'}
        and {'module_path', 'function', 'cases'} <= set(spec), 'invalid_spec_fields')
    path, name, cases = spec['module_path'], spec['function'], spec['cases']
    require(type(path) is str and 0 < len(path) <= 1024 and path.endswith('.py'), 'invalid_module_path')
    require(not path.startswith('/') and '\\' not in path and ':' not in path
        and all(part not in ('', '.', '..') for part in path.split('/'))
        and not any(ord(char) < 32 or ord(char) == 127 for char in path), 'invalid_module_path')
    require(type(name) is str and len(name) <= 128 and IDENTIFIER.fullmatch(name) and not keyword.iskeyword(name), 'invalid_function')
    require(type(cases) is list and 1 <= len(cases) <= MAX_CASES, 'invalid_case_count')
    for case in cases:
        require(type(case) is dict, 'case_must_be_object')
        require(set(case) <= {'args', 'kwargs', 'expected', 'raises', 'unchanged_args', 'same_as_arg', 'expected_tuple_paths'}
            and 'args' in case, 'invalid_case_fields')
        require(type(case['args']) is list and type(case.get('kwargs', {})) is dict, 'invalid_arguments')
        require(('expected' in case) != ('raises' in case), 'expected_xor_raises_required')
        if 'raises' in case:
            require(type(case['raises']) is str and case['raises'] in ERROR_NAMES, 'unsupported_exception')
            require('same_as_arg' not in case, 'identity_requires_success')
            require('expected_tuple_paths' not in case, 'tuple_paths_require_expected')
        indices = case.get('unchanged_args', [])
        require(type(indices) is list and all(type(index) is int and 0 <= index < len(case['args'])
            for index in indices), 'invalid_unchanged_arg_indices')
        require(len(set(indices)) == len(indices), 'duplicate_unchanged_arg_index')
        if 'same_as_arg' in case:
            index = case['same_as_arg']
            require(type(index) is int and 0 <= index < len(case['args']), 'invalid_identity_arg_index')
        paths = case.get('expected_tuple_paths', [])
        require(type(paths) is list and len(paths) <= MAX_TUPLE_PATHS, 'invalid_tuple_paths')
        seen = set()
        for path in paths:
            require(type(path) is list and len(path) <= MAX_DEPTH
                and all(type(index) is int and index >= 0 for index in path), 'invalid_tuple_path')
            require(tuple(path) not in seen, 'duplicate_tuple_path')
            seen.add(tuple(path))
            selected = case['expected']
            for index in path:
                require(type(selected) is list and index < len(selected), 'tuple_path_out_of_range')
                selected = selected[index]
            require(type(selected) is list, 'tuple_path_target_not_list')
    if 'atomic_batch' in spec:
        atomic = spec['atomic_batch']
        require(type(atomic) is dict and set(atomic) == {'argument', 'unchanged_args'}, 'invalid_atomic_batch')
        argument, indices = atomic['argument'], atomic['unchanged_args']
        require(type(argument) is int and argument >= 0, 'invalid_atomic_batch_argument')
        require(type(indices) is list and indices and all(type(index) is int and index >= 0
            for index in indices) and len(set(indices)) == len(indices) and argument not in indices,
            'invalid_atomic_state_indices')
        for case in cases:
            require(argument < len(case['args']) and type(case['args'][argument]) is list,
                    'atomic_batch_requires_list_argument')
            require(all(index < len(case['args']) for index in indices), 'invalid_atomic_state_indices')
        require(any('expected' in case for case in cases) and any('raises' in case for case in cases),
                'atomic_batch_requires_success_and_error_cases')
    # The runtime receives an independent JSON value, including for dict input.
    return encoded


def _probe_plan(spec):
    """Indices only: no invented inputs, operations, expected values or errors."""
    if 'atomic_batch' not in spec:
        return []
    argument = spec['atomic_batch']['argument']
    successes = [index for index, case in enumerate(spec['cases']) if 'expected' in case]
    failures = [index for index, case in enumerate(spec['cases']) if 'raises' in case]
    def fingerprint(case):
        args = case['args']
        return json.dumps([args[:argument], args[argument + 1:], case.get('kwargs', {})],
                          sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    fingerprints = [fingerprint(case) for case in spec['cases']]
    matches = {index: [other for other in failures if fingerprints[index] == fingerprints[other]]
               for index in successes}
    plan = []
    def add(indices):
        if len(plan) < MAX_DERIVED_PROBES and indices not in plan:
            plan.append(indices)
    for index in successes:
        add([index, index]); add([index, index, index])
        if matches[index]:
            add([index, matches[index][0]])
    for index in successes:
        for other in matches[index]:
            add([index, other])
    return plan


PROGRAM = '''import builtins, copy, hashlib, json, pathlib, sys, types, unittest
_spec = json.loads(SPEC_LITERAL)
_root = pathlib.Path.cwd().resolve()
_file = (_root / _spec["module_path"]).resolve(strict=True)
if not _file.is_file() or not _file.is_relative_to(_root):
    raise AssertionError("target module is outside the host working directory")
_source_bytes = _file.read_bytes()
_source_sha256 = hashlib.sha256(_source_bytes).hexdigest()
_module = types.ModuleType("_typed_check_saved_target")
_module.__file__ = str(_file)
sys.modules[_module.__name__] = _module
sys.dont_write_bytecode = True
exec(compile(_source_bytes, str(_file), "exec"), _module.__dict__)
_target = getattr(_module, _spec["function"])
if not callable(_target):
    raise AssertionError("target is not callable")
_errors = {name: getattr(builtins, name) for name in ERROR_NAMES_LITERAL}
_check = unittest.TestCase()
_case_count = 0
for _number, _case in enumerate(_spec["cases"], 1):
    _args = copy.deepcopy(_case["args"])
    _kwargs = copy.deepcopy(_case.get("kwargs", {}))
    _before = {index: copy.deepcopy(_args[index]) for index in _case.get("unchanged_args", [])}
    if "raises" in _case:
        _expected_error = _errors[_case["raises"]]
        try:
            _target(*_args, **_kwargs)
        except _expected_error:
            pass
        else:
            raise AssertionError("case %d: expected exception was not raised" % _number)
    else:
        _result = _target(*_args, **_kwargs)
        _expected = copy.deepcopy(_case["expected"])
        for _path in sorted(_case.get("expected_tuple_paths", []), key=len, reverse=True):
            if not _path:
                _expected = tuple(_expected)
            else:
                _parent = _expected
                for _part in _path[:-1]:
                    _parent = _parent[_part]
                _parent[_path[-1]] = tuple(_parent[_path[-1]])
        _check.assertEqual(_result, _expected, "case %d: result mismatch" % _number)
        if "same_as_arg" in _case:
            _check.assertIs(_result, _args[_case["same_as_arg"]], "case %d: identity mismatch" % _number)
    for _index, _saved in _before.items():
        _check.assertEqual(_args[_index], _saved, "case %d: argument %d changed" % (_number, _index))
    _case_count += 1
_probes = PROBE_PLAN_LITERAL
_probe_count = 0
_meaningful_late_failures = 0
if "atomic_batch" in _spec:
    _atomic = _spec["atomic_batch"]
    _argument = _atomic["argument"]
    _indices = _atomic["unchanged_args"]
    for _sequence in _probes:
        _initial = _spec["cases"][_sequence[0]]
        _initial_args = _initial["args"]
        _state = {index: copy.deepcopy(_initial_args[index]) for index in _indices}
        _sequential_rejected = False
        _late = False
        _successes = 0
        for _case_index in _sequence:
            _step_args = copy.deepcopy(_initial_args)
            for _index in _indices:
                _step_args[_index] = _state[_index]
            _step_args[_argument] = copy.deepcopy(_spec["cases"][_case_index]["args"][_argument])
            _prefix_changed = _successes > 0 and any(_state[index] != _initial_args[index] for index in _indices)
            try:
                _target(*_step_args, **copy.deepcopy(_initial.get("kwargs", {})))
            except Exception:
                _sequential_rejected = True
                _late = _prefix_changed
                break
            else:
                _successes += 1
                for _index in _indices:
                    _state[_index] = _step_args[_index]
        _combined_args = copy.deepcopy(_initial_args)
        _combined_args[_argument] = [copy.deepcopy(item) for case_index in _sequence
            for item in _spec["cases"][case_index]["args"][_argument]]
        _before_combined = {index: copy.deepcopy(_combined_args[index]) for index in _indices}
        _combined_rejected = False
        try:
            _target(*_combined_args, **copy.deepcopy(_initial.get("kwargs", {})))
        except Exception:
            _combined_rejected = True
            for _index in _indices:
                _check.assertEqual(_combined_args[_index], _before_combined[_index], "atomic batch changed state on error")
        if _sequential_rejected and _late:
            _meaningful_late_failures += 1
            if not _combined_rejected:
                raise AssertionError("atomic batch accepted after sequential late rejection")
        _probe_count += 1
    if not _meaningful_late_failures:
        raise AssertionError("atomic late-failure coverage missing: provide better cases with a state-changing valid prefix and later rejection")
print("KOTO_PYTHON_CHECKS_PASSED source_sha256=%s cases=%d probes=%d" % (_source_sha256, _case_count, _probe_count))
'''


def compile_checks(spec):
    """Validate JSON-only cases and return text for existing exec_command.cmd.

    The returned Python checks import the saved module only when the host runs
    the command. Compilation has no filesystem, subprocess or network effects.
    """
    encoded = _normalize(spec)
    # Substitute static constants before inserting user data, so data containing
    # a template marker remains data and cannot be rewritten as source.
    program = PROGRAM.replace('ERROR_NAMES_LITERAL', repr(tuple(sorted(ERROR_NAMES)))).replace(
        'PROBE_PLAN_LITERAL', repr(_probe_plan(json.loads(encoded)))).replace('SPEC_LITERAL', repr(encoded))
    command = 'python3 -c ' + shlex.quote(program)
    require(len(command.encode('utf-8')) <= MAX_COMMAND_BYTES, 'command_too_large')
    return command


# The opt-in feedback profile owns independent descriptions and a separate
# driver. Keep the original schema, program and compiler unchanged for v6.
from copy import deepcopy as _deepcopy

FEEDBACK_CHECKS_SCHEMA = _deepcopy(CHECKS_SCHEMA)
FEEDBACK_CHECKS_SCHEMA['description'] = (
    'JSON only: use small focused cases, not the maximum case count. At most '
    '32 KiB, depth eight (root zero), sixteen cases. No code or function definitions.')
_feedback_case_schema = FEEDBACK_CHECKS_SCHEMA['properties']['cases']['items']
_feedback_case_schema['description'] = (
    'Call the actual saved function without changing its task signature. Provide exactly one '
    'of expected or raises; expected:null explicitly expects None. Include optional fields '
    'only when applicable; omit unused optional fields. No replacement function or code.')
_feedback_case_schema['properties']['args']['description'] = (
    'Use one item per positional parameter: f(state, changes) uses args:[state,changes]. '
    'A single list input needs a nested list: f(values) uses args:[[1,2]]. '
    'Use args:[] when supplying all arguments by name in kwargs.')
_feedback_case_schema['properties']['kwargs']['description'] = (
    'Optional arguments by their actual parameter names; use args:[] when all arguments '
    'are supplied here. Do not put an object of named arguments inside args.')

# Only these semantic check-data mistakes become real, error-only host commands.
# JSON, encoding, size/depth/count, path/function and unknown future failures stay
# hard errors. The tuple shape codes are also hard because they include limits.
_FEEDBACK_ACTIONS = {
    'invalid_spec_fields': 'Use only module_path, function, cases, and optional atomic_batch; include the required fields.',
    'case_must_be_object': 'Each case must be a JSON object with args and exactly one of expected or raises.',
    'invalid_case_fields': 'Each case needs args; remove unknown fields and include only applicable optional fields.',
    'invalid_arguments': 'Use an args array with one item per positional parameter and an optional kwargs object by parameter name.',
    'expected_xor_raises_required': 'Provide exactly one of expected or raises in each case; omit the other field rather than setting it to null.',
    'unsupported_exception': 'Use one of the listed builtin exception names for raises; omit raises for a success case.',
    'identity_requires_success': 'Use same_as_arg only for an expected success case; omit it from exception cases.',
    'tuple_paths_require_expected': 'Use expected_tuple_paths only with expected; omit it from exception cases.',
    'invalid_unchanged_arg_indices': 'unchanged_args must list existing zero-based positional argument indices.',
    'duplicate_unchanged_arg_index': 'List each unchanged_args index only once.',
    'invalid_identity_arg_index': 'same_as_arg must be an existing zero-based positional argument index.',
    'duplicate_tuple_path': 'List each expected_tuple_paths path only once.',
    'tuple_path_out_of_range': 'Each expected_tuple_paths index must select an existing list within expected.',
    'tuple_path_target_not_list': 'Each expected_tuple_paths path must select a JSON list to convert to a tuple.',
    'invalid_atomic_batch': 'atomic_batch needs exactly argument and unchanged_args; omit atomic_batch when it does not apply.',
    'invalid_atomic_batch_argument': 'atomic_batch.argument must be a zero-based positional batch argument index.',
    'invalid_atomic_state_indices': 'Atomic unchanged_args must be distinct existing state argument indices, separate from the batch argument.',
    'atomic_batch_requires_list_argument': 'Every atomic case must supply a list at the chosen positional batch argument.',
    'atomic_batch_requires_success_and_error_cases': 'Atomic composition requires both a valid success case and an expected error case using compatible initial state.',
}

_FEEDBACK_PREFLIGHT = '''_signature = inspect.signature(_target)
for _case in _spec["cases"]:
    try:
        _signature.bind(*_case["args"], **_case.get("kwargs", {}))
    except TypeError:
        sys.stderr.write("KOTO_CHECK_INPUT_ERROR case_argument_binding: Fix case args/kwargs: use one item per positional parameter, a nested list for one list parameter, or kwargs by name with args:[]; keep the task function signature.\\n")
        sys.exit(2)
'''

FEEDBACK_PROGRAM = PROGRAM.replace(
    'import builtins, copy, hashlib, json,', 'import builtins, copy, hashlib, inspect, json,', 1).replace(
    '_errors = ', _FEEDBACK_PREFLIGHT + '_errors = ', 1).replace(
    'case %d: result mismatch',
    'case %d: result mismatch; recheck the expected value against the original task specification before editing code').replace(
    'case %d: expected exception was not raised',
    'case %d: expected exception was not raised; recheck the expected exception against the original task specification before editing code')


def compile_feedback_checks(spec):
    """Compile opt-in check feedback without executing code or reading files.

    Selected semantic mistakes yield a static command that the ordinary host
    executes for actionable stderr and exit 2. It never imports a target or
    embeds submitted data. All other validation failures preserve fail-closed
    behavior. Valid cases retain exact values, atomic probes and existing bounds.
    """
    try:
        encoded = _normalize(spec)
    except CheckSpecError as error:
        action = _FEEDBACK_ACTIONS.get(str(error))
        if action is None:
            raise
        message = 'KOTO_CHECK_INPUT_ERROR ' + str(error) + ': ' + action + '\n'
        program = 'import sys\nsys.stderr.write(' + repr(message) + ')\nsys.exit(2)\n'
    else:
        program = FEEDBACK_PROGRAM.replace('ERROR_NAMES_LITERAL', repr(tuple(sorted(ERROR_NAMES)))).replace(
            'PROBE_PLAN_LITERAL', repr(_probe_plan(json.loads(encoded)))).replace('SPEC_LITERAL', repr(encoded))
    command = 'python3 -c ' + shlex.quote(program)
    require(len(command.encode('utf-8')) <= MAX_COMMAND_BYTES, 'command_too_large')
    return command
