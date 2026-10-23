"""Apply a reviewed local treatment; the host retains instructions and execution."""
import json
import re

from .compaction_formats import strict_json_loads
from .local_harness_progress import progress_checkpoint, progress_snapshot
from .local_harness_profiles import (
    CAPABILITY, PROFILE, V2_CAPABILITY, V2_PROFILE, V3_CAPABILITY, V3_PROFILE, V4_CAPABILITY, V4_PROFILE,
    V5_CAPABILITY, V5_PROFILE, V6_CAPABILITY, V6_PROFILE, V7_CAPABILITY, V7_PROFILE, V8_CAPABILITY,
    V8_PROFILE, V9_CAPABILITY, V9_PROFILE, V10_CAPABILITY, V10_PROFILE, V11_CAPABILITY, V11_PROFILE,
    V12_CAPABILITY, V12_PROFILE, V13_CAPABILITY, V13_PROFILE, V14_CAPABILITY, V14_PROFILE, V15_CAPABILITY,
    V15_PROFILE, PROFILES, MODEL, CODER_MODEL, MODELS, MODELS_BY_PROFILE, V8_GUIDANCE, V11_GUIDANCE,
    V12_GUIDANCE, V15_GUIDANCE, V9_GUIDANCE, V10_GUIDANCE, GUIDANCE, V2_GUIDANCE, V2_CHECKPOINT,
    V3_PATCH_RECOVERY, V3_REPEATED_PATCH, V4_GUIDANCE, V4_REPEATED_PATCH, V6_REPEATED_PATCH, resolve_profile)


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
        if (isinstance(output, str)
                and output.startswith('apply_patch verification failed: Failed to find expected lines in ')):
            return ('\n\nNative patch context recovery: The host could not match the supplied old lines; no edit is established. '
                'Read the current file through a declared host tool. '
                'Base the next edit on the exact saved text from that read; '
                'do not repeat the unchanged rejected context. Keep existing host permissions.')
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


def apply_profile_guidance(value, declarations, manifest, *, progress=None):
    """Shape guidance from the resolved manifest, never from version membership."""
    instructions = value.get('instructions', '')
    if not isinstance(instructions, str):
        raise ValueError('invalid_harness_instructions')
    value['instructions'] = instructions + '\n\n' + manifest.guidance
    for item in value.get('input', []):
        if not isinstance(item, dict) or item.get('type') != 'function_call':
            continue
        arguments = strict_json_loads(item['arguments'])
        properties = declarations[item['name']].get('parameters', {}).get('properties', {})
        ordered = {key: arguments[key] for key in properties if key in arguments}
        ordered.update(arguments)
        item['arguments'] = json.dumps(ordered, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    policy = manifest.checkpoint
    if policy.kind == 'none':
        return
    if isinstance(value.get('input'), str):
        value['input'] = [{'type': 'message', 'role': 'user', 'content': [
            {'type': 'input_text', 'text': value['input']}]}]
    if isinstance(value.get('input'), list):
        # A model-facing reminder; native history stays an exact prefix.
        if policy.kind == 'script':
            checkpoint = _script_checkpoint(value['input'], declarations,
                verification_sensitive=policy.verification_sensitive, state=progress, compact=policy.compact)
        elif policy.kind == 'progress':
            checkpoint = progress_checkpoint(value['input'], declarations, single_line=policy.single_line,
                typed_checks=policy.typed_checks, feedback_checks=policy.feedback_checks)
        else:
            checkpoint = V2_CHECKPOINT
        if policy.patch_recovery != 'none':
            checkpoint += _patch_recovery(value['input'], declarations,
                repeated_advice=policy.repeated_patch_advice, latest_only=policy.patch_recovery == 'latest', state=progress)
        value['input'].append({'type': 'message', 'role': 'developer', 'content': [
            {'type': 'input_text', 'text': checkpoint}]})


def adapt_qwen_request(value, declarations, *, profile=PROFILE, _progress=None):
    """Retain the earlier guidance-only interface for existing callers."""
    apply_profile_guidance(value, declarations, resolve_profile(profile), progress=_progress)
