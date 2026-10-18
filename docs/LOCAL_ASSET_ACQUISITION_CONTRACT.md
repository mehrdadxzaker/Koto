# First-release local asset acquisition contract

Decision for [Decide verified runtime and model acquisition for the supported
release envelope](https://github.com/mehrdadxzaker/hormuz/issues/542).
Accepted by the owner on October 17, 2026. This decision does not implement an
installer, acquire assets, activate a connection or establish a supported coding
model.

The inspected baseline is protected main
`d006beb6a21e527c01692b7591c62aa820fea41f`. Reuse
[ADR 0026](decisions/0026-verified-local-asset-acquisition.md),
[verified acquisition](LOCAL_ASSET_ACQUISITION.md) and the
[shared setup owner](SHARED_LOCAL_SETUP.md). They already implement much of
this flow; the decisions and remaining work below are narrower than a redesign.

## Decision

Keep one shared acquisition operation for CLI and skills-only plugin callers:

```text
read-only preview of a client-matched reviewed catalog
  -> explicit download consent for its exact sources, bytes and licenses
  -> bounded acquisition, verification and a ready asset receipt
  -> separately authorized setup preview and connection through the existing owner
  -> disconnect with conditional settings restoration; retain assets
```

Keep release catalogs bundled and reviewed, with explicit operator-selected
catalogs as the advanced trust path. Keep user-chosen private asset directories,
separate generations on update, and retention after disconnect or plugin removal.
No remote catalog authority, automatic updates, shared-cache discovery or
automatic deletion is part of this first acquisition contract. Those features
would need their own decision and ownership/recovery rules.

An asset receipt proves verified files, not coding competence. Until a matching
coding receipt exists, readiness stays unknown and ordinary unqualified coding
remains denied. Acquisition, plugin installation and model availability grant no
exception to hard local-only policy, including intercepted helper requests.

## Candidate and catalog alignment

The recorded [first candidate](CANDIDATE_SETUP.md) is Codex terminal CLI
0.160.0 on the observed macOS 26.2 / Darwin arm64 / Apple M5 / 32 GiB host,
with llama.cpp b11617 and the pinned Qwen3-4B Q4_K_M. It is experimental and
unqualified. These are observed candidate facts, not general minimum hardware
requirements or a production support declaration. App-bundled Codex engines,
other clients and other host rows need their own reviewed catalog and evidence.

The only current bundled acquisition catalog instead declares Codex 0.147.0.
Its returned setup arguments explicitly select that profile; shared setup
correctly rejects a different actual executable version. Retain this historical
catalog and its generations unchanged. Do not downgrade the user's Codex or
silently relabel its profile to make the mismatch disappear.

The remaining implementation must select a reviewed catalog matching the actual
target client before download and return setup arguments matching that same
client/profile. Reuse the existing client's version detection and setup
validation rather than adding a competing compatibility decision. Missing or
unsupported rows fail explicitly before transfer. Explicit older catalogs remain
usable with their matching older client, with their original limitations.

A reviewed 0.160 acquisition row may reuse the first candidate's exact existing
artifact pins while retaining unknown coding readiness. The
[v7 Qwen2.5-Coder trial](campaigns/local-repair-20261017-v7/OUTCOME.md) is a
separate, failed, campaign-only candidate. This contract neither replaces the
acquisition default with v7 nor reruns, repairs or promotes either candidate.
Any later model/catalog selection is explicit and separately reviewed, preserves
all earlier failures, and changes the catalog generation when its declaration
changes. A production coding row remains gated on matching outcome evidence.

## Trust, consent and resource bounds

The preview names client/platform/model/profile identity, experimental or
qualified status, exact immutable artifact revisions and URLs, declared byte
sizes and SHA-256 digests, licenses and upstream notice links, remaining transfer
bytes, and required/available storage. It reports hardware evidence honestly:
32 GiB is the observed host; a minimum has not been established. A matching
platform or sufficient disk does not establish RAM suitability or coding quality.

Use first-party release/model sources and retain upstream license notices.
The reviewed catalog is the trust declaration; hashing downloaded bytes does
not independently authenticate an untrusted custom catalog. No account, ambient
credential, proxy authentication or acceptance of a license on the user's behalf
is required. Reject unsupported declarations and unsafe sources before transfer.

Keep the current bounded transport and verifier rather than introducing another
downloader: sequential artifacts and one owned worker/request, declared HTTPS
hosts and at most four redirects, ten-second connect waits and an absolute
per-artifact deadline (default 1,800 seconds, allowed 1–3,600). Keep zero automatic
retries; stop on unavailable sources or HTTP 429 and respect Retry-After before
a later explicit attempt. Cancel and reap only owned workers, close connections,
and retain the ownership lock until the worker has exited.

Keep exact size/digest verification, validated Range resume of owned partials,
and the existing checksum time budget. Reserve remaining download bytes, the
1 GiB extraction bound and 64 MiB margin before transfer. Keep extraction's
256-entry, 1 GiB and 30-second bounds, path/link restrictions and complete runtime
inventory verification. Do not execute downloaded code during acquisition.

## Ownership, recovery, updates and removal

Use the explicitly chosen private, user-owned parent and canonical catalog-digest
generation. Preview remains offline and read-only. A completed offline reuse
reverifies the artifacts and complete runtime inventory. Missing offline files
fail; damaged, unknown, shared or edited state remains intact and blocks reuse.
Partial progress is unverified until full final checks pass. Unknown interrupted
publication fails closed for inspection; do not delete files to guess ownership.

Consent to download covers the displayed catalog generation only. It does not
authorize setup, a client downgrade, startup registration or future model
downloads. Acquisition does not touch live Codex settings. Setup retains its
separate preview/apply boundary, existing private credential owner, create-only
configuration publication and conditional recovery/restoration rules. Pass a
receipt's argument array as data, never as shell code.

An update uses a newly reviewed declaration and separate generation. Preserve the
old generation, configuration, coding evidence and failed-trial records. Disconnect
before switching active assets; rollback explicitly selects the old reviewed
generation and uses the same setup owner. A failed update never overwrites a
working generation or triggers cloud/model fallback.

Disconnect and plugin removal retain assets by default. Initial asset removal
is a separate explicit, inspected action: identify the exact private generation,
disconnect every known user, inspect ownership and contents, and delete only the
reviewed owned targets when inactivity and ownership are established. If either
is uncertain, retain them. No automatic pruning, shared-cache deletion or new
purge command is implied. Automatic connection-process cleanup remains required;
retaining asset files does not authorize leaving workers or listeners running.

## Handoff and acceptance boundaries

Do not close the router epic on this decision. Its
[closure contract](https://github.com/mehrdadxzaker/hormuz/issues/543) must still
require matching model-quality, actual client/plugin/cloud and fresh-user
distribution evidence. This contract does not select a local-only subset of the
approved product scope or authorize paid API fallback.

The owner confirmed this acquisition policy. Record its resolution on the
decision ticket and link it from the map. Carry the concrete version-alignment
gap into the final spec and dependency-ordered implementation work, including:

- Preview a target 0.160 client using a matching reviewed catalog, with literal
  expected metadata, no network and no settings changes; an incompatible or
  missing row must fail before transfer. Retain the old 0.147 compatibility case.
- Use synthetic artifacts through acquire -> setup -> real router request ->
  public result/status -> disconnect. The returned catalog/profile must match
  the actual client; unknown coding must still block ordinary repair and make
  no cloud request. Observe client output and controlled external traffic.
- Reuse existing transport, integrity, interruption, offline and ownership tests.
  Add only missing public-workflow coverage for the new catalog selection and
  update/rollback handoff. Verify old generations and user edits survive.

No new public schema version is declared by this decision. During implementation,
retain strict existing version-1 catalog/receipt/error fixtures and versioned
setup-profile compatibility. If the selected behavior or disclosure cannot fit
those contracts, specify its new version, fixture and downgrade behavior before
changing it. Disconnect through the current owner before a binary downgrade;
preserve incompatible records for inspection rather than rewriting them.
