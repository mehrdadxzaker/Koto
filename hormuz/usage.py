from __future__ import annotations

import codecs
import json
from dataclasses import dataclass
from typing import Any

from .finance_attempts import NativeUsageAccumulator, NativeUsageObservation


_OPENAI_TERMINAL_RESPONSE_EVENTS = frozenset({
    "response.completed",
    "response.failed",
    "response.incomplete",
})
MAX_SSE_LINE_BYTES = 1024 * 1024
MAX_SSE_EVENT_BYTES = 1024 * 1024


class ResponseUsageLimitError(ValueError):
    """Provider SSE exceeded the bounded observation envelope."""


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0
    provider_reported_model: str | None = None
    evidence_complete: bool = False


@dataclass(frozen=True)
class ParsedUsage:
    """The unchanged v1 projection and its provider-native finance evidence."""

    usage: Usage
    finance: NativeUsageObservation
    provider_terminal_state: str | None


class ResponseUsageParser:
    """Extracts provider usage metadata without retaining response content."""

    def __init__(self, protocol: str, *, is_event_stream: bool, chat_completions: bool = False):
        self.protocol = protocol
        self.is_event_stream = is_event_stream
        self.chat_completions = chat_completions
        self._chat_usage_valid = False
        self._chat_finished = False
        self.usage = Usage()
        self._decoder = codecs.getincrementaldecoder("utf-8")(errors="strict")
        self._line_buffer = ""
        self._sse_data: list[str] = []
        self._sse_event: str | None = None
        self._sse_event_bytes = 0
        self._sse_invalid = False
        self._json_buffer = bytearray()
        self._input_tokens_observed = False
        self._output_tokens_observed = False
        self._native = NativeUsageAccumulator(protocol)
        self._provider_terminal_state: str | None = None
        self._provider_completed = False
        self._finished: ParsedUsage | None = None

    @property
    def provider_completed(self) -> bool:
        """Whether a successful provider terminal marker was observed."""

        return self._provider_completed and not self._sse_invalid

    def feed(self, data: bytes) -> None:
        if self._finished is not None:
            raise RuntimeError("provider_usage_parser_finished")
        if self.is_event_stream:
            if self._sse_invalid:
                return
            try:
                self._line_buffer += self._decoder.decode(data)
            except UnicodeDecodeError:
                self._decoder.reset()
                self._invalidate_sse()
                return
            while "\n" in self._line_buffer:
                line, self._line_buffer = self._line_buffer.split("\n", 1)
                self._check_sse_line_limit(line)
                self._parse_sse_line(line.rstrip("\r"))
            self._check_sse_line_limit(self._line_buffer)
        elif len(self._json_buffer) < 10 * 1024 * 1024:
            self._json_buffer.extend(data)

    def _check_sse_line_limit(self, line: str) -> None:
        if len(line.encode("utf-8")) > MAX_SSE_LINE_BYTES:
            self._sse_limit_exceeded()

    def _invalidate_sse(self) -> None:
        self._sse_invalid = True
        self._native.note_parse_failure()

    def _sse_limit_exceeded(self) -> None:
        self._line_buffer = ""
        self._sse_data.clear()
        self._sse_event = None
        self._sse_event_bytes = 0
        self._invalidate_sse()
        raise ResponseUsageLimitError("provider_sse_limit")

    def finish(self) -> Usage:
        return self.finish_with_finance().usage

    def finish_with_finance(self) -> ParsedUsage:
        if self._finished is not None:
            return self._finished
        if self.is_event_stream:
            try:
                self._line_buffer += self._decoder.decode(b"", final=True)
            except UnicodeDecodeError:
                self._invalidate_sse()
            # EOF does not dispatch an unfinished SSE frame.
            if self._line_buffer or self._sse_data:
                self._invalidate_sse()
            self._line_buffer = ""
            self._sse_data.clear()
        elif self._json_buffer:
            try:
                self._parse_object(_strict_json_loads(self._json_buffer))
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
                self._native.note_parse_failure()
        self.usage.evidence_complete = (
            self._input_tokens_observed and self._output_tokens_observed
            and not self._sse_invalid
            and (not self.chat_completions or self._chat_usage_valid)
        )
        self._finished = ParsedUsage(
            self.usage,
            self._native.finish(),
            self._provider_terminal_state if not self._sse_invalid else None,
        )
        return self._finished

    def _parse_sse_line(self, line: str) -> None:
        if not line:
            self._dispatch_sse_event()
            self._sse_data.clear()
            self._sse_event = None
            self._sse_event_bytes = 0
            return
        field, _, value = line.partition(":")
        value = value.removeprefix(" ")
        if field == "event":
            self._sse_event = value or None
        elif field == "data":
            self._sse_event_bytes += len(line.encode("utf-8"))
            if self._sse_event_bytes > MAX_SSE_EVENT_BYTES:
                self._sse_limit_exceeded()
            self._sse_data.append(value)

    def _dispatch_sse_event(self) -> None:
        if not self._sse_data:
            return
        payload = "\n".join(self._sse_data).strip()
        if not payload:
            return
        if payload == "[DONE]":
            if (self.protocol == "openai" and self.chat_completions and self._chat_finished
                    and self._sse_event in {None, "message"}):
                self._provider_completed = True
            else:
                self._invalidate_sse()
            return
        try:
            value = _strict_json_loads(payload)
        except (ValueError, RecursionError):
            self._invalidate_sse()
            return
        if self._sse_event not in {None, "message"} and (
                not isinstance(value, dict) or self._sse_event != value.get("type")):
            self._invalidate_sse()
            return
        self._parse_object(value)

    def _parse_object(self, value: Any) -> None:
        if not isinstance(value, dict):
            return
        if self.is_event_stream and (value.get("error") is not None
                or value.get("type") in ("error", "response.error")):
            self._invalidate_sse()
            return
        if self.protocol == "openai":
            if self.chat_completions and self.is_event_stream and value.get("choices"):
                choices = value["choices"]
                self._chat_finished = (
                    value.get("object") == "chat.completion.chunk" and isinstance(choices, list)
                    and len(choices) == 1 and isinstance(choices[0], dict)
                    and type(choices[0].get("index")) is int and choices[0]["index"] == 0
                    and isinstance(choices[0].get("delta"), dict)
                    and choices[0].get("finish_reason") in ("stop", "tool_calls", "function_call")
                )
            event_type = value.get("type")
            if isinstance(event_type, str) and event_type in _OPENAI_TERMINAL_RESPONSE_EVENTS:
                if self.chat_completions:
                    self._invalidate_sse()
                    return
                response = value.get("response")
                if (not isinstance(response, dict) or response.get("status") != event_type.removeprefix("response.")
                        or event_type == "response.completed" and response.get("error") is not None):
                    self._invalidate_sse()
                    return
                self._observe_provider_terminal_state(
                    event_type.removeprefix("response."),
                )
                if event_type == "response.completed":
                    self._provider_completed = True
            elif not self.is_event_stream:
                self._observe_provider_terminal_state(value.get("status"))
            response = (
                value.get("response")
                if isinstance(event_type, str)
                and event_type in _OPENAI_TERMINAL_RESPONSE_EVENTS
                else value
            )
            if isinstance(response, dict):
                self._apply_provider_model(response.get("model"))
                usage = response.get("usage")
                if self.chat_completions and isinstance(usage, dict):
                    # Chat Completions names differ; preserve absent/invalid
                    # fields rather than inventing zero-valued evidence.
                    names = {"prompt_tokens": "input_tokens", "completion_tokens": "output_tokens",
                        "prompt_tokens_details": "input_tokens_details", "completion_tokens_details": "output_tokens_details",
                        "total_tokens": "total_tokens"}
                    usage = {target: usage[source] for source, target in names.items() if source in usage}
                self._apply_openai_usage(usage)
                if self.chat_completions:
                    # Validate canonical numeric semantics without publishing
                    # converted Chat fields as native Responses wire evidence.
                    if "usage" in response and response["usage"] is not None:
                        canonical = NativeUsageAccumulator("openai")
                        canonical.observe_openai_response({"usage": usage})
                        self._chat_usage_valid = canonical.finish().state == "complete"
                else:
                    self._native.observe_openai_response(response)
        elif self.protocol == "anthropic":
            if self.is_event_stream and value.get("type") == "message_stop":
                self._provider_completed = True
            if value.get("type") == "message_start" and isinstance(value.get("message"), dict):
                self._apply_provider_model(value["message"].get("model"))
                self._apply_anthropic_usage(
                    value["message"].get("usage"),
                    observe_output=not self.is_event_stream,
                )
                self._native.observe_anthropic_usage(
                    value["message"].get("usage"),
                    present="usage" in value["message"],
                    observe_input=True,
                    observe_output=not self.is_event_stream,
                )
            elif self.is_event_stream:
                self._apply_provider_model(value.get("model"))
                if value.get("type") == "message_delta":
                    # Anthropic's final cumulative output count is authoritative.
                    # A later malformed delta must not inherit earlier evidence.
                    self.usage.output_tokens = 0
                    self._output_tokens_observed = False
                    self._apply_anthropic_usage(
                        value.get("usage"), observe_input=False,
                    )
                    self._native.observe_anthropic_usage(
                        value.get("usage"),
                        present="usage" in value,
                        observe_input=False,
                        observe_output=True,
                        replace_output=True,
                    )
            else:
                self._apply_provider_model(value.get("model"))
                self._apply_anthropic_usage(value.get("usage"))
                self._native.observe_anthropic_usage(
                    value.get("usage"),
                    present="usage" in value,
                    observe_input=True,
                    observe_output=True,
                )

    def _observe_provider_terminal_state(self, value: Any) -> None:
        if value not in {"completed", "failed", "incomplete"}:
            return
        if self._provider_terminal_state is None:
            self._provider_terminal_state = value
        elif self._provider_terminal_state != value:
            # A provider stream cannot truthfully have two different terminal
            # results. Preserve the conservative non-success classification
            # and mark its native evidence partial rather than trusting either.
            self._provider_terminal_state = "failed"
            self._native.note_parse_failure()

    def _apply_provider_model(self, value: Any) -> None:
        if isinstance(value, str) and value and len(value) <= 256 and all(character not in value for character in "\r\n\x00"):
            self.usage.provider_reported_model = value

    def _apply_openai_usage(self, value: Any) -> None:
        if not isinstance(value, dict):
            return
        input_tokens = _observed_nonnegative_int(value.get("input_tokens"))
        if input_tokens is not None:
            self.usage.input_tokens = input_tokens
            self._input_tokens_observed = True
        output_tokens = _observed_nonnegative_int(value.get("output_tokens"))
        if output_tokens is not None:
            self.usage.output_tokens = output_tokens
            self._output_tokens_observed = True
        input_details = value.get("input_tokens_details")
        if isinstance(input_details, dict):
            self.usage.cache_read_tokens = _nonnegative_int(
                input_details.get("cached_tokens"), self.usage.cache_read_tokens
            )
        output_details = value.get("output_tokens_details")
        if isinstance(output_details, dict):
            self.usage.reasoning_tokens = _nonnegative_int(
                output_details.get("reasoning_tokens"), self.usage.reasoning_tokens
            )

    def _apply_anthropic_usage(
        self,
        value: Any,
        *,
        observe_input: bool = True,
        observe_output: bool = True,
    ) -> None:
        if not isinstance(value, dict):
            return
        if observe_input:
            input_tokens = _observed_nonnegative_int(value.get("input_tokens"))
            if input_tokens is not None:
                self.usage.input_tokens = input_tokens
                self._input_tokens_observed = True
            self.usage.cache_read_tokens = _nonnegative_int(
                value.get("cache_read_input_tokens"), self.usage.cache_read_tokens
            )
            self.usage.cache_write_tokens = _nonnegative_int(
                value.get("cache_creation_input_tokens"), self.usage.cache_write_tokens
            )
        if observe_output:
            output_tokens = _observed_nonnegative_int(value.get("output_tokens"))
            if output_tokens is not None:
                self.usage.output_tokens = output_tokens
                self._output_tokens_observed = True


def _nonnegative_int(value: Any, fallback: int) -> int:
    observed = _observed_nonnegative_int(value)
    return fallback if observed is None else observed


def _observed_nonnegative_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _strict_json_loads(value: bytes | bytearray | str) -> Any:
    def unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, item in pairs:
            if key in result:
                raise ValueError("duplicate JSON member")
            result[key] = item
        return result

    def nonfinite(_value: str) -> None:
        raise ValueError("non-finite JSON value")

    return json.loads(value, object_pairs_hook=unique, parse_constant=nonfinite)
