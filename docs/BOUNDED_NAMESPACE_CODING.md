# Bounded native function namespaces

Codex 0.160 groups local MCP functions into `namespace` tools. The legacy coding
profile accepts only top-level function declarations, so a native file-editing
MCP is rejected before a qualification probe can run. Using shell commands in its
place also introduces an unnecessary layer of quoting for Python source.

This optional compatibility profile lets the existing reversible
`codex_llama_v1` adapter flatten those declarations and restore native namespace
identity on tool calls. The host coding client still executes tools. Koto adds
neither a coding UI nor another agent loop.

## Contracts and acceptance

- Setup profile **version 4** adds the adapter capability to version 2's bounded
  setup envelope. It retains the 65,536-byte request, 512-token output,
  90-second upstream and 60-second startup maxima. It uses managed runtime
  schema 1, with its unchanged non-thinking inference flags. Version 3 retains
  its separate app-sized, thinking-enabled runtime behavior.
- Coding evidence and probe plan **version 3** accept the adapter capability.
  Their fields, `local-repair.v1` acceptance criteria, finite probe budgets and
  version-2 native message-ID normalization are unchanged. A raw namespace,
  child schema, instruction or generation-control change changes the profile
  digest. Translation does not substitute a digest of flattened tools.
- A `managed-llama.v1` subject requires managed runtime schema 1. A configuration
  using different inference flags reports `subject_mismatch`; it cannot inherit
  an earlier record merely because its model and archive hashes match.
- The managed schema-1 catalog keeps no-reasoning defaults, search discovery
  disabled and the legacy patch-tool setting. Selecting the adapter for a
  bounded namespace does not switch to the app catalog. Existing managed
  schema-2 and unmanaged adapter catalogs retain their behavior.
- No profile, model declaration or successful transport probe enables automatic
  coding. A separately frozen, reviewed campaign still needs all four
  development and twelve distinct held-out cases to pass: failing baseline,
  actual saved edit, unchanged independent checks, passing post-checks and
  normal client completion within budget. Review remains unsupported.

The compatibility fixtures are synthetic and identify no qualified model:
[setup v4](../tests/fixtures/local-setup-profile-v4.json),
[probe v3](../tests/fixtures/coding-probe-plan-v3.json) and
[evidence v3](../tests/fixtures/local-coding-evidence-v3.json).

## Selection, migration and rollback

Default setup selection is unchanged. Select a reviewed version-4 profile
explicitly with `client setup codex --qualification FILE`. A nullable
`coding_evidence` still reports unknown readiness with no automatic coding.
For native MCP tools, retain the client/model/runtime pins, private client home,
tool-server implementation and request profile in the operator's frozen
campaign. Capture actual native requests before inference and freeze new
version-3 probe plans. Keep history consent separate.

Existing version-1 and version-2 evidence and plans retain their original
capability limits. Existing setup versions retain their behavior. Do not edit an
old failed treatment into a new receipt or reuse held-out outcomes after changing
tools. No connection journal or storage migration is needed.

Older binaries reject the new versions. Revoke any probe and disconnect before
downgrading. Remove the new evidence from a separately staged configuration or
return to the retained earlier configuration and profile; keep automatic coding
disabled unless that exact older profile has its own valid evidence. Preserve
local-only policy, credentials and all failed campaign records. Generated
configurations and the user's native client settings are never silently migrated.

See [coding qualification](LOCAL_CODING_QUALIFICATION.md) and
[bounded probes](BOUNDED_CODING_PROBES.md) for the evidence and consent workflow.
