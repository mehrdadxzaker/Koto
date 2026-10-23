"""Build and inspect a deterministic, skills-only Koto plugin archive."""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import importlib.util
import json
import posixpath
import re
import stat
import subprocess
import sys
import zipfile
from urllib.parse import quote, unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "koto-plugin-manifest.json"
MAX_FILE = 8 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_FILES = 4096
REQUIRED = {"plugin.json", "gemini-extension.json", ".claude-plugin/plugin.json",
            ".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json", "LICENSE"}
LINK = re.compile(r"\[[^\]]*\]\(([^)\n]+)\)")
REFERENCE = re.compile(r"(?m)^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]+>|[^ \t\n]+)")


def _git(root, *arguments, quiet=False):
    result = subprocess.run(["git", "-C", str(root), *arguments],
        capture_output=True, timeout=15)
    if result.returncode and not quiet:
        raise ValueError("Plugin source must be a readable Git repository")
    return result


def _path(name):
    path = PurePosixPath(name)
    if (not name or "\\" in name or ":" in name or "\x00" in name or path.is_absolute()
            or any(part in ("", ".", "..") for part in name.split("/"))
            or path.as_posix() != name or any(ord(character) < 32 for character in name)):
        raise ValueError("Unsafe plugin member path")
    return path


def _selected(name):
    path = _path(name)
    return (name in REQUIRED or name == "config.example.json"
        or len(path.parts) == 1 and path.suffix == ".md"
        or path.parts[0] in ("skills", "docs") and path.suffix in (".md", ".json")
        or path.parts[0] == "assets" and path.suffix in (".md", ".png", ".ico"))


def _read(root, name):
    path = root
    for part in _path(name).parts:
        path = path / part
        if path.is_symlink():
            raise ValueError("Plugin source cannot contain symlinks")
    size = path.stat().st_size
    if not path.is_file() or size > MAX_FILE:
        raise ValueError("Plugin source is not a bounded regular file")
    with path.open("rb") as source:
        value = source.read(MAX_FILE + 1)
    if len(value) > MAX_FILE:
        raise ValueError("Plugin file exceeds size limit")
    return value


def _json(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode() + b"\n"


def _load_json(value):
    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                raise ValueError("Duplicate plugin metadata field")
            result[key] = item
        return result
    def constant(value):
        raise ValueError("Nonfinite plugin metadata value")
    return json.loads(value, object_pairs_hook=pairs, parse_constant=constant)


def _version_tool():
    spec = importlib.util.spec_from_file_location("koto_plugin_versions", Path(__file__).with_name("version.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _metadata(files, version):
    portable = _load_json(files["plugin.json"])
    if type(portable) is not dict or portable.get("name") != "koto" or portable.get("version") != version:
        raise ValueError("Plugin identity or version differs from the release")
    for name in ("gemini-extension.json", ".claude-plugin/plugin.json"):
        host = _load_json(files[name])
        if type(host) is not dict or host.get("name") != "koto" or host.get("version") != version:
            raise ValueError("Host plugin identity or version differs from the release")
    for name, expected in ((".agents/plugins/marketplace.json", {"source": "local", "path": "./"}),
                           (".claude-plugin/marketplace.json", "./")):
        catalog = _load_json(files[name])
        if type(catalog) is not dict:
            raise ValueError("Marketplace must be a JSON object")
        rows = catalog.get("plugins")
        if (catalog.get("name") != "koto" or type(rows) is not list or len(rows) != 1
                or type(rows[0]) is not dict or rows[0].get("name") != "koto" or rows[0].get("source") != expected):
            raise ValueError("Marketplace must resolve the root Koto plugin")
    for name in REQUIRED - {"LICENSE"}:
        if re.search(r'"(?:hooks|mcpServers|apps|agents|commands|settings|lspServers)"\s*:',
                     json.dumps(_load_json(files[name]))):
            raise ValueError("Plugin must remain skills-only")
    repository = portable.get("repository")
    if (type(repository) is not str
            or re.fullmatch(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository) is None):
        raise ValueError("Plugin requires a canonical GitHub repository")
    if portable.get("license") != "Apache-2.0" or not files["LICENSE"].strip():
        raise ValueError("Plugin requires its Apache-2.0 license")
    onboarding = portable.get("extensions", {}).get("com.openai", {}).get("onboardingSkill")
    if onboarding is not None and onboarding.removeprefix("./") not in files:
        raise ValueError("Plugin onboarding skill is missing")
    for image in portable.get("extensions", {}).get("com.openai", {}).get("interface", {}).values():
        if type(image) is str and image.startswith("./assets/") and image[2:] not in files:
            raise ValueError("Plugin image is missing")
    if not any(name.startswith("skills/") and name.endswith("/SKILL.md") for name in files):
        raise ValueError("Plugin must include a skill")
    return repository


def _links(name, data, files, root=None, source_url=None, tracked=()):
    def replace(match):
        target = match[1]
        if target.startswith("<") and target.endswith(">"):
            target = target[1:-1]
        elif " " in target:
            target = target.split(" ", 1)[0]
        parsed = urlsplit(target)
        if parsed.scheme or parsed.netloc or not parsed.path:
            return match[0]
        if parsed.path.startswith("/") or "\\" in unquote(parsed.path):
            raise ValueError("Plugin documentation link escapes its root")
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), unquote(parsed.path)))
        if resolved == ".." or resolved.startswith("../"):
            raise ValueError("Plugin documentation link escapes its root")
        exists = (resolved == "." or resolved in files
                  or any(path.startswith(resolved.rstrip("/") + "/") for path in files))
        if exists:
            return match[0]
        if root is None:
            raise ValueError(f"Plugin documentation has an unresolved local link in {name}: {target}")
        source = root / resolved
        _read(root, resolved) if source.is_file() else None
        in_commit = resolved in tracked or any(path.startswith(resolved.rstrip("/") + "/") for path in tracked)
        if (not in_commit or not source.exists() or source.is_symlink()
                or not source.resolve().is_relative_to(root)):
            raise ValueError(f"Plugin documentation has a missing or unsafe link in {name}: {target}")
        replacement = source_url + "/" + quote(resolved, safe="/")
        if parsed.query:
            replacement += "?" + parsed.query
        if parsed.fragment:
            replacement += "#" + parsed.fragment
        offset = match.start(1) - match.start()
        return match[0][:offset] + replacement + match[0][offset + len(match[1]):]
    return REFERENCE.sub(replace, LINK.sub(replace, data.decode("utf-8"))).encode("utf-8")


def prepare_plugin(root: Path, destination: Path, version: str) -> Path:
    """Write one new archive; leave source files and existing destinations intact."""
    root = Path(root).resolve(strict=True)
    destination = Path(destination)
    versions = _version_tool().check_versions(root)
    if versions["plugin"] != version:
        raise ValueError("Requested plugin version differs from source")
    commit = _git(root, "rev-parse", "--verify", "HEAD^{commit}").stdout.decode().strip()
    if re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", commit) is None:
        raise ValueError("Plugin source commit is invalid")
    tracked = _git(root, "ls-tree", "-r", "--name-only", "-z", "HEAD").stdout.decode("utf-8").split("\x00")
    names = sorted(name for name in tracked if name and _selected(name))
    if not REQUIRED <= set(names) or len(names) + 1 > MAX_FILES:
        raise ValueError("Plugin source files are missing or exceed the file limit")
    if _git(root, "diff", "--quiet", "HEAD", "--", *names, "pyproject.toml", "hormuz/__init__.py", quiet=True).returncode:
        raise ValueError("Commit plugin source changes before packaging")
    files = {name: _read(root, name) for name in names}
    if sum(map(len, files.values())) > MAX_TOTAL:
        raise ValueError("Plugin exceeds total size limit")
    repository = _metadata(files, version)
    for name in names:
        if name.endswith(".md"):
            files[name] = _links(name, files[name], files, root, repository + "/blob/" + commit, tracked)
    manifest = {"schema_id": "koto.plugin-bundle", "schema_version": 1, "name": "koto",
        "source_commit": commit, "plugin_version": version, "runtime_version": versions["runtime"],
        "runtime_requirement": "==" + versions["runtime"], "repository": repository, "license": "Apache-2.0",
        "files": [{"path": name, "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                  for name, data in sorted(files.items())]}
    files[MANIFEST] = _json(manifest)
    created = False
    try:
        with destination.open("xb") as output:
            created = True
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for name, data in sorted(files.items()):
                    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                    info.create_system = 3
                    info.external_attr = (stat.S_IFREG | 0o644) << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, data, compresslevel=9)
        inspect_plugin(destination, version)
    except BaseException:
        if created:
            destination.unlink(missing_ok=True)
        raise
    return destination


def inspect_plugin(archive: Path, version: str) -> dict:
    """Validate archive contents without extracting or executing any member."""
    version_tool = _version_tool()
    version_tool.parse_version(version, "plugin")
    files = {}
    with zipfile.ZipFile(archive) as bundle:
        infos = bundle.infolist()
        if len(infos) > MAX_FILES or sum(row.file_size for row in infos) > MAX_TOTAL:
            raise ValueError("Plugin archive exceeds limits")
        for row in infos:
            _path(row.filename)
            mode = row.external_attr >> 16
            if (row.filename in files or row.is_dir() or stat.S_ISLNK(mode)
                    or mode and not stat.S_ISREG(mode) or row.file_size > MAX_FILE
                    or row.flag_bits & 1 or row.filename != MANIFEST and not _selected(row.filename)):
                raise ValueError("Unsafe or unexpected plugin archive member")
            files[row.filename] = bundle.read(row)
    if not REQUIRED | {MANIFEST} <= set(files):
        raise ValueError("Plugin archive is missing required files")
    manifest = _load_json(files.pop(MANIFEST))
    if (type(manifest) is not dict or manifest.get("schema_id") != "koto.plugin-bundle"
            or type(manifest.get("schema_version")) is not int or manifest["schema_version"] != 1
            or manifest.get("name") != "koto" or manifest.get("plugin_version") != version
            or re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", manifest.get("source_commit", "")) is None
            or manifest.get("runtime_requirement") != "==" + manifest.get("runtime_version", "")
            or manifest.get("license") != "Apache-2.0"):
        raise ValueError("Plugin archive manifest is invalid")
    version_tool.parse_version(manifest.get("runtime_version"), "runtime")
    rows = manifest.get("files")
    if (type(rows) is not list or any(type(row) is not dict
            or set(row) != {"path", "size_bytes", "sha256"}
            or type(row.get("path")) is not str or type(row.get("size_bytes")) is not int
            or not 0 <= row["size_bytes"] <= MAX_FILE
            or type(row.get("sha256")) is not str
            or re.fullmatch(r"[0-9a-f]{64}", row["sha256"]) is None for row in rows)):
        raise ValueError("Plugin archive file inventory is invalid")
    expected = [{"path": name, "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                for name, data in sorted(files.items())]
    if manifest.get("files") != expected:
        raise ValueError("Plugin archive file inventory or checksum differs")
    if _metadata(files, version) != manifest.get("repository"):
        raise ValueError("Plugin archive repository differs")
    for name, data in files.items():
        if name.endswith(".md"):
            _links(name, data, files)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--output", type=Path, help="create a new archive")
    action.add_argument("--verify", type=Path, help="inspect an existing archive without extraction")
    parser.add_argument("--version", help="expected plugin version")
    args = parser.parse_args()
    try:
        version = args.version or json.loads((args.root / "plugin.json").read_text())["version"]
        if args.output:
            prepare_plugin(args.root, args.output, version)
        result = inspect_plugin(args.verify or args.output, version)
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.SubprocessError,
            zipfile.BadZipFile, SyntaxError) as error:
        parser.exit(2, f"plugin-package: {error}\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
