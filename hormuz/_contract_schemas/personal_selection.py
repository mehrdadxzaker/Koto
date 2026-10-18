"""Version-one personal selector receipts; no retained task content is public."""
import math
import re

from .common import ContractValidationError, _exact_keys

FIELDS = {
    "koto.personal-selection-status": {"enabled", "mode", "examples", "validation", "validation_status", "classifier", "last_selection"},
    "koto.personal-scorecard": {"enabled", "models", "coverage"},
    "koto.personal-selection-feedback": {"entry_id", "quality", "source", "partition"},
    "koto.personal-selection-validation": {"passed", "baseline", "classifier", "dataset", "pool", "profiles", "recorded_at", "expires_at",
        "development_cases", "held_out_cases", "unknown", "partition_overlap", "false_local", "local_selections", "latency_saved_ms", "cost_savings_microusd"},
    "koto.personal-selection-evaluation": {"planned", "submitted", "passed", "observations", "retries", "concurrency", "local_only"},
    "koto.model-selection": {"mode", "status", "baseline", "selected_model", "executed_model", "similarity", "support", "routing_effect", "validated"},
}


def _require(condition):
    if not condition:
        raise ContractValidationError("invalid personal-selection receipt")


def _number(value, minimum=0):
    return type(value) in (int, float) and math.isfinite(value) and value >= minimum


def validate(value):
    _require(type(value) is dict and type(value.get("schema_id")) is str and value["schema_id"] in FIELDS)
    schema = value["schema_id"]
    _exact_keys(value, {"schema_id", "schema_version", *FIELDS[schema]}, {"version"})
    _require(type(value["schema_version"]) is int and value["schema_version"] == 1)
    if "version" in value:
        _require(type(value["version"]) is int and value["version"] == 1)
    if "enabled" in value:
        _require(type(value["enabled"]) is bool)
    if "mode" in value:
        _require(value["mode"] in {"observe", "auto"})
    if "classifier" in value:
        _require(value["classifier"] == "nearest-neighbor.v1")
    if schema == "koto.personal-selection-status":
        _require(value["validation_status"] in {"not_validated", "current", "setup_unchecked", "stale"})
        _require(type(value["examples"]) is int and 0 <= value["examples"] <= 1000)
        if value["validation"] is not None:
            validate(value["validation"])
            _require(value["validation"]["schema_id"] == "koto.personal-selection-validation")
        if value["last_selection"] is not None:
            validate(value["last_selection"])
            _require(value["last_selection"]["schema_id"] == "koto.model-selection")
    elif schema == "koto.personal-scorecard":
        _require(value["coverage"] == "retained_consented_history" and type(value["models"]) is list and len(value["models"]) <= 1000)
        for row in value["models"]:
            _exact_keys(row, {"model", "attempts", "quality", "transport_failures", "mean_latency_ms", "known_cost_attempts", "estimated_cost_microusd"})
            _require(type(row["model"]) is str and bool(row["model"]))
            _exact_keys(row["quality"], {"pass", "fail", "unknown"})
            _require(all(type(count) is int and count >= 0 for count in row["quality"].values()))
            _require(type(row["attempts"]) is int and row["attempts"] == sum(row["quality"].values()))
            _require(all(type(row[key]) is int and 0 <= row[key] <= row["attempts"] for key in ("transport_failures", "known_cost_attempts")))
            _require(_number(row["mean_latency_ms"]) and (row["estimated_cost_microusd"] is None or _number(row["estimated_cost_microusd"])))
    elif schema == "koto.personal-selection-feedback":
        _require(type(value["entry_id"]) is str and bool(re.fullmatch(r"[0-9a-f]{32}", value["entry_id"])))
        _require(value["quality"] in {"pass", "fail", "unknown"} and value["partition"] in {"development", "held_out"})
        _require(value["source"] in {"user_feedback", "independent_check"})
    elif schema == "koto.personal-selection-validation":
        _require(type(value["passed"]) is bool and type(value["baseline"]) is str and bool(value["baseline"]))
        _require(all(type(value[key]) is str and bool(re.fullmatch(r"[0-9a-f]{64}", value[key])) for key in ("dataset", "pool")))
        _require(type(value["profiles"]) is list and len(value["profiles"]) <= 1000
                 and all(type(item) is str and bool(re.fullmatch(r"[0-9a-f]{64}", item)) for item in value["profiles"])
                 and len(set(value["profiles"])) == len(value["profiles"]))
        _require(all(type(value[key]) is int and value[key] >= 0 for key in ("recorded_at", "expires_at", "development_cases", "held_out_cases", "unknown", "partition_overlap", "false_local", "local_selections")))
        _require(value["expires_at"] == value["recorded_at"] + 86400 and _number(value["latency_saved_ms"], -1e15))
        _require(value["cost_savings_microusd"] is None)
        if value["passed"]:
            _require(value["development_cases"] >= 3 and value["held_out_cases"] >= 3 and value["profiles"]
                     and value["unknown"] == value["partition_overlap"] == value["false_local"] == 0
                     and 1 <= value["local_selections"] <= value["held_out_cases"] and value["latency_saved_ms"] > 0)
    elif schema == "koto.personal-selection-evaluation":
        _require(all(type(value[key]) is int and 0 <= value[key] <= 128 for key in ("planned", "submitted", "passed")))
        _require(value["passed"] <= value["submitted"] <= value["planned"]
                 and type(value["retries"]) is int and value["retries"] == 0
                 and type(value["concurrency"]) is int and value["concurrency"] == 1 and value["local_only"] is True)
        _require(type(value["observations"]) is list and len(value["observations"]) == value["planned"])
        for row in value["observations"]:
            _exact_keys(row, {"source_entry", "model", "quality", "error"})
            _require(type(row["model"]) is str and bool(row["model"]) and type(row["source_entry"]) is str
                     and bool(re.fullmatch(r"[0-9a-f]{32}", row["source_entry"])) and row["quality"] in {"pass", "fail", "unknown"}
                     and (row["error"] is None or type(row["error"]) is str))
        _require(value["passed"] == sum(row["quality"] == "pass" for row in value["observations"]))
    else:
        _require(all(type(value[key]) is str and 1 <= len(value[key]) <= 128 for key in ("baseline", "selected_model", "executed_model")))
        _require(value["status"] in {"classified", "insufficient_evidence", "validation_required", "unsupported_request", "affinity_preserved"})
        _require(_number(value["similarity"]) and value["similarity"] <= 1 and type(value["validated"]) is bool)
        _require(type(value["support"]) is list and len(value["support"]) <= 3
                 and all(type(item) is str and bool(re.fullmatch(r"[0-9a-f]{64}", item)) for item in value["support"]))
        _require(value["routing_effect"] in {"none", "selected"})
