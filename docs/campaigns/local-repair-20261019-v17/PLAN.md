# V17 preparation: concise workflow and explicit contract distinctions

Status: revision 1 was rejected before dispatch with zero model submissions;
its original freeze and failed observation remain intact. Revision 2 is separately
preregistered in [FREEZE-revision2.json](FREEZE-revision2.json) and
[coding-plan-revision2.json](coding-plan-revision2.json), after forty-nine actual
native captures and identical repeated first inputs. Task/checker/guidance/model
bytes are unchanged. This frozen #577 payload predates independent #579 on main.
No canary outcome or coding qualification exists at this checkpoint. Historical
V16 and predecessor failures remain intact.

## Hypothesis and limits

V16 accepted six of sixteen cases. Seven episodes exhausted eight requests,
including five with independently passing final implementations. Several spent
requests executing draft functions, printing examples, rereading or rechecking
after useful verification. Four completed implementations violated explicit
contracts concerning built-in integer subclasses, boolean elements or ASCII
digits. One generation left an incomplete command which the guard withheld.
The native template demonstrably rendered V16's longer guidance; its presence
did not establish adherence.

The only proposed model-side change is the shared task-independent
[developer guidance](developer-instructions.txt). It makes the final answer the
next response after one imported assertion check, removes exploratory baseline
calls, and emphasizes literal type/alphabet/state requirements. It discourages
redefined test functions and long integer literals. This is a new instruction
profile and an unproven behavioral hypothesis. No gateway state machine forces a
final response, changes tool output, invents command arguments, executes a second
agent loop, substitutes a solution or exposes independent checks.
The separately frozen [client instructions](client-instructions.txt) are copied
byte-for-byte from V16 and must be passed through the driver's
`--client-instructions` option. Leaving that option unset would use stock Codex
system instructions and constitute a different treatment; do not silently make
that substitution. The actual captured request profile must bind both files.

The router wheel also contains the reviewed streaming and tool-history guards
from #578/#577. A resulting full-setup observation cannot isolate the effect of
developer guidance from those transport changes. The exact wheel, source, native
profile and existing asset digests are committed before model execution.

Keep the existing Qwen3-Coder-30B-A3B-Instruct Q4_K_M weights, llama.cpp b11617,
original template, managed-llama.v1 controls, native Codex 0.160.0 and its four
unchanged tool schemas. Each episode has eight forwarded requests, 90 seconds,
512 output tokens per generation, zero quality/transport retries and one native
episode at a time. A new accepted canary unlocks the other fifteen once only.
The four new development tasks and twelve held-outs are authored before any
model call. Development reuse is unnecessary; all sixteen task goals are new.

## Tests before references

The public seam is each declared function or class in `solution.py`, exercised
by a separate Python checker. Authoring proceeded one case at a time: execute
its checker against the supplied buggy implementation, require assertion exit 1,
then write and execute its reference implementation. All sixteen have an
assertion-failing baseline and a passing authored reference. These offline
controls establish checker applicability, not model quality or native behavior.

[authoring-controls.json](authoring-controls.json) retains the original sequential
red and green results. [preparation-controls-v3.json](preparation-controls-v3.json)
repeats all final reviewed checks in isolated `-I -S` Python processes with an
unpredictable completion marker after all assertions. The earlier
[preparation-controls.json](preparation-controls.json) remains unchanged.
Prepared checks, task/source digests and case-file
hashes are retained in [corpus.json](corpus.json). Checkers use worked literal
results and contract assertions; strict built-in-int contracts test bool and an
int subclass on every constrained parameter or element position.

Two preparation errors were corrected before inference and are preserved in
`preparation-attempts/`: source escaping produced an indentation error, and the
initial size-parser baseline raised ValueError before a failing assertion. The
final baseline for every case fails an assertion; neither preparation error is
reported as a model observation. Review then exposed five authored checker
sensitivity gaps: fraction result integer type/precision, size-parser integer
type/precision, unconditional ragged-row validation with empty indices, exact
large-value argsort ordering and preservation of low bits during wide reversal.
Each deliberately incorrect reference variant passed the earlier checker and
fails its hardened checker; those before/after controls and original checker
sources are retained in `preparation-attempts/03-review-checker-sensitivity.json`.
All sixteen initial/reference controls pass after hardening, with no task,
reference solution, model treatment or model observation changed. These are
pre-freeze improvements. A later inventory refresh discovered an independently
running user-owned campaign with the same exponentiation and adjacent-difference
goals. Both unfrozen V17 cases were withdrawn and their exact sources retained
in `preparation-attempts/04-concurrent-corpus-inventory/`. New digit-carry counting
and variable-size list partitioning cases were authored assertion-red before
their references passed; five deliberately incorrect variants fail the new
checks. The v3 controls cover the resulting sixteen-case corpus. The
[updated freshness review](held-out-freshness-v2.json) compares nineteen retained
corpora and two hundred distinct prior goal texts. Before freezing, recheck that
the independently owned workspace inventory has not changed again. The final
execution freeze must bind this current corpus and v3 controls, retaining all
earlier controls and withdrawn preparation cases as historical evidence.
References and private checks must never be
placed in the native project's permitted roots.

## Freeze and native acceptance

Use the reviewed installed-wheel acceptance driver with each `cases/<id>.json`,
the shared `developer-instructions.txt` and retained `client-instructions.txt`.
Freeze the complete corpus together with client/runtime/model/template hashes,
wheel/runtime-module parity, native instruction/tool/request controls, actual
first-input hash, budgets, implementation/checker hashes, runner dependencies and
operator authorization before inference. Freeze each exact case profile, rather
than substituting a new prompt into an unbound first request. The driver and
native client must run outside the source checkout in private isolated settings.

A passing case requires baseline assertion exit 1, an actual safe implementation
edit and retained patch digest, unchanged independent assertions completed with
exit zero, exactly one native `turn.completed`, no `turn.failed`/error, native
exit zero and all budgets met. A checker-zero implementation after request-cap
failure is still failed. Cancellation, missing output, timeout and malformed or
unterminated streaming attempts remain unknown/failed as observed. Do not retry,
drop cases, alter checks, or tune held-outs after the freeze.

All sixteen must pass the existing `local-repair.v1` acceptance criteria. A
second failure means this model/template/instruction envelope is still not
qualified within the unchanged limits. Preserve that outcome; do not convert
HTTP success, a passing canary, a checker-only pass or the preparation controls
into a qualification claim.

Keep local-only policy, no commercial calls, isolated opted-in evidence only,
no learned-selection activation and no automatic coding receipt. Even a fully
passing campaign does not authorize automatic local coding. Always revoke
ephemeral probes, disconnect and verify cleanup in finally paths. Retain failed
evidence, do not overwrite output directories, restore owned settings
conditionally and preserve the user's live settings and unrelated processes.
