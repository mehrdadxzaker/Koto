# Native patch recovery for the local Qwen harness

`qwen_code_v3` explicitly selects `qwen-code.v3`. It retains the [v2 verification
protocol](LOCAL_QWEN_HARNESS_V2.md) and adds advice only after a correlated native
`apply_patch` failure. All harnesses remain default off; select exactly one.

The [v2 comparison](local-harness/v2-comparison-20261020.md) tied v1 at 5/6.
V2 repaired stock rollback, but its list-key episode repeated the same malformed
patch seven times and expired without saving an edit. The actual native feedback
reached the translated model input unchanged. A deterministic stock-Codex replay
rejected `@@ -1,2 +1,2 @@` and accepted the same patch with plain `@@`.

V3 correlates the declared custom `apply_patch` call, its call ID, its original
range-header argument and the specific host context-error result. It adds a
static native-format example to the existing subordinate developer checkpoint.
After the identical malformed body fails twice, it advises another declared host
editing tool if the host instructions allow one, followed by executable checks.
A later successful patch clears the recovery advice. Unrelated tools, unlinked
results and successful edits do not trigger it. Diagnostic output is never
interpolated into the reminder.

This does not fix or execute a patch, substitute an argument, invent a tool result,
force a tool choice or add an agent loop. Native history, argument values, tools,
approvals and execution stay owned by Codex. V1 and v2 request transforms remain
byte-identical across all 12 captured requests from the v2 study (24 transforms).
The new capability keeps prior harness receipts from authorizing v3. Existing
setup/probe/evidence envelopes and ordinary coding qualification limits remain
unchanged; no automatic coding permission is granted.

Use the [existing setup and disconnect workflow](LOCAL_QWEN_HARNESS.md), selecting
`qwen_code_v3` alongside `codex_llama_v1` in the reviewed setup-v5 declaration.
Disconnect before changing a declaration. Do not migrate an in-flight conversation
or reuse evidence from a different harness version.

The unchanged six tasks can be compared through the same stock Codex runner:

```sh
python tools/compare_local_harness.py --harness v3 --baseline-harness v1 \
  --episode-seconds 180 --output /absolute/path/to/new-comparison \
  --profile /absolute/path/to/existing-setup-v5.json \
  --client /absolute/path/to/codex \
  --runtime-archive /absolute/path/to/existing-llama-archive \
  --llama /absolute/path/to/existing-llama-server \
  --model-file /absolute/path/to/existing-qwen3-14b.gguf
```

Both arms receive the same 180-second development ceiling, 16-request limit and
2,048 output tokens per request. The external checks stay outside the model
workspace. The tasks were already observed during development; successful edits
do not prove general quality or compliance with the requested self-verification
protocol. Actual model-authored checks and native completion must be reported
separately. These results cannot satisfy existing 90-second coding qualification.
