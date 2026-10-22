"""Shape one translated local request; the native transport owns execution."""
import copy
import hashlib
import json
from dataclasses import dataclass
from typing import Callable

from .local_harness import apply_profile_guidance
from .local_harness_profiles import resolve_profile
from .local_harness_progress import progress_snapshot


# Exact declarations captured from the pinned native Coding client. Other
# same-name flat tools cannot acquire the local compiler adapters.
PINNED_CODEX_0160_EXEC_SHA256 = '7ecb0f4f51b3982e36be43a9d08daa05348d7dd5f70646231b1f0f9823f40ec3'
PINNED_CODEX_0160_PATCH_SHA256 = '5947b870d79e16bddc34946a4afb6200ff14a97f8419a2d23f8e5040af9a7154'


class LocalHarnessRequestError(ValueError):
    pass


@dataclass(frozen=True)
class PreparedRequest:
    value: dict
    derived_checks: dict
    derived_compilers: dict
    compile_checks: Callable | None = None


def prepare_request(value, declarations, identities, original_tool_aliases, *, profile):
    """Prepare one private translated request using a reviewed immutable profile.

    Inputs are the transport's already translated private request and native
    identities. Compiler admission is pure: only the Coding client executes the
    restored calls. Response identities, streams and their bounds remain in the
    native transport. Resolve before mutation so an unknown profile changes nothing.
    """
    manifest = resolve_profile(profile) if profile is not None else None
    preparation = _RequestPreparation(value, declarations, identities, original_tool_aliases)
    if manifest is not None:
        preparation.apply(manifest)
    return PreparedRequest(value, preparation.derived_checks, preparation.derived_compilers,
                           getattr(preparation, 'compile_checks', None))


class _RequestPreparation:
    def __init__(self, value, declarations, identities, original_tool_aliases):
        self.value = value
        self.declarations = declarations
        self.identities = identities
        self.original_tool_aliases = original_tool_aliases
        self.derived_checks = {}
        self.derived_compilers = {}

    def apply(self, manifest):
        value = self.value
        input_was_list = isinstance(value.get('input'), list)
        reasoning = value.get('reasoning', {})
        progress = None
        if manifest.compute.effort_limits:
            budget = value['reasoning_budget_tokens']
            value['reasoning_budget_tokens'] = min(budget,
                dict(manifest.compute.effort_limits).get(reasoning.get('effort', 'medium'), 1024))
            if input_was_list or isinstance(value.get('input'), str):
                # String input becomes one ordinary user message. It has no
                # native tool observations, and does not gain list-only hints.
                progress = progress_snapshot(value['input'] if input_was_list else [], self.declarations, include_attempts=True,
                                             include_verification=manifest.checkpoint.verification_sensitive)
        apply_profile_guidance(value, self.declarations, manifest, progress=progress)
        for helper in manifest.helpers:
            if helper.kind == 'text_patch':
                self._add_text_patch(guidance=helper.guidance)
            else:
                self._add_python_checks(kind=helper.kind, prominent=helper.prominent, guidance=helper.guidance)
        if manifest.compact_helper_guidance:
            for alias, binding in self.derived_checks.items():
                if binding['argument'] == 'script':
                    self.value['instructions'] += (
                        f'\nUse {alias} with script containing plain Python source and real newlines; '
                        'its compiler quotes the source for the existing host command tool to execute.')
                elif binding['argument'] == 'edit':
                    self.value['instructions'] += (
                        f'\nFor existing LF text files, use {alias} with edit.path relative to the workspace, edit.old_text copied '
                        'exactly from the latest saved file read, and edit.new_text containing the desired lines. '
                        'The host validates the native patch. On a context mismatch, inspect the actual saved '
                        'text and correct the next edit instead of repeating the rejected context.')
        if progress is not None and manifest.compute.phase_caps:
            if not progress['pending_sessions'] and not progress['unresolved_tool_calls']:
                cap = None
                if (progress['native_patches_saved'] and progress['completed_commands_since_last_native_patch']
                        and progress['last_command_exit'] == 0 and progress['last_attempt_command_succeeded']
                        and (not manifest.checkpoint.verification_sensitive or progress['latest_command_verification_intent'])):
                    cap = 16
                elif reasoning.get('effort') in {'low', 'minimal'} and input_was_list:
                    if not progress['tool_history_seen']:
                        cap = 32
                    elif progress['last_attempt_patch_saved']:
                        cap = 64
                # Compute allocation only: these phases do not prove assertions
                # ran or that the task is correct. Uncertain work keeps its budget.
                if cap is not None:
                    self.value['reasoning_budget_tokens'] = min(self.value['reasoning_budget_tokens'], cap)

    def _add_python_checks(self, *, kind, prominent=False, guidance=True):
        """Offer a private compiler only for an existing, identified host command."""
        if self.value.get('tool_choice', 'auto') != 'auto' or len(self.value.get('tools', [])) >= 1024:
            return
        targets = []
        for alias, identity in self.identities.items():
            if alias not in self.original_tool_aliases:
                continue
            namespace, name, tool_kind = identity
            declaration = self.declarations[alias]
            digest = hashlib.sha256(json.dumps(declaration, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            native = namespace == 'functions' or namespace is None and digest == PINNED_CODEX_0160_EXEC_SHA256
            schema = declaration.get('parameters', {})
            properties = schema.get('properties', {}) if isinstance(schema, dict) else {}
            if (native and name == 'exec_command' and tool_kind == 'function' and isinstance(schema, dict)
                    and schema.get('type') == 'object' and isinstance(properties, dict)
                    and isinstance(properties.get('cmd'), dict) and properties['cmd'].get('type') == 'string'
                    and schema.get('required') == ['cmd']):
                targets.append(alias)
        if len(targets) != 1:
            return
        integer, script = kind == 'integer', kind == 'script'
        if integer:
            from .local_python_integer_checks import INTEGER_CHECKS_SCHEMA as checks_schema, compile_integer_checks as compiler
        elif script:
            from .local_python_script import SCRIPT_SCHEMA as checks_schema, compile_script as compiler
        elif kind == 'named':
            from .local_python_named_checks import NAMED_CHECKS_SCHEMA as checks_schema, compile_named_feedback_checks as compiler
        elif kind == 'feedback':
            from .local_python_checks import FEEDBACK_CHECKS_SCHEMA as checks_schema, compile_feedback_checks as compiler
        else:
            from .local_python_checks import CHECKS_SCHEMA as checks_schema, compile_checks as compiler
        target = targets[0]
        properties = self.declarations[target]['parameters']['properties']
        argument = 'script' if script else 'checks'
        parameters = {argument: copy.deepcopy(checks_schema)}
        if isinstance(properties.get('workdir'), dict) and properties['workdir'].get('type') == 'string':
            parameters['workdir'] = copy.deepcopy(properties['workdir'])
        base_alias = 'koto_integer_checks' if integer else 'koto_python' if script else 'koto_python_checks'
        alias = base_alias
        for index in range(1025):
            if alias not in self.identities and alias not in self.derived_checks:
                break
            alias = base_alias + '_' + hashlib.sha256(str(index).encode()).hexdigest()[:16]
        else:
            raise LocalHarnessRequestError('ambiguous_check_tool')
        self.derived_checks[alias] = {'target': target, 'workdir': 'workdir' in parameters, 'argument': argument,
                                      'native_field': 'cmd'}
        self.derived_compilers[alias] = compiler
        self.compile_checks = compiler
        self.value['tools'].append({'type': 'function', 'name': alias, 'strict': True,
            'description': ('Check integer policies whose declared rejections require TypeError against saved code through the existing native command. For other exception contracts use ordinary Python script checks. Supply rules from the original task and valid named baseline arguments; inspect the actual result. These are self-checks, not independent qualification.' if integer else 'Run a Python script through the existing host command tool, with its normal permissions and actual results. Write plain Python with real newlines; import saved code and use assertions for verification.' if script else
                'Check supplied cases against a saved local Python function through the existing host command tool. Supply real expected results from the task; these checks are not independent qualification.'),
            'parameters': {'type': 'object', 'properties': parameters, 'required': [argument],
                           'additionalProperties': False}})
        if prominent:
            self.value['tools'].insert(0 if integer else len(self.derived_checks) - 1, self.value['tools'].pop())
        if prominent and guidance:
            self.value['instructions'] += (
                '\n\nLocal Python verification helper (subordinate to host, repository and user instructions): '
                + (f'Use {alias} as the plain Python script fallback. Supply its script argument as plain Python source '
                   'with real newlines; the helper quotes it for the existing host command tool. '
                   'Avoid constructing nested shell or python3 -c strings. Import the saved module and combine compact '
                   'assertions for the original requirements in one script. Use unittest.TestCase().assertRaises '
                   'for specified exceptions, then assert any required state preservation. Inspect actual host results.'
                   if script else
                   f'Prefer {alias} for your own Python verification. Supply its checks argument with the saved module '
                   'path, function, and your own cases. Put each call in an arguments object keyed by the saved '
                   'function parameter names; use the same parameter names in each case. Supply either expected '
                   'or raises. Use same_as only for a successful return, and unchanged for state that must be preserved. '
                   'Use parameter names in atomic_batch as well. Derive all inputs and expectations from the original task. '
                   'Use atomic_batch only when the original task requires both unchanged state on rejection and '
                   'a combined ordered batch to reject whenever its sequential execution rejects; '
                   'supply compatible successful and rejecting cases so composition checks can exercise a changed prefix '
                   'before a later rejection. The helper derives bounded compositions of your supplied batches; it does '
                   'not supply task inputs or expected results. Inspect actual host results.'))

    def _add_text_patch(self, *, guidance=True):
        """Translate replacement data only into an identified original host patch tool."""
        if self.value.get('tool_choice', 'auto') != 'auto' or len(self.value.get('tools', [])) >= 1024:
            return
        targets = []
        for alias in self.original_tool_aliases:
            namespace, name, kind = self.identities[alias]
            declaration = self.declarations[alias]
            digest = hashlib.sha256(json.dumps(declaration, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            native = namespace == 'functions' or namespace is None and digest == PINNED_CODEX_0160_PATCH_SHA256
            form = declaration.get('format', {})
            if (native and name == 'apply_patch' and kind == 'custom'
                    and form.get('type') == 'grammar' and form.get('syntax') == 'lark'):
                targets.append(alias)
        if len(targets) != 1:
            return
        from .local_text_patch import TEXT_PATCH_SCHEMA, compile_text_patch
        alias = 'koto_replace'
        for index in range(1025):
            if alias not in self.identities and alias not in self.derived_checks:
                break
            alias = 'koto_replace_' + hashlib.sha256(str(index).encode()).hexdigest()[:16]
        else:
            raise LocalHarnessRequestError('ambiguous_check_tool')
        self.derived_checks[alias] = {'target': targets[0], 'workdir': False, 'argument': 'edit',
                                      'native_field': 'input'}
        self.derived_compilers[alias] = compile_text_patch
        self.value['tools'].insert(0, {'type': 'function', 'name': alias, 'strict': True,
            'description': 'Replace exact saved text through the existing native patch tool and its normal permissions. '
                           'Supply a relative path, old_text copied from the saved file, and your intended new_text. '
                           'Inspect the actual host patch result.',
            'parameters': {'type': 'object', 'properties': {'edit': copy.deepcopy(TEXT_PATCH_SCHEMA)},
                           'required': ['edit'], 'additionalProperties': False}})
        if guidance:
            self.value['instructions'] += (
                '\n\nLocal text edit helper (subordinate to host, repository and user instructions): '
                f'For changes to existing LF text files, prefer {alias}; supply edit.path as a relative path, '
                'edit.old_text as exact old lines from the saved file, and edit.new_text as the desired lines. '
                'Do not supply patch headers or line prefixes. The host validates and executes the native patch; '
                'inspect its actual feedback.')
