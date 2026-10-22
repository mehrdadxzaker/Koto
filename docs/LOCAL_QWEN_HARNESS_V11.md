# Type constraints in local Python repairs

`qwen_code_v11` explicitly selects `qwen-code.v11` for Qwen3-14B-Q4_K_M
through the native `codex_llama_v1` transport. It is default off and unqualified.
The default and v1–v10 profiles retain their existing contracts and evidence.

The October 22 v8 qualification attempt completed its first native repair, but
the unchanged independent checker rejected the saved code: `isinstance(x, int)`
accepted a boolean despite the task's explicit exclusion. The actual model
request contained that requirement. Native completion, successful transport and
the model's incomplete self-check did not establish task correctness. That
campaign stopped with one failed development case and fifteen unrun cases.

V11 retains v8's tools, script compiler, checkpoints and compute allocation. It
adds generic guidance to derive assertions from every stated type and error
constraint. Python's boolean/integer relationship needs explicit treatment only
when required by the task; other permitted types must remain supported. Checks
must distinguish missing values, `None`, `False` and zero where specified, and
run against the saved implementation after its final edit. No task identifiers,
benchmark answers or independent checker contents are inserted into requests.

Codex retains its original instructions, tools, tool choice, permissions,
sandbox, execution, continuations and agent loop. Koto shapes the model request;
it neither repairs target code nor executes model commands. The new capability
requires the exact model and native transport, and cannot be combined with an
older Qwen profile. Native probe continuations retain their prefix, destination,
replay and opaque-state checks. Ordinary unqualified coding remains blocked.

## Qualification and rollback

Transport regressions establish request preservation and admission behavior;
they do not prove a model improvement. A new frozen campaign must use fresh
tasks and independent checks under the complete
[bounded coding contract](BOUNDED_CODING_OUTPUT.md): four development cases,
twelve distinct held-out cases, 90 seconds and eight serial submissions per
episode, at most 2,048 output tokens, zero quality retries. Each case needs an
actual saved edit, unchanged passing independent checks and normal native
completion. A failure or missing outcome does not pass. Preserve the previous
failed campaign and every new failure; do not tune on held-out outcomes.

No passing receipt, automatic coding activation or release qualification is
conferred by selecting this profile. Revoke a probe and disconnect before
changing profiles. Existing configuration is not migrated. Returning to v8
requires its own matching evidence; v11 results cannot qualify an older profile.
