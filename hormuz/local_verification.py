"""Bounded observations of Python assertion syntax; never execution evidence."""
import ast
import shlex


MAX_COMMAND_BYTES = 128 * 1024
MAX_SCRIPT_BYTES = 32 * 1024
MAX_AST_NODES = 4096
UNITTEST_ASSERTIONS = frozenset({
    'assertEqual', 'assertNotEqual', 'assertTrue', 'assertFalse', 'assertIs', 'assertIsNot',
    'assertIsNone', 'assertIsNotNone', 'assertIn', 'assertNotIn', 'assertIsInstance',
    'assertNotIsInstance', 'assertRaises', 'assertRaisesRegex', 'assertWarns', 'assertWarnsRegex',
    'assertLogs', 'assertNoLogs', 'assertAlmostEqual', 'assertNotAlmostEqual', 'assertGreater',
    'assertGreaterEqual', 'assertLess', 'assertLessEqual', 'assertRegex', 'assertNotRegex',
    'assertCountEqual', 'assertMultiLineEqual', 'assertSequenceEqual', 'assertListEqual',
    'assertTupleEqual', 'assertSetEqual', 'assertDictEqual',
})


def _test_case_constructor(value, modules, classes):
    if not isinstance(value, ast.Call):
        return False
    function = value.func
    return (isinstance(function, ast.Name) and function.id in classes
            or isinstance(function, ast.Attribute) and function.attr == 'TestCase'
            and isinstance(function.value, ast.Name) and function.value.id in modules)


def has_python_assertions(command):
    """Observe assertion intent in a simple ``python3 -c`` command.

    Unknown shell forms stay conservative. An assertion may be trivial,
    unreachable or insufficient: this says nothing about execution or coverage.
    """
    if type(command) is not str or not command or '\x00' in command:
        return False
    try:
        if len(command.encode('utf-8')) > MAX_COMMAND_BYTES:
            return False
    except UnicodeEncodeError:
        return False
    # Shell substitution is outside this deliberately small command grammar,
    # including harmless literal occurrences which cannot be proved here.
    if '$' in command or '`' in command:
        return False
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        lexer.commenters = ''
        arguments = list(lexer)
        if len(arguments) != 3 or arguments[:2] != ['python3', '-c']:
            return False
        source = arguments[2]
        if len(source.encode('utf-8')) > MAX_SCRIPT_BYTES:
            return False
        tree = ast.parse(source)
    except (ValueError, SyntaxError, UnicodeError, RecursionError):
        return False
    nodes = []
    for index, node in enumerate(ast.walk(tree)):
        if index >= MAX_AST_NODES:
            return False
        nodes.append(node)
    if any(isinstance(node, ast.Assert) for node in nodes):
        return True
    modules, classes = set(), set()
    for node in nodes:
        if isinstance(node, ast.Import):
            modules.update(alias.asname or alias.name for alias in node.names if alias.name == 'unittest')
        elif isinstance(node, ast.ImportFrom) and node.module == 'unittest' and node.level == 0:
            classes.update(alias.asname or alias.name for alias in node.names if alias.name == 'TestCase')
    # A name assigned or deleted anywhere is ambiguous. Do not attempt to
    # interpret Python scope, control flow or receiver values.
    assigned = {node.id for node in nodes if isinstance(node, ast.Name)
                and isinstance(node.ctx, (ast.Store, ast.Del))}
    modules.difference_update(assigned)
    classes.difference_update(assigned)
    return any(isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        and node.func.attr in UNITTEST_ASSERTIONS
        and _test_case_constructor(node.func.value, modules, classes) for node in nodes)
