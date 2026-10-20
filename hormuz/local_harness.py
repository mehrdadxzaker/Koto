"""Versioned request shaping; the host retains instructions and execution.

Inspired by Open Interpreter's Apache-2.0 Qwen request builder at commit
ac1fcc8fe57aba51fcc3c79afd57a0883237fe87, core/src/harness/qwen_code.rs.
This is an independent, transport-only adaptation, not its complete harness.
"""
from .compaction_formats import strict_json_loads
import json

CAPABILITY = 'qwen_code_v1'
PROFILE = 'qwen-code.v1'
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


def adapt_qwen_request(value, declarations):
    """Mutate only a private translated copy; preserve every argument value."""
    instructions = value.get('instructions', '')
    if not isinstance(instructions, str):
        raise ValueError('invalid_harness_instructions')
    value['instructions'] = instructions + '\n\n' + GUIDANCE
    for item in value.get('input', []):
        if not isinstance(item, dict) or item.get('type') != 'function_call':
            continue
        arguments = strict_json_loads(item['arguments'])
        properties = declarations[item['name']].get('parameters', {}).get('properties', {})
        ordered = {key: arguments[key] for key in properties if key in arguments}
        ordered.update(arguments)
        item['arguments'] = json.dumps(ordered, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
