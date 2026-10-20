"""Owned native routers through public process, HTTP and observation boundaries."""
import http.client
import json
import os
from pathlib import Path
import socket
import signal
import subprocess
import sys
import textwrap
import threading
import time
from dataclasses import replace
from types import MappingProxyType
import unittest
from unittest.mock import patch

import hormuz
from hormuz.config import GatewayConfig
from hormuz.codex_native_session import NativeSessionError
from tests import test_execution_destination_workflow as workflow


class NativeRouterWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.fixture = workflow.ExecutionDestinationWorkflowTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root.resolve()
        self.path = self.root / "gateway.json"

    def config(self, local, cloud):
        value = self.fixture.admission_configuration(local, cloud, mode="auto")
        value["policies"]["organization"].pop("max_output_tokens", None)
        self.path.write_text(json.dumps(value))
        return GatewayConfig.load(self.path, environ={**os.environ, **self.fixture.environment})

    def assert_stopped(self, pid):
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_native_route_discovery_checks_health_while_ordinary_status_remains_passive(self):
        from hormuz.native_router import owned_router
        for health_status, expected in ((200, "ready"), (503, "unavailable")):
            with self.subTest(health_status=health_status), workflow.provider(
                    "UNUSED", health_status=health_status) as (local, local_calls):
                config = self.config(local, "http://127.0.0.1:9/v1")
                with patch.dict(os.environ, self.fixture.environment):
                    with owned_router(config, self.root, time.monotonic() + 8) as router:
                        connection = http.client.HTTPConnection("127.0.0.1", router.server_port, timeout=3)
                        try:
                            def status():
                                connection.request("GET", "/v1/router/state", headers={
                                    "Authorization": "Bearer " + self.fixture.environment["DESTINATION_WORKFLOW_TOKEN"]})
                                response = connection.getresponse()
                                data = response.read()
                                self.assertEqual(response.status, 200, data)
                                return json.loads(data)["routes"]

                            self.assertEqual(status()[0]["readiness"], "unchecked")
                            self.assertEqual(router.routes("developer")[0]["readiness"], expected)
                            self.assertEqual(status()[0]["readiness"], expected)
                        finally:
                            connection.close()
                self.assertEqual(local_calls, [])

    def test_one_owned_router_returns_policy_filtered_routes_and_verified_http_observations(self):
        from hormuz.native_router import owned_router
        with workflow.provider("7") as (local, local_calls), workflow.provider("UNUSED") as (cloud, cloud_calls):
            config = self.config(local, cloud)
            original = self.path.read_bytes()
            with patch.dict(os.environ, self.fixture.environment):
                with owned_router(config, self.root, time.monotonic() + 8) as router:
                    pid = router.pid
                    self.assertNotEqual(pid, os.getpid())
                    self.assertEqual([row["model"] for row in router.routes("developer")], ["local-code"])
                    work = router.create_work("developer", "summarization")
                    connection = http.client.HTTPConnection("127.0.0.1", router.server_port, timeout=4)
                    try:
                        connection.request("POST", "/v1/responses", json.dumps({"model": "local-code", "input": "Summarize seven boxes."}),
                            {"Content-Type": "application/json", "Authorization": "Bearer " + self.fixture.environment["DESTINATION_WORKFLOW_TOKEN"],
                             "X-Hormuz-Routing-Mode": "local_only", "X-Hormuz-Task-Selection": "model", "X-Hormuz-Work-ID": work["work_id"]})
                        response = connection.getresponse()
                        body = response.read()
                        self.assertEqual(response.status, 200, body)
                        self.assertEqual(json.loads(body)["output"][0]["content"][0]["text"], "7")
                    finally:
                        connection.close()
                    observed = router.observe("developer", work["work_id"], "local-code")
                    self.assertIsNone(observed["next_before"])
                    self.assertEqual(len(observed["attempts"]), 1)
                    self.assertTrue(observed["attempts"][0]["response_succeeded"])
                    self.assertEqual(observed["attempts"][0]["route_fingerprint"], observed["expected_fingerprint"])
            self.assert_stopped(pid)
            self.assertEqual((len(local_calls), len(cloud_calls)), (1, 0))
            self.assertEqual(self.path.read_bytes(), original)

    def test_incomplete_http_headers_cannot_keep_the_owned_router_alive_after_context_exit(self):
        from hormuz.native_router import owned_router
        config = self.config("http://127.0.0.1:9/v1", "http://127.0.0.1:9/v1")
        connection = None
        try:
            with patch.dict(os.environ, self.fixture.environment):
                with owned_router(config, self.root, time.monotonic() + 8) as router:
                    pid = router.pid
                    connection = socket.create_connection(("127.0.0.1", router.server_port), timeout=1)
                    connection.sendall(b"POST /v1/responses HTTP/1.1\r\nX-Incomplete: ")
                    started = time.monotonic()
            self.assertLess(time.monotonic() - started, 3)
            self.assert_stopped(pid)
        finally:
            if connection is not None:
                connection.close()

    def test_stalled_provider_cannot_block_owned_process_cleanup(self):
        from hormuz.native_router import owned_router
        entered, release = threading.Event(), threading.Event()
        with workflow.provider("Late answer", hold_first=(entered, release)) as (local, _calls):
            config = self.config(local, "http://127.0.0.1:9/v1")
            client = None
            try:
                with patch.dict(os.environ, self.fixture.environment):
                    with owned_router(config, self.root, time.monotonic() + 8) as router:
                        pid = router.pid
                        port = router.server_port

                        def submit():
                            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                            try:
                                connection.request("POST", "/v1/responses", json.dumps({
                                    "model": "local-code", "input": "Summarize seven boxes."}), {
                                    "Authorization": "Bearer " + self.fixture.environment["DESTINATION_WORKFLOW_TOKEN"],
                                    "Content-Type": "application/json", "X-Hormuz-Routing-Mode": "local_only",
                                    "X-Hormuz-Task-Selection": "model"})
                                connection.getresponse().read()
                            except (OSError, http.client.HTTPException):
                                pass
                            finally:
                                connection.close()

                        client = threading.Thread(target=submit, daemon=False)
                        client.start()
                        self.assertTrue(entered.wait(timeout=2))
                        started = time.monotonic()
                self.assertLess(time.monotonic() - started, 3)
                self.assert_stopped(pid)
            finally:
                release.set()
                if client is not None:
                    client.join(timeout=4)
                    self.assertFalse(client.is_alive())

    @unittest.skipUnless(hasattr(signal, "SIGSTOP"), "POSIX process suspension")
    def test_unresponsive_child_has_a_finite_ipc_deadline_and_is_reaped(self):
        from hormuz.native_router import owned_router
        config = self.config("http://127.0.0.1:9/v1", "http://127.0.0.1:9/v1")
        started = time.monotonic()
        with self.assertRaisesRegex(NativeSessionError, "native_router_deadline"):
            with patch.dict(os.environ, self.fixture.environment):
                with owned_router(config, self.root, time.monotonic() + .5) as router:
                    pid = router.pid
                    os.kill(pid, signal.SIGSTOP)
                    router.routes("developer")
        self.assertLess(time.monotonic() - started, 6)
        self.assert_stopped(pid)

    @unittest.skipUnless(hasattr(signal, "SIGSTOP"), "POSIX process interruption")
    def test_interrupt_during_cleanup_reaches_caller_only_after_owned_router_is_reaped(self):
        self.config("http://127.0.0.1:9/v1", "http://127.0.0.1:9/v1")
        wrapper = self.root / "interrupt_router.py"
        wrapper.write_text(textwrap.dedent('''\
            import json
            import os
            from pathlib import Path
            import signal
            import socket
            import sys
            import time
            from hormuz.config import GatewayConfig
            from hormuz.native_router import owned_router

            if __name__ == "__main__":
                connection = None
                original_handler = signal.getsignal(signal.SIGINT)
                try:
                    config = GatewayConfig.load(sys.argv[1])
                    with owned_router(config, sys.argv[2], time.monotonic() + 8) as router:
                        connection = socket.create_connection(("127.0.0.1", router.server_port), timeout=1)
                        connection.sendall(b"POST /v1/responses HTTP/1.1\\r\\nX-Incomplete: ")
                        os.kill(router.pid, signal.SIGSTOP)
                        marker = Path(sys.argv[3])
                        pending = marker.with_suffix(".pending")
                        pending.write_text(json.dumps({"cleanup": router.pid}))
                        pending.replace(marker)
                except KeyboardInterrupt:
                    assert signal.getsignal(signal.SIGINT) is original_handler
                    print("interrupted", flush=True)
                finally:
                    if connection is not None:
                        connection.close()
        '''))
        environment = {**os.environ, **self.fixture.environment}
        runtime_root = str(Path(hormuz.__file__).resolve().parents[1])
        inherited_path = environment.get("PYTHONPATH")
        environment["PYTHONPATH"] = os.pathsep.join([runtime_root, inherited_path]) if inherited_path else runtime_root
        marker = self.root / "router-cleanup.json"
        process = subprocess.Popen([sys.executable, "-u", str(wrapper), str(self.path), str(self.root), str(marker)],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env=environment)
        pid = None
        try:
            deadline = time.monotonic() + 4
            while not marker.exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(.01)
            if not marker.exists():
                if process.poll() is not None:
                    output, error = process.communicate(timeout=2)
                    self.fail(f"Router wrapper exited {process.returncode} before cleanup: {output!r}; {error!r}")
                self.fail("Router wrapper did not reach cleanup within four seconds")
            pid = json.loads(marker.read_text())["cleanup"]
            # The stopped child keeps the bounded cleanup window open for this one signal.
            time.sleep(.05)
            os.kill(process.pid, signal.SIGINT)
            output, error = process.communicate(timeout=4)
            self.assertEqual((process.returncode, output, error), (0, "interrupted\n", ""))
            self.assert_stopped(pid)
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
            try:
                process.communicate(timeout=4)
            except subprocess.TimeoutExpired:
                if pid is not None:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                process.kill()
                process.communicate(timeout=2)
            finally:
                if pid is not None:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass

    def test_unserializable_configuration_stops_before_a_router_is_started(self):
        from hormuz.native_router import owned_router
        config = self.config("http://127.0.0.1:9/v1", "http://127.0.0.1:9/v1")
        config = replace(config, upstreams=MappingProxyType(config.upstreams))
        with self.assertRaisesRegex(NativeSessionError, "native_router_configuration_invalid"):
            with owned_router(config, self.root, time.monotonic() + 1):
                self.fail("An unserializable configuration started a router")


if __name__ == "__main__":
    unittest.main()
