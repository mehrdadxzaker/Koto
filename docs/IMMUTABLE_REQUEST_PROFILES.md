# Immutable local request profiles

Local request treatments are selected by historical identifiers such as
`qwen-code.v15`. Each identifier resolves to one frozen `ProfileManifest` in
`hormuz/local_harness_profiles.py`. Its nested checkpoint, compute and helper
policies are frozen, helper ordering and compute tables are tuples, and registry
lookups are read-only. Model and capability lookup tables derive from this same
registry.

The manifest records the model binding, exact guidance, checkpoint and recovery
policy, ordered helper declarations and compute policy. Callers select reviewed
identifiers; they cannot submit arbitrary combinations of those policies.
Unknown identifiers remain unsupported, and multiple selected harness
capabilities remain ambiguous.

`prepare_request` in `hormuz/local_harness_request.py` is the transport's single
request-preparation interface. It receives an already translated private request
and the original native tool bindings, resolves the manifest before mutation,
then prepares guidance, helpers and compute hints. Its `PreparedRequest` result
carries the request and reversible compiler bindings back to `CodexLlamaRequest`.
No profile selects behavior through a version-membership branch in preparation
or guidance code. The earlier guidance-only `adapt_qwen_request` entry point
continues to resolve the same manifests for existing callers.

The coding client still owns permissions, execution, tool results and the agent
loop. Identified native tool declarations, alias collision handling, helper
bounds and response streaming remain enforced by their existing owners.
Preparation creates no processes and makes no model requests.

## Preservation contract

This implementation reorganizes existing behavior. All fifteen historical
profile identifiers, capability names, model bindings, instruction bytes, helper
ordering, reasoning budgets and request/response translation remain the same.
There is no settings or receipt schema migration, new profile, new model trial,
or automatic qualification. ADRs [0025](decisions/0025-evidence-backed-local-coding-admission.md)
and [0030](decisions/0030-bounded-coding-qualification-probes.md) still govern
coding evidence and explicit probes.

The pre-refactor fixture `tests/fixtures/local-harness-pre-manifest.json` was
captured from commit `24c841dcb4d3779996ca2f87d570eb0a9fa9bb53` before changing
the request implementation. It contains seventeen synthetic native histories
and literal wire and qualification fingerprints for all fifteen profiles:
255 comparisons at the existing `CodexLlamaRequest` interface. Histories include
successful and failed commands, syntax failure, repeated patches, string input,
all seven reasoning efforts after a verified edit, and nonautomatic tool choice.
Retain the fixture as historical evidence; do not regenerate it to accommodate
a behavior change. Existing response, continuation, authority and public router
workflow tests remain the other preservation checks.

Changing a historical manifest's effective treatment requires a new reviewed
profile identity and appropriate evidence. Moving an unchanged treatment between
implementation modules neither supplies new quality evidence nor authorizes
automatic local coding. Historical campaign files and qualification rules are
preserved.

## Verification seams

- Resolve a profile and attempt to mutate its manifest, nested policies and
  registry: verifies the immutable selection contract.
- Prepare a translated request through `prepare_request`: verifies unchanged
  native bindings, no-profile behavior and rejection before mutation.
- Submit native request/response fixtures through `CodexLlamaRequest`: verifies
  wire and qualification fingerprints and preserves the caller's request.
- Connect, submit through the real router with bounded synthetic providers,
  inspect results/status and disconnect: verifies the prepared request reaches
  the caller while ordinary admission and restoration remain intact.

These tests establish compatibility behavior. They do not establish real-model
task quality, host qualification, or release readiness.
