# Real edit/check succeeded; v8 qualification trial failed

One authorized native episode ran on the sealed, reviewed setup. **Codex
executed four commands, changed `solution.py`, and passed the unchanged
independent checker.** The baseline checker exited 1; after the real edit it
exited 0 with all assertions completed. The implementation contains only the
requested clamp correction, with no imports, oracle access or harness interference.

The campaign **did not pass** `local-repair.v1`: it exhausted all eight local
submissions and exited 1 after 44,701 ms, before normal native completion.
The ninth request was rejected by the recorder's fixed request cap without
reaching the model. No quality retry or held-out episode ran. The remaining
battery is blocked, automatic coding remains disabled, and no qualifying receipt
was installed. The frozen exit-zero requirement has not been weakened.

## What the trace establishes

All eight engine responses emitted structured `exec_command` calls. The first
seven calls' names/arguments appear unchanged in the next native continuation.
Codex executed file reads, the successful rewrite, and a test-file write. The
router retained local destination/work affinity throughout. This proves that
this model/engine/native combination can execute tools and make a correct edit;
it does not make the old Qwen2.5 failure uniquely attributable to its weights.

Three calls supplied unified-diff line numbers to Codex's context-based patch
helper, which correctly rejected them as unmatched literal context. A later
heredoc could not create its zsh temporary file under the experimental permission
profile. A plain write then made the correct repair. These are distinct model
argument-format and harness environment failures; no router tool-call loss was
observed. Raw public engine SSE, native events, implementation/patch and checker
receipts are retained under [native-episodes/dev-clamp](native-episodes/dev-clamp/result.json),
with [per-submission analysis](native-analysis.json).

The original checkpoint was local commit
`2cb645fcb13637ab7042a5033aa1c6290b1bac4f`, manifest
`98641727d237002f55df66c4be696104d93f0c35522b2966c11c6229e4a36dac`.
GitHub export was initially rejected by automatic approval review and was not
bypassed. The owner later explicitly authorized publication. The unchanged
local preregistration records that ordering; publication is not presented as an
external timestamp preceding this native episode.

Both owned listeners closed and private settings restored. The owner's live
Codex settings remained unchanged. All prior failed evidence is preserved.

## Prepared correction; separate authorization required

The [supplied-call controls](../../diagnostics/native-tool-compat-20261017/shell-controls.json)
reproduce the heredoc denial and patch-hunk error without model inference.
Setting the client's tool environment `TMPDIR` and zsh `TMPPREFIX` to the already
permitted private temp directory makes the same heredoc edit/check pass.
Changing only a supplied patch's hunk to a bare `@@` produces a native
`file_change` and checker pass. The diagnostic originally counted commands only;
that overly narrow counter was corrected to recognize the actual file tool.
Neither supplied control is model-quality evidence.

Version 9 is a separately prepared treatment with that tool environment and a
generic patch-grammar example, the same model/runtime/generation limits, and
twelve newly authored held-out tasks. It has **zero model episodes** and requires
new owner authorization for its canary. V8 remains failed.
