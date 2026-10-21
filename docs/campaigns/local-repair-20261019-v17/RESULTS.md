# V17 revision 2: real Codex canary failed to finish

The canary made a correct implementation edit and completed the unchanged
independent assertions, but failed the declared normal-completion gate. No
coding qualification receipt was created. Automatic local coding and personal
selection activation remain disabled. The other fifteen quality cases were not
run, including all twelve held-outs. No additional treatment or retry followed.

| Observation | Result |
| --- | --- |
| Real Codex edit | Correct safe patch; baseline assertion exit 1, independent final exit 0 |
| Native task completion | Failed: exit 1, zero completed turns |
| Request limit | Eight forwarded generations and eight successful native commands |
| Behavior after first check | First successful imported check at request 4; four more commands created and ran extra tests |
| Final failure | Next request refused by relay's eight-request cap; error and turn.failed describe one failure |
| Native elapsed time | 35.423 seconds against a 90-second budget |
| Completed output bound | Largest observed generation 348 tokens against 512 |
| Continuation evidence | Seven continuations preserved one work and destination |
| Ordinary local-only denial | Passed; zero model submissions and zero new provider history |
| Separate cancellation | Passed; one submission retained as unknown, no fabricated final turn |
| Cleanup | Owned settings restored, live settings unchanged, listeners closed for every scenario |

The eight succeeded provider-history rows describe completed generations. They
do not mean the coding task finished. All eight streamed function responses
contained complete valid arguments. Independent inspection of the
[patch](canary.patch), frozen checker and preserved commands found no assertion
or receipt interference. This is one negative model-completion observation,
not a held-out quality estimate or proof that the full campaign would pass.

[RESULTS.json](RESULTS.json) records hashes and counts. Registration commit
`6051c0f4` preceded inference; [FREEZE-revision2.json](FREEZE-revision2.json) binds
the exact subject and [coding-plan-revision2.json](coding-plan-revision2.json).
The runtime payload is reviewed #577 head `ad895925`, before independently merged
#579. These observations do not qualify a later main tip. The first frozen
pre-dispatch failure and all preparation failures remain separately retained.
The owner-only local archive contains raw requests, native observations, project
snapshots, independent check results, wheel and operator sources. Credentials,
live settings, the history database and model weights are excluded.

All 606 V15 and 1,037 V16 historical archive files retain their original hashes.
Both V17 freezes and every indexed new artifact verify. No owned runtime process
remains. The primary checkout was never edited by this task.

The personal-selection regressions verify abstention, checked held-out outcomes
and observation-only behavior with authored fixtures. A real commercial/local
comparison is still blocked: the existing ChatGPT subscription connection is
not implemented in this repository. No commercial API alternative was authorized
or used, and no measured commercial quality or latency benefit is claimed.
