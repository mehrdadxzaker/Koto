"""Exercise MCP and file boundaries with fake check execution only."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from tests.repair_feedback_fixture import check_result, repair


class RepairFeedbackWorkflowTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='koto-repair-feedback-mock-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project_path = self.root / 'project'
        self.project_path.mkdir()
        self.source = self.project_path / 'solution.py'
        self.source.write_text('value = 0\n')
        self.oracle = self.root / 'independent-checks.py'
        self.oracle.write_text('Frozen independent checks; never exposed or executed here.\n')
        self.oracle_hash = hashlib.sha256(self.oracle.read_bytes()).hexdigest()
        self.project = repair.FileProject(self.project_path, self.root, Path(sys.executable))
        self.project.check = Mock(return_value=check_result())
        self.tools = repair.RepairTools(self.project)

    def request(self, method, **params):
        return {'jsonrpc': '2.0', 'method': method, 'params': params}

    def call(self, name, **arguments):
        return self.request('tools/call', name=name, arguments=arguments)

    def conversation(self, *requests):
        frames = [json.dumps({**request, 'id': n}) for n, request in enumerate(requests, 1)]
        outgoing = io.StringIO()
        with patch.object(repair.subprocess, 'Popen', side_effect=AssertionError('No subprocess is authorized')):
            repair.serve(self.tools, io.BytesIO(('\n'.join(frames) + '\n').encode()), outgoing)
        return [json.loads(line) for line in outgoing.getvalue().splitlines()]

    def value(self, reply):
        return json.loads(reply['result']['content'][0]['text'])

    def test_mcp_corrects_a_test_expectation_and_finishes_without_rewriting_source(self):
        self.project.check.side_effect = [check_result(1), check_result()]
        replies = self.conversation(
            self.request('initialize', protocolVersion='2024-11-05'), self.request('tools/list'),
            self.call('read_source'),
            self.call('save_source', content='value = 1\n', requirements=['Return one']),
            self.call('check_source', checks='assert solution.value == 2'),
            self.call('check_source', checks='assert solution.value == 1'),
            self.call('save_source', content='value = 1\n', requirements=['Return one']),
            self.call('read_source'))
        self.assertEqual(replies[0]['result']['instructions'], repair.INSTRUCTIONS)
        self.assertEqual({t['name'] for t in replies[1]['result']['tools']},
                         {'read_source', 'save_source', 'check_source'})
        self.assertTrue(replies[4]['result']['isError'])
        self.assertEqual(self.value(replies[4])['result_origin'], 'model_written_tests')
        self.assertFalse(replies[5]['result']['isError'])
        self.assertFalse(self.value(replies[6])['saved'])
        self.assertTrue(self.value(replies[7])['current_source_passed_your_tests'])
        self.assertEqual(self.source.read_text(), 'value = 1\n')
        self.assertEqual(self.project.check.call_count, 2)
        self.assertEqual(hashlib.sha256(self.oracle.read_bytes()).hexdigest(), self.oracle_hash)
        self.assertEqual({p.relative_to(self.root).as_posix() for p in self.root.rglob('*') if p.is_file()},
                         {'project/solution.py', 'independent-checks.py'})
        for reply in replies[2:]:
            self.assertEqual(self.value(reply)['automatic_admission_effect'], 'none')
            self.assertEqual(self.value(reply)['independent_checks'], 'unobserved')

    def test_repeated_failure_stops_even_if_the_client_keeps_calling_tools(self):
        self.project.check.return_value = check_result(1)
        replies = self.conversation(self.call('check_source', checks='assert False'),
            self.call('check_source', checks='assert False'),
            self.call('save_source', content='value = 99\n', requirements=['Return one']))
        self.assertTrue(self.value(replies[1])['must_stop'])
        self.assertEqual(self.value(replies[1])['reason'], 'repeated_failed_check')
        self.assertTrue(self.value(replies[2])['must_stop'])
        self.assertEqual(self.source.read_text(), 'value = 0\n')
        self.project.check.assert_called_once()

    def test_invalid_tool_call_returns_a_protocol_error_without_execution(self):
        replies = self.conversation(self.call('check_source', checks='def invalid(:'),
                                    self.request('ping'))
        self.assertTrue(replies[0]['result']['isError'])
        self.assertEqual(self.value(replies[0])['error'], 'invalid_tool_call')
        self.assertEqual(replies[1]['result'], {})
        self.project.check.assert_not_called()

    def test_source_links_cannot_read_or_overwrite_an_outside_file(self):
        outside = self.root / 'outside.py'
        outside.write_text('value = 55\n')
        for link in ['symlink', 'hardlink']:
            with self.subTest(link=link):
                self.source.unlink()
                if link == 'symlink':
                    self.source.symlink_to(outside)
                else:
                    os.link(outside, self.source)
                with self.assertRaises((OSError, ValueError)):
                    self.project.read()
                with self.assertRaises((OSError, ValueError)):
                    self.project.save('value = 99\n')
                self.assertEqual(outside.read_text(), 'value = 55\n')

    def test_instruction_export_never_constructs_a_project_or_starts_a_process(self):
        output = io.StringIO()
        with patch.object(sys, 'argv', ['local_repair_mcp.py', '--instructions']), \
                patch.object(sys, 'stdout', output), \
                patch.object(repair, 'FileProject', side_effect=AssertionError('No activation')), \
                patch.object(repair.subprocess, 'Popen', side_effect=AssertionError('No process')):
            repair.main()
        self.assertEqual(output.getvalue(), repair.INSTRUCTIONS)

    def test_mock_checker_timeout_cleans_up_only_its_owned_process_group(self):
        project = repair.FileProject(self.project_path, self.root, Path(sys.executable))
        process = Mock(pid=987654, returncode=-9)
        process.communicate.side_effect = subprocess.TimeoutExpired('mock checker', 4)
        process.wait.side_effect = [subprocess.TimeoutExpired('mock checker', 1), 0, 0]
        with patch.object(repair.sys, 'platform', 'darwin'), \
                patch.object(repair.subprocess, 'Popen', return_value=process) as launch, \
                patch.object(repair.os, 'killpg') as kill:
            result = project.check('assert True')
        self.assertTrue(result['timed_out'])
        self.assertEqual(result['check_exit_code'], -9)
        self.assertEqual([c.args[0] for c in kill.call_args_list], [987654, 987654])
        self.assertEqual([c.args[1] for c in kill.call_args_list],
                         [repair.signal.SIGTERM, repair.signal.SIGKILL])
        self.assertEqual(process.communicate.call_args.kwargs['timeout'], 4)
        process.stdin.close.assert_called_once()
        self.assertTrue(launch.call_args.kwargs['start_new_session'])
        arguments = launch.call_args.args[0]
        self.assertIn('(deny network*)', arguments[2])
        self.assertIn('(deny file-write*)', arguments[2])
        self.assertIn(str(self.root), arguments[2])


if __name__ == '__main__':
    unittest.main()
