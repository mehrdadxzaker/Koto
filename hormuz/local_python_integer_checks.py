"""Compile caller-declared integer type checks; execution stays with the host."""
from copy import deepcopy
import json
import keyword
import shlex

from . import local_python_checks as checks


MAX_POLICIES = 8
INTEGER_CHECKS_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'properties': {
        'module_path': deepcopy(checks.CHECKS_SCHEMA['properties']['module_path']),
        'function': deepcopy(checks.CHECKS_SCHEMA['properties']['function']),
        'arguments': {'type': 'object', 'additionalProperties': {},
            'description': 'A valid baseline call keyed by the saved callable parameter names.'},
        'policies': {'type': 'array', 'minItems': 1, 'maxItems': MAX_POLICIES,
            'items': {'type': 'object', 'additionalProperties': False,
                'properties': {
                    'argument': {'type': 'string', 'minLength': 1, 'maxLength': 128},
                    'subclasses': {'type': 'string', 'enum': ['reject', 'allow']},
                    'booleans': {'type': 'string', 'enum': ['reject', 'unchecked']}},
                'required': ['argument', 'subclasses', 'booleans']}}},
    'required': ['module_path', 'function', 'arguments', 'policies'],
    'description': 'Declare integer type rules from the original task and supply valid named baseline arguments. '
        'Each selected argument needs a built-in integer sample. The host checks that baseline, an int subclass '
        'with the same value, and True/False only when rejected. At most eight policies and 32 calls. '
        'These are self-checks, not independent qualification or functional answer checks.'}


_PROGRAM = '''from copy import deepcopy
from pathlib import Path
import runpy
_path = Path(_spec['module_path']).resolve()
if not _path.is_relative_to(Path.cwd().resolve()):
    raise ValueError('integer_check_path_outside_workspace')
_target = runpy.run_path(str(_path))[_spec['function']]
class _IntegerSubclass(int):
    pass
_count = 0
for _policy in _spec['policies']:
    _name = _policy['argument']
    _target(**deepcopy(_spec['arguments']))
    _count += 1
    _variants = [(_IntegerSubclass(_spec['arguments'][_name]), _policy['subclasses'] == 'reject', 'integer subclass')]
    if _policy['booleans'] == 'reject':
        _variants += [(True, True, 'True'), (False, True, 'False')]
    for _value, _reject, _label in _variants:
        _arguments = deepcopy(_spec['arguments'])
        _arguments[_name] = _value
        if _reject:
            try:
                _target(**_arguments)
            except TypeError:
                pass
            else:
                raise AssertionError('Integer policy failed: ' + _name + ' must reject ' + _label + ' with TypeError')
        else:
            _target(**_arguments)
        _count += 1
print('KOTO_INTEGER_CHECKS_OK', _count)
'''


def compile_integer_checks(spec):
    """Return one bounded native command without reading or executing the target."""
    checks.require(type(spec) is dict and set(spec) == {'module_path', 'function', 'arguments', 'policies'},
                   'invalid_integer_check_fields')
    checks._json_shape(spec)
    arguments, policies = spec['arguments'], spec['policies']
    checks.require(type(arguments) is dict and all(type(name) is str and len(name) <= 128
        and checks.IDENTIFIER.fullmatch(name) and not keyword.iskeyword(name) for name in arguments),
        'invalid_integer_check_arguments')
    # Reuse the existing path, function, JSON/depth and byte validation. The
    # expected value is a validation placeholder, never a runtime expectation.
    checks._normalize({'module_path': spec['module_path'], 'function': spec['function'],
        'cases': [{'args': [], 'kwargs': arguments, 'expected': None}]})
    checks.require(type(policies) is list and 1 <= len(policies) <= MAX_POLICIES, 'invalid_integer_policy_count')
    seen = set()
    for policy in policies:
        checks.require(type(policy) is dict and set(policy) == {'argument', 'subclasses', 'booleans'},
                       'invalid_integer_policy_fields')
        name = policy['argument']
        checks.require(type(name) is str and name in arguments and name not in seen
            and type(arguments[name]) is int, 'invalid_integer_policy_argument')
        checks.require(type(policy['subclasses']) is str and policy['subclasses'] in {'reject', 'allow'}
            and type(policy['booleans']) is str and policy['booleans'] in {'reject', 'unchecked'},
            'invalid_integer_policy')
        seen.add(name)
    try:
        encoded = json.dumps(spec, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
        checks.require(len(encoded.encode('utf-8')) <= checks.MAX_BYTES, 'spec_too_large')
    except (UnicodeError, ValueError, OverflowError) as error:
        if isinstance(error, checks.CheckSpecError):
            raise
        raise checks.CheckSpecError('invalid_json_encoding') from None
    program = 'import json\n_spec = json.loads(' + repr(encoded) + ')\n' + _PROGRAM
    command = 'python3 -c ' + shlex.quote(program)
    checks.require(len(command.encode('utf-8')) <= checks.MAX_COMMAND_BYTES, 'command_too_large')
    return command
