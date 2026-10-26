"""One bounded owned router process for an explicitly launched native task."""
from contextlib import contextmanager
from dataclasses import replace
import json
import logging
import multiprocessing
import os
from pathlib import Path
import pickle
import select
import signal
import sqlite3
import struct
import threading
import time

from .codex_native_session import NativeSessionError
from .config import AIWorkConfig
from .execution_destination import route_fingerprint
from .server import GatewayServer

MAX_MESSAGE = 1024 * 1024


class _SessionGateway(GatewayServer):
    def __init__(self, config, deadline, coding):
        self.handlers = threading.Condition()
        self.active_handlers = 0
        self.native_coding = coding
        super().__init__(config, request_deadline=deadline, capture_history=False)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(max(.05, min(3, self.request_deadline - time.monotonic())))
        return connection, address

    def process_request(self, request, address):
        with self.handlers:
            self.active_handlers += 1
        try:
            super().process_request(request, address)
        except BaseException:
            self._finished_handler()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self._finished_handler()

    def _finished_handler(self):
        with self.handlers:
            self.active_handlers -= 1
            self.handlers.notify_all()

    def handle_error(self, request, address):
        # The private IPC and attempt evidence carry fixed errors, never stderr tracebacks.
        logging.getLogger(__name__).error("native_router_handler_failed")

    def settle(self):
        self.begin_drain()
        self.shutdown()
        with self.handlers:
            self.handlers.wait_for(lambda: self.active_handlers == 0,
                timeout=max(0, self.request_deadline + 2 - time.monotonic()))
            if self.active_handlers:
                raise NativeSessionError("native_router_cleanup_incomplete")


def _send(connection, value):
    raw = json.dumps(value, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(raw) > MAX_MESSAGE:
        raw = b'{"ok":false,"error":"native_router_response_limit"}'
    connection.send_bytes(raw)


def _serve(connection, config, workspace, deadline, coding):
    logging.disable(logging.CRITICAL)
    server = thread = None
    try:
        output_cap = min(item.max_output_tokens for _, item in config.route_admission.local_routes)
        scoped = replace(config, listen=replace(config.listen, host="127.0.0.1", port=0),
            database_path=Path(workspace) / "usage.sqlite3",
            organization_policy=replace(config.organization_policy, max_output_tokens=output_cap),
            ai_work=AIWorkConfig(enabled=True, database_path=Path(workspace) / "work.sqlite3"))
        server = _SessionGateway(scoped, deadline, coding)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .05}, daemon=False)
        thread.start()
        _send(connection, {"ok": True, "value": {"server_port": server.server_port}})
        while connection.poll(max(0, deadline + 3 - time.monotonic())):
            request = json.loads(connection.recv_bytes(4096))
            if request.get("command") == "close":
                break
            try:
                identity = config.identities_by_actor[request["actor_id"]]
                if request["command"] == "routes":
                    value = server.route_admission.status(identity, server.policy_engine, check_readiness=True)["routes"]
                elif request["command"] == "create_work":
                    value = server.work_runtime.create_work(identity, "koto-native-session", task_type=request["task"])
                elif request["command"] == "observe":
                    server.settle()
                    observed = server.work_runtime.attempt_history(identity, request["work_id"])
                    value = {"attempts": observed["attempts"], "next_before": observed["next_before"],
                             "expected_fingerprint": route_fingerprint(config.model_routes[request["alias"]],
                                 upstreams=config.upstreams, destinations=server.destinations)}
                else:
                    raise NativeSessionError("native_router_command_invalid")
                _send(connection, {"ok": True, "value": value})
            except (OSError, ValueError, TypeError, KeyError, RuntimeError, sqlite3.Error) as error:
                code = str(error) if isinstance(error, NativeSessionError) else "native_router_unavailable"
                _send(connection, {"ok": False, "error": code})
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, EOFError):
        try:
            _send(connection, {"ok": False, "error": "native_router_unavailable"})
        except OSError:
            pass
    except sqlite3.Error:
        try:
            _send(connection, {"ok": False, "error": "native_router_storage_unavailable"})
        except OSError:
            pass
    finally:
        connection.close()
        if server is not None:
            try:
                server.shutdown()
            finally:
                server.server_close()
                if thread is not None:
                    thread.join(timeout=1)


class _Router:
    def __init__(self, process, connection, deadline):
        self.process, self.connection, self.deadline = process, connection, deadline
        self.pid = process.pid
        self.broken = False
        self.lock = threading.Lock()
        os.set_blocking(connection.fileno(), False)
        ready = self._receive()
        self.server_port = ready["server_port"]

    def _wait(self, *, read, deadline):
        descriptor = self.connection.fileno()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise NativeSessionError("native_router_deadline")
        ready = select.select([descriptor] if read else [], [] if read else [descriptor], [], remaining)
        if not (ready[0] or ready[1]):
            raise NativeSessionError("native_router_deadline")
        return descriptor

    def _read(self, count):
        result = bytearray()
        while len(result) < count:
            descriptor = self._wait(read=True, deadline=self.deadline + 3)
            try:
                block = os.read(descriptor, min(65536, count - len(result)))
            except (BlockingIOError, InterruptedError):
                continue
            if not block:
                raise NativeSessionError("native_router_unavailable")
            result.extend(block)
        return bytes(result)

    def _send(self, raw, *, deadline=None):
        pending = memoryview(struct.pack("!i", len(raw)) + raw)
        while pending:
            descriptor = self._wait(read=False, deadline=self.deadline + 3 if deadline is None else deadline)
            try:
                written = os.write(descriptor, pending[:65536])
            except (BlockingIOError, InterruptedError):
                continue
            if written == 0:
                raise NativeSessionError("native_router_unavailable")
            pending = pending[written:]

    def _receive(self):
        try:
            length = struct.unpack("!i", self._read(4))[0]
            if not 0 <= length <= MAX_MESSAGE:
                raise NativeSessionError("native_router_response_limit")
            result = json.loads(self._read(length))
            if type(result) is not dict or type(result.get("ok")) is not bool:
                raise NativeSessionError("native_router_response_invalid")
            if not result["ok"]:
                raise NativeSessionError(result.get("error", "native_router_unavailable"))
            return result["value"]
        except (OSError, ValueError, EOFError, KeyError) as error:
            self.broken = True
            if isinstance(error, NativeSessionError):
                raise
            raise NativeSessionError("native_router_unavailable") from None

    def _request(self, command, **fields):
        if self.broken:
            raise NativeSessionError("native_router_unavailable")
        raw = json.dumps({"command": command, **fields}, allow_nan=False, separators=(",", ":")).encode("utf-8")
        if len(raw) > 4096 or not self.lock.acquire(timeout=max(0, self.deadline + 3 - time.monotonic())):
            raise NativeSessionError("native_router_request_invalid")
        try:
            self._send(raw)
            return self._receive()
        except (OSError, NativeSessionError) as error:
            self.broken = True
            if isinstance(error, NativeSessionError):
                raise
            raise NativeSessionError("native_router_unavailable") from None
        finally:
            self.lock.release()

    def routes(self, actor_id):
        return self._request("routes", actor_id=actor_id)

    def create_work(self, actor_id, task):
        return self._request("create_work", actor_id=actor_id, task=task)

    def observe(self, actor_id, work_id, alias):
        return self._request("observe", actor_id=actor_id, work_id=work_id, alias=alias)


@contextmanager
def owned_router(config, workspace, deadline, *, coding=False):
    try:
        if len(pickle.dumps(config)) > MAX_MESSAGE:
            raise ValueError()
    except (TypeError, ValueError, AttributeError, pickle.PickleError):
        raise NativeSessionError("native_router_configuration_invalid") from None
    context = multiprocessing.get_context("spawn")
    parent, child = context.Pipe(duplex=True)
    process = context.Process(target=_serve, args=(child, config, str(workspace), deadline, coding), name="koto-native-router")
    router = None
    started = False
    try:
        process.start()
        started = True
        child.close()
        router = _Router(process, parent, deadline)
        yield router
    finally:
        interrupted = False

        def defer_interrupt(_signum, _frame):
            nonlocal interrupted
            interrupted = True

        main_thread = threading.current_thread() is threading.main_thread()
        previous_handler = signal.getsignal(signal.SIGINT) if main_thread else None
        defer_signal = main_thread and previous_handler != signal.SIG_IGN
        if defer_signal:
            signal.signal(signal.SIGINT, defer_interrupt)
        try:
            child.close()
            try:
                if router is not None and not router.broken:
                    router._send(b'{"command":"close"}', deadline=min(deadline + 3, time.monotonic() + .05))
            except (OSError, NativeSessionError):
                pass
            parent.close()
            if started:
                process.join(.2)
                if process.is_alive():
                    process.terminate()
                    process.join(1)
                if process.is_alive():
                    process.kill()
                    process.join(1)
                if process.is_alive():
                    raise NativeSessionError("native_router_cleanup_incomplete")
            process.close()
        finally:
            if defer_signal:
                signal.signal(signal.SIGINT, previous_handler)
        if interrupted:
            signal.raise_signal(signal.SIGINT)
