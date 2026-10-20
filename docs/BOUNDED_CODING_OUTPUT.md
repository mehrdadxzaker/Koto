# Bounded output for native coding tools

Native file-repair tools can require more than 512 output tokens for complete
source and executable tests. A truncated function call is not an edit or a
successful native episode. The original profile keeps its existing limits and
failed campaigns; increasing output requires a separately selected execution
profile and a new frozen campaign.

The optional `local-repair.v2` profile allows at most **2,048 output tokens per
request**. Its quality gate remains four development and twelve distinct held-out
cases, with at least one development and three held-out cases in each of the
four existing families. Every predeclared case must have a failing baseline,
actual saved edit, unchanged independent checks, passing post-checks, and normal
native completion within **90 seconds**. Missing outcomes, timeouts, incomplete
streams, failed checks and unchanged files do not pass. No quality retries,
oracle edits, dropped cases or held-out tuning are permitted.

## Explicit versions

| Contract or execution profile | New behavior |
| --- | --- |
| Setup profile v5 | Explicit opt-in to the bounded non-thinking 2,048-token envelope |
| Managed runtime schema 3 / `managed-llama.v2` | Non-thinking runtime flags with the declared output limit up to 2,048 |
| Coding evidence v4 | `local-repair.v2` outcomes bound to `managed-llama.v2` |
| Coding probe plan v4 | Temporary collection permission for that exact execution subject |
| Route-admission status v4 | Reports v1/v2 criteria; preserves personal-selection metadata when present |

The request ceiling stays 65,536 bytes, the episode/upstream ceiling stays
90 seconds, startup stays at most 60 seconds, and the runtime keeps one local
inference slot, a 32,768-token context and the existing non-thinking sampling
flags. Only the declared output limit changes. Managed schema 2 retains its
separate thinking/app behavior. Managed schemas 1 and 3 keep bounded native
catalog defaults: no reasoning, search discovery or patch-tool expansion.

Evidence and probe versions 1–3 keep the `local-repair.v1` / `managed-llama.v1`
512-token limits. Setup v4 keeps managed schema 1; older setup selections and
defaults are unchanged. A receipt for another runtime profile reports
`subject_mismatch`, even when model/archive hashes match. Route-admission v2/v3
cannot report the new criteria; existing profiles retain their earlier status
versions. Status v4 has optional `personal_selection` with its existing separate
contract; this metadata does not grant coding permission.

The fixtures are explicitly synthetic and identify no qualified real model:
[setup v5](../tests/fixtures/local-setup-profile-v5.json),
[managed schema 3](../tests/fixtures/managed-llama-profile-v3.json),
[evidence v4](../tests/fixtures/local-coding-evidence-v4.json),
[probe v4](../tests/fixtures/coding-probe-plan-v4.json), and
[status v4](../tests/fixtures/route-admission-v4.json).

## Selection, migration and rollback

Select a reviewed v5 declaration explicitly with
`client setup codex --qualification FILE`. A nullable `coding_evidence` still
means unknown coding readiness and no automatic coding. A temporary probe still
has no automatic admission effect. Its existing 1–32 serial submissions and
1–90-second authorization bounds are unchanged.

Freeze the client/runtime/model pins, actual raw native request profile, tool
implementation, full case inventory and independent checks before inference.
Use new held-out tasks for the new profile. Keep original failures and do not
relabel v1 campaigns as v2 evidence. The operator must review actual native
actions, patches and independent outcomes before installing a passing receipt.
Only then may a separately staged configuration and the shared public connection
workflow activate automatic `code_change`. Review remains unsupported. Preserve
local-only policy, credentials and separate history consent; add no second
agent loop or coding UI.

No generated configuration or owned client settings are silently migrated.
Older binaries reject these new versions. Revoke an active probe and disconnect
before downgrading, then restore the retained older configuration/profile.
Automatic coding must remain disabled unless that exact older execution subject
has its own complete passing evidence. There is no work-ledger migration.

See [coding qualification](LOCAL_CODING_QUALIFICATION.md),
[bounded probes](BOUNDED_CODING_PROBES.md), and
[native namespaces](BOUNDED_NAMESPACE_CODING.md).

The opt-in [repair feedback candidate](REPAIR_FEEDBACK.md) adds specification-led
test guidance and finite repeat suppression for a future campaign. It changes no
qualification outcomes, admission settings or historical evidence.
