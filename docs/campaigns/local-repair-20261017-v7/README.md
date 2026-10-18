# Local repair version 7: Qwen2.5-Coder-7B model treatment

Owner authorization: [Choose the next local coding candidate after the frozen
v6 failure](https://github.com/mehrdadxzaker/hormuz/issues/566), with the explicit
October 17, 2026 instruction to choose, freeze and run one bounded repair while
preserving prior evidence, local-only enforcement and the owner's Codex settings.

**Retained outcome: the one repair failed.** The model returned tool-call-shaped
JSON as text, with no observed tool execution or implementation edit. See the
[outcome](OUTCOME.md), [observation](observation.json) and
[native events](development-native.jsonl). The candidate remains unqualified;
the sections below retain the original preregistration.

## Candidate decision

Select **Qwen2.5-Coder-7B-Instruct Q4_K_M** as an experimental, unqualified
candidate. The first-party [model repository](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/tree/13fb94bfda8c8cf22497dc57b78f391a9acb426a)
publishes code-specialized instruction weights under Apache-2.0. Its upstream
benchmarks are a reason to investigate, not evidence for this native workflow.
The pinned single GGUF is 4,683,073,536 bytes, SHA-256
`509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c`.
It is a conservative resource choice for the observed Apple M5 / 32 GiB host;
this is not a minimum-hardware or performance support claim.

The intentional inference change from v6 is the model: weights, intrinsic chat
template and alias. Reuse the exact Codex 0.160.0 executable, llama.cpp b11617
archive/executable and all 136 frozen router package files from source
`4e63d49389922df4079fe22c49d57f191756b910`. Explicit shell-patch guidance,
development task/checker, tool schemas and generation controls stay fixed.
Native dates, private paths and message IDs necessarily differ and are retained
in the new request profile. One stochastic episode cannot establish causation.

## Frozen budget and public seam

- One development case: `dev-clamp`, one native client episode, at most eight
  model submissions, 90 seconds from explicit probe authorization.
- At most 512 output tokens per generation and 65,536 request bytes, one managed
  local inference slot, zero transport/quality retries, zero held-out episodes.
- Local-only setup with no cloud destination and no answer cache. Ordinary
  unqualified coding must block before the explicit probe. No coding receipt
  is emitted or installed; shadow advice retains no execution authority.
- A separate private Codex home and temporary project; no live client setting
  is written. Retain a content-free fingerprint of the owner's settings and
  compare it after cleanup. Revoke permission, disconnect the owned generation,
  restore private settings, and verify closed owned listeners.

Use the approved connect → native coding request through the actual router →
public result/status inspection → disconnect seam. A zero-inference preflight
captures the actual native request without forwarding it to a model. Freeze
the candidate, full profile, first input, corpus, independent oracle, assets and
runner before the one real episode. The run is consumed even if unsuccessful;
there is no quality retry or treatment edit after inference.

## Independent checks and evidence boundary

The [corpus](corpus.json) preserves the four development cases and preregisters
twelve fresh held-out tasks across the four existing families. Their hashes
are distinct from all earlier campaign tasks. All sixteen broken baselines
fail assertion checks; independently authored private reference implementations
pass all sixteen. References remain outside the model project and are not
included in this publication. This validates checker sensitivity, not a model.

A passing native episode requires a real implementation edit, unchanged
independent checks passing, and normal exit zero inside the budget. Missing,
timed-out, unchanged or unknown outcomes cannot pass. One development pass
would still leave fifteen required observations missing and the candidate
unqualified under [local-repair.v1](../../LOCAL_CODING_QUALIFICATION.md).

The original campaigns, invalid treatments and v5/v6 failures remain unchanged.
No native held-out result is used to choose or tune this model. The model may
write only the project and its private temporary directory. No filesystem read
isolation from the retained records is claimed. Independent checks run under a
separate two-second no-network/no-write sandbox. The retained scripts and paths
describe this observed host, not a portable product evaluation service.

At preparation time the native result is pending. The frozen manifest and
subsequent outcome files record preregistration separately from observation.
