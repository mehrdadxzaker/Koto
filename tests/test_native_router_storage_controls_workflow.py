"""The storage diagnostic must not relabel a different startup exception."""
import multiprocessing
import os
import time
import unittest
from unittest.mock import patch

from hormuz.codex_native_session import NativeSessionError
from hormuz.native_router import owned_router
from tests import test_native_router_workflow as native


class NativeRouterStorageControlsWorkflowTests(unittest.TestCase):
    def test_non_sqlite_startup_error_stays_generic_and_reaps_owned_child(self):
        fixture = native.NativeRouterWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        config = fixture.config("http://127.0.0.1:9/v1", "http://127.0.0.1:9/v1")
        workspace = fixture.root / "parent-is-a-file"
        workspace.write_text("Preserve this owned fixture.\n")
        before = {child.pid for child in multiprocessing.active_children()}
        started = time.monotonic()
        # UsageStore's parent mkdir raises FileExistsError before SQLite is
        # reached. This must remain distinct from a sqlite3.connect failure.
        with patch.dict(os.environ, fixture.fixture.environment):
            with self.assertRaises(NativeSessionError) as raised:
                with owned_router(config, workspace, time.monotonic() + 5):
                    self.fail("A router started beneath a regular file")
        self.assertEqual(str(raised.exception), "native_router_unavailable")
        self.assertNotIn(str(fixture.root), str(raised.exception))
        self.assertLess(time.monotonic() - started, 5)
        self.assertEqual([child.pid for child in multiprocessing.active_children()
                          if child.pid not in before and child.name == "koto-native-router"], [])
        self.assertEqual(workspace.read_text(), "Preserve this owned fixture.\n")


if __name__ == "__main__":
    unittest.main()
