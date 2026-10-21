# Personal model selection

## Product contract

Koto adds local models to the selection pool alongside the commercial model you
already use, then learns from your work which model should handle each prompt.
The initial pool is that selected commercial baseline plus qualified local
alternatives. The client continues to own editing, tools, permissions and its
agent loop. Every active feature must advance:

**history → scorecard → classifier → model execution → observed outcome**.

Quality evidence comes from independent checks or explicit user feedback. HTTP
success, a model's confidence and a successful process exit do not prove task
success. Classification is a local multiclass nearest-neighbor decision; there
is no classifier LLM request. Observation and automatic selection use the same
classifier. Actual routing remains subject to policy, credentials, capability
qualification, hard local-only enforcement and continuation affinity.

## Command map

Use these commands after `koto --config /absolute/path/koto.json`. Collection
and learning require separate consent; learning starts in observation mode.

| Intent | Command | Details |
| --- | --- | --- |
| Consent to future history collection | `history enable` | [Collection and retention](LOCAL_HISTORY.md) |
| Separately consent to learning | `history learning enable` | [Use your work](#use-your-work) |
| Inspect learning mode and evidence | `history learning status` | [Selection status](#learn-validate-and-select) |
| Assess a retained outcome | `history feedback ENTRY_ID --result pass` or `--checks /absolute/path/checks.json` | [Checked feedback](#use-your-work) |
| Inspect per-model results | `history learning scorecard` | [Scorecard evidence](#use-your-work) |
| Validate against the current baseline | `history learning validate --baseline CURRENT_COMMERCIAL_ALIAS` | [Held-out gates](#learn-validate-and-select); validation does not supply coding qualification |
| Stop future learning or collection | `history learning disable` or `history disable` | [Opt-out behavior](#privacy-migration-and-rollback); retained history is not deleted |
| Delete retained entries | `history delete ENTRY_ID` or `history delete --all` | [History deletion](LOCAL_HISTORY.md); distinct from disabling future capture |
| Export selected retained content | `history export --id ENTRY_ID --output /absolute/path/new-export.json` | [Local export](LOCAL_HISTORY.md); decrypted exports are confidential local files |

## Use your work

Connect the supported client through the existing connection workflow. A hybrid
configuration must explicitly authorize the selected commercial model and the
local candidates. In automatic admission mode, persistent Codex connection
preserves the configured commercial alias matching its current model. An absent
or ambiguous commercial match stops setup before writing settings. Native plan
authentication and billable API credentials retain their existing separate gates.

For the existing ChatGPT subscription, use the explicit fresh, read-only
[native personal session](NATIVE_PERSONAL_SESSIONS.md) workflow. Codex keeps its
native authentication and selected commercial model; the session can choose
qualified locals using checked local history. This does not activate a desktop
model picker or provide an autonomous coding interface.

Collection and learning are separate opt-ins:

```sh
koto --config /absolute/path/koto.json history enable
koto --config /absolute/path/koto.json history learning enable
koto --config /absolute/path/koto.json history learning status
koto --config /absolute/path/koto.json history list
```

Learning starts in `observe` mode. Repeating enable preserves its examples and
mode. It captures setup-bound metadata only for future requests whose history
and learning consent were present at ingress. Older history remains reviewable;
records without setup identity are not fabricated into training evidence.
A new history enable/actor selection invalidates prior learning consent.

Assess a retained task explicitly:

```sh
koto --config /absolute/path/koto.json history feedback ENTRY_ID --result pass
koto --config /absolute/path/koto.json history feedback ENTRY_ID --checks /absolute/path/checks.json
koto --config /absolute/path/koto.json history learning scorecard
```

A checks file is a JSON array using the existing benchmark `metric`, `kind`,
`value` format. Supported text/JSON checks are evaluated against the retained
response; tool execution is never reconstructed from history. Checks and their
expected values stay encrypted locally and are excluded from model requests,
list/status output and routing headers. User feedback is explicitly labeled;
unchecked tasks stay unknown. Interrupted attempts and responses without a
verified completed result from the expected model cannot become passing evidence.

For an independently checked, fresh, plain-text task, compare local models:

```sh
koto --config /absolute/path/koto.json history learning evaluate \
  --id ENTRY_ID \
  --max-requests 8 --deadline-seconds 90 --timeout-seconds 30 --max-output-tokens 512
```

Omitting `--models` discovers configured qualified local aliases, then uses the
router's current policy-filtered admitted pool. It never adds an unqualified or
commercial destination. `--models local-fast local-code` remains an advanced,
explicit override; each requested alias must still pass the same local binding
and policy checks, rather than silently dropping a denied requested model.

This reuses the router benchmark transport: one request at a time, pooled client,
absolute deadlines, zero model retries or cloud fallback, and owned connection
cleanup. Explicit task/model combinations must fit the request cap before
network access. Discovery reads the router's bounded admission metadata, then
checks the admitted combinations against the cap before model requests.
The original output/profile must fit the token cap; evaluation
never silently truncates input or changes its budget. Failed, unknown and unrun
observations stay visible. Commercial evaluation is rejected before egress;
additional commercial evaluation needs a separately implemented opt-in budget.

Native v4 history remains non-replayable through this command. To compare a
native task, explicitly launch fresh baseline and qualified-local native sessions
and check their retained outcomes. There is no hidden commercial replay or
conversion of native conversation state into a plain HTTP task.

Text-only history does not contain a replayable repository or native tool state.
Such tasks need the existing independently checked coding qualification workflow;
a text replay never qualifies autonomous coding. No new real-model trials are
part of this alignment change.

## Learn, validate and select

Development examples pair checked outcomes for the same task and request profile
across the baseline and local models. The fastest passing model supplies the
class label; unsuccessful/unknown observations stay in the scorecard. Features
are bounded case-folded word counts from the latest sanitized user text.
Cosine one-nearest-neighbor classification requires similarity at least 0.65;
conflicting closest classes, unrepresented profiles and unfamiliar prompts
abstain. The selector chooses model aliases, not generic local/cloud labels.

Keep held-out tasks distinct from development tasks and label their outcomes
with `history feedback ... --partition held_out`. Repeated attempts are not new
coverage. A task appearing in both partitions invalidates validation.

```sh
koto --config /absolute/path/koto.json history learning validate \
  --baseline CURRENT_COMMERCIAL_ALIAS --activate
```

The gate requires at least three distinct development and three distinct
held-out tasks per request profile, zero unknown held-out decisions, zero
observed false-local decisions, at least one local selection and positive
aggregate measured latency benefit relative to the checked baseline. These are
minimum empirical gates, not statistical guarantees of general quality.
Held-out tasks are never classifier training examples. The receipt binds the
checked dataset, pool/setup identities, classifier version and request profiles
and expires after 24 hours. Further checked feedback, source deletion, expiry or
setup changes require revalidation before new automatic selections.

Omit `--activate` to validate retained outcomes in observation mode. Validation
makes no provider requests; even a passing receipt keeps recommendations separate
from execution on the commercial baseline. Unchecked held-out outcomes and zero
or negative latency benefit prevent activation. A passing selector receipt never
supplies missing coding qualification.

Authored loopback responses and timings verify these gates, not real model quality
or measured savings. An existing ChatGPT subscription can supply a checked baseline
through the supported fresh, read-only [native personal session](NATIVE_PERSONAL_SESSIONS.md)
workflow, with a separate explicit qualified-local run for the same prompt. Assess
both outcomes; native history is not replayed automatically, and these text sessions
do not qualify autonomous coding. Cloud readiness still reports the separate native
gateway and ChatGPT app authorization paths as `not_implemented`; those gates do not
describe the supported terminal-native session workflow. A paid API baseline
requires separate authorization.

Automatic mode uses the current commercial baseline on insufficient evidence.
Hard local-only selection blocks instead of contacting it. Explicit local model
choices and bounded qualification probes retain their separate authority.
Provider/tool continuation keeps its established destination; classification
never migrates ongoing provider state. Missing coding readiness remains a block.

`history learning status`, `client status codex --routing` and `/v1/router/state`
expose metadata only. Routing headers distinguish recommendation from execution
with `X-Koto-Selection-Model` and `X-Koto-Executed-Model`. Status includes the
last decision, similarity/supporting task hashes and validation state. Offline
status labels setup verification as unchecked instead of claiming current
runtime readiness. Costs with missing rates/usage stay unknown, including local
compute and subscription plan cost; this version activates on latency benefit.

## Privacy, migration and rollback

`history learning disable` stops personal learning and selection, including derivatives
from responses still pending at opt-out. Separately consented ordinary history
can continue. `history disable` also
invalidates learning consent. Deleting/expiring history removes its examples;
there is no persistent embedding index or duplicate transcript dataset. The
bounded classifier is rebuilt from retained records, so deleted content cannot
survive in a cached classifier. Derived consent/validation metadata uses the
same private encrypted storage and owner-only key as history.

New `koto.personal-*` and `koto.model-selection` receipts are version 1. Learning
adds optional `selection`/`quality` metadata to encrypted history entry version 3;
existing v1/v2 entries and historical shadow/setup receipt readers remain.
Native `codex_app_server` history uses entry v4, including plain history without
learning metadata. Current readers preserve v1–v4 together; the host-context
identity in native records is separate from an HTTP model-request qualification
profile. See [native compatibility](NATIVE_PERSONAL_SESSIONS.md#history-compatibility-and-evidence-domains).
Admission status v3 adds `personal_selection`; relay metadata v5 adds selection
headers. Without learning consent, automatic requests keep their selected
commercial baseline. Explicit local choices, continuation affinity and advanced
manual benchmark configurations retain their separate authority.
Manual benchmark v1 files remain readable and usable as advanced tooling.

The old `shadow_router` configuration and `client setup --shadow-router` are
retired explicitly; their extra LLM request implementation is removed. Prepare
a new configuration without that field, inspect it, then use the existing
conditional disconnect/reconnect flow. Learning requires its separate opt-in.
Never rewrite an active configuration or user-edited Codex settings to migrate.
Before rolling back to a reader without the retained history versions, disable
learning and capture, and export retained history if needed; older binaries
cannot reinterpret v3 or v4 records as an earlier version.
Preserve the encrypted files and key rather than silently downgrading records.

## Active backlog and acceptance

- Product epic #523 and completion map #536: deliver this personal selection loop.
- Closure gate #543: require the supported end-to-end journey, checked held-out
  quality, measured benefit and truthful fallback/status before release claims.
- Compatibility #569: retain failed evidence and resolve only blockers to
  admitting useful local candidates. The separately authorized bounded
  [harness development studies](LOCAL_QWEN_HARNESS_V8.md) do not replace ordinary
  coding qualification; additional qualification requires its own bounded plan.
- Acquisition #542 / merged #568: supporting setup work, not a separate product.
- Operations #494–501: separate maintenance, outside this product's critical path.

The primary TDD seam remains connect → request through the actual router →
inspect result/status → disconnect. Synthetic tests cover multiple local classes
and the commercial baseline, unknown/stale/deleted evidence, held-out failures,
local-only denial, tool affinity, explicit migration and restoration. They do
not establish actual model quality, account eligibility or a passing native
coding qualification. Frozen campaigns and their failed results remain intact.
