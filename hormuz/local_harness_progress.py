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
and printing it does not check rollback. Cover supported unhashable values and
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
             'pending_sessions': 0, 'shell_parse_failure': False}
    calls, consumed, pending = {}, set(), set()
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
                continue
            if name == 'write_stdin':
                if match['session'] is not None and match['session'] != str(session):
                    continue
            if match['session'] is not None:
                pending.add(match['session'])
                state['last_command_exit'], state['shell_parse_failure'] = None, False
            else:
                if name == 'write_stdin':
                    pending.remove(str(session))
                code = int(match['exit'])
                state['completed_commands_since_last_native_patch'] += 1
                state['last_command_exit'] = code
                state['shell_parse_failure'] = code != 0 and bool(_SHELL_PARSE.search(output[match.end():]))
    state['pending_sessions'] = len(pending)
    return state


def progress_checkpoint(items, declarations):
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
    elif state['last_command_exit'] not in (None, 0):
        message += ('Inspect the actual command error. Fix command/permission problems first; '
                    'a real assertion failure guides a focused code repair and another check.\n')
    elif state['native_patches_saved'] and not state['completed_commands_since_last_native_patch']:
        message += 'The saved native patch has no completed command after it. Run assertions before another edit or final answer.\n'
    elif not state['native_patches_saved']:
        message += 'Read the source, then derive and execute assertions before editing; cover the complete original specification.\n'
    message += '''Use python3 for Python. Import the actual saved function, execute compact
assertions, and check failure invariants after catching the expected exception.
For inline checks, use literal newlines in a single-quoted Python command, with
double quotes for Python strings. FORMAT ONLY: replace the placeholder body:
python3 -c '
YOUR_REAL_IMPORTS_AND_EXECUTABLE_ASSERTIONS
'
Do not wrap that command in another shell or put literal backslash-n text in it.
Do not use a shell here-document when the host excludes temporary directories.
An exit-zero print example is not proof. Confirm assertions cover the latest saved
edit and the original task. If they pass, finish with actual results; if they fail,
repair and rerun. Complete the repair now instead of offering future next steps.'''
    return message
