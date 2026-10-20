"""Native host observations through consented history and its public CLI."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from hormuz.config import GatewayConfig
from hormuz.local_history import LocalHistory
from hormuz.local_history_files import LocalHistoryError


class NativeHistoryWorkflowTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.path = self.root / "gateway.json"
        self.environment = {**os.environ, "KOTO_HISTORY_HOME": str(self.root / "history"),
                            "NATIVE_HISTORY_IDENTITY": "native-history-identity-credential"}
        self.path.write_text(json.dumps({
            "database": str(self.root / "usage.sqlite3"),
            "upstreams": {"openai": {"base_url": "https://chatgpt.com/backend-api/codex",
                                      "authentication": "codex_chatgpt"},
                          "local": {"protocol": "openai", "base_url": "http://127.0.0.1:9/v1", "locality": "local",
                                    "authentication": "none"}},
            "identities": [{"actor_id": "developer", "actor_name": "Developer", "team_id": "personal",
                            "team_name": "Personal", "token_env": "NATIVE_HISTORY_IDENTITY"}],
            "model_routes": {"subscription": {"protocol": "openai", "upstream_model": "native-model"},
                             "local-model": {"protocol": "openai", "destination": "local",
                                             "upstream_model": "local-weights"}},
            "policies": {"organization": {}},
        }))
        self.config = GatewayConfig.load(self.path, environ=self.environment)
        self.store = LocalHistory(self.path, environ=self.environment)

    def history(self, *arguments, expected=0):
        result = subprocess.run([sys.executable, "-m", "koto", "--config", str(self.path),
                                 "history", *arguments], env=self.environment,
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, expected, result.stderr or result.stdout)
        return json.loads(result.stdout)

    def begin(self, prompt="Summarize seven boxes.", model="subscription", **options):
        from hormuz.native_history import begin_host_attempt
        return begin_host_attempt(self.store, self.config, "developer", model, prompt, "a" * 64, **options)

    def test_completed_native_turn_keeps_unknown_usage_and_requires_independent_quality(self):
        self.history("enable")
        self.history("learning", "enable")
        attempt = self.begin()
        entry_id = attempt.finish({"outcome": "succeeded", "complete": True,
                                   "text": "7", "latency_ms": 125}, execution_verified=True)
        entry = self.history("show", entry_id)["entry"]
        self.assertEqual((entry["schema_version"], entry["protocol"]), (4, "codex_app_server"))
        self.assertEqual((entry["requested_model"], entry["routed_model"], entry["destination"], entry["locality"]),
                         ("subscription", "native-model", "openai", "cloud"))
        self.assertEqual((entry["outcome"], entry["response_text"], entry["latency_ms"]), ("succeeded", "7", 125))
        self.assertTrue(entry["selection"]["verified_response"])
        self.assertTrue(entry["selection"]["fresh"])
        self.assertFalse(entry["selection"]["replayable"])
        self.assertEqual(entry["selection"]["profile"], "a" * 64)
        self.assertNotIn("quality", entry)
        for field in ("http_status", "input_tokens", "output_tokens", "estimated_cost_microusd"):
            self.assertIsNone(entry[field], field)
        checks = self.root / "checks.json"
        checks.write_text(json.dumps([{"metric": "count", "kind": "text_equals", "value": "7"}]))
        feedback = self.history("feedback", entry_id, "--checks", str(checks), "--partition", "held_out")
        self.assertEqual((feedback["quality"], feedback["source"]), ("pass", "independent_check"))
        self.assertEqual(self.history("show", entry_id)["entry"]["schema_version"], 4)

    def test_incomplete_and_unverified_native_observations_never_become_checked_success(self):
        self.history("enable")
        self.history("learning", "enable")
        checks = self.root / "checks.json"
        checks.write_text(json.dumps([{"metric": "answer", "kind": "text_equals", "value": "partial answer"}]))
        cases = (("failed", False, True, "failed"), ("outcome_unknown", False, True, "outcome_unknown"),
                 ("succeeded", False, True, "outcome_unknown"), ("succeeded", True, False, "succeeded"))
        for outcome, complete, verified, retained_outcome in cases:
            with self.subTest(outcome=outcome, complete=complete, verified=verified):
                entry_id = self.begin().finish({"outcome": outcome, "complete": complete,
                                                "text": "partial answer", "latency_ms": 30}, execution_verified=verified)
                entry = self.history("show", entry_id)["entry"]
                self.assertEqual(entry["outcome"], retained_outcome)
                self.assertEqual(entry["response_text"], "partial answer")
                self.assertEqual(entry["response_content_status"], "captured" if complete else "partial")
                self.assertFalse(entry["selection"]["verified_response"])
                self.assertEqual(self.history("feedback", entry_id, "--checks", str(checks))["quality"], "unknown")
                rejected = self.history("feedback", entry_id, "--result", "pass", expected=2)
                self.assertEqual(rejected["error"]["code"], "personal_selection_attempt_incomplete")

    def test_native_usage_is_retained_only_as_explicit_nonnegative_integer_observations(self):
        self.history("enable")
        observation = {"outcome": "succeeded", "complete": True, "text": "7", "latency_ms": 12,
                       "input_tokens": 0, "output_tokens": 3}
        entry_id = self.begin().finish(observation)
        entry = self.history("show", entry_id)["entry"]
        self.assertEqual((entry["input_tokens"], entry["output_tokens"]), (0, 3))
        self.assertIsNone(entry["http_status"])
        self.assertIsNone(entry["estimated_cost_microusd"])
        for field in ("input_tokens", "output_tokens", "latency_ms"):
            for invalid in (-1, True, 1.5):
                with self.subTest(field=field, invalid=invalid):
                    with self.assertRaises(LocalHistoryError):
                        self.begin().finish({**observation, field: invalid})
        self.assertEqual(len(self.history("list")["entries"]), 1)

    def test_learning_opt_out_preserves_plain_native_history_without_resurrecting_old_consent(self):
        self.history("enable")
        self.history("learning", "enable")
        pending = self.begin()
        self.history("learning", "disable")
        self.history("learning", "enable")
        entry_id = pending.finish({"outcome": "succeeded", "complete": True, "text": "7", "latency_ms": 1},
                                  execution_verified=True)
        entry = self.history("show", entry_id)["entry"]
        self.assertEqual((entry["schema_version"], entry["protocol"], entry["response_text"]), (4, "codex_app_server", "7"))
        self.assertNotIn("selection", entry)
        self.assertNotIn("quality", entry)
        self.assertEqual(self.history("learning", "scorecard")["models"], [])
        self.history("learning", "disable")
        entry_id = self.begin().finish({"outcome": "failed", "complete": False, "text": "retained failure", "latency_ms": 1})
        self.assertNotIn("selection", self.history("show", entry_id)["entry"])

    def test_history_opt_out_and_deletion_discard_pending_attempts_without_enabling_capture(self):
        self.assertIsNone(self.begin())
        self.assertFalse(self.history("status")["enabled"])
        self.history("enable")
        self.history("learning", "enable")
        observation = {"outcome": "succeeded", "complete": True, "text": "7", "latency_ms": 1}
        for action in ("disable", "delete"):
            with self.subTest(action=action):
                pending = self.begin()
                self.history(action, *(('--all',) if action == 'delete' else ()))
                self.history("enable")
                self.assertIsNone(pending.finish(observation, execution_verified=True))
                self.assertEqual(self.history("list")["entries"], [])

    def test_native_text_capture_omits_over_limit_content_without_granting_verified_quality(self):
        self.history("enable")
        self.history("learning", "enable")
        entry_id = self.begin(prompt="x" * (64 * 1024 + 1)).finish({
            "outcome": "succeeded", "complete": True, "text": "small answer", "latency_ms": 1}, execution_verified=True)
        entry = self.history("show", entry_id)["entry"]
        self.assertEqual((entry["request_content_status"], entry["request_text"]), ("omitted_limit", []))
        self.assertNotIn("selection", entry)
        entry_id = self.begin().finish({"outcome": "succeeded", "complete": True,
                                        "text": "y" * (256 * 1024 + 1), "latency_ms": 1}, execution_verified=True)
        entry = self.history("show", entry_id)["entry"]
        self.assertEqual((entry["response_content_status"], entry["response_text"]), ("omitted_limit", ""))
        self.assertFalse(entry["selection"]["verified_response"])

    def test_native_entries_cannot_claim_http_status_or_provider_pricing(self):
        self.history("enable")
        entry_id = self.begin().finish({"outcome": "succeeded", "complete": True, "text": "7", "latency_ms": 1})
        entry = self.history("show", entry_id)["entry"]
        record = {name: value for name, value in entry.items() if name not in {"schema_id", "schema_version"}}
        for field, invalid in (("http_status", 200), ("estimated_cost_microusd", 0)):
            with self.subTest(field=field):
                with self.assertRaises(LocalHistoryError):
                    self.store.append(self.store.begin("developer"), {**record, "id": uuid4().hex, field: invalid})
        self.assertEqual(len(self.history("list")["entries"]), 1)

    def test_native_history_always_redacts_and_keeps_content_encrypted(self):
        value = json.loads(self.path.read_text())
        value["egress_controls"] = {"secrets": {"mode": "off", "builtins": False,
                                                   "custom_secret_envs": ["NATIVE_HISTORY_CUSTOM"]}}
        self.environment["NATIVE_HISTORY_CUSTOM"] = "custom-native-history-secret"
        self.path.write_text(json.dumps(value))
        self.config = GatewayConfig.load(self.path, environ=self.environment)
        storage = Path(self.history("enable")["storage_path"])
        self.history("learning", "enable")
        secrets = (self.environment["NATIVE_HISTORY_IDENTITY"], self.environment["NATIVE_HISTORY_CUSTOM"],
                   "ghp_" + "A" * 30)
        content = "Retain this native text, hide " + " ".join(secrets)
        entry_id = self.begin(prompt=content).finish({"outcome": "failed", "complete": False,
                                                    "text": content, "latency_ms": 1})
        entry = self.history("show", entry_id)["entry"]
        self.assertIn("Retain this native text", entry["response_text"])
        self.assertIn("[REDACTED:HORMUZ_SECRET]", entry["response_text"])
        for secret in secrets:
            self.assertNotIn(secret, json.dumps(entry))
        for path in storage.rglob("*"):
            if path.is_file():
                self.assertNotIn(b"Retain this native text", path.read_bytes())
        self.assertNotIn("request_text", json.dumps(self.history("list")))

    def test_native_v4_and_legacy_history_v1_v2_v3_remain_reviewable_together(self):
        self.history("enable")
        self.history("learning", "enable")
        entry_id = self.begin().finish({"outcome": "succeeded", "complete": True, "text": "7", "latency_ms": 1},
                                       execution_verified=True)
        native = self.history("show", entry_id)["entry"]
        record = {name: value for name, value in native.items() if name not in {"schema_id", "schema_version"}}
        legacy = {name: value for name, value in record.items() if name != "selection"}
        evidence = {"schema_version": 1, "policy_action": "allow", "routing_mode": "auto",
                    "routing_reason": "configured", "fallback": False}
        for version, fields in ((1, {}), (2, {"routing_evidence": evidence}), (3, {"selection": record["selection"]})):
            retained_id = uuid4().hex
            self.assertTrue(self.store.append(self.store.begin("developer"), {
                **legacy, **fields, "id": retained_id, "protocol": "openai"}))
            self.assertEqual(self.history("show", retained_id)["entry"]["schema_version"], version)
        self.assertEqual(self.history("show", entry_id)["entry"]["schema_version"], 4)
        self.assertEqual(len(self.history("list")["entries"]), 4)

    def test_escaped_native_text_is_bounded_before_the_encrypted_record_limit(self):
        self.history("enable")
        for prompt, answer, omitted in (("\x00" * 60000, "answer", "request"),
                                        ("prompt", "\x00" * 100000, "response")):
            with self.subTest(omitted=omitted):
                entry_id = self.begin(prompt=prompt).finish({"outcome": "failed", "complete": False,
                                                            "text": answer, "latency_ms": 1})
                entry = self.history("show", entry_id)["entry"]
                self.assertEqual(entry[omitted + "_content_status"], "omitted_limit")

    def test_malformed_host_observations_are_rejected_without_creating_history(self):
        self.history("enable")
        observation = {"outcome": "succeeded", "complete": True, "text": "7", "latency_ms": 1}
        for fields in ({"outcome": []}, {"complete": "completed"}, {"text": {}}, {"http_status": 200}):
            with self.subTest(fields=fields):
                with self.assertRaises(LocalHistoryError):
                    self.begin().finish({**observation, **fields}, execution_verified=True)
        self.assertEqual(self.history("list")["entries"], [])

    def test_local_host_observation_preserves_local_identity_without_inventing_usage_or_quality(self):
        self.history("enable")
        self.history("learning", "enable")
        entry_id = self.begin(model="local-model").finish({"outcome": "succeeded", "complete": True,
                                                          "text": "7", "latency_ms": 3})
        entry = self.history("show", entry_id)["entry"]
        self.assertEqual((entry["requested_model"], entry["routed_model"], entry["destination"], entry["locality"]),
                         ("local-model", "local-weights", "local", "local"))
        self.assertEqual(entry["cost_reason"], "local_compute_unpriced")
        self.assertFalse(entry["selection"]["verified_response"])
        self.assertNotIn("quality", entry)
        self.assertRegex(entry["selection"]["route"], r"^destination-v1:[0-9a-f]{64}$")
        for name in ("profile", "machine", "task"):
            self.assertRegex(entry["selection"][name], r"^[0-9a-f]{64}$")

    def test_configured_provider_credentials_are_redacted_from_native_prompt_and_response(self):
        secret = "plain-native-history-provider-credential"
        self.environment["NATIVE_HISTORY_PROVIDER_KEY"] = secret
        value = json.loads(self.path.read_text())
        value["upstreams"]["api-provider"] = {"protocol": "openai", "base_url": "https://example.invalid/v1",
                                                 "api_key_env": "NATIVE_HISTORY_PROVIDER_KEY"}
        self.path.write_text(json.dumps(value))
        self.config = GatewayConfig.load(self.path, environ=self.environment)
        self.history("enable")
        with patch.dict(os.environ, self.environment):
            pending = self.begin(prompt="Never retain this configured key: " + secret)
        entry_id = pending.finish({"outcome": "failed", "complete": False,
                                   "text": "Do not retain the configured key: " + secret, "latency_ms": 1})
        entry = self.history("show", entry_id)["entry"]
        self.assertNotIn(secret, json.dumps(entry))
        self.assertIn("[REDACTED:HORMUZ_SECRET]", entry["request_text"][0]["text"])
        self.assertIn("[REDACTED:HORMUZ_SECRET]", entry["response_text"])


if __name__ == "__main__":
    unittest.main()
