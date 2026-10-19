"""Consented native host observations, separate from model-wire qualification."""

import json
import time
from uuid import uuid4

from .credentials import resolve_upstream_credentials
from .local_history_capture import history_redactor
from .local_history_files import LocalHistoryError
from .model_benchmark import benchmark_route_fingerprint, digest
from .personal_selection import machine_digest


def _capture_text(redactor, text, maximum):
    if len(text.encode("utf-8")) > maximum:
        return "", "omitted_limit"
    filtered = redactor.inspect({"text": text}).value["text"]
    return (("", "omitted_limit") if len(json.dumps(filtered, ensure_ascii=False).encode("utf-8")) > maximum
            else (filtered, "captured"))


def begin_host_attempt(history, config, actor_id, model_alias, prompt, profile_digest, recommendation=None):
    """Snapshot existing consent; never enable collection or grant admission."""
    ticket = history.begin(actor_id)
    if ticket is None:
        return None
    route = config.model_routes[model_alias]
    destination = config.upstreams[route.destination_id]
    protected = [("credential", identity.token) for identity in config.identities_by_token.values() if identity.token]
    protected.extend(("credential", credential) for credential in resolve_upstream_credentials(config).values() if credential)
    if config.ingress.credential:
        protected.append(("credential", config.ingress.credential))
    redactor = history_redactor(config.secret_controls, protected)
    text, request_status = _capture_text(redactor, prompt, 64 * 1024)
    entry = {
        "id": uuid4().hex, "recorded_at": time.time(), "actor_id": actor_id,
        "client": "codex", "protocol": "codex_app_server", "requested_model": model_alias,
        "routed_model": route.upstream_model, "destination": route.destination_id,
        "locality": destination.locality, "outcome": "outcome_unknown", "http_status": None,
        "input_tokens": None, "output_tokens": None, "estimated_cost_microusd": None,
        "cost_reason": "native_plan_unpriced" if destination.locality == "cloud" else "local_compute_unpriced",
        "latency_ms": 0, "request_text": [{"role": "user", "text": text}] if request_status == "captured" else [],
        "response_text": "", "request_content_status": request_status, "response_content_status": "unsupported",
    }
    learning, _ = history.learning_snapshot(actor_id)
    if learning["enabled"] and request_status == "captured":
        entry["selection"] = {
            "model": model_alias, "generation": learning["generation"],
            "route": benchmark_route_fingerprint(config, route), "profile": profile_digest,
            "machine": machine_digest(), "task": digest({"text": text, "profile": profile_digest}),
            "fresh": True, "replayable": False, "verified_response": False, "parameters": {},
            "decision": {**recommendation, "executed_model": model_alias} if recommendation else {},
        }
    return _HostAttempt(history, ticket, entry, redactor)


class _HostAttempt:
    def __init__(self, history, ticket, entry, redactor):
        self.history, self.ticket, self.entry, self.redactor = history, ticket, entry, redactor

    def finish(self, observation, execution_verified=False):
        required = {"outcome", "complete", "text", "latency_ms"}
        if (type(observation) is not dict or not required <= observation.keys()
                or observation.keys() - required - {"input_tokens", "output_tokens"}
                or type(observation["outcome"]) is not str
                or observation["outcome"] not in {"succeeded", "failed", "outcome_unknown"}
                or type(observation["complete"]) is not bool or type(observation["text"]) is not str
                or type(observation["latency_ms"]) is not int or not 0 <= observation["latency_ms"] < 2**63
                or any(value is not None and (type(value) is not int or not 0 <= value < 2**63)
                       for value in (observation.get("input_tokens"), observation.get("output_tokens")))):
            raise LocalHistoryError("native_history_observation_invalid")
        entry = self.entry
        text, response_status = _capture_text(self.redactor, observation["text"], 128 * 1024)
        entry.update(outcome=observation["outcome"], latency_ms=observation["latency_ms"],
                     input_tokens=observation.get("input_tokens"), output_tokens=observation.get("output_tokens"),
                     response_text=text,
                     response_content_status=response_status if observation["complete"] or response_status != "captured" else "partial")
        if entry["outcome"] == "succeeded" and observation["complete"] is not True:
            entry["outcome"] = "outcome_unknown"
        if "selection" in entry:
            entry["selection"]["verified_response"] = bool(execution_verified is True and observation["complete"] is True
                                                          and entry["outcome"] == "succeeded" and response_status == "captured")
        return entry["id"] if self.history.append(self.ticket, entry) else None
