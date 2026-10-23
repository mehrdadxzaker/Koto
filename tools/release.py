"""Plan, prepare and verify local release candidates; never publish or approve them."""
from pathlib import Path
import argparse
from email.parser import BytesParser
import hashlib
import io
import json
import os
import re
import stat
import subprocess
import tarfile
import tempfile
import tomllib
import zipfile

from version import ROOT, RUNTIME_FILES, PLUGIN_FILES, check_versions, parse_version
from package_plugin import prepare_plugin, inspect_plugin

MAX_ARTIFACT = 128 * 1024 * 1024
MAX_EXPANDED = 256 * 1024 * 1024
MAX_TEXT = 1024 * 1024
MAX_MEMBERS = 20000


def plan(component, version):
    if component not in ("runtime", "plugin"):
        raise ValueError("Unknown release component")
    parsed = parse_version(version, component)
    stage = {"a": "alpha", "b": "beta", "rc": "rc"}.get(parsed[4])
    channel = stage or ("development" if component == "plugin" and parsed[1] == "0" else "stable")
    display = ".".join(parsed[index] for index in (1, 2, 3))
    if stage:
        display += f"-{stage}.{parsed[5]}"
    prerelease = channel != "stable"
    return {
        "schema_id": "koto.release-plan", "schema_version": 1,
        "component": component, "version": version, "display_version": display,
        "channel": channel, "tag": ("v" if component == "runtime" else "plugin-v") + version,
        "github_prerelease": prerelease, "make_latest": component == "runtime" and not prerelease,
    }


def regular_bytes(path, limit):
    """Read a bounded ordinary file without following its final symlink."""
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit or Path(path).is_symlink():
            raise ValueError(f"Expected a bounded regular file: {Path(path).name}")
        content = stream.read(limit + 1)
    if len(content) > limit:
        raise ValueError("File exceeds its limit")
    return content


def safe_name(name):
    if (not isinstance(name, str) or not name or "\\" in name or "\x00" in name
            or name.startswith("/") or any(part in ("", ".", "..") for part in name.rstrip("/").split("/"))
            or ":" in name):
        raise ValueError("Unsafe archive or artifact path")
    return name


def metadata_matches(content, distribution, version):
    if len(content) > 65536:
        raise ValueError("Package metadata exceeds its limit")
    metadata = BytesParser().parsebytes(content, headersonly=True)
    for key, expected in (("Name", distribution), ("Version", version)):
        values = metadata.get_all(key, [])
        if len(values) != 1:
            raise ValueError("Missing or duplicate package metadata")
        actual = re.sub(r"[-_.]+", "-", values[0]).lower() if key == "Name" else values[0]
        if actual != expected:
            raise ValueError("Artifact package name or version differs from its release")


def inspect_runtime(path, distribution, version):
    """Inspect bounded package archives without extracting or executing them."""
    content = regular_bytes(path, MAX_ARTIFACT)
    normalized = distribution.replace("-", "_")
    name = safe_name(path.name)
    if name.endswith(".whl"):
        fields = name[:-4].split("-")
        if (len(fields) not in (5, 6) or fields[:2] != [normalized, version]
                or not all(re.fullmatch(r"[A-Za-z0-9_.]+", field) for field in fields[2:])):
            raise ValueError("Wheel filename differs from its release")
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            members = archive.infolist()
            if len(members) > MAX_MEMBERS or sum(member.file_size for member in members) > MAX_EXPANDED:
                raise ValueError("Wheel contents exceed their limits")
            seen = set()
            for member in members:
                key = safe_name(member.filename).rstrip("/")
                mode = member.external_attr >> 16
                if (key in seen or stat.S_ISLNK(mode) or stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)
                        or member.flag_bits & 1 or member.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
                    raise ValueError("Duplicate or unsafe wheel member")
                seen.add(key)
            metadata_names = [member.filename for member in members if member.filename.endswith(".dist-info/METADATA")]
            expected = f"{normalized}-{version}.dist-info/METADATA"
            if metadata_names != [expected] or archive.getinfo(expected).file_size > 65536:
                raise ValueError("Wheel metadata identity differs from its release")
            metadata_matches(archive.read(expected), distribution, version)
    elif name.endswith(".tar.gz"):
        stem = name[:-7]
        if stem not in (f"{normalized}-{version}", f"{distribution}-{version}"):
            raise ValueError("Source distribution filename differs from its release")
        with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as archive:
            members, expanded, metadata = [], 0, None
            for member in archive:
                key = safe_name(member.name).rstrip("/")
                expanded += member.size
                if (len(members) >= MAX_MEMBERS or expanded > MAX_EXPANDED
                        or key in members or not (member.isfile() or member.isdir())
                        or key.split("/")[0] != stem):
                    raise ValueError("Duplicate, unsafe or excessive source archive member")
                members.append(key)
                if key == stem + "/PKG-INFO":
                    if not member.isfile() or member.size > 65536:
                        raise ValueError("Invalid source package metadata")
                    metadata = archive.extractfile(member).read(65537)
            if metadata is None:
                raise ValueError("Source distribution lacks root package metadata")
            metadata_matches(metadata, distribution, version)
    else:
        raise ValueError("Unexpected runtime artifact type")
    return content


def record(name, content):
    return {"name": name, "size_bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}


def release_notes(path):
    content = regular_bytes(path, MAX_TEXT)
    if not content.strip() or b"\x00" in content:
        raise ValueError("Release notes must be nonempty UTF-8 text")
    content.decode("utf-8")
    return content


def source_commit(root):
    def git(*arguments):
        result = subprocess.run(["git", "-C", str(root), *arguments], capture_output=True,
                                text=True, timeout=15)
        if result.returncode:
            raise ValueError("Release source must be a Git checkout with a commit")
        return result.stdout.strip()
    if Path(git("rev-parse", "--show-toplevel")).resolve() != root.resolve():
        raise ValueError("Release root must be the Git checkout root")
    git("ls-files", "--error-unmatch", "--", *RUNTIME_FILES, *PLUGIN_FILES)
    for name in (*RUNTIME_FILES, *PLUGIN_FILES):
        regular_bytes(root / name, MAX_TEXT)
    if git("status", "--porcelain", "--untracked-files=no"):
        raise ValueError("Tracked source changes must be committed before preparing a candidate")
    revision = git("rev-parse", "HEAD")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Expected a full source commit")
    return revision


def checksums(records):
    return "".join(f"{item['sha256']}  {item['name']}\n" for item in sorted(records, key=lambda item: item["name"]))


def prepare(root, component, artifacts, notes, output):
    revision = source_commit(root)
    versions = check_versions(root)
    release = plan(component, versions[component])
    distribution = "koto"
    payloads = {}
    if component == "runtime":
        distribution = tomllib.loads((root / "pyproject.toml").read_text())["project"]["name"]
        distribution = re.sub(r"[-_.]+", "-", distribution).lower()
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", distribution):
            raise ValueError("Invalid project distribution name")
        if artifacts is None or artifacts.is_symlink() or not artifacts.is_dir():
            raise ValueError("Runtime artifacts must be an ordinary directory")
        paths = sorted(artifacts.iterdir())
        if len(paths) != 2 or sum(path.name.endswith(".whl") for path in paths) != 1 or sum(path.name.endswith(".tar.gz") for path in paths) != 1:
            raise ValueError("Provide exactly one wheel and one source distribution")
        payloads = {path.name: inspect_runtime(path, distribution, versions[component]) for path in paths}
    elif artifacts is not None:
        raise ValueError("Plugin artifacts are built from the pinned source, not --artifacts")
    note_content = release_notes(notes)
    if output.exists() or output.is_symlink() or not output.parent.is_dir() or output.parent.is_symlink():
        raise ValueError("Output must be a new directory under an existing ordinary parent")
    with tempfile.TemporaryDirectory(prefix=".koto-candidate-", dir=output.parent) as temporary:
        stage = Path(temporary) / "bundle"
        stage.mkdir(mode=0o700)
        if component == "plugin":
            archive = stage / f"koto-plugin-{versions['plugin']}.zip"
            prepare_plugin(root, archive, versions["plugin"])
            payloads[archive.name] = regular_bytes(archive, MAX_ARTIFACT)
        manifest = {**release, "schema_id": "koto.release-candidate", "source_commit": revision,
                    "distribution": distribution, "publishing_approved": False,
                    "artifacts": [record(name, content) for name, content in sorted(payloads.items())],
                    "notes": record("release-notes.md", note_content)}
        for name, content in payloads.items():
            (stage / name).write_bytes(content)
        (stage / "release-notes.md").write_bytes(note_content)
        manifest_content = (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode("utf-8")
        (stage / "manifest.json").write_bytes(manifest_content)
        (stage / "SHA256SUMS").write_text(checksums([
            *manifest["artifacts"], manifest["notes"], record("manifest.json", manifest_content)]))
        verify(stage)
        stage.rename(output)
    return {"status": "prepared", "bundle": str(output), "tag": release["tag"], "publishing_approved": False}


def verify(bundle):
    if bundle.is_symlink() or not bundle.is_dir():
        raise ValueError("Bundle must be an ordinary directory")
    manifest_content = regular_bytes(bundle / "manifest.json", MAX_TEXT)
    manifest = json.loads(manifest_content)
    if type(manifest) is not dict:
        raise ValueError("Candidate manifest must be an object")
    expected = plan(manifest["component"], manifest["version"])
    if (set(manifest) != set(expected) | {"source_commit", "distribution", "publishing_approved", "artifacts", "notes"}
            or manifest.get("schema_id") != "koto.release-candidate" or manifest.get("schema_version") != 1
            or manifest.get("publishing_approved") is not False
            or not re.fullmatch(r"[0-9a-f]{40}", manifest["source_commit"])):
        raise ValueError("Invalid candidate identity or approval claim")
    if (type(manifest["distribution"]) is not str
            or re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", manifest["distribution"]) is None
            or type(manifest["artifacts"]) is not list or not 1 <= len(manifest["artifacts"]) <= 2
            or type(manifest["notes"]) is not dict):
        raise ValueError("Invalid candidate distribution or inventory")
    for key, value in expected.items():
        if key != "schema_id" and (type(manifest.get(key)) is not type(value) or manifest.get(key) != value):
            raise ValueError("Candidate release plan is incoherent")
    records = [*manifest["artifacts"], manifest["notes"]]
    names = set()
    for item in records:
        if (type(item) is not dict or set(item) != {"name", "size_bytes", "sha256"}
                or type(item["size_bytes"]) is not int or item["size_bytes"] < 0
                or type(item["sha256"]) is not str or re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) is None):
            raise ValueError("Invalid candidate artifact record")
        name = safe_name(item["name"])
        if "/" in name or name in names:
            raise ValueError("Invalid or duplicate candidate artifact")
        names.add(name)
        content = regular_bytes(bundle / name, MAX_TEXT if name == "release-notes.md" else MAX_ARTIFACT)
        if item != record(name, content):
            raise ValueError("Candidate artifact hash or size differs")
    if (manifest["notes"]["name"] != "release-notes.md"
            or {path.name for path in bundle.iterdir()} != names | {"manifest.json", "SHA256SUMS"}):
        raise ValueError("Candidate contents differ from their manifest")
    if regular_bytes(bundle / "SHA256SUMS", MAX_TEXT).decode("utf-8") != checksums([
            *records, record("manifest.json", manifest_content)]):
        raise ValueError("Candidate checksums differ")
    release_notes(bundle / "release-notes.md")
    artifact_names = [item["name"] for item in manifest["artifacts"]]
    if manifest["component"] == "plugin":
        if manifest["distribution"] != "koto" or artifact_names != [f"koto-plugin-{manifest['version']}.zip"]:
            raise ValueError("Plugin candidate artifact identity differs")
        plugin = inspect_plugin(bundle / artifact_names[0], manifest["version"])
        if plugin["source_commit"] != manifest["source_commit"]:
            raise ValueError("Plugin source commit differs from candidate source")
    else:
        if (len(artifact_names) != 2 or sum(name.endswith(".whl") for name in artifact_names) != 1
                or sum(name.endswith(".tar.gz") for name in artifact_names) != 1):
            raise ValueError("Runtime candidate requires one wheel and one source distribution")
        for name in artifact_names:
            inspect_runtime(bundle / name, manifest["distribution"], manifest["version"])
    return {"status": "verified", "component": manifest["component"], "version": manifest["version"],
            "source_commit": manifest["source_commit"], "tag": manifest["tag"], "publishing_approved": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    commands = parser.add_subparsers(dest="command", required=True)
    planning = commands.add_parser("plan", help="read a release stream without changing it")
    planning.add_argument("component", choices=("runtime", "plugin"))
    preparation = commands.add_parser("prepare", help="prepare a new local candidate bundle")
    preparation.add_argument("component", choices=("runtime", "plugin"))
    preparation.add_argument("--artifacts", type=Path, help="runtime wheel and source distribution directory")
    preparation.add_argument("--notes", type=Path, required=True)
    preparation.add_argument("--output", type=Path, required=True)
    verification = commands.add_parser("verify", help="verify an existing local candidate bundle")
    verification.add_argument("bundle", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "plan":
            result = plan(args.component, check_versions(args.root)[args.component])
        elif args.command == "prepare":
            result = prepare(args.root, args.component, args.artifacts, args.notes, args.output)
        else:
            result = verify(args.bundle)
    except (OSError, ValueError, KeyError, TypeError, SyntaxError, zipfile.BadZipFile,
            tarfile.TarError, subprocess.TimeoutExpired) as error:
        parser.exit(2, f"release: {error}\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
