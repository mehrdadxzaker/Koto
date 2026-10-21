"""Bounded named case data for the existing host-owned Python check driver."""
from copy import deepcopy
import json
import keyword
import re
import shlex

from . import local_python_checks as indexed


CheckSpecError = indexed.CheckSpecError
_named_arguments = {'type': 'object', 'additionalProperties': {},
    'description': 'Map each supplied argument by its actual saved-function parameter name. '
        'Put a list input directly at its name. Use the same set of names in every case; '
        'omit an optional defaulted parameter in every case to retain its default.'}
_unchanged = {'type': 'array', 'uniqueItems': True,
    'items': {'type': 'string', 'minLength': 1, 'maxLength': 128},
    'description': 'Names of supplied arguments required to remain unchanged.'}
_case_properties = indexed.FEEDBACK_CHECKS_SCHEMA['properties']['cases']['items']['properties']
_success = {'type': 'object', 'additionalProperties': False,
    'properties': {'arguments': deepcopy(_named_arguments), 'expected': deepcopy(_case_properties['expected']),
        'same_as': {'type': 'string', 'minLength': 1, 'maxLength': 128,
                    'description': 'Supplied argument name whose exact object must be returned.'},
        'unchanged': deepcopy(_unchanged),
        'expected_tuple_paths': deepcopy(_case_properties['expected_tuple_paths'])},
    'required': ['arguments', 'expected']}
_error = {'type': 'object', 'additionalProperties': False,
    'properties': {'arguments': deepcopy(_named_arguments), 'raises': deepcopy(_case_properties['raises']),
        'unchanged': deepcopy(_unchanged)}, 'required': ['arguments', 'raises']}
NAMED_CHECKS_SCHEMA = deepcopy(indexed.FEEDBACK_CHECKS_SCHEMA)
NAMED_CHECKS_SCHEMA['properties']['cases']['items'] = {'oneOf': [_success, _error]}
NAMED_CHECKS_SCHEMA['properties']['atomic_batch'] = {
    'type': 'object', 'additionalProperties': False,
    'description': indexed.CHECKS_SCHEMA['properties']['atomic_batch']['description'],
    'properties': {'argument': {'type': 'string', 'minLength': 1, 'maxLength': 128,
                               'description': 'Supplied argument name containing the ordered batch.'},
                   'unchanged': {**deepcopy(_unchanged), 'minItems': 1}},
    'required': ['argument', 'unchanged']}
NAMED_CHECKS_SCHEMA['description'] = (
    'Model-supplied named examples for the actual saved function. Each success case needs arguments and '
    'expected; each error case needs arguments and raises. Omit inapplicable fields. JSON only, '
    'at most 32 KiB, depth eight (root zero), sixteen cases. No code or replacement function.')

_ACTIONS = {
    'invalid_named_case': 'Use arguments and exactly one of expected or raises; include only applicable fields.',
    'invalid_named_arguments': 'arguments must be an object keyed by actual saved-function parameter names.',
    'named_argument_sets_differ': 'Use the same supplied argument names in every case; omit a defaulted argument uniformly.',
    'invalid_named_reference': 'same_as and unchanged must refer to supplied argument names; list each unchanged name once.',
    'invalid_named_atomic': 'atomic_batch needs argument and nonempty unchanged names referencing supplied arguments; the batch cannot be an unchanged state argument.',
}


def _convert(spec):
    if type(spec) is str:
        indexed.require(len(spec) <= indexed.MAX_BYTES, 'spec_too_large')
        try:
            indexed.require(len(spec.encode('utf-8')) <= indexed.MAX_BYTES, 'spec_too_large')
            spec = json.loads(spec, object_pairs_hook=indexed._unique_object,
                              parse_constant=indexed._reject_constant)
        except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as error:
            if isinstance(error, CheckSpecError):
                raise
            raise CheckSpecError('invalid_json') from None
    indexed._json_shape(spec)
    try:
        encoded = json.dumps(spec, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        indexed.require(len(encoded.encode('utf-8')) <= indexed.MAX_BYTES, 'spec_too_large')
    except (UnicodeError, ValueError, OverflowError) as error:
        if isinstance(error, CheckSpecError):
            raise
        raise CheckSpecError('invalid_json_encoding') from None
    indexed.require(type(spec) is dict, 'spec_must_be_object')
    indexed.require(set(spec) <= {'module_path', 'function', 'cases', 'atomic_batch'}
        and {'module_path', 'function', 'cases'} <= set(spec), 'invalid_spec_fields')
    # Preserve the original path/function validation before selected case-data
    # errors become host feedback, without reading or importing the target.
    indexed._normalize({'module_path': spec['module_path'], 'function': spec['function'],
                        'cases': [{'args': [], 'expected': None}]})
    cases = spec['cases']
    indexed.require(type(cases) is list and 1 <= len(cases) <= indexed.MAX_CASES, 'invalid_case_count')
    converted = {'module_path': spec['module_path'], 'function': spec['function'], 'cases': []}
    names = None
    for case in cases:
        indexed.require(type(case) is dict and 'arguments' in case
            and ('expected' in case) != ('raises' in case), 'invalid_named_case')
        allowed = ({'arguments', 'expected', 'same_as', 'unchanged', 'expected_tuple_paths'}
                   if 'expected' in case else {'arguments', 'raises', 'unchanged'})
        indexed.require(set(case) <= allowed, 'invalid_named_case')
        arguments = case['arguments']
        indexed.require(type(arguments) is dict and all(0 < len(name) <= 128 and name.isidentifier()
            and not keyword.iskeyword(name) for name in arguments), 'invalid_named_arguments')
        current = sorted(arguments)
        if names is None:
            names = current
        indexed.require(current == names, 'named_argument_sets_differ')
        indices = {name: index for index, name in enumerate(names)}
        value = {'args': [arguments[name] for name in names]}
        value.update({key: case[key] for key in ('expected', 'raises', 'expected_tuple_paths') if key in case})
        if 'same_as' in case:
            indexed.require(type(case['same_as']) is str and case['same_as'] in indices, 'invalid_named_reference')
            value['same_as_arg'] = indices[case['same_as']]
        if 'unchanged' in case:
            unchanged = case['unchanged']
            indexed.require(type(unchanged) is list and all(type(name) is str and name in indices for name in unchanged)
                and len(set(unchanged)) == len(unchanged), 'invalid_named_reference')
            value['unchanged_args'] = [indices[name] for name in unchanged]
        converted['cases'].append(value)
    if 'atomic_batch' in spec:
        atomic = spec['atomic_batch']
        indexed.require(type(atomic) is dict and set(atomic) == {'argument', 'unchanged'}, 'invalid_named_atomic')
        argument, unchanged = atomic['argument'], atomic['unchanged']
        indices = {name: index for index, name in enumerate(names)}
        indexed.require(type(argument) is str and argument in indices and type(unchanged) is list
            and unchanged and all(type(name) is str and name in indices and name != argument for name in unchanged)
            and len(set(unchanged)) == len(unchanged), 'invalid_named_atomic')
        converted['atomic_batch'] = {'argument': indices[argument],
                                     'unchanged_args': [indices[name] for name in unchanged]}
    return converted, names


_PREFLIGHT = '''_saved_target = _target
_argument_names = NAMED_ARGUMENTS_LITERAL
_signature = inspect.signature(_saved_target)
for _case in _spec["cases"]:
    try:
        _signature.bind(**dict(zip(_argument_names, _case["args"])))
    except TypeError:
        sys.stderr.write("KOTO_CHECK_INPUT_ERROR case_argument_binding: Supply arguments by the saved function's exact parameter names, including required parameters; keep its task signature. Use the plain-script helper for positional-only parameters.\\n")
        sys.exit(2)
def _invoke_named(*_values):
    return _saved_target(**dict(zip(_argument_names, _values)))
_target = _invoke_named
'''


def compile_named_feedback_checks(spec):
    """Compile exact named data; the original host owns all target execution."""
    try:
        converted, names = _convert(spec)
        encoded = indexed._normalize(converted)
    except CheckSpecError as error:
        action = _ACTIONS.get(str(error)) or indexed._FEEDBACK_ACTIONS.get(str(error))
        if action is None:
            raise
        message = 'KOTO_CHECK_INPUT_ERROR ' + str(error) + ': ' + action + '\n'
        program = 'import sys\nsys.stderr.write(' + repr(message) + ')\nsys.exit(2)\n'
    else:
        # Reuse all assertions, source binding and bounded composition behavior.
        # A changed driver must be reviewed rather than silently losing preflight.
        indexed.require(indexed.FEEDBACK_PROGRAM.count(indexed._FEEDBACK_PREFLIGHT) == 1,
                        'named_driver_template_changed')
        program = indexed.FEEDBACK_PROGRAM.replace(indexed._FEEDBACK_PREFLIGHT, _PREFLIGHT, 1)
        replacements = {
            'NAMED_ARGUMENTS_LITERAL': repr(tuple(names)),
            'ERROR_NAMES_LITERAL': repr(tuple(sorted(indexed.ERROR_NAMES))),
            'PROBE_PLAN_LITERAL': repr(indexed._probe_plan(json.loads(encoded))),
            'SPEC_LITERAL': repr(encoded)}
        for marker in replacements:
            indexed.require(program.count(marker) == 1, 'named_driver_template_changed')
        # One pass prevents literal parameter names or values from being
        # revisited as template markers after insertion.
        program = re.sub('|'.join(replacements), lambda match: replacements[match.group()], program)
    command = 'python3 -c ' + shlex.quote(program)
    indexed.require(len(command.encode('utf-8')) <= indexed.MAX_COMMAND_BYTES, 'command_too_large')
    return command
