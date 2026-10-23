"""Content-free startup diagnostics through the shared connected-client CLI."""
import hashlib
import json
import socket
import sys
import tarfile
import unittest

from hormuz.contracts import validate_contract
from tests import test_connected_client_lifetime_workflow as lifetime


RUNTIME = r'''#!PYTHON
import http.server,json,pathlib,signal,sys,time
root=pathlib.Path(__file__).parent
mode=BEHAVIOR
args=sys.argv[1:]
port=int(args[args.index("--port")+1])
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        with (root/"health-count").open("a") as observed: observed.write("1\n")
        data=b'{"status":"PRIVATE_RUNTIME_DIAGNOSTIC"}' if mode=="health_invalid" else b'{"status":"ok"}'
        self.send_response(200);self.send_header("Content-Length",str(len(data)));self.end_headers();self.wfile.write(data)
    def do_POST(self):
        (root/"inference-count").write_text("unexpected inference")
        self.send_error(500)
stopping=False
def stop(*_):
    global stopping
    stopping=True
signal.signal(signal.SIGTERM,stop)
server=None
try:
    if mode!="health_unreachable":
        server=http.server.HTTPServer(("127.0.0.1",port),Handler)
        server.timeout=0.2
    print("PRIVATE_RUNTIME_DIAGNOSTIC",file=sys.stderr,flush=True)
    if mode!="listening_marker_missing":
        print("llama_server: listening on http://127.0.0.1:"+str(port),file=sys.stderr,flush=True)
    while not stopping:
        if server is None: time.sleep(0.2)
        else: server.handle_request()
finally:
    if server is not None: server.server_close()
    (root/"stopped").write_text("stopped")
'''


class RuntimeDiagnosticsWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.fixture = lifetime.ConnectedClientLifetimeWorkflowTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.addCleanup(lambda: self.fixture.command("disconnect", check=False))

    def runtime(self, cloud, behavior):
        value, port, engine = self.fixture.managed_configuration(cloud)
        executable = engine / "llama-server"
        executable.write_text(RUNTIME.replace("#!PYTHON", "#!" + sys.executable, 1)
                              .replace("BEHAVIOR", repr(behavior), 1))
        archive = self.fixture.root / "runtime.tar.gz"
        with tarfile.open(archive, "w:gz") as bundle:
            for path in engine.iterdir():
                bundle.add(path, arcname=path.name)
        value["managed_llama"]["runtime_sha256"] = hashlib.sha256(archive.read_bytes()).hexdigest()
        self.fixture.path.write_text(json.dumps(value))
        return port, engine

    def test_startup_process_exit_reports_reason_and_restores_settings(self):
        with lifetime.provider("CLOUD_MUST_STAY_UNUSED") as (cloud, requests):
            _, port, engine = self.fixture.managed_configuration(cloud)
            (engine / "fail-start").touch()
            before = (self.fixture.home / "config.toml").read_bytes()
            failure = self.fixture.command("connect", check=False)
            self.assertEqual(failure.returncode, 2, failure.stderr)
            receipt = json.loads(failure.stderr)
            self.assertEqual(receipt["error"]["code"], "connected_client_runtime_start_failed")
            self.assertEqual(receipt["schema_version"], 2)
            self.assertEqual(receipt["diagnostic"], {
                "schema_id": "hormuz.runtime-check", "schema_version": 1,
                "reason": "process_exited", "action": "inspect_runtime_executable"})
            validate_contract(receipt)
            self.assertEqual((self.fixture.home / "config.toml").read_bytes(), before)
            status = json.loads(self.fixture.command("status").stdout)
            self.assertEqual((status["phase"], status["local_runtime"]["state"]),
                             ("disconnected", "stopped"))
            with socket.socket() as probe:
                probe.settimeout(1)
                self.assertNotEqual(probe.connect_ex(("127.0.0.1", port)), 0)
            self.assertFalse((engine / "inference-count").exists())
            self.assertEqual(requests, [])

    def test_healthy_owned_endpoint_without_native_marker_stays_unready(self):
        with lifetime.provider("CLOUD_MUST_STAY_UNUSED") as (cloud, requests):
            port, engine = self.runtime(cloud, "listening_marker_missing")
            before = (self.fixture.home / "config.toml").read_bytes()
            failure = self.fixture.command("connect", check=False)
            self.assertEqual(failure.returncode, 2, failure.stderr)
            receipt = json.loads(failure.stderr)
            self.assertEqual(receipt["error"]["code"], "connected_client_runtime_start_failed")
            self.assertEqual(receipt["diagnostic"], {
                "schema_id": "hormuz.runtime-check", "schema_version": 1,
                "reason": "listening_marker_missing", "action": "inspect_runtime_startup"})
            validate_contract(receipt)
            self.assertNotIn("PRIVATE_RUNTIME_DIAGNOSTIC", failure.stderr)
            self.assertEqual((self.fixture.home / "config.toml").read_bytes(), before)
            status = json.loads(self.fixture.command("status").stdout)
            self.assertEqual((status["phase"], status["local_runtime"]["state"]),
                             ("disconnected", "stopped"))
            self.assertTrue((engine / "stopped").exists())
            self.assertFalse((engine / "health-count").exists())
            self.assertFalse((engine / "inference-count").exists())
            with socket.socket() as probe:
                probe.settimeout(1)
                self.assertNotEqual(probe.connect_ex(("127.0.0.1", port)), 0)
            self.assertEqual(requests, [])

    def test_native_marker_with_invalid_health_reports_contract_failure(self):
        with lifetime.provider("CLOUD_MUST_STAY_UNUSED") as (cloud, requests):
            port, engine = self.runtime(cloud, "health_invalid")
            before = (self.fixture.home / "config.toml").read_bytes()
            failure = self.fixture.command("connect", check=False)
            self.assertEqual(failure.returncode, 2, failure.stderr)
            receipt = json.loads(failure.stderr)
            self.assertEqual(receipt["error"]["code"], "connected_client_runtime_start_failed")
            self.assertEqual(receipt["diagnostic"], {
                "schema_id": "hormuz.runtime-check", "schema_version": 1,
                "reason": "health_invalid", "action": "inspect_runtime_health"})
            validate_contract(receipt)
            self.assertNotIn("PRIVATE_RUNTIME_DIAGNOSTIC", failure.stderr)
            self.assertEqual((self.fixture.home / "config.toml").read_bytes(), before)
            status = json.loads(self.fixture.command("status").stdout)
            self.assertEqual((status["phase"], status["local_runtime"]["state"]),
                             ("disconnected", "stopped"))
            self.assertTrue((engine / "stopped").exists())
            self.assertTrue((engine / "health-count").exists())
            self.assertFalse((engine / "inference-count").exists())
            with socket.socket() as probe:
                probe.settimeout(1)
                self.assertNotEqual(probe.connect_ex(("127.0.0.1", port)), 0)
            self.assertEqual(requests, [])

    def test_native_marker_without_health_endpoint_reports_unreachable(self):
        with lifetime.provider("CLOUD_MUST_STAY_UNUSED") as (cloud, requests):
            port, engine = self.runtime(cloud, "health_unreachable")
            before = (self.fixture.home / "config.toml").read_bytes()
            failure = self.fixture.command("connect", check=False)
            self.assertEqual(failure.returncode, 2, failure.stderr)
            receipt = json.loads(failure.stderr)
            self.assertEqual(receipt["error"]["code"], "connected_client_runtime_start_failed")
            self.assertEqual(receipt["diagnostic"], {
                "schema_id": "hormuz.runtime-check", "schema_version": 1,
                "reason": "health_unreachable", "action": "inspect_runtime_health"})
            validate_contract(receipt)
            self.assertNotIn("PRIVATE_RUNTIME_DIAGNOSTIC", failure.stderr)
            self.assertEqual((self.fixture.home / "config.toml").read_bytes(), before)
            status = json.loads(self.fixture.command("status").stdout)
            self.assertEqual((status["phase"], status["local_runtime"]["state"]),
                             ("disconnected", "stopped"))
            self.assertTrue((engine / "stopped").exists())
            self.assertFalse((engine / "health-count").exists())
            self.assertFalse((engine / "inference-count").exists())
            with socket.socket() as probe:
                probe.settimeout(1)
                self.assertNotEqual(probe.connect_ex(("127.0.0.1", port)), 0)
            self.assertEqual(requests, [])
