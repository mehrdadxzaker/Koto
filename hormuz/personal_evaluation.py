"""Finite, explicit local replay of independently checked historical text tasks."""
import errno
import http.client
import time

from .local_history_files import LocalHistoryError
from .model_benchmark import RouterClient, benchmark_profile_digest, check_answer, number
from .personal_selection import evaluation_source, retained_prompt


def evaluate(config, history, args):
    state, records = history.learning_snapshot()
    if not state["enabled"]:
        raise LocalHistoryError("personal_selection_consent_required")
    models = args.models if args.models is not None else sorted(
        alias for alias in dict(config.route_admission.local_routes)
        if config.model_routes[alias].protocol == "openai"
        and config.upstreams[config.model_routes[alias].destination_id].locality == "local")
    if args.models is None and not models:
        raise LocalHistoryError("personal_selection_local_evaluation_unavailable")
    if (not 1 <= len(models) <= 8 or len(set(models)) != len(models)
            or not 1 <= len(args.entry_ids) <= 16 or len(set(args.entry_ids)) != len(args.entry_ids)
            or type(args.max_requests) is not int or not 1 <= args.max_requests <= 128
            or args.models is not None and len(args.entry_ids) * len(models) > args.max_requests
            or not number(args.timeout_seconds, .05, 120) or not number(args.deadline_seconds, .05, 1800)
            or not 1 <= args.max_output_tokens <= 4096):
        raise LocalHistoryError("personal_selection_evaluation_budget_invalid")
    routes = []
    for alias in models:
        route = config.model_routes.get(alias)
        if (route is None or config.upstreams[route.destination_id].locality != "local" or route.protocol != "openai"
                or alias not in dict(config.route_admission.local_routes)):
            raise LocalHistoryError("personal_selection_local_evaluation_only")
        routes.append(route)
    sources = []
    for source_id in args.entry_ids:
        source = next((row for row in records if row["id"] == source_id), None)
        if source is None:
            raise LocalHistoryError("personal_selection_evaluation_source_invalid")
        payload = {**source["selection"]["parameters"], "input": retained_prompt(source), "store": False}
        evaluation_source(history, state["actor_id"], source_id, payload)
        if (type(payload.get("max_output_tokens")) is not int or payload["max_output_tokens"] > args.max_output_tokens
                or benchmark_profile_digest(payload) != source["selection"]["profile"]):
            raise LocalHistoryError("personal_selection_evaluation_budget_invalid")
        sources.append((source, payload))
    deadline = time.monotonic() + args.deadline_seconds
    client = RouterClient(config, state["actor_id"])
    observations = []
    stopped, failures, submitted = None, 0, 0
    try:
        bindings = client.bindings(routes, timeout=min(args.timeout_seconds, args.deadline_seconds),
                                   discover=args.models is None)
        routes = [route for route in routes if route.alias in bindings]
        if not routes:
            raise LocalHistoryError("personal_selection_local_evaluation_unavailable")
        if len(sources) * len(routes) > args.max_requests:
            raise LocalHistoryError("personal_selection_evaluation_budget_invalid")
        for source, payload in sources:
            for route in routes:
                row = {"source_entry": source["id"], "model": route.alias, "quality": "unknown", "error": None}
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    stopped = "deadline"
                if stopped:
                    row["error"] = "not_run_" + stopped
                    observations.append(row)
                    continue
                try:
                    current, _ = history.learning_snapshot(state["actor_id"])
                    if current.get("generation") != state["generation"]:
                        raise LocalHistoryError("personal_selection_consent_changed")
                    evaluation_source(history, state["actor_id"], source["id"], payload)
                    submitted += 1
                    status, headers, response, _ = client.request({**payload, "model": route.alias},
                        timeout=min(args.timeout_seconds, remaining), extra_headers={"X-Koto-History-Evaluation": source["id"]})
                    if status != 200:
                        row["error"] = "http_" + str(status)
                        if status in (429, 529):
                            stopped = "capacity"
                    elif (headers.get("x-hormuz-destination-locality") != "local"
                            or headers.get("x-hormuz-destination-generation") != bindings[route.alias]
                            or headers.get("x-hormuz-destination") != route.destination_id
                            or headers.get("x-hormuz-routed-model") != route.upstream_model
                            or type(response) is not dict or response.get("status") != "completed"
                            or response.get("model") != route.upstream_model or response.get("error") is not None):
                        row["error"] = "execution_unverified"
                    else:
                        row["quality"] = "pass" if all(check_answer(check, response) for check in source["quality"]["checks"]) else "fail"
                    failures = failures + 1 if row["error"] else 0
                except (OSError, http.client.HTTPException, ValueError) as error:
                    client.close()
                    row["error"] = error.code if isinstance(error, LocalHistoryError) else "request_failed"
                    failures += 1
                    if isinstance(error, OSError) and error.errno == errno.EADDRNOTAVAIL:
                        stopped = "socket_exhaustion"
                    if isinstance(error, LocalHistoryError):
                        stopped = "consent_or_evidence_changed"
                if failures >= 3:
                    stopped = "repeated_failure"
                observations.append(row)
    finally:
        client.close()
    return {"schema_id": "koto.personal-selection-evaluation", "schema_version": 1,
            "planned": len(sources) * len(routes), "submitted": submitted,
            "passed": sum(row["quality"] == "pass" for row in observations), "observations": observations,
            "retries": 0, "concurrency": 1, "local_only": True}
