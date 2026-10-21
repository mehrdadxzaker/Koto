"""Versioned request shaping; the host retains instructions and execution.

Inspired by Open Interpreter's Apache-2.0 Qwen request builder at commit
ac1fcc8fe57aba51fcc3c79afd57a0883237fe87, core/src/harness/qwen_code.rs.
This is an independent, transport-only adaptation, not its complete harness.
"""
from .compaction_formats import strict_json_loads
from .local_harness_progress import GUIDANCE as V4_GUIDANCE, REPEATED_PATCH_ADVICE as V4_REPEATED_PATCH, progress_checkpoint, progress_snapshot
import json
import re

CAPABILITY = 'qwen_code_v1'
PROFILE = 'qwen-code.v1'
V2_CAPABILITY = 'qwen_code_v2'
V2_PROFILE = 'qwen-code.v2'
V3_CAPABILITY = 'qwen_code_v3'
V3_PROFILE = 'qwen-code.v3'
V4_CAPABILITY = 'qwen_code_v4'
V4_PROFILE = 'qwen-code.v4'
V5_CAPABILITY = 'qwen_code_v5'
V5_PROFILE = 'qwen-code.v5'
V6_CAPABILITY = 'qwen_code_v6'
V6_PROFILE = 'qwen-code.v6'
V7_CAPABILITY = 'qwen_code_v7'
V7_PROFILE = 'qwen-code.v7'
V8_CAPABILITY = 'qwen_code_v8'
V8_PROFILE = 'qwen-code.v8'
V9_CAPABILITY = 'qwen_code_v9'
V9_PROFILE = 'qwen-code.v9'
V10_CAPABILITY = 'qwen_code_v10'
V10_PROFILE = 'qwen-code.v10'
PROFILES = {CAPABILITY: PROFILE, V2_CAPABILITY: V2_PROFILE, V3_CAPABILITY: V3_PROFILE,
            V4_CAPABILITY: V4_PROFILE, V5_CAPABILITY: V5_PROFILE, V6_CAPABILITY: V6_PROFILE,
            V7_CAPABILITY: V7_PROFILE, V8_CAPABILITY: V8_PROFILE, V9_CAPABILITY: V9_PROFILE,
            V10_CAPABILITY: V10_PROFILE}
MODEL = 'Qwen3-14B-Q4_K_M'
V8_GUIDANCE = '''Local coding protocol (subordinate to existing host and repository instructions):
Complete the requested repair through the declared host tools. For other tasks,
answer the original request without inventing edits or checks.
Read the source and every requirement. For Python verification, use the declared
Python script helper (script parameter) when offered. Its script is ordinary
Python with real newlines, not a shell command or JSON test cases. Import and
call the saved function; do not redefine the implementation in a check. Use
assertions, including errors and boundaries.
If an error must leave state unchanged, validate all operations using private
proposed state before committing any mutation. Test a valid step followed by a
failing step, cumulative repeated operations, and the complete state after the
exception. If values may be unhashable, compare them by equality rather than
using a set or dictionary as the sole deduplication mechanism.
Run focused checks, repair the actual saved code, then rerun the same checks
after the last edit. Inspect actual host results. A printout, saved patch, test
definition, or failed command does not establish passing assertions. Do not
weaken the specification or existing checks. Finish with the repair and checks
that actually ran, or the concrete blocker. Native patch hunks use plain @@
and correctly prefixed lines, without unified-diff line-number ranges.'''

V9_GUIDANCE = V8_GUIDANCE.replace('''For Python verification, use the declared
Python script helper (script parameter) when offered. Its script is ordinary
Python with real newlines, not a shell command or JSON test cases. Import and
call the saved function; do not redefine the implementation in a check. Use
assertions, including errors and boundaries.''', '''For saved Python functions, prefer the declared function-case helper when
offered. Supply small cases with an arguments object keyed by the saved function's
parameter names and expected values or exceptions,
plus required identity and state-preservation checks. Opt into batch composition
only when the original specification requires its sequential-rejection property.
The plain Python script helper remains available for checks case data cannot
express. Import the saved function; do not redefine it in a check. Let assertions
and unexpected exceptions fail the command rather than catching and printing them.''')


V10_GUIDANCE = '''Local coding protocol (subordinate to host, repository and user instructions):
For a requested repair, read the saved source and every requirement, make a focused
edit through declared tools, and verify the saved implementation.
For other tasks, answer the original request without inventing edits or checks.
For required atomic mutation, make a private working copy of the mutable state.
Apply every operation in order against that evolving copy, validating cumulative
effects there. Commit to the original state only after the entire operation succeeds; preserve required
object identity. Check a valid step followed by a specified error, repeated
operations whose cumulative effect exceeds a limit, and the entire unchanged
original state after the exception.
For supported unhashable keys, retain encountered keys and compare by equality.
Hashing, sorting and serialization are not substitutes for required equality.
Distinguish a missing required key from a present None: check key presence
explicitly instead of inferring absence with get(..., None).
Use one compact Python assertions script that imports the saved implementation,
including its required imports, and covers the original success, error, ordering,
identity and state requirements. Run it before editing, then rerun the identical
checks after the last edit. Correct import or check errors and obtain actual
successful assertions before reporting success. Let failed assertions and unexpected
exceptions fail the command instead of catching and printing them. Preserve original requirements
and existing checks. Report actual results or the concrete blocker.'''


def _last_failed_command_output(items, declarations, state):
    if state['last_command_exit'] in (None, 0):
        return None
    for index in range(len(items) - 1, -1, -1):
        item = items[index]
        if not isinstance(item, dict):
            continue
        if item.get('type') == 'function_call':
            return None
        if item.get('type') == 'function_call_output':
            output = item.get('output')
            if not isinstance(output, str):
                return None
            # Only this result incrementing the correlated native completion
            # counter can supply feedback; never trust a pasted traceback.
            before = progress_snapshot(items[:index], declarations)
            if state['completed_commands_since_last_native_patch'] > before['completed_commands_since_last_native_patch']:
                return output
            return None
    return None


def _script_checkpoint(items, declarations, *, verification_sensitive=False, state=None, compact=False):
    if state is None:
        state = progress_snapshot(items, declarations, include_attempts=verification_sensitive,
                                  include_verification=verification_sensitive)
    last = state['last_command_exit']
    failure = _last_failed_command_output(items, declarations, state)
    python_guidance = (
        'For Python, prefer the declared function-case helper for small explicit examples against the saved function, '
        'including required identity, rollback and supported value types. Its batch composition is opt-in only when '
        'the original specification requires sequential rejection. Use the plain-script helper for other assertions. '
        if verification_sensitive else
        'For Python, the declared Python script helper (script parameter) takes one string with actual newlines; use normal Python calls '
        'and assertions against the saved module, including required rollback and supported value types. ')
    message = (('Local coding observations (subordinate to host and repository instructions):\n'
        f"Native patches saved: {state['native_patches_saved']}; rejected: {state['native_patches_rejected']}; "
        f"latest command exit: {last if last is not None else 'unknown'}; "
        f"pending sessions: {state['pending_sessions']}.\n"
        'These observations do not prove task correctness. Inspect a pending host session before finishing.')
        if compact else ('Local coding checkpoint (subordinate to host and repository instructions):\n'
        f"Native patches saved: {state['native_patches_saved']}; rejected: {state['native_patches_rejected']}; "
        f"latest command exit: {last if last is not None else 'unknown'}; "
        f"pending sessions: {state['pending_sessions']}.\n"
        'These counts do not prove correctness or that assertions executed. Inspect actual tool feedback. '
        f'{python_guidance}'
        'After a failure, fix its cause and rerun; do not repeat an unchanged failing command. '
        'After the last edit, obtain passing assertions before reporting success. '
        'If a command is still running, inspect its declared host session before finishing.'))
    if (verification_sensitive and state['native_patches_saved']
            and state['last_attempt_command_succeeded'] and not state['pending_sessions']):
        intent = state['latest_command_verification_intent']
        message += ('\nRecognized assertion intent in the latest successful command: '
                    + ('observed.' if intent else 'not observed.'))
        if not intent:
            message += (' Obtain passing assertions against the latest saved implementation.' if compact else
                ' Run compact assertions against the saved function covering the original success, failure, '
                'state-preservation, identity and supported-value requirements. A printed normal example leaves those checks open. '
                'Use the declared Python script helper for inline assertions or the repository test runner when appropriate.')
    if failure is not None and state['python_syntax_failure']:
        message += ('\n\nPython syntax recovery: The latest command did not parse, so its intended assertions did not run. '
            'Use the declared Python script helper with real newlines. '
            'Compound statements such as try, except, for, and if need their own lines and indented bodies; '
            'do not put try after a semicolon. Correct the syntax before rerunning; do not repeat the same failed command.')
    elif failure is not None and last == 127:
        message += ('\n\nCommand lookup recovery: The command was unavailable, so it did not establish passing checks. '
            'For Python, use python3 or the declared Python script helper. '
            'Inspect the actual missing command and use an available declared host tool within existing permissions.')
    if (verification_sensitive and failure is not None
            and re.search(r'(?m)^KOTO_CHECK_INPUT_ERROR ', failure)):
        message += (('\n\nCheck input recovery: The previous command rejected its inputs. '
            'Correct calls against the saved function signature and original requirements; '
            'rerun the Python assertions through declared host tools. This error is not a correctness result.')
            if compact else ('\n\nCheck input recovery: The check driver rejected the supplied case data; '
            'that feedback does not establish passing function assertions. Correct your check data against '
            'the original requirements and keep the saved task signature. Use named arguments exactly as '
            'declared, or use the plain Python script fallback to call the saved function directly. '
            'Do not repeat unchanged invalid check data or treat this input error as an implementation defect.'))
    if failure is not None and re.search(r'(?m)^AssertionError(?::|\r?$)', failure):
        if verification_sensitive:
            message += ('\n\nAssertion failure checkpoint: Compare the actual result and your expected value with the original specification. '
                'A newly authored check can add an assumption not required by the original specification. '
                'Correct that unsupported assumption in your own check while preserving every original requirement and existing check. '
                'Repair the saved implementation when it violates a required result. Include actual and expected values in compact failure diagnostics.')
            if re.search(r'(?m)^KeyError:', failure):
                message += ('\nPython KeyError formats its argument with repr, which can add quotation marks to str(error). '
                    'When the task specifies only the exception type, import unittest and use TestCase().assertRaises(KeyError, callable, ...). '
                    'Use error.args for an argument-content requirement; preserve an explicitly specified formatted-message requirement. '
                    'Revise the failing check against that contract before rerunning it.')
        else:
            message += ('\n\nAssertion failure checkpoint: Compare actual and expected values against the original specification. '
                'Use compact assertions that include both values in failure output. '
                'An assertion can expose an implementation defect or a mistaken expectation. '
                'Change a test only when its expectation contradicts the original specification; otherwise repair the saved code. '
                'Changing quoting or repeating the same expectation does not resolve a value mismatch. '
                'Keep check scripts and the final status concise.')
    return message
GUIDANCE = '''Local coding guidance (subordinate to all existing host and repository instructions):
Read the relevant source and nearby tests before editing. Follow existing project
conventions and verify available dependencies. Identify all required return values,
ordering, mutation, boundaries and exceptions. Make a focused change covering each
requirement. Use only the tools declared by the host, with their exact parameter
names; do not invent tools or claim an edit without a successful tool result.
After editing, run the relevant checks through an available host tool. Reconcile
failures with the specification before changing code or expectations. Do not repeat
an unchanged failed call. Once the latest edit passes the relevant checks, finish
with a concise factual status, including checks that could not run.'''

V2_GUIDANCE = '''Local verification protocol (subordinate to all existing host and repository instructions):
For a requested coding edit, complete it through the existing host tools. For
other tasks, follow the original request without inventing edits or checks.
For coding work, do not stop at a plan
or a claim that the implementation works. Use only declared tools and parameters.
1. Read the relevant source and specification. Turn every requirement into a short
executable assertion, including boundaries, ordering, missing inputs and errors.
2. Check the available interpreter or test runner through a host tool. For Python,
try python3; do not assume the command python exists. If only the source file may
be changed, run assertions in an inline script instead of adding test files.
3. Exercise failure paths before editing. If failure must leave state unchanged,
save a copy, put a failing operation after a valid operation, and assert the full
state is unchanged after the exception. Cover repeated operations on the same
item. Check equality separately from hashing: when unhashable values are allowed,
include equal list or dictionary values. Distinguish a missing key from a present
key whose value is None. Use the task specification, not assumptions about types.
4. Execute those assertions against the current implementation and inspect the
actual failure. Then make the focused edit and execute the assertions again after
the last edit. Also run existing relevant tests when available. Repair failures
in the implementation; do not weaken requirements or existing checks.
5. A saved edit is not verification. Before a success report, obtain a successful
host tool result for the final implementation's assertions. If verification is
blocked or incomplete, say so and report the actual command and failure. Finish
with the edit and checks that actually ran, not future intentions.'''

V2_CHECKPOINT = '''Local verification protocol checkpoint (subordinate to all host and repository instructions):
Apply this checkpoint to requested coding edits; follow other tasks as requested.
Use the declared tools. If applying a native patch, follow its exact grammar:
*** Begin Patch, *** Update File: path, then @@ without unified-diff line numbers.
Every hunk line starts with a space for context, - for removal, or + for addition;
finish with *** End Patch. Never send an unprefixed source line in a hunk.
Before reporting success, execute compact assertions against the latest saved
code through a host tool (python3 for Python). For required atomic behavior, test
a valid step followed by a failing step and unchanged original state, including
repeated items. For equality supporting unhashable values, test equal lists and
dictionaries. Inspect actual failures, repair the code, and rerun the assertions.
For required no-mutation-on-error behavior, adapt this assertion pattern to the
task and execute it, including a batch whose repeated operations exceed a limit:
    before = copy.deepcopy(state)
    try:
        function(state, invalid_batch)
    except RequiredError:
        pass
    else:
        raise AssertionError("expected rejection")
    assert state == before
Use the real function, inputs and specified exception; import copy if needed.
A printout of a normal example is not verification. Use assert to check specified
results and failure invariants. Perform requested checks within host permissions;
do not end by offering to test later. Report actual results or a concrete blocker.'''

V3_PATCH_RECOVERY = '''Native patch recovery (subordinate to all host instructions):
The host rejected a native apply_patch containing a unified-diff range header.
Do not repeat the rejected patch or reread the unchanged file to fix this syntax.
Use a plain @@ on its own line. This is a complete FORMAT example only; use the
actual file, context and required edit from the task:
*** Begin Patch
*** Update File: path/to/file.py
@@
-old
+new
*** End Patch
Keep the existing host tool's exact argument names. After the successful edit,
execute the task's assertions through an available host tool before finishing.'''

V3_REPEATED_PATCH = '''The identical malformed patch has already failed more than once.
Change approach through another declared host editing tool if the host instructions
allow it. For example, an available exec_command takes cmd and can write the
required complete file with a safely quoted heredoc. Use only available tools and
stay inside the permitted workspace. Do not repeat the rejected patch again.
Then execute the assertions with python3 for Python, inspect the result, and fix
any failure before reporting success. If a later host tool already saved and
verified the edit, report those actual results. If no allowed approach exists,
report it.'''

V6_REPEATED_PATCH = '''The identical malformed patch has failed more than once.
Use a correctly formed native patch or another declared host editing tool within
host permissions. Do not repeat the rejected patch or relax the sandbox. Check
the saved function with the declared Python check helper when available; follow
the actual result before reporting completion.'''


def _patch_recovery(items, declarations, *, repeated_advice=V3_REPEATED_PATCH, latest_only=False, state=None):
    """Derive advice from correlated native feedback; never repair tool arguments."""
    if latest_only:
        if state is None:
            state = progress_snapshot(items, declarations, include_attempts=True)
        if state['pending_sessions'] or state['unresolved_tool_calls']:
            return ''
        events = [item for item in items if not (isinstance(item, dict)
            and (item.get('type') in {'message', 'reasoning'} or item.get('type') is None
                 and item.get('role') in {'system', 'developer', 'user', 'assistant'}))]
        latest = events[-1] if events else None
        call = next((item for item in reversed(events) if isinstance(item, dict)
                     and item.get('type') == 'function_call'), None)
        if (not isinstance(latest, dict) or latest.get('type') != 'function_call_output'
                or call is None or call.get('call_id') != latest.get('call_id')):
            return ''
        declaration = declarations.get(call.get('name'), {})
        if declaration.get('type') != 'custom' or declaration.get('name') != 'apply_patch':
            return ''
        if sum(isinstance(item, dict) and item.get('type') == 'function_call_output'
               and item.get('call_id') == call.get('call_id') for item in events) != 1:
            return ''
        output = latest.get('output')
        if (isinstance(output, str) and output.startswith('apply_patch verification failed:')
                and 'invalid hunk' in output):
            return ('\n\nNative patch input recovery: The host rejected the patch format; no edit is established. '
                'Prefer the declared text replacement helper when offered: supply the relative path, exact old text '
                'and desired new text, without patch headers or line prefixes. It compiles a native patch for the '
                'host to validate and execute with its existing permissions. Otherwise use plain @@ and prefix every '
                'context/removal/addition line correctly. Do not repeat the unchanged rejected patch.')
    calls, failures = {}, {}
    repeated = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get('type') == 'function_call':
            declaration = declarations.get(item.get('name'), {})
            if (declaration.get('type') == 'custom' and declaration.get('name') == 'apply_patch'
                    and isinstance(item.get('call_id'), str) and item['call_id']):
                calls[item.get('call_id')] = strict_json_loads(item['arguments']).get('input')
        elif (item.get('type') == 'function_call_output' and isinstance(item.get('call_id'), str)
              and item['call_id'] in calls):
            patch = calls.pop(item['call_id'])
            output = item.get('output')
            if (isinstance(patch, str) and isinstance(output, str)
                    and re.search(r'(?m)^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@', patch)
                    and 'apply_patch verification failed: Failed to find context ' in output):
                failures[patch] = failures.get(patch, 0) + 1
                repeated = failures[patch]
            else:
                # A later patch result supersedes stale recovery advice.
                failures.clear()
                repeated = 0
    if not repeated:
        return ''
    return '\n\n' + V3_PATCH_RECOVERY + ('\n\n' + repeated_advice if repeated >= 2 else '')


def profile_for_capabilities(capabilities):
    selected = [profile for capability, profile in PROFILES.items() if capability in capabilities]
    if len(selected) > 1:
        raise ValueError('ambiguous_local_harness')
    return selected[0] if selected else None


def adapt_qwen_request(value, declarations, *, profile=PROFILE, _progress=None):
    """Mutate only a private translated copy; preserve every argument value."""
    if profile not in PROFILES.values():
        raise ValueError('unsupported_local_harness')
    instructions = value.get('instructions', '')
    if not isinstance(instructions, str):
        raise ValueError('invalid_harness_instructions')
    guidance = V10_GUIDANCE if profile == V10_PROFILE else V9_GUIDANCE if profile == V9_PROFILE else V8_GUIDANCE if profile == V8_PROFILE else V4_GUIDANCE if profile in {V4_PROFILE, V5_PROFILE, V6_PROFILE, V7_PROFILE} else GUIDANCE if profile == PROFILE else V2_GUIDANCE
    value['instructions'] = instructions + '\n\n' + guidance
    for item in value.get('input', []):
        if not isinstance(item, dict) or item.get('type') != 'function_call':
            continue
        arguments = strict_json_loads(item['arguments'])
        properties = declarations[item['name']].get('parameters', {}).get('properties', {})
        ordered = {key: arguments[key] for key in properties if key in arguments}
        ordered.update(arguments)
        item['arguments'] = json.dumps(ordered, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    if profile in {V2_PROFILE, V3_PROFILE, V4_PROFILE, V5_PROFILE, V6_PROFILE, V7_PROFILE, V8_PROFILE, V9_PROFILE, V10_PROFILE} and isinstance(value.get('input'), str):
        value['input'] = [{'type': 'message', 'role': 'user', 'content': [
            {'type': 'input_text', 'text': value['input']}]}]
    if profile in {V2_PROFILE, V3_PROFILE, V4_PROFILE, V5_PROFILE, V6_PROFILE, V7_PROFILE, V8_PROFILE, V9_PROFILE, V10_PROFILE} and isinstance(value.get('input'), list):
        # A model-facing reminder, never a fabricated user message, tool result,
        # or extra agent turn. The native transcript remains an exact prefix.
        checkpoint = (_script_checkpoint(value['input'], declarations, verification_sensitive=profile in {V9_PROFILE, V10_PROFILE}, state=_progress, compact=profile == V10_PROFILE) if profile in {V8_PROFILE, V9_PROFILE, V10_PROFILE} else
                      progress_checkpoint(value['input'], declarations, single_line=profile == V5_PROFILE,
                                          typed_checks=profile in {V6_PROFILE, V7_PROFILE},
                                          feedback_checks=profile == V7_PROFILE)
                      if profile in {V4_PROFILE, V5_PROFILE, V6_PROFILE, V7_PROFILE} else V2_CHECKPOINT)
        if profile in {V4_PROFILE, V5_PROFILE, V6_PROFILE, V7_PROFILE}:
            checkpoint += _patch_recovery(value['input'], declarations,
                repeated_advice=V6_REPEATED_PATCH if profile in {V6_PROFILE, V7_PROFILE} else V4_REPEATED_PATCH)
        elif profile == V3_PROFILE:
            checkpoint += _patch_recovery(value['input'], declarations)
        elif profile in {V9_PROFILE, V10_PROFILE}:
            checkpoint += _patch_recovery(value['input'], declarations,
                repeated_advice=V6_REPEATED_PATCH, latest_only=True, state=_progress)
        value['input'].append({'type': 'message', 'role': 'developer', 'content': [
            {'type': 'input_text', 'text': checkpoint}]})
