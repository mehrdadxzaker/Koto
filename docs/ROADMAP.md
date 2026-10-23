# Koto roadmap

This is a navigation page for current work, not a delivery-date promise.
The linked issues carry the live status and acceptance criteria. The product
loop is **history → scorecard → classifier → model execution → observed outcome**.
Read [product scope](ROUTER_SCOPE.md) before proposing a new direction.

## Current work

| Track | Goal and remaining evidence | Tracker |
| --- | --- | --- |
| Personal selection | Source loop delivered; establish consented representative checked history and real held-out benefit | [Product epic #523](https://github.com/mehrdadxzaker/Koto/issues/523), [completion map #536](https://github.com/mehrdadxzaker/Koto/issues/536) |
| End-to-end validation | Prove the supported journey, held-out quality, measured benefit and truthful fallback/status before release claims | [Closure gate #543](https://github.com/mehrdadxzaker/Koto/issues/543) |
| Supported coding journey | Complete and qualify the native coding workflow; the current native learning surface is read-only text | [Closure gate #543](https://github.com/mehrdadxzaker/Koto/issues/543), [native session limits](NATIVE_PERSONAL_SESSIONS.md#session-limits) |
| Release engineering | Prepare reproducible runtime and plugin candidates from verified source, with accurate channels and support claims | [Versioning](VERSIONING.md), [release guide](RELEASING.md) |
| Contributor experience | Improve docs, synthetic reproductions and focused public-workflow tests | [Good first issues](https://github.com/mehrdadxzaker/Koto/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22), [help wanted](https://github.com/mehrdadxzaker/Koto/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22help%20wanted%22) |

Compatibility [#569](https://github.com/mehrdadxzaker/Koto/issues/569) is closed;
its failed canary remains evidence, not a qualified local coding setup.
Obsolete operations [#494–501](OPERATIONS_CLEANUP.md) are closed as not planned,
without a claim that all external resources or accounts were retired.

## Contribution boundaries

- Codex is the first implemented routing connection. Other agents can install
  skills; their own inference adapters require separate implementation and
  qualification. See [agent installation](AGENT_INSTALLATION.md).
- History capture and learning require separate opt-ins. Observation comes
  first; automatic routing needs held-out validation and eligible destinations.
- A running local model, healthy transport or synthetic passing test does not
  establish autonomous coding quality. Bundled local coding examples remain
  unqualified. Additional candidate trials are paused in the current scope;
  discuss a bounded acceptance purpose before proposing live evaluation.
- Standalone apps, hosted billing and enterprise front doors are retired from
  the active 2.0 source product. Cleanup of their external resources is separate.

Start with [a first contribution](FIRST_CONTRIBUTION.md) or discuss a larger
idea in [Discussions](https://github.com/mehrdadxzaker/Koto/discussions).
