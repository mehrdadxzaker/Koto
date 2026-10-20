# Qwen v1 versus v2 comparison — October 20, 2026

**V1: 5/6 successful repairs. V2: 5/6. No aggregate coding-quality improvement was observed.** V2 repaired stock rollback; its unique-record edit never applied. Neither arm executed model-authored assertions, so passing independent checks does not establish compliance with the verification guidance.

| Case | V1 | V2 | V1 time | V2 time |
| --- | --- | --- | --- | --- |
| signed-ceiling | Pass | Pass | 44.9 s | 56.2 s |
| literal-first | Pass | Pass | 39.4 s | 31.9 s |
| adjacent-groups | Pass | Pass | 37.4 s | 36.6 s |
| interval-union | Pass | Pass | 64.7 s | 52.8 s |
| atomic-stock | Fail | Pass | 34.2 s | 65.4 s |
| stable-key-unique | Pass | Fail | 55.3 s | 180.0 s |

## Failures and actual verification

V1 stock validated and deducted each request immediately. It rejected a later repeated-item overdraw, but left the earlier deduction applied; the unchanged checker failed its rollback-state assertion. V2 used temporary stock to validate before mutating the original and passed the complete checker.

V2 unique-records repeatedly supplied a unified-diff range header, `@@ -1,3 +1,15 @@`, to the native patch tool. Seven context rejections were retained. The stream ended at the 180-second probe deadline with client exit 1, no saved edit and no `turn.completed`. The original `return records[:]` implementation remained and failed deduplication; this was not the earlier set/hashability failure.

An independent sandbox replay matched **all twelve recorded checker exit codes**: ten passes and two failures. Eleven episodes saved native edits and completed normally. V2's five successful episodes ran only a source read and a native edit before their final responses. V1 uniqueness additionally attempted a happy-path print using unavailable `python`, then `which python`; both commands failed. Neither arm earns authored-verification credit.

The independent rollback reproducer rejects V1 stock and accepts V2 stock. The original single-record list-key reproducer accepts both unique-record outputs, including V2's unchanged fixture: it catches prior hashability failures but does not check deduplication. The complete frozen oracle supplies that missing distinction. [Pilot B's successful authored assertions](v2-development-diagnosis-20261020.md) remain separate development evidence.

## Controls and limits

Both arms used the same six specifications, initial sources and independent checks, stock Codex 0.160.0, llama.cpp b11617 and installed Qwen3-14B-Q4_K_M. Raw native instruction/tool profiles matched for every pair. All four physical asset hashes and 154 frozen source/runtime artifacts were independently verified. Codex owned execution and tools.

Both arms received **180 seconds**, 16 requests and 2,048 output tokens per request through explicit development probe v5. Execution was serial, with one frozen generation per case/arm and no quality retries. These known tasks informed the retained pilots and prompt changes before this freeze. Results must not be pooled with earlier 90-second studies or used to satisfy their qualification criteria. This small comparison establishes neither general superiority nor a latency advantage.

All three connection lifetimes reported restored disposable settings and closed owned listeners. Disposable settings were independently read back; normal settings remained unchanged according to the runner receipt. Automatic coding stayed disabled.

See the [complete comparison](v2-comparison-20261020/comparison.json), [frozen plan](v2-comparison-20261020/frozen-plan.json), [published-file manifest](v2-comparison-20261020/manifest.json) and [independent audit](v2-comparison-20261020/independent-audit.json).
