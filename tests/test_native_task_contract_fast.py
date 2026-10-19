"""Native task receipts at the public contract checker boundary."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz.contracts import (
    ContractValidationError, contract_envelope, contract_manifest, validate_contract, validate_contract_manifest,
)


class NativeTaskContractFastTests(unittest.TestCase):
    def fixture(self, name):
        return json.loads((Path(__file__).parent / "fixtures" / name).read_text())

    def test_native_error_receipts_are_versioned_without_invented_completion_evidence(self):
        value = self.fixture("native-task-error-v1.json")
        validate_contract(value)
        self.assertEqual(contract_envelope("koto.native-task-error", {"error": {"code": "native_actor_required"}}), value)
        identities = {(row["schema_id"], row["schema_version"]) for row in contract_manifest()["schemas"]}
        self.assertIn(("koto.native-task-error", 1), identities)
        validate_contract_manifest(contract_manifest())
        for patch in ({"schema_version": 2}, {"status": "completed"}, {"error": {"code": "unbounded external text"}}):
            with self.subTest(patch=patch):
                with self.assertRaises(ContractValidationError):
                    validate_contract({**value, **patch})

    def test_completed_native_task_preserves_the_host_identity_and_unknown_usage(self):
        value = self.fixture("native-task-v1.json")
        validate_contract(value)
        self.assertIsNone(value["native"]["usage"])
        self.assertIsNone(value["execution"]["local_attempts"])
        self.assertEqual(contract_envelope("koto.native-task", value), value)
        identities = {(row["schema_id"], row["schema_version"]) for row in contract_manifest()["schemas"]}
        self.assertIn(("koto.native-task", 1), identities)

    def test_reported_native_usage_requires_complete_nonnegative_integer_counts(self):
        value = self.fixture("native-task-v1.json")
        row = {"inputTokens": 10, "cachedInputTokens": 0, "outputTokens": 3,
               "reasoningOutputTokens": 0, "totalTokens": 13}
        value["native"]["usage"] = {"last": dict(row), "total": dict(row), "modelContextWindow": 32768}
        validate_contract(value)
        value["native"]["usage"]["total"]["cacheWriteInputTokens"] = 0
        validate_contract(value)
        for field in row:
            for invalid in (-1, True, 1.5):
                with self.subTest(field=field, invalid=invalid):
                    changed = deepcopy(value)
                    changed["native"]["usage"]["last"][field] = invalid
                    with self.assertRaises(ContractValidationError):
                        validate_contract(changed)
        for usage in ({}, {"last": row}, {"last": {}, "total": row}):
            with self.subTest(usage=usage):
                with self.assertRaises(ContractValidationError):
                    validate_contract({**value, "native": {**value["native"], "usage": usage}})

    def test_completed_receipts_require_matching_native_completion_execution_and_cleanup(self):
        original = self.fixture("native-task-v1.json")
        changes = [
            ("execution", "verified", False), ("native", "status", "unknown"),
            ("native", "error", "native_protocol_error"), ("native", "thread_id", None),
            ("native", "native_terminal_status", None), ("native", "facts", None),
            ("native", "provider", "another-provider"), ("native", "model", "another-model"),
            ("selection", "executed_model", "another-alias"),
        ]
        for section, field, invalid in changes:
            with self.subTest(section=section, field=field):
                value = deepcopy(original)
                value[section][field] = invalid
                with self.assertRaises(ContractValidationError):
                    validate_contract(value)
        for changed in ("text", "cleanup", "context"):
            with self.subTest(changed=changed):
                value = deepcopy(original)
                if changed == "text":
                    value["text"] = "Invented final answer."
                elif changed == "cleanup":
                    value["native"]["cleanup"]["owned_processes_stopped"] = False
                else:
                    del value["native"]["context_controls_digest"]
                with self.assertRaises(ContractValidationError):
                    validate_contract(value)

    def test_local_success_requires_owned_router_proof_with_observed_attempts(self):
        value = self.fixture("native-task-v1.json")
        value.update(model="local-code", locality="local", execution={
            "verified": True, "source": "owned_router_receipts", "local_attempts": 2})
        value["selection"]["executed_model"] = "local-code"
        value["native"].update(provider="koto_session", model="local-code",
                                requested={"provider": "koto_session", "model": "local-code"})
        validate_contract(value)
        for attempts in (0, None, -1, True):
            with self.subTest(attempts=attempts):
                changed = deepcopy(value)
                changed["execution"]["local_attempts"] = attempts
                with self.assertRaises(ContractValidationError):
                    validate_contract(changed)
        changed = deepcopy(value)
        changed["execution"]["source"] = "native_provider_binding"
        with self.assertRaises(ContractValidationError):
            validate_contract(changed)

    def test_unknown_native_turns_retain_partial_text_without_fabricating_host_facts(self):
        value = self.fixture("native-task-v1.json")
        value.update(status="unknown", text="Partial answer.", error="native_deadline")
        value["execution"]["verified"] = False
        value["native"].update(status="unknown", text="Partial answer.", error="native_deadline", native_terminal_status=None)
        validate_contract(value)
        value.update(text="", model=None, selection=None)
        value["native"].update(text="", thread_id=None, turn_id=None, provider=None, model=None,
                                account=None, facts=None, requested=None)
        del value["native"]["context_controls_digest"]
        validate_contract(value)
        value.update(locality="local", execution={"verified": False, "source": "owned_router_receipts", "local_attempts": 0})
        validate_contract(value)

    def test_changed_native_models_cannot_be_hidden_behind_completed_binding(self):
        value = self.fixture("native-task-v1.json")
        value["native"]["reroutes"] = [{"from_model": "commercial-fixture", "to_model": "commercial-fallback"}]
        with self.assertRaises(ContractValidationError):
            validate_contract(value)

    def test_native_receipts_do_not_accept_http_cost_or_raw_account_credential_fields(self):
        original = self.fixture("native-task-v1.json")
        for field, value in (("http_status", 200), ("estimated_cost_microusd", 0), ("authorization", "secret")):
            with self.subTest(field=field):
                with self.assertRaises(ContractValidationError):
                    validate_contract({**original, field: value})
        changed = deepcopy(original)
        changed["native"]["account"]["email"] = "private@example.test"
        with self.assertRaises(ContractValidationError):
            validate_contract(changed)


if __name__ == "__main__":
    unittest.main()
