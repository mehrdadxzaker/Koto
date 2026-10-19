"""Version-one receipts for fresh native host tasks, separate from HTTP evidence."""
import re
from pathlib import Path

from .common import ContractValidationError, _exact_keys
from .personal_selection import validate as validate_selection

FIELDS = {
    "koto.native-task-error": {"schema_id", "schema_version", "error"},
    "koto.native-task": {"schema_id", "schema_version", "status", "text", "model", "locality",
                         "selection", "history_entry", "execution", "native", "error"},
}
NATIVE_FIELDS = {"status", "text", "usage", "latency_ms", "thread_id", "turn_id", "provider", "model",
                 "account", "facts", "requested", "error", "reroutes", "native_terminal_status", "cleanup"}
FACT_FIELDS = {"native_binary", "native_sha256", "client_version", "native_model", "native_provider",
               "account_identity_digest", "declared_controls_digest"}
STATUSES = {"completed", "failed", "interrupted", "unknown"}


def _require(condition):
    if not condition:
        raise ContractValidationError("Invalid native task receipt")


def _error(value):
    return type(value) is str and re.fullmatch(r"native_[a-z0-9_]{1,120}", value) is not None


def _label(value, maximum=256):
    return type(value) is str and 0 < len(value) <= maximum and "\x00" not in value


def _integer(value):
    return type(value) is int and 0 <= value < 2**63


def _hash(value, length=64):
    return type(value) is str and re.fullmatch(r"[0-9a-f]{" + str(length) + "}", value) is not None


def _text(value):
    return type(value) is str and len(value.encode("utf-8")) <= 2 * 1024 * 1024


def _validate_usage(value):
    if value is None:
        return
    _exact_keys(value, {"last", "total"}, {"modelContextWindow"})
    fields = {"inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"}
    for kind in ("last", "total"):
        _exact_keys(value[kind], fields, {"cacheWriteInputTokens"})
        _require(all(_integer(count) for count in value[kind].values()))
    _require(value.get("modelContextWindow") is None or _integer(value["modelContextWindow"]))


def _validate_native(value):
    _exact_keys(value, NATIVE_FIELDS, {"context_controls_digest"})
    _require(type(value["status"]) is str and value["status"] in STATUSES and _text(value["text"]))
    _require(_integer(value["latency_ms"]))
    _require(all(value[key] is None or _label(value[key]) for key in ("thread_id", "turn_id", "provider", "model")))
    _require(value["error"] is None or _error(value["error"]))
    _require(value["native_terminal_status"] is None or type(value["native_terminal_status"]) is str
             and value["native_terminal_status"] in {"completed", "failed", "interrupted"})
    _validate_usage(value["usage"])
    if value["account"] is not None:
        _exact_keys(value["account"], {"type"}, {"planType"})
        _require(value["account"]["type"] == "chatgpt")
        _require(value["account"].get("planType") is None or _label(value["account"]["planType"], 128))
    if value["facts"] is not None:
        facts = value["facts"]
        _exact_keys(facts, FACT_FIELDS)
        _require(_label(facts["native_binary"], 4096) and Path(facts["native_binary"]).is_absolute())
        _require(all(_hash(facts[key]) for key in ("native_sha256", "account_identity_digest", "declared_controls_digest")))
        _require(_label(facts["client_version"], 128) and _label(facts["native_model"]) and _label(facts["native_provider"], 128))
    if value["requested"] is not None:
        _exact_keys(value["requested"], {"provider", "model"})
        _require(_label(value["requested"]["provider"], 128)
                 and (value["requested"]["model"] is None or _label(value["requested"]["model"])))
    _require(type(value["reroutes"]) is list and len(value["reroutes"]) <= 8)
    for row in value["reroutes"]:
        _exact_keys(row, {"from_model", "to_model"})
        _require(_label(row["from_model"]) and _label(row["to_model"]))
        if value["status"] == "completed":
            _require(row["from_model"] == row["to_model"] == value["model"])
    _exact_keys(value["cleanup"], {"owned_processes_stopped", "scope"})
    _require(type(value["cleanup"]["owned_processes_stopped"]) is bool and value["cleanup"]["scope"] == "owned_process_group")
    if "context_controls_digest" in value:
        _require(_hash(value["context_controls_digest"]))
    if value["status"] == "completed":
        _require(value["native_terminal_status"] == "completed" and value["error"] is None
                 and value["cleanup"]["owned_processes_stopped"] is True
                 and all(value[key] is not None for key in ("thread_id", "turn_id", "provider", "model", "account", "facts", "requested"))
                 and "context_controls_digest" in value)
        _require(value["provider"] == value["requested"]["provider"] and value["model"] == value["requested"]["model"])


def validate(value):
    schema = value["schema_id"]
    _exact_keys(value, FIELDS[schema])
    if schema == "koto.native-task-error":
        _exact_keys(value["error"], {"code"})
        _require(_error(value["error"]["code"]))
        return
    _require(type(value["status"]) is str and value["status"] in STATUSES and _text(value["text"]))
    _require(value["model"] is None or _label(value["model"], 128))
    _require(type(value["locality"]) is str and value["locality"] in {"local", "cloud"})
    _require(value["history_entry"] is None or _hash(value["history_entry"], 32))
    _require(value["error"] is None or _error(value["error"]))
    if value["selection"] is not None:
        _require(type(value["selection"]) is dict and value["selection"].get("schema_id") == "koto.model-selection")
        validate_selection(value["selection"])
    execution = value["execution"]
    _exact_keys(execution, {"verified", "source", "local_attempts"})
    _require(type(execution["verified"]) is bool and type(execution["source"]) is str
             and execution["source"] in {"native_provider_binding", "owned_router_receipts"}
             and (execution["local_attempts"] is None or _integer(execution["local_attempts"])))
    _validate_native(value["native"])
    native = value["native"]
    _require(value["text"] == native["text"])
    if value["selection"] is not None:
        _require(value["selection"]["executed_model"] == value["model"])
    if value["locality"] == "local":
        _require(execution["source"] == "owned_router_receipts")
        if execution["verified"]:
            _require(_integer(execution["local_attempts"]) and execution["local_attempts"] > 0
                     and native["provider"] is not None and native["provider"] != "openai")
    else:
        _require(execution["source"] == "native_provider_binding" and execution["local_attempts"] is None)
        if execution["verified"]:
            _require(native["status"] == "completed" and native["provider"] == "openai"
                     and native["model"] == native["facts"]["native_model"]
                     and native["provider"] == native["facts"]["native_provider"])
    if value["status"] == "completed":
        _require(value["error"] is None and value["model"] is not None and execution["verified"] is True
                 and native["status"] == "completed")
