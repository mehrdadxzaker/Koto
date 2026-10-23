# Offline harness improvement

`koto harness improve` turns explicitly selected, frozen failed traces into a
small, reviewable guidance draft. It uses fixed local recipes for observed
interpreter, shell syntax, repeated command, independent-check and native
completion failures. It drafts separate execution and verification candidates,
then composes their supported guidance. No model or command from a trace runs.

The output is a development hypothesis. Candidate quality remains `unmeasured`,
qualification remains `unqualified`, and `applied` remains `false`. Koto does not
install the draft, add a capability, modify a router or Codex configuration,
update history/scorecards, or change any qualification or admission gate.
The host continues to own tools, approvals, execution and the agent loop.

## Use retained evidence

From a repository checkout, choose a **new** output directory:

```sh
koto harness improve \
  --evidence docs/local-harness/v10-repair-20261021/episode-outcomes.json \
  --evidence docs/local-harness/post-fix/traces/adapted-atomic-stock.json \
  --evidence docs/local-harness/v3-comparison-20261020/runs/adapted-atomic-stock.jsonl \
  --base-profile qwen-code.v10 \
  --output /absolute/path/new-candidate
```

These inputs contain retained failures. Reading them again creates no new model
observations and does not retry the failed episodes. V1 supports `qwen-code.v8`
and `qwen-code.v10` as draft bases; the exact base guidance is hash-bound. Older
traces can suggest a hypothesis for that base, but cannot demonstrate its effect.

The [retained review bundle](local-harness/improvement-from-retained-traces-20261022/EXPERIENCE.md)
was generated from these three files. It preserves 38 archived observations and
records zero new executions; it supplies no measured candidate improvement.

The bundle contains:

| File | Purpose |
| --- | --- |
| `proposal.json` | Versioned source fingerprints, original outcomes, failure references, scoped candidates and composed guidance |
| `base-guidance.txt` | Exact selected base guidance |
| `candidate-guidance.txt` | Proposed guidance appended subordinate to host, repository and user instructions |
| `candidate.patch` | Unified diff between those two local text files |
| `EXPERIENCE.md` | Reusable hypothesis, archived execution comparison and supporting source pointers |

Review the patch and its evidence. The experience file is a local library entry
for human or agent review; it is never automatically loaded into later requests.
No script, plugin, guardrail, tool declaration or routing policy is editable
through this command. Arbitrary transcript text cannot become candidate guidance.

Verify all five files against the same explicit evidence:

```sh
koto harness verify \
  --evidence docs/local-harness/v10-repair-20261021/episode-outcomes.json \
  --evidence docs/local-harness/post-fix/traces/adapted-atomic-stock.json \
  --evidence docs/local-harness/v3-comparison-20261020/runs/adapted-atomic-stock.jsonl \
  --bundle /absolute/path/new-candidate
```

Verification regenerates every byte using the current exact base and recipe.
Edited evidence, stale bases, altered guidance, symlinked bundle files, extra
files and unknown formats fail closed. Exit 0 proves bundle reproducibility;
it does not prove task correctness or measured improvement. Both commands return
the proposal JSON on success; refusals return content-free JSON on stderr and
exit 2. They work without a configuration, running router, credentials or Codex.

## Input and resource boundaries

Supported inputs are the repository's `native_events` trace JSON wrappers,
native event JSONL, the v1 audited 36-episode development export, and comparison
JSON containing `frozen_plan_sha256` and `outcomes` with independent check results.
Other JSON is rejected. Files are explicitly named; the command does not crawl
directories, follow artifact paths embedded in a trace, decompress archives or
read retained history. Final file symlinks and non-regular files are rejected.
References using `/native_events/N` index the normalized native event array;
for JSONL, each nonblank record is one event.

Limits are fixed: eight files, 1 MiB each, 4 MiB total, 128 outcome observations,
4,096 native events per file, 16 retained references per rule, and 4,096 bytes of
added guidance. Excess inputs are refused rather than silently truncated. The
reference list states its full observation count when bounded. Processing is
serial, with zero network requests, workers, retries or background processes.
New bundle directories use mode 0700 and their files use 0600 where supported.
Existing output directories and evidence are never overwritten.

Outputs include task identifiers, hashes and structured observed outcomes, but
exclude raw prompts, reasoning, commands, outputs, saved code and credentials.
Treat the selected inputs and draft as confidential local material when using
private evidence. This command grants no collection, training or upload consent.

## Compatibility and qualification

The durable draft and CLI success contract is `hormuz.harness-improvement` v1,
recipe version 1, registered in `koto contract manifest`. Its strict validator is
available through `hormuz.contracts.validate_contract`; a compatibility fixture is
retained in `tests/fixtures/harness-improvement-v1.json`.

This is additive. No older record is migrated or rewritten. Unknown schema or
recipe versions are refused. Verification requires the original base guidance
hash and exact recipe; keep the producing version to verify an older bundle if
either changes. Rollback simply stops using the command and retains its bundle;
the router never consumes these drafts, so there is no active profile to undo.

Independent checker outcomes and normal native completion remain separate.
Failures and unknowns remain in the report, and repeated tasks do not become
new coverage. A draft, an archived success, a successful process exit or bundle
verification supplies no coding qualification. A later decision to execute or
promote a candidate requires the existing separately authorized bounded probe
and reviewed qualification workflow. This tool itself starts no campaign.

The design borrows scoped proposals, composition and evidence-backed experience
from [Harness²](https://github.com/google-research/harness2). Its offline recipes
are an independent implementation and make no claim to reproduce that paper's
model-backed improvement results.
