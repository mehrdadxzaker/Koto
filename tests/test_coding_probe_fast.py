"""Native custom-tool history at the actual qualification-probe gate."""
from copy import deepcopy
from email.message import Message
import time
from types import SimpleNamespace as NS
import unittest

from hormuz._contract_schemas.local_coding import canonical_digest
from hormuz.coding_probe import CodingProbe, HEADER, ProbeError
from hormuz.coding_qualification import request_profile_digest


class CustomProbeHistoryTests(unittest.TestCase):
    def prepare(self, version=4, capabilities=('codex_llama_v1',)):
        probe = CodingProbe(NS(destinations=NS(resolve=lambda _: NS(generation='generation'))))
        request = {'model': 'local-code', 'input': [{'role': 'user', 'content': 'Fix the Python function.'}],
                   'tools': [{'type': 'custom', 'name': 'apply_patch', 'format': {
                       'type': 'grammar', 'syntax': 'lark', 'definition': 'start: "PATCH_OK"'}}]}
        probe.plan = {'schema_version': version, 'model': 'local-code', 'max_requests': 4,
                      'subject': {'client_version': '0.160.0', 'capabilities': list(capabilities),
                                  'request_profile_sha256': request_profile_digest(request, schema_version=version)},
                      'first_input_sha256': canonical_digest(request['input'])}
        probe.probe_id, probe.actor_id, probe.generation = 'synthetic', 'actor', 'generation'
        probe.deadline = time.monotonic() + 6
        self.submit(probe, request)
        continuation = deepcopy(request)
        continuation['input'] += [
            {'type': 'custom_tool_call', 'call_id': 'patch-call', 'name': 'apply_patch', 'input': 'PATCH_OK'},
            {'type': 'custom_tool_call_output', 'call_id': 'patch-call', 'output': 'Success. Updated solution.py'}]
        return probe, continuation

    def submit(self, probe, request):
        headers = Message()
        headers[HEADER], headers['User-Agent'] = 'synthetic', 'codex_exec/0.160.0'
        handler = NS(headers=headers, path='/v1/responses', _work_id='work', _work_conversation='conversation')
        decision = NS(requested_model='local-code', resolved_alias='local-code', route=object())
        probe.check(handler, NS(actor_id='actor'), decision, request, client='codex', claim=True)

    def test_native_custom_call_and_result_continue_the_same_probe(self):
        for version in (3, 4):
            with self.subTest(version=version):
                probe, continuation = self.prepare(version)
                self.submit(probe, continuation)
                self.assertEqual(probe.count, 2)

    def test_legacy_or_undeclared_custom_history_remains_rejected(self):
        for version, capabilities in [(1, ('codex_llama_v1',)), (2, ('codex_llama_v1',)), (4, ())]:
            with self.subTest(version=version, capabilities=capabilities):
                probe, continuation = self.prepare(version, capabilities)
                with self.assertRaisesRegex(ProbeError, 'probe_request_mismatch'):
                    self.submit(probe, continuation)

    def test_custom_history_does_not_permit_replay_or_changed_task(self):
        probe, continuation = self.prepare()
        self.submit(probe, continuation)
        for request in [continuation,
                        {**continuation, 'input': continuation['input'] + [{'role': 'user', 'content': 'New task'}]},
                        {**continuation, 'input': continuation['input'] + [{'type': 'unknown_tool_output'}]}]:
            with self.assertRaisesRegex(ProbeError, 'probe_request_mismatch'):
                self.submit(probe, request)
        altered = deepcopy(continuation)
        altered['input'][1]['input'] = 'CHANGED_PATCH'
        altered['input'].append({'role': 'assistant', 'content': 'Continue'})
        with self.assertRaisesRegex(ProbeError, 'probe_request_mismatch'):
            self.submit(probe, altered)


if __name__ == '__main__':
    unittest.main()
