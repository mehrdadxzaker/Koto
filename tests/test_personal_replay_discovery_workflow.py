"""Local replay discovery through history CLI and connected-client routing."""
import json
import os
import subprocess
import sys
import unittest

from hormuz.contracts import validate_contract
from tests import test_execution_destination_workflow as workflow


class PersonalReplayDiscoveryWorkflowTests(unittest.TestCase):
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
        completed = subprocess.run([sys.executable, "-m", "koto", "--config", str(self.config_path),
                                    "history", *arguments], env=self.environment,
                                   capture_output=True, text=True, timeout=10)
        self.assertEqual(completed.returncode, expected, completed.stderr or completed.stdout)
        self.assertTrue(completed.stdout, completed.stderr)
        value = json.loads(completed.stdout)
        if value["schema_id"].startswith("koto."):
            validate_contract(value)
        return value

    def checked_source(self, submit, prompt="Summarize seven invoice boxes."):
        response = submit(request={"model": "cloud-code", "input": prompt})
        self.assertEqual(response["status"], 200, response)
        source = self.history("list")["entries"][0]["id"]
        checks = self.root / "checks.json"
        checks.write_text(json.dumps([{"metric": "count", "kind": "text_equals", "value": "7"}]))
        self.history("feedback", source, "--checks", str(checks))
        return source

    def two_local_configuration(self, local, second, cloud):
        value = self.fixture.admission_configuration(local, cloud, mode="auto")
        value["upstreams"]["second-local"] = {"protocol": "openai", "base_url": second,
                                                "locality": "local", "authentication": "none"}
        value["model_routes"]["local-second"] = {**value["model_routes"]["local-code"],
                                                   "destination": "second-local", "upstream_model": "second-model"}
        value["route_admission"]["local_routes"]["local-second"] = {
            **value["route_admission"]["local_routes"]["local-code"], "qualification_id": "fixture-q2"}
        value["policies"]["organization"]["allowed_models"].append("local-second")
        return value

    def test_replay_discovers_qualified_locals_and_retains_failed_evidence_without_commercial_replay(self):
        with workflow.provider("7") as (local, local_calls), \
             workflow.provider("WRONG") as (second, second_calls), \
             workflow.provider("7") as (cloud, cloud_calls):
            with self.fixture.connected_client(self.two_local_configuration(local, second, cloud)) as submit:
                before = self.config_path.read_bytes()
                self.history("enable")
                self.history("learning", "enable")
                source = self.checked_source(submit)
                result = self.history("learning", "evaluate", "--id", source, "--max-requests", "2",
                                      "--timeout-seconds", "3", "--deadline-seconds", "5", expected=2)
                self.assertEqual((result["planned"], result["submitted"], result["passed"]), (2, 2, 1))
                self.assertEqual([(row["model"], row["quality"], row["error"]) for row in result["observations"]],
                                 [("local-code", "pass", None), ("local-second", "fail", None)])
                self.assertEqual((len(local_calls), len(second_calls), len(cloud_calls)), (1, 1, 1))
                self.assertNotIn("checks", json.dumps(local_calls + second_calls))
                scores = {row["model"]: row for row in self.history("learning", "scorecard")["models"]}
                self.assertEqual(scores["local-second"]["quality"], {"pass": 0, "fail": 1, "unknown": 0})
                retained = self.history("show", source)["entry"]
                self.assertEqual(retained["quality"]["result"], "pass")
                self.assertEqual(self.history("learning", "status")["mode"], "observe")
                self.assertEqual(self.config_path.read_bytes(), before)

    def test_discovery_uses_the_public_policy_filtered_pool_while_explicit_models_stay_strict(self):
        with workflow.provider("7") as (local, local_calls), \
             workflow.provider("7") as (excluded, excluded_calls), \
             workflow.provider("7") as (cloud, cloud_calls):
            value = self.two_local_configuration(local, excluded, cloud)
            value["policies"]["organization"]["allowed_models"].remove("local-second")
            value["model_routes"]["local-unqualified"] = {
                **value["model_routes"]["local-code"], "upstream_model": "unqualified-model"}
            value["policies"]["organization"]["allowed_models"].append("local-unqualified")
            with self.fixture.connected_client(value) as submit:
                self.history("enable")
                self.history("learning", "enable")
                source = self.checked_source(submit)
                state = submit(method="GET", path="/router/state")
                self.assertEqual([row["model"] for row in state["body"]["routes"]], ["local-code"])
                result = self.history("learning", "evaluate", "--id", source, "--max-requests", "2",
                                      "--timeout-seconds", "3", "--deadline-seconds", "5")
                self.assertEqual((result["planned"], result["submitted"], result["passed"]), (1, 1, 1))
                self.assertEqual([row["model"] for row in result["observations"]], ["local-code"])
                refused = self.history("learning", "evaluate", "--id", source, "--models", "local-second",
                                       "--timeout-seconds", "3", "--deadline-seconds", "5", expected=2)
                self.assertIn("error", refused)
                self.assertEqual((len(local_calls), len(excluded_calls), len(cloud_calls)), (1, 0, 1))

    def test_replay_budget_covers_the_discovered_pool_and_rejects_oversized_batches_before_model_requests(self):
        with workflow.provider("7") as (local, local_calls), \
             workflow.provider("7") as (excluded, excluded_calls), \
             workflow.provider("7") as (cloud, cloud_calls):
            value = self.two_local_configuration(local, excluded, cloud)
            value["policies"]["organization"]["allowed_models"].remove("local-second")
            for index in range(5):
                alias = "excluded-local-" + str(index)
                value["model_routes"][alias] = dict(value["model_routes"]["local-second"])
                value["route_admission"]["local_routes"][alias] = {
                    **value["route_admission"]["local_routes"]["local-second"], "qualification_id": "excluded-q" + str(index)}
            with self.fixture.connected_client(value) as submit:
                self.history("enable")
                self.history("learning", "enable")
                first = self.checked_source(submit)
                second = self.checked_source(submit, "Summarize seven inventory boxes.")
                result = self.history("learning", "evaluate", "--id", first, "--max-requests", "1",
                                      "--timeout-seconds", "3", "--deadline-seconds", "5")
                self.assertEqual((result["planned"], result["submitted"], result["passed"]), (1, 1, 1))
                refused = self.history("learning", "evaluate", "--id", first, "--id", second,
                                       "--max-requests", "1", "--timeout-seconds", "3", "--deadline-seconds", "5", expected=2)
                self.assertEqual(refused["error"]["code"], "personal_selection_evaluation_budget_invalid")
                self.assertEqual((len(local_calls), len(excluded_calls), len(cloud_calls)), (1, 0, 2))

    def test_an_empty_admitted_pool_fails_without_claiming_a_successful_empty_replay(self):
        with workflow.provider("7") as (local, local_calls), workflow.provider("7") as (cloud, cloud_calls):
            value = self.fixture.admission_configuration(local, cloud, mode="auto")
            value["policies"]["organization"]["allowed_models"].remove("local-code")
            with self.fixture.connected_client(value) as submit:
                self.history("enable")
                self.history("learning", "enable")
                source = self.checked_source(submit)
                refused = self.history("learning", "evaluate", "--id", source,
                                       "--timeout-seconds", "3", "--deadline-seconds", "5", expected=2)
                self.assertEqual(refused["error"]["code"], "personal_selection_local_evaluation_unavailable")
                self.assertEqual((len(local_calls), len(cloud_calls)), (0, 1))
                self.assertEqual(self.history("show", source)["entry"]["quality"]["result"], "pass")
                self.assertEqual(self.history("learning", "status")["mode"], "observe")

    def test_missing_local_qualifications_report_unavailable_instead_of_an_invalid_budget(self):
        with workflow.provider("7") as (local, local_calls), workflow.provider("7") as (cloud, cloud_calls):
            value = self.fixture.admission_configuration(local, cloud, mode="auto")
            value["route_admission"]["local_routes"] = {}
            with self.fixture.connected_client(value) as submit:
                self.history("enable")
                self.history("learning", "enable")
                source = self.checked_source(submit)
                refused = self.history("learning", "evaluate", "--id", source,
                                       "--timeout-seconds", "3", "--deadline-seconds", "5", expected=2)
                self.assertEqual(refused["error"]["code"], "personal_selection_local_evaluation_unavailable")
                self.assertEqual((len(local_calls), len(cloud_calls)), (0, 1))


if __name__ == "__main__":
    unittest.main()
