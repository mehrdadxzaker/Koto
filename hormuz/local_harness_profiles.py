"""Immutable, reviewed local request treatments; historical identities stay stable.

Guidance is preserved from the transport-only adaptation inspired by Open
Interpreter's Apache-2.0 Qwen request builder at commit
ac1fcc8fe57aba51fcc3c79afd57a0883237fe87, core/src/harness/qwen_code.rs.
"""
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal

from .local_harness_progress import GUIDANCE as V4_GUIDANCE, REPEATED_PATCH_ADVICE as V4_REPEATED_PATCH

CAPABILITY = 'qwen_code_v1'

PROFILE = 'qwen-code.v1'

V2_CAPABILITY = 'qwen_code_v2'

V2_PROFILE = 'qwen-code.v2'

V3_CAPABILITY = 'qwen_code_v3'

V3_PROFILE = 'qwen-code.v3'

V4_CAPABILITY = 'qwen_code_v4'

V4_PROFILE = 'qwen-code.v4'

V5_CAPABILITY = 'qwen_code_v5'

V5_PROFILE = 'qwen-code.v5'

V6_CAPABILITY = 'qwen_code_v6'

V6_PROFILE = 'qwen-code.v6'

V7_CAPABILITY = 'qwen_code_v7'

V7_PROFILE = 'qwen-code.v7'

V8_CAPABILITY = 'qwen_code_v8'

V8_PROFILE = 'qwen-code.v8'

V9_CAPABILITY = 'qwen_code_v9'

V9_PROFILE = 'qwen-code.v9'

V10_CAPABILITY = 'qwen_code_v10'

V10_PROFILE = 'qwen-code.v10'

V11_CAPABILITY = 'qwen_code_v11'

V11_PROFILE = 'qwen-code.v11'

V12_CAPABILITY = 'qwen_code_v12'

V12_PROFILE = 'qwen-code.v12'

V13_CAPABILITY = 'qwen_code_v13'

V13_PROFILE = 'qwen-code.v13'

V14_CAPABILITY = 'qwen_code_v14'

V14_PROFILE = 'qwen-code.v14'

V15_CAPABILITY = 'qwen_code_v15'

V15_PROFILE = 'qwen-code.v15'

MODEL = 'Qwen3-14B-Q4_K_M'

CODER_MODEL = 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M'

V8_GUIDANCE = '''Local coding protocol (subordinate to existing host and repository instructions):
Complete the requested repair through the declared host tools. For other tasks,
answer the original request without inventing edits or checks.
Read the source and every requirement. For Python verification, use the declared
Python script helper (script parameter) when offered. Its script is ordinary
Python with real newlines, not a shell command or JSON test cases. Import and
call the saved function; do not redefine the implementation in a check. Use
assertions, including errors and boundaries.
If an error must leave state unchanged, validate all operations using private
proposed state before committing any mutation. Test a valid step followed by a
failing step, cumulative repeated operations, and the complete state after the
exception. If values may be unhashable, compare them by equality rather than
using a set or dictionary as the sole deduplication mechanism.
Run focused checks, repair the actual saved code, then rerun the same checks
after the last edit. Inspect actual host results. A printout, saved patch, test
definition, or failed command does not establish passing assertions. Do not
weaken the specification or existing checks. Finish with the repair and checks
that actually ran, or the concrete blocker. Native patch hunks use plain @@
and correctly prefixed lines, without unified-diff line-number ranges.'''

V11_GUIDANCE = V8_GUIDANCE + '''
Before editing, turn every stated type and error constraint into a compact
assertion against the saved function. In Python, bool is a subclass of int:
isinstance(value, int) accepts True and False. Reject booleans or require an
exact built-in type only when the task requires it; preserve other permitted
types. Include specified excluded types and distinguish missing, None, False
and zero where required. Run those assertions after the final edit, together
with the normal and boundary cases. Do not weaken an explicit constraint to
make a check pass.'''

V12_GUIDANCE = V11_GUIDANCE + '''
Exact type and type-family requirements are different. In Python,
isinstance(value, int) with a separate bool rejection still accepts int subclasses.
When the task excludes subclasses, use type(value) is int; test a locally defined
int subclass as well as bool. When integer subclasses are explicitly allowed,
preserve them and reject only excluded types. Derive checks for each specified
accepted and rejected category instead of inferring full coverage from normal
examples. These rules apply only where required by the original task.'''

V15_GUIDANCE = '''Local integer type verification (subordinate to host, repository and user instructions):
For top-level integer parameters of a saved Python callable, use the declared
integer-check helper, when offered, after the final edit, only when every declared
rejection requires TypeError. For other exception contracts, methods or nested
values, write plain Python assertions with the script helper. Supply a valid named integer sample and the original
rule for each selected argument: reject subclasses for exact built-in integers;
allow subclasses only when permitted. Choose booleans=reject only when forbidden,
otherwise unchecked and verify their permitted behavior separately. The helper
constructs a same-value int subclass and rejected boolean checks against the saved
function. A boolean-only guard does not reject other int subclasses. Inspect its
actual exit result and repair failures. Also run concise functional assertions;
type checks alone do not prove task correctness. Never invent a type restriction.
''' + V8_GUIDANCE

V9_GUIDANCE = V8_GUIDANCE.replace('''For Python verification, use the declared
Python script helper (script parameter) when offered. Its script is ordinary
Python with real newlines, not a shell command or JSON test cases. Import and
call the saved function; do not redefine the implementation in a check. Use
assertions, including errors and boundaries.''', '''For saved Python functions, prefer the declared function-case helper when
offered. Supply small cases with an arguments object keyed by the saved function's
parameter names and expected values or exceptions,
plus required identity and state-preservation checks. Opt into batch composition
only when the original specification requires its sequential-rejection property.
The plain Python script helper remains available for checks case data cannot
express. Import the saved function; do not redefine it in a check. Let assertions
and unexpected exceptions fail the command rather than catching and printing them.''')

V10_GUIDANCE = '''Local coding protocol (subordinate to host, repository and user instructions):
For a requested repair, read the saved source and every requirement, make a focused
edit through declared tools, and verify the saved implementation.
For other tasks, answer the original request without inventing edits or checks.
For required atomic mutation, make a private working copy of the mutable state.
Apply every operation in order against that evolving copy, validating cumulative
effects there. Commit to the original state only after the entire operation succeeds; preserve required
object identity. Check a valid step followed by a specified error, repeated
operations whose cumulative effect exceeds a limit, and the entire unchanged
original state after the exception.
For supported unhashable keys, retain encountered keys and compare by equality.
Hashing, sorting and serialization are not substitutes for required equality.
Distinguish a missing required key from a present None: check key presence
explicitly instead of inferring absence with get(..., None).
Use one compact Python assertions script that imports the saved implementation,
including its required imports, and covers the original success, error, ordering,
identity and state requirements. Run it before editing, then rerun the identical
checks after the last edit. Correct import or check errors and obtain actual
successful assertions before reporting success. Let failed assertions and unexpected
exceptions fail the command instead of catching and printing them. Preserve original requirements
and existing checks. Report actual results or the concrete blocker.'''

GUIDANCE = '''Local coding guidance (subordinate to all existing host and repository instructions):
Read the relevant source and nearby tests before editing. Follow existing project
conventions and verify available dependencies. Identify all required return values,
ordering, mutation, boundaries and exceptions. Make a focused change covering each
requirement. Use only the tools declared by the host, with their exact parameter
names; do not invent tools or claim an edit without a successful tool result.
After editing, run the relevant checks through an available host tool. Reconcile
failures with the specification before changing code or expectations. Do not repeat
an unchanged failed call. Once the latest edit passes the relevant checks, finish
with a concise factual status, including checks that could not run.'''

V2_GUIDANCE = '''Local verification protocol (subordinate to all existing host and repository instructions):
For a requested coding edit, complete it through the existing host tools. For
other tasks, follow the original request without inventing edits or checks.
For coding work, do not stop at a plan
or a claim that the implementation works. Use only declared tools and parameters.
1. Read the relevant source and specification. Turn every requirement into a short
executable assertion, including boundaries, ordering, missing inputs and errors.
2. Check the available interpreter or test runner through a host tool. For Python,
try python3; do not assume the command python exists. If only the source file may
be changed, run assertions in an inline script instead of adding test files.
3. Exercise failure paths before editing. If failure must leave state unchanged,
save a copy, put a failing operation after a valid operation, and assert the full
state is unchanged after the exception. Cover repeated operations on the same
item. Check equality separately from hashing: when unhashable values are allowed,
include equal list or dictionary values. Distinguish a missing key from a present
key whose value is None. Use the task specification, not assumptions about types.
4. Execute those assertions against the current implementation and inspect the
actual failure. Then make the focused edit and execute the assertions again after
the last edit. Also run existing relevant tests when available. Repair failures
in the implementation; do not weaken requirements or existing checks.
5. A saved edit is not verification. Before a success report, obtain a successful
host tool result for the final implementation's assertions. If verification is
blocked or incomplete, say so and report the actual command and failure. Finish
with the edit and checks that actually ran, not future intentions.'''

V2_CHECKPOINT = '''Local verification protocol checkpoint (subordinate to all host and repository instructions):
Apply this checkpoint to requested coding edits; follow other tasks as requested.
Use the declared tools. If applying a native patch, follow its exact grammar:
*** Begin Patch, *** Update File: path, then @@ without unified-diff line numbers.
Every hunk line starts with a space for context, - for removal, or + for addition;
finish with *** End Patch. Never send an unprefixed source line in a hunk.
Before reporting success, execute compact assertions against the latest saved
code through a host tool (python3 for Python). For required atomic behavior, test
a valid step followed by a failing step and unchanged original state, including
repeated items. For equality supporting unhashable values, test equal lists and
dictionaries. Inspect actual failures, repair the code, and rerun the assertions.
For required no-mutation-on-error behavior, adapt this assertion pattern to the
task and execute it, including a batch whose repeated operations exceed a limit:
    before = copy.deepcopy(state)
    try:
        function(state, invalid_batch)
    except RequiredError:
        pass
    else:
        raise AssertionError("expected rejection")
    assert state == before
Use the real function, inputs and specified exception; import copy if needed.
A printout of a normal example is not verification. Use assert to check specified
results and failure invariants. Perform requested checks within host permissions;
do not end by offering to test later. Report actual results or a concrete blocker.'''

V3_PATCH_RECOVERY = '''Native patch recovery (subordinate to all host instructions):
The host rejected a native apply_patch containing a unified-diff range header.
Do not repeat the rejected patch or reread the unchanged file to fix this syntax.
Use a plain @@ on its own line. This is a complete FORMAT example only; use the
actual file, context and required edit from the task:
*** Begin Patch
*** Update File: path/to/file.py
@@
-old
+new
*** End Patch
Keep the existing host tool's exact argument names. After the successful edit,
execute the task's assertions through an available host tool before finishing.'''

V3_REPEATED_PATCH = '''The identical malformed patch has already failed more than once.
Change approach through another declared host editing tool if the host instructions
allow it. For example, an available exec_command takes cmd and can write the
required complete file with a safely quoted heredoc. Use only available tools and
stay inside the permitted workspace. Do not repeat the rejected patch again.
Then execute the assertions with python3 for Python, inspect the result, and fix
any failure before reporting success. If a later host tool already saved and
verified the edit, report those actual results. If no allowed approach exists,
report it.'''

V6_REPEATED_PATCH = '''The identical malformed patch has failed more than once.
Use a correctly formed native patch or another declared host editing tool within
host permissions. Do not repeat the rejected patch or relax the sandbox. Check
the saved function with the declared Python check helper when available; follow
the actual result before reporting completion.'''


@dataclass(frozen=True)
class CheckpointPolicy:
    kind: Literal['none', 'static', 'progress', 'script'] = 'none'
    single_line: bool = False
    typed_checks: bool = False
    feedback_checks: bool = False
    verification_sensitive: bool = False
    compact: bool = False
    patch_recovery: Literal['none', 'history', 'latest'] = 'none'
    repeated_patch_advice: str = V3_REPEATED_PATCH


@dataclass(frozen=True)
class ComputePolicy:
    effort_limits: tuple[tuple[str, int], ...] = ()
    phase_caps: bool = False


@dataclass(frozen=True)
class HelperSpec:
    kind: Literal['cases', 'feedback', 'named', 'script', 'integer', 'text_patch']
    prominent: bool = False
    guidance: bool = True


@dataclass(frozen=True)
class ProfileManifest:
    capability: str
    name: str
    model: str
    guidance: str
    checkpoint: CheckpointPolicy = CheckpointPolicy()
    helpers: tuple[HelperSpec, ...] = ()
    compute: ComputePolicy = ComputePolicy()
    compact_helper_guidance: bool = False


SCRIPT_COMPUTE = ComputePolicy((('minimal', 128), ('low', 256), ('medium', 512)), phase_caps=True)
COMPACT_COMPUTE = ComputePolicy(SCRIPT_COMPUTE.effort_limits)
SCRIPT_HELPERS = (HelperSpec('script'),)
COMPACT_HELPERS = (HelperSpec('script', prominent=True, guidance=False),
                   HelperSpec('text_patch', guidance=False))
RECOVERY_CHECKPOINT = CheckpointPolicy('script', patch_recovery='latest', repeated_patch_advice=V6_REPEATED_PATCH)

# Each historical identifier selects one complete reviewed treatment. Callers
# cannot compose arbitrary combinations or mutate the registry/policies.
PROFILE_MANIFESTS = MappingProxyType({manifest.name: manifest for manifest in (
    ProfileManifest(CAPABILITY, PROFILE, MODEL, GUIDANCE),
    ProfileManifest(V2_CAPABILITY, V2_PROFILE, MODEL, V2_GUIDANCE, checkpoint=CheckpointPolicy('static')),
    ProfileManifest(V3_CAPABILITY, V3_PROFILE, MODEL, V2_GUIDANCE,
                    checkpoint=CheckpointPolicy('static', patch_recovery='history')),
    ProfileManifest(V4_CAPABILITY, V4_PROFILE, MODEL, V4_GUIDANCE,
                    checkpoint=CheckpointPolicy('progress', patch_recovery='history', repeated_patch_advice=V4_REPEATED_PATCH)),
    ProfileManifest(V5_CAPABILITY, V5_PROFILE, MODEL, V4_GUIDANCE,
                    checkpoint=CheckpointPolicy('progress', single_line=True, patch_recovery='history',
                                     repeated_patch_advice=V4_REPEATED_PATCH)),
    ProfileManifest(V6_CAPABILITY, V6_PROFILE, MODEL, V4_GUIDANCE,
                    checkpoint=CheckpointPolicy('progress', typed_checks=True, patch_recovery='history',
                                     repeated_patch_advice=V6_REPEATED_PATCH), helpers=(HelperSpec('cases'),)),
    ProfileManifest(V7_CAPABILITY, V7_PROFILE, MODEL, V4_GUIDANCE,
                    checkpoint=CheckpointPolicy('progress', typed_checks=True, feedback_checks=True, patch_recovery='history',
                                     repeated_patch_advice=V6_REPEATED_PATCH), helpers=(HelperSpec('feedback'),)),
    ProfileManifest(V8_CAPABILITY, V8_PROFILE, MODEL, V8_GUIDANCE, checkpoint=CheckpointPolicy('script'),
                    helpers=SCRIPT_HELPERS, compute=SCRIPT_COMPUTE),
    ProfileManifest(V9_CAPABILITY, V9_PROFILE, MODEL, V9_GUIDANCE,
                    checkpoint=CheckpointPolicy('script', verification_sensitive=True, patch_recovery='latest',
                                     repeated_patch_advice=V6_REPEATED_PATCH),
                    helpers=(HelperSpec('named', prominent=True), HelperSpec('script', prominent=True), HelperSpec('text_patch')),
                    compute=SCRIPT_COMPUTE),
    ProfileManifest(V10_CAPABILITY, V10_PROFILE, MODEL, V10_GUIDANCE,
                    checkpoint=CheckpointPolicy('script', verification_sensitive=True, compact=True, patch_recovery='latest',
                                     repeated_patch_advice=V6_REPEATED_PATCH),
                    helpers=COMPACT_HELPERS, compute=COMPACT_COMPUTE, compact_helper_guidance=True),
    ProfileManifest(V11_CAPABILITY, V11_PROFILE, MODEL, V11_GUIDANCE, checkpoint=CheckpointPolicy('script'),
                    helpers=SCRIPT_HELPERS, compute=SCRIPT_COMPUTE),
    ProfileManifest(V12_CAPABILITY, V12_PROFILE, MODEL, V12_GUIDANCE, checkpoint=CheckpointPolicy('script'),
                    helpers=SCRIPT_HELPERS, compute=SCRIPT_COMPUTE),
    ProfileManifest(V13_CAPABILITY, V13_PROFILE, CODER_MODEL, V12_GUIDANCE, checkpoint=CheckpointPolicy('script'),
                    helpers=SCRIPT_HELPERS, compute=SCRIPT_COMPUTE),
    ProfileManifest(V14_CAPABILITY, V14_PROFILE, CODER_MODEL, V12_GUIDANCE, checkpoint=RECOVERY_CHECKPOINT,
                    helpers=COMPACT_HELPERS, compute=SCRIPT_COMPUTE, compact_helper_guidance=True),
    ProfileManifest(V15_CAPABILITY, V15_PROFILE, CODER_MODEL, V15_GUIDANCE, checkpoint=RECOVERY_CHECKPOINT,
                    helpers=COMPACT_HELPERS + (HelperSpec('integer', prominent=True, guidance=False),),
                    compute=SCRIPT_COMPUTE, compact_helper_guidance=True),
)})
PROFILES = MappingProxyType({manifest.capability: manifest.name for manifest in PROFILE_MANIFESTS.values()})
MODELS = MappingProxyType({manifest.capability: manifest.model for manifest in PROFILE_MANIFESTS.values()})
MODELS_BY_PROFILE = MappingProxyType({manifest.name: manifest.model for manifest in PROFILE_MANIFESTS.values()})


def resolve_profile(name: str) -> ProfileManifest:
    """Only registered identifiers can select a reviewed treatment."""
    try:
        return PROFILE_MANIFESTS[name]
    except (KeyError, TypeError):
        raise ValueError('unsupported_local_harness') from None
