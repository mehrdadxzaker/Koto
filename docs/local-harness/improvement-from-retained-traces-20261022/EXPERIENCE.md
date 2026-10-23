# Harness improvement hypothesis

Review required. Candidate quality is unmeasured; coding qualification is unqualified.
This offline analysis ran zero model requests and zero transcript commands.
Archived successes and failures remain observations of their original executions.
No candidate execution or causal improvement is established.

## Recorded execution comparison

Counts below describe archived episodes, including repeated tasks. They are not new coverage.

| Recorded profile/arm | Episodes | Full success | Saved checker passed | Native completion |
| --- | ---: | ---: | ---: | ---: |
| qwen-code.v10 | 18 | 3 | 3 | 4 |
| qwen-code.v8 | 18 | 7 | 10 | 9 |

Native traces without independent outcome records: 2; task quality remains unknown.

## interpreter_unavailable

Recorded observations: 2

Use the declared interpreter or host Python helper for checks. A missing generic python command is an invocation failure; it does not establish that Python is absent. If no declared executable is available, report that concrete environment blocker.

- 7a44ffb976b1f90bcc2018d9d8e6733377339114cfb01434d9729c867c6799bd#/native_events/7
- 7a44ffb976b1f90bcc2018d9d8e6733377339114cfb01434d9729c867c6799bd#/native_events/9

## shell_syntax_failed

Recorded observations: 2

For multiline Python checks, prefer a declared script helper and supply literal newlines in its script argument. When only a shell tool is available, use a script file with the declared interpreter. Inspect the parser error before correcting quoting; do not repeatedly escape the same command.

- d7ad24c75abc111c0f6a7056f030d91a3ab81894890a05c180631d478e6ac805#/native_events/7
- d7ad24c75abc111c0f6a7056f030d91a3ab81894890a05c180631d478e6ac805#/native_events/9

## command_failed

Recorded observations: 10

Resolve the latest failed check invocation before treating it as verification. Read its actual exit status and error; a printed test definition or success message cannot replace successful assertions.

- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/7
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/11
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/22
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/31
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/34
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/35
- 7a44ffb976b1f90bcc2018d9d8e6733377339114cfb01434d9729c867c6799bd#/native_events/7
- 7a44ffb976b1f90bcc2018d9d8e6733377339114cfb01434d9729c867c6799bd#/native_events/9
- d7ad24c75abc111c0f6a7056f030d91a3ab81894890a05c180631d478e6ac805#/native_events/7
- d7ad24c75abc111c0f6a7056f030d91a3ab81894890a05c180631d478e6ac805#/native_events/9

## repeated_command_failed

Recorded observations: 1

After the same command fails twice, stop submitting identical command text. Inspect the concrete error, make a focused correction within the existing host budget, or report the blocker.

- d7ad24c75abc111c0f6a7056f030d91a3ab81894890a05c180631d478e6ac805#/native_events/9

## independent_check_failed

Recorded observations: 23

Before reporting a repair, run the unchanged original checks against the saved implementation after the final edit. Preserve failing requirements and report remaining failures explicitly.

- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/0
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/1
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/2
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/3
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/4
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/5
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/7
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/8
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/13
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/14
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/16
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/17
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/18
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/19
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/20
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/24

## native_completion_missing

Recorded observations: 23

After verification, finish the native turn with a concise report of the saved change, actual check result, and any blocker. Passing saved checks alone does not establish completion of the native episode.

- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/0
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/1
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/2
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/3
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/4
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/5
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/7
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/8
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/11
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/14
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/16
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/17
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/18
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/20
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/22
- 2c95e7b5d3b34c4b9aa42410acac5858572966a313e6b91304c340eb853cb720#/episodes/24
