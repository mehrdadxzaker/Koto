# Native editing and probe-continuation fixes

The initial comparison reported 0/6 repairs in each arm. Diagnosis found two
Koto integration failures that must be separated from model coding ability.

## Editing tool omitted from the non-thinking catalog

Setup v5 selects managed runtime schema 3. The catalog previously enabled native
freeform `apply_patch` only together with schema 2's thinking features, while the
preserved Codex instructions still directed the model to use `apply_patch`.
Captured requests omitted that tool. Five original episodes attempted shell
patches; all failed, including repeated bare `apply_patch` commands returning
usage text and exit code 2.

A deterministic replay used stock Codex 0.160.0, Koto's actual catalog and
Responses translation, and a scripted localhost provider. Against the original
source it loaded the catalog without fallback, ran the observed bare patch,
and left the implementation unchanged. Changing only the catalog's
`apply_patch_tool_type` from null to `freeform` saved the patch and completed the
native turn. The source fix exposes the editing tool for schema 3 independently
of thinking, preserving its default reasoning level of `none`.

The setup-to-public-catalog regression failed before implementation with
`AssertionError: None != 'freeform'` and passed afterward. Scripted native
roundtrips passed with and without optional Qwen guidance. These replays test
the editing contract, not autonomous model quality.

## Native patch history rejected by the probe

With editing exposed, the original signed-ceiling case made a real native edit
and passed all independent checks. Its next model request nevertheless received
HTTP 403 `probe_request_mismatch`, failing the turn after 37.618 seconds.

Replaying the captured native request pair through `CodingProbe.check()` accepted
the first request and rejected the second at the continuation-type whitelist.
The profile digest and work identity were unchanged. That whitelist accepted
`function_call` and `function_call_output` but rejected native
`custom_tool_call` and `custom_tool_call_output` produced by `apply_patch`.

The source fix permits those two history types only for probe schema 3 or later
declaring `codex_llama_v1`. The public router regression reproduced HTTP 403
instead of 200 before implementation, then accepted the same continuation after
the fix. Fast variants retain rejection of legacy or undeclared envelopes,
replays, modified history, new user tasks and unknown item types. Identity,
generation, request profile, exact prefixes, request/deadline budgets and
automatic coding admission remain checked.

After both fixes, the original signed-ceiling model regression saved a repair,
passed independent checks and completed normally in 44.413 seconds using three
model requests, with no failed tools. The model did not run its own test command;
the independent checker ran outside its workspace. All 51 affected regression
tests passed before the full paired rerun.

## Evidence scope

The [full paired rerun](post-fix-results.md) is recorded separately with both fixes in both arms and
the same six cases, installed model, native host, sampling and episode limits.
It preserves the original failed comparison as historical evidence. A saved edit,
passing independent checks and normal native completion are all required for a
successful episode; no passing qualification is installed by the comparison.

The initial deterministic fixture used an env-key provider and fell back to
bundled model metadata. Those fixture attempts were excluded from the causal
result. Using Koto's existing command-auth mechanism loaded the intended catalog
with a synthetic token; no normal Codex discovery settings were changed. Raw
diagnostic artifacts remain in the local `koto-harness-debug-20261019-side`
directory, separate from the frozen paired comparison.
