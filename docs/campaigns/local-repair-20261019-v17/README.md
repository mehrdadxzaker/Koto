# V17 frozen Codex acceptance campaign

The first frozen native launch was rejected before model dispatch because its
permission context named a random helper directory. It submitted zero model
requests and made no edit; the [failed observation](preparation-attempts/05-frozen-arg0-binding-denial.json)
and original [FREEZE.json](FREEZE.json) remain unchanged.

[FREEZE-revision2.json](FREEZE-revision2.json) separately registers the corrected
operator, read-only helper parent, forty-nine zero-inference native captures and
[coding-plan-revision2.json](coding-plan-revision2.json). The repeated first input
and all sixteen native profiles match. Task, checker, guidance and model bytes
remain unchanged and unseen by the model. Owned settings/listeners restored and
live settings fingerprints verified. No model is newly qualified; automatic
local coding and learning stay off. This pins the reviewed #577 payload, before
the independently merged #579; it is not qualification of a later main tip.

[PLAN.md](PLAN.md) specifies the unchanged acceptance gates and proposed
treatment. [corpus.json](corpus.json) indexes four development and twelve held-out
cases, with one development and three held-outs in each required family. Each
`cases/<id>.json` has the acceptance driver's `id`, `partition`, `family`,
`prompt`, `initial_solution`, `checker` and optional `reference_solution` fields.
The reference is an offline preparation control and must remain outside the
native client's permitted project, alongside the independent checker.
The shared `client-instructions.txt` is byte-for-byte V16 text; use it with the
driver's `--client-instructions` option and the new `developer-instructions.txt`
as `--instructions`. Both must be bound by the actual native profile before run.

Every initial implementation fails a checker assertion with exit 1. Every
authored reference completes the same unchanged assertions with exit zero.
These are fixture tests, not observations of Codex or model success. The
preparation mistakes and corrected controls are retained separately.
The [v2 preparation controls](preparation-controls-v2.json) include five
checker sensitivity improvements from review; deliberately incorrect variants
that passed the earlier checks now fail. Earlier controls remain unchanged.
The final [v3 controls](preparation-controls-v3.json) also cover two replacements
made after discovering concurrent independently owned campaigns with overlapping
goals. The withdrawn unfrozen cases remain in `preparation-attempts/04-concurrent-corpus-inventory/`.

Recheck fixtures without any model, router, network, credentials or settings:

```sh
python3 docs/campaigns/local-repair-20261019-v17/verify-preparation.py \
  --output /private/tmp/koto-v17-preparation-new.json
```

The output path must not exist. This preserves each control run and refuses
replacement. [held-out-freshness-v2.json](held-out-freshness-v2.json) records
exact-hash and semantic comparison with nineteen retained corpora, including
V15's local archive and all currently present `koto-local-coding-20261019*`
campaigns. The earlier freshness report remains historical preparation evidence.
The next operator step is one bounded development canary under revision 2.
The remaining fifteen run only if that canary passes. Preparation is not a
model-quality observation. The revision-2 freshness addendum records V14/V15
from the independently owned campaign with no semantic contract overlap.
