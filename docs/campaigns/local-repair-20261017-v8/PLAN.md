# Native tool compatibility campaign v8 (#569)

The next question is whether a function-calling-oriented local model can make
Codex execute tools, edit the requested file and pass an independent checker.
The [diagnostic controls](../../diagnostics/native-tool-compat-20261017/README.md)
show functioning downstream structured-call transport, but do not establish
model quality or uniquely attribute v7's failure to its weights or engine parser.

## Candidate and fixed setup

Choose **Qwen3-Coder-30B-A3B-Instruct Q4_K_M** from the primary quantization
publisher `unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF`, revision
`b17cb02dd882d5b6ab62fc777ad2995f19668350`. The artifact is 18,556,689,568 bytes,
SHA-256 `fadc3e5f8d42bf7e894a785b05082e47daee4df26680389817e2093056f088ad`.
It is an Unsloth quantization of Qwen's model, not an official Qwen GGUF.

The [base model card](https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct)
describes a nonthinking, agent-oriented model with 30.5B total/3.3B active
parameters and a specialized tool format. The
[quantization card](https://huggingface.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF)
identifies its source and Apache-2.0 license. This is a candidate rationale,
not qualification. The host has 32 GiB physical RAM; actual load/startup and
latency still have to pass the frozen limits.

Keep pinned Codex **0.160.0**, llama.cpp **b11617-14310190c**, the
`managed-llama.v1` profile, 32,768 context, one engine slot, four generation/batch
threads, two engine HTTP threads, Jinja and nonthinking template arguments.
Generation remains temperature 0.7, top-p 0.8, top-k 20, min-p 0, presence
penalty 1.5 and at most 512 output tokens. Product source is protected main
`d006beb6a21e527c01692b7591c62aa820fea41f`; this differs from v7's older frozen
source and is not presented as a model-only comparison.

Use a fresh private Codex home, network-disabled command tools, no approvals or
agents, an explicit private permission profile, and only disposable project/temp
write roots. Exact deny rules prevent tools reading the checker directory,
other private temporary generations, this source checkout (including the
held-out inventory), the primary checkout and the live Codex home. The native client uses
its own sandbox once; nested macOS sandboxes are incompatible. User settings
are fingerprinted only, never copied into this home or altered.

## Preregister before inference

`prepare`, `preflight` and `freeze` record the exact client/profile/input hashes,
engine/model pins, installed source, runner/support code and all independent
checker hashes. Preflight captures one native request without forwarding it to
the model. Publish the frozen manifest and immutable commit checkpoint before
arming any case. Existing artifacts cannot be overwritten and stage/case markers
prevent replay. Checkers and reference implementations stay outside the tool
sandbox; no references are supplied to the model.

The acquisition budget is one download, zero retries, 1,800 seconds and 20 GiB,
with exact size/hash verification. The file remains private and separate from
the repository. There is no live client installation or automatic connection.

## Bounded native episodes

1. Run exactly one newly authorized canary, **dev-clamp**. Its broken baseline
   must fail by assertion first. Limits are **8 local model requests, 90 seconds,
   512 output tokens per generation, zero transport/quality retries, one native
   episode at a time**.
2. Success requires observed native command/file tool execution, an actual safe
   `solution.py` edit and patch hash, independent checker exit 0 with unchanged
   checks, and normal native exit 0 within the budget. A successful process exit
   alone never passes. The independent checker must also emit a fresh completion
   receipt after all assertions return; raw checker process status is recorded
   separately and a direct early exit is rejected. This token shares the Python
   interpreter with submitted code and is not an adversarial attestation.
   Mechanical results remain provisional until the independent operator inspects
   the exact implementation, patch, native events and checks for harness/oracle,
   process or receipt interference. An inspection record bound to their hashes
   lives outside tool write roots. Qualification cannot start without that
   canary inspection; final acceptance requires the bound inspection of all 16.
   The recorder preserves public engine/router SSE bodies,
   native events, follow-up inputs and public status; it saves no auth headers.
3. Only if the canary passes, use exactly the same frozen setup for the other
   three development cases and **12 fresh held-out cases**, one attempt each.
   The canary counts once toward the four-development floor. All 16 must pass
   `local-repair.v1`, including the required four held-out families.
4. If the canary fails, stop native quality trials. If a later case fails, retain
   it without tuning or dropping cases. Never reinterpret text as executable
   commands or change a checker after seeing a result.

The prepared corpus was independently validated: all sixteen broken baselines
exit 1 by assertion; all sixteen private reference implementations exit 0 with
completed assertions in a two-second, no-network/no-write checker sandbox.
Both original sensitivity validation and the tightened completion validation
are retained. These are preparation results.

## Admission and preservation

Every real request uses the existing explicit ephemeral qualification probe.
Before and after, ordinary coding readiness stays unknown and automatic task
types stay empty unless complete, independently reviewed setup-bound evidence
later qualifies this exact setup. No cloud fallback or live Codex setting change
is authorized by this experiment. Disconnect restores only the owned private
settings and closes owned listeners/processes. Preserve all original failed
trials. Keep #569 open until the real result and complete qualification are
known; synthetic controls cannot close it.
