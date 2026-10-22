# Qwen Coder integer type verification

`qwen_code_v15` selects default-off, unqualified `qwen-code.v15` only for the
existing Qwen3-Coder-30B-A3B-Instruct-Q4_K_M through `codex_llama_v1`.
Earlier profiles, bytes, model bindings and failed outcomes remain intact.

The October 22 v14 episode completed native editing in 64,402 ms but failed its
unchanged independent checker. The task and exact-type guidance survived all
five request translations. The saved implementation and native snapshot match.
Its boolean-only rejection admits other int subclasses; the model's own checks
omit subclass rejection. Offline replay reproduces that precise failure.

V15 adds the bounded `koto_integer_checks` compiler when an original identified
native command and automatic tool choice are present. The caller supplies a
saved module callable, valid named integer arguments, and each argument's
original subclass and boolean policy. The driver checks the normal sample,
a same-value int subclass, and True/False only when their rejection is declared.
It verifies both allowed and forbidden subclasses instead of assuming every
integer parameter requires an exact built-in type. Unchecked booleans stay
unchecked; their permitted behavior still needs the caller's own assertions.

At most eight policies produce at most 32 calls, using fresh copies of supplied
JSON arguments. Relative module paths, callable/parameter names, JSON depth,
bytes and policies are validated without importing or executing target code.
Only the native host executes the compiled command under its existing tools,
permissions and working directory. Nested values and instance methods require
ordinary Python checks; type checks alone establish no functional correctness.
No implementation or requirement is silently rewritten and no oracle supplied.

V15 gives concise operational type-check guidance before the existing v8 generic
protocol. It retains v14's edit/script compilers, progress, compute and latest
correlated patch recovery. Native transcript, tool identities and agent loop
remain host-owned. Self-check output cannot substitute for independent evidence.

The separately authorized single fresh batch retains four development and twelve
fresh held-out cases, fixed order, 90 seconds/eight serial submissions per case,
2,048 output tokens per generation, zero quality retries and stopping on any
failure with all unrun cases retained. Safe saved edits, unchanged independent
checks and normal native completion are all required. Separate denial and
cancellation controls are not quality successes. Freeze the exact source,
package, complete plan, artifacts and native no-plugin-discovery envelope and
verify public preregistration before inference. Use existing weights in place,
without model downloads/copies or commercial evaluation. Preserve compact
failed evidence and remove disposable owned execution state afterward.

This source change does not qualify coding, install a receipt or enable automatic
selection. The full checked-history, measured selection-benefit, actual supported
provider/client/plugin/fresh-user and protected release gates remain required.
Rollback removes the new opt-in capability or selects an earlier explicit
profile; disconnect restores only owned settings. A v14 receipt cannot qualify
this distinct v15 request profile.
