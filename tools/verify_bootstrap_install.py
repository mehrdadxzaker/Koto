"""Exercise a built wheel on a fresh Mac, with real downloads and one text task.

Run only when real asset downloads and a bounded local model request are wanted.
The workspace must be new. No repository modules or test doubles are imported.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import socket
import subprocess
import sys
import time
from urllib.parse import urlsplit


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run_stage(label, command, *, evidence, report, environment, cwd, timeout=60, check=True):
    print(label, flush=True)
    started = time.monotonic()
    process = subprocess.Popen([str(item) for item in command], cwd=cwd, env=environment,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    stdout = stderr = b""
    failure = None
    try:
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except BaseException as error:
            failure = type(error).__name__
            if isinstance(error, subprocess.TimeoutExpired):
                stdout, stderr = error.output or b"", error.stderr or b""
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            try:
                stdout, stderr = process.communicate(timeout=20)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                stdout, stderr = process.communicate(timeout=5)
            raise
    finally:
        (evidence / (label + ".stdout")).write_bytes(stdout)
        (evidence / (label + ".stderr")).write_bytes(stderr)
        report["stages"].append({"name": label, "returncode": process.returncode,
                                 "seconds": round(time.monotonic() - started, 3),
                                 **({"failure": failure} if failure else {})})
        (evidence / "result.json").write_text(json.dumps(report, indent=2) + "\n")
    if check and process.returncode:
        raise RuntimeError(label + " failed; original output retained")
    return process.returncode, stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wheel", type=Path)
    parser.add_argument("--executable", required=True, help="Installed Codex CLI 0.160.0, or the pinned 0.162 app engine")
    parser.add_argument("--workspace", type=Path, required=True, help="New disposable directory; never reuse a prior run")
    args = parser.parse_args()
    wheel = args.wheel.resolve(strict=True)
    root = args.workspace.expanduser().absolute()
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    evidence = root / "evidence"
    evidence.mkdir()
    environment = {**os.environ, "XDG_CONFIG_HOME": str(root / "config"),
        "XDG_DATA_HOME": str(root / "data"), "KOTO_HISTORY_HOME": str(root / "history"),
        "CODEX_HOME": str(root / "native-codex"),
        "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1",
        "PIP_DISABLE_PIP_VERSION_CHECK": "1", "PIP_NO_INPUT": "1",
        "PIP_TIMEOUT": "30", "PIP_RETRIES": "2"}
    for name in ("PYTHONPATH", "KOTO_CONFIG", "HORMUZ_CONFIG", "HORMUZ_HISTORY_HOME"):
        environment.pop(name, None)
    first, second = root / "first-directory", root / "second-directory"
    first.mkdir()
    second.mkdir()
    # A planted working-directory file must not shadow user configuration.
    (second / "koto.json").write_text("untrusted implicit configuration")
    native_home = root / "native-codex"
    native_home.mkdir(mode=0o700)
    original = 'personality = "none"\n# retained first-run preference\n'
    settings = native_home / "config.toml"
    settings.write_text(original)
    selected = root / "config/koto/config.json"
    client_home = selected.with_name(selected.name + ".codex")
    venv = root / "installed-product"
    python = venv / "bin/python"
    cli = venv / "bin/koto"
    report = {"wheel_sha256": digest(wheel), "source_revision": os.environ.get("GITHUB_SHA"),
              "system": platform.system(), "machine": platform.machine(),
              "os_version": platform.mac_ver()[0],
              "requested_real_assets": True, "synthetic_client_or_model": False, "stages": [], "passed": False}

    def save():
        (evidence / "result.json").write_text(json.dumps(report, indent=2) + "\n")

    def run(label, command, *, timeout=60, cwd=first, check=True):
        return run_stage(label, command, evidence=evidence, report=report, environment=environment,
                         cwd=cwd, timeout=timeout, check=check)

    def diagnose_failed_startup():
        # Diagnostics cannot turn the original failed journey into a pass.
        # This fresh test machine has only synthetic task data and no account
        # credentials. Reuse the installed product's exact startup arguments,
        # capture prompt-free engine output, submit no inference, and stop the
        # directly owned diagnostic process within a fixed deadline.
        run("cleanup-before-diagnostics", [cli, "off", "--client-home", client_home], timeout=30, check=False)
        run("hardware-memory", ["/usr/sbin/sysctl", "-n", "hw.memsize"])
        _, output = run("runtime-startup-command", [python, "-c",
            "import json,sys; from hormuz.config import GatewayConfig; "
            "from hormuz.managed_llama import runtime_arguments; "
            "print(json.dumps(runtime_arguments(GatewayConfig.load(sys.argv[1]).managed_llama)))", selected])
        command = json.loads(output)
        environment_keys = ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT")
        diagnostic_environment = {key: environment[key] for key in environment_keys if key in environment}
        with (evidence / "runtime-startup-diagnostic.log").open("wb") as log:
            process = subprocess.Popen(command, cwd=root, env=diagnostic_environment, stdin=subprocess.DEVNULL,
                stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                process.wait(timeout=70)
            except subprocess.TimeoutExpired:
                report["diagnostic_alive_after_seconds"] = 70
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                report["diagnostic_exit_code"] = process.returncode

    setup = [cli, "init", "--yes", "--executable", args.executable]
    try:
        if (platform.system(), platform.machine()) != ("Darwin", "arm64"):
            raise RuntimeError("Real bootstrap acceptance requires the declared Darwin arm64 platform")
        run("create-environment", [sys.executable, "-m", "venv", venv])
        run("install-wheel", [python, "-m", "pip", "install", wheel], timeout=180)
        run("installed-package-location", [python, "-c", "from pathlib import Path; import hormuz, sys; "
            "print(hormuz.__file__); assert Path(hormuz.__file__).resolve().is_relative_to(Path(sys.prefix).resolve())"])
        run("client-version", [args.executable, "--version"])
        _, path_a = run("config-first-directory", [cli, "config", "path"])
        _, path_b = run("config-second-directory", [cli, "config", "path"], cwd=second)
        if path_a.strip() != str(selected).encode() or path_b != path_a:
            raise RuntimeError("Configuration changes with the working directory")
        project = root / "explicit-project"
        _, project_path = run("explicit-project", [cli, "--project", project, "config", "path"], cwd=second)
        if project_path.strip() != str(project / ".koto/config.json").encode():
            raise RuntimeError("Explicit project selection was ignored")
        run("preview", [*setup, "--dry-run"])
        if selected.exists() or (root / "data").exists() or settings.read_text() != original:
            raise RuntimeError("Preview changed configuration or created asset state")

        # Interrupt real transfer after bytes arrive, then restart the same
        # public command. Never fake platform checks, weights, or the client.
        with (evidence / "interrupted-init.stdout").open("wb") as stdout, \
                (evidence / "interrupted-init.stderr").open("wb") as stderr:
            process = subprocess.Popen([str(item) for item in setup], cwd=first, env=environment,
                stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
            try:
                deadline = time.monotonic() + 300
                progress = None
                while time.monotonic() < deadline and process.poll() is None:
                    partials = list((root / "data/koto/assets").glob("*/model.gguf.part"))
                    if partials and partials[0].stat().st_size >= 1024 * 1024:
                        progress = partials[0]
                        break
                    time.sleep(0.1)
                if progress is None:
                    raise RuntimeError("No real model transfer was observed before the interruption deadline")
                process.send_signal(signal.SIGTERM)
                if process.wait(timeout=25) != 130:
                    raise RuntimeError("Interrupted init did not report cancellation")
                report["interrupted_model_bytes"] = progress.stat().st_size
                report["stages"].append({"name": "interrupted-download", "returncode": 130})
                if selected.exists() or settings.read_text() != original:
                    raise RuntimeError("Interrupted acquisition changed client settings")
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=20)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
        _, output = run("resume-and-setup", setup, timeout=1800, cwd=second)
        ready = json.loads(output)
        if ready["connection"]["router"] != "ready" or ready["connection"]["local_runtime"]["state"] != "ready":
            raise RuntimeError("Setup did not verify the owned runtime")
        config = json.loads(selected.read_text())
        report["runtime_context_tokens"] = config["managed_llama"]["context_tokens"]
        if report["runtime_context_tokens"] != 8192:
            raise RuntimeError("The declared starter context was not installed")
        before = digest(selected)
        model = Path(config["managed_llama"]["model_file"])
        model_digest = digest(model)
        run("hardware-memory", ["/usr/sbin/sysctl", "hw.memsize", "hw.ncpu"])
        run("hardware-virtualization", ["/usr/sbin/sysctl", "-n", "kern.hv_vmm_present"], check=False)
        run("graphics-device", ["/usr/sbin/system_profiler", "SPDisplaysDataType"], timeout=30)
        _, runtime_output = run("runtime-device-choice", [python, "-c",
            "import json,sys; from hormuz.config import GatewayConfig; "
            "from hormuz.managed_llama import runtime_arguments; "
            "argv=runtime_arguments(GatewayConfig.load(sys.argv[1]).managed_llama); "
            "print(json.dumps({'gpu_layers':argv[argv.index('--n-gpu-layers')+1] if '--n-gpu-layers' in argv else 'auto'}))",
            selected])
        report["runtime_device_choice"] = json.loads(runtime_output)
        prompt = root / "handoff-note.txt"
        prompt.write_text('Extract the responsible person and deadline from this handoff note. '
            'Return only a JSON object with keys "owner" and "due_date" (YYYY-MM-DD), without markdown. '
            'Note: Rina will deliver the demo by November 3, 2026. Lee is keeping the old archive. /no_think')
        task_code, output = run("useful-extraction-task", [cli, "chat", "ask",
            "--model", ready["configuration"]["model"], "--prompt-file", prompt,
            "--max-output-tokens", "512", "--effort", "low", "--timeout-seconds", "90"],
            timeout=110, cwd=second, check=False)
        task_passed = False
        if task_code == 0:
            try:
                result = json.loads(output)
                task_passed = result["locality"] == "local" and json.loads(result["text"].strip()) == {
                    "owner": "Rina", "due_date": "2026-11-03"}
            except (ValueError, KeyError, TypeError):
                pass
        report["task_check"] = ("exact independently checked extraction passed" if task_passed
                                else "original extraction failed; no retry")
        if not task_passed:
            run("memory-at-task-failure", ["/usr/bin/vm_stat"], check=False)
            run("process-resources-at-task-failure", ["/bin/ps", "-axo", "pid=,ppid=,%cpu=,rss=,etime=,comm="], check=False)
        # This removes the explicit-chat owner binding as well as its runtime.
        run("disconnect", [cli, "off"], timeout=30)
        if settings.read_text() != original:
            raise RuntimeError("Disconnect did not restore owned client settings")
        run("restart-offline", [*setup, "--offline"], timeout=180, cwd=second)
        _, routing_output = run("status-after-restart", [cli, "status", "--routing"])
        routing = json.loads(routing_output)
        if not routing["routes"] or any(route["coding_readiness"] == "qualified" or route["automatic_task_types"]
                                       for route in routing["routes"]):
            raise RuntimeError("Bootstrap unexpectedly enabled automatic coding")
        run("disconnect-after-restart", [cli, "off"], timeout=30)
        # Read only selected content-free fields after owned cleanup settles.
        # Do not export credentials, prompts, work records or answer content.
        run("request-timing-metadata", [python, "-c",
            "import json,sqlite3,sys; from contextlib import closing; from pathlib import Path; "
            "queries={'events':'SELECT sequence,state,reason_code FROM gateway_request_attempt_events ORDER BY occurred_at,sequence', "
            "'metrics':'SELECT provider_status,response_headers_us,first_body_byte_us,total_us,provider_bytes_read,downstream_bytes_sent FROM gateway_provider_attempt_metrics UNION ALL SELECT provider_status,response_headers_us,first_body_byte_us,total_us,provider_bytes_read,downstream_bytes_sent FROM gateway_provider_attempt_metrics_v2'}; "
            "\nwith closing(sqlite3.connect(Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True,timeout=5)) as db:\n"
            " db.row_factory=sqlite3.Row\n"
            " print(json.dumps({key:[dict(row) for row in db.execute(query)] for key,query in queries.items()}))",
            config["database"]])
        for port in (config["listen"]["port"], urlsplit(config["upstreams"]["local-llama"]["base_url"]).port):
            with socket.socket() as connection:
                connection.settimeout(2)
                if connection.connect_ex(("127.0.0.1", port)) == 0:
                    raise RuntimeError("Owned runtime/router endpoint remained open after disconnect")
        run("uninstall-product", [python, "-m", "pip", "uninstall", "-y", "koto-router"])
        if cli.exists() or (venv / "bin/hormuz").exists():
            raise RuntimeError("Uninstall retained the product entry points")
        if settings.read_text() != original or digest(selected) != before or digest(model) != model_digest:
            raise RuntimeError("Removal changed retained configuration, assets, or client preferences")
        report.update(passed=task_passed, assets_retained=True, configuration_retained=True,
                      coding_qualified=False, automatic_selection_enabled=False)
        if not task_passed:
            raise RuntimeError("The original local extraction failed; restart/removal were checked separately")
    except BaseException as error:
        report["failure"] = str(error)
        if selected.is_file() and "resume-and-setup failed" in str(error):
            try:
                diagnose_failed_startup()
            except Exception as diagnostic_error:
                report["diagnostic_failure"] = str(diagnostic_error)
        raise
    finally:
        if cli.exists():
            try:
                run("cleanup-chat-owner", [cli, "off"], timeout=30, check=False)
                run("cleanup-owned-runtime", [cli, "off", "--client-home", client_home], timeout=30, check=False)
            except Exception as error:
                report["cleanup_failure"] = str(error)
        save()
    print("Installed-product lifecycle passed; configuration and models are deliberately retained.")


if __name__ == "__main__":
    main()
