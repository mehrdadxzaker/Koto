# Exact Python types in local repairs

`qwen_code_v12` explicitly selects `qwen-code.v12` for Qwen3-14B-Q4_K_M
through `codex_llama_v1`. It is default off and unqualified. V12 preserves v11
and v8 transport, tools, script compilation, checkpoints and compute allocation;
it adds only generic guidance distinguishing exact built-in types from type
families. Native Codex continues to own instructions, tools, permissions,
sandbox, execution, continuations and the agent loop.

The retained v11 trial rejected booleans but accepted an integer subclass despite
an explicit exclusion. Its self-check omitted that category. Four successful
transport submissions and normal native completion in 75,724 ms did not override
the unchanged independent checker failure. The campaign stopped at one failed
development case and fifteen unrun cases. Its freeze and outcomes remain intact.

In Python, `isinstance(value, int)` plus a boolean exclusion still accepts other
integer subclasses. V12 explains that an exact-type contract requires
`type(value) is int`, with a corresponding subclass rejection check. A contract
that permits integer subclasses must continue to accept them. This is generic,
requirement-dependent language: no task identifiers, repair algorithm, expected
benchmark values or independent checker source enter the model request.

The new capability requires the exact named model, native transport and one
selected Qwen profile. Older profiles and their failures retain their original
behavior. Pure request/contract tests and public router workflow checks verify
that boundary, including continuation, opaque-state/replay denial and unknown
ordinary coding rejection. They do not establish model quality.

A new frozen campaign with fresh development and held-out tasks is required
under the complete [bounded coding contract](BOUNDED_CODING_OUTPUT.md): 4+12
cases, 90 seconds, eight serial submissions, at most 2,048 output tokens and
zero quality retries. Every case needs a saved edit, unchanged passing independent
checks and normal native completion. Preserve failures and all planned unrun
cases; do not tune on held-out outcomes. Selecting v12 grants no coding receipt
or automatic admission. Revoke and disconnect before changing profiles; no
configuration is silently migrated, and rollback needs matching older evidence.
