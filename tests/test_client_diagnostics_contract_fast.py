"""Metadata-only diagnostic receipts through the public contract facade."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz.contracts import ContractValidationError, contract_manifest, validate_contract, validate_contract_manifest


FIXTURES = Path(__file__).parent / "fixtures"


class ClientDiagnosticContractTests(unittest.TestCase):
    def test_client_check_reports_each_distinct_reason_with_its_fixed_recovery_action(self):
        cases = (
            ("not_checked", "check_selected_executable", None),
            ("executable_missing", "select_client_executable", None),
            ("executable_unlaunchable", "inspect_client_executable", None),
            ("version_timeout", "inspect_client_process", None),
            ("version_output_too_large", "inspect_client_version_output", None),
            ("version_command_failed", "inspect_client_version_command", None),
            ("version_malformed", "inspect_client_version_output", None),
            ("version_unqualified", "select_supported_client", "0.160.1"),
            ("version_supported", "none", "0.147.0"),
            ("version_supported", "none", "0.160.0"),
            ("version_supported", "none", "0.162.0-alpha.17.2"),
        )
        for reason, action, version in cases:
            with self.subTest(reason=reason, version=version):
                value = {"schema_id": "hormuz.client-check", "schema_version": 1,
                         "reason": reason, "action": action, "observed_version": version}
                validate_contract(value)
                for field, invalid in (("action", "retry_automatically"),
                                       ("reason", "PRIVATE_UNKNOWN_REASON"),
                                       ("schema_version", 2), ("stdout", "PRIVATE_OUTPUT")):
                    with self.subTest(field=field), self.assertRaises(ContractValidationError):
                        validate_contract({**value, field: invalid})

    def test_observed_versions_cannot_turn_unqualified_or_missing_evidence_into_support(self):
        base = {"schema_id": "hormuz.client-check", "schema_version": 1,
                "reason": "version_unqualified", "action": "select_supported_client",
                "observed_version": "1.0.0-beta.2+fixture"}
        validate_contract(base)
        for version in (None, "", True, 160, "0.160.0", "PRIVATE_VERSION", "1.2.3\nPRIVATE",
                        "01.2.3", "1.2.3+", "1.2.3-", "1.2.3" + "0" * 129):
            with self.subTest(version=version), self.assertRaises(ContractValidationError):
                validate_contract({**base, "observed_version": version})
        for reason, action, version in (("not_checked", "check_selected_executable", "0.160.0"),
                                       ("version_supported", "none", "0.160.1"),
                                       ("version_supported", "none", None)):
            with self.subTest(reason=reason, version=version), self.assertRaises(ContractValidationError):
                validate_contract({**base, "reason": reason, "action": action, "observed_version": version})

    def test_runtime_check_reports_fixed_reasons_without_process_or_output_details(self):
        cases = (
            ("not_observed", "inspect_owned_runtime"), ("not_configured", "none"),
            ("ready", "none"), ("stopped", "preview_connection"),
            ("owner_unavailable", "inspect_owned_runtime"),
            ("process_exited", "inspect_runtime_executable"),
            ("listening_marker_missing", "inspect_runtime_startup"),
            ("health_unreachable", "inspect_runtime_health"),
            ("health_invalid", "inspect_runtime_health"),
            ("startup_deadline", "inspect_runtime_startup"),
            ("guardian_unavailable", "inspect_owned_runtime"),
            ("guardian_response_invalid", "inspect_owned_runtime"),
            ("verification_failed", "inspect_runtime_files"),
        )
        for reason, action in cases:
            with self.subTest(reason=reason):
                value = {"schema_id": "hormuz.runtime-check", "schema_version": 1,
                         "reason": reason, "action": action}
                validate_contract(value)
                for field, invalid in (("action", "retry_automatically"),
                                       ("reason", "PRIVATE_UNKNOWN_REASON"),
                                       ("schema_version", 2), ("pid", 1234),
                                       ("stdout", "PRIVATE_OUTPUT")):
                    with self.subTest(field=field), self.assertRaises(ContractValidationError):
                        validate_contract({**value, field: invalid})

    def test_failure_details_version_the_lifecycle_error_without_changing_legacy_codes(self):
        for fixture in ("connected-client-error-v1.json", "connected-client-error-v2.json",
                        "connected-client-runtime-error-v2.json"):
            with self.subTest(fixture=fixture):
                value = json.loads((FIXTURES / fixture).read_text())
                before = deepcopy(value)
                validate_contract(value)
                self.assertEqual(value, before)
        client = json.loads((FIXTURES / "connected-client-error-v2.json").read_text())
        runtime = json.loads((FIXTURES / "connected-client-runtime-error-v2.json").read_text())
        invalid = (
            {**client, "schema_version": 1},
            {**client, "diagnostic": {**client["diagnostic"], "schema_id": []}},
            {**client, "diagnostic": runtime["diagnostic"]},
            {**runtime, "diagnostic": client["diagnostic"]},
            {**client, "error": {**client["error"], "action": "use_pinned_client_or_disconnect"}},
            {**client, "error": {**client["error"], "code": "connected_client_configuration_invalid"}},
            {**runtime, "diagnostic": {"schema_id": "hormuz.runtime-check", "schema_version": 1,
                                       "reason": "ready", "action": "none"},
             "error": {**runtime["error"], "action": "none"}},
            {**client, "diagnostic": {"schema_id": "hormuz.client-check", "schema_version": 1,
                                      "reason": "not_checked", "action": "check_selected_executable",
                                      "observed_version": None},
             "error": {**client["error"], "action": "check_selected_executable"}},
        )
        for index, value in enumerate(invalid):
            with self.subTest(invalid=index), self.assertRaises(ContractValidationError):
                validate_contract(value)

    def test_diagnosis_versions_preserve_legacy_output_and_require_new_observations(self):
        for fixture in ("client-diagnosis-v1.json", "client-diagnosis-v2.json"):
            with self.subTest(fixture=fixture):
                value = json.loads((FIXTURES / fixture).read_text())
                before = deepcopy(value)
                validate_contract(value)
                self.assertEqual(value, before)
        for version in (1, 2):
            for code in ("configuration_invalid", "diagnosis_unavailable"):
                validate_contract({"schema_id": "hormuz.client-diagnosis", "schema_version": version,
                                   "error": {"code": code}})
        value = json.loads((FIXTURES / "client-diagnosis-v2.json").read_text())
        for invalid in ({**value, "schema_version": 1}, {**value, "schema_version": 3},
                        {key: item for key, item in value.items() if key != "client_check"},
                        {key: item for key, item in value.items() if key != "runtime_check"},
                        {**value, "model_readiness": "ready"}, {**value, "task_completion": "passed"},
                        {**value, "private_output": "PRIVATE_DETAILS"},
                        {**value, "client_compatibility": "supported"},
                        {**value, "client_check": {**value["client_check"], "schema_version": 2}}):
            with self.subTest(invalid=invalid), self.assertRaises(ContractValidationError):
                validate_contract(invalid)

    def test_manifest_retains_old_lifecycle_versions_and_declares_diagnostic_versions(self):
        manifest = contract_manifest()
        validate_contract_manifest(manifest)
        entries = {(entry["schema_id"], entry["schema_version"]): entry for entry in manifest["schemas"]}
        expected = (("hormuz.connected-client-error", 1), ("hormuz.connected-client-error", 2),
                    ("hormuz.connected-client-status", 1), ("hormuz.connected-client-status", 2),
                    ("hormuz.client-diagnosis", 1), ("hormuz.client-diagnosis", 2),
                    ("hormuz.client-check", 1), ("hormuz.runtime-check", 1))
        for identity in expected:
            with self.subTest(identity=identity):
                self.assertTrue(identity in entries, identity)
        self.assertIn("diagnostic", entries[("hormuz.connected-client-error", 2)]["fields"])
        self.assertIn("client_check", entries[("hormuz.client-diagnosis", 2)]["fields"])
        self.assertIn("runtime_check", entries[("hormuz.client-diagnosis", 2)]["fields"])

    def test_malformed_nested_observations_fail_with_contract_errors(self):
        base = json.loads((FIXTURES / "client-diagnosis-v2.json").read_text())
        cases = (("project_state", []), ("launch_state", {}), ("layers", "PRIVATE_OUTPUT"),
                 ("conflicts", True), ("effective_routing", {"model": []}))
        for field, invalid in cases:
            value = deepcopy(base)
            value["override_diagnosis"][field] = invalid
            with self.subTest(field=field), self.assertRaises(ContractValidationError):
                validate_contract(value)
        value = deepcopy(base)
        value["override_diagnosis"]["effective_routing"]["model"] = []
        with self.assertRaises(ContractValidationError):
            validate_contract(value)

    def test_unobserved_runtime_failure_retains_unknown_cause(self):
        value = {"schema_id": "hormuz.connected-client-error", "schema_version": 2,
                 "error": {"code": "connected_client_runtime_start_failed", "action": "inspect_owned_runtime"},
                 "diagnostic": {"schema_id": "hormuz.runtime-check", "schema_version": 1,
                                "reason": "not_observed", "action": "inspect_owned_runtime"}}
        validate_contract(value)
        for reason, action in (("not_configured", "none"), ("ready", "none"), ("stopped", "preview_connection")):
            invalid = {**value, "error": {**value["error"], "action": action},
                       "diagnostic": {**value["diagnostic"], "reason": reason, "action": action}}
            with self.subTest(reason=reason), self.assertRaises(ContractValidationError):
                validate_contract(invalid)

    def test_supported_client_observation_must_match_the_selected_diagnosis_profile(self):
        value = json.loads((FIXTURES / "client-diagnosis-v2.json").read_text())
        value["client_compatibility"] = "supported"
        value["client_check"] = {"schema_id": "hormuz.client-check", "schema_version": 1,
                                 "reason": "version_supported", "action": "none",
                                 "observed_version": "0.160.0"}
        validate_contract(value)
        value["client_check"]["observed_version"] = "0.147.0"
        with self.assertRaises(ContractValidationError):
            validate_contract(value)
        value["supported_client_version"] = "0.147.0"
        value["override_diagnosis"]["supported_client_version"] = "0.147.0"
        validate_contract(value)

    def test_runtime_diagnosis_matches_current_owned_status_without_replaying_startup(self):
        base = json.loads((FIXTURES / "client-diagnosis-v2.json").read_text())
        owned = json.loads((FIXTURES / "connected-client-status-v2.json").read_text())
        cases = (
            (None, "not_configured", "none"),
            (None, "not_observed", "inspect_owned_runtime"),
            ("ready", "ready", "none"),
            ("stopped", "stopped", "preview_connection"),
            ("unavailable", "owner_unavailable", "inspect_owned_runtime"),
            ("stopping", "owner_unavailable", "inspect_owned_runtime"),
        )
        observations = (("not_configured", "none"), ("not_observed", "inspect_owned_runtime"),
                        ("ready", "none"), ("stopped", "preview_connection"),
                        ("owner_unavailable", "inspect_owned_runtime"),
                        ("process_exited", "inspect_runtime_executable"),
                        ("health_invalid", "inspect_runtime_health"))
        for state, reason, action in cases:
            with self.subTest(state=state, reason=reason):
                value = deepcopy(base)
                if state is not None:
                    value["connection"] = deepcopy(owned)
                    value["connection"]["router"] = state
                    value["connection"]["local_runtime"]["state"] = state
                    if state == "stopped":
                        value["connection"].update(phase="disconnected", configuration="not_owned")
                value["runtime_check"] = {"schema_id": "hormuz.runtime-check", "schema_version": 1,
                                         "reason": reason, "action": action}
                validate_contract(value)
                for invalid_reason, invalid_action in observations:
                    if invalid_reason == reason or state is None and invalid_reason in {"not_observed", "not_configured"}:
                        continue
                    invalid = {**value, "runtime_check": {**value["runtime_check"],
                               "reason": invalid_reason, "action": invalid_action}}
                    with self.subTest(invalid_reason=invalid_reason), self.assertRaises(ContractValidationError):
                        validate_contract(invalid)


if __name__ == "__main__":
    unittest.main()
