"""User-owned personal scorecards and local model classification."""
from collections import Counter
from functools import lru_cache
import math
import json
import re
import time

from .model_benchmark import benchmark_profile_digest, benchmark_route_fingerprint, digest, machine_facts
from .work_learning import contains_provider_state

from .local_history_files import LocalHistoryError


def validate_quality(value):
    from .model_benchmark import valid_check
    if (type(value) is not dict or set(value) != {"result", "source", "partition", "checks"}
            or value["result"] not in {"pass", "fail", "unknown"}
            or value["partition"] not in {"development", "held_out"}
            or value["source"] not in {"user_feedback", "independent_check"}
            or type(value["checks"]) is not list or len(value["checks"]) > 32
            or any(not valid_check(check) or check["kind"] == "tool_call" for check in value["checks"])
            or bool(value["checks"]) != (value["source"] == "independent_check")
            or len(json.dumps(value, allow_nan=False).encode()) > 65536):
        raise LocalHistoryError("personal_selection_quality_invalid")


def validate_context(value):
    if (type(value) is not dict or set(value) != {"model", "generation", "route", "profile", "machine", "task", "fresh", "replayable", "verified_response", "parameters", "decision"}
            or type(value["model"]) is not str or not 1 <= len(value["model"]) <= 128
            or not re.fullmatch(r"[0-9a-f]{32}", str(value["generation"]))
            or any(type(value[key]) is not str or not re.fullmatch(r"[0-9a-f]{64}", value[key]) for key in ("profile", "machine", "task"))
            or type(value["route"]) is not str or not re.fullmatch(r"destination-v1:[0-9a-f]{64}", value["route"])
            or type(value["fresh"]) is not bool or type(value["replayable"]) is not bool
            or type(value["verified_response"]) is not bool or type(value["parameters"]) is not dict
            or set(value["parameters"]) - {"max_output_tokens", "stream"}
            or type(value["decision"]) is not dict):
        raise LocalHistoryError("personal_selection_context_invalid")


@lru_cache(maxsize=1)
def machine_digest():
    return digest(machine_facts())


def prompt_text(value):
    """Only the latest user text supplies lexical classification features."""
    source = value.get("messages", value.get("input", ""))
    if isinstance(source, list):
        users = [item for item in source if isinstance(item, dict) and item.get("role") == "user"]
        source = users[-1].get("content", "") if users else source
    if isinstance(source, str):
        return source if len(source.encode()) <= 8192 else ""
    if isinstance(source, list):
        text = "\n".join(item["text"] for item in source if isinstance(item, dict)
                          and item.get("type") in {"text", "input_text"} and type(item.get("text")) is str)
        return text if len(text.encode()) <= 8192 else ""
    return ""


def retained_prompt(entry):
    users = [item["text"] for item in entry["request_text"] if item["role"] == "user"]
    return users[-1] if users and len(users[-1].encode()) <= 8192 else ""


def capture_context(config, decision, value, generation, captured_entry, recommendation):
    profile = benchmark_profile_digest(value)
    text = retained_prompt(captured_entry)
    return {"model": decision.resolved_alias, "generation": generation,
            "route": benchmark_route_fingerprint(config, decision.route), "profile": profile,
            "machine": machine_digest(), "task": digest({"text": text, "profile": profile}),
            "verified_response": False,
            "fresh": bool(text) and not contains_provider_state(value) and captured_entry["request_content_status"] == "captured",
            "replayable": (type(value.get("input")) is str and len(captured_entry["request_text"]) == 1
                           and captured_entry["request_content_status"] == "captured"
                           and not set(value) - {"model", "input", "max_output_tokens", "stream", "store"}),
            "parameters": {key: value[key] for key in ("max_output_tokens", "stream") if key in value},
            "decision": {**recommendation, "executed_model": decision.resolved_alias} if recommendation else {}}


def evaluation_source(history, actor_id, source_id, value):
    state, records = history.learning_snapshot(actor_id)
    source = next((row for row in records if row["id"] == source_id), None)
    if (not state["enabled"] or source is None or not source["selection"]["fresh"]
            or not source["selection"]["replayable"] or not source["selection"]["verified_response"]
            or not source.get("quality", {}).get("checks")
            or source["selection"]["profile"] != benchmark_profile_digest(value)
            or value.get("input") != retained_prompt(source)):
        raise LocalHistoryError("personal_selection_evaluation_source_invalid")
    return source


def examples(config, records, baseline, partition, profile=None):
    """One checked winning class per distinct historical task; repeats aren't coverage."""
    groups = {}
    fingerprints = {alias: benchmark_route_fingerprint(config, route) for alias, route in config.model_routes.items()
                    if alias == baseline or alias in dict(config.route_admission.local_routes)}
    for entry in records:
        context, quality = entry["selection"], entry.get("quality")
        if (not quality or not context["fresh"] or not context["verified_response"] or context["machine"] != machine_digest()
                or profile is not None and context["profile"] != profile):
            continue
        route = config.model_routes.get(context["model"])
        if route is None or context["route"] != fingerprints.get(context["model"]):
            continue
        groups.setdefault(context["task"], []).append(entry)
    result = []
    for task, entries in groups.items():
        if {entry["quality"]["partition"] for entry in entries} != {partition}:
            continue
        by_model = {}
        for entry in entries:
            by_model.setdefault(entry["selection"]["model"], []).append(entry)
        baseline_rows = by_model.get(baseline, [])
        if not baseline_rows or any(row["quality"]["result"] != "pass" or row["outcome"] != "succeeded" for row in baseline_rows):
            continue
        base_latency = sum(row["latency_ms"] for row in baseline_rows) / len(baseline_rows)
        passing = []
        for alias, rows in by_model.items():
            if alias != baseline and config.upstreams[config.model_routes[alias].destination_id].locality != "local":
                continue
            if any(row["quality"]["result"] != "pass" or row["outcome"] != "succeeded" for row in rows):
                continue
            passing.append((sum(row["latency_ms"] for row in rows) / len(rows), alias))
        latency, winner = min(passing, default=(base_latency, baseline))
        result.append({"task": task, "text": retained_prompt(baseline_rows[0]), "model": winner,
                       "profile": baseline_rows[0]["selection"]["profile"], "rows": by_model,
                       "baseline_latency_ms": base_latency, "winner_latency_ms": latency})
    return sorted(result, key=lambda row: row["task"])


def predict(examples, text, eligible_models):
    """Bounded unigram cosine 1-nearest-neighbor with explicit abstention."""
    def vector(value):
        return Counter(re.findall(r"[^\W_]+", value.casefold()[:8192]))
    query = vector(text)
    length = math.sqrt(sum(count * count for count in query.values()))
    if not length:
        return None, 0.0, []
    neighbors = []
    for example in examples:
        other = vector(example["text"])
        norm = math.sqrt(sum(count * count for count in other.values()))
        similarity = sum(count * other.get(word, 0) for word, count in query.items()) / (length * norm) if norm else 0
        neighbors.append((similarity, example))
    if not neighbors:
        return None, 0.0, []
    best = max(row[0] for row in neighbors)
    closest = [example for score, example in neighbors if abs(score - best) < 1e-9]
    models = {example["model"] for example in closest}
    if best < 0.65 or len(models) != 1 or next(iter(models)) not in eligible_models:
        return None, round(best, 6), []
    return next(iter(models)), round(best, 6), sorted(example["task"] for example in closest)[:3]


def recommend(config, state, records, value, eligible_models, baseline):
    training = examples(config, records, baseline, "development", benchmark_profile_digest(value))
    alias, similarity, support = predict(training, prompt_text(value), eligible_models)
    validated = validation_current(config, state, records, baseline, benchmark_profile_digest(value))
    return {"schema_id": "koto.model-selection", "schema_version": 1,
            "mode": state["mode"], "status": "classified" if alias else "insufficient_evidence",
            "baseline": baseline, "selected_model": alias or baseline,
            "executed_model": baseline, "similarity": similarity, "support": support, "routing_effect": "none", "validated": validated}


def dataset_digest(records):
    return digest(sorted((entry for entry in records if "quality" in entry), key=lambda entry: entry["id"]))


def pool_fingerprint(config, baseline):
    aliases = {baseline, *dict(config.route_admission.local_routes)}
    return digest({alias: benchmark_route_fingerprint(config, config.model_routes[alias]) for alias in sorted(aliases)})


def validation_current(config, state, records, baseline, profile):
    receipt = state.get("validation")
    return bool(receipt and receipt.get("passed") is True and receipt.get("baseline") == baseline
                and receipt.get("classifier") == "nearest-neighbor.v1"
                and type(receipt.get("expires_at")) in (int, float) and time.time() < receipt["expires_at"]
                and receipt.get("dataset") == dataset_digest(records) and receipt.get("pool") == pool_fingerprint(config, baseline)
                and profile in receipt.get("profiles", []))


def validate_selection(config, history, baseline, activate=False):
    state, records = history.learning_snapshot()
    route = config.model_routes.get(baseline)
    if not state["enabled"]:
        raise LocalHistoryError("personal_selection_consent_required")
    if route is None or config.upstreams[route.destination_id].locality != "cloud":
        raise LocalHistoryError("personal_selection_commercial_baseline_required")
    training = examples(config, records, baseline, "development")
    held = examples(config, records, baseline, "held_out")
    planned = {entry["selection"]["task"] for entry in records if entry.get("quality", {}).get("partition") == "held_out"}
    overlap = {entry["selection"]["task"] for entry in records if entry.get("quality", {}).get("partition") == "development"} & planned
    profiles = sorted({entry["selection"]["profile"] for entry in records if "quality" in entry})
    eligible = {baseline, *dict(config.route_admission.local_routes)}
    unknown = len(planned) - len(held)
    false_local = local_selections = 0
    latency_saved = 0.0
    for case in held:
        alias, _, _ = predict([row for row in training if row["profile"] == case["profile"]], case["text"], eligible)
        rows = case["rows"].get(alias, [])
        if alias is None or not rows:
            unknown += 1
            continue
        passed = all(row["quality"]["result"] == "pass" and row["outcome"] == "succeeded" for row in rows)
        if alias != baseline:
            local_selections += 1
            false_local += not passed
            latency_saved += case["baseline_latency_ms"] - sum(row["latency_ms"] for row in rows) / len(rows)
    coverage = bool(profiles) and all(sum(row["profile"] == profile for row in training) >= 3
                                     and sum(row["profile"] == profile for row in held) >= 3 for profile in profiles)
    passed = coverage and not overlap and unknown == 0 and false_local == 0 and local_selections > 0 and latency_saved > 0
    receipt = {"schema_id": "koto.personal-selection-validation", "schema_version": 1,
               "passed": bool(passed), "baseline": baseline, "classifier": "nearest-neighbor.v1",
               "dataset": dataset_digest(records), "pool": pool_fingerprint(config, baseline),
               "profiles": profiles, "recorded_at": int(time.time()), "expires_at": int(time.time()) + 86400,
               "development_cases": len(training), "held_out_cases": len(planned), "unknown": unknown,
               "partition_overlap": len(overlap), "false_local": false_local, "local_selections": local_selections,
               "latency_saved_ms": round(latency_saved, 3), "cost_savings_microusd": None}
    history.learning_validation(receipt, activate)
    return receipt


def scorecard(history):
    state, records = history.learning_snapshot()
    groups = {}
    for entry in records:
        groups.setdefault(entry["selection"]["model"], []).append(entry)
    models = []
    for alias, entries in sorted(groups.items()):
        quality = {"pass": 0, "fail": 0, "unknown": 0}
        for entry in entries:
            quality[entry.get("quality", {}).get("result", "unknown")] += 1
        costs = [entry["estimated_cost_microusd"] for entry in entries if entry["estimated_cost_microusd"] is not None]
        models.append({"model": alias, "attempts": len(entries), "quality": quality,
                       "transport_failures": sum(entry["outcome"] != "succeeded" for entry in entries),
                       "mean_latency_ms": sum(entry["latency_ms"] for entry in entries) / len(entries),
                       "known_cost_attempts": len(costs), "estimated_cost_microusd": sum(costs) if costs else None})
    return {"schema_id": "koto.personal-scorecard", "schema_version": 1,
            "enabled": state["enabled"], "models": models, "coverage": "retained_consented_history"}


def status(history, actor_id=None, config=None):
    state, records = history.learning_snapshot(actor_id)
    last = next((entry["selection"]["decision"] for entry in records if entry["selection"]["decision"]), None)
    receipt = state["validation"]
    validation_status = "not_validated"
    if receipt:
        valid = receipt["passed"] and receipt["dataset"] == dataset_digest(records) and time.time() < receipt["expires_at"]
        if valid and config is not None:
            valid = receipt["baseline"] in config.model_routes and receipt["pool"] == pool_fingerprint(config, receipt["baseline"])
        validation_status = "current" if valid and config is not None else "setup_unchecked" if valid else "stale"
    return {"schema_id": "koto.personal-selection-status", "schema_version": 1,
            "enabled": state["enabled"], "mode": state["mode"], "examples": len(records),
            "validation": receipt, "validation_status": validation_status,
            "classifier": "nearest-neighbor.v1", "last_selection": last}
