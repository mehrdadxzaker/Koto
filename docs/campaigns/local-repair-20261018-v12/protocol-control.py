"""Public engine first-turn and tool-continuation controls; no completions/tools.

Use native text chunks as the pinned Responses converter does, rather than a
string-joined approximation. Supplied assistant/tool records are tokenized and
rendered only. They are not generated model output or executed commands.
"""
import copy
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path

DIRECTORY = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('v12_driver', DIRECTORY / 'campaign-runner.py')
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


def main():
    output = DIRECTORY / 'protocol-controls.json'
    if output.exists():
        raise RuntimeError('Preserve existing protocol controls')
    captured = driver.read(driver.ROOT / 'captured-request.json')
    messages = [{'role':'system', 'content':captured['instructions']}] + [
        {'role':item['role'], 'content':[{'type':'text', 'text':part['text']}
          for part in item['content'] if part['type']=='input_text']} for item in captured['input']]
    chat = {'messages':messages, 'tools':[
        {'type':'function', 'function':{key:value for key,value in tool.items() if key!='type'}}
        for tool in captured['tools']], 'tool_choice':'auto', 'parallel_tool_calls':True,
        'add_generation_prompt':True}
    experiment = driver.retained.Experiment()
    report = {'model_completion_requests':0, 'model_quality_evidence':False, 'metadata_requests':[]}
    connection = None
    try:
        report['setup'] = experiment.connect()
        connection = http.client.HTTPConnection('127.0.0.1', experiment.ports[1], timeout=5)
        def metadata(path, value):
            if len(report['metadata_requests']) >= 4 or path not in {'/apply-template','/v1/responses/input_tokens'}:
                raise RuntimeError('Metadata request budget or endpoint violated')
            connection.request('POST',path,body=driver.canonical(value),headers={'Content-Type':'application/json'})
            response = connection.getresponse()
            raw = response.read(2*1024*1024+1)
            if len(raw)>2*1024*1024:
                raise RuntimeError('Metadata response limit exceeded')
            report['metadata_requests'].append({'path':path,'status':response.status,'response_sha256':driver.sha(raw)})
            return response.status,json.loads(raw)
        status, rendered = metadata('/apply-template',chat)
        if status != 200:
            raise RuntimeError('Exact typed native first turn failed to render')
        prompt = rendered['prompt']
        texts = [captured['instructions']] + [part['text'] for item in captured['input'] for part in item['content'] if part['type']=='input_text']
        positions = [prompt.find(text) for text in texts]
        report['exact_typed_first_turn'] = {'text_blocks':len(texts),'all_preserved_in_order':all(position>=0 for position in positions) and positions==sorted(positions),
            'tool_names_present':[tool['name'] for tool in captured['tools'] if tool['name'] in prompt],
            'prompt_sha256':driver.sha(prompt.encode())}
        arguments = json.dumps({'cmd':'cat solution.py'},separators=(',',':'))
        continuation = copy.deepcopy(captured)
        continuation['input'] += [
            {'type':'message','role':'assistant','content':[{'type':'output_text','text':'Transport-only continuation.'}]},
            {'type':'function_call','call_id':'call_metadata_only','name':'exec_command','arguments':arguments},
            {'type':'function_call_output','call_id':'call_metadata_only','output':'fixture tool result'}]
        status, tokens = metadata('/v1/responses/input_tokens',continuation)
        if status != 200:
            raise RuntimeError('Native Responses tool continuation could not be tokenized')
        report['native_continuation_tokens'] = tokens
        continued_chat = copy.deepcopy(chat)
        continued_chat['messages'] += [
            {'role':'assistant','content':'Transport-only continuation.','tool_calls':[
                {'id':'call_metadata_only','type':'function','function':{'name':'exec_command','arguments':arguments}}]},
            {'role':'tool','tool_call_id':'call_metadata_only','name':'exec_command','content':'fixture tool result'}]
        status, rendered = metadata('/apply-template',continued_chat)
        if status != 200:
            raise RuntimeError('Supplied native tool continuation could not be rendered')
        prompt = rendered['prompt']
        report['tool_continuation_rendered'] = all(text in prompt for text in [
            'Transport-only continuation.','[TOOL_CALLS]exec_command[ARGS]','cat solution.py','fixture tool result'])
        late_instruction = copy.deepcopy(chat)
        late_instruction['messages'].append({'role':'system','content':'late_instruction_control'})
        status, error = metadata('/apply-template',late_instruction)
        report['late_instruction_still_rejected'] = status == 500 and 'Only user, assistant and tool roles are supported' in str(error)
        report['work_state'] = experiment.public('work/state')
        report['routing_status'] = experiment.cli('client','status','codex','--client-home',str(experiment.client_home),'--routing')
    finally:
        if connection:
            connection.close()
        experiment.close(report)
        driver.write(output,report,exclusive=True)
    passed = (report['exact_typed_first_turn']['all_preserved_in_order']
        and len(report['exact_typed_first_turn']['tool_names_present'])==7
        and report['tool_continuation_rendered'] and report['late_instruction_still_rejected']
        and report['work_state']['totals']['attempts']==0
        and report['settings_restored'] and report['owned_listeners_closed'])
    print(json.dumps({'protocol_controls_passed':passed,'metadata_requests':len(report['metadata_requests']),
        'model_completion_requests':0,'settings_restored':report['settings_restored'],
        'owned_listeners_closed':report['owned_listeners_closed']}))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
