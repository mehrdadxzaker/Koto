# Native progress checkpoints for local coding

`qwen_code_v4` explicitly selects `qwen-code.v4` for the installed
Qwen3-14B-Q4_K_M model. Select exactly one harness. The profile remains
experimental, default off, and subject to the existing coding qualification gate.

V4 replaces the static coding reminder with a shorter protocol and observations
of correlated native tool results: accepted or rejected patches, completed
commands after the last native patch, the latest recognized exit status, and
pending command sessions. It recognizes pinned Codex 0.160.0 result envelopes;
program stdout cannot replace the native exit status. An unknown later command
result clears the previous status. Repeated identical successful command text
prompts advice to check untested failure paths; an accepted native patch clears
the counts. Unknown results and session results do not supply a repeat count.
These facts establish neither correctness nor execution of assertions.

The advice calls for executable assertions before and after editing, recurring
values in ordered output, and rollback-state assertions after expected exception
handlers. Atomic updates should be validated against private proposed state
before committing. A correlated nonzero Python `SyntaxError` prompts advice to
put compound statements on their own lines, including `try` after a newline.
It provides a literal-newline, single-quoted `python3 -c` format because
the existing sandbox excludes temporary directories and rejects shell heredocs.
Native patch recovery retains plain `@@` advice and a declared-tool fallback.
Noncoding requests retain their original purpose.

Codex continues to own the conversation, tool definitions, tool choice,
arguments, approvals, sandbox and execution. Koto appends subordinate advice;
it does not execute checks, modify history, repair arguments, inject task answers,
or install qualification evidence. V1–v3 transforms are preserved.

Use the [existing setup and disconnect workflow](LOCAL_QWEN_HARNESS.md), selecting
`qwen_code_v4` alongside `codex_llama_v1` in a reviewed setup-v5 declaration.
Disconnect before changing profiles. Prior harness receipts cannot authorize v4;
do not migrate an in-flight conversation or reuse a different profile's evidence.

The same six tasks and independent checks can compare v3 and v4:

```sh
python tools/compare_local_harness.py --harness v4 --baseline-harness v3 \
  --episode-seconds 180 --output /absolute/path/to/new-comparison \
  --profile /absolute/path/to/existing-setup-v5.json \
  --client /absolute/path/to/codex \
  --runtime-archive /absolute/path/to/existing-llama-archive \
  --llama /absolute/path/to/existing-llama-server \
  --model-file /absolute/path/to/existing-qwen3-14b.gguf
```

Both arms receive 180 seconds, 16 requests and 2,048 output tokens per request,
with serial execution and no quality retries. External checks remain outside
the model workspace. These known development tasks cannot establish general
superiority or satisfy ordinary 90-second coding qualification. Report native
completion, saved-code correctness and model-authored verification separately.

See the [diagnosis](local-harness/v4-development-diagnosis-20261020.md) for the
captured failure mechanisms and controlled transport checks.
