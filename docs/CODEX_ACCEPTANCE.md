# Real Codex acceptance journey

The source operator tool [verify_codex_acceptance.py](../tools/verify_codex_acceptance.py)
exercises the installed-wheel product through setup → real client request → public
inspection → revoke/disconnect. It uses the existing bounded qualification probe;
ordinary local coding stays unqualified. It does not install a coding receipt,
activate personal selection, use a commercial provider, download assets or edit
the live Codex home. This is an acceptance observation, not a model-quality or
automatic-coding qualification claim.

## Prepare without inference

Use existing reviewed Codex **0.160.0**, llama.cpp archive/executable and GGUF files,
a matching local setup profile with no coding receipt, and a built router wheel.
The profile must permit `code_change`, bound output to at most 512 tokens, and
bound each upstream request to at most 90 seconds. The independent executable
checker currently requires the macOS sandbox; there is no unsandboxed fallback.

```sh
python tools/verify_codex_acceptance.py prepare \
  --wheel /absolute/reviewed/koto_router.whl \
  --codex /absolute/existing/codex \
  --runtime-archive /absolute/existing/llama.tar.gz \
  --llama-executable /absolute/existing/llama-server \
  --model-file /absolute/existing/model.gguf \
  --qualification /absolute/reviewed/setup-profile.json \
  --case /absolute/authored/development.json \
  --instructions /absolute/reviewed/developer-instructions.txt \
  --client-instructions /absolute/reviewed/client-instructions.txt \
  --output /absolute/new/private-evidence
```

The case and both instruction options are optional for the small built-in
arithmetic acceptance fixture. The system instruction option replaces the
native client's stock system text; omitting it preserves that stock text. The
developer instruction option binds separate shared guidance.

Preparation creates an exclusive owner-only directory, installs the wheel with
`--no-index --no-deps --no-compile`, and imports it outside the source checkout.
Dependencies must already exist in the selected Python environment. It uses
separate HOME, CODEX_HOME, history and temporary directories. It records live
settings fingerprints without copying their contents, and never loads native
account credentials. The generated credential helper is called only in memory.

Actual Codex requests are captured by a single bounded local endpoint that
returns an intentional error and never forwards to a model. Catalog requests
may read the connected router's local metadata. Preparation freezes the wheel,
installed files, interpreter, host, existing assets, full captured native
profile/input, case/checkers and instruction files. It then disconnects and
verifies restoration and closed owned listeners. Inspect the private capture,
preparation report and `freeze.json` before explicitly running inference.

The first case's edit request is captured twice in separate native launches.
Both the complete semantic input and instruction/tool profile hashes must match
before preparation continues or publishes a freeze. The existing version-2
message-ID rule is the only input normalization; environment/permission text is
still bound in full. A mismatch retains both captures and the failed preparation
report, restores owned settings and closes listeners, and creates no freeze.
There is no model inference or retry of an evaluated repair in this check.

## Authored cases and one shared campaign

Each `--case` is a UTF-8 JSON object containing these fields:

| Field | Meaning |
| --- | --- |
| `id` | Unique stable ASCII identifier, at most 64 letters/digits/underscores/hyphens |
| `partition` | `development` or `held_out` |
| `family` | Declared qualification family |
| `prompt` | Full user task contract, explicitly requesting a supported Python code change |
| `initial_solution` | Initial source for `project/solution.py` |
| `checker` | Independent Python assertion source; implementation path is `sys.argv[1]` |
| `reference_solution` | Optional private source retained for separately reviewed offline reference controls |

Fields are nonempty strings, each bounded to 64 KiB. Checkers must load the
implementation through the supplied path, fail the baseline by assertion and
complete their independent assertions after the edit. Other exceptions and
premature exit zero do not establish completion. An unpredictable marker is
printed only after the checker returns. Executed submitted code shares the
checker interpreter, so the operator must still inspect the patch and rule out
assertion/receipt interference. Never infer an honest repair from exit codes
or a marker alone.

Repeat `--case` for up to 64 cases **during the same prepare command**. One
evidence root preserves the same HOME, project, active checker path and
permission context across captures and episodes. Preparation rejects differing
native instruction/tool profile hashes. The task prompts and initial input
hashes remain case-specific. A set of unrelated preparation roots must not be
combined into one execution subject. Campaign freshness, the four-development/
twelve-held-out battery, protected preregistration and independent operator
review remain governed by [local coding qualification](LOCAL_CODING_QUALIFICATION.md).
This tool does not silently assemble or install a passing campaign receipt.

## Run each scenario once

```sh
python tools/verify_codex_acceptance.py run \
  --evidence /absolute/new/private-evidence --case-id development-case --scenario edit
python tools/verify_codex_acceptance.py run \
  --evidence /absolute/new/private-evidence --case-id development-case --scenario deny
python tools/verify_codex_acceptance.py run \
  --evidence /absolute/new/private-evidence --case-id development-case --scenario cancel
```

`--case-id` is required for multiple cases. A single-case root can omit it.
Cases execute sequentially under an exclusive local lock. A scenario is consumed
before any native launch; a failure cannot be rerun in the same evidence root.
Changed treatment needs a separately frozen campaign and fresh held-out tasks.
Keep previous campaigns and all failed observations.

- `edit` arms one frozen probe with at most eight submissions and 90 seconds.
  Acceptance requires an assertion-failing baseline, safe actual edit, actual
  native tool execution, an unchanged independent checker, normal native exit
  with exactly one completed turn and no errors, preserved work/destination
  affinity and successful provider history for every observed submission.
- `deny` uses the ordinary path without a probe. It requires a controlled
  unqualified-local denial, no native tool/edit/completion, no probe dispatch
  and no provider history. This preserves the existing evidence gate.
- `cancel` interrupts the owned native process group after the relay observes
  response bytes from an admitted request, then revokes and disconnects. It
  requires one unknown provider history entry and no fabricated completion.
  If completion wins the race or cancellation occurs later in a tool episode,
  the observation fails this declared cancellation criterion; it is not retried
  or relabeled as success.

Every episode independently inspects public work state, routing, probe status
and the isolated history CLI. History is enabled only for these synthetic
fixtures; learning remains disabled. New history IDs identify the current
episode while predecessors remain retained. Whole-project snapshots preserve
bounded files before resetting only the owned project for the next case. Native
tools can write only project/temp; the rest of the evidence root, checkers,
references, previous/future case captures and gateway credentials are denied.
Both TMPDIR and zsh TMPPREFIX use the owned temporary directory. Native tool
PATH uses system/Homebrew executables rather than a denied live-repo virtualenv.
The one additional read exception is the owned
`home/.codex/tmp/arg0` parent containing native executable shims. Codex otherwise
adds a random readable leaf there to each launch's permission context, making
the actual first input differ after preregistration. The stable parent is
created during preparation and granted read access only; the rest of the
isolated home, settings, credentials, private evidence and future cases remain
denied. No permission/environment metadata is removed from probe binding.

Native stdout and stderr each have a hard 2 MiB retained-byte cap; the relay
also bounds each response. Project snapshots permit at most 64 entries, eight
directory levels and 2 MiB of regular-file data without following links.
Independent checks have a three-second/8 KiB observation bound and deny network,
writes and reads outside interpreter support and the active checker/solution.
There are no quality or transport retries, automatic fallback or parallel cases.

Private reports retain patches, native/relay observations, independent outcomes
and cleanup receipts, including failed native completion. A passing report
still requests operator inspection. Revoke/disconnect run in cleanup, and
settings/listeners/live fingerprints must verify before a scenario passes.
Cleanup targets only this invocation's process groups and owned listeners.
No raw native context is published by the tool.

## Routine verification and compatibility

```sh
python -m unittest tests.test_codex_acceptance_workflow -v
```

These tests run the source operator tool as a subprocess against the real router
installed from a fixture wheel, with disposable client/runtime executables at
external boundaries. They make no model inference or commercial requests.
Preparation and tamper tests are portable; executable checker workflows run on
macOS and explicitly skip on Linux CI. The installed-wheel verifier copies this
maintainer tool alongside the tests; it is not shipped as runtime functionality.

The local `koto.codex-acceptance-freeze` format is version 1 operator evidence,
not a runtime contract. A changed tool/interpreter/asset/file inventory or host
rejects an existing freeze before consuming another case. Keep the frozen tool
to inspect older evidence; a new tool version requires a new root rather than
rewriting prior evidence. Disconnect the isolated owner before retiring a root.
