"""First run through the public CLI, with bounded synthetic download sources."""
import json
import hashlib
import os
from pathlib import Path
import signal
import subprocess
import sys
import tarfile
import threading
import time
import unittest

import hormuz
from hormuz.contracts import validate_contract
from tests import test_local_acquisition_workflow as acquisition_workflow

artifacts = acquisition_workflow.artifacts


class BootstrapWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.fixture = acquisition_workflow.LocalAcquisitionWorkflowTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.client = self.fixture.client
        self.addCleanup(lambda: self.client.command("disconnect", check=False))
        self.root = self.fixture.root
        self.environment = {**self.client.environment,
            "XDG_CONFIG_HOME": str(self.root / "settings"),
            "XDG_DATA_HOME": str(self.root / "data"),
            "KOTO_HISTORY_HOME": str(self.root / "history"),
            "PYTHONPATH": str(Path(hormuz.__file__).resolve().parent.parent)}
        for name in ("KOTO_CONFIG", "HORMUZ_CONFIG"):
            self.environment.pop(name, None)
        self.cwd = self.root / "unrelated-working-directory"
        self.cwd.mkdir()
        (self.cwd / "koto.json").write_text("untrusted implicit override")
        self.path = self.root / "settings/koto/config.json"

    def invocation(self, *options):
        return [sys.executable, "-m", "koto", *options]

    def command(self, *options, check=True, cwd=None, environment=None):
        result = subprocess.run(self.invocation(*options),
            env=environment or self.environment, cwd=cwd or self.cwd,
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=25)
        if check:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def init(self, *options, **kwargs):
        return self.command("init", "--executable", str(self.client.executable),
                            "--catalog", str(self.root / "catalog.json"),
                            "--client-home", str(self.client.home), *options, **kwargs)

    def prepare(self, *, delayed_start=False):
        value, payloads = self.fixture.prepare()
        managed = value["managed_llama"]
        executable = Path(managed["executable"])
        source = executable.read_text()
        # Runtime files are immutable, including after execution. The external
        # stand-in writes its test observations outside the installed runtime.
        for marker in ("inference-count", "stopped"):
            source = source.replace(f'pathlib.Path(__file__).with_name("{marker}")',
                                    f"pathlib.Path({str(self.root / marker)!r})")
        if delayed_start:
            marker = str(self.root / "startup-entered")
            source = source.replace('server=http.server.HTTPServer',
                f"marker=pathlib.Path({marker!r})\nif not marker.exists():\n"
                '    marker.touch()\n    time.sleep(15)\nserver=http.server.HTTPServer')
        executable.write_text(source)
        archive = Path(managed["runtime_archive"])
        with tarfile.open(archive, "w:gz") as bundle:
            for path in executable.parent.iterdir():
                bundle.add(path, arcname=path.name)
        payloads["/runtime"] = archive.read_bytes()
        managed["runtime_sha256"] = hashlib.sha256(payloads["/runtime"]).hexdigest()
        qualification = self.root / "qualification.json"
        profile = json.loads(qualification.read_text())
        profile["runtime_sha256"] = managed["runtime_sha256"]
        qualification.write_text(json.dumps(profile))
        return value, payloads

    def test_user_default_and_explicit_project_override_work_from_unrelated_directories(self):
        self.assertEqual(self.command("config", "path").stdout.strip(), str(self.path))
        self.assertEqual(self.command("config", "path", cwd=self.root).stdout.strip(), str(self.path))
        overridden = {**self.environment, "KOTO_CONFIG": str(self.root / "environment.json")}
        self.assertEqual(self.command("config", "path", environment=overridden).stdout.strip(),
                         overridden["KOTO_CONFIG"])
        self.assertEqual(self.command("--project", str(self.root), "config", "path", environment=overridden).stdout.strip(),
                         str(self.root / ".koto/config.json"))
        self.assertEqual(self.command("--config", "./explicit.json", "config", "path", environment=overridden).stdout.strip(),
                         str(self.cwd.resolve() / "explicit.json"))
        failed = self.command("--project", str(self.root), "serve", check=False)
        self.assertEqual(failed.returncode, 2)
        self.assertFalse(self.path.exists())

    def test_default_first_run_catalog_selects_text_scope_and_blocks_unsupported_clients(self):
        bootstrap = ('import platform; platform.system=lambda:"Darwin"; platform.machine=lambda:"arm64"; '
                     'from hormuz.cli import main; raise SystemExit(main())')
        for version, expected in (("0.160.0", "codex0160-llamab11617-qwen3-4b-bootstrap-text-v1"),
                                  ("0.162.0-alpha.17.2", "codex-app0162-llamab11617-qwen3-4b-interactive-review-360s-v3"),
                                  ("0.147.0", None), ("0.163.0-alpha.11", None)):
            with self.subTest(version=version):
                (self.root / "client-version.txt").write_text(version)
                result = subprocess.run([sys.executable, "-c", bootstrap, "init", "--dry-run",
                    "--executable", str(self.client.executable)], env=self.environment, cwd=self.cwd,
                    stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10)
                if expected:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    receipt = json.loads(result.stdout)
                    validate_contract(receipt)
                    self.assertEqual(receipt["catalog_id"], expected)
                else:
                    self.assertEqual(result.returncode, 2)
                    self.assertEqual(json.loads(result.stderr.splitlines()[-1])["error"]["code"], "catalog_invalid")
                self.assertFalse(self.path.exists())
                self.assertFalse((self.root / "data").exists())

    def test_preview_and_noninteractive_decline_create_nothing_and_do_not_download(self):
        value, payloads = self.prepare()
        original = (self.client.home / "config.toml").read_bytes()
        with artifacts(payloads) as (origin, requests, _):
            self.fixture.catalog(value, origin)
            preview = self.init("--dry-run")
            receipt = json.loads(preview.stdout)
            validate_contract(receipt)
            self.assertEqual(receipt["state"], "planned")
            self.assertIn(str(self.path), preview.stderr)
            declined = self.init(check=False)
            self.assertEqual(declined.returncode, 2)
            self.assertIn("--yes", declined.stderr)
            self.assertFalse((self.root / "settings").exists())
            self.assertFalse((self.root / "data").exists())
            self.assertEqual(requests, [])
            self.assertEqual((self.client.home / "config.toml").read_bytes(), original)

    def test_default_private_home_preserves_native_settings_and_off_finds_the_owner(self):
        value, payloads = self.prepare()
        original = (self.client.home / "config.toml").read_bytes()
        self.addCleanup(lambda: self.command("off", check=False))
        with artifacts(payloads) as (origin, requests, _):
            self.fixture.catalog(value, origin)
            self.command("init", "--yes", "--executable", str(self.client.executable),
                         "--catalog", str(self.root / "catalog.json"))
            self.assertEqual((self.client.home / "config.toml").read_bytes(), original)
            self.assertEqual(json.loads(self.command("status").stdout)["router"], "ready")
            self.assertEqual(json.loads(self.command("off", cwd=self.root).stdout)["phase"], "disconnected")
            self.assertEqual(json.loads(self.command("status").stdout)["router"], "stopped")
            self.assertEqual((self.client.home / "config.toml").read_bytes(), original)
            self.assertEqual([path for path, _ in requests], ["/runtime", "/model"])

    def test_download_setup_task_disconnect_and_offline_restart_across_directories(self):
        value, payloads = self.prepare()
        original = (self.client.home / "config.toml").read_bytes()
        with artifacts(payloads) as (origin, requests, _):
            self.fixture.catalog(value, origin)
            first = json.loads(self.init("--yes").stdout)
            validate_contract(first)
            self.assertEqual(first["connection"]["router"], "ready")
            self.assertTrue(self.path.is_file())
            self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
            result = self.client.client()
            self.assertEqual(result["status"], 200, result)
            self.assertEqual(result["body"]["output"][0]["content"][0]["text"], "MANAGED_LOCAL")
            self.assertEqual([path for path, _ in requests], ["/runtime", "/model"])
            self.command("off")
            self.assertEqual((self.client.home / "config.toml").read_bytes(), original)
            restarted = json.loads(self.init("--yes", "--offline", cwd=self.root).stdout)
            self.assertEqual(restarted["configuration"]["operation"], "reuse")
            self.assertNotEqual(first["connection"]["generation"], restarted["connection"]["generation"])
            self.assertEqual(self.client.client()["status"], 200)
            self.command("off", cwd=self.root)
            self.assertEqual((self.client.home / "config.toml").read_bytes(), original)
            self.assertEqual([path for path, _ in requests], ["/runtime", "/model"])

    def test_a_conflicting_chat_owner_keeps_the_first_connection_and_stops_the_new_one(self):
        value, payloads = self.prepare()
        self.addCleanup(lambda: self.command("off", check=False))
        with artifacts(payloads) as (origin, requests, _):
            self.fixture.catalog(value, origin)
            self.command("init", "--yes", "--executable", str(self.client.executable),
                         "--catalog", str(self.root / "catalog.json"))
            project = self.root / "another-project"
            failure = self.command("--project", str(project), "init", "--yes", "--offline",
                "--executable", str(self.client.executable), "--catalog", str(self.root / "catalog.json"), check=False)
            self.assertEqual(failure.returncode, 2, failure.stdout)
            self.assertEqual(json.loads(failure.stderr.splitlines()[-1])["error"]["code"], "connected_client_busy")
            self.assertEqual(json.loads(self.command("status").stdout)["router"], "ready")
            self.assertEqual(json.loads(self.command("--project", str(project), "status").stdout)["router"], "stopped")
            self.command("off")
            self.assertEqual([path for path, _ in requests], ["/runtime", "/model"])

    def test_interrupted_download_closes_its_worker_and_can_restart(self):
        value, payloads = self.prepare()
        original = (self.client.home / "config.toml").read_bytes()
        with artifacts(payloads) as (origin, requests, controls):
            self.fixture.catalog(value, origin)
            controls.update(hold_connection=True, entered=threading.Event(), closed=threading.Event())
            process = subprocess.Popen(self.invocation("init", "--yes", "--executable", str(self.client.executable),
                "--catalog", str(self.root / "catalog.json"), "--client-home", str(self.client.home)), cwd=self.cwd, env=self.environment,
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertTrue(controls["entered"].wait(timeout=8))
                process.send_signal(signal.SIGTERM)
                stdout, stderr = process.communicate(timeout=10)
                self.assertEqual(process.returncode, 130, stderr)
                self.assertFalse(stdout)
                error = json.loads(stderr.splitlines()[-1])
                validate_contract(error)
                self.assertEqual(error["error"]["code"], "interrupted")
                self.assertTrue(controls["closed"].wait(timeout=3))
            finally:
                if process.poll() is None:
                    process.terminate()
                process.communicate(timeout=10)
            self.assertFalse(self.path.exists())
            self.assertEqual((self.client.home / "config.toml").read_bytes(), original)
            controls["hold_connection"] = False
            self.assertEqual(json.loads(self.init("--yes").stdout)["connection"]["router"], "ready")
            self.command("off")
            self.assertEqual([path for path, _ in requests], ["/runtime", "/runtime", "/model"])

    def test_changed_configuration_is_preserved_when_init_is_repeated(self):
        value, payloads = self.prepare()
        with artifacts(payloads) as (origin, requests, _):
            self.fixture.catalog(value, origin)
            self.init("--yes")
            self.command("off")
            changed = self.path.read_text() + "\n"
            self.path.write_text(changed)
            failed = self.init("--yes", "--offline", check=False)
            self.assertEqual(failed.returncode, 2, failed.stdout)
            self.assertEqual(self.path.read_text(), changed)
            self.assertEqual(json.loads(failed.stderr.splitlines()[-1])["error"]["code"], "connected_client_setup_changed")
            self.assertEqual([path for path, _ in requests], ["/runtime", "/model"])

    def test_interrupted_startup_restores_client_settings_and_restarts_offline(self):
        value, payloads = self.prepare(delayed_start=True)
        original = (self.client.home / "config.toml").read_bytes()
        with artifacts(payloads) as (origin, _, _):
            self.fixture.catalog(value, origin)
            process = subprocess.Popen(self.invocation("init", "--yes", "--executable", str(self.client.executable),
                "--catalog", str(self.root / "catalog.json"), "--client-home", str(self.client.home)), cwd=self.cwd, env=self.environment,
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                deadline = time.monotonic() + 8
                while not (self.root / "startup-entered").exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.05)
                self.assertTrue((self.root / "startup-entered").exists())
                process.send_signal(signal.SIGTERM)
                _, stderr = process.communicate(timeout=18)
                self.assertEqual(process.returncode, 130, stderr)
                self.assertEqual((self.client.home / "config.toml").read_bytes(), original)
                status = json.loads(self.command("client", "status", "codex").stdout)
                self.assertEqual((status["phase"], status["router"], status["local_runtime"]["state"]),
                                 ("disconnected", "stopped", "stopped"))
                self.assertEqual(json.loads(self.init("--yes", "--offline").stdout)["connection"]["router"], "ready")
                self.command("off")
            finally:
                if process.poll() is None:
                    process.terminate()
                process.communicate(timeout=18)
