"""Bounded, content-free observations; qualification remains an exact allowlist."""
from dataclasses import dataclass
import os
import re
import selectors
import shutil
import signal
import subprocess
import time

from .client_versions import SUPPORTED_CODEX_VERSIONS
from .contracts import (CLIENT_CHECK_ACTIONS, CLIENT_CHECK_SCHEMA_ID,
                        CLIENT_CHECK_VERSION_PATTERN, RUNTIME_CHECK_ACTIONS,
                        RUNTIME_CHECK_SCHEMA_ID, contract_envelope)


@dataclass(frozen=True)
class ClientObservation:
    reason: str
    observed_version: str | None = None
    legacy_error: str = 'version_unsupported'

    def receipt(self):
        return contract_envelope(CLIENT_CHECK_SCHEMA_ID, {
            'reason': self.reason, 'action': CLIENT_CHECK_ACTIONS[self.reason],
            'observed_version': self.observed_version})


def runtime_check(reason):
    return contract_envelope(RUNTIME_CHECK_SCHEMA_ID, {
        'reason': reason, 'action': RUNTIME_CHECK_ACTIONS[reason]})


def inspect_client(executable):
    program = shutil.which(executable)
    if program is None:
        reason = ('executable_unlaunchable' if os.path.dirname(executable)
                  and os.path.lexists(executable) else 'executable_missing')
        return ClientObservation(reason, legacy_error='setup_unavailable')
    environment = {key: os.environ[key] for key in
                   ('PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT')
                   if key in os.environ}
    try:
        process = subprocess.Popen([program, '--version'], stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
                                   env=environment, start_new_session=True)
    except OSError:
        return ClientObservation('executable_unlaunchable', legacy_error='setup_unavailable')
    deadline = time.monotonic() + 3
    output = bytearray()
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not selector.select(timeout=remaining):
                    return ClientObservation('version_timeout')
                data = os.read(process.stdout.fileno(), 4097 - len(output))
                if not data:
                    break
                output.extend(data)
                if len(output) > 4096:
                    return ClientObservation('version_output_too_large')
        try:
            code = process.wait(timeout=max(0.01, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            return ClientObservation('version_timeout', legacy_error='setup_unavailable')
        if code:
            return ClientObservation('version_command_failed')
        banner = bytes(output).strip()
        versions = {('codex-cli ' + version).encode('ascii'): version
                    for version in SUPPORTED_CODEX_VERSIONS}
        if banner in versions:
            return ClientObservation('version_supported', versions[banner])
        try:
            text = banner.decode('ascii')
        except UnicodeDecodeError:
            return ClientObservation('version_malformed')
        match = re.fullmatch('codex-cli (' + CLIENT_CHECK_VERSION_PATTERN + ')', text, re.ASCII)
        if match is not None and len(match[1]) <= 128:
            return ClientObservation('version_unqualified', match[1])
        return ClientObservation('version_malformed')
    finally:
        process.stdout.close()
        # Retain the existing bounded cleanup of only this probe's process group.
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            pass
        else:
            time.sleep(1)
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait(timeout=1)
