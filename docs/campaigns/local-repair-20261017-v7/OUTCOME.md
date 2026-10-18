# Retained v7 development outcome

The one authorized Qwen2.5-Coder-7B-Instruct repair **failed**. The native client
completed one turn, exit zero, in 17,775 ms after one local model submission.
The implementation remained unchanged and the independent checker returned
assertion exit 1 before and after. Its hash is unchanged; the retained patch is
empty. This is zero passing observations from one development case, with
fifteen cases missing, including all twelve fresh held-out cases.

The [native events](development-native.jsonl) contain a completed assistant
text message with a proposed `exec_command` call inside a JSON code fence.
No executed shell-command event appears. The text promised to read and edit
the file; it did not establish an executed tool call or an actual repair.
The [public result](development-result.json) records one successful transport
attempt, zero retries, zero failovers and zero failed or unknown transport
attempts. A successful response and normal client exit do not satisfy the
coding acceptance criteria. No tool continuation was exercised in this episode.

This observation does not isolate general model ability from native tool/chat
profile compatibility. It is not a statistical failure-rate estimate, nor
evidence that a larger output cap would fix the problem. No additional model
episode, changed guidance, alternate model or held-out probe was run after
seeing this result. A future changed treatment needs a new version and its own
finite authorization, while retaining this failure.

## Preregistration and preserved controls

The [preregistration commit](https://github.com/mehrdadxzaker/hormuz/commit/1adb8fe9279e7d082fd8bf784837659146bad0f3)
and [issue checkpoint](https://github.com/mehrdadxzaker/hormuz/issues/566#issuecomment-6243927931)
preceded inference. The frozen manifest SHA-256 remains
`aaf157a64c0fa6649cfdf4fa00993262857e9f098f9aaec56dac08efe065b774`;
the plan SHA-256 remains
`647d0c2865565735e3ba4271c9c940ad243450e441ee88b7c6e3eefccf9470ac`.
All 164 bound artifacts still match their original sizes and hashes. The
runtime remains the same 136 files from source
`4e63d49389922df4079fe22c49d57f191756b910`, rather than a claim that the newer
main runtime was used in this model comparison. Prior campaigns remain intact.

Ordinary unqualified coding was denied with HTTP 503 before probe authorization
and before any model attempt. Public mode remained `local_only`; the one work
used the pinned Qwen2.5-Coder alias and local destination. Coding readiness stayed
`unknown`, automatic coding tasks stayed empty and no coding receipt was
installed. The post-response engine-health snapshot was `stale`; this is
retained separately from successful model transport and coding readiness.
No native continuation-affinity claim follows from a one-submission episode.
The eight independent controlled probe workflow checks remain separate evidence.

Permission was revoked, private client settings were restored and both owned
listeners closed. The [live settings fingerprint](live-codex-settings-after.json)
matches its pre-trial value; no live-settings restoration was attempted or
needed. The consumed-run guard rejects a second invocation before setup or
inference, with unchanged episode artifacts. The
[post-run audit](post-run-audit.json) retains these checks. No production source,
admission rule, default profile, plugin installation or user configuration was
changed. The candidate remains experimental and unqualified.
