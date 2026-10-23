"""Interactive first run over the existing acquisition and setup owners."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
from types import SimpleNamespace

from ..asset_download import AssetDownloadError
from ..config import ConfigError
from ..config_location import router_home, user_asset_directory
from ..connected_client import ConnectedClientError, ConnectedClientLifetime, lifetime_error
from ..contracts import ContractValidationError, validate_contract
from ..local_acquisition import LocalAcquisitionError, acquire_local
from ..local_setup import setup_local
from ..managed_llama import ManagedLlamaError
from .._contract_schemas.local_acquisition import ERROR_ACTIONS


def add_commands(commands):
    command = commands.add_parser("init", help="Install a verified runtime and model, then configure Codex")
    command.add_argument("--executable", default="codex", help="Existing supported Codex executable")
    command.add_argument("--client-home", help="Explicit Codex home; default is a private home alongside the selected Koto config")
    command.add_argument("--directory", help="Private asset directory (default XDG_DATA_HOME/koto/assets)")
    command.add_argument("--catalog", help="Explicit reviewed catalog for interactive text tasks; default matches the client")
    mode = command.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Preview downloads and paths without writing or connecting")
    mode.add_argument("--offline", action="store_true", help="Reuse verified assets without downloading")
    command.add_argument("--yes", action="store_true", help="Accept the shown download and connection changes without prompting")
    command.add_argument("--timeout-seconds", type=int, default=1800, choices=range(1, 3601), metavar="1..3600")
    config = commands.add_parser("config", help="Inspect explicit configuration selection")
    config.add_subparsers(dest="config_command", required=True).add_parser("path", help="Print the selected absolute configuration path")
    status = commands.add_parser("status", help="Inspect the bootstrap connection for the selected configuration")
    status.add_argument("--client-home", help="Explicit connection home instead of this configuration's private home")
    status.add_argument("--routing", action="store_true", help="Include live qualification and admission status")
    status.set_defaults(client="codex", client_command="status")


def _say(message):
    print(message, file=sys.stderr, flush=True)


def _plan(args, acquisition, home):
    _say(f"Koto configuration: {args.config}")
    _say(f"Codex home: {home}")
    _say(f"Reviewed model/runtime catalog: {acquisition['catalog_id']}")
    for role, artifact in acquisition["artifacts"].items():
        _say(f"  {role}: {artifact['size_bytes']:,} bytes; {artifact['license']}")
        _say(f"    {artifact['url']}")
        _say(f"    License: {artifact['license_url']}")
    storage = acquisition["storage"]
    _say(f"Download remaining: {storage['download_bytes']:,} bytes; "
         f"disk required: {storage['required_free_bytes']:,}; available: {storage['available_bytes']:,}")
    _say("Setup creates or reuses private local credentials and connects this Codex home's user defaults.")
    _say("Existing history and learning choices are preserved; fresh installs start with both disabled.")
    _say("Model installation does not qualify autonomous coding or enable automatic model selection.")


def run(args):
    def interrupt(_signum, _frame):
        raise KeyboardInterrupt()

    previous_term = signal.signal(signal.SIGTERM, interrupt)
    try:
        home = Path(args.client_home).expanduser().absolute() if args.client_home else router_home(args.config)
        acquisition_args = SimpleNamespace(
            catalog=args.catalog, executable=args.executable,
            directory=str(Path(args.directory).expanduser().absolute() if args.directory else user_asset_directory()),
            download=False, offline=False, timeout_seconds=args.timeout_seconds,
        )
        acquisition = acquire_local(acquisition_args, bootstrap=True)
        acquisition_args.expected_catalog_sha256 = acquisition["catalog_sha256"]
        _plan(args, acquisition, home)
        if args.dry_run:
            print(json.dumps(acquisition, sort_keys=True))
            return 0
        if args.offline and acquisition["state"] != "ready":
            raise LocalAcquisitionError("offline_missing")
        if not args.yes:
            if not sys.stdin.isatty():
                _say("Preview with koto init --dry-run, then pass --yes to accept setup without a terminal.")
                return 2
            _say("Download/reuse these assets and connect Codex? [y/N]")
            if input().strip().lower() not in {"y", "yes"}:
                _say("Setup cancelled. No assets downloaded or settings changed.")
                return 0
        acquisition_args.download = not args.offline
        acquisition_args.offline = args.offline
        _say("Installing and verifying runtime and model; an interrupted download can resume on the next init.")
        acquisition = acquire_local(acquisition_args, bootstrap=True)
        options = dict(zip(acquisition["setup_arguments"][::2], acquisition["setup_arguments"][1::2]))
        setup_args = SimpleNamespace(
            config=args.config, executable=args.executable, actor=None, shadow_router=False,
            credential_env=None, dry_run=False,
            qualification=options["--qualification"], runtime_archive=options["--runtime-archive"],
            llama_executable=options["--llama-executable"], model_file=options["--model-file"],
        )
        _say("Creating/reusing configuration and starting the owned local runtime.")
        lifetime = ConnectedClientLifetime(home)
        result = None
        completed = False
        try:
            result = setup_local(lifetime, setup_args)
            connection = result["connection"]
            if (connection.get("phase"), connection.get("router"), connection.get("configuration"),
                    connection.get("local_runtime", {}).get("state")) != ("connected", "ready", "installed", "ready"):
                raise ConnectedClientError("runtime_start_failed")
            normal_home = Path(os.environ.get("CODEX_HOME", "~/.codex")).expanduser().resolve()
            if home.resolve() != normal_home:
                from ..chat_owner import register_owner
                register_owner(normal_home, home.resolve(), connection["generation"])
            print(json.dumps(result, sort_keys=True), flush=True)
            _say("Local connection ready. Task quality and coding qualification remain separate.")
            if home.resolve() not in {normal_home, (Path.home() / ".codex").resolve()}:
                _say("Try a text task: " + shlex.join(["koto", "--config", args.config, "chat", "ask",
                    "--router-home", str(home), "--prompt-file", "/absolute/path/to/note.txt",
                    "--effort", "low", "--max-output-tokens", "512"]))
            else:
                _say("Use the configured Codex client for tasks in this client home.")
            _say("Status: " + shlex.join(["koto", "client", "status", "codex", "--client-home", str(home)]))
            _say("Disconnect before uninstalling: " + shlex.join(["koto", "off", "--client-home", str(home)]))
            completed = True
            return 0
        finally:
            if not completed and result is not None:
                generation = result["connection"].get("generation")
                if generation is not None:
                    lifetime.disconnect(generation=generation)
    except (LocalAcquisitionError, AssetDownloadError, ManagedLlamaError, ContractValidationError,
            ConnectedClientError, ConfigError, OSError, ValueError, KeyError, TypeError,
            subprocess.SubprocessError, KeyboardInterrupt, EOFError) as error:
        if isinstance(error, LocalAcquisitionError) and error.code == "catalog_invalid":
            if args.catalog:
                _say("Select a reviewed interactive text catalog for the supported client; other catalogs use client acquire.")
            else:
                _say("No matching reviewed first-run profile. Use Codex CLI 0.160.0 or the pinned 0.162.0-alpha.17.2 engine via --executable.")
        if isinstance(error, (ConnectedClientError, ConfigError)):
            result = lifetime_error(error)
        else:
            code = (error.code if isinstance(error, LocalAcquisitionError) else
                    str(error) if isinstance(error, AssetDownloadError) else
                    "runtime_invalid" if isinstance(error, ManagedLlamaError) else
                    "interrupted" if isinstance(error, (KeyboardInterrupt, EOFError)) else "installation_changed")
            result = {"schema_id": "hormuz.local-acquisition-error", "schema_version": 1,
                      "error": {"code": code, "action": ERROR_ACTIONS[code]}}
        validate_contract(result)
        print(json.dumps(result), file=sys.stderr)
        return 130 if isinstance(error, (KeyboardInterrupt, EOFError)) else 2
    finally:
        signal.signal(signal.SIGTERM, previous_term)
