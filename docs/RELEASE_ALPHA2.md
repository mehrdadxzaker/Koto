# CLI 3.0.0-alpha.2 release

The CLI fixes from [#631](https://github.com/mehrdadxzaker/Koto/pull/631) were
merged normally as `f4aa6a8c9532a181da3b6e6a8338ad4573bc7513`. Its tree matches
the reviewed PR head, and all eight push-triggered source checks passed on that
exact merge commit. No protection bypass was used.

The npm publication is `@mehrdadz/koto@3.0.0-alpha.2`. Anonymous metadata and
tarball downloads matched the independently reviewed frozen artifact:

- Archive SHA-256: `db2dc6769f0e4a27ed3a4baaee42a03201eb341b10aeccf067d2bac4bdd76afc`.
- Archive SHA-512 integrity: `sha512-nUb6hNMT4BchyQtkthnNR+3rGEnhYrs8oYbr/hEn818iEqCdjBknaLpWyqSTZxE07Ehj4z8CbX2BW2+3xtI7Qg==`.
- Packed source: `0a55d9e06806bd27412f52ee88bdfb603cf56a41`, tree
  `68559f52a67ec8547b1228335bd6b4b799627dbf`.

All 54 published payloads match that source commit's bytes and modes. All 51
runtime payloads match both the exact merged code and the
[native-qualified candidate](CODEX_CLI_VERIFICATION.md). Only the English and
Persian READMEs changed for publication, removing mutable development/tag-status
wording. The archive remains frozen as subsequent recipe and evidence updates
are merged.

Homebrew, the Linux installer and their real installation observers pin this
same npm URL and hash. Node stays at the existing managed runtime pin and
Homebrew `node@24` dependency. IDE preview 0.1.0 and the optional agent skill
remain on their independently frozen alpha.1 core; this CLI release does not
claim a new native verification of those delivery surfaces.

Fresh Homebrew package installation and the subscription-discovery, coding,
review/integration and same-conversation Codex continuation are the next release
qualification step. Success will be recorded here only after that actual run.

The prior candidate observations and failures remain in the
[CLI verification record](CODEX_CLI_VERIFICATION.md), including the bounded 4B
local factual-recall failure. Registry publication, source CI and distribution
observations do not establish general coding quality, new live Claude coverage,
or native Linux/Windows coding qualification.
