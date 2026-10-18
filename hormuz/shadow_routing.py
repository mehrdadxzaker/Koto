"""Explicit migration guard for retired binary LLM routing advice.

Historical shadow receipts remain readable through hormuz.contracts. New routing
uses personal_selection in observation or validated automatic mode.
"""


def build_shadow_router(raw, routes, upstreams, admission):
    if raw.get("shadow_router") is not None:
        from .config import ConfigError
        raise ConfigError("shadow_router is retired; remove it in a new configuration, then explicitly enable history learning")
    return None
