"""Strict metadata-only observations for client and owned-runtime diagnosis."""
from __future__ import annotations

from collections.abc import Mapping
import re
from typing import Any

from ..client_versions import CODEX_VERSION_PATTERN, SUPPORTED_CODEX_VERSIONS
from .common import ContractValidationError, _exact_keys, _value_integer, _value_mapping, _value_string
from .constants import CLIENT_CHECK_ACTIONS, CLIENT_CHECK_VERSION_PATTERN, RUNTIME_CHECK_ACTIONS


def validate_client_check(value: Mapping[str, Any]) -> None:
    _exact_keys(value, {"schema_id", "schema_version", "reason", "action", "observed_version"})
    reason = _value_string(value, "reason")
    if reason not in CLIENT_CHECK_ACTIONS or value.get("action") != CLIENT_CHECK_ACTIONS[reason]:
        raise ContractValidationError("invalid client-check reason or recovery action")
    version = value.get("observed_version")
    if reason in {"version_supported", "version_unqualified"}:
        if (type(version) is not str or len(version) > 128
                or re.fullmatch(CLIENT_CHECK_VERSION_PATTERN, version, re.ASCII) is None):
            raise ContractValidationError("invalid observed client version")
        if (reason == "version_supported") != (version in SUPPORTED_CODEX_VERSIONS):
            raise ContractValidationError("client-check reason disagrees with qualified versions")
    elif version is not None:
        raise ContractValidationError("unobserved client version must be null")


def validate_runtime_check(value: Mapping[str, Any]) -> None:
    _exact_keys(value, {"schema_id", "schema_version", "reason", "action"})
    reason = _value_string(value, "reason")
    if reason not in RUNTIME_CHECK_ACTIONS or value.get("action") != RUNTIME_CHECK_ACTIONS[reason]:
        raise ContractValidationError("invalid runtime-check reason or recovery action")


DIAGNOSIS_FIELDS = {
    "schema_id", "schema_version", "connection", "client_compatibility", "supported_client_version",
    "configuration_binding", "routing_mode", "qualified_local_routes", "model_readiness",
    "task_completion", "scope", "project_overrides", "override_diagnosis", "action",
}
_LEGACY_ACTIONS = {
    "none", "preview_connection", "inspect_recovery", "inspect_configuration_changes",
    "inspect_owned_runtime", "select_supported_client", "select_owned_configuration",
    "inspect_remote_connection", "inspect_launch_overrides", "inspect_profile_overrides",
    "inspect_project_overrides", "inspect_launch_configuration", "inspect_profile_configuration",
    "inspect_project_configuration",
}


def validate_diagnosis(value: Mapping[str, Any]) -> None:
    from ..contracts import validate_contract

    if "error" in value:
        _exact_keys(value, {"schema_id", "schema_version", "error"})
        error = _value_mapping(value, "error")
        _exact_keys(error, {"code"}, path="error")
        if _value_string(error, "code", path="error") not in {"configuration_invalid", "diagnosis_unavailable"}:
            raise ContractValidationError("invalid diagnosis failure")
        return
    fields = DIAGNOSIS_FIELDS | ({"client_check", "runtime_check"} if value["schema_version"] == 2 else set())
    _exact_keys(value, fields)
    connection = _value_mapping(value, "connection")
    if connection.get("schema_id") != "hormuz.connected-client-status":
        raise ContractValidationError("invalid diagnosis connection receipt")
    validate_contract(connection)
    compatibility = _value_string(value, "client_compatibility")
    if compatibility not in {"unobserved", "supported", "unsupported", "unavailable"}:
        raise ContractValidationError("invalid diagnosis compatibility")
    version = _value_string(value, "supported_client_version")
    if len(version) > 128 or re.fullmatch(CODEX_VERSION_PATTERN, version, re.ASCII) is None:
        raise ContractValidationError("invalid diagnosis supported client version")
    binding = _value_string(value, "configuration_binding")
    if binding not in {"unowned", "matching", "different"}:
        raise ContractValidationError("invalid diagnostic configuration binding")
    if binding == "different":
        if value.get("routing_mode") != "unobserved" or value.get("qualified_local_routes") is not None:
            raise ContractValidationError("mismatched diagnostic configuration cannot establish routing")
    else:
        if _value_string(value, "routing_mode") not in {"configured", "auto", "local_only"}:
            raise ContractValidationError("invalid diagnosis routing mode")
        _value_integer(value, "qualified_local_routes", minimum=0)
    if (value.get("model_readiness") != "unobserved" or value.get("task_completion") != "unobserved"
            or value.get("scope") != "codex_user_defaults"):
        raise ContractValidationError("diagnosis cannot establish model or task readiness")
    overrides = _value_mapping(value, "override_diagnosis")
    _exact_keys(overrides, {"schema_id", "schema_version", "supported_client_version", "scope", "project_state",
                            "layers", "conflicts", "launch_state", "effective_routing", "running_session"}, {"error"})
    if (overrides.get("schema_id") != "hormuz.client-overrides"
            or type(overrides.get("schema_version")) is not int or overrides["schema_version"] != 1
            or overrides.get("supported_client_version") != version
            or overrides.get("scope") != "selected_project_and_supplied_launch"
            or overrides.get("running_session") != "unobserved"
            or _value_string(overrides, "project_state") not in {"none", "detected", "ignored", "inactive", "invalid"}
            or overrides.get("project_state") != value.get("project_overrides")
            or _value_string(overrides, "launch_state") not in {"not_supplied", "remote", "detected", "none", "unobserved"}
            or not isinstance(overrides.get("layers"), list) or not isinstance(overrides.get("conflicts"), list)):
        raise ContractValidationError("invalid retained override diagnosis")
    effective = _value_mapping(overrides, "effective_routing")
    _exact_keys(effective, {"model", "model_provider", "model_providers", "web_search", "openai_base_url"})
    if any(type(item) is not str or item not in {"matches", "overridden", "unobserved"} for item in effective.values()):
        raise ContractValidationError("invalid override routing observation")
    if "error" in overrides:
        error = _value_mapping(overrides, "error")
        _exact_keys(error, {"code"})
        if error.get("code") != "override_inspection_unavailable" or set(effective.values()) != {"unobserved"}:
            raise ContractValidationError("invalid override inspection failure")
    actions = _LEGACY_ACTIONS
    if value["schema_version"] == 2:
        for field, schema_id in (("client_check", "hormuz.client-check"), ("runtime_check", "hormuz.runtime-check")):
            check = _value_mapping(value, field)
            if check.get("schema_id") != schema_id:
                raise ContractValidationError("invalid nested diagnostic kind")
            validate_contract(check)
        reason = value["client_check"]["reason"]
        expected = ("unobserved" if reason == "not_checked" else "supported" if reason == "version_supported"
                    else "unavailable" if reason in {"executable_missing", "executable_unlaunchable"} else "unsupported")
        if compatibility != expected:
            raise ContractValidationError("client compatibility disagrees with observed check")
        if reason == "version_supported" and value["client_check"]["observed_version"] != version:
            raise ContractValidationError("supported client observation disagrees with selected profile")
        runtime = connection.get("local_runtime")
        if runtime is None:
            runtime_reasons = {"not_observed", "not_configured"}
        else:
            state = runtime["state"]
            runtime_reasons = {state if state in {"ready", "stopped"} else "owner_unavailable"}
        if value["runtime_check"]["reason"] not in runtime_reasons:
            raise ContractValidationError("runtime diagnosis disagrees with current owned status")
        actions = actions | set(CLIENT_CHECK_ACTIONS.values()) | set(RUNTIME_CHECK_ACTIONS.values())
    if _value_string(value, "action") not in actions:
        raise ContractValidationError("invalid diagnosis recovery action")
