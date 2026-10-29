#!/bin/sh
# User-local Linux delivery of the frozen npm CLI; no second agent runtime.
set -eu
umask 077
KOTO_VERSION=3.0.0-alpha.1
KOTO_URL=https://registry.npmjs.org/@mehrdadz/koto/-/koto-3.0.0-alpha.1.tgz
KOTO_SHA256=52673651a84c3daa9989e667a4e583403bd693f6e5d7b8c3772c5136d5c4b18c
NODE_VERSION=v24.22.2
prefix=${HOME:?HOME must be set}/.local/share/koto
bin_dir=$HOME/.local/bin
uninstall=0
stage= child= lock_owned=0 prefix_created=0
die() { printf 'koto installer: %s\n' "$*" >&2; exit 1; }
usage() {
    cat <<'EOF'
Usage: sh install.sh [--prefix ABS_PATH] [--bin-dir ABS_PATH] [--uninstall]

Install Koto with its own Node.js/npm on Linux x64 or arm64, glibc 2.28+,
kernel 4.18+. Defaults: ~/.local/share/koto and ~/.local/bin/koto.
Requires curl, GNU coreutils/find/tar, xz and glibc getconf; no system Node,
sudo or shell-profile changes. Downloads use HTTPS and pinned SHA-256 hashes.
Reinstall verifies and reuses an unchanged installer-owned release.
Uninstall requires the same prefix/bin-dir and preserves ~/.koto, native
credentials, models, projects, and all files outside the owned installation.
EOF
}
cleanup() {
    result=$?
    trap - EXIT HUP INT TERM
    if [ -n "$child" ]; then
        /bin/kill -TERM -- "-$child" 2>/dev/null || :
        sleep 1
        /bin/kill -KILL -- "-$child" 2>/dev/null || :
        wait "$child" 2>/dev/null || :
    fi
    [ -z "$stage" ] || rm -rf -- "$stage"
    if [ "$lock_owned" = 1 ]; then rmdir -- "$prefix/.install-lock" 2>/dev/null || :; fi
    if [ "$prefix_created" = 1 ]; then rmdir -- "$prefix" 2>/dev/null || :; fi
    exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
run() {
    deadline=$1; shift
    timeout --signal=TERM --kill-after=5s "${deadline}s" "$@" &
    child=$!
    run_status=0
    wait "$child" || run_status=$?
    child=
    return "$run_status"
}
while [ "$#" -gt 0 ]; do
    case $1 in
        --help|-h) usage; exit 0 ;;
        --prefix) [ "$#" -ge 2 ] || die '--prefix needs a path'; prefix=$2; shift 2 ;;
        --prefix=*) prefix=${1#*=}; shift ;;
        --bin-dir) [ "$#" -ge 2 ] || die '--bin-dir needs a path'; bin_dir=$2; shift 2 ;;
        --bin-dir=*) bin_dir=${1#*=}; shift ;;
        --uninstall) uninstall=1; shift ;;
        *) die "unknown argument: $1 (use --help)" ;;
    esac
done
installer_uid=$(id -u) || die 'cannot establish the current user'
[ "$installer_uid" != 0 ] || die 'run as your normal user, without sudo'
[ "$(uname -s)" = Linux ] || die 'this installer supports Linux; use npm on other systems'
for tool in realpath stat mkdir mktemp rmdir rm mv ln readlink find sort cmp sha256sum timeout tar cat sed cut chmod date awk od; do
    command -v "$tool" >/dev/null 2>&1 || die "missing prerequisite: $tool"
done
[ -x /bin/kill ] || die 'missing prerequisite: /bin/kill'
case "$prefix:$bin_dir" in *'
'*) die 'paths must not contain newlines' ;; esac
case $prefix in /*) ;; *) die '--prefix must be absolute' ;; esac
case $bin_dir in /*) ;; *) die '--bin-dir must be absolute' ;; esac
[ ! -L "$prefix" ] && [ ! -L "$bin_dir" ] || die 'prefix and bin-dir must not be symlinks'
prefix=$(realpath -m -- "$prefix")
bin_dir=$(realpath -m -- "$bin_dir")
safe_home=$(realpath -m -- "$HOME")
case $prefix in /|"$safe_home"|"$safe_home/.local"|"$safe_home/.koto"|"$safe_home/.koto/"*|"$safe_home/.codex"|"$safe_home/.codex/"*|"$safe_home/.claude"|"$safe_home/.claude/"*) die 'unsafe installation prefix' ;; esac
case "$prefix/" in "$bin_dir/"*) die 'prefix and bin-dir must be separate directories' ;; esac
case "$bin_dir/" in "$prefix/"*) die 'prefix and bin-dir must be separate directories' ;; esac
secure_directory() {
    [ -d "$1" ] && [ ! -L "$1" ] || die "not a real directory: $1"
    [ "$(stat -c %u -- "$1")" = "$installer_uid" ] || die "directory belongs to another user: $1"
    directory_mode=$(stat -c %a -- "$1")
    [ $((0$directory_mode & 022)) -eq 0 ] || die "directory is writable by other users: $1"
}
secure_ancestors() {
    ancestor=$1
    while [ -n "$ancestor" ]; do
        if [ -e "$ancestor" ] || [ -L "$ancestor" ]; then
            [ -d "$ancestor" ] && [ ! -L "$ancestor" ] || die "ancestor is not a real directory: $ancestor"
            ancestor_uid=$(stat -c %u -- "$ancestor")
            case $ancestor_uid in 0|"$installer_uid") ;; *) die "ancestor belongs to another user: $ancestor" ;; esac
            ancestor_mode=$(stat -c %a -- "$ancestor")
            if [ $((0$ancestor_mode & 022)) -ne 0 ]; then
                [ "$ancestor_uid" = 0 ] && [ $((0$ancestor_mode & 01000)) -ne 0 ] || die "ancestor is writable by other users: $ancestor"
            fi
        fi
        if [ "$ancestor" = / ]; then ancestor=
        else ancestor=${ancestor%/*}; [ -n "$ancestor" ] || ancestor=/; fi
    done
}
secure_ancestors "$prefix"
secure_ancestors "$bin_dir"
check_link() {
    if [ -L "$bin_dir/koto" ]; then
        [ "$(readlink -- "$bin_dir/koto")" = "$prefix/current/koto" ] || die 'existing koto link is not owned by this installation'
    elif [ -e "$bin_dir/koto" ]; then die 'refusing to overwrite an existing koto command'; fi
}
if [ ! -e "$prefix" ]; then
    if [ "$uninstall" = 1 ]; then printf 'Koto is not installed at %s\n' "$prefix"; exit 0; fi
    prefix_parent=${prefix%/*}; [ -n "$prefix_parent" ] || prefix_parent=/
    mkdir -p -- "$prefix_parent"
    secure_ancestors "$prefix_parent"
    mkdir -- "$prefix" || die 'prefix destination appeared; refusing to replace it'
    prefix_created=1
fi
secure_ancestors "$prefix"
secure_directory "$prefix"
owner_text=$(printf 'koto-linux-installer-v1\n%s\n%s' "$prefix" "$bin_dir")
owned=0
if [ -f "$prefix/.koto-installer" ] && [ ! -L "$prefix/.koto-installer" ]; then
    [ "$(cat "$prefix/.koto-installer")" = "$owner_text" ] || die 'prefix ownership record does not match these paths'
    owned=1
else
    [ "$uninstall" = 0 ] || die 'prefix has no matching installer ownership record'
    [ -z "$(find "$prefix" -mindepth 1 -maxdepth 1 -print -quit)" ] || die 'prefix contains files not owned by this installer'
fi
for entry in "$prefix"/.[!.]* "$prefix"/..?* "$prefix"/*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    case $entry in "$prefix/.koto-installer"|"$prefix/releases"|"$prefix/current"|"$prefix/.install-lock") ;; *) die 'prefix contains an unknown file; inspect it before continuing' ;; esac
done
mkdir -- "$prefix/.install-lock" 2>/dev/null || die 'installation is locked; inspect the existing lock before retrying'
lock_owned=1
stage=$(mktemp -d "$prefix/.stage.XXXXXXXX")
if [ -e "$bin_dir" ]; then secure_directory "$bin_dir"; fi
check_link
old_current=
if [ -L "$prefix/current" ]; then
    old_current=$(readlink -- "$prefix/current")
    case $old_current in releases/*) ;; *) die 'current link is not installer-owned' ;; esac
    case ${old_current#releases/} in ''|*/*|.*) die 'invalid current release link' ;; esac
elif [ -e "$prefix/current" ]; then die 'current is not an installer-owned link'; fi
verify_release() {
    verify_dir=$1
    case ${verify_dir##*/} in koto-*-node-v*-linux-x64|koto-*-node-v*-linux-arm64) ;; *) die 'unknown retained release directory' ;; esac
    secure_directory "$verify_dir"
    for record in .koto-release .paths .sha256 koto; do
        [ -f "$verify_dir/$record" ] && [ ! -L "$verify_dir/$record" ] || die 'release ownership/inventory record is missing'
    done
    [ "$(sed -n '1p' "$verify_dir/.koto-release")" = koto-linux-release-v1 ] || die 'unknown release ownership record'
    [ "$(sed -n '2p' "$verify_dir/.koto-release")" = "${verify_dir##*/}" ] || die 'release identity differs from its record'
    for entry in "$verify_dir"/.[!.]* "$verify_dir"/..?* "$verify_dir"/*; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        case ${entry##*/} in node|package|koto|.koto-release|.paths|.sha256) ;; *) die 'release contains an unknown file' ;; esac
    done
    [ -d "$verify_dir/node" ] && [ ! -L "$verify_dir/node" ] && [ -d "$verify_dir/package" ] && [ ! -L "$verify_dir/package" ] || die 'release payload directories were replaced'
    run 120 sh -c 'set -eu; cd "$1"; find node package koto -printf "%y %m %p %l\0" | LC_ALL=C sort -z > "$2"; cmp -s .paths "$2" && sha256sum --check --quiet .sha256' sh "$verify_dir" "$stage/check.paths" || die 'owned payload changed; refusing to replace or remove it'
}
if [ -e "$prefix/releases" ] || [ -L "$prefix/releases" ]; then
    secure_directory "$prefix/releases"
    release_count=0
    for saved_release in "$prefix/releases"/* "$prefix/releases"/.[!.]* "$prefix/releases"/..?*; do
        [ -e "$saved_release" ] || [ -L "$saved_release" ] || continue
        release_count=$((release_count + 1)); [ "$release_count" -le 8 ] || die 'too many retained releases; inspect installation before continuing'
        verify_release "$saved_release"
    done
fi
[ -z "$old_current" ] || [ -d "$prefix/$old_current" ] || die 'current release is missing'
if [ "$uninstall" = 1 ]; then
    [ "$owned" = 1 ] || die 'installation ownership is unconfirmed'
    secure_ancestors "$prefix"
    secure_ancestors "$bin_dir"
    [ ! -L "$bin_dir/koto" ] || rm -- "$bin_dir/koto"
    [ -z "$old_current" ] || rm -- "$prefix/current"
    if [ -d "$prefix/releases" ]; then
        for saved_release in "$prefix/releases"/*; do [ ! -e "$saved_release" ] || rm -rf -- "$saved_release"; done
        rmdir -- "$prefix/releases"
    fi
    rm -- "$prefix/.koto-installer"
    rm -rf -- "$stage"; stage=
    rmdir -- "$prefix/.install-lock"; lock_owned=0
    rmdir -- "$prefix"; prefix_created=0
    printf 'Removed installer-owned Koto files. State, models, native logins and projects are preserved.\n'
    exit 0
fi
for tool in curl xz getconf awk sed; do command -v "$tool" >/dev/null 2>&1 || die "missing prerequisite: $tool"; done
glibc=$(getconf GNU_LIBC_VERSION 2>/dev/null) || die 'glibc 2.28+ is required; musl is unsupported'
case $glibc in 'glibc '*) ;; *) die 'glibc 2.28+ is required; musl is unsupported' ;; esac
awk -v version="${glibc#glibc }" 'BEGIN { split(version,v,/[.]/); exit !(v[1]>2 || (v[1]==2 && v[2]>=28)) }' || die 'glibc 2.28+ is required'
awk -v version="$(uname -r)" 'BEGIN { split(version,v,/[.]/); exit !(v[1]>4 || (v[1]==4 && v[2]>=18)) }' || die 'Linux kernel 4.18+ is required'
case $(uname -m) in
    x86_64) arch=x64; node_sha=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75 ;;
    aarch64|arm64) arch=arm64; node_sha=eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8 ;;
    *) die 'supported Linux architectures are x64 and arm64' ;;
esac
release=koto-$KOTO_VERSION-node-$NODE_VERSION-linux-$arch
release_dir=$prefix/releases/$release
download() {
    download_url=$1; download_out=$2; download_sha=$3
    delay=1; wait_budget=30
    for attempt in 1 2 3; do
        : > "$stage/http-headers"; : > "$stage/http-status"; : > "$stage/http-error"
        curl_status=0
        run 130 curl --disable --fail --silent --show-error --stderr "$stage/http-error" --location --max-redirs 3 --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 120 --retry 0 --max-filesize 268435456 --dump-header "$stage/http-headers" --write-out '%{http_code}' --output "$download_out" "$download_url" > "$stage/http-status" || curl_status=$?
        http_status=$(cat "$stage/http-status")
        case $http_status in [0-9][0-9][0-9]) ;; *) http_status=000 ;; esac
        if [ "$curl_status" = 0 ]; then
            case $http_status in 2??) break ;; *) die "unexpected HTTP status: $http_status" ;; esac
        fi
        cat "$stage/http-error" >&2
        if awk 'tolower($0) ~ /assign requested address|eaddrnotavail|too many open files/ { found=1 } END { exit !found }' "$stage/http-error"; then
            die 'network/file-descriptor capacity is unavailable; no retry was made'
        fi
        case $http_status in
            408|429|5??) : ;;
            4??) die "HTTP $http_status is not retryable" ;;
            000|2??) case $curl_status in 5|6|7|18|28|35|52|55|56|92|97|124) : ;; *) die "download failed without a retryable connection error ($curl_status)" ;; esac ;;
            *) die "download failed with HTTP $http_status" ;;
        esac
        [ "$attempt" -lt 3 ] || die 'download failed after three bounded attempts'
        retry_after=$(awk '/^HTTP\// { value="" } tolower($0) ~ /^retry-after[[:space:]]*:/ { sub(/^[^:]*:[[:space:]]*/, ""); sub(/[[:space:]]+$/, ""); value=$0 } END { print value }' "$stage/http-headers")
        requested_wait=0
        if [ -n "$retry_after" ]; then
            [ "${#retry_after}" -le 128 ] || die 'Retry-After exceeds the bounded wait policy'
            case $retry_after in
                *[!0-9]*) retry_epoch=$(date -u --date="$retry_after" +%s 2>/dev/null) || die 'invalid Retry-After; refusing an early retry'
                    requested_wait=$((retry_epoch - $(date -u +%s)))
                    [ "$requested_wait" -ge 0 ] || requested_wait=0 ;;
                *) requested_wait=$(awk -v value="$retry_after" 'BEGIN { if (value+0>30) print 31; else printf "%d",value+0 }') ;;
            esac
        fi
        jitter=$(od -An -N1 -tu1 /dev/urandom)
        retry_wait=$((delay + jitter % 2))
        [ "$requested_wait" -le "$retry_wait" ] || retry_wait=$requested_wait
        [ "$retry_wait" -le "$wait_budget" ] || die 'Retry-After/backoff exceeds the remaining 30-second budget; retry later'
        wait_budget=$((wait_budget - retry_wait))
        run 35 sleep "$retry_wait" || die 'retry wait interrupted'
        delay=$((delay * 2))
    done
    [ "$(sha256sum < "$download_out" | cut -d ' ' -f 1)" = "$download_sha" ] || die 'download checksum mismatch; nothing was executed'
}
if [ ! -e "$release_dir" ]; then
    download "$KOTO_URL" "$stage/koto.tgz" "$KOTO_SHA256"
    download "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-$arch.tar.xz" "$stage/node.tar.xz" "$node_sha"
    mkdir -- "$stage/payload" "$stage/payload/node" "$stage/payload/package"
    run 120 tar -xJf "$stage/node.tar.xz" -C "$stage/payload/node" --strip-components=1 --no-same-owner --same-permissions || die 'Node archive extraction failed'
    run 30 tar -xzf "$stage/koto.tgz" -C "$stage/payload/package" --strip-components=1 --no-same-owner --same-permissions || die 'Koto archive extraction failed'
    run 10 "$stage/payload/node/bin/node" --version > "$stage/node-version" || die 'managed Node could not run on this host'
    [ "$(cat "$stage/node-version")" = "$NODE_VERSION" ] || die 'managed Node version differs from the pinned release'
    run 15 "$stage/payload/node/bin/node" "$stage/payload/package/bin/koto.js" --version > "$stage/koto-version" || die 'downloaded CLI could not start'
    [ "$(cat "$stage/koto-version")" = "$KOTO_VERSION" ] || die 'downloaded CLI version differs from the pinned release'
    [ -f "$stage/payload/node/lib/node_modules/npm/bin/npm-cli.js" ] || die 'managed npm is missing'
    cat > "$stage/payload/koto" <<'EOF'
#!/bin/sh
koto_payload=$(dirname -- "$(readlink -f -- "$0")") || exit 1
PATH="$koto_payload/node/bin:$PATH"
export PATH
exec "$koto_payload/node/bin/node" "$koto_payload/package/bin/koto.js" "$@"
EOF
    chmod 755 "$stage/payload/koto"
    printf 'koto-linux-release-v1\n%s\n%s\n%s\n%s\n%s\n%s\n' "$release" "$KOTO_VERSION" "$NODE_VERSION" "$arch" "$KOTO_SHA256" "$node_sha" > "$stage/payload/.koto-release"
    run 120 sh -c 'set -eu; cd "$1"; find node package koto -printf "%y %m %p %l\0" | LC_ALL=C sort -z > .paths; find node package koto -type f -exec sha256sum {} + > .sha256' sh "$stage/payload" || die 'could not record payload ownership'
    mkdir -p -- "$prefix/releases"
    mv -Tn -- "$stage/payload" "$release_dir"
    [ ! -d "$stage/payload" ] || die 'release destination appeared; refusing to overwrite it'
fi
verify_release "$release_dir"
[ "$(sed -n '3,7p' "$release_dir/.koto-release")" = "$(printf '%s\n%s\n%s\n%s\n%s' "$KOTO_VERSION" "$NODE_VERSION" "$arch" "$KOTO_SHA256" "$node_sha")" ] || die 'release version record differs from the pinned artifacts'
if [ "$owned" = 0 ]; then printf '%s\n' "$owner_text" > "$stage/owner"; ln -- "$stage/owner" "$prefix/.koto-installer" || die 'ownership destination appeared'; fi
if [ -n "$old_current" ]; then [ -L "$prefix/current" ] && [ "$(readlink -- "$prefix/current")" = "$old_current" ] || die 'current link changed during installation'
else [ ! -e "$prefix/current" ] && [ ! -L "$prefix/current" ] || die 'current destination appeared'; fi
ln -s -- "releases/$release" "$stage/current"
mv -Tf -- "$stage/current" "$prefix/current"
secure_ancestors "$bin_dir"
mkdir -p -- "$bin_dir"
secure_ancestors "$bin_dir"
secure_directory "$bin_dir"; check_link
[ -L "$bin_dir/koto" ] || ln -s -- "$prefix/current/koto" "$bin_dir/koto"
prefix_created=0
printf 'Installed Koto %s with managed Node %s.\nRun: %s/koto\nAdd %s to PATH if needed.\n' "$KOTO_VERSION" "$NODE_VERSION" "$bin_dir" "$bin_dir"
