# GitHub repository identity

The canonical repository is
[`mehrdadxzaker/Koto`](https://github.com/mehrdadxzaker/Koto). Its repository ID
remains `1335333868` after the personal-account transfer and the Koto rename.
Public install commands, support links, plugin metadata and the governance
manifest use this address.

For an existing checkout:

```sh
git remote set-url origin https://github.com/mehrdadxzaker/Koto.git
```

For a fresh checkout:

```sh
git clone https://github.com/mehrdadxzaker/Koto.git koto
```

## Recorded transfer preparation

- Public install, support, issue-template, and vulnerability-reporting links
  use `mehrdadxzaker/Koto`. Portable and Claude plugin metadata name the
  personal owner; local marketplace sources and shared skill paths stay local.
- The two tag-creation rule templates use the specific `User` actor
  `157386627` (`mehrdadxzaker`) rather than `OrganizationAdmin`, which GitHub
  does not support for personal repositories. Their creation restrictions and
  tag patterns are unchanged. Main-branch checks and version-tag immutability
  stay intact. See the [rules REST API](https://docs.github.com/en/rest/repos/rules).
- The former website publication companion patch has been removed. Website
  publication is retired and is not part of the transferred router.

Issue and commit identifiers remain attached to the same GitHub repository.
Hash-bound qualification records keep their original bytes and recorded URLs;
GitHub redirects those URLs to Koto. Attribution and retired release assets
keep their original identity. In particular, a repository rename does not establish
that `ghcr.io/mehrdadxzaker/hormuz` exists. Keep existing
`ghcr.io/xpounder-com/hormuz` image references and digests until package access
has been explicitly checked. GitHub notes that package transfer/link behavior
depends on the registry in its [repository transfer guide](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository).

## Website retirement

The former website publication is retired. Its deployment workflow, source pin,
verification scripts and public ownership file have been removed. The legacy
product redirects, branding, demos and downloads have also been removed from
the shared compatibility host; other projects remain independent.

No public product domain is configured. Hosting under Neuralint will be
configured separately. Historical Git commits remain records of the retired
publication, not instructions to reactivate it.

## Historical transfer checklist

This checklist records the separately approved transfer maintenance window:

1. Confirm the destination name is available, admin access works, and open PRs
   and required checks have a stable head. Schedule a quiet period between
   releases. Pause separately deployed automation that depends on the old owner
   and record its current configuration. Retain Xpounder; do not delete the org.
2. Transfer the public repository, then verify its ID is still `1335333868`.
   Refresh this draft against the transferred main branch, review its exact
   diff, and merge only with passing required checks.
3. Recheck the actual GitHub rules after transfer. Update the two existing
   tag-creation rules with the prepared personal-user templates, preserving
   IDs and the immutable-tag/main protections. In the October 16 audit the
   creation rule IDs were `21746107` (candidate) and `21331448` (version).
   Confirm the owner is still user ID `157386627` before applying anything.
   Checked-in JSON alone does not update live rules.
4. Keep the former website publication retired. Configure any future product
   website independently; do not restore the removed publication patch.
5. Update local clone remotes, installed plugin marketplace sources, and any
   external integrations that bind an owner name. Recheck token grants and
   installation access; retained secrets and webhooks do not prove that their
   external permissions still work. Requalify paused automation before resuming.
   The final October 16 repository-level and environment credential inventory
   is retained in the private cutover audit. Current main contains only
   non-deployment CI and requires none of those credentials. Preserve existing
   credentials without testing their values or restoring retired release
   workflows or Azure automation as part of this transfer.

GitHub Free supports rulesets for this **public** repository. The plan decision
for any private controller belongs to that repository's cutover review; no
upgrade is needed merely to prepare this public change. See
[ruleset availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets).
