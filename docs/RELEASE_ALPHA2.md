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

## Published distribution and fresh Homebrew journey

The distribution update was merged normally in
[#632](https://github.com/mehrdadxzaker/Koto/pull/632) as
`019d535fed875c0debe0be5179b04bd3eb5e3c40`, with the reviewed tree unchanged.
All eight exact-main [source checks](https://github.com/mehrdadxzaker/Koto/actions/runs/40989510627)
and all four [installation observations](https://github.com/mehrdadxzaker/Koto/actions/runs/40989510622)
passed on their first attempts. The installation observations cover macOS ARM64,
macOS Intel, Linux x64 and Linux ARM64; they do not claim native Codex coding on
all four hosts. Anonymous npm reads confirmed both `alpha` and `latest` select
`3.0.0-alpha.2` after one accepted tag update. Three immediate packument reads
were stale; a later read confirmed propagation without repeating the write.

The actual host journey was observed on October 29, 2026, macOS ARM64, with
Homebrew's Node 24.22.2 and the published package above:

1. Back up the existing Koto keg, fast-forward only the clean public tap to the
   merged recipe, uninstall Koto ordinarily, and install it into an absent keg
   from a new private download cache. No dependency cleanup or forced removal.
2. Compare every installed payload's contents and POSIX permissions with all 54
   frozen npm payloads, then run the installed version and help commands.
3. Open the installed `koto` with empty private Koto state and the real native
   account home. Automatically discover the existing ChatGPT login, select it,
   decline optional local downloads, and choose a clean clone of the real Koto
   project at packed source `0a55d9e06806bd27412f52ee88bdfb603cf56a41`.
   No API key was supplied and no authentication file was copied.
4. Review a one-worker plan owning only `bin/koto.js`, then explicitly launch
   Codex. It adds `-V` to the existing version-alias array. Review the one-line
   contribution, explicitly integrate it, and manually run all three version
   flags in the integration workspace.
5. Quit ordinarily and reopen the installed CLI. The saved account and project
   return directly. `/sessions` finds the integrated build; `/review versionAlias`
   initially shows no remaining delta. Use `/resume versionAlias`, inspect the
   continuation and type `start`.
6. In the same captured native conversation and worktree, Codex updates only
   the help line to list all three aliases. Review shows exactly that new line,
   excluding the prior integration. Explicitly integrate it and manually verify
   the help and all three version flags again, then quit ordinarily.

Both coding turns succeeded. The native conversation ID, worktree, origin
fingerprint, executable, native kind and account were identical across restart.
Only `bin/koto.js` changed in the reviewed integration; the original project,
worker and integration workspaces were clean afterward. These verification
contributions stay in the private project clone, separate from the published
CLI's implementation. Both Koto runs exited 0 without forced cleanup. Known
owned process absence is independently checked after quit. The original default
Koto state and both existing Node kegs were preserved.

The first private installation controller incorrectly passed its evidence
`umask 077` to Homebrew. All 54 contents matched, but installed permissions were
restricted, so the strict payload check failed. That result is retained. A
separate ordinary fresh uninstall/install gave Homebrew its standard `umask 022`
and passed the unchanged, strict 54-file content-and-permission check; no installed
payload was manually repaired and no npm archive was changed. Native command
activity also retained an initial search with no matches; the coding turn
continued and produced the reviewed change. These are recorded separately from
successful final behavior.

Private transcripts retain the actual prompts, review diffs, integration
receipts, two native attempts, identity comparisons and process cleanup. Native
IDs, account credentials and machine-specific session paths are not published.

The prior candidate observations and failures remain in the
[CLI verification record](CODEX_CLI_VERIFICATION.md), including the bounded 4B
local factual-recall failure. Registry publication, source CI and distribution
observations do not establish general coding quality, new live Claude coverage,
or native Linux/Windows coding qualification.
