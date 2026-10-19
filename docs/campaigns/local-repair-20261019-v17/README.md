# V17 offline campaign preparation

This candidate has sixteen fresh authored tasks and task-independent developer
guidance aimed at V16's repeated tools and explicit contract failures. It has
made **zero model requests**. The execution subject and native request profiles
are not frozen. No model is newly qualified and automatic local coding stays off.

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
The next operator step is review and complete preregistration of the actual
installed wheel, native profile and exact assets, followed by one bounded
development canary. Do not infer an outcome from this preparation.
