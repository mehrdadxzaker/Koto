# Native personal acceptance — 2026-10-20

The real acceptance journey remains **failed**. The existing native ChatGPT
subscription completed one independently checked read-only text task with the
candidate null-exclusion fix. History-based automatic local selection was not
validated or activated.

## Native compatibility defect

Against main `8d940cb038a8c307230d2e131247b4367538a02f`, both baseline and explicit
local `chat route` commands stopped before `thread/start` with
`native_selection_invalid`. A bounded metadata-only probe of Codex CLI 0.160.0
confirmed that `config/read` includes
`"shell_environment_policy": {"exclude": null}` for the default exclusion list.
The external test fixture had omitted this field.

Normalize only this null default to an empty list, then retain strict
`list[str]` validation and append the gateway environment variable name. The
public CLI regression failed for both destinations before the fix and passed
afterward. Additional native-session coverage preserves existing exclusion
names, rejects malformed scalar/mixed-list values before thread creation, and
checks credential isolation, settings preservation and owned process cleanup.
No configuration migration or persistent preference edit is required.

## Real acceptance result

The candidate wheel changes only `hormuz/codex_native_session.py` from the main
wheel's runtime payload. Its SHA-256 is
`02e826267eb0a6de18a203a1e403103a254457fd16c778588343712d24c06998`.

The run used the existing ChatGPT account and existing pinned llama.cpp b11617 /
Qwen3-4B Q4_K_M assets. A new private configuration, history profile and engine
owner isolated the experiment from ordinary settings. All tasks were read-only,
serial and bounded to 90 seconds; no quality retries, model downloads, API-paid
fallback or synthetic timing advantage were used.

- The ordinary native subscription turn completed with verified provider/model
  binding and the independently expected answer `7`; observed latency was
  4,479 ms. This confirms the observation-mode commercial path, not fallback
  after a successful automatic local choice.
- Four submitted explicit-local diagnostic turns failed. The owned router
  returned HTTP 503 with `hormuz_route_local_route_unavailable`.
- Content-free request instrumentation showed the actual native request included
  `function`, `namespace` and hosted `web_search` tools. Its text envelope was
  inadmissible; hosted web search is outside the pinned local transport profile.
  Other incompatibilities may remain. The operator's interactive declaration
  does not establish that this native request is qualified.
- The local declaration permits explicit `interactive` work and grants no
  automatic task types. It was preserved rather than promoted by a completed
  native handshake or by the successful commercial answer.
- History retained eight records: four failed local turns, three pre-thread
  unknown observations and one successful commercial turn. Public validation
  returned `passed: false`, one development case, zero held-out cases and zero
  local selections. Learning remained in observation mode.

No full paired training cohort was collected after the local preflight failed.
There is no claim of automatic local selection, local latency benefit,
unfamiliar-task fallback, unavailable-engine fallback or automatic coding
readiness from this episode. A separately reviewed compatible noncoding native
request profile is needed before attempting that cohort.

## Preservation and evidence

The initial preservation manifest indexes 3,234 existing evidence files. A
supplement covers the discovered bridge configuration and ownership records;
all documented global history roots were absent. The post-run verifier reported
no drift in those files, the original Codex settings or the original Koto
configuration. Each owned engine/router lifetime disconnected, and each native
receipt reported successful owned-process cleanup.

Raw receipts, encrypted isolated history and its key, frozen inputs, failed
attempts, bounded diagnostic probes, build binding, red/green logs and the
preservation manifests remain in a private local evidence archive. Native
account credentials, raw RPC transcripts and raw native request content were
not copied into that archive. Failed results are retained; qualifications and
normal settings remain unchanged. Automatic local coding remains disabled.
