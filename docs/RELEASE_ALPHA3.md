# CLI 3.0.0-alpha.3 release

The guided Codex workflow from [#634](https://github.com/mehrdadxzaker/Koto/pull/634)
was merged normally as `deccdd62d9b05943e5a9b75b74df732cf5e6801d`. Its tree matches
the reviewed head. All eight exact-main source checks and all four installation
observations passed on their first attempts. Those installation observations
still used the earlier public alpha.2 pins; they do not qualify alpha.3 delivery.

## Frozen publication artifact

- Package: `@mehrdadz/koto@3.0.0-alpha.3`.
- SHA-256: `3e0686a1578a3df30d65d55a8789715df00c84e2d878ccd8ed3e76251839ee39`.
- SHA-512 integrity: `sha512-SNIv1ANMT0wqOOZyN0JgN0sevLFIw5ax8wW+hl+Faqmaq1V6edj/zE6KSjgIuQ81C7X6m9yKBrblfngkgcZuaQ==`.
- Packed source: `69359551c75dd5114c868cceb16235ef024708c7`, tree
  `5d8882608acb82fe2778254da55fe820618a39be`.

Independent review matched all 54 archive payloads to that source's contents and
permissions. All 51 runtime payloads match the exact merged code and the
[native-qualified candidate](GUIDED_WORKFLOW_VERIFICATION.md). Only the two README
publication copies differ. A fresh offline npm installation matched all 54 and
passed the installed version/help controls. An initial private audit-controller
word-marker mismatch was retained separately; native commands had exited 0 and
the corrected source-matched observation passed in another fresh prefix.

Native npm publication was accepted with exit 0 after native approval. npm first
reported processing: three immediate reads and a later independent version request
could not yet see the version. Those observations are preserved. After processing,
anonymous metadata and archive downloads matched the frozen publication, including
all 54 payloads and permissions. Both `latest` and `alpha` select alpha.3; each
native mutation was performed once, without republishing after delayed visibility.

Homebrew and Linux recipes bind that exact public npm archive and keep the
existing Node pin. Their alpha.3 installation observations and the separate
fresh-host Codex workflow are qualified below.

## Fresh Homebrew guided workflow

Pending the new public recipe: ordinary Koto-only fresh installation, exact
installed payload identity, subscription/current-project discovery, real Codex
coding, guided review and original-branch merge, restart, same-conversation
resume, incremental review and a second original-branch merge. Success will be
recorded here only after the actual installed release completes that journey.

Existing optional skill, UI and IDE delivery pins remain independently frozen.
This CLI release does not imply new native UI/IDE, Linux/Windows coding, live
Claude, model-download or general model-quality acceptance. Earlier local-model
failures stay in their [historical record](CODEX_CLI_VERIFICATION.md).
