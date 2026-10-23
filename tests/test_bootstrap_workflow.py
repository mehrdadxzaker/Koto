"""First run through the public CLI, with bounded synthetic download sources."""
import json
import hashlib
import os
import platform
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import tarfile
import threading
import time
import unittest

import hormuz
from hormuz.config import ConfigError, GatewayConfig
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
        source = source.replace('args=sys.argv[1:]', 'args=sys.argv[1:]\n'
            f'pathlib.Path({str(self.root / "runtime-argv.json")!r}).write_text(json.dumps(args))')
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
        profile = json.loads((Path(__file__).parent / "fixtures/local-setup-profile-v7.json").read_text())
        profile.update(system=platform.system(), machine=platform.machine(),
                       runtime_sha256=managed["runtime_sha256"], model_sha256=managed["model_sha256"])
        (self.root / "client-version.txt").write_text("0.160.0")
        qualification.write_text(json.dumps(profile))
        return value, payloads

    def test_user_default_and_explicit_project_override_work_from_unrelated_directories(self):
        self.assertEqual(self.command("config", "path").stdout.strip(), str(self.path))
        self.assertEqual(self.command("config", "path", cwd=self.root).stdout.strip(), str(self.path))
        overridden = {**self.environment, "KOTO_CONFIG": str(self.root / "environment.json")}
        self.assertEqual(self.command("--project", str(self.root), "config", "path", environment=overridden).stdout.strip(),
                         str(self.root / ".koto/config.json"))
        failed = self.command("--project", str(self.root), "serve", check=False)
        self.assertEqual(failed.returncode, 2)
        self.assertFalse(self.path.exists())

    def test_disconnect_and_auth_helpers_do_not_depend_on_valid_configuration_overrides(self):
        poisoned = {**self.environment, "KOTO_CONFIG": "relative.json", "XDG_CONFIG_HOME": "relative",
                    "KOTO_BOOTSTRAP_TEST_TOKEN": "synthetic-helper-value"}
        stopped = self.command("off", "--client-home", str(self.client.home), environment=poisoned)
        self.assertEqual(json.loads(stopped.stdout)["phase"], "disconnected")
        disconnected = self.command("client", "disconnect", "codex", "--client-home", str(self.client.home), environment=poisoned)
        self.assertEqual(json.loads(disconnected.stdout)["phase"], "disconnected")
        token = self.command("auth", "token", "--env", "KOTO_BOOTSTRAP_TEST_TOKEN", environment=poisoned)
        self.assertEqual(token.stdout.strip(), "synthetic-helper-value")

    def test_default_first_run_catalog_selects_text_scope_and_blocks_unsupported_clients(self):
        bootstrap = ('import platform; platform.system=lambda:"Darwin"; platform.machine=lambda:"arm64"; '
                     'from hormuz.cli import main; raise SystemExit(main())')
        for version, expected in (("0.160.0", "codex0160-llamab11617-qwen3-4b-bootstrap-text-v1"),
                                  ("0.162.0-alpha.17.2", "codex-app0162-llamab11617-qwen3-4b-bootstrap-text-v1"),
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

    def test_old_reviewed_catalog_stops_before_transfer_but_remains_available_to_client_acquire(self):
        value, payloads = self.fixture.prepare()
        original = (self.client.home / "config.toml").read_bytes()
        with artifacts(payloads) as (origin, requests, _):
            catalog = self.fixture.catalog(value, origin)
            missing_transport = json.loads((Path(__file__).parent / "fixtures/local-setup-profile-v7.json").read_text())
            missing_transport.update(system=platform.system(), machine=platform.machine(),
                runtime_sha256=value["managed_llama"]["runtime_sha256"],
                model_sha256=value["managed_llama"]["model_sha256"], capabilities=["responses", "text"])
            for name, profile in (("historical", catalog["profile"]), ("missing_transport", missing_transport)):
                with self.subTest(catalog=name):
                    catalog["profile"] = profile
                    (self.root / "catalog.json").write_text(json.dumps(catalog))
                    (self.root / "client-version.txt").write_text(profile["client_version"])
                    failed = self.init("--yes", check=False)
                    self.assertEqual(failed.returncode, 2, failed.stderr)
                    self.assertEqual(json.loads(failed.stderr.splitlines()[-1])["error"]["code"], "catalog_invalid")
                    self.assertFalse(self.path.exists())
                    self.assertFalse((self.root / "data").exists())
                    self.assertEqual((self.client.home / "config.toml").read_bytes(), original)
                    self.assertEqual(requests, [])
                    legacy = self.command("client", "acquire", "codex", "--dry-run",
                        "--executable", str(self.client.executable), "--catalog", str(self.root / "catalog.json"),
                        "--directory", str(self.root / "legacy-assets"))
                    self.assertEqual(json.loads(legacy.stdout)["state"], "planned")
                    self.assertFalse((self.root / "legacy-assets").exists())
                    self.assertEqual(requests, [])

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

    def test_suggested_task_keeps_the_selected_project_and_explicit_control_home(self):
        value, payloads = self.prepare()
        profile = json.loads((Path(__file__).parent / "fixtures/local-setup-profile-v7.json").read_text())
        profile.update(system=platform.system(), machine=platform.machine(),
                       runtime_sha256=value["managed_llama"]["runtime_sha256"],
                       model_sha256=value["managed_llama"]["model_sha256"])
        (self.root / "qualification.json").write_text(json.dumps(profile))
        (self.root / "client-version.txt").write_text("0.160.0")
        project, home = self.root / "project with 'quote", self.root / "control home with 'quote"
        prompt = self.root / "handoff note.txt"
        prompt.write_text("Summarize the synthetic handoff.")
        original = (self.client.home / "config.toml").read_bytes()
        self.addCleanup(lambda: self.command("off", check=False))
        with artifacts(payloads) as (origin, requests, _):
            self.fixture.catalog(value, origin)
            ready = self.command("--project", str(project), "init", "--yes", "--client-home", str(home),
                "--catalog", str(self.root / "catalog.json"), "--executable", str(self.client.executable))
            suggestion = next(line.removeprefix("Try a text task: ") for line in ready.stderr.splitlines()
                              if line.startswith("Try a text task: "))
            arguments = shlex.split(suggestion)
            self.assertEqual(arguments[0], "koto")
            arguments[arguments.index("--prompt-file") + 1] = str(prompt)
            task = self.command(*arguments[1:], cwd=self.root)
            result = json.loads(task.stdout)
            self.assertEqual((result["text"], result["locality"]), ("MANAGED_LOCAL", "local"))
            poisoned = {**self.environment, "KOTO_CONFIG": "relative.json", "HORMUZ_CONFIG": "relative.json",
                        "XDG_CONFIG_HOME": "relative"}
            status = self.command("status", "--client-home", str(home), environment=poisoned)
            self.assertEqual(json.loads(status.stdout)["router"], "ready")
            models = self.command("chat", "models", "--router-home", str(home), environment=poisoned)
            self.assertEqual(json.loads(models.stdout)["models"], ["local-code"])
            explicit = self.command("chat", "ask", "--router-home", str(home), "--prompt-file", str(prompt),
                                    "--effort", "low", "--max-output-tokens", "512", environment=poisoned)
            self.assertEqual(json.loads(explicit.stdout)["text"], "MANAGED_LOCAL")
            self.assertFalse(self.path.exists())
            self.assertEqual((self.client.home / "config.toml").read_bytes(), original)
            self.assertEqual(json.loads(self.command("off").stdout)["phase"], "disconnected")
            self.assertEqual([path for path, _ in requests], ["/runtime", "/model"])

    def test_interrupted_result_output_stops_the_generation_and_can_restart_offline(self):
        value, payloads = self.prepare()
        original = (self.client.home / "config.toml").read_bytes()
        home = self.path.with_name(self.path.name + ".codex")
        self.addCleanup(lambda: self.command("off", "--client-home", str(home), check=False))
        self.addCleanup(lambda: self.command("off", check=False))
        # Deliver a real process signal when the CLI starts returning its setup
        # result. Routing and lifecycle collaborators remain the real product.
        interrupted_output = '''import os, signal, sys
from hormuz.cli import main
class InterruptedOutput:
    def write(self, value):
        if value:
            os.kill(os.getpid(), signal.SIGTERM)
        return len(value)
    def flush(self):
        pass
sys.stdout = InterruptedOutput()
raise SystemExit(main())
'''
        with artifacts(payloads) as (origin, requests, _):
            self.fixture.catalog(value, origin)
            failed = subprocess.run([sys.executable, "-c", interrupted_output, "init", "--yes",
                "--executable", str(self.client.executable), "--catalog", str(self.root / "catalog.json")],
                env=self.environment, cwd=self.cwd, stdin=subprocess.DEVNULL,
                capture_output=True, text=True, timeout=25)
            self.assertEqual(failed.returncode, 130, failed.stderr)
            self.assertEqual(json.loads(failed.stderr.splitlines()[-1])["error"]["code"], "interrupted")
            status = json.loads(self.command("status").stdout)
            self.assertEqual((status["phase"], status["router"], status["local_runtime"]["state"]),
                             ("disconnected", "stopped", "stopped"))
            self.assertTrue((self.root / "stopped").exists())
            self.assertEqual((self.client.home / "config.toml").read_bytes(), original)
            restarted = self.command("init", "--yes", "--offline", "--executable", str(self.client.executable),
                "--catalog", str(self.root / "catalog.json"))
            self.assertEqual(json.loads(restarted.stdout)["connection"]["router"], "ready")
            self.command("off")
            self.assertEqual([path for path, _ in requests], ["/runtime", "/model"])

    def test_version_six_startup_budget_reaches_the_owned_runtime_without_coding_admission(self):
        value, payloads = self.prepare()
        profile = json.loads((Path(__file__).parent / "fixtures/local-setup-profile-v6.json").read_text())
        profile.update(system=platform.system(), machine=platform.machine(),
                       runtime_sha256=value["managed_llama"]["runtime_sha256"],
                       model_sha256=value["managed_llama"]["model_sha256"])
        (self.root / "qualification.json").write_text(json.dumps(profile))
        (self.root / "client-version.txt").write_text("0.160.0")
        self.addCleanup(lambda: self.command("off", check=False))
        with artifacts(payloads) as (origin, _, _):
            self.fixture.catalog(value, origin)
            self.command("init", "--yes", "--executable", str(self.client.executable),
                         "--catalog", str(self.root / "catalog.json"))
            configuration = json.loads(self.path.read_text())
            managed = configuration["managed_llama"]
            self.assertEqual((managed["schema_version"], managed["startup_timeout_seconds"]), (4, 120))
            self.assertEqual(json.loads(self.command("chat", "models").stdout)["models"], ["local-code"])
            routing = json.loads(self.command("status", "--routing").stdout)
            self.assertTrue(routing["routes"])
            self.assertTrue(all(route["coding_readiness"] == "unknown" and not route["automatic_task_types"]
                                for route in routing["routes"]))
            self.command("off")
            # Readers of historical managed versions keep rejecting the wider
            # startup bound; there is no silent migration of an old profile.
            configuration["managed_llama"]["schema_version"] = 2
            self.path.write_text(json.dumps(configuration))
            with self.assertRaises(ConfigError):
                GatewayConfig.load(self.path)
            failed = self.command("client", "connect", "codex", "--executable", str(self.client.executable),
                "--client-home", str(self.path.with_name(self.path.name + ".codex")), check=False)
            self.assertEqual(failed.returncode, 2)
            self.assertEqual(json.loads(failed.stderr)["error"]["code"], "connected_client_setup_unavailable")
            self.assertEqual(json.loads(self.command("status").stdout)["router"], "stopped")

    def test_version_seven_context_reaches_the_engine_and_does_not_fit_legacy_managed_readers(self):
        value, payloads = self.prepare()
        profile = json.loads((Path(__file__).parent / "fixtures/local-setup-profile-v7.json").read_text())
        profile.update(system=platform.system(), machine=platform.machine(),
                       runtime_sha256=value["managed_llama"]["runtime_sha256"],
                       model_sha256=value["managed_llama"]["model_sha256"])
        (self.root / "qualification.json").write_text(json.dumps(profile))
        (self.root / "client-version.txt").write_text("0.160.0")
        self.addCleanup(lambda: self.command("off", check=False))
        with artifacts(payloads) as (origin, _, _):
            self.fixture.catalog(value, origin)
            self.command("init", "--yes", "--executable", str(self.client.executable),
                         "--catalog", str(self.root / "catalog.json"))
            configuration = json.loads(self.path.read_text())
            managed = configuration["managed_llama"]
            self.assertEqual((managed["schema_version"], managed["startup_timeout_seconds"], managed["context_tokens"]),
                             (5, 120, 8192))
            arguments = json.loads((self.root / "runtime-argv.json").read_text())
            self.assertEqual(arguments[arguments.index("--ctx-size") + 1], "8192")
            self.assertEqual(json.loads(self.command("chat", "models").stdout)["models"], ["local-code"])
            self.assertEqual(configuration["route_admission"]["local_routes"]["local-code"]["max_request_bytes"], 4096)
            prompt = self.root / "bounded-task.txt"
            prompt.write_text("!" * 6000)
            blocked = self.command("chat", "ask", "--prompt-file", str(prompt), "--effort", "low",
                                   "--max-output-tokens", "512", check=False)
            self.assertEqual(blocked.returncode, 2, blocked.stdout)
            validate_contract(json.loads(blocked.stderr))
            self.assertFalse((self.root / "inference-count").exists())
            prompt.write_text("Summarize the synthetic handoff.")
            task = self.command("chat", "ask", "--prompt-file", str(prompt), "--effort", "low",
                                "--max-output-tokens", "512")
            self.assertEqual(json.loads(task.stdout)["text"], "MANAGED_LOCAL")
            self.assertEqual(int((self.root / "inference-count").read_text()), 1)
            self.command("off")
            configuration["managed_llama"]["schema_version"] = 4
            self.path.write_text(json.dumps(configuration))
            with self.assertRaises(ConfigError):
                GatewayConfig.load(self.path)

    def test_download_setup_task_disconnect_and_offline_restart_across_directories(self):
        value, payloads = self.prepare()
        original = (self.client.home / "config.toml").read_bytes()
        with artifacts(payloads) as (origin, requests, _):
            self.fixture.catalog(value, origin)
            initialized = self.init("--yes")
            first = json.loads(initialized.stdout)
            self.assertNotIn("Try a text task:", initialized.stderr)
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
        profile = json.loads((Path(__file__).parent / "fixtures/local-setup-profile-v6.json").read_text())
        profile.update(system=platform.system(), machine=platform.machine(),
                       runtime_sha256=value["managed_llama"]["runtime_sha256"],
                       model_sha256=value["managed_llama"]["model_sha256"])
        (self.root / "qualification.json").write_text(json.dumps(profile))
        (self.root / "client-version.txt").write_text("0.160.0")
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
