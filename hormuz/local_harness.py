"""Versioned request shaping; the host retains instructions and execution.

Inspired by Open Interpreter's Apache-2.0 Qwen request builder at commit
ac1fcc8fe57aba51fcc3c79afd57a0883237fe87, core/src/harness/qwen_code.rs.
This is an independent, transport-only adaptation, not its complete harness.
"""
from .compaction_formats import strict_json_loads
from .local_harness_progress import GUIDANCE as V4_GUIDANCE, REPEATED_PATCH_ADVICE as V4_REPEATED_PATCH, progress_checkpoint
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
PROFILES = {CAPABILITY: PROFILE, V2_CAPABILITY: V2_PROFILE, V3_CAPABILITY: V3_PROFILE,
            V4_CAPABILITY: V4_PROFILE, V5_CAPABILITY: V5_PROFILE, V6_CAPABILITY: V6_PROFILE,
            V7_CAPABILITY: V7_PROFILE}
MODEL = 'Qwen3-14B-Q4_K_M'
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


def _patch_recovery(items, declarations, *, repeated_advice=V3_REPEATED_PATCH):
    """Derive advice from correlated native feedback; never repair tool arguments."""
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


def adapt_qwen_request(value, declarations, *, profile=PROFILE):
    """Mutate only a private translated copy; preserve every argument value."""
    if profile not in PROFILES.values():
        raise ValueError('unsupported_local_harness')
    instructions = value.get('instructions', '')
    if not isinstance(instructions, str):
        raise ValueError('invalid_harness_instructions')
    guidance = V4_GUIDANCE if profile in {V4_PROFILE, V5_PROFILE, V6_PROFILE, V7_PROFILE} else GUIDANCE if profile == PROFILE else V2_GUIDANCE
    value['instructions'] = instructions + '\n\n' + guidance
    for item in value.get('input', []):
        if not isinstance(item, dict) or item.get('type') != 'function_call':
            continue
        arguments = strict_json_loads(item['arguments'])
        properties = declarations[item['name']].get('parameters', {}).get('properties', {})
        ordered = {key: arguments[key] for key in properties if key in arguments}
        ordered.update(arguments)
        item['arguments'] = json.dumps(ordered, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    if profile in {V2_PROFILE, V3_PROFILE, V4_PROFILE, V5_PROFILE, V6_PROFILE, V7_PROFILE} and isinstance(value.get('input'), str):
        value['input'] = [{'type': 'message', 'role': 'user', 'content': [
            {'type': 'input_text', 'text': value['input']}]}]
    if profile in {V2_PROFILE, V3_PROFILE, V4_PROFILE, V5_PROFILE, V6_PROFILE, V7_PROFILE} and isinstance(value.get('input'), list):
        # A model-facing reminder, never a fabricated user message, tool result,
        # or extra agent turn. The native transcript remains an exact prefix.
        checkpoint = (progress_checkpoint(value['input'], declarations, single_line=profile == V5_PROFILE,
                                          typed_checks=profile in {V6_PROFILE, V7_PROFILE},
                                          feedback_checks=profile == V7_PROFILE)
                      if profile in {V4_PROFILE, V5_PROFILE, V6_PROFILE, V7_PROFILE} else V2_CHECKPOINT)
        if profile in {V4_PROFILE, V5_PROFILE, V6_PROFILE, V7_PROFILE}:
            checkpoint += _patch_recovery(value['input'], declarations,
                repeated_advice=V6_REPEATED_PATCH if profile in {V6_PROFILE, V7_PROFILE} else V4_REPEATED_PATCH)
        elif profile == V3_PROFILE:
            checkpoint += _patch_recovery(value['input'], declarations)
        value['input'].append({'type': 'message', 'role': 'developer', 'content': [
            {'type': 'input_text', 'text': checkpoint}]})
