"""Verify this failed canary's retained evidence without executing any repair."""
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath

DIRECTORY = Path(__file__).resolve().parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(name):
    return json.loads((DIRECTORY / name).read_text())


def main():
    index = read('evidence-index.json')
    for row in index['files']:
        relative = PurePosixPath(row['path'])
        assert not relative.is_absolute() and '..' not in relative.parts
        path = DIRECTORY / str(relative)
        assert path.is_file() and not path.is_symlink()
        assert path.stat().st_size == row['bytes'] < 2 * 1024 * 1024
        assert digest(path.read_bytes()) == row['sha256']
    analysis = read('canary-analysis.json')
    result = read('actual-episodes/dev-clamp/result.json')
    stage = read('canary-result.json')
    assert stage['cases'] == [result]
    assert stage['settings_restored'] and stage['owned_listeners_closed']
    assert result['routing_after']['mode'] == 'local_only'
    assert all(route['coding_readiness'] == 'unknown' and not route['automatic_task_types']
               and route['coding_evidence'] is None for route in result['routing_after']['routes'])
    inspection = read('failure-inspections/dev-clamp.json')
    for key, filename in [('result_sha256', 'result.json'), ('implementation_sha256', 'implementation-after.py'),
                          ('patch_sha256', 'implementation.patch'), ('native_events_sha256', 'native.jsonl')]:
        assert inspection[key] == digest((DIRECTORY / 'actual-episodes/dev-clamp' / filename).read_bytes())
    native = [json.loads(line) for line in (DIRECTORY / 'actual-episodes/dev-clamp/native.jsonl').read_text().splitlines()]
    types = Counter(row['type'] for row in native)
    commands = [row['item'] for row in native if row['type'] == 'item.completed'
                and row.get('item', {}).get('type') == 'command_execution']
    assert types['turn.completed'] == inspection['normal_turn_completed_count'] == 0
    assert types['error'] == types['turn.failed'] == 1
    assert len(commands) == analysis['completed_native_command_items'] == 6
    assert all(command['exit_code'] == 0 for command in commands)
    assert result['native'] == analysis['native'] and result['native']['exit_code'] == 1
    assert result['baseline_exit_code'] == 1 and result['implementation_changed']
    assert result['checks_unchanged'] and result['check_exit_code'] == 0 and result['checker_after']['assertions_completed']
    assert not result['mechanical_passed'] and not inspection['qualification_acceptance']
    wire = read('actual-episodes/dev-clamp/trace/wire.json')
    assert len(wire) == result['trace_requests'] == analysis['local_model_submissions'] == 8
    names = Counter()
    preserved = completed = output_tokens = 0
    for n, row in enumerate(wire):
        raw = gzip.decompress((DIRECTORY / ('actual-episodes/dev-clamp/trace/response-%02d.sse.gz' % (n + 1))).read_bytes())
        assert len(raw) == row['response_bytes'] < 2 * 1024 * 1024
        assert digest(raw) == row['response_sha256']
        events = [json.loads(line[5:]) for line in raw.splitlines()
                  if line.startswith(b'data:') and line[5:].strip() != b'[DONE]']
        assert events == row['events'] and row['status'] == 200
        responses = [event for event in events if event['type'] == 'response.completed']
        assert len(responses) == 1
        completed += 1
        usage = responses[0]['response']['usage']
        assert usage['output_tokens'] <= 512
        output_tokens += usage['output_tokens']
        for event in events:
            item = event.get('item', {})
            if event['type'] != 'response.output_item.done' or item.get('type') != 'function_call':
                continue
            names[item['name']] += 1
            if n + 1 < len(wire):
                next_call = next(value for value in wire[n + 1]['request']['input']
                                 if value.get('type') == 'function_call' and value.get('call_id') == item['call_id'])
                assert next_call['name'] == item['name'] and next_call['arguments'] == item['arguments']
                preserved += 1
    assert dict(names) == analysis['function_call_names'] == {'exec_command': 6, 'update_goal': 2}
    assert preserved == analysis['tool_history_pairs_preserved'] == 7
    assert completed == analysis['completed_generations'] == 8
    assert output_tokens == analysis['total_observed_output_tokens'] == 1399
    assert result['probe_after']['state'] == 'exhausted'
    assert not analysis['trial_passed'] and not analysis['remaining_battery_run']
    disposition = read('qualification-disposition.json')
    assert disposition['planned_cases'] == 16 and disposition['evaluated_cases'] == 1 and disposition['accepted_cases'] == 0
    assert disposition['qualification_cases_left_unrun'] == read('coding-plan.json')['cases'][1:]
    assert not disposition['qualification_stage_started'] and not disposition['automatic_coding_enabled']
    print(json.dumps({'verified_indexed_files': len(index['files']), 'actual_model_episodes': 1,
                      'requests': len(wire), 'completed_commands': len(commands), 'verified_continuation_pairs': preserved,
                      'independent_assertions_passed': True, 'canary_accepted': False, 'remaining_cases_unrun': 15}, indent=2))


if __name__ == '__main__':
    main()
