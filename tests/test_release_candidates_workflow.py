"""Release candidate commands exercised through disposable public CLI boundaries."""
from pathlib import Path
import hashlib
import io
import json
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile


TOOL = Path(__file__).resolve().parents[1] / "tools" / "release.py"


class ReleaseCandidateWorkflowTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="koto-release-test-")
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.root = self.base / "source"
        self.root.mkdir()
        self.metadata("2.0.0a2", "0.5.0")

    def metadata(self, runtime, plugin):
        files = {
            "pyproject.toml": f'[project]\nname = "koto-router"\nversion = "{runtime}"\n',
            "hormuz/__init__.py": f'__version__ = "{runtime}"\nraise RuntimeError("do not execute metadata")\n',
            "plugin.json": json.dumps({"name": "koto", "version": plugin}),
            ".claude-plugin/plugin.json": json.dumps({"name": "koto", "version": plugin}),
            "gemini-extension.json": json.dumps({"name": "koto", "version": plugin}),
        }
        for name, content in files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")

    def command(self, *arguments, expected=0):
        result = subprocess.run(
            [sys.executable, str(TOOL), "--root", str(self.root), *arguments],
            cwd=self.base, text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        if expected:
            self.assertIn("release:", result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            return result
        return json.loads(result.stdout)

    def test_runtime_plan_explains_alpha_version_without_executing_or_writing_source(self):
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        self.assertEqual(self.command("plan", "runtime"), {
            "schema_id": "koto.release-plan", "schema_version": 1,
            "component": "runtime", "version": "2.0.0a2", "display_version": "2.0.0-alpha.2",
            "channel": "alpha", "tag": "v2.0.0a2", "github_prerelease": True, "make_latest": False,
        })
        self.assertEqual({p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}, before)

    def test_release_channels_keep_all_experimental_artifacts_out_of_latest(self):
        examples = (
            ("2.0.0b3", "0.5.0", "runtime", "2.0.0-beta.3", "beta", "v2.0.0b3", True, False),
            ("2.0.0rc1", "0.5.0", "runtime", "2.0.0-rc.1", "rc", "v2.0.0rc1", True, False),
            ("2.0.0", "0.5.0", "runtime", "2.0.0", "stable", "v2.0.0", False, True),
            ("2.0.0a2", "0.5.0", "plugin", "0.5.0", "development", "plugin-v0.5.0", True, False),
            ("2.0.0", "1.0.0", "plugin", "1.0.0", "stable", "plugin-v1.0.0", False, False),
        )
        for runtime, plugin, component, display, channel, tag, prerelease, latest in examples:
            with self.subTest(runtime=runtime, plugin=plugin, component=component):
                self.metadata(runtime, plugin)
                result = self.command("plan", component)
                self.assertEqual((result["display_version"], result["channel"], result["tag"]), (display, channel, tag))
                self.assertIs(result["github_prerelease"], prerelease)
                self.assertIs(result["make_latest"], latest)

    def test_stable_plugin_does_not_displace_the_runtime_latest_release(self):
        self.metadata("2.0.0", "1.0.0")
        result = self.command("plan", "plugin")
        self.assertIs(result["github_prerelease"], False)
        self.assertIs(result["make_latest"], False)

    def runtime_artifacts(self):
        self.artifacts = self.base / "dist"
        self.artifacts.mkdir()
        metadata = b"Metadata-Version: 2.4\nName: koto-router\nVersion: 2.0.0a2\n\n"
        wheel = self.artifacts / "koto_router-2.0.0a2-py3-none-any.whl"
        with zipfile.ZipFile(wheel, "w") as archive:
            archive.writestr("koto_router-2.0.0a2.dist-info/METADATA", metadata)
            archive.writestr("koto/__init__.py", "raise RuntimeError('never execute artifacts')\n")
        source = self.artifacts / "koto_router-2.0.0a2.tar.gz"
        with tarfile.open(source, "w:gz") as archive:
            entry = tarfile.TarInfo("koto_router-2.0.0a2/PKG-INFO")
            entry.size = len(metadata)
            archive.addfile(entry, io.BytesIO(metadata))
        self.notes = self.base / "notes.md"
        self.notes.write_text("# Koto alpha candidate\n\nA reviewed candidate, with qualification still pending.\n")
        self.git("init", "-q")
        self.git("add", ".")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Fixture source")
        self.commit = self.git("rev-parse", "HEAD").strip()
        return wheel, source

    def git(self, *arguments):
        return subprocess.run(["git", "-C", str(self.root), *arguments], capture_output=True,
                              text=True, check=True, timeout=10).stdout

    def prepared(self):
        self.runtime_artifacts()
        output = self.base / "candidate"
        self.command("prepare", "runtime", "--artifacts", str(self.artifacts),
                     "--notes", str(self.notes), "--output", str(output))
        return output

    def reseal(self, output):
        records = []
        for path in sorted(output.iterdir()):
            if path.name != "SHA256SUMS":
                records.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n")
        (output / "SHA256SUMS").write_text("".join(records))

    def test_prepare_retains_exact_artifacts_notes_and_unapproved_source_identity(self):
        originals = self.runtime_artifacts()
        output = self.base / "candidate"
        report = self.command("prepare", "runtime", "--artifacts", str(self.artifacts),
                              "--notes", str(self.notes), "--output", str(output))
        self.assertEqual(report["status"], "prepared")
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual(manifest["schema_id"], "koto.release-candidate")
        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(manifest["source_commit"], self.commit)
        self.assertIs(manifest["publishing_approved"], False)
        self.assertEqual(manifest["tag"], "v2.0.0a2")
        self.assertIs(manifest["github_prerelease"], True)
        self.assertIs(manifest["make_latest"], False)
        self.assertEqual((output / "release-notes.md").read_bytes(), self.notes.read_bytes())
        expected_names = {p.name for p in originals}
        self.assertEqual({a["name"] for a in manifest["artifacts"]}, expected_names)
        for original in originals:
            self.assertEqual((output / original.name).read_bytes(), original.read_bytes())
            checksum = hashlib.sha256(original.read_bytes()).hexdigest()
            self.assertIn(f"{checksum}  {original.name}\n", (output / "SHA256SUMS").read_text())
        self.assertEqual(self.command("verify", str(output))["status"], "verified")

    def test_verify_rejects_unknown_component_even_with_a_matching_tag_spelling(self):
        output = self.prepared()
        manifest_path = output / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest.update(component="worker", tag="plugin-v2.0.0a2")
        manifest_path.write_text(json.dumps(manifest))
        self.reseal(output)
        self.command("verify", str(output), expected=2)

    def test_verify_rejects_unrecognized_qualification_claims(self):
        output = self.prepared()
        manifest_path = output / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["qualification_passed"] = True
        manifest_path.write_text(json.dumps(manifest))
        self.reseal(output)
        self.command("verify", str(output), expected=2)

    def test_source_identity_is_covered_by_bundle_checksums(self):
        output = self.prepared()
        manifest_path = output / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["source_commit"] = "a" * 40
        manifest_path.write_text(json.dumps(manifest))
        self.command("verify", str(output), expected=2)

    def test_verify_rejects_empty_release_notes_even_with_updated_inventory_and_checksums(self):
        output = self.prepared()
        manifest_path = output / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        (output / "release-notes.md").write_bytes(b"")
        manifest["notes"].update(size_bytes=0, sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        manifest_path.write_text(json.dumps(manifest))
        self.reseal(output)
        self.command("verify", str(output), expected=2)

    def test_verify_rejects_an_incoherent_plan_after_checksums_are_updated(self):
        output = self.prepared()
        path = output / "manifest.json"
        original = path.read_bytes()
        for change in ({"tag": "v1.8.0"}, {"github_prerelease": False}, {"make_latest": True},
                       {"publishing_approved": True}, {"schema_version": True}):
            with self.subTest(change=change):
                manifest = json.loads(original)
                manifest.update(change)
                path.write_text(json.dumps(manifest))
                self.reseal(output)
                self.command("verify", str(output), expected=2)

    def test_malformed_candidate_types_fail_with_a_public_error(self):
        output = self.prepared()
        path = output / "manifest.json"
        original = path.read_bytes()
        for change in ({"distribution": True}, {"artifacts": None}, {"notes": []}):
            with self.subTest(change=change):
                manifest = json.loads(original)
                manifest.update(change)
                path.write_text(json.dumps(manifest))
                self.reseal(output)
                self.command("verify", str(output), expected=2)

    def test_tampered_artifact_symlink_and_extra_bundle_content_are_rejected(self):
        output = self.prepared()
        wheel = output / "koto_router-2.0.0a2-py3-none-any.whl"
        original = wheel.read_bytes()
        wheel.write_bytes(original + b"tampered")
        self.command("verify", str(output), expected=2)
        wheel.unlink()
        wheel.symlink_to(self.artifacts / wheel.name)
        self.command("verify", str(output), expected=2)
        wheel.unlink()
        wheel.write_bytes(original)
        (output / "unexpected.txt").write_text("not part of this candidate")
        self.command("verify", str(output), expected=2)

    def test_prepare_rejects_mismatched_metadata_unsafe_archives_and_symlinked_artifacts(self):
        wheel, source = self.runtime_artifacts()
        original = wheel.read_bytes()
        output = self.base / "candidate"
        def refused():
            self.command("prepare", "runtime", "--artifacts", str(self.artifacts),
                         "--notes", str(self.notes), "--output", str(output), expected=2)
            self.assertFalse(output.exists())
        with zipfile.ZipFile(wheel, "w") as archive:
            archive.writestr("koto_router-2.0.0a2.dist-info/METADATA", "Name: koto-router\nVersion: 1.8.0\n")
        refused()

        wheel.write_bytes(original)
        with zipfile.ZipFile(wheel, "a") as archive:
            archive.writestr("../outside.py", "raise RuntimeError('unsafe')")
        refused()
        wheel.write_bytes(original)
        with zipfile.ZipFile(wheel, "a") as archive:
            link = zipfile.ZipInfo("koto/linked.py")
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(link, "../../outside.py")
        refused()
        wheel.unlink()
        target = self.base / "outside.whl"
        target.write_bytes(original)
        wheel.symlink_to(target)
        refused()
        wheel.unlink()
        wheel.write_bytes(original)
        with tarfile.open(source, "w:gz") as archive:
            entry = tarfile.TarInfo("../outside.py")
            entry.size = 0
            archive.addfile(entry, io.BytesIO())
        refused()

    def test_encrypted_package_metadata_is_rejected_without_prompting_or_a_traceback(self):
        wheel, _ = self.runtime_artifacts()
        content = bytearray(wheel.read_bytes())
        central = content.index(b"PK\x01\x02")
        for offset in (6, central + 8):
            flags = struct.unpack_from("<H", content, offset)[0]
            struct.pack_into("<H", content, offset, flags | 1)
        wheel.write_bytes(content)
        output = self.base / "candidate"
        self.command("prepare", "runtime", "--artifacts", str(self.artifacts),
                     "--notes", str(self.notes), "--output", str(output), expected=2)
        self.assertFalse(output.exists())

    def test_prepare_preserves_existing_outputs_and_rejects_uncommitted_tracked_source(self):
        self.runtime_artifacts()
        output = self.base / "candidate"
        output.mkdir()
        sentinel = output / "keep.txt"
        sentinel.write_text("owner data")
        arguments = ("prepare", "runtime", "--artifacts", str(self.artifacts), "--notes", str(self.notes), "--output", str(output))
        self.command(*arguments, expected=2)
        self.assertEqual(sentinel.read_text(), "owner data")
        sentinel.unlink()
        output.rmdir()
        with (self.root / "hormuz/__init__.py").open("a") as stream:
            stream.write("# uncommitted source\n")
        self.command(*arguments, expected=2)
        self.assertFalse(output.exists())

    def test_prepare_cannot_attribute_untracked_nested_metadata_to_parent_commit(self):
        self.runtime_artifacts()
        original_root = self.root
        self.root = original_root / "nested"
        self.root.mkdir()
        self.metadata("2.0.0a2", "0.5.0")
        output = self.base / "candidate"
        try:
            self.command("prepare", "runtime", "--artifacts", str(self.artifacts),
                         "--notes", str(self.notes), "--output", str(output), expected=2)
        finally:
            self.root = original_root
        self.assertFalse(output.exists())

    def test_plugin_candidate_has_its_own_version_tag_and_a_verified_portable_bundle(self):
        self.runtime_artifacts()
        files = {
            "plugin.json": json.dumps({"name": "koto", "version": "0.5.0",
                                       "repository": "https://github.com/example/koto", "license": "Apache-2.0"}),
            ".agents/plugins/marketplace.json": json.dumps({"name": "koto", "plugins": [{"name": "koto", "source": {"source": "local", "path": "./"}}]}),
            ".claude-plugin/marketplace.json": json.dumps({"name": "koto", "plugins": [{"name": "koto", "source": "./"}]}),
            "LICENSE": "Apache License 2.0\n",
            "skills/koto/SKILL.md": "---\nname: koto\ndescription: Manage an explicit router.\n---\n",
        }
        for name, content in files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        self.git("add", ".")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Portable plugin")
        output = self.base / "candidate"
        self.command("prepare", "plugin", "--notes", str(self.notes), "--output", str(output))
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual((manifest["version"], manifest["tag"], manifest["channel"]),
                         ("0.5.0", "plugin-v0.5.0", "development"))
        self.assertIs(manifest["github_prerelease"], True)
        self.assertIs(manifest["make_latest"], False)
        self.assertEqual([item["name"] for item in manifest["artifacts"]], ["koto-plugin-0.5.0.zip"])
        self.assertEqual(self.command("verify", str(output))["component"], "plugin")

    def test_boolean_size_cannot_certify_a_one_byte_notes_file(self):
        output = self.prepared()
        path = output / "manifest.json"
        manifest = json.loads(path.read_text())
        (output / "release-notes.md").write_bytes(b"x")
        manifest["notes"].update(size_bytes=True, sha256=hashlib.sha256(b"x").hexdigest())
        path.write_text(json.dumps(manifest))
        self.reseal(output)
        result = self.command("verify", str(output), expected=2)
        self.assertIn("artifact record", result.stderr)


if __name__ == "__main__":
    unittest.main()
