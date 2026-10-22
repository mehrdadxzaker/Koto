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
    report = {"wheel_sha256": digest(wheel), "system": platform.system(), "machine": platform.machine(),
              "os_version": platform.mac_ver()[0],
              "requested_real_assets": True, "synthetic_client_or_model": False, "stages": [], "passed": False}

    def save():
        (evidence / "result.json").write_text(json.dumps(report, indent=2) + "\n")

    def run(label, command, *, timeout=60, cwd=first, check=True):
        print(label, flush=True)
        started = time.monotonic()
        process = subprocess.Popen([str(item) for item in command], cwd=cwd, env=environment,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except BaseException:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.communicate(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.communicate(timeout=5)
            raise
        (evidence / (label + ".stdout")).write_bytes(stdout)
        (evidence / (label + ".stderr")).write_bytes(stderr)
        report["stages"].append({"name": label, "returncode": process.returncode,
                                 "seconds": round(time.monotonic() - started, 3)})
        save()
        if check and process.returncode:
            raise RuntimeError(label + " failed; original output retained")
        return process.returncode, stdout

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
        before = digest(selected)
        model = Path(config["managed_llama"]["model_file"])
        model_digest = digest(model)
        prompt = root / "handoff-note.txt"
        prompt.write_text('Extract the responsible person and deadline from this handoff note. '
            'Return only a JSON object with keys "owner" and "due_date" (YYYY-MM-DD), without markdown. '
            'Note: Rina will deliver the demo by November 3, 2026. Lee is keeping the old archive. /no_think')
        _, output = run("useful-extraction-task", [cli, "chat", "ask",
            "--model", ready["configuration"]["model"], "--prompt-file", prompt,
            "--max-output-tokens", "512", "--effort", "low", "--timeout-seconds", "90"], timeout=110, cwd=second)
        result = json.loads(output)
        if result["locality"] != "local" or json.loads(result["text"].strip()) != {"owner": "Rina", "due_date": "2026-11-03"}:
            raise RuntimeError("The original local extraction result failed the frozen independent check")
        report["task_check"] = "exact independently checked extraction passed"
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
        report.update(passed=True, assets_retained=True, configuration_retained=True,
                      coding_qualified=False, automatic_selection_enabled=False)
    except BaseException as error:
        report["failure"] = str(error)
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
