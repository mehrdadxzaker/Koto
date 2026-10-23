# Native personal sessions

Native personal sessions connect an explicitly launched Codex app-server to
Koto's consented local history. Codex keeps its existing ChatGPT authentication,
model execution, tools, permissions and agent loop. Koto does not read or copy
the native account credential into a router credential or an API configuration.

The `chat route` surface is limited to fresh, read-only text work. For an
explicitly chosen writable repository, see the experimental
[native coding sessions](NATIVE_CODING_SESSIONS.md) command. This text surface preserves the
normal client settings and startup path; it does not activate the retired
[desktop startup bridge](CODEX_APP_BRIDGE.md). Continuing a conversation does
not authorize moving its provider state to another model or account.

## Use the selected subscription model and qualified locals

Prepare a reviewed Koto configuration with one permitted native commercial
alias matching the effective model in the selected Codex home. Its upstream
uses `authentication: codex_chatgpt` and the fixed
`https://chatgpt.com/backend-api/codex` backend, without an API-key field. The
alias's `upstream_model` must match the native model exactly. An absent native
model requires one unambiguous default in the native model catalog; missing,
ambiguous or paginated defaults stop before the task is submitted. API-key
authentication does not substitute for the native ChatGPT account.

Launch one fresh text task using the existing native executable and account:

```sh
koto --config /absolute/path/koto.json chat route \
  --executable /absolute/path/codex \
  --client-home /absolute/path/native-codex-home \
  --prompt-file /absolute/path/prompt.txt
```

The executable defaults to `codex`. The native home defaults to `CODEX_HOME`,
then `~/.codex`; an explicit `--client-home` selects that session's existing
account without changing the default home. Use `--actor ACTOR_ID` when the
Koto configuration has multiple actors. A prompt file of `-` reads standard
input. The command verifies the supported native executable before dispatch;
it does not sign in, acquire a model or change the normal selected model.
Codex retains its ordinary account refresh and cache lifecycle.

With separate history and learning consent, observation mode executes the
commercial baseline and records the classifier's advice. Automatic selection
requires current checked validation for the native host context and an eligible
qualified local route. Insufficient evidence uses the permitted baseline;
hard local-only mode blocks when it cannot select a qualified local. The native
thread is bound once, before its first turn.

Before selecting a local, the session checks its engine with the router's bounded,
prompt-free health probe. An unavailable local is excluded before the native task
starts, allowing automatic mode to use the permitted commercial baseline.
Explicit local requests and hard local-only mode fail closed. A local failure
after the turn starts never triggers a commercial retry.

To explicitly request an existing qualified local alternative, add
`--model LOCAL_ALIAS` to the same command. The route must be admitted in `auto`
or `local_only` mode, permitted for the task and compatible with the native
transport. The command starts one owned loopback router for that session,
passes only its Koto gateway credential to the local provider, verifies actual
router attempts and closes owned resources on exit. Commercial authentication
stays in Codex. A native completion without matching local router evidence
remains unknown.

The owned router uses private temporary usage and work ledgers, with the
smallest configured local qualification output limit applied as its session
cap. It preserves the original configuration and existing ledgers. Its process
is stopped before temporary files are removed; a stuck handler cannot retain
the caller indefinitely. Router settlement precedes execution verification.

Collection and assessment use the existing history commands:

```sh
koto --config /absolute/path/koto.json history enable
koto --config /absolute/path/koto.json history learning enable
koto --config /absolute/path/koto.json history show ENTRY_ID
koto --config /absolute/path/koto.json history feedback ENTRY_ID --checks /absolute/path/checks.json
koto --config /absolute/path/koto.json history learning scorecard
```

Use the returned `history_entry` when present. While learning is in observation
mode, the ordinary command supplies the baseline observation; a separate
explicit local run can supply another checked observation for the same prompt.
Assess each outcome with independent checks or explicit user feedback. Native
history is not submitted to an additional cloud or local model automatically.
The [personal-selection validation gate](PERSONAL_MODEL_SELECTION.md#learn-validate-and-select)
remains required before automatic local selection.

## Session limits

`chat route` runs one ephemeral, fresh text turn in a temporary workspace, with
read-only sandboxing and approval policy `never`. It is not a coding UI or a
repository repair workflow. Codex owns its tools; a tool action requiring an
unimplemented client callback stops with an explicit unknown result rather than
being executed by Koto. There is no continuation or resume option.

The prompt must be nonempty UTF-8 text of at most 64 KiB. The default absolute
native deadline is 90 seconds; `--timeout-seconds` accepts 1–360 seconds, with
bounded cleanup grace afterward. Protocol frames are limited to 1 MiB and each
native stdout/stderr stream to 2 MiB. Malformed, truncated or over-limit output
cannot certify completion. Koto does not retry an ambiguous submitted turn or
switch its destination; native provider behavior remains Codex-owned.
The native cleanup receipt covers the original owned process group. Codex
retains ownership of its tool lifecycle and any helpers outside that group.

The current native command rejects configured output-token caps and monthly
token or money limits that it cannot safely enforce for the subscription path.
It also requires a permitted Codex actor and one unambiguous native baseline.
It does not offer an API-paid fallback. Local-only failures do not run the
commercial model.

Local selection currently requires the Responses/text/streaming/tool transport
capabilities for the supported terminal-native profile. Local session overrides
use a scoped catalog and disable reasoning, subagents, hosted web search and the
app catalog before Codex builds the local request. Native function tools remain
available. These overrides apply only to the local thread; the commercial
thread receives no search or app override, and saved Codex settings remain
unchanged. The local controls are bound into history validation, so a profile
change requires fresh checked validation. Actual downstream requests remain subject to the router's
qualified envelope; a task label or a host-context hash cannot preapprove that
wire request. Code-change and code-review tasks are excluded from local
selection on this read-only surface. An explicit `interactive` qualification
does not become an automatic task qualification.

## Completion and task quality

A native host observation records the selected model alias, configured upstream
model and destination, locality, observed completion or failure, retained text
and latency. A failed or interrupted turn can retain useful partial text. An
incomplete observation cannot become successful merely because a subprocess
exited or a success-shaped event appeared.

The caller must explicitly verify the effective native provider and model, or
the owned router's actual execution receipt for a local model. Verification
defaults to false. A verified response additionally requires successful host
completion and captured response text. None of these facts establishes task
quality. Independent text/JSON checks or explicit user feedback remain separate;
a matching text check cannot turn an incomplete or unverified response into a
passing example.

HTTP status and estimated monetary cost are null for native observations.
Token counts remain null unless the host actually reports nonnegative integer
counts. Subscription plan cost and local compute cost are unknown, rather than
zero or a configured API-price estimate.

`koto.native-task` v1 separates the exact answer from routing and observation
metadata. Its `execution` object contains `verified`, `source` and
`local_attempts`: native subscription results use `native_provider_binding`;
locals require `owned_router_receipts` and at least one observed attempt before
verification. Native usage is null when unavailable, or contains the observed
`last`/`total` counts. No HTTP status or configured-price estimate is fabricated
for the receipt.

Exit status zero requires verified completion and successful owned cleanup.
Blocked, failed, interrupted and unknown attempts return status 2. Observed
failures retain their native summary and partial text; an aggregate unknown
result can still report that the native host completed when local execution
proof is missing. Early errors use `koto.native-task-error` v1 with a bounded
native error code. The public contract manifest advertises both receipt types.

## Consent and privacy

History collection and personal learning are separate opt-ins. A native attempt
snapshots the existing history consent when it begins and checks that generation
again when appending. Disabling history, deleting history or changing its consent
generation discards pending captures. Learning consent is also captured at the
start: disabling learning removes pending selection metadata while preserving
separately consented plain history. Re-enabling either feature does not restore
an old consent ticket or import activity that happened while disabled.

The native path uses the same encrypted, device-local history store and explicit
review, export and deletion controls described in [local history](LOCAL_HISTORY.md).
The device key and encrypted files have owner-only permissions; other code
running as the same local user remains outside that encryption boundary.
There is no history upload, cloud synchronization or automatic expansion of
collection consent.

Only the supplied user text and observed assistant text are retained as content.
Before dispatch, the supplied prompt also passes the configured deny/redact/off
secret policy. Later native tool and file context remains Codex-owned; this host
handoff does not intercept every subsequent commercial provider request.
Native authentication files, authorization headers, raw RPC transcripts, opaque
continuation state and tool execution history are not imported. Known secret
patterns, configured custom secret values and available Koto provider, identity
and ingress credentials are redacted in both directions, even when upstream
filtering is disabled. Filtering cannot identify every confidential detail;
review an export before sharing it.

Native request text has a 64 KiB capture budget and response text a 128 KiB
budget, including JSON escaping. Over-limit content is omitted and labeled;
an omitted response cannot certify a verified example. The shared store's
1000-entry, 32 MiB and configured retention limits still apply. Failures and
unknown outcomes are retained under the same controls as completed turns.

## History compatibility and evidence domains

Native entries use `hormuz.local-history-entry` version 4 and
`protocol: codex_app_server`, with or without personal-selection metadata.
Removing selection metadata during a learning opt-out leaves a native v4 entry.
Existing v1, v2 and v3 entries remain readable together with v4 entries; their
original evidence is not upgraded or reconstructed. History management results
retain their existing version. A reader that does not support v4 must reject it
rather than reinterpret it as an HTTP observation.

Selection metadata binds a supplied host-context digest, destination fingerprint,
machine digest and task digest. These opaque identities contain no native account
credential. A host-context digest describes the declared native session controls;
it also binds the local qualification limits, scoped controls and catalog content.
Changing the output cap or local profile therefore requires fresh validation;
temporary paths and per-task work IDs do not change the profile.
The digest does not capture every hidden native instruction or tool setting and is not
the actual downstream model-request profile used for router qualification.
Matching host history can support selection evidence, but cannot grant a local
route a capability or bypass its actual request-envelope checks.

Native history is marked non-replayable. Retained text is not a complete native
conversation, repository, tool context or model request. The generic history
text replay command therefore cannot use these entries as native acceptance or
coding evidence.

Before rollback to a history reader without v4 support, disable learning and
collection, and export retained history if needed. Preserve the encrypted files
and their key; do not relabel or downgrade v4 entries. Existing explicit
`chat ask` and its v1 receipt remain separate from `chat route` and the new native
receipt contract.

## Admission remains separate

The existing native `interactive` declaration permits explicit local selection;
it does not promote arbitrary native prompts into automatic local routing.
Automatic selection still requires eligible, qualified destinations and current
personal validation for the relevant context. Unqualified automatic coding
remains disabled. A model catalog entry, a recorded completed turn or a passing
text check does not change that status.

The history workflow tests establish storage, consent, compatibility and evidence
handling with disposable observations. They do not establish a real account's
entitlement, model quality, autonomous coding readiness or desktop activation.
