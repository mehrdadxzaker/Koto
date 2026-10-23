# Client and runtime diagnostics

`koto --config CONFIG client diagnose codex --client-home HOME` emits
`hormuz.client-diagnosis` **v2**. It inspects the selected configuration and the
current owned connection. Add `--executable PATH` to check a selected executable;
without it, executable compatibility remains unobserved. Diagnosis sends no
model requests and changes no settings or qualification evidence.

Version 2 retains the v1 connection, compatibility, supported-client version,
configuration binding, routing, override, scope and unobserved model/task fields.
It requires two new metadata-only receipts: `client_check` and `runtime_check`.
The top-level `action` now reflects the observed client failure, so a timeout can
recommend inspecting the client process instead of selecting another version.
The existing priority order is retained: a configuration owned by another
connection takes priority, then an observed client failure, then connection
recovery, configuration drift, runtime status and override advice.
An action is advice; it does not authorize remediation.

## Client observation

`client_check` has exactly `schema_id: "hormuz.client-check"`,
`schema_version: 1`, `reason`, `action` and `observed_version`.

| Reason | Action | Observation |
|---|---|---|
| `not_checked` | `check_selected_executable` | No executable was selected for checking. |
| `executable_missing` | `select_client_executable` | Executable lookup found no runnable target. |
| `executable_unlaunchable` | `inspect_client_executable` | The selected target could not be launched. |
| `version_timeout` | `inspect_client_process` | The bounded version check did not complete. |
| `version_output_too_large` | `inspect_client_version_output` | Standard output exceeded 4,096 bytes. |
| `version_command_failed` | `inspect_client_version_command` | The version command exited unsuccessfully. |
| `version_malformed` | `inspect_client_version_output` | Successful bounded output was not a recognized version banner. |
| `version_unqualified` | `select_supported_client` | The banner contained a syntactically valid version outside the allowlist. |
| `version_supported` | `none` | The exact existing executable-version check passed. |

`observed_version` is a bounded ASCII version string only for
`version_supported` and `version_unqualified`; otherwise it is null. It remains
separate from `supported_client_version`, which retains the supported profile
selected from the checked executable, owned connection or existing default.
Observing an unqualified version does not replace that supported profile or
permit override inspection to claim matching routing.

The exact allowlist remains `0.147.0`, `0.160.0` and
`0.162.0-alpha.17.2`. Acceptance still requires the existing `codex-cli VERSION`
banner after whitespace trimming and a zero exit status. The three-second
version-check deadline, 4,096-byte output limit, restricted child environment
and bounded cleanup of the probe's own process group are unchanged. Cleanup may
extend elapsed command time beyond the version-check deadline. A descendant
retaining standard output cannot make the check wait indefinitely. Neither a
parseable future version nor supported-looking output from a failed command
admits a client. Raw output and launch exception text are omitted.

## Runtime observation and startup failure

`runtime_check` has exactly `schema_id: "hormuz.runtime-check"`,
`schema_version: 1`, `reason` and `action`.

| Reason | Action | Meaning |
|---|---|---|
| `not_observed` | `inspect_owned_runtime` | Available evidence does not establish a more specific observation. |
| `not_configured` | `none` | The selected configuration has no managed runtime. |
| `ready` | `none` | Current managed connection status reports readiness. |
| `stopped` | `preview_connection` | Current owned status reports a stopped runtime. |
| `owner_unavailable` | `inspect_owned_runtime` | Current owned runtime status is unavailable. |
| `process_exited` | `inspect_runtime_executable` | The owned child exited during startup. |
| `listening_marker_missing` | `inspect_runtime_startup` | The expected native listening marker was not observed before the startup deadline. |
| `health_unreachable` | `inspect_runtime_health` | A bounded health connection or read failed. |
| `health_invalid` | `inspect_runtime_health` | The observed health response did not meet the existing readiness contract. |
| `startup_deadline` | `inspect_runtime_startup` | The bounded startup wait expired. |
| `guardian_unavailable` | `inspect_owned_runtime` | The guardian closed without a usable startup response. |
| `guardian_response_invalid` | `inspect_owned_runtime` | The guardian's bounded startup response was invalid. |
| `verification_failed` | `inspect_runtime_files` | Guardian verification failed before startup. |

Startup reports are best-effort observations of the stage that failed. They do
not establish the underlying operating-system, executable or model defect.
The guardian forwards a fixed reason through a bounded, generation-bound,
one-shot startup message. Missing, malformed or mismatched detail remains
`not_observed`; arbitrary exception text and raw engine logs are not forwarded.
This message is not persisted in the journal or qualification history.

A later `client diagnose` reports **current** status. It cannot recover a past
startup cause: a failed start that completed cleanup can appear stopped, or
unobserved before an owned runtime exists. Retain the original command's error
receipt when its startup observation matters. These new reasons cannot explain
an older CI failure that did not retain equivalent evidence.

Runtime verification, configured deadlines, health request counts and timeouts,
listening-marker matching, exact bounded health acceptance, owned-child cleanup
and conditional settings restoration remain unchanged. The runtime must still
be Koto's verified live child, emit its own native marker and return HTTP 200
with at most 4 KiB decoding to exactly `{"status":"ok"}`. A health response
alone does not establish ownership. See the
[managed lifetime contract](MANAGED_LLAMA_LIFETIME.md) for the existing bounds.

## Errors, compatibility and rollback

When a lifecycle failure has a diagnostic receipt,
`hormuz.connected-client-error` **v2** has exactly `schema_id`, `schema_version`,
`error` and `diagnostic`. `diagnostic` is one client-check or runtime-check
receipt; `error` retains its existing `code` and takes the diagnostic's fixed
`action`. Client failures preserve existing codes such as
`connected_client_version_unsupported`; managed startup failures retain
`connected_client_runtime_start_failed`. A generic startup failure may carry
`not_observed`. Success reasons cannot be attached as failure evidence.
Errors without diagnostic detail remain v1. Diagnosis's own configuration or
inspection failure remains a minimal `hormuz.client-diagnosis` v2 error receipt.

Consumers must handle diagnosis v2 and diagnostic lifecycle errors v2 explicitly.
Strict readers continue to accept retained diagnosis/error v1 fixtures; unknown
versions fail closed. New fixtures coexist with the original
`plugin-capabilities-v1.json`; `plugin-capabilities-v2.json` declares current
receipt versions and required nested fields. Status and preview v1/v2 and
private journal v1–v3 are unchanged. There is no journal migration.

Before rolling back the executable, complete normal disconnect and resolve any
retained restoration conflict with the current binary. Transient diagnosis
output requires no stored-data migration; an older reader must reject an
unsupported v2 receipt rather than reinterpret it. Never relabel a saved receipt
or rewrite qualification evidence to satisfy an older reader.

The ownership decisions remain [ADR 0017](decisions/0017-connected-client-lifetime.md)
and [ADR 0020](decisions/0020-managed-llama-lifetime.md). The
[immutable request-profile preservation contract](IMMUTABLE_REQUEST_PROFILES.md)
is unchanged. Disposable executables, runtime fixtures and pure contract tests
verify diagnostics and compatibility. This change starts no model campaign,
grants no new qualification or admission, and publishes no release.
