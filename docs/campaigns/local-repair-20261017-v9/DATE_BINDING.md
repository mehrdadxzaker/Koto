# V9 native environment date binding

The owner's October 18 approval is valid. The first native launch was rejected
before inference because the operator's probe plan still bound the October 17
date in the captured **user environment message**. Its native exit was 1 after
539 ms, with no tools, no edit, independent checker 1, and **zero submitted
model requests or provider attempts**. The router correctly failed closed.
The unchanged instruction/tool profile excludes this user metadata. The only
semantic input difference is the date; this is not evidence about the model.

The original sealed runner, inputs, authorization record, stage marker and
rejected episode are retained. Public copies are under
[rejected-before-inference](rejected-before-inference/dev-clamp/result.json).
No old frozen file is rewritten or failure relabelled as a pass.

The [date-bound runner](date-bound-runner.py) adds an operator-side correction
before arming each probe. It copies the frozen first input, substitutes the
current America/Chicago date in exactly one recognized native **user**
environment message, and hashes the resulting exact input. It rejects missing,
ambiguous or unrecognized date/timezone context and refuses to arm within 120
seconds of midnight for a 90-second episode. No native request, model output,
tool argument, instruction, permission or router response is rewritten.
The router still requires the exact armed input and frozen instruction/tool
profile. The date is bound anew for each case, not ignored by admission.

[Native controls](../../diagnostics/native-tool-compat-20261017/date-controls.json)
at connect → real router request → result/status → disconnect establish:

- The stale-date control is denied before external fixture dispatch.
- Date-only binding permits the supplied tool call, real edit and independent
  checker pass with normal native completion.
- Altered permissions or tool definitions still fail before fixture dispatch.

All controls use a deterministic external runtime and **zero model inference**.
They establish the correction and enforcement, not model quality.

The corrected checkpoint retains the exact original v9 coding plan, subject,
model/runtime/native pins, instructions, tools, private paths, 16 task/check
hashes, independent inspection gates and 8-request/90-second/512-output-token
bounds. The model has not seen any v9 case. This fixes admission metadata before
the one owner-authorized model canary; it grants no quality or provider retry.
Artifacts and one-shot stage markers are isolated under the owned
`date-binding-checkpoint`, while tool permissions and live settings stay fixed.
The new manifest seals both the original inputs and correction before inference.

Only a passing inspected model canary permits the other 3 development and 12
fresh v9 held-out cases. Every outcome is retained, with no tuning, dropping or
retrying cases. Ordinary coding remains unqualified and no live activation is
authorized. This checkpoint does not amend the product admission contract.
