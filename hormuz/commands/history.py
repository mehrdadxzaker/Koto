"""Explicit local-history management without model credentials or a live router."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def add_history_commands(subparsers: argparse._SubParsersAction) -> None:
    history = subparsers.add_parser("history", help="Manage opt-in encrypted history on this device")
    commands = history.add_subparsers(dest="history_command", required=True)
    commands.add_parser("status", help="Show collection consent and local storage metadata")
    enable = commands.add_parser("enable", help="Opt in to future redacted content and usage capture")
    enable.add_argument("--actor", help="Configured actor ID (required when there are multiple actors)")
    enable.add_argument("--retention-days", type=int, default=30, help="Retention in days (default 30)")
    commands.add_parser("disable", help="Stop future capture; retain existing history")
    listing = commands.add_parser("list", help="List retained request metadata without content")
    listing.add_argument("--limit", type=int, default=50, help="Maximum entries (default 50)")
    show = commands.add_parser("show", help="Explicitly review one entry including decrypted redacted content")
    show.add_argument("id", help="Retained history entry ID")
    commands.add_parser("insights", help="Summarize retained usage and configured cost estimates without content")
    export = commands.add_parser("export", help="Write decrypted confidential content to a local file; no uploads or overwrite")
    export.add_argument("--output", required=True, help="New local file containing decrypted confidential content; never overwritten")
    export.add_argument("--id", action="append", dest="entry_ids", help="Export only this entry ID (repeatable; default all)")
    delete = commands.add_parser("delete", help="Permanently delete retained history; usage accounting is retained")
    selection = delete.add_mutually_exclusive_group(required=True)
    selection.add_argument("id", nargs="?", help="Delete one entry ID")
    selection.add_argument("--all", action="store_true", help="Delete all retained entries and invalidate pending captures")
    learning = commands.add_parser("learning", help="Opt in to personal model selection from checked history")
    operations = learning.add_subparsers(dest="learning_command", required=True)
    for name in ("enable", "disable", "status", "scorecard"):
        operations.add_parser(name)
    validate = operations.add_parser("validate", help="Check held-out quality and latency before optional automatic selection")
    validate.add_argument("--baseline", required=True, help="The commercial model already selected in the client")
    validate.add_argument("--activate", action="store_true", help="Enable selection only if held-out validation passes")
    evaluate = operations.add_parser("evaluate", help="Explicit bounded local replay using existing independent history checks")
    evaluate.add_argument("--id", action="append", dest="entry_ids", required=True)
    evaluate.add_argument("--models", nargs="+", required=True)
    evaluate.add_argument("--max-requests", type=int, default=8)
    evaluate.add_argument("--max-output-tokens", type=int, default=512)
    evaluate.add_argument("--timeout-seconds", type=float, default=30)
    evaluate.add_argument("--deadline-seconds", type=float, default=90)
    feedback = commands.add_parser("feedback", help="Explicitly assess a retained task outcome")
    feedback.add_argument("id")
    assessment = feedback.add_mutually_exclusive_group(required=True)
    assessment.add_argument("--result", choices=("pass", "fail", "unknown"))
    assessment.add_argument("--checks", help="JSON reference checks applied to the retained response; no code execution")
    feedback.add_argument("--partition", choices=("development", "held_out"), default="development")


def _actor(config_path: str, selected: str | None) -> str:
    from .._config_input import load_configuration_input
    from ..local_history import LocalHistoryError

    try:
        raw = load_configuration_input(Path(config_path).expanduser())
        identities = raw.get("identities", [])
        if not isinstance(identities, list):
            raise ValueError
        actors = {item["actor_id"] for item in identities if isinstance(item, dict)
                  and isinstance(item.get("actor_id"), str) and item["actor_id"].strip()}
    except (OSError, ValueError, AttributeError, TypeError):
        raise LocalHistoryError("history_configuration_invalid") from None
    if selected is not None:
        if selected not in actors:
            raise LocalHistoryError("history_actor_unknown")
        return selected
    if len(actors) != 1:
        raise LocalHistoryError("history_actor_required")
    return next(iter(actors))


def run(args: argparse.Namespace) -> int:
    from ..local_history import LocalHistory, LocalHistoryError

    try:
        history = LocalHistory(Path(args.config))
        if args.history_command == "learning":
            from ..personal_selection import scorecard, status
            operation = args.learning_command
            if operation in {"validate", "evaluate"}:
                from ..config import GatewayConfig
                if operation == "validate":
                    from ..personal_selection import validate_selection
                    result = validate_selection(GatewayConfig.load(args.config), history, args.baseline, args.activate)
                else:
                    from ..personal_evaluation import evaluate
                    result = evaluate(GatewayConfig.load(args.config), history, args)
            else:
                result = (history.learning_enable() if operation == "enable" else history.learning_disable()
                          if operation == "disable" else scorecard(history) if operation == "scorecard" else status(history))
        elif args.history_command == "feedback":
            from ..model_benchmark import load_document
            checks = None
            if args.checks:
                checks = load_document(args.checks)
                if type(checks) is not list:
                    raise LocalHistoryError("personal_selection_quality_invalid")
            result = history.learning_feedback(args.id, args.result, args.partition, checks)
        elif args.history_command == "enable":
            result = history.enable(_actor(args.config, args.actor), args.retention_days)
        elif args.history_command == "disable":
            result = history.disable()
        elif args.history_command == "list":
            result = history.list_entries(args.limit)
        elif args.history_command == "show":
            result = history.get(args.id)
        elif args.history_command == "insights":
            result = history.insights()
        elif args.history_command == "export":
            result = history.export(Path(args.output), args.entry_ids)
        elif args.history_command == "delete":
            result = history.delete_all() if args.all else history.delete(args.id)
        else:
            result = history.status()
        print(json.dumps({"version": 1, **result}, indent=2, sort_keys=True))
        if result["schema_id"] == "koto.personal-selection-evaluation":
            return 0 if result["passed"] == result["planned"] else 2
        return 2 if result.get("passed") is False else 0
    except LocalHistoryError as error:
        code = error.code
    except (OSError, ValueError, TypeError):
        code = "history_unavailable"
    print(json.dumps({"version": 1, "schema_id": "hormuz.local-history-error", "schema_version": 1,
                      "error": {"code": code}}, sort_keys=True))
    return 2
