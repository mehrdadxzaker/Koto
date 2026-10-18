# 0031: Client-matched acquisition with retained asset generations

Status: accepted decision, October 17, 2026; implementation handoff remains.

For [the acquisition decision](https://github.com/mehrdadxzaker/hormuz/issues/542),
the owner adopted client-matched reviewed catalogs, explicit private asset
directories and retained generations after disconnect or plugin removal, with
deletion kept as a separate inspected action. Reuse ADR 0026's shared acquisition
and setup owners rather than introducing a remote catalog authority, managed
shared cache or automatic purge. This preserves ownership and rollback while
the first candidate remains experimental and unqualified. The existing 0.147
acquisition catalog must remain reproducible; a matching 0.160 handoff still
needs implementation. Artifact integrity never substitutes for coding outcomes.
The [full acquisition contract](../LOCAL_ASSET_ACQUISITION_CONTRACT.md) records
the consent, resource, recovery, compatibility and release boundaries.
