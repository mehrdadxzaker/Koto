"""Explicit configuration selection, independent of the working directory."""
from __future__ import annotations

import os
from pathlib import Path

from .config import ConfigError


def _absolute_environment(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    if not value:
        return default
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ConfigError(f"{name} must be an absolute path")
    return path


def user_config_path() -> Path:
    return _absolute_environment("XDG_CONFIG_HOME", Path.home() / ".config") / "koto" / "config.json"


def user_asset_directory() -> Path:
    return _absolute_environment("XDG_DATA_HOME", Path.home() / ".local" / "share") / "koto" / "assets"


def router_home(config: str | Path) -> Path:
    path = Path(config).expanduser().absolute()
    return path.with_name(path.name + ".codex")


def resolve_config(explicit: str | None = None, project: str | None = None) -> Path:
    if explicit is not None:
        path = Path(explicit).expanduser()
    elif project is not None:
        path = Path(project).expanduser() / ".koto" / "config.json"
    else:
        for name in ("KOTO_CONFIG", "HORMUZ_CONFIG"):
            if os.environ.get(name):
                return _absolute_environment(name, Path.home()).absolute()
        path = user_config_path()
    # Keep the final entry intact so the setup owner's no-follow checks still
    # reject a linked destination. Relative explicit overrides use this cwd.
    return path.absolute()
