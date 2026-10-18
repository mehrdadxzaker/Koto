"""Personal selection through history CLI and connected-client routing."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest

from tests import test_execution_destination_workflow as workflow
from hormuz.contracts import validate_contract


class PersonalSelectionWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.fixture = workflow.ExecutionDestinationWorkflowTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root.resolve()
        self.fixture.root = self.root
        self.config_path = self.root / "gateway.json"
        self.fixture.environment["KOTO_HISTORY_HOME"] = str(self.root / "history")
        self.environment = {**os.environ, **self.fixture.environment}

    def history(self, *arguments, expected=0):
        result = subprocess.run([sys.executable, "-m", "koto", "--config", str(self.config_path),
                                 "history", *arguments], env=self.environment,
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, expected, result.stderr or result.stdout)
        value = json.loads(result.stdout)
        if value["schema_id"].startswith("koto."):
            validate_contract(value)
        return value

    def assess(self, submit, prompt, model, answer, *, partition="development"):
        headers = {} if model == "cloud-code" else {"X-Hormuz-Routing-Mode": "local_only", "X-Hormuz-Task-Selection": "model"}
        response = submit(request={"model": model, "input": prompt}, headers=headers)
        self.assertEqual(response["status"], 200, response)
        entry = self.history("list")["entries"][0]["id"]
        checks = self.root / "checks.json"
        checks.write_text(json.dumps([{"metric": "count", "kind": "text_equals", "value": answer}]))
        self.history("feedback", entry, "--checks", str(checks), "--partition", partition)
        return entry

    def two_local_configuration(self, local, second, cloud):
        value = self.fixture.admission_configuration(local, cloud, mode="auto")
        value["upstreams"]["second-local"] = {"protocol": "openai", "base_url": second, "locality": "local", "authentication": "none"}
        value["model_routes"]["local-second"] = {**value["model_routes"]["local-code"], "destination": "second-local", "upstream_model": "second-model"}
        value["route_admission"]["local_routes"]["local-second"] = {**value["route_admission"]["local_routes"]["local-code"], "qualification_id": "fixture-q2"}
        value["policies"]["organization"]["allowed_models"].append("local-second")
        return value

    def test_one_classifier_observes_multiple_local_classes_without_an_extra_model_call(self):
        def slower_cloud(body):
            time.sleep(0.04)
            return "7" if "invoice" in body["input"] else "9"
        with workflow.provider("7") as (local, local_calls), workflow.provider("9") as (second, second_calls), \
             workflow.provider(slower_cloud) as (cloud, cloud_calls):
            with self.fixture.connected_client(self.two_local_configuration(local, second, cloud)) as submit:
                self.history("enable")
                self.history("learning", "enable")
                for prompt, answer in (("Summarize invoice tally seven boxes.", "7"),
                                       ("Summarize inventory report nine crates.", "9")):
                    for model in ("cloud-code", "local-code", "local-second"):
                        self.assess(submit, prompt, model, answer)
                for prompt, expected in (("Summarize invoice tally seven boxes today.", "local-code"),
                                         ("Summarize inventory report nine crates today.", "local-second")):
                    response = submit(request={"model": "cloud-code", "input": prompt})
                    self.assertEqual(response["headers"].get("x-koto-selection-model"), expected)
                    self.assertEqual(response["headers"].get("x-hormuz-destination-locality"), "cloud")
                    self.assertEqual(response["headers"].get("x-koto-selection-mode"), "observe")
                self.assertEqual(self.history("learning", "status")["mode"], "observe")
            self.assertEqual((len(local_calls), len(second_calls), len(cloud_calls)), (2, 2, 4))

    def test_held_out_validation_enables_selection_then_deletion_and_unfamiliar_work_use_the_baseline(self):
        def cloud_answer(body):
            time.sleep(0.04)
            text = body["input"]
            return "7" if "invoice" in text else "9" if "inventory" in text else "18"
        with workflow.provider("7") as (local, local_calls), workflow.provider("9") as (second, second_calls), \
             workflow.provider(cloud_answer) as (cloud, cloud_calls):
            with self.fixture.connected_client(self.two_local_configuration(local, second, cloud)) as submit:
                self.history("enable")
                self.history("learning", "enable")
                early = self.history("learning", "validate", "--baseline", "cloud-code", "--activate", expected=2)
                self.assertFalse(early["passed"])
                retained = []
                for partition, suffix in (("development", ""), ("held_out", " today")):
                    for prompt, answer in (("Summarize invoice tally seven boxes", "7"),
                                           ("Summarize inventory report nine crates", "9"),
                                           ("Summarize confidential analysis eighteen packages", "18")):
                        for model in ("cloud-code", "local-code", "local-second"):
                            retained.append(self.assess(submit, prompt + suffix, model, answer, partition=partition))
                receipt = self.history("learning", "validate", "--baseline", "cloud-code", "--activate")
                self.assertEqual((receipt["passed"], receipt["held_out_cases"], receipt["false_local"], receipt["local_selections"]),
                                 (True, 3, 0, 2))
                before = tuple(map(len, (local_calls, second_calls, cloud_calls)))
                for prompt, expected in (("Summarize invoice tally seven boxes tomorrow", "local-code"),
                                         ("Summarize inventory report nine crates tomorrow", "local-second"),
                                         ("Summarize confidential analysis eighteen packages tomorrow", "cloud-code"),
                                         ("Translate salut into English", "cloud-code")):
                    response = submit(request={"model": "cloud-code", "input": prompt})
                    self.assertEqual(response["headers"].get("x-koto-executed-model"), expected, response)
                self.assertEqual(tuple(len(calls) - count for calls, count in zip((local_calls, second_calls, cloud_calls), before)), (1, 1, 2))
                state = submit(method="GET", path="/router/state")["body"]
                validate_contract(state)
                self.assertEqual((state["schema_version"], state["personal_selection"]["validation_status"]), (3, "current"))
                changed_budget = submit(request={"model": "cloud-code", "input": "Summarize invoice tally seven boxes tomorrow", "max_output_tokens": 7})
                self.assertEqual((changed_budget["headers"].get("x-koto-executed-model"), changed_budget["headers"].get("x-koto-selection-status")),
                                 ("cloud-code", "validation_required"))
                local_only = submit(request={"model": "cloud-code", "input": "Summarize invoice tally seven boxes tomorrow"},
                                    headers={"X-Hormuz-Routing-Mode": "local_only", "X-Hormuz-Task-Selection": "router"})
                self.assertEqual(local_only["headers"].get("x-koto-executed-model"), "local-code")
                self.history("delete", retained[0])
                response = submit(request={"model": "cloud-code", "input": "Summarize invoice tally seven boxes tomorrow"})
                self.assertEqual(response["headers"].get("x-koto-executed-model"), "cloud-code")
                self.assertEqual(response["headers"].get("x-koto-selection-status"), "validation_required")

    def test_bounded_local_evaluation_uses_history_checks_without_sending_references_or_contacting_cloud(self):
        with workflow.provider("7") as (local, local_calls), workflow.provider("7") as (cloud, cloud_calls):
            with self.fixture.connected_client(self.fixture.admission_configuration(local, cloud, mode="auto")) as submit:
                self.history("enable")
                self.history("learning", "enable")
                source = self.assess(submit, "Summarize seven boxes.", "cloud-code", "7", partition="held_out")
                refused = self.history("learning", "evaluate", "--id", source, "--models", "cloud-code", expected=2)
                self.assertEqual(refused["error"]["code"], "personal_selection_local_evaluation_only")
                result = self.history("learning", "evaluate", "--id", source, "--models", "local-code",
                                      "--max-requests", "1", "--deadline-seconds", "5", "--timeout-seconds", "3")
                self.assertEqual((result["planned"], result["submitted"], result["passed"]), (1, 1, 1))
                self.assertEqual((len(local_calls), len(cloud_calls)), (1, 1))
                self.assertNotIn("checks", json.dumps(local_calls[0]["body"]))
                self.assertNotIn("count", json.dumps(local_calls[0]["body"]))
                scorecard = self.history("learning", "scorecard")
                local_score = next(row for row in scorecard["models"] if row["model"] == "local-code")
                self.assertEqual(local_score["quality"], {"pass": 1, "fail": 0, "unknown": 0})

    def test_local_only_denies_unknown_personal_selection_without_commercial_egress(self):
        with workflow.provider("7") as (local, local_calls), workflow.provider("7") as (cloud, cloud_calls):
            with self.fixture.connected_client(self.fixture.admission_configuration(local, cloud, mode="auto")) as submit:
                self.history("enable")
                self.history("learning", "enable")
                result = submit(request={"model": "cloud-code", "input": "Summarize unfamiliar cobalt mission."},
                                headers={"X-Hormuz-Routing-Mode": "local_only", "X-Hormuz-Task-Selection": "router"})
                self.assertEqual(result["status"], 503, result)
                self.assertEqual((local_calls, cloud_calls), ([], []))

    def test_legacy_binary_classifier_configuration_is_rejected_without_starting_inference(self):
        with workflow.provider("7") as (local, local_calls), workflow.provider("7") as (cloud, cloud_calls):
            value = self.fixture.admission_configuration(local, cloud, mode="auto")
            value["ai_work"] = {"enabled": True, "database": str(self.root / "work.sqlite3")}
            value["shadow_router"] = {"schema_version": 1, "mode": "shadow", "model": "local-code", "local_model": "local-code"}
            self.config_path.write_text(json.dumps(value))
            before = self.config_path.read_bytes()
            result = subprocess.run([sys.executable, "-m", "koto", "--config", str(self.config_path), "client", "config", "codex"],
                                    env=self.environment, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 2, result.stdout)
            self.assertIn("retired", result.stderr + result.stdout)
            self.assertEqual(self.config_path.read_bytes(), before)
            self.assertEqual((local_calls, cloud_calls), ([], []))

    def test_evaluation_refuses_a_task_that_would_require_truncating_retained_input(self):
        with workflow.provider("7") as (local, local_calls), workflow.provider("7") as (cloud, cloud_calls):
            value = self.fixture.admission_configuration(local, cloud, mode="auto")
            value["route_admission"]["local_routes"]["local-code"]["max_request_bytes"] = 20000
            with self.fixture.connected_client(value) as submit:
                self.history("enable")
                self.history("learning", "enable")
                source = self.assess(submit, "Summarize seven boxes. " + "details " * 1100, "cloud-code", "7")
                result = self.history("learning", "evaluate", "--id", source, "--models", "local-code", expected=2)
                self.assertEqual(result["error"]["code"], "personal_selection_evaluation_source_invalid")
                self.assertEqual((len(local_calls), len(cloud_calls)), (0, 1))

    def test_failed_held_out_local_checks_remain_in_the_denominator_and_prevent_activation(self):
        def slow_cloud(_body):
            time.sleep(.04)
            return "7"
        def local_answer(body):
            return "WRONG" if "held" in body["input"] else "7"
        with workflow.provider(local_answer) as (local, _), workflow.provider(slow_cloud) as (cloud, _):
            with self.fixture.connected_client(self.fixture.admission_configuration(local, cloud, mode="auto")) as submit:
                self.history("enable")
                self.history("learning", "enable")
                for partition, suffix in (("development", ""), ("held_out", " held")):
                    for tag in ("alpha", "beta", "gamma"):
                        for model in ("cloud-code", "local-code"):
                            self.assess(submit, "Summarize seven invoice boxes " + tag + suffix, model, "7", partition=partition)
                result = self.history("learning", "validate", "--baseline", "cloud-code", "--activate", expected=2)
                self.assertEqual((result["held_out_cases"], result["false_local"], result["passed"]), (3, 3, False))
                self.assertEqual(self.history("learning", "status")["mode"], "observe")
                scores = self.history("learning", "scorecard")["models"]
                self.assertEqual(next(row for row in scores if row["model"] == "local-code")["quality"]["fail"], 3)

    def test_model_revision_change_drops_stale_local_recommendations(self):
        def slow_cloud(_body):
            time.sleep(.04)
            return "7"
        with workflow.provider("7") as (local, _), workflow.provider(slow_cloud) as (cloud, _):
            value = self.fixture.admission_configuration(local, cloud, mode="auto")
            with self.fixture.connected_client(value) as submit:
                self.history("enable")
                self.history("learning", "enable")
                for model in ("cloud-code", "local-code"):
                    self.assess(submit, "Summarize seven invoice boxes", model, "7")
                before = submit(request={"model": "cloud-code", "input": "Summarize seven invoice boxes today"})
                self.assertEqual(before["headers"].get("x-koto-selection-model"), "local-code")
            value["model_routes"]["local-code"]["model_revision"] = "fixture-weights-v2"
            value["route_admission"]["local_routes"]["local-code"]["model_revision"] = "fixture-weights-v2"
            with self.fixture.connected_client(value) as submit:
                after = submit(request={"model": "cloud-code", "input": "Summarize seven invoice boxes today"})
                self.assertEqual(after["headers"].get("x-koto-selection-model"), "cloud-code")

    def test_learning_preserves_native_tool_continuation_affinity(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/codex-conversation-request-v1.json").read_text())
        with workflow.provider("LOCAL", event_stream=True) as (local, local_calls), workflow.provider("CLOUD") as (cloud, cloud_calls):
            value = self.fixture.admission_configuration(local, cloud, mode="auto")
            value["model_routes"]["local-code"]["capabilities"].extend(["streaming", "tools", "codex_http"])
            value["ai_work"] = {"enabled": True, "database": str(self.root / "work.sqlite3"), "tool_capable_aliases": ["local-code"]}
            with self.fixture.connected_client(value) as submit:
                self.history("enable")
                self.history("learning", "enable")
                first = submit(control=True, headers=fixture["headers"], request=fixture["request"])
                self.assertEqual(first["status"], 200, first)
                second = submit(headers=fixture["headers"], request={"stream": True,
                    "client_metadata": fixture["request"]["client_metadata"], "input": [
                        {"type": "function_call_output", "call_id": "fixture-call", "output": "Fixture tool result"}]})
                self.assertEqual((second["status"], second["headers"].get("x-hormuz-routing-reason")), (200, "session_affinity"))
                self.assertEqual(second["headers"].get("x-hormuz-destination-generation"), first["headers"].get("x-hormuz-destination-generation"))
                self.assertEqual(local_calls[1]["body"]["input"][0]["call_id"], "fixture-call")
            self.assertEqual((len(local_calls), len(cloud_calls)), (2, 0))

    def test_learning_requires_separate_consent_and_http_success_is_not_task_success(self):
        with workflow.provider("7") as (local, local_requests), workflow.provider("7") as (cloud, cloud_requests):
            value = self.fixture.admission_configuration(local, cloud, mode="auto")
            with self.fixture.connected_client(value) as submit:
                self.history("enable")
                self.assertFalse(self.history("learning", "status")["enabled"])
                self.history("learning", "enable")
                self.assertEqual(submit(request={"model": "cloud-code", "input": "Summarize seven boxes."})["status"], 200)
                scorecard = self.history("learning", "scorecard")
                self.assertEqual(scorecard["models"][0]["quality"], {"pass": 0, "fail": 0, "unknown": 1})
                entry = self.history("list")["entries"][0]["id"]
                feedback = self.history("feedback", entry, "--result", "pass")
                self.assertEqual(feedback["quality"], "pass")
                scorecard = self.history("learning", "scorecard")
                self.assertEqual(scorecard["models"][0]["quality"], {"pass": 1, "fail": 0, "unknown": 0})
                self.assertEqual(scorecard["models"][0]["model"], "cloud-code")
                self.history("disable")
                self.assertFalse(self.history("learning", "status")["enabled"])
            self.assertEqual((len(local_requests), len(cloud_requests)), (0, 1))

    def test_independent_checks_score_the_retained_response_and_deletion_removes_learning_evidence(self):
        with workflow.provider("7") as (local, _), workflow.provider("7") as (cloud, _):
            with self.fixture.connected_client(self.fixture.admission_configuration(local, cloud, mode="auto")) as submit:
                self.history("enable")
                self.history("learning", "enable")
                self.assertEqual(submit(request={"model": "cloud-code", "input": "Summarize seven boxes."})["status"], 200)
                entry = self.history("list")["entries"][0]["id"]
                checks = self.root / "checks.json"
                checks.write_text(json.dumps([{"metric": "count", "kind": "text_equals", "value": "9"}]))
                result = self.history("feedback", entry, "--checks", str(checks), "--partition", "held_out")
                self.assertEqual((result["quality"], result["source"]), ("fail", "independent_check"))
                self.assertEqual(self.history("learning", "scorecard")["models"][0]["quality"]["fail"], 1)
                checks.write_text(json.dumps([{"metric": "count", "kind": "text_equals", "value": "7"}]))
                self.assertEqual(self.history("feedback", entry, "--checks", str(checks))["quality"], "pass")
                summary = self.history("list")["entries"][0]
                self.assertNotIn("checks", json.dumps(summary))
                self.history("delete", entry)
                self.assertEqual(self.history("learning", "scorecard")["models"], [])
