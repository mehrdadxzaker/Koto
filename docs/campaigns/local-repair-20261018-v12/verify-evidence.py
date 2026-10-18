"""Verify retained outcome evidence offline; never execute submitted repairs."""
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile


DIRECTORY = Path(__file__).resolve().parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    index = json.loads((DIRECTORY / 'evidence-index.json').read_text())
    summary = json.loads((DIRECTORY / 'qualification-summary.json').read_text())
    archive = DIRECTORY / index['archive']
    assert archive.stat().st_size == index['archive_bytes'] < 2 * 1024 * 1024
    assert digest(archive.read_bytes()) == index['archive_sha256']
    assert len(index['members']) == index['regular_members'] < 500
    assert sum(row['bytes'] for row in index['members']) == index['original_bytes'] < 30 * 1024 * 1024
    retained = {}
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        assert len(members) == len(index['members'])
        for member, row in zip(members, index['members'], strict=True):
            path = PurePosixPath(member.name)
            assert member.isfile() and not path.is_absolute() and '..' not in path.parts
            assert member.name == row['path'] and member.name not in retained
            assert member.size == row['bytes'] < 4 * 1024 * 1024
            with tar.extractfile(member) as stream:
                data = stream.read()
            assert digest(data) == row['sha256']
            retained[member.name] = data

    def read(name):
        return json.loads(retained[name])

    planned = read('coding-plan.json')['cases']
    stages = read('canary-result.json')['cases'] + read('qualification-result.json')['cases']
    assert len(planned) == len(stages) == len(summary['cases']) == 16
    assert {name.split('/')[1] for name in retained if name.startswith('episodes/')} == {c['case_id'] for c in planned}
    accepted = edits = checks = expired = requests = commands = functions = incomplete = completed = 0
    for plan, stage, case in zip(planned, stages, summary['cases'], strict=True):
        cid = plan['case_id']
        assert cid == stage['case_id'] == case['case_id']
        prefix = 'episodes/' + cid + '/'
        result = read(prefix + 'result.json')
        assert result == stage and result['native_episodes'] == 1 and result['quality_retries'] == 0
        inspection = read(case['inspection_path'])
        assert inspection == case['inspection'] and inspection['no_harness_interference']
        for key, filename in [('result_sha256', 'result.json'), ('patch_sha256', 'implementation.patch'),
                              ('implementation_sha256', 'implementation-after.py'), ('native_events_sha256', 'native.jsonl')]:
            assert inspection[key] == digest(retained[prefix + filename])
        assert retained[prefix + 'implementation-after.py'].decode() == case['implementation']
        assert retained[prefix + 'implementation.patch'].decode() == case['patch']
        native = [json.loads(line) for line in retained[prefix + 'native.jsonl'].splitlines() if line]
        turns = sum(event['type'] == 'turn.completed' for event in native)
        errors = sum(event['type'] in ('turn.failed', 'error') for event in native)
        native_commands = sum(event['type'] == 'item.completed' and event.get('item', {}).get('type') == 'command_execution' for event in native)
        independent = result['check_exit_code'] == 0 and result['checker_after']['assertions_completed']
        normal = turns == 1 and errors == 0 and result['native']['exit_code'] == 0 and result['native']['elapsed_ms'] <= 90000
        passed = bool(result['mechanical_passed'] and independent and normal and result['implementation_changed'] and native_commands)
        assert passed == case['accepted'] and independent == inspection['independent_assertions_verified']
        assert normal == inspection['normal_turn_completion_verified']
        assert turns == inspection['normal_turn_completed_count'] == case['normal_turn_completed_count']
        assert errors == inspection['native_failure_or_error_events'] == case['native_failure_or_error_events']
        assert result['checks_unchanged'] and result['automatic_admission_effect'] == 'none'
        assert result['routing_after']['mode'] == 'local_only'
        assert all(route['coding_readiness'] == 'unknown' and route['automatic_task_types'] == []
                   and route['coding_evidence'] is None for route in result['routing_after']['routes'])
        wire = read(prefix + 'trace/wire.json')
        assert len(wire) == result['trace_requests'] == case['requests'] <= 8
        for n, row in enumerate(wire, 1):
            raw = gzip.decompress(retained[prefix + ('trace/response-%02d.sse.gz' % n)])
            assert len(raw) == row['response_bytes'] and digest(raw) == row['response_sha256']
            events = [json.loads(line[5:]) for line in raw.splitlines()
                      if line.startswith(b'data:') and line[5:].strip() != b'[DONE]']
            assert events == row['events'] and row['status'] == 200
            responses = [event for event in events if event['type'] == 'response.completed']
            assert len(responses) <= 1
            completed += len(responses)
            incomplete += not responses
            assert all(response['response']['usage']['output_tokens'] <= 512 for response in responses)
            for event in events:
                item = event.get('item', {})
                if event['type'] != 'response.output_item.done' or item.get('type') != 'function_call':
                    continue
                assert item['name'] == 'exec_command' and n < len(wire)
                next_call = next(value for value in wire[n]['request']['input']
                                 if value.get('type') == 'function_call' and value.get('call_id') == item['call_id'])
                assert next_call['name'] == item['name'] and next_call['arguments'] == item['arguments']
                functions += 1
        accepted += passed
        edits += result['implementation_changed']
        checks += independent
        expired += result['probe_after']['state'] == 'expired'
        requests += len(wire)
        commands += native_commands
    actual_totals = {'accepted_cases': accepted, 'actual_implementation_edits': edits,
                     'independent_checker_passes': checks, 'deadline_expirations': expired,
                     'local_model_requests': requests, 'completed_native_command_items': commands,
                     'completed_structured_function_calls': functions,
                     'function_calls_preserved_in_next_native_input': functions,
                     'completed_responses_with_usage': completed,
                     'responses_without_completion_or_final_usage': incomplete}
    assert all(summary['totals'][key] == value for key, value in actual_totals.items())
    assert summary['canary_passed'] == summary['cases'][0]['accepted']
    assert summary['qualification_passed'] == (accepted == 16)
    assert not summary['passing_receipt_created_or_installed'] and not summary['automatic_coding_enabled']
    for path in (DIRECTORY / 'actual-episodes/dev-clamp').rglob('*'):
        if path.is_file():
            assert path.read_bytes() == retained['episodes/dev-clamp/' + str(path.relative_to(DIRECTORY / 'actual-episodes/dev-clamp'))]
    print(json.dumps({'verified_archive_members': len(retained), 'all_16_cases_bound': True, **actual_totals}, indent=2))


if __name__ == '__main__':
    main()
