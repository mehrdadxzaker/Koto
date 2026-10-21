# Native local-profile acceptance — 2026-10-20

The bounded real journey **passed** on the candidate with local thread-scoped
`web_search: disabled` and `features.apps: false`. It verified history-based
local selection, unfamiliar-task ChatGPT fallback and unavailable-engine
ChatGPT fallback. Normal settings and earlier failed evidence remain unchanged.
The [previous failed journey](native-personal-acceptance-20261020.md) is retained.

## Fix and regression evidence

Codex advertised hosted web search for the explicitly selected local turn.
Disable that feature before Codex constructs the local request, without editing
saved preferences or stripping tools from an intercepted request. The first
public workflow regression failed before this change and passed afterward;
the subscription thread receives no search override.

The first real web-search-only candidate removed hosted search and passed router
admission, but its native turn still failed. Content-free measurements showed
567 flattened function declarations occupying 930,342 bytes. The operator's
2 MiB request bound does not establish fit in the pinned model's 32,768-token
context. That failed attempt remains in encrypted history and the private archive.

The local-only app-catalog override then reduced the observed request to 22
flattened function declarations occupying 20,055 bytes, with a provider body of
83,519 bytes. A second public regression failed before the app control and
passed afterward; it requires native function tools to remain available and
preserves the subscription app preference. Strict runner tests reject unsupported
search/app values and local controls without a qualified loopback provider.

These are documented native controls: [search and app configuration](https://developers.openai.com/codex/config-reference),
[thread configuration and app gating](https://learn.chatgpt.com/docs/app-server).
Both controls are part of the host profile digest, requiring fresh validation.
No request/context/output cap was raised, no schema was truncated, and no
router admission rule was relaxed.

## Real comparison

The candidate used existing Codex CLI 0.160.0, llama.cpp b11617 and Qwen3-4B
Q4_K_M assets. Codex retained its existing ChatGPT account and selected
`gpt-6.1-sol` model. No provider credential was copied into Koto and no API-paid
fallback was configured. The candidate wheel SHA-256 is
`a7f7f2a68cabbb1c9ab11d101ea779cbb32ee6ebf1325198482a9fe3ddf075bd`.

After a verified interactive local task independently returned `7`, a new
isolated operator declaration admitted **only inventory summarization** for
noncoding trials. Existing model revision, capabilities and bounds were retained.
Coding evidence remained absent. This is a narrow experimental profile, not a
general quality certificate or automatic coding qualification.

Six distinct prompts and literal arithmetic checks were frozen before the
cohort: three development pairs and three held-out pairs. Models ran serially,
local then subscription, without quality retries, model downloads, artificial
delays or clock changes. Every paired answer passed its independent check.

| Case | Partition | Local latency (ms) | ChatGPT latency (ms) |
| --- | --- | ---: | ---: |
| Box total 7 | Development | 31,242 | 4,505 |
| Crate total 11 | Development | 2,187 | 4,380 |
| Package total 17 | Development | 2,136 | 4,861 |
| Different box total 7 | Held out | 2,277 | 4,257 |
| Different crate total 11 | Held out | 2,322 | 5,561 |
| Different package total 17 | Held out | 2,437 | 4,613 |

The first cold local turn is included. The unchanged public validation gate
passed: three development cases, three held-out cases, zero partition overlap,
zero unknown decisions, zero false-local decisions, two held-out local
selections and **5,415 ms aggregate measured latency saved** on those selections.
The cold box example supplied a commercial class; the two faster development
families supplied the local class.

## Fresh routing and fallback

Only after passing validation did the isolated learning profile enter automatic
mode. The fresh local probe used a predeclared crate task, chosen by the frozen
rule selecting the first local-winning development family. No held-out outcome
was used to choose that prompt.

| Fresh probe | Observed destination | Independent answer | Latency (ms) |
| --- | --- | --- | ---: |
| New crate total | Qwen3-4B, selected automatically from history | `13` | 2,229 |
| Unfamiliar translation | Existing ChatGPT model | `Hello` | 4,836 |
| Suitable crate task after stopping the owned local engine | Existing ChatGPT model | `10` | 5,377 |

The local receipt reports `validated: true`, `routing_effect: selected`, verified
`owned_router_receipts` execution and one local attempt. Both fallback receipts
report verified `native_provider_binding` execution with the existing selected
commercial model. The offline fallback occurred before local dispatch; no failed
local generation was replayed commercially.

All three probe answers were checked against frozen literal expectations outside
learning feedback, so their execution could not change the validated dataset
during the routing checks. Their native observations remain retained in history.
The validation is setup-bound and expires after 24 hours; later checked feedback
or setup changes require revalidation as usual.

## Preservation, cleanup and limits

The run submitted **17 native turns**: nine local trials (including the failed
web-only preflight) and eight subscription turns, below the declared maxima of
22 total and nine subscription turns. There were no quality retries or extra
commercial evaluation calls. Subscription/local monetary cost remains unknown.

A hash-and-mode check after the real journey confirmed all 3,369 earlier evidence
files, two original settings files and five bridge ownership/configuration files
unchanged. Failed preflight records, the cold local results, frozen inputs,
encrypted history and its key, red/green logs and native receipts are retained
privately. Every native receipt reports owned-process cleanup, and the owned
engine/router disconnected before the offline fallback.

Automatic local coding remains disabled. Normal Codex settings, startup path and
installation remain unchanged. This establishes the explicitly launched,
read-only Koto-enabled session on this host and narrow task family. It does not
establish desktop interception, general local quality, every tool/server profile,
or a benefit for cold local turns.
