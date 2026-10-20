# Local Qwen request adapter

Retain stock Codex and its agent loop, tools, instructions, approvals and
workspace. Add an explicit, default-off `qwen_code_v1` local route capability for
the installed Qwen3-14B-Q4_K_M model. Adapt Open Interpreter's pinned Qwen coding
guidance and compact argument replay, without its synthetic conversation,
filesystem discovery, tool execution or replacement system prompt. Never discard
argument fields or repair invalid JSON.

Test boundaries from the request: public Responses adapter, configuration
validation, connect -> request -> status -> disconnect, and paired real Codex
coding episodes with independent checks. Mock providers for regression tests.
Run installed-model inference serially with fixed request/output/time budgets
and owned cleanup. Freeze cases and treatment before inference. Retain failures
and timeouts. Both arms use identical host instructions, tools, sampling and
checks. Comparison does not install qualification or enable automatic coding.

Bind the capability into destination identity and coding evidence. Support
explicit selection in setup v5 and evidence/probe v4; earlier versions reject it.
Document compatibility and rollback. Preserve native desktop settings and history
consent. Deliver implementation, regression tests, reproducible comparison,
observed results and limitations, then commit the work.
