# Qwen verification guidance v2

`qwen_code_v2` selects `qwen-code.v2` for the installed Qwen3-14B-Q4_K_M
transport. It is explicit and default off. Select exactly one Qwen harness
capability; declaring v1 and v2 together is rejected.

V2 targets observed missing verification, partial mutation on failure, and
hashability assumptions. It adds a subordinate verification protocol to the
existing instructions and one developer checkpoint after the native input.
The checkpoint asks the model to execute compact assertions against its saved
edit, including specified failure invariants and supported unhashable values.
It includes a generic expected-exception/state-equality assertion pattern and
reminds the model to follow the declared native patch grammar. It contains no
benchmark function names, independent checker contents or reference solutions.

The model still chooses and executes all work through Codex's existing tools.
The adapter does not run tests, edit files, force tool choices, add assistant turns,
invent tool results, or start another agent loop. The reminder is a model-facing
instruction, not evidence that the model complied. Its actual tool results and
independent outcome checks must establish that separately.

## Native context and identity

The adapter works on a private translated copy. Native messages, tool outputs and
argument values remain intact, followed by one subordinate developer reminder.
String input is losslessly expanded to its equivalent user message. The reminder
does not accumulate in Codex history or change the original request used for
admission, probe input digests and work affinity. Normal Codex settings,
instructions, approvals, tools, workspace and execution remain owned by Codex.

V1's guidance bytes and replay behavior are unchanged. The new capability binds
the v2 request shape into destination and qualification identity, so baseline or
v1 evidence cannot authorize it. Setup v5 and probe/evidence v4 accept v2 only
with the local Qwen3-14B native transport; older envelopes reject it. This adds no
automatic coding permission or history consent.

Select `qwen_code_v2` instead of `qwen_code_v1` in the reviewed setup-v5
declaration, alongside `codex_llama_v1`, and use the existing public
[setup and rollback workflow](LOCAL_QWEN_HARNESS.md). Disconnect before selecting
a different declaration. Do not migrate an in-flight conversation or reuse a
receipt from a different harness version. Treat the published v2 prompt and
checkpoint as a fixed contract; later changes need a new profile and evidence.

## Comparison and diagnosis

The same runner can compare the existing guidance with v2:

```sh
python tools/compare_local_harness.py \
  --harness v2 --baseline-harness v1 --episode-seconds 180 \
  --output /absolute/path/to/new-comparison \
  --profile /absolute/path/to/existing-setup-v5.json \
  --client /absolute/path/to/codex \
  --runtime-archive /absolute/path/to/existing-llama-archive \
  --llama /absolute/path/to/existing-llama-server \
  --model-file /absolute/path/to/existing-qwen3-14b.gguf
```

This labels baseline as `qwen-code.v1` and adapted as `qwen-code.v2` in setup,
probe subjects, the frozen plan and every outcome. The default runner arguments
retain the original unadapted-versus-v1 comparison. `--arm adapted` and repeated
`--case` arguments permit bounded development diagnostics; these freeze all six
cases but explicitly record their selected subset and `study_kind: diagnostic`.
They must not be presented as full comparisons or held-out evaluation.

The six task specifications and independent checks are unchanged. The model
creates its own checks; it never receives the independent checker. The runner
retains executed commands, exit status and bounded output separately from the
independent verdict. Pinned Codex native patch rejections are retained from stderr
because a rejected patch may produce no completed file-change event. Passing a
shell command that merely prints a normal result is not proof of verification.

The default remains 16 requests, 90 seconds and 2,048 tokens per request, with
serial inference. An explicit `--episode-seconds 180` selects development probe
plan v5 and status v2 for the declared native Qwen harness. Both compared arms
receive the same 180-second episode ceiling; each upstream request remains
bounded at 90 seconds. Plans v1–v4 and status v1 retain their 90-second limits.
These longer development probes do not create new qualification evidence or
widen ordinary coding admission. Their outcomes cannot establish the existing
90-second coding qualification criteria.

Each full comparison freezes one episode per case and arm. Development pilots,
prompt changes before the freeze, and all failures must be disclosed separately.
These known development tasks cannot establish general qualification.

The [completed v1/v2 comparison](local-harness/v2-comparison-20261020.md) tied at
5/6: v2 repaired rollback but failed to save the list-key edit after repeated
native patch rejections. The [subsequent v3 study](local-harness/v3-comparison-20261020.md)
also failed to demonstrate a coding benefit. The protocol is advisory; neither
study established reliable model-authored verification.
