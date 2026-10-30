#!/usr/bin/env bash
# A bounded observation of the real installer and published CLI on a real Git project.
# Run only on a disposable Linux qualification host; no models or native accounts.
set -euo pipefail
umask 077
if [ "$#" -ne 3 ]; then
  printf '%s\n' 'usage: observe-linux.sh ABS_INSTALLER ABS_REAL_GIT_PROJECT ABS_NEW_EVIDENCE_DIR' >&2
  exit 2
fi
koto_observe_installer=$1
koto_observe_project=$2
koto_observe_root=$3
case "$koto_observe_installer:$koto_observe_project:$koto_observe_root" in
  /*:/*:/*) ;;
  *) printf '%s\n' 'All observation paths must be absolute.' >&2; exit 2 ;;
esac
[ "$(uname -s)" = Linux ]
[ -f "$koto_observe_installer" ]
[ -d "$koto_observe_project/.git" ] || [ -f "$koto_observe_project/.git" ]
[ ! -e "$koto_observe_root" ]
mkdir -m 700 "$koto_observe_root"
koto_observe_prefix="$koto_observe_root/managed install"
koto_observe_bin="$koto_observe_root/entry bin"
koto_observe_cli="$koto_observe_bin/koto"
koto_observe_node="$koto_observe_prefix/current/node/bin/node"
koto_observe_package="$koto_observe_prefix/current/package"
koto_observe_state="$koto_observe_root/app-state"
koto_observe_home_sentinel=
koto_observe_finished=false
cleanup() {
  koto_observe_status=$?
  if [ -n "$koto_observe_home_sentinel" ] && [ -f "$koto_observe_home_sentinel" ] && [ ! -L "$koto_observe_home_sentinel" ]; then
    rm -- "$koto_observe_home_sentinel"
  fi
  printf 'exitCode=%s\ncompleted=%s\n' "$koto_observe_status" "$koto_observe_finished" > "$koto_observe_root/observation-exit.txt"
  exit "$koto_observe_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
git -C "$koto_observe_project" rev-parse HEAD > "$koto_observe_root/project-head.txt"
git -C "$koto_observe_project" status --porcelain=v1 > "$koto_observe_root/project-before.txt"
[ ! -s "$koto_observe_root/project-before.txt" ]
sha256sum "$koto_observe_installer" > "$koto_observe_root/installer-sha256.txt"
uname -a > "$koto_observe_root/kernel.txt"
mkdir -m 700 "$koto_observe_state"
printf 'preserve application state\n' > "$koto_observe_state/keep"
printf 'preserve outside installation\n' > "$koto_observe_root/outside.keep"
# The disposable runner's real default app-state directory is preserved too.
mkdir -p "$HOME/.koto"
koto_observe_home_sentinel=$(mktemp "$HOME/.koto/koto-install-observation.XXXXXX")
printf 'preserve default application state\n' > "$koto_observe_home_sentinel"
sha256sum "$koto_observe_state/keep" "$koto_observe_root/outside.keep" "$koto_observe_home_sentinel" > "$koto_observe_root/preservation-before.sha256"
timeout --signal=TERM --kill-after=15s 360s sh "$koto_observe_installer" \
  --prefix "$koto_observe_prefix" --bin-dir "$koto_observe_bin" \
  > "$koto_observe_root/install.stdout" 2> "$koto_observe_root/install.stderr"
[ -x "$koto_observe_cli" ]
[ -x "$koto_observe_node" ]
[ -f "$koto_observe_package/package.json" ]
timeout --signal=TERM --kill-after=10s 30s "$koto_observe_cli" --version > "$koto_observe_root/version.txt"
[ "$(cat "$koto_observe_root/version.txt")" = 3.0.0-alpha.3 ]
timeout --signal=TERM --kill-after=10s 30s "$koto_observe_cli" --help > "$koto_observe_root/help.txt"
timeout --signal=TERM --kill-after=10s 30s "$koto_observe_node" --version > "$koto_observe_root/node-version.txt"
[ "$(cat "$koto_observe_root/node-version.txt")" = v24.22.2 ]
# Compare every installed CLI payload with the immutable published archive.
timeout --signal=TERM --kill-after=10s 100s curl --fail --silent --show-error \
  --proto '=https' --tlsv1.2 --location --max-redirs 3 --connect-timeout 10 \
  --max-time 60 --retry 0 --max-filesize 1048576 \
  --output "$koto_observe_root/published-cli.tgz" \
  https://registry.npmjs.org/@mehrdadz/koto/-/koto-3.0.0-alpha.3.tgz
printf '%s  %s\n' 3e0686a1578a3df30d65d55a8789715df00c84e2d878ccd8ed3e76251839ee39 "$koto_observe_root/published-cli.tgz" \
  | sha256sum --check > "$koto_observe_root/archive-checksum.txt"
mkdir -m 700 "$koto_observe_root/reference"
tar -xzf "$koto_observe_root/published-cli.tgz" --no-same-owner --no-same-permissions -C "$koto_observe_root/reference"
diff --recursive --brief "$koto_observe_root/reference/package" "$koto_observe_package" > "$koto_observe_root/payload-diff.txt"
timeout --signal=TERM --kill-after=10s 30s "$koto_observe_node" --input-type=module - \
  "$koto_observe_project" "$koto_observe_root" "$koto_observe_package" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [project, root, installed] = process.argv.slice(2);
const files = [];
function visit(directory, prefix = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(filename, relative);
    else if (entry.isFile()) files.push({path:relative, bytes:fs.statSync(filename).size,
      sha256:crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')});
    else throw new Error('Unexpected installed CLI file type: ' + relative);
  }
}
visit(installed);
if (files.length !== 54) throw new Error('Expected exactly 54 published CLI payloads.');
const pkg = JSON.parse(fs.readFileSync(path.join(installed,'package.json'),'utf8'));
if (pkg.name !== '@mehrdadz/koto' || pkg.version !== '3.0.0-alpha.3') throw new Error('Wrong installed package.');
fs.writeFileSync(path.join(root,'payloads.json'),JSON.stringify({package:pkg.name, version:pkg.version,files},null,2) + '\n',{flag:'wx',mode:0o600});
const tasks = {schemaVersion:1,project,goal:'Check the real Koto CLI entrypoint syntax with the installed managed Node runtime.',
  controlRoot:path.join(root,'session-control'),timeoutMs:30000,maxConcurrency:1,
  agents:[{id:'syntax',runtime:'command',command:'$node',args:['--check','bin/koto.js'],
    task:'Check bin/koto.js syntax without modifying the project.',owns:['bin/koto.js'],
    timeoutMs:15000,transport:'pipe',inputMode:'closed',dependsOn:[]}]};
fs.writeFileSync(path.join(root,'tasks.json'),JSON.stringify(tasks,null,2) + '\n',{flag:'wx',mode:0o600});
NODE
timeout --signal=TERM --kill-after=10s 30s env KOTO_STATE_DIR="$koto_observe_state" "$koto_observe_cli" plan build \
  "$koto_observe_root/tasks.json" "$koto_observe_root/prepared-plan.json" > "$koto_observe_root/plan-build.txt"
timeout --signal=TERM --kill-after=10s 30s env KOTO_STATE_DIR="$koto_observe_state" "$koto_observe_cli" plan check \
  "$koto_observe_root/prepared-plan.json" > "$koto_observe_root/plan-check.json"
timeout --signal=TERM --kill-after=10s 30s "$koto_observe_node" --input-type=module - "$koto_observe_root" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2];
const checked=JSON.parse(fs.readFileSync(path.join(root,'plan-check.json'),'utf8'));
if (checked.ok !== true) throw new Error('Installed CLI preflight was blocked: ' + JSON.stringify(checked));
if (!checked.checks.some(item=>item.id==='repository' && item.status==='ready')) throw new Error('No real repository check.');
fs.writeFileSync(path.join(root,'managed-runtime.json'),JSON.stringify({platform:process.platform,arch:process.arch,
  nodeVersion:process.version,nodeExecutable:fs.realpathSync(process.execPath),preflightOk:checked.ok,
  nativeReadiness:checked.checks.filter(item=>item.id==='native_readiness')},null,2) + '\n',{flag:'wx',mode:0o600});
NODE
timeout --signal=TERM --kill-after=10s 30s "$koto_observe_node" --check "$koto_observe_project/bin/koto.js" \
  > "$koto_observe_root/real-project-syntax.txt" 2>&1
sha256sum "$koto_observe_node" "$koto_observe_package/bin/koto.js" > "$koto_observe_root/reinstall-before.sha256"
timeout --signal=TERM --kill-after=15s 120s sh "$koto_observe_installer" \
  --prefix "$koto_observe_prefix" --bin-dir "$koto_observe_bin" \
  > "$koto_observe_root/reinstall.stdout" 2> "$koto_observe_root/reinstall.stderr"
sha256sum --check "$koto_observe_root/reinstall-before.sha256" > "$koto_observe_root/reinstall-preserved.txt"
# An unrelated existing prefix is a real filesystem ownership boundary.
mkdir -m 700 "$koto_observe_root/foreign-prefix"
printf 'preserve foreign prefix\n' > "$koto_observe_root/foreign-prefix/keep"
sha256sum "$koto_observe_root/foreign-prefix/keep" > "$koto_observe_root/foreign-before.sha256"
if timeout --signal=TERM --kill-after=10s 30s sh "$koto_observe_installer" \
  --prefix "$koto_observe_root/foreign-prefix" --bin-dir "$koto_observe_root/foreign-bin" \
  > "$koto_observe_root/foreign-install.stdout" 2> "$koto_observe_root/foreign-install.stderr"; then
  printf '%s\n' 'Installer accepted a foreign populated prefix.' >&2
  exit 1
else
  printf '%s\n' "$?" > "$koto_observe_root/foreign-install.exit"
fi
sha256sum --check "$koto_observe_root/foreign-before.sha256" > "$koto_observe_root/foreign-preserved.txt"
[ ! -e "$koto_observe_root/foreign-bin/koto" ]
# Reject a path whose mutable shared ancestor could redirect later removal.
mkdir -m 777 "$koto_observe_root/shared-parent"
chmod 777 "$koto_observe_root/shared-parent"
printf 'preserve shared directory data\n' > "$koto_observe_root/shared-parent/keep"
if timeout --signal=TERM --kill-after=10s 30s sh "$koto_observe_installer" \
  --prefix "$koto_observe_root/shared-parent/koto" --bin-dir "$koto_observe_root/shared-bin" \
  > "$koto_observe_root/shared-install.stdout" 2> "$koto_observe_root/shared-install.stderr"; then
  printf '%s\n' 'Installer accepted an unsafe writable ancestor.' >&2
  exit 1
else
  printf '%s\n' "$?" > "$koto_observe_root/shared-install.exit"
fi
[ ! -e "$koto_observe_root/shared-parent/koto" ]
[ "$(cat "$koto_observe_root/shared-parent/keep")" = 'preserve shared directory data' ]
chmod 700 "$koto_observe_root/shared-parent"
timeout --signal=TERM --kill-after=10s 60s sh "$koto_observe_installer" --uninstall \
  --prefix "$koto_observe_prefix" --bin-dir "$koto_observe_bin" \
  > "$koto_observe_root/uninstall.stdout" 2> "$koto_observe_root/uninstall.stderr"
[ ! -e "$koto_observe_cli" ] && [ ! -L "$koto_observe_cli" ]
[ ! -e "$koto_observe_prefix/current" ] && [ ! -L "$koto_observe_prefix/current" ]
sha256sum --check "$koto_observe_root/preservation-before.sha256" > "$koto_observe_root/preservation-after.txt"
git -C "$koto_observe_project" status --porcelain=v1 > "$koto_observe_root/project-after.txt"
cmp "$koto_observe_root/project-before.txt" "$koto_observe_root/project-after.txt"
printf '%s\n' 'Actual Linux installation, published payload identity, planning/preflight, reinstall, conflict refusal and owned uninstall observed.' > "$koto_observe_root/RESULT.txt"
koto_observe_finished=true
printf 'Koto Linux installation observation passed: %s\n' "$koto_observe_root"
