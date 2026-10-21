"""Reversible Responses transport; the coding client owns tool execution."""
import copy
import hashlib
import json
import re
from .compaction_formats import strict_json_loads
from .local_harness import PROFILES, adapt_qwen_request

CAPABILITY = 'codex_llama_v1'
MAX_FRAME = 2 * 1024 * 1024
MAX_CHECK_ARGUMENTS = 65536
MAX_CHECK_COMMAND = 128 * 1024
MAX_COMPILED_CHECK_CACHE = 512 * 1024
# Canonical declaration observed in all twelve pinned Codex 0.160.0 captures.
# Flat same-name functions are otherwise insufficient evidence of a native tool.
PINNED_CODEX_0160_EXEC_SHA256 = '7ecb0f4f51b3982e36be43a9d08daa05348d7dd5f70646231b1f0f9823f40ec3'
PARENT_TAGS = {'parent_turn_id', 'x-codex-parent-thread-id', 'x-openai-subagent'}


class CodexLlamaError(ValueError):
    pass


def validate_function_arguments(value):
    arguments = strict_json_loads(value)
    if type(arguments) is not dict:
        raise CodexLlamaError('invalid_function_arguments')
    # Validate decoded strings too; the outer JSON only sees escaped argument
    # bytes. Keep the original argument string unchanged for native replay.
    json.dumps(arguments, ensure_ascii=False, allow_nan=False).encode('utf-8')


def needs_adapter(value):
    tools = value.get('tools', [])
    history = value.get('input', [])
    return (value.get('reasoning', {}) not in ({}, {'effort': 'none'})
            or isinstance(value.get('client_metadata'), dict) and bool(PARENT_TAGS.intersection(value['client_metadata']))
            or isinstance(tools, list) and any(isinstance(tool, dict) and tool.get('type') in ('namespace', 'custom', 'tool_search', 'web_search') for tool in tools)
            or isinstance(history, list) and any(isinstance(item, dict) and ('namespace' in item
                or item.get('type') in ('custom_tool_call', 'custom_tool_call_output', 'tool_search_call', 'tool_search_output', 'reasoning')) for item in history))


class CodexLlamaRequest:
    def __init__(self, value, *, translate=True, harness=None):
        if harness not in (None, *PROFILES.values()) or harness and not translate:
            raise CodexLlamaError('unsupported_local_harness')
        self.value = copy.deepcopy(value)
        self.translate = translate
        self.identities = {}
        self.declarations = {}
        self.original_tool_aliases = set()
        self.buffer = bytearray()
        self.stream_kinds = {}
        self.pending_functions = set()
        self.derived_checks = {}
        self.derived_calls = {}
        self.derived_streams = {}
        self.stream_bindings = {}
        self.derived_buffer_bytes = 0
        self.derived_compiled_bytes = 0
        self.event_stream = False
        if not translate:
            if isinstance(self.value.get('input'), list):
                for item in self.value['input']:
                    if isinstance(item, dict) and item.get('type') == 'function_call':
                        if item.get('status') not in (None, 'completed'):
                            raise CodexLlamaError('incomplete_tool_history')
                        validate_function_arguments(item.get('arguments', ''))
            return
        tags = value.get('client_metadata', {})
        if isinstance(tags, dict) and any(key in tags and (not isinstance(tags[key], str)
                or not 0 < len(tags[key]) <= 2048 or any(ord(c) < 32 or ord(c) > 126 for c in tags[key]))
                for key in PARENT_TAGS):
            raise CodexLlamaError('invalid_parent_metadata')
        reasoning = value.get('reasoning', {})
        if ('chat_template_kwargs' in value or 'reasoning_budget_tokens' in value or type(reasoning) is not dict
                or set(reasoning) - {'effort', 'summary'}
                or reasoning.get('effort', 'medium') not in {'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'}
                or reasoning.get('summary', 'auto') not in {'auto', 'concise', 'detailed'}):
            raise CodexLlamaError('unsupported_reasoning')
        self.value['chat_template_kwargs'] = {'enable_thinking': reasoning.get('effort') != 'none'}
        limit = value.get('max_output_tokens', 8192)
        budget = min(1024, max(1, limit // 2)) if type(limit) is int and limit > 0 else 1024
        self.value['reasoning_budget_tokens'] = budget if reasoning.get('effort') != 'none' else 0
        tools = value.get('tools', [])
        if type(tools) is not list or len(tools) > 1024:
            raise CodexLlamaError('invalid_tools')
        self.client_discovery = any(isinstance(tool, dict) and tool.get('type') == 'tool_search'
                                    and tool.get('execution') == 'client' for tool in tools)
        flattened = []
        loaded = [tool for item in value.get('input', []) if isinstance(item, dict)
                  and item.get('type') == 'tool_search_output' for tool in item.get('tools', [])]
        for tool, replayed in [*((tool, False) for tool in tools), *((tool, True) for tool in loaded)]:
            if type(tool) is not dict:
                raise CodexLlamaError('invalid_tool')
            if tool.get('type') == 'namespace':
                if (set(tool) - {'type', 'name', 'description', 'tools'}
                        or not isinstance(tool.get('name'), str) or not tool['name']
                        or not re.fullmatch(r'[A-Za-z0-9_-]{1,256}', tool['name'])
                        or not isinstance(tool.get('description', ''), str)
                        or type(tool.get('tools')) is not list or not tool['tools']):
                    raise CodexLlamaError('invalid_namespace')
                for child in tool['tools']:
                    converted = self._tool(child, tool['name'], replayed=replayed)
                    if converted is not None:
                        flattened.append(converted)
            else:
                converted = self._tool(tool, None, replayed=replayed)
                if converted is not None:
                    flattened.append(converted)
            if len(flattened) > 1024:
                raise CodexLlamaError('too_many_tools')
        if 'tools' in self.value:
            self.value['tools'] = flattened
        if isinstance(self.value.get('input'), list):
            self.value['input'] = [self._input(item) for item in self.value['input']]
        if harness:
            adapt_qwen_request(self.value, self.declarations, profile=harness)
        if harness in {'qwen-code.v6', 'qwen-code.v7', 'qwen-code.v8'}:
            self._add_python_checks(feedback=harness == 'qwen-code.v7', script=harness == 'qwen-code.v8')

    def _add_python_checks(self, *, feedback=False, script=False):
        """Offer a private compiler only for an existing, identified host command."""
        if self.value.get('tool_choice', 'auto') != 'auto' or len(self.value.get('tools', [])) >= 1024:
            return
        targets = []
        for alias, identity in self.identities.items():
            if alias not in self.original_tool_aliases:
                continue
            namespace, name, kind = identity
            declaration = self.declarations[alias]
            digest = hashlib.sha256(json.dumps(declaration, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            native = namespace == 'functions' or namespace is None and digest == PINNED_CODEX_0160_EXEC_SHA256
            schema = declaration.get('parameters', {})
            properties = schema.get('properties', {}) if isinstance(schema, dict) else {}
            if (native and name == 'exec_command' and kind == 'function' and isinstance(schema, dict)
                    and schema.get('type') == 'object' and isinstance(properties, dict)
                    and isinstance(properties.get('cmd'), dict) and properties['cmd'].get('type') == 'string'
                    and schema.get('required') == ['cmd']):
                targets.append(alias)
        if len(targets) != 1:
            return
        if script:
            from .local_python_script import SCRIPT_SCHEMA as checks_schema, compile_script as compiler
        elif feedback:
            from .local_python_checks import FEEDBACK_CHECKS_SCHEMA as checks_schema, compile_feedback_checks as compiler
        else:
            from .local_python_checks import CHECKS_SCHEMA as checks_schema, compile_checks as compiler
        target = targets[0]
        properties = self.declarations[target]['parameters']['properties']
        argument = 'script' if script else 'checks'
        parameters = {argument: copy.deepcopy(checks_schema)}
        if isinstance(properties.get('workdir'), dict) and properties['workdir'].get('type') == 'string':
            parameters['workdir'] = copy.deepcopy(properties['workdir'])
        base_alias = 'koto_python' if script else 'koto_python_checks'
        alias = base_alias
        for index in range(1025):
            if alias not in self.identities:
                break
            alias = base_alias + '_' + hashlib.sha256(str(index).encode()).hexdigest()[:16]
        else:
            raise CodexLlamaError('ambiguous_check_tool')
        self.derived_checks[alias] = {'target': target, 'workdir': 'workdir' in parameters, 'argument': argument}
        self.compile_checks = compiler
        self.value['tools'].append({'type': 'function', 'name': alias, 'strict': True,
            'description': ('Run a Python script through the existing host command tool, with its normal permissions and actual results. Write plain Python with real newlines; import saved code and use assertions for verification.' if script else
                'Check supplied cases against a saved local Python function through the existing host command tool. Supply real expected results from the task; these checks are not independent qualification.'),
            'parameters': {'type': 'object', 'properties': parameters, 'required': [argument],
                           'additionalProperties': False}})

    def _derived_identity(self, item):
        if (set(item) - {'type', 'id', 'call_id', 'name', 'arguments', 'status'}
                or not isinstance(item.get('call_id'), str) or not 1 <= len(item['call_id']) <= 256
                or item.get('id') is not None and (not isinstance(item['id'], str) or not 1 <= len(item['id']) <= 256)):
            raise CodexLlamaError('invalid_check_call_identity')
        return item.get('id'), item['call_id'], item['name']

    def _bind_derived(self, item):
        item_id, call_id, alias = self._derived_identity(item)
        if (len(self.derived_calls) >= 1024 or item_id is None or item_id in self.stream_bindings or call_id in self.derived_calls
                or any(binding[1] == call_id for binding in self.stream_bindings.values())):
            raise CodexLlamaError('ambiguous_check_call_identity')
        record = {'id': item_id, 'call_id': call_id, 'alias': alias, 'fragments': [],
                  'fragment_bytes': 0, 'signature': None, 'compiled': None, 'emitted': False}
        self.derived_calls[call_id] = record
        self.derived_streams[item_id] = record

    def _compile_derived(self, item):
        item_id, call_id, alias = self._derived_identity(item)
        record = self.derived_calls.get(call_id)
        if record is None:
            if self.event_stream or len(self.derived_calls) >= 1024 or any(r['id'] == item_id and item_id is not None for r in self.derived_calls.values()):
                raise CodexLlamaError('unbound_check_call')
            record = {'id': item_id, 'call_id': call_id, 'alias': alias, 'fragments': [],
                      'fragment_bytes': 0, 'signature': None, 'compiled': None, 'emitted': False}
            self.derived_calls[call_id] = record
        if (record['id'], record['call_id'], record['alias']) != (item_id, call_id, alias):
            raise CodexLlamaError('mismatched_check_call')
        raw = item.get('arguments', '')
        if not isinstance(raw, str) or len(raw.encode('utf-8')) > MAX_CHECK_ARGUMENTS:
            raise CodexLlamaError('check_arguments_exceeded')
        arguments = strict_json_loads(raw)
        argument = self.derived_checks[alias]['argument']
        allowed = {argument, 'workdir'} if self.derived_checks[alias]['workdir'] else {argument}
        if (type(arguments) is not dict or argument not in arguments or set(arguments) - allowed
                or 'workdir' in arguments and not isinstance(arguments['workdir'], str)):
            raise CodexLlamaError('invalid_check_arguments')
        canonical = json.dumps(arguments, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
        signature = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
        if record['fragments']:
            streamed = strict_json_loads(''.join(record['fragments']))
            if json.dumps(streamed, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False) != canonical:
                raise CodexLlamaError('mismatched_check_arguments')
        if record['signature'] is not None:
            if record['signature'] != signature:
                raise CodexLlamaError('mismatched_check_arguments')
            return record['compiled']
        command = self.compile_checks(arguments[argument])
        if not isinstance(command, str) or len(command.encode('utf-8')) > MAX_CHECK_COMMAND:
            raise CodexLlamaError('invalid_compiled_check')
        native = {'cmd': command}
        if 'workdir' in arguments:
            native['workdir'] = arguments['workdir']
        compiled = json.dumps(native, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
        size = len(compiled.encode('utf-8'))
        if self.derived_compiled_bytes + size > MAX_COMPILED_CHECK_CACHE:
            raise CodexLlamaError('check_arguments_exceeded')
        self.derived_buffer_bytes -= record['fragment_bytes']
        self.derived_compiled_bytes += size
        record.update(signature=signature, compiled=compiled, fragments=[], fragment_bytes=0)
        return compiled

    def _input(self, item):
        if isinstance(item, dict) and item.get('status') not in {None, 'completed'}:
            raise CodexLlamaError('incomplete_tool_history')
        if isinstance(item, dict) and item.get('type') == 'reasoning':
            if item.get('encrypted_content') or set(item) - {'type', 'id', 'summary', 'content', 'encrypted_content', 'status'}:
                raise CodexLlamaError('unsupported_reasoning_history')
            content = item.get('content') or item.get('summary')
            if (type(content) is not list or not content or any(type(part) is not dict
                    or set(part) != {'type', 'text'} or part.get('type') not in {'reasoning_text', 'summary_text'}
                    or not isinstance(part.get('text'), str) for part in content)):
                raise CodexLlamaError('invalid_reasoning_history')
            item = {key: value for key, value in item.items() if key != 'encrypted_content'} | {
                'content': [{'type': 'reasoning_text', 'text': '\n'.join(part['text'] for part in content)}]}
        elif isinstance(item, dict) and item.get('type') == 'tool_search_call':
            if item.get('execution') != 'client' or not isinstance(item.get('arguments'), dict):
                raise CodexLlamaError('unsupported_tool_discovery')
            item = {key: value for key, value in item.items() if key not in {'execution', 'arguments', 'status'}} | {
                'type': 'function_call', 'name': 'tool_search', 'arguments': json.dumps(item['arguments'], separators=(',', ':'))}
        elif isinstance(item, dict) and item.get('type') == 'tool_search_output':
            if item.get('execution') != 'client' or not isinstance(item.get('tools'), list):
                raise CodexLlamaError('unsupported_tool_discovery')
            discovered = set()
            for tool in item['tools']:
                if tool.get('type') == 'namespace':
                    discovered.update((tool['name'], child['name']) for child in tool['tools'])
                else:
                    discovered.add((None, tool['name']))
            aliases = {alias for alias, identity in self.identities.items() if identity[:2] in discovered}
            item = {key: value for key, value in item.items() if key not in {'execution', 'tools', 'status'}} | {
                'type': 'function_call_output', 'output': json.dumps({'tools': [
                    tool for tool in self.value['tools'] if tool['name'] in aliases]}, separators=(',', ':'))}
        elif isinstance(item, dict) and item.get('type') in {'function_call', 'custom_tool_call'}:
            aliases = [alias for alias, identity in self.identities.items()
                       if identity[:2] == (item.get('namespace'), item.get('name'))]
            if len(aliases) != 1:
                raise CodexLlamaError('undeclared_tool_history')
            item = {key: value for key, value in item.items() if key != 'namespace'}
            item['name'] = aliases[0]
            if item['type'] == 'custom_tool_call':
                if not isinstance(item.get('input'), str):
                    raise CodexLlamaError('invalid_custom_history')
                item = {key: value for key, value in item.items() if key != 'input'} | {
                    'type': 'function_call', 'arguments': json.dumps({'input': item['input']}, separators=(',', ':'))}
            else:
                validate_function_arguments(item.get('arguments', ''))
        elif isinstance(item, dict) and item.get('type') == 'custom_tool_call_output':
            item = {**item, 'type': 'function_call_output'}
        return item

    def _tool(self, tool, namespace, *, replayed=False):
        if type(tool) is not dict or tool.get('type') not in {'function', 'custom', 'tool_search', 'web_search'}:
            raise CodexLlamaError('unsupported_tool')
        name = ('tool_search' if tool['type'] == 'tool_search' else
                'hormuz_web_search' if tool['type'] == 'web_search' else tool.get('name'))
        if not isinstance(name, str) or not name or len(name) > 256:
            raise CodexLlamaError('invalid_tool_name')
        alias = name if namespace is None else 'hormuz_' + namespace + '__' + name
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', alias):
            if namespace is None:
                raise CodexLlamaError('invalid_tool_name')
            alias = 'hormuz_h_' + hashlib.sha256((namespace + '\0' + name).encode()).hexdigest()[:32]
        if alias in self.identities:
            if replayed and self.identities[alias] == (namespace, name, tool['type']) and self.declarations[alias] == tool:
                return None
            raise CodexLlamaError('ambiguous_tool_name')
        kind = tool['type']
        self.identities[alias] = (namespace, name, kind)
        self.declarations[alias] = tool
        if not replayed:
            self.original_tool_aliases.add(alias)
        result = copy.deepcopy(tool)
        result['name'] = alias
        if 'defer_loading' in result:
            if type(result.pop('defer_loading')) is not bool:
                raise CodexLlamaError('invalid_deferred_tool')
        if kind == 'tool_search':
            if (namespace is not None or tool.get('execution') != 'client'
                    or set(tool) - {'type', 'execution', 'description', 'parameters'}
                    or not isinstance(tool.get('parameters'), dict)):
                raise CodexLlamaError('unsupported_tool_discovery')
            result = {key: item for key, item in result.items() if key != 'execution'} | {'type': 'function', 'strict': False}
        if kind == 'web_search':
            if (namespace is not None or not self.client_discovery or tool.get('external_web_access') is not True
                    or set(tool) != {'type', 'external_web_access'}):
                raise CodexLlamaError('unsupported_hosted_search')
            result = {'type': 'function', 'name': alias, 'strict': True,
                      'description': 'Discover the existing client web search MCP tool. After discovery, call that tool to perform the requested search. This discovery function does not fetch web results.',
                      'parameters': {'type': 'object', 'properties': {'query': {'type': 'string'}},
                                     'required': ['query'], 'additionalProperties': False}}
        if kind == 'custom':
            form = tool.get('format', {})
            if (set(tool) - {'type', 'name', 'description', 'format', 'defer_loading'} or type(form) is not dict
                    or form.get('type') != 'grammar' or form.get('syntax') not in {'lark', 'regex'}
                    or set(form) != {'type', 'syntax', 'definition'} or not isinstance(form['definition'], str)):
                raise CodexLlamaError('unsupported_custom_format')
            result = {'type': 'function', 'name': alias,
                      'description': tool.get('description', '') + '\nReturn the raw tool input in input. Grammar:\n' + form['definition'],
                      'strict': True, 'parameters': {'type': 'object', 'properties': {'input': {'type': 'string'}},
                                                    'required': ['input'], 'additionalProperties': False}}
        if namespace:
            result['description'] = namespace + '.' + name + ': ' + result.get('description', '')
        return result

    def admission_value(self):
        result = {key: value for key, value in self.value.items() if key not in {'chat_template_kwargs', 'reasoning_budget_tokens'}}
        if 'reasoning' in result:
            result['reasoning'] = {}
        if isinstance(result.get('client_metadata'), dict):
            result['client_metadata'] = {key: value for key, value in result['client_metadata'].items()
                                         if key not in PARENT_TAGS}
        if isinstance(result.get('input'), list):
            result['input'] = [{'type': 'message', 'role': 'assistant', 'content': item['content'][0]['text']}
                               if isinstance(item, dict) and item.get('type') == 'reasoning' else
                               {key: value for key, value in item.items() if key != 'status'} if isinstance(item, dict) else item
                               for item in result['input']]
        return result

    def _item(self, value, *, complete=True):
        if not isinstance(value, dict):
            raise CodexLlamaError('invalid_provider_item')
        if value.get('type') != 'function_call':
            return value
        if complete and value.get('status') not in (None, 'completed'):
            raise CodexLlamaError('incomplete_provider_tool')
        if not self.translate:
            if complete:
                validate_function_arguments(value.get('arguments', ''))
            return value
        if not isinstance(value.get('name'), str):
            raise CodexLlamaError('invalid_provider_tool_name')
        if value['name'] in self.derived_checks:
            identity = self._derived_identity(value)
            if self.event_stream:
                record = self.derived_streams.get(identity[0])
                if record is None or (record['id'], record['call_id'], record['alias']) != identity:
                    raise CodexLlamaError('mismatched_check_call')
            namespace, name, _ = self.identities[self.derived_checks[value['name']]['target']]
            result = {**value, 'name': name, 'arguments': self._compile_derived(value) if complete else ''}
            if namespace:
                result['namespace'] = namespace
            if complete:
                self.derived_calls[value['call_id']]['emitted'] = True
            return result
        if self.derived_checks and any(value.get('id') == record['id'] and record['id'] is not None
                                      or value.get('call_id') == record['call_id']
                                      for record in self.derived_calls.values()):
            raise CodexLlamaError('mismatched_check_call')
        identity = self.identities.get(value.get('name'))
        if identity is None:
            raise CodexLlamaError('undeclared_tool_call')
        namespace, name, kind = identity
        result = {**value, 'name': name}
        if namespace:
            result['namespace'] = namespace
        if kind == 'function' and complete:
            validate_function_arguments(value.get('arguments', ''))
        if kind == 'custom':
            if not complete:
                raw_input = ''
            else:
                arguments = json.loads(value.get('arguments', ''))
                if type(arguments) is not dict or set(arguments) != {'input'} or not isinstance(arguments['input'], str):
                    raise CodexLlamaError('invalid_custom_arguments')
                raw_input = arguments['input']
            result = {key: item for key, item in result.items() if key != 'arguments'} | {
                'type': 'custom_tool_call', 'input': raw_input}
        elif kind in {'tool_search', 'web_search'}:
            arguments = json.loads(value.get('arguments', '{}')) if complete else {}
            if type(arguments) is not dict:
                raise CodexLlamaError('invalid_tool_discovery_arguments')
            if kind == 'web_search':
                if complete and (set(arguments) != {'query'} or not isinstance(arguments['query'], str)):
                    raise CodexLlamaError('invalid_web_search_arguments')
                arguments = {'query': 'search_service web search', 'limit': 1}
            result = {key: item for key, item in result.items() if key not in {'name', 'namespace', 'arguments'}} | {
                'type': 'tool_search_call', 'execution': 'client', 'arguments': arguments}
        return result

    def _response(self, value):
        if not isinstance(value, dict):
            raise CodexLlamaError('invalid_provider_response')
        if isinstance(value.get('output'), list):
            if self.derived_checks and any(isinstance(item, dict) and item.get('name') in self.derived_checks for item in value['output']):
                call_ids = [item.get('call_id') for item in value['output'] if isinstance(item, dict) and item.get('type') == 'function_call']
                if any(not isinstance(call_id, str) for call_id in call_ids) or len(call_ids) != len(set(call_ids)):
                    raise CodexLlamaError('ambiguous_check_call_identity')
            output = []
            for item in value['output']:
                partial = (value.get('status') in ('failed', 'incomplete') and isinstance(item, dict)
                           and item.get('type') == 'function_call' and item.get('status') in ('in_progress', 'incomplete'))
                output.append(self._item(item, complete=not partial))
                if not partial and isinstance(item, dict) and item.get('type') == 'function_call':
                    self.pending_functions.discard(item.get('id'))
            value = {**value, 'output': output}
        if value.get('status') == 'completed' and self.pending_functions:
            raise CodexLlamaError('unfinished_provider_tools')
        return value

    def _start_function(self, item_id):
        if not isinstance(item_id, str) or not 1 <= len(item_id) <= 256:
            raise CodexLlamaError('invalid_provider_item_id')
        self.pending_functions.add(item_id)
        if len(self.pending_functions) > 1024:
            raise CodexLlamaError('too_many_provider_items')

    def _event(self, value):
        if not isinstance(value, dict):
            raise CodexLlamaError('invalid_provider_event')
        if self.derived_checks and value.get('type') == 'response.output_item.added' and value.get('item', {}).get('type') == 'function_call':
            original = value['item']
            if len(self.stream_bindings) >= 1024:
                raise CodexLlamaError('too_many_provider_items')
            if original.get('name') in self.derived_checks:
                self._bind_derived(original)
            elif (original.get('id') in self.derived_streams
                  or any(original.get('call_id') == record['call_id'] for record in self.derived_calls.values())):
                raise CodexLlamaError('mismatched_check_call')
            self.stream_bindings[original.get('id')] = (original.get('name'), original.get('call_id'))
        if self.derived_checks and value.get('type') in {'response.function_call_arguments.delta', 'response.function_call_arguments.done'}:
            item_id = value.get('item_id')
            if not isinstance(item_id, str) or item_id not in self.stream_bindings:
                raise CodexLlamaError('unbound_check_arguments')
            record = self.derived_streams.get(item_id)
            if record is not None:
                if (value.get('call_id', record['call_id']) != record['call_id']
                        or value.get('name', record['alias']) != record['alias']):
                    raise CodexLlamaError('mismatched_check_call')
                if value['type'].endswith('.delta'):
                    delta = value.get('delta')
                    if not isinstance(delta, str) or record['signature'] is not None:
                        raise CodexLlamaError('invalid_check_argument_delta')
                    if not delta:
                        return None
                    size = len(delta.encode('utf-8'))
                    if self.derived_buffer_bytes + size > MAX_CHECK_ARGUMENTS:
                        raise CodexLlamaError('check_arguments_exceeded')
                    self.derived_buffer_bytes += size
                    record['fragment_bytes'] += size
                    record['fragments'].append(delta)
                else:
                    self._compile_derived({'type': 'function_call', 'id': item_id, 'call_id': record['call_id'],
                        'name': record['alias'], 'arguments': value.get('arguments', ''), 'status': 'completed'})
                return None
        if value.get('type') in {'response.output_item.added', 'response.output_item.done'}:
            item = self._item(value['item'], complete=value['type'].endswith('.done'))
            if value['item'].get('type') == 'function_call':
                if value['type'] == 'response.output_item.added':
                    self._start_function(value['item'].get('id'))
                else:
                    self.pending_functions.discard(value['item'].get('id'))
            if item.get('id'):
                self.stream_kinds[item['id']] = item['type']
            value = {**value, 'item': item}
        if value.get('type') == 'response.function_call_arguments.delta':
            self._start_function(value.get('item_id'))
        if (value.get('type', '').startswith('response.function_call_arguments.')
                and self.stream_kinds.get(value.get('item_id')) in {'custom_tool_call', 'tool_search_call'}):
            return None
        if value.get('type') == 'response.function_call_arguments.done':
            validate_function_arguments(value.get('arguments', ''))
            self.pending_functions.discard(value.get('item_id'))
        if isinstance(value.get('response'), dict):
            value = {**value, 'response': self._response(value['response'])}
        return value

    def feed(self, raw, *, event_stream, final=False):
        try:
            return self._feed(raw, event_stream=event_stream, final=final)
        except (ValueError, TypeError, KeyError, AttributeError, RecursionError) as error:
            raise CodexLlamaError('invalid_provider_frame') from error

    def _feed(self, raw, *, event_stream, final=False):
        self.event_stream = event_stream
        self.buffer.extend(raw)
        if len(self.buffer) > MAX_FRAME:
            raise CodexLlamaError('provider_frame_exceeded')
        if not event_stream:
            if not final:
                return b''
            value = self._response(json.loads(self.buffer))
            self.buffer.clear()
            return json.dumps(value, separators=(',', ':')).encode()
        output = bytearray()
        self.buffer[:] = self.buffer.replace(b'\r\n', b'\n')
        while b'\n\n' in self.buffer:
            frame, _, rest = self.buffer.partition(b'\n\n')
            self.buffer[:] = rest
            lines = []
            skip = False
            for line in frame.split(b'\n'):
                if line.startswith(b'data:') and line[5:].strip() != b'[DONE]':
                    value = self._event(json.loads(line[5:]))
                    if value is None:
                        skip = True
                        break
                    line = b'data: ' + json.dumps(value, separators=(',', ':')).encode()
                lines.append(line)
            if not skip:
                output.extend(b'\n'.join(lines) + b'\n\n')
        if final:
            incomplete = bool(self.buffer.strip(b'\r\n'))
            self.buffer.clear()
            if incomplete:
                raise CodexLlamaError('incomplete_provider_frame')
            if self.derived_checks and any(not record['emitted'] for record in self.derived_streams.values()):
                raise CodexLlamaError('incomplete_check_call')
        return bytes(output)
