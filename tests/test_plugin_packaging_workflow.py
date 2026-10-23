"""Portable plugin archives exercised through the maintainer CLI."""
from pathlib import Path
import hashlib
import json
import stat
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile


TOOL = Path(__file__).resolve().parents[1] / "tools/package_plugin.py"
FIXTURE = Path(__file__).resolve().parent / "fixtures/plugin-bundle-v1.json"


class FrozenPluginCompatibilityTests(unittest.TestCase):
    def test_frozen_v1_bundle_remains_verifiable_with_its_original_versions_and_inventory(self):
        fixture = json.loads(FIXTURE.read_text())
        with tempfile.TemporaryDirectory(prefix="koto-frozen-plugin-") as temporary:
            root = Path(temporary)
            archive = root / "frozen-plugin.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                for name, text in fixture["entries_utf8"].items():
                    row = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                    row.create_system = 3
                    row.external_attr = (stat.S_IFREG | 0o644) << 16
                    bundle.writestr(row, text.encode("utf-8"))
                row = zipfile.ZipInfo("koto-plugin-manifest.json", (1980, 1, 1, 0, 0, 0))
                row.create_system = 3
                row.external_attr = (stat.S_IFREG | 0o644) << 16
                bundle.writestr(row, json.dumps(fixture["manifest"]).encode("utf-8"))
            result = subprocess.run([sys.executable, str(TOOL), "--root", str(root / "no-checkout"),
                "--verify", str(archive), "--version", "0.4.0"],
                cwd=root, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            receipt = json.loads(result.stdout)
            self.assertEqual(receipt, fixture["manifest"])
            self.assertEqual((receipt["schema_version"], receipt["plugin_version"], receipt["runtime_version"],
                              receipt["runtime_requirement"], len(receipt["files"])),
                             (1, "0.4.0", "2.0.0a1", "==2.0.0a1", 7))
            self.assertFalse((root / "skills").exists())
            self.assertFalse((root / "no-checkout").exists())


class PluginPackagingWorkflowTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="koto-plugin-package-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "source"
        self.root.mkdir()
        self.output = self.root.parent / "plugin.zip"
        self.files = {
            "pyproject.toml": '[project]\nname = "koto-router"\nversion = "2.0.0a2"\n',
            "hormuz/__init__.py": '__version__ = "2.0.0a2"\n',
            "hormuz/example.py": '"""Repository source stays outside the plugin."""\n',
            "plugin.json": json.dumps({"name": "koto", "version": "0.5.0",
                "repository": "https://github.com/example/koto", "license": "Apache-2.0",
                "extensions": {"com.openai": {"onboardingSkill": "./skills/koto/SKILL.md"}}}) + "\n",
            ".claude-plugin/plugin.json": '{"name":"koto","version":"0.5.0"}\n',
            "gemini-extension.json": '{"name":"koto","version":"0.5.0"}\n',
            ".agents/plugins/marketplace.json": '{"name":"koto","plugins":[{"name":"koto","source":{"source":"local","path":"./"}}]}\n',
            ".claude-plugin/marketplace.json": '{"name":"koto","plugins":[{"name":"koto","source":"./"}]}\n',
            "LICENSE": "Apache License\nVersion 2.0, January 2004\n",
            "README.md": "# Koto\n\n[Workflow](skills/koto/SKILL.md) and [source](hormuz/example.py).\n",
            "skills/koto/SKILL.md": "---\nname: koto\ndescription: Manage an explicit local router.\n---\n\n[Usage](../../docs/usage.md)\n",
            "docs/usage.md": "# Usage\n\n[Home](../README.md)\n",
        }
        for name, content in self.files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        self.git("init", "--quiet")
        self.git("add", ".")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "--quiet", "-m", "Fixture package")
        self.commit = self.git("rev-parse", "HEAD").stdout.strip()

    def git(self, *arguments):
        return subprocess.run(["git", "-C", str(self.root), *arguments],
            capture_output=True, text=True, check=True, timeout=10)

    def command(self, *arguments, expected=0):
        result = subprocess.run([sys.executable, str(TOOL), "--root", str(self.root), *arguments],
            cwd=self.root.parent, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return json.loads(result.stdout) if expected == 0 else result

    def test_archive_is_reproducible_installable_and_pins_its_runtime_and_source(self):
        before = {name: (self.root / name).read_bytes() for name in self.files}
        self.command("--output", str(self.output))
        second = self.root.parent / "second.zip"
        self.command("--output", str(second))
        self.assertEqual(self.output.read_bytes(), second.read_bytes())
        receipt = self.command("--verify", str(self.output), "--version", "0.5.0")
        self.assertEqual((receipt["plugin_version"], receipt["runtime_version"],
                          receipt["runtime_requirement"], receipt["source_commit"], receipt["license"]),
                         ("0.5.0", "2.0.0a2", "==2.0.0a2", self.commit, "Apache-2.0"))
        with zipfile.ZipFile(self.output) as archive:
            self.assertIn("skills/koto/SKILL.md", archive.namelist())
            self.assertIn(".agents/plugins/marketplace.json", archive.namelist())
            self.assertNotIn("hormuz/example.py", archive.namelist())
            self.assertIn(("https://github.com/example/koto/blob/" + self.commit + "/hormuz/example.py").encode(),
                          archive.read("README.md"))
            self.assertIn(b"../../docs/usage.md", archive.read("skills/koto/SKILL.md"))
            self.assertEqual(archive.read("LICENSE"), before["LICENSE"])
            manifest = json.loads(archive.read("koto-plugin-manifest.json"))
            license_record = next(row for row in manifest["files"] if row["path"] == "LICENSE")
            self.assertEqual(license_record["sha256"], hashlib.sha256(before["LICENSE"]).hexdigest())
            extracted = self.root.parent / "installed"
            archive.extractall(extracted)
        self.assertEqual((extracted / "docs/usage.md").read_text(), "# Usage\n\n[Home](../README.md)\n")
        self.assertEqual({name: (self.root / name).read_bytes() for name in self.files}, before)

    def test_untracked_targets_cannot_be_disguised_as_immutable_repository_links(self):
        (self.root / "private-note.txt").write_text("A private untracked note.\n")
        (self.root / "README.md").write_text("[Required source](private-note.txt)\n")
        self.git("add", "README.md")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "--quiet", "-m", "A link must resolve at the declared revision")
        result = self.command("--output", str(self.output), expected=2)
        self.assertIn("link", result.stderr)
        self.assertFalse(self.output.exists())

    def test_repository_source_links_keep_their_labels_and_use_the_exact_commit(self):
        (self.root / "README.md").write_text("[hormuz/example.py](hormuz/example.py)\n")
        self.git("add", "README.md")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "--quiet", "-m", "Show a source filename")
        commit = self.git("rev-parse", "HEAD").stdout.strip()
        self.command("--output", str(self.output))
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(archive.read("README.md").decode(),
                f"[hormuz/example.py](https://github.com/example/koto/blob/{commit}/hormuz/example.py)\n")

    def test_verification_rejects_tampering_unsafe_members_and_invalid_versioned_metadata(self):
        self.command("--output", str(self.output))
        with zipfile.ZipFile(self.output) as archive:
            original = [(row, archive.read(row)) for row in archive.infolist()]
        for case in ("tamper", "duplicate", "traversal", "symlink", "schema-bool", "runtime-version"):
            with self.subTest(case=case):
                modified = self.root.parent / (case + ".zip")
                with zipfile.ZipFile(modified, "w") as archive:
                    for row, data in original:
                        if row.filename == "LICENSE" and case == "tamper":
                            data = b"Changed license content.\n"
                        if row.filename == "koto-plugin-manifest.json" and case in ("schema-bool", "runtime-version"):
                            manifest = json.loads(data)
                            if case == "schema-bool":
                                manifest["schema_version"] = True
                            else:
                                manifest.update(runtime_version="not-a-version", runtime_requirement="==not-a-version")
                            data = json.dumps(manifest).encode()
                        archive.writestr(row, data)
                    if case in ("duplicate", "traversal", "symlink"):
                        name = "LICENSE" if case == "duplicate" else "../outside" if case == "traversal" else "docs/link.md"
                        row = zipfile.ZipInfo(name)
                        row.create_system = 3
                        row.external_attr = ((stat.S_IFLNK if case == "symlink" else stat.S_IFREG) | 0o644) << 16
                        with warnings.catch_warnings():
                            warnings.simplefilter("ignore", UserWarning)
                            archive.writestr(row, b"outside")
                result = self.command("--verify", str(modified), "--version", "0.5.0", expected=2)
                self.assertNotIn("Traceback", result.stderr)
        self.assertFalse((self.root.parent / "outside").exists())

    def test_file_sizes_are_integers_rather_than_boolean_assertions(self):
        (self.root / "docs/usage.md").write_text("x")
        self.git("add", "docs/usage.md")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "--quiet", "-m", "One-byte documentation")
        self.command("--output", str(self.output))
        modified = self.root.parent / "boolean-size.zip"
        with zipfile.ZipFile(self.output) as source, zipfile.ZipFile(modified, "w") as archive:
            for row in source.infolist():
                data = source.read(row)
                if row.filename == "koto-plugin-manifest.json":
                    manifest = json.loads(data)
                    next(item for item in manifest["files"] if item["path"] == "docs/usage.md")["size_bytes"] = True
                    data = json.dumps(manifest).encode()
                archive.writestr(row, data)
        self.command("--verify", str(modified), "--version", "0.5.0", expected=2)

    def test_packaging_preserves_existing_output_and_rejects_uncommitted_source(self):
        self.output.write_bytes(b"Existing artifact must stay untouched.")
        self.command("--output", str(self.output), expected=2)
        self.assertEqual(self.output.read_bytes(), b"Existing artifact must stay untouched.")
        self.output.unlink()
        (self.root / "README.md").write_text("Uncommitted source cannot claim the old revision.\n")
        self.command("--output", str(self.output), expected=2)
        self.assertFalse(self.output.exists())

    def test_missing_and_escaping_document_links_cannot_be_hidden_by_external_urls(self):
        outside = self.root.parent / "outside.txt"
        outside.write_text("Preserve this external file.\n")
        for target in ("does-not-exist.py", "../outside.txt", "/etc/passwd", "%2e%2e/outside.txt"):
            with self.subTest(target=target):
                (self.root / "README.md").write_text(f"[Source]({target})\n")
                self.git("add", "README.md")
                self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                         "commit", "--quiet", "-m", "Unsafe link fixture")
                self.command("--output", str(self.output), expected=2)
                self.assertFalse(self.output.exists())
        self.assertEqual(outside.read_text(), "Preserve this external file.\n")

    def test_source_symlinks_are_rejected_without_following_their_targets(self):
        outside = self.root.parent / "private.md"
        outside.write_text("Private external fixture.\n")
        (self.root / "docs/usage.md").unlink()
        (self.root / "docs/usage.md").symlink_to(outside)
        self.git("add", "docs/usage.md")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "--quiet", "-m", "Symlink fixture")
        self.command("--output", str(self.output), expected=2)
        self.assertFalse(self.output.exists())
        self.assertEqual(outside.read_text(), "Private external fixture.\n")

    def test_oversized_archive_members_are_refused_without_extraction(self):
        self.command("--output", str(self.output))
        modified = self.root.parent / "oversized.zip"
        with zipfile.ZipFile(self.output) as source, zipfile.ZipFile(modified, "w") as archive:
            for row in source.infolist():
                archive.writestr(row, source.read(row))
            row = zipfile.ZipInfo("docs/oversized.md")
            row.create_system = 3
            row.external_attr = (stat.S_IFREG | 0o644) << 16
            row.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(row, b"x" * (8 * 1024 * 1024 + 1))
        self.command("--verify", str(modified), "--version", "0.5.0", expected=2)
        self.assertFalse((self.root.parent / "docs").exists())

    def test_runtime_tools_hooks_weights_and_untracked_files_do_not_enter_the_plugin(self):
        forbidden = {".env": "SYNTHETIC_SECRET=not-a-real-credential\n", "tools/installer.py": "raise RuntimeError()\n",
                     "models/example.gguf": "Not actual model weights.\n", "hooks/start.sh": "exit 99\n"}
        for name, content in forbidden.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        self.git("add", ".")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "--quiet", "-m", "Non-plugin source")
        (self.root / "private.md").write_text("Untracked content must stay local.\n")
        self.command("--output", str(self.output))
        with zipfile.ZipFile(self.output) as archive:
            for name in {*forbidden, "private.md", "hormuz/__init__.py", "pyproject.toml"}:
                self.assertNotIn(name, archive.namelist())

    def test_escaped_manifest_keys_cannot_add_executable_activation(self):
        (self.root / "gemini-extension.json").write_text(
            '{"name":"koto","version":"0.5.0","\\u0068ooks":{"onload":"run"}}\n')
        self.git("add", "gemini-extension.json")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "--quiet", "-m", "Escaped executable wiring")
        self.command("--output", str(self.output), expected=2)
        self.assertFalse(self.output.exists())

    def test_windows_drive_paths_are_unsafe_even_with_a_coherent_inventory(self):
        self.command("--output", str(self.output))
        modified = self.root.parent / "drive-path.zip"
        name, content = "C:README.md", b"x"
        with zipfile.ZipFile(self.output) as source, zipfile.ZipFile(modified, "w") as archive:
            for row in source.infolist():
                data = source.read(row)
                if row.filename == "koto-plugin-manifest.json":
                    manifest = json.loads(data)
                    manifest["files"].append({"path": name, "size_bytes": 1,
                                              "sha256": hashlib.sha256(content).hexdigest()})
                    manifest["files"].sort(key=lambda value: value["path"])
                    data = json.dumps(manifest).encode()
                archive.writestr(row, data)
            row = zipfile.ZipInfo(name)
            row.create_system = 3
            row.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(row, content)
        self.command("--verify", str(modified), "--version", "0.5.0", expected=2)

    def test_reference_style_links_resolve_inside_the_archive_or_at_the_pinned_source(self):
        (self.root / "README.md").write_text(
            "[Usage][usage] and [Source][code]\n\n[usage]: docs/usage.md\n[code]: hormuz/example.py\n")
        self.git("add", "README.md")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "--quiet", "-m", "Reference-style documentation")
        commit = self.git("rev-parse", "HEAD").stdout.strip()
        self.command("--output", str(self.output))
        with zipfile.ZipFile(self.output) as archive:
            text = archive.read("README.md").decode()
            self.assertIn("[usage]: docs/usage.md", text)
            self.assertIn(f"[code]: https://github.com/example/koto/blob/{commit}/hormuz/example.py", text)
        (self.root / "README.md").write_text("[Missing][missing]\n\n[missing]: missing.py\n")
        self.git("add", "README.md")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "--quiet", "-m", "Missing reference-style target")
        self.command("--output", str(self.root.parent / "missing.zip"), expected=2)


if __name__ == "__main__":
    unittest.main()
