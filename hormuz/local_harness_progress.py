"""Model-facing observations of pinned native tools; never task-quality evidence."""
import re

from .compaction_formats import strict_json_loads


GUIDANCE = '''Local coding protocol (subordinate to existing host and repository instructions):
Apply this protocol only to requested coding edits. For other tasks, answer the
original request without inventing edits or checks.
Complete the original requested repair using only declared host tools. Read the
source, derive short executable assertions from the full specification, and run
them before editing. A real failed assertion guides the focused edit. Import the
actual saved function and invoke your checks; defining tests is not executing them.
For ordered outputs, exercise several boundaries and values recurring later.
For no-mutation-on-error requirements, copy state before a valid-then-invalid
batch, require the specified exception, and assert unchanged state AFTER the
exception handler. Include repeated operations on one item. Catching an exception
and printing it does not check rollback. For atomic multi-step updates, validate
the entire operation against private proposed state, then commit only after all
validation succeeds. Validating and mutating one step at a time can leave partial
changes on a later failure. Cover supported unhashable values and
missing-versus-None distinctions when required by the task.
After the latest edit, rerun assertions and inspect their actual results. Repair
the implementation without weakening the specification or existing checks.
Keep checks compact. Do not repeatedly reread or edit without checking behavior.
Finish only when the task is complete, or report the actual blocker. A future
plan is not a completed repair. Native patch hunks use plain @@, without diff
line-number ranges, and correctly prefixed context/removal/addition lines.'''

_COMMAND = re.compile(
    r'\AChunk ID: [A-Za-z0-9_-]{1,64}\nWall time: \d{1,9}(?:\.\d{1,9})? seconds\n'
    r'Process (?:exited with code (?P<exit>-?\d{1,6})|running with session ID (?P<session>\d{1,20}))\n'
    r'(?:Original token count: \d{1,12}\n)?(?:Output|Final output):\n')
_PATCH = re.compile(r'\AExit code: 0\nWall time: \d+(?:\.\d+)? seconds\nOutput:\n')
_SHELL_PARSE = re.compile(r'(?m)^(?:/bin/)?(?:zsh|bash|sh):[^\n]*(?:parse error|syntax error|unmatched)')
_PYTHON_SYNTAX = re.compile(r'(?m)^SyntaxError:')

REPEATED_PATCH_ADVICE = '''The identical malformed patch has failed more than once.
Change approach through another declared host editing tool only if host instructions
allow it. Use its exact argument names and keep writes inside the permitted workspace.
Do not repeat the unchanged failed patch or relax sandbox permissions. Respect the
inline Python command format above; avoid shell temporary-file constructions when
temporary directories are excluded. Check the saved code and report actual results.'''


def progress_snapshot(items, declarations):
    """Count correlated host envelopes, ignoring program text as status metadata."""
    state = {'native_patches_saved': 0, 'native_patches_rejected': 0,
             'completed_commands_since_last_native_patch': 0, 'last_command_exit': None,
             'pending_sessions': 0, 'shell_parse_failure': False, 'python_syntax_failure': False,
             'repeated_command_completions': 0}
    calls, consumed, pending = {}, set(), set()
    commands = {}
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get('call_id'), str) or not item['call_id']:
            continue
        call_id = item['call_id']
        if item.get('type') == 'function_call' and call_id not in consumed and call_id not in calls:
            declaration = declarations.get(item.get('name'), {})
            if not isinstance(declaration, dict):
                continue
            name, kind = declaration.get('name'), declaration.get('type')
            if not (name == 'apply_patch' and kind == 'custom'
                    or name in {'exec_command', 'write_stdin'} and kind == 'function'):
                continue
            try:
                arguments = strict_json_loads(item.get('arguments', ''))
            except (ValueError, TypeError):
                continue
            if isinstance(arguments, dict):
                calls[call_id] = (name, arguments)
        elif item.get('type') == 'function_call_output' and call_id in calls:
            name, arguments = calls.pop(call_id)
            consumed.add(call_id)
            output = item.get('output')
            if name == 'apply_patch':
                if isinstance(output, str) and _PATCH.match(output):
                    state['native_patches_saved'] += 1
                    state['completed_commands_since_last_native_patch'] = 0
                    state['last_command_exit'], state['shell_parse_failure'] = None, False
                    state['python_syntax_failure'] = False
                    state['repeated_command_completions'] = 0
                    commands.clear()
                elif isinstance(output, str) and output.startswith('apply_patch verification failed:'):
                    state['native_patches_rejected'] += 1
                continue
            session = arguments.get('session_id')
            if name == 'write_stdin':
                if type(session) is not int or str(session) not in pending:
                    continue
            match = _COMMAND.match(output) if isinstance(output, str) else None
            if match is None:
                state['last_command_exit'], state['shell_parse_failure'] = None, False
                state['python_syntax_failure'] = False
                state['repeated_command_completions'] = 0
                continue
            if name == 'write_stdin':
                if match['session'] is not None and match['session'] != str(session):
                    continue
            if match['session'] is not None:
                pending.add(match['session'])
                state['last_command_exit'], state['shell_parse_failure'] = None, False
                state['python_syntax_failure'] = False
                state['repeated_command_completions'] = 0
            else:
                if name == 'write_stdin':
                    pending.remove(str(session))
                code = int(match['exit'])
                state['completed_commands_since_last_native_patch'] += 1
                state['last_command_exit'] = code
                state['shell_parse_failure'] = code != 0 and bool(_SHELL_PARSE.search(output[match.end():]))
                state['python_syntax_failure'] = code != 0 and bool(_PYTHON_SYNTAX.search(output[match.end():]))
                command = arguments.get('cmd') if name == 'exec_command' else None
                state['repeated_command_completions'] = 0
                if isinstance(command, str):
                    commands[command] = commands.get(command, 0) + 1
                    state['repeated_command_completions'] = commands[command]
    state['pending_sessions'] = len(pending)
    return state


def progress_checkpoint(items, declarations, *, single_line=False, typed_checks=False, feedback_checks=False):
    """Static advice plus bounded numbers, never copied program output or authority."""
    state = progress_snapshot(items, declarations)
    last = 'unknown' if state['last_command_exit'] is None else str(state['last_command_exit'])
    message = ('Local coding progress checkpoint (subordinate to host and repository instructions):\n'
        'Apply to requested coding edits only; follow other tasks without inventing edits or checks.\n'
        f"Native patches reported saved: {state['native_patches_saved']}; rejected: {state['native_patches_rejected']}.\n"
        f"Completed commands since the last native patch: {state['completed_commands_since_last_native_patch']}; "
        f"latest command exit: {last}; pending sessions: {state['pending_sessions']}.\n"
        'These observations are not proof of correctness or that assertions ran.\n')
    if state['pending_sessions']:
        message += 'Inspect the pending command through the declared host session tool before finishing.\n'
    elif state['shell_parse_failure']:
        message += ('The latest nonzero command result reports a shell parse error; intended Python checks are not established. '
                    'Fix the command format; do not repeat the unchanged failed command.\n')
    elif state['python_syntax_failure']:
        message += (('The latest nonzero command reports a Python SyntaxError; intended assertions did not run. '
                    'Inspect the saved module and repair its syntax when needed. Use the declared Python check helper '
                    'for cases against the saved function when available. Do not redefine the function in an inline check '
                    'or repeat the unchanged failed command.\n') if typed_checks else
                    ('The latest nonzero command reports a Python SyntaxError; intended assertions did not run. '
                    'Inspect whether the error is in the saved module or the inline check and fix that source. '
                    'For inline exception checks, use single-line callable unittest assertions below instead of compound statements. '
                    'Do not repeat the unchanged failed command.\n') if single_line else
                    ('The latest nonzero command reports a Python SyntaxError; intended assertions did not run. '
                    'Python compound statements (try/except/else, for, if, def) must start on their own lines '
                    'with indented bodies. Never put try after a semicolon. Use actual newlines. '
                    'Do not repeat the unchanged failed command.\n'))
    elif state['last_command_exit'] not in (None, 0):
        message += ('Inspect the actual command error. Fix command/permission problems first; '
                    'a real assertion failure guides a focused code repair and another check.\n')
    elif state['repeated_command_completions'] > 1:
        message += (f"The latest identical command has completed {state['repeated_command_completions']} times since the last native patch. "
                    'Do not repeat the unchanged successful example. Check untested failure paths and every original requirement; '
                    'if already covered, finish with actual results. Repetition adds no new coverage.\n')
    elif state['native_patches_saved'] and not state['completed_commands_since_last_native_patch']:
        message += 'The saved native patch has no completed command after it. Run assertions before another edit or final answer.\n'
    elif not state['native_patches_saved']:
        message += 'Read the source, then derive and execute assertions before editing; cover the complete original specification.\n'
    if typed_checks:
        message += '''When the declared Python check helper is available, give it structured cases for
the actual saved module_path and function. The helper compiles your cases to an
ordinary host command; the host retains execution, sandboxing and approval.
Provide args, optional kwargs, and either expected or raises for every case.
Use unchanged_args for required state preservation and same_as_arg for required
return identity. For an atomic batch of ordered operations whose concatenation
must preserve sequential rejection, also declare atomic_batch with
the batch argument index and state argument indices in unchanged_args. Supply
matching initial state with a state-changing success and a rejection; the helper
tests bounded combinations and repetitions of your supplied batches for late
failure. A missing late-failure case is incomplete coverage; improve the cases.
When repeated operations can exceed a cumulative limit, include a valid batch
large enough that repeating it twice or three times must reject. Also supply an
explicit valid-then-invalid repeated-item batch and require unchanged state.
For ordered outputs, include adjacent boundaries, empty input and values recurring
later. For equality over unhashable values, include equal lists and dictionaries
when supported. Derive all examples from the original specification.
Do not redefine the implementation inside a check or weaken requirements after
failure. Read the actual result, repair the saved implementation, and run the same
checks after the last edit. A saved patch or a normal printout is not verification.
If the helper is absent, use the available native tools within host permissions.
Once all original requirements are covered, finish with the actual results or
the concrete blocker. Do not repeat successful checks or offer to test later.'''
        if feedback_checks:
            message += '''
Check input format carefully: args contains one value per positional parameter.
For f(items), passing a list needs args=[["x", "y"]], not args=["x", "y"].
For f(state, batch), args has two entries. Alternatively use args=[] and kwargs
with the exact parameter names. Use only applicable optional fields and a small
set of focused cases; sixteen is a maximum, not a target.
A check-input error means repair the case data while preserving the requested
function signature. An expectation mismatch requires checking the expected value
against the original specification before editing code. Do not make a correct
implementation match an incorrect example. Selected invalid case data produce
an actual failing host command without loading the target; repair the input and
run the checks again. This feedback is not correctness or qualification proof.'''
        return message
    if single_line:
        message += '''Use python3 for Python. Prefer short single-line commands with semicolon-separated
simple statements. Avoid multiline scripts, backslash-n encoding and compound
statements in inline checks. Use the standard-library callable assertRaises for
expected exceptions; it invokes the real function and fails if the error is absent.
For atomic behavior, assert the entire state after assertRaises returns. FORMAT
ONLY: replace every placeholder, import the actual saved function and define the
real state and invalid batch from the original specification:
python3 -c 'import copy, unittest; from YOUR_MODULE import function; state = YOUR_STATE; invalid_batch = YOUR_INVALID_BATCH; before = copy.deepcopy(state); unittest.TestCase().assertRaises(RequiredError, function, state, invalid_batch); assert state == before'
Cover a valid step before failure and repeated operations exceeding a limit when
required. Use the specified exception. Also check successful results, boundaries,
ordering and supported value types. Several short focused commands are fine.
Pass cmd directly to the declared host tool; do not add another shell wrapper or
temporary-file construction. A print or one normal example is not verification.
Repair actual assertion failures and rerun checks on the latest saved code. Once
all requirements are covered, finish with actual results instead of repeating
the same command or offering future next steps.'''
        return message
    message += '''Use python3 for Python. Import the actual saved function, execute compact
assertions, and check failure invariants after catching the expected exception.
For inline checks, use literal newlines in a single-quoted Python command, with
double quotes for Python strings. FORMAT ONLY: replace the placeholder body:
python3 -c '
YOUR_REAL_IMPORTS_AND_EXECUTABLE_ASSERTIONS
'
Do not wrap that command in another shell or put literal backslash-n text in it.
Do not use a shell here-document when the host excludes temporary directories.
For no-mutation-on-error tasks, adapt and execute this pattern with real imports,
inputs, function and specified exception. Keep compound statements on new lines:
    before = copy.deepcopy(state)
    try:
        function(state, invalid_batch)
    except RequiredError:
        pass
    else:
        raise AssertionError("expected rejection")
    assert state == before
The invalid batch must have a valid step before failure and repeated operations
exceeding a limit when relevant. Import copy. A normal success example cannot
establish these failure invariants.
An exit-zero print example is not proof. Confirm assertions cover the latest saved
edit and the original task. If they pass, finish with actual results; if they fail,
repair and rerun. Complete the repair now instead of offering future next steps.'''
    return message
