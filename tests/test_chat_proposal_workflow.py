"""Explicit local proposals return data; commercial Codex retains all execution."""
from contextlib import contextmanager, redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from hormuz import chat_task
from hormuz.cli import build_parser
from hormuz.contracts import ContractValidationError, contract_manifest, validate_contract
from tests import test_chat_task_workflow as chat


class ChatProposalWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.chat = chat.ChatTaskWorkflowTests()
        self.chat.setUp()
        self.addCleanup(self.chat.doCleanups)
        self.fixture = self.chat.fixture
        self.prompt = self.chat.prompt

    def configuration(self, endpoint=None):
        self.chat.qualify_configuration()
        value = json.loads(self.fixture.path.read_text())
        value['route_admission']['local_routes']['local-code']['task_types'] = ['interactive', 'code_change']
        if endpoint is not None:
            value['upstreams']['local-llama']['base_url'] = endpoint
        self.fixture.path.write_text(json.dumps(value))

    def propose(self, *options):
        return self.chat.command('propose', '--model', 'local-code', '--prompt-file', str(self.prompt),
                                 '--max-output-tokens', '8', *options)

    def test_proposal_requires_an_explicit_model_and_bounds_the_prompt_before_router_access(self):
        missing = self.chat.command('propose', '--prompt-file', str(self.prompt))
        self.assertEqual(missing.returncode, 2)
        self.assertIn('--model', missing.stderr)
        self.prompt.write_bytes(b'x' * 65537)
        oversized = self.propose()
        self.assertEqual(oversized.returncode, 2)
        self.assertEqual(json.loads(oversized.stderr)['error']['code'], 'prompt_limit')
        self.assertEqual(json.loads(oversized.stderr)['submission'], 'not_submitted')
        self.chat.assert_normal_unchanged()

    def test_unqualified_coding_stays_blocked_for_ask_but_explicit_proposal_returns_once_for_review(self):
        with self.fixture.configured() as (local, cloud):
            self.configuration()
            self.prompt.write_text('Fix the arithmetic function in this Python code. Return a proposed patch for host review.')
            self.fixture.command('connect')
            ordinary = self.chat.command('ask', '--model', 'local-code', '--prompt-file', str(self.prompt),
                                         '--max-output-tokens', '8')
            self.assertEqual(ordinary.returncode, 2)
            self.assertEqual(json.loads(ordinary.stderr)['error']['code'], 'router_request_rejected')
            self.assertEqual([len(local), len(cloud)], [0, 0])
            result = self.propose('--effort', 'low')
            self.assertEqual(result.returncode, 0, result.stderr)
            receipt = json.loads(result.stdout)
            validate_contract(receipt)
            self.assertEqual(receipt['schema_id'], 'hormuz.chat-proposal')
            self.assertEqual(receipt['schema_version'], 1)
            self.assertEqual(receipt['text'], 'LOCAL_DESTINATION')
            self.assertEqual((receipt['model'], receipt['routed_model'], receipt['locality']),
                             ('local-code', 'fixture-local-model', 'local'))
            self.assertEqual((receipt['selection'], receipt['purpose'], receipt['reasoning_effort']),
                             ('model', 'proposal', 'low'))
            self.assertIs(receipt['review_required'], True)
            self.assertIs(receipt['applied'], False)
            self.assertIsNotNone(receipt['work_id'])
            self.assertEqual([len(local), len(cloud)], [1, 0])
            after = self.fixture.client('router-state')['body']['routes'][0]
            self.assertNotEqual(after['coding_readiness'], 'qualified')
            self.assertNotIn('code_change', after['automatic_task_types'])
            self.chat.assert_normal_unchanged()

    def test_missing_proposal_capability_blocks_before_submission_and_does_not_change_ask(self):
        with self.fixture.configured() as (local, cloud):
            self.configuration()
            self.fixture.command('connect')
            original = chat_task.open_local_upstream

            @contextmanager
            def old_router(request, **options):
                with original(request, **options) as response:
                    if request.full_url.endswith('/router/state'):
                        del response.headers['X-Hormuz-Proposals']
                    yield response

            args = build_parser().parse_args(['chat', 'propose', '--router-home', str(self.fixture.home),
                '--model', 'local-code', '--prompt-file', str(self.prompt), '--max-output-tokens', '8'])
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch.dict(os.environ, {**self.fixture.environment, 'CODEX_HOME': str(self.chat.normal)}), \
                    patch.object(chat_task, 'open_local_upstream', old_router), \
                    redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(chat_task.run(args), 2)
            receipt = json.loads(stderr.getvalue())
            self.assertEqual(receipt['error']['code'], 'router_upgrade_required')
            self.assertEqual(receipt['submission'], 'not_submitted')
            self.assertEqual([len(local), len(cloud)], [0, 0])
            args.chat_command = 'ask'
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch.dict(os.environ, {**self.fixture.environment, 'CODEX_HOME': str(self.chat.normal)}), \
                    patch.object(chat_task, 'open_local_upstream', old_router), \
                    redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(chat_task.run(args), 0, stderr.getvalue())
            self.assertEqual(json.loads(stdout.getvalue())['schema_id'], 'hormuz.chat-task')
            self.assertEqual([len(local), len(cloud)], [1, 0])
            self.chat.assert_normal_unchanged()

    def test_provider_capacity_failure_does_not_retry_alternate_or_cloud(self):
        with chat.lifetime.provider('ALTERNATE', status=lambda body:
                429 if body['model'] == 'fixture-local-model' else 200) as (endpoint, requests):
            with self.fixture.configured() as (local, cloud):
                self.configuration(endpoint)
                value = json.loads(self.fixture.path.read_text())
                value['model_routes']['local-code']['failover_alias'] = 'local-alternate'
                value['model_routes']['local-alternate'] = {**value['model_routes']['local-code'],
                    'upstream_model': 'fixture-alternate-model'}
                value['model_routes']['local-alternate'].pop('failover_alias')
                value['route_admission']['local_routes']['local-alternate'] = dict(
                    value['route_admission']['local_routes']['local-code'])
                value['policies']['organization']['allowed_models'].append('local-alternate')
                self.fixture.path.write_text(json.dumps(value))
                self.fixture.command('connect')
                result = self.propose()
                self.assertEqual(result.returncode, 2)
                error = json.loads(result.stderr)
                self.assertEqual(error['error']['code'], 'router_request_rejected')
                self.assertFalse(error['retried'])
                self.assertEqual(len(requests), 1)
                self.assertEqual(requests[0]['body']['model'], 'fixture-local-model')
                self.assertEqual([len(local), len(cloud)], [0, 0])
                self.chat.assert_normal_unchanged()

    def test_empty_incomplete_and_nontext_provider_outputs_never_become_proposals(self):
        text = {'type': 'message', 'role': 'assistant',
                'content': [{'type': 'output_text', 'text': 'Review this suggestion.'}]}
        outputs = (
            {'output': []},
            {'output': [{**text, 'content': [{'type': 'output_text', 'text': '   '}]}]},
            {'status': 'incomplete', 'output': [text]},
            {'output': [text, {'type': 'function_call', 'call_id': 'do-not-run',
                              'name': 'apply_patch', 'arguments': '{}'}]},
            {'output': [text, {'type': 'reasoning', 'encrypted_content': 'opaque'}]},
            {'output': [text], 'previous_response_id': 'opaque-history'},
        )
        for fields in outputs:
            with self.subTest(fields=fields), \
                    chat.lifetime.provider('UNUSED', response_fields=fields) as (endpoint, requests), \
                    self.fixture.configured() as (local, cloud):
                self.configuration(endpoint)
                self.fixture.command('connect')
                result = self.propose()
                self.assertEqual(result.returncode, 2, result.stdout)
                error = json.loads(result.stderr)
                self.assertIn(error['error']['code'],
                              {'proposal_output_invalid', 'task_incomplete', 'router_request_rejected',
                               'task_unavailable'})
                self.assertFalse(error['retried'])
                self.assertEqual([len(requests), len(local), len(cloud)], [1, 0, 0])
                self.chat.assert_normal_unchanged()

    def test_transparent_reasoning_is_not_exposed_as_the_proposal(self):
        fields = {'output': [
            {'type': 'reasoning', 'summary': [{'type': 'summary_text', 'text': 'PRIVATE_REASONING'}],
             'content': [{'type': 'reasoning_text', 'text': 'PRIVATE_REASONING'}]},
            {'type': 'message', 'role': 'assistant',
             'content': [{'type': 'output_text', 'text': 'Suggested patch for host review.'}]}]}
        with chat.lifetime.provider('UNUSED', response_fields=fields) as (endpoint, requests), \
                self.fixture.configured() as (local, cloud):
            self.configuration(endpoint)
            self.fixture.command('connect')
            result = self.propose()
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['text'], 'Suggested patch for host review.')
            self.assertNotIn('PRIVATE_REASONING', result.stdout)
            self.assertEqual([len(requests), len(local), len(cloud)], [1, 0, 0])
            self.chat.assert_normal_unchanged()

    def test_explicit_no_thinking_is_proposal_only_and_reaches_the_native_adapter(self):
        ordinary = self.chat.command('ask', '--model', 'local-code', '--prompt-file', str(self.prompt),
                                     '--max-output-tokens', '8', '--effort', 'none')
        self.assertEqual(ordinary.returncode, 2)
        self.assertIn('invalid choice', ordinary.stderr)
        old_task = json.loads((Path(__file__).parent / 'fixtures/chat-task-v1.json').read_text())
        with self.assertRaises(ContractValidationError):
            validate_contract({**old_task, 'reasoning_effort': 'none'})
        with self.fixture.configured() as (local, cloud):
            self.configuration()
            self.fixture.command('connect')
            result = self.propose('--effort', 'none')
            self.assertEqual(result.returncode, 0, result.stderr)
            receipt = json.loads(result.stdout)
            validate_contract(receipt)
            self.assertEqual((receipt['schema_id'], receipt['reasoning_effort']),
                             ('hormuz.chat-proposal', 'none'))
            self.assertIs(receipt['review_required'], True)
            self.assertIs(receipt['applied'], False)
            self.assertEqual([len(local), len(cloud)], [1, 0])
            self.assertIs(local[0]['body']['chat_template_kwargs']['enable_thinking'], False)
            self.assertEqual(local[0]['body']['reasoning_budget_tokens'], 0)
            self.assertNotIn('tools', local[0]['body'])
            self.assertNotIn('tool_choice', local[0]['body'])
            self.chat.assert_normal_unchanged()

    def test_observed_qwen_empty_logprobs_are_accepted_but_other_values_and_unknown_fields_are_rejected(self):
        block = {'type': 'output_text', 'annotations': [], 'logprobs': [],
                 'text': 'Suggested patch for host review.'}
        fields = {'output': [{'type': 'message', 'id': 'fixture-qwen-message', 'role': 'assistant',
                              'status': 'completed', 'content': [block]}]}
        with chat.lifetime.provider('UNUSED', response_fields=fields) as (endpoint, requests), \
                self.fixture.configured() as (local, cloud):
            self.configuration(endpoint)
            self.fixture.command('connect')
            result = self.propose('--effort', 'none')
            self.assertEqual(result.returncode, 0, result.stderr)
            receipt = json.loads(result.stdout)
            self.assertEqual(receipt['text'], block['text'])
            self.assertIs(receipt['review_required'], True)
            self.assertIs(receipt['applied'], False)
            changes = ({'logprobs': [{'token': 'unrequested'}]}, {'logprobs': None},
                       {'logprobs': False}, {'logprobs': ''}, {'logprobs': {}},
                       {'unknown': []}, {'encrypted_content': 'opaque'})
            for change in changes:
                with self.subTest(change=change):
                    fields['output'][0]['content'] = [{**block, **change}]
                    rejected = self.propose('--effort', 'none')
                    self.assertEqual(rejected.returncode, 2, rejected.stdout)
                    error = json.loads(rejected.stderr)
                    self.assertEqual(error['error']['code'], 'proposal_output_invalid')
                    self.assertFalse(error['retried'])
            self.assertEqual([len(requests), len(local), len(cloud)], [1 + len(changes), 0, 0])
            self.chat.assert_normal_unchanged()

    def test_proposal_contract_is_additive_and_cannot_claim_applied_or_skip_review(self):
        fixture = Path(__file__).parent / 'fixtures/chat-proposal-v1.json'
        value = json.loads(fixture.read_text())
        validate_contract(value)
        self.assertTrue(any(schema['schema_id'] == 'hormuz.chat-proposal'
                            for schema in contract_manifest()['schemas']))
        for changed in ({'applied': True}, {'review_required': False}, {'selection': 'router_default'},
                        {'purpose': 'execution'}, {'text': '  '}):
            with self.subTest(changed=changed), self.assertRaises(ContractValidationError):
                validate_contract({**value, **changed})


if __name__ == '__main__':
    unittest.main()
