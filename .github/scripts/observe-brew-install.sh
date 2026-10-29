#!/usr/bin/env bash
# Actual package qualification on a disposable macOS runner, never a user's prefix.
set -euo pipefail
umask 077
koto_observe_root="$RUNNER_TEMP/koto-brew-observation"
export HOMEBREW_CURLRC="$RUNNER_TEMP/koto-brew-curlrc"
mkdir -m 700 "$koto_observe_root"
koto_formula=mehrdadxzaker/koto/koto
koto_tap_owned=0
koto_package_owned=0
printf 'connect-timeout = 10\nmax-time = 120\nretry = 0\n' > "$HOMEBREW_CURLRC"
cleanup() {
  koto_status=$?
  trap - EXIT INT TERM
  if [ "$koto_status" -ne 0 ] && [ -f "$koto_observe_root/payload-diff.txt" ]; then
    head -c 16384 "$koto_observe_root/payload-diff.txt" >&2
  fi
  if [ "$koto_package_owned" = 1 ]; then brew uninstall --force "$koto_formula" || koto_status=1; fi
  if [ "$koto_tap_owned" = 1 ]; then brew untap mehrdadxzaker/koto || koto_status=1; fi
  printf 'exitCode=%s\n' "$koto_status" > "$koto_observe_root/exit.txt"
  exit "$koto_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if brew list --formula koto >/dev/null 2>&1; then
  printf '%s\n' 'A fresh runner without an existing Koto formula is required.' >&2
  exit 1
fi
if brew tap | grep -Fxq mehrdadxzaker/koto; then
  printf '%s\n' 'Refusing to replace a pre-existing tap.' >&2
  exit 1
fi
git status --porcelain > "$koto_observe_root/project-before.txt"
[ ! -s "$koto_observe_root/project-before.txt" ]
git rev-parse HEAD > "$koto_observe_root/project-head.txt"
if [ "${KOTO_PUBLIC_TAP:-0}" = 1 ]; then
  brew tap mehrdadxzaker/koto https://github.com/mehrdadxzaker/Koto.git
else
  git clone --no-hardlinks "$GITHUB_WORKSPACE" "$koto_observe_root/tap-source"
  git -C "$koto_observe_root/tap-source" switch -c qualification-tap
  brew tap mehrdadxzaker/koto "file://$koto_observe_root/tap-source"
fi
koto_tap_owned=1
cmp "$GITHUB_WORKSPACE/Formula/koto.rb" "$(brew --repository mehrdadxzaker/koto)/Formula/koto.rb"
koto_package_owned=1
brew install "$koto_formula"
koto_keg=$(brew --prefix "$koto_formula")
koto_node="$(brew --prefix node@24)/bin/node"
koto_command="$koto_keg/bin/koto"
"$koto_command" --version | tee "$koto_observe_root/version.txt"
[ "$(cat "$koto_observe_root/version.txt")" = 3.0.0-alpha.0 ]
"$koto_command" --help > "$koto_observe_root/help.txt"
brew test "$koto_formula"
curl --disable --fail --silent --show-error --location --max-redirs 3 --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 60 --retry 0 --max-filesize 1048576 \
  --output "$koto_observe_root/package.tgz" https://registry.npmjs.org/@mehrdadz/koto/-/koto-3.0.0-alpha.0.tgz
printf '%s  %s\n' f0ca6be082af7a95b75a753557db2fc9a7468fa4ac49f75eee236ce9f8d96dfe "$koto_observe_root/package.tgz" | shasum -a 256 --check
mkdir "$koto_observe_root/reference"
tar -xzf "$koto_observe_root/package.tgz" -C "$koto_observe_root/reference"
diff --recursive --brief "$koto_observe_root/reference/package" "$koto_keg/libexec" > "$koto_observe_root/payload-diff.txt"
"$koto_node" --input-type=module - "$GITHUB_WORKSPACE" "$koto_observe_root" "$koto_keg/libexec" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const [project, root, installed] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(path.join(installed,'package.json'),'utf8'));
if (pkg.name !== '@mehrdadz/koto' || pkg.version !== '3.0.0-alpha.0') throw new Error('Wrong installed package');
if (!process.version.startsWith('v24.')) throw new Error('Wrong Homebrew Node dependency');
const tasks = {schemaVersion:1, project, goal:'Inspect the real Koto entrypoint using its installed runtime.',
  controlRoot:path.join(root,'control'),timeoutMs:30000,maxConcurrency:1,
  agents:[{id:'syntax',runtime:'command',command:'$node',args:['--check','bin/koto.js'],
    task:'Inspect the entrypoint without changing the project.',owns:['bin/koto.js'],
    timeoutMs:15000,transport:'pipe',inputMode:'closed',dependsOn:[]}]};
fs.writeFileSync(path.join(root,'tasks.json'),JSON.stringify(tasks),{flag:'wx',mode:0o600});
fs.writeFileSync(path.join(root,'runtime.json'),JSON.stringify({platform:process.platform,arch:process.arch,
  node:process.version,nodeExecutable:process.execPath,cli:pkg.version}),{flag:'wx',mode:0o600});
NODE
"$koto_command" plan build "$koto_observe_root/tasks.json" "$koto_observe_root/plan.json"
"$koto_command" plan check "$koto_observe_root/plan.json" | tee "$koto_observe_root/preflight.json"
printf 'preserve app state\n' > "$koto_observe_root/state.keep"
brew uninstall "$koto_formula"
koto_package_owned=0
[ ! -e "$koto_command" ]
[ "$(cat "$koto_observe_root/state.keep")" = 'preserve app state' ]
git status --porcelain > "$koto_observe_root/project-after.txt"
cmp "$koto_observe_root/project-before.txt" "$koto_observe_root/project-after.txt"
printf 'Homebrew fresh install, frozen payload comparison, real project preflight and uninstall passed.\n' >> "$GITHUB_STEP_SUMMARY"
cat "$koto_observe_root/runtime.json" >> "$GITHUB_STEP_SUMMARY"
