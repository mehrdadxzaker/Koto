# Koto rebrand

The product, plugin, skills, CLI help and documentation now use **Koto** and
the supplied [wooden K logo](../assets/koto-logo.png). The plugin is named
`koto`; install it as `koto@koto` from the
[Koto repository](https://github.com/mehrdadxzaker/Koto).
The Python distribution is `koto-router`, installed from this source checkout.

```sh
python -m pip install .
koto --version
python -m koto --help
```

New configurations use `koto.json` or `KOTO_CONFIG`. `KOTO_HISTORY_HOME`
overrides the local history directory. New default history directories use
`Koto` on macOS and `koto` in the XDG data directory.

## GitHub repository

The canonical repository is `mehrdadxzaker/Koto`. Install commands, plugin
metadata, support forms and documentation links use that address. The repository
keeps its existing issues, pull requests, commits and protection rules.

Update an existing checkout's remote with:

```sh
git remote set-url origin https://github.com/mehrdadxzaker/Koto.git
```

The plugin and marketplace identity remains `koto@koto`. See
[agent installation](AGENT_INSTALLATION.md) for each client's commands.
Hash-bound qualification records retain their original bytes and recorded
addresses; GitHub redirects those addresses to the renamed repository.

## Existing installations

Use a fresh virtual environment for the source-install example. To reuse an
environment that already contains the former Python distribution, disconnect
its active client through the old CLI first and confirm settings are restored.
Then, with that environment's Python interpreter:

```sh
python -m pip uninstall hormuz
python -m pip install /path/to/reviewed-koto-checkout
python -m koto --help
```

Remove the former distribution **before** installing `koto-router` into that
same environment. Both distributions contain the established runtime namespace;
otherwise a later uninstall of the former package can remove shared files.
Uninstalling the distribution does not delete the separate configuration or
history directories. If both distributions are already installed, disconnect,
remove the former package, and reinstall the reviewed Koto checkout before use.

The legacy `hormuz` executable and `python -m hormuz` remain aliases for the
same implementation. `HORMUZ_CONFIG` and `HORMUZ_HISTORY_HOME` remain accepted;
their Koto equivalents take precedence. When no path is specified, an existing
`hormuz.json` is used if `koto.json` is absent.

Existing encrypted history is read in place if that configuration has no
history profile in the new default directory. Its encryption context is
preserved, so consent, keys and records
remain usable. Both old and new provider display names are accepted in owned
connection journals; disconnect continues to restore the original settings.

The internal `hormuz` Python namespace, wire schema identifiers, HTTP headers,
redaction marker, connection generation keys and socket paths retain their
established values. These identifiers are compatibility contracts. Renaming
them would require a separate data and protocol migration. Existing records,
audit evidence, qualification receipts and third-party notices retain their
original identity where that identity is part of the recorded evidence.

## Hosting

No product domain is configured or claimed. Hosting under `neuralint.io` will
be supplied later by the owner. The former website publication and its
active deployment code have been retired. Legacy product redirects and public
assets have been removed from the shared compatibility host. Historical commits
and retired application releases remain records of the earlier product.
