"""Actual owned-router storage failures expose fixed errors and release children."""
import json
import multiprocessing
import os
import time
import unittest
from unittest.mock import patch

from hormuz.codex_native_session import NativeSessionError
from hormuz.config import GatewayConfig
from hormuz.native_router import owned_router
from tests import test_execution_destination_workflow as workflow


class NativeRouterStorageWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.fixture = workflow.ExecutionDestinationWorkflowTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root.resolve()
        value = self.fixture.admission_configuration(
            "http://127.0.0.1:9/v1", "http://127.0.0.1:9/v1", mode="auto")
        value["policies"]["organization"].pop("max_output_tokens", None)
        path = self.root / "gateway.json"
        path.write_text(json.dumps(value))
        self.config = GatewayConfig.load(path, environ={**os.environ, **self.fixture.environment})
        # Parent creation succeeds, then the real sqlite3.connect cannot open
        # a directory as its database. No disk filling, provider request, or
        # injected collaborator is needed to reach the SQLite failure itself.
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.database = self.workspace / "usage.sqlite3"
        self.database.mkdir()
        self.marker = self.database / "untouched.txt"
        self.marker.write_text("Owned storage-failure fixture.\n")

    def test_startup_storage_failure_returns_only_the_fixed_actionable_error(self):
        with patch.dict(os.environ, self.fixture.environment):
            with self.assertRaises(NativeSessionError) as raised:
                with owned_router(self.config, self.workspace, time.monotonic() + 5):
                    self.fail("A router started with an unusable database workspace")
        code = str(raised.exception)
        self.assertEqual(code, "native_router_storage_unavailable")
        self.assertNotIn(str(self.root), code)
        self.assertNotIn(self.workspace.name, code)
        self.assertNotIn("unable to open database", code)
        self.assertTrue(self.database.is_dir())
        self.assertEqual(self.marker.read_text(), "Owned storage-failure fixture.\n")

    def test_failed_storage_startup_is_bounded_and_reaps_its_owned_child(self):
        before = {child.pid for child in multiprocessing.active_children()}
        started = time.monotonic()
        with patch.dict(os.environ, self.fixture.environment):
            with self.assertRaises(NativeSessionError):
                with owned_router(self.config, self.workspace, time.monotonic() + 5):
                    self.fail("A router started with an unusable database workspace")
        self.assertLess(time.monotonic() - started, 5)
        remaining = [child.pid for child in multiprocessing.active_children()
                     if child.pid not in before and child.name == "koto-native-router"]
        self.assertEqual(remaining, [], "Failed startup retained its owned router child")
        self.assertTrue(self.workspace.is_dir())
        self.assertTrue(self.database.is_dir())
        self.assertFalse((self.root / "usage.sqlite3").exists())


if __name__ == "__main__":
    unittest.main()
