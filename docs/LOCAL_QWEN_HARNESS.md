# Optional local Qwen request adapter

`qwen_code_v1` is a default-off route capability for
`Qwen3-14B-Q4_K_M`. It adapts requests behind the existing Codex interface. Codex
still supplies the full base instructions, developer/repository instructions,
tools, permissions, execution, workspace and conversation. There is no second
agent loop, replacement client, tool executor, model download or cloud fallback.

The adapter adds subordinate, concise guidance to read before editing, cover all
specified behavior, verify changes and finish after successful checks. It also
replays valid function-call arguments as compact JSON in declared property order,
preserving all fields and decoded values, including unknown fields. Invalid,
duplicate-key or non-object arguments are rejected rather than repaired. Native
namespace/custom-tool identity and streamed results use the existing reversible
Codex transport. Routes without the new capability retain their existing shape.

These techniques are inspired by Open Interpreter's Apache-2.0
[Qwen request builder](https://github.com/openinterpreter/openinterpreter/blob/ac1fcc8fe57aba51fcc3c79afd57a0883237fe87/codex-rs/core/src/harness/qwen_code.rs)
and [coding prompt](https://github.com/openinterpreter/openinterpreter/blob/ac1fcc8fe57aba51fcc3c79afd57a0883237fe87/codex-rs/core/src/harness/qwen_code_prompt.md),
pinned at `ac1fcc8fe57aba51fcc3c79afd57a0883237fe87`. This is an independently
written subset, not that complete harness. It does not import vendor identity,
invent tools, replace host instructions, read a directory, synthesize a user /
assistant exchange, or change sampling/output limits. Chat Completions-specific
message normalization remains the local server's responsibility.

## Selection and evidence

Add `qwen_code_v1` to an explicitly reviewed setup-v5 declaration's `capabilities`
alongside `codex_llama_v1`, keeping the model and verified asset hashes. Select
that declaration with the existing public setup workflow:

```sh
koto --config /absolute/path/to/new-gateway.json client setup codex \
  --client-home /absolute/path/to/disposable-codex-home \
  --executable /absolute/path/to/codex \
  --runtime-archive /absolute/path/to/existing-llama-archive \
  --llama-executable /absolute/path/to/existing-llama-server \
  --model-file /absolute/path/to/existing-qwen3-14b.gguf \
  --qualification /absolute/path/to/reviewed-setup-v5.json
```

Configuration rejects this capability for cloud destinations, other models,
non-OpenAI protocols and routes lacking `codex_llama_v1`. Setup v5 and coding
evidence/probe v4 accept the versioned capability; earlier contract versions
reject it. Evidence keeps the existing `local-repair.v2` / `managed-llama.v2`
criteria and limits. This is an additive capability within those envelopes, not
a widening of coding permission. Older binaries reject these new declarations
in setup/evidence/probes; do not downgrade while such a connection is active.

The capability already participates in immutable destination generations and
the exact coding subject. Baseline coding receipts therefore report
`subject_mismatch` on an adapted route. An experiment uses bounded, ephemeral
qualification probes; it never installs passing evidence. A comparison, even a
successful one, does not satisfy the full coding qualification campaign or make
automatic routing eligible. Local history retains its separate opt-in.

Treat `qwen-code.v1` as a fixed request-shape contract. A change to its guidance
or replay semantics requires a new capability/profile version and fresh outcome
evidence; existing receipts must not silently authorize a different treatment.

Rollback: revoke any active probe, disconnect the owned generation, and select
the retained baseline configuration/declaration through the same public setup
workflow. Remove the capability only on a new disconnected setup. Do not reuse
adapted receipts for baseline execution or migrate an in-flight conversation.

## Paired coding comparison

`tools/compare_local_harness.py` runs stock Codex 0.160.0 with its existing native
tools, including `apply_patch`, against six frozen repairs in `tools/local_harness_cases.json`. Both arms
use the same native instructions, tools, task specifications, checks and sampling.
The only treatment is the route capability. No compact replacement system prompt
or custom coding tools are used. Independent checks live outside the project and
are not supplied to the model. The model writes and runs its own checks.

Run with the installed package on Python's import path:

```sh
python tools/compare_local_harness.py \
  --output /absolute/path/to/new-comparison-directory \
  --profile /absolute/path/to/existing-setup-v5.json \
  --client /absolute/path/to/codex \
  --runtime-archive /absolute/path/to/existing-llama-archive \
  --llama /absolute/path/to/existing-llama-server \
  --model-file /absolute/path/to/existing-qwen3-14b.gguf
```

The runner verifies installed model identity, freezes source/cases/pins before
inference, records each native request profile, and uses the approved connection,
probe, status and disconnect operations. It counterbalances order in three
blocks: baseline first three, adapted all six, baseline last three. Each episode
has at most 16 serial submissions and 90 seconds, with the existing 2,048-token
per-request output cap. Zero-inference captures return a permanent client error
to prevent retries. There are no quality retries or held-out tuning.

Report actual saved edits, unchanged independent checks, native completion,
elapsed episode time, host tool errors and submitted requests separately. A
passing independent check without normal native completion is a failed episode.
Wall-clock episode time includes host work and is not provider-only latency.
The experiment writes its own request/response artifacts to the selected private
directory; it does not enable normal retained local history.

Six tasks with one sample per arm are a small exploratory comparison, not a
general benchmark. Fixed block order, stochastic generation, cache state and
machine pressure limit latency conclusions. It cannot establish Codex desktop
activation or general local-model coding readiness. Recorded results and the
separate standards/spec reviews accompany this change.

The [fresh verification](local-harness/verification-20261020.md) found **4/6
successful repairs for baseline and 5/6 for adapted**. The [first corrected
comparison](local-harness/post-fix-results.md) found 4/6 and 3/6 respectively.
Across both corrected runs each arm completed 8/12 repairs; a consistent quality
advantage has not been established. Every native turn saved an edit and completed
after the [integration fixes](local-harness/integration-fixes.md). The [original
pre-fix study](local-harness/results.md) found 0/6 in both arms. Keep the optional
guidance experimental. The comparison runner uses the native macOS sandbox and
is currently a macOS maintainer tool.

The later [v2 verification protocol](LOCAL_QWEN_HARNESS_V2.md) and
[v3 native patch recovery](LOCAL_QWEN_HARNESS_V3.md) remain separately selected
experiments. With matched 180-second development limits, [v1/v2 tied at 5/6](local-harness/v2-comparison-20261020.md)
and [v1 scored 5/6 versus v3's 4/6](local-harness/v3-comparison-20261020.md).
The requested reliable rollback/list-key improvement was not achieved. These
known-task studies do not establish a benefit or grant automatic coding, and
their results must not be pooled with the earlier 90-second comparisons.
