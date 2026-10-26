"""Platform-specific acquisition through the public CLI with no real downloads."""
import json
from importlib import resources
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from hormuz.contracts import validate_contract
from tests.test_local_acquisition_workflow import artifacts


@unittest.skipUnless(os.name == "posix", "POSIX acquisition catalog selection")
class PortableAcquisitionWorkflowTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="koto-portable-acquisition-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.client_home = self.root / "codex-home"
        self.client_home.mkdir(mode=0o700)
        self.settings = self.client_home / "config.toml"
        self.settings.write_text('model = "existing-commercial-model"\n# preserved user settings\n')
        self.version = self.root / "client-version.txt"
        self.version.write_text("0.160.0")
        self.executable = self.root / "codex-fixture"
        self.executable.write_text(
            f"#!{sys.executable}\nfrom pathlib import Path\n"
            'print("codex-cli " + Path(__file__).with_name("client-version.txt").read_text().strip())\n')
        self.executable.chmod(0o700)
        self.assets = self.root / "assets"
        self.config = self.root / "configuration" / "koto.json"
        self.environment = {**os.environ, "KOTO_CONFIG": str(self.config),
                            "XDG_DATA_HOME": str(self.root / "data"),
                            "XDG_CONFIG_HOME": str(self.root / "settings"),
                            "CODEX_HOME": str(self.client_home)}

    def command(self, system, machine, *arguments, expected=0):
        # OS/architecture are observed at the external platform boundary; the
        # real catalog selection, validation and CLI stay intact.
        launcher = (f"import platform; platform.system=lambda:{system!r}; "
                    f"platform.machine=lambda:{machine!r}; "
                    "from hormuz.cli import main; raise SystemExit(main())")
        result = subprocess.run([sys.executable, "-c", launcher, *arguments],
                                env=self.environment, stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, timeout=12)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        value = json.loads(result.stdout if expected == 0 else result.stderr.splitlines()[-1])
        validate_contract(value)
        return value

    def preview(self, system, machine):
        return self.command(system, machine, "init", "--dry-run", "--executable", str(self.executable),
                            "--client-home", str(self.client_home), "--directory", str(self.assets))

    def test_linux_x86_64_bootstrap_previews_its_own_pinned_runtime_without_effects(self):
        before = self.settings.read_bytes()
        receipt = self.preview("Linux", "x86_64")
        self.assertEqual(receipt["catalog_id"], "codex0160-llamab11617-qwen3-4b-linux-x86_64-bootstrap-text-v1")
        self.assertEqual(receipt["artifacts"]["runtime"]["url"],
                         "https://github.com/ggml-org/llama.cpp/releases/download/b11617/llama-b11617-bin-ubuntu-x64.tar.gz")
        self.assertEqual(receipt["artifacts"]["runtime"]["sha256"],
                         "bc9c8bd3488e5778137c2289d951af60a94077a6bea51b7e30461033b084e07f")
        self.assertEqual(receipt["artifacts"]["runtime"]["size_bytes"], 17774259)
        self.assertEqual((receipt["operation"], receipt["state"], receipt["setup_arguments"]), ("preview", "planned", []))
        self.assertEqual(self.settings.read_bytes(), before)
        self.assertFalse(self.assets.exists())
        self.assertFalse(self.config.exists())
        self.assertFalse((self.root / "data").exists())

    def test_other_posix_bootstrap_hosts_select_their_own_pinned_runtime(self):
        cases = (
            ("Darwin", "x86_64", "macos-x64", 11650509,
             "1fb8882f87ba0a037b835067cd067c485fb65b460eaf8920017959e537cd168a"),
            ("Linux", "aarch64", "ubuntu-arm64", 13867801,
             "aa09fc805f53d06fb37eb0385c73c16816ba0036b1a8473de3b635c701012411"),
        )
        before = self.settings.read_bytes()
        for system, machine, archive, size, digest in cases:
            with self.subTest(system=system, machine=machine):
                receipt = self.preview(system, machine)
                self.assertEqual(receipt["catalog_id"],
                                 f"codex0160-llamab11617-qwen3-4b-{system.lower()}-{machine}-bootstrap-text-v1")
                runtime = receipt["artifacts"]["runtime"]
                self.assertEqual(runtime["url"],
                                 f"https://github.com/ggml-org/llama.cpp/releases/download/b11617/llama-b11617-bin-{archive}.tar.gz")
                self.assertEqual((runtime["size_bytes"], runtime["sha256"]), (size, digest))
                self.assertEqual(self.settings.read_bytes(), before)
                self.assertFalse(self.assets.exists())
                self.assertFalse(self.config.exists())

    def test_default_client_acquisition_uses_the_same_new_host_rows_as_bootstrap(self):
        for system, machine in (("Darwin", "x86_64"), ("Linux", "x86_64"), ("Linux", "aarch64")):
            with self.subTest(system=system, machine=machine):
                receipt = self.command(system, machine, "client", "acquire", "codex", "--dry-run",
                                       "--executable", str(self.executable), "--directory", str(self.assets))
                bootstrap = self.preview(system, machine)
                self.assertEqual(receipt["catalog_id"], bootstrap["catalog_id"])
                self.assertEqual(receipt["catalog_sha256"], bootstrap["catalog_sha256"])
                self.assertFalse(self.assets.exists())

    def test_unsupported_host_and_client_rows_stop_before_any_local_effect(self):
        before = self.settings.read_bytes()
        cases = (("FreeBSD", "x86_64", "0.160.0", "platform_unsupported"),
                 ("Linux", "armv7l", "0.160.0", "platform_unsupported"),
                 ("Linux", "arm64", "0.160.0", "platform_unsupported"),
                 ("Darwin", "i386", "0.160.0", "platform_unsupported"),
                 ("Windows", "AMD64", "0.160.0", "platform_unsupported"),
                 ("Linux", "x86_64", "0.162.0-alpha.17.2", "platform_unsupported"),
                 ("Linux", "x86_64", "0.999.0", "catalog_invalid"))
        for system, machine, version, code in cases:
            with self.subTest(system=system, machine=machine, client=version):
                self.version.write_text(version)
                result = self.command(system, machine, "init", "--yes", "--executable", str(self.executable),
                                      "--client-home", str(self.client_home), "--directory", str(self.assets), expected=2)
                self.assertEqual(result["error"]["code"], code)
                self.assertEqual(self.settings.read_bytes(), before)
                for path in (self.assets, self.config, self.root / "settings", self.root / "data"):
                    self.assertFalse(path.exists())

    def test_explicit_catalog_is_preserved_and_wrong_hosts_cannot_start_a_download(self):
        resource = resources.files("hormuz").joinpath(
            "local-acquisition-codex-0160-llama-b11617-qwen3-4b-linux-x86_64-text-v1.json")
        catalog = json.loads(resource.read_text())
        catalog["catalog_id"] = "synthetic-explicit-portable-catalog-v1"
        path = self.root / "explicit-catalog.json"
        before = self.settings.read_bytes()
        with artifacts({"/runtime": b"synthetic runtime", "/model": b"synthetic model"}) as (origin, observed, _):
            for role in ("runtime", "model"):
                catalog[role].update(url=origin + "/" + role, allowed_hosts=["127.0.0.1"])
            path.write_text(json.dumps(catalog))
            result = self.command("Linux", "x86_64", "client", "acquire", "codex", "--dry-run",
                                  "--catalog", str(path), "--directory", str(self.assets))
            self.assertEqual(result["catalog_id"], "synthetic-explicit-portable-catalog-v1")
            for system, machine in (("Darwin", "arm64"), ("Linux", "aarch64")):
                with self.subTest(system=system, machine=machine):
                    rejected = self.command(system, machine, "client", "acquire", "codex", "--download",
                                            "--catalog", str(path), "--executable", str(self.executable),
                                            "--directory", str(self.assets), expected=2)
                    self.assertEqual(rejected["error"]["code"], "platform_unsupported")
                    self.assertEqual(observed, [])
                    self.assertFalse(self.assets.exists())
                    self.assertEqual(self.settings.read_bytes(), before)

    def test_new_catalogs_keep_the_existing_bounded_text_contract_and_model(self):
        ids = set()
        for system, machine in (("Darwin", "x86_64"), ("Linux", "x86_64"), ("Linux", "aarch64")):
            with self.subTest(system=system, machine=machine):
                resource = resources.files("hormuz").joinpath(
                    f"local-acquisition-codex-0160-llama-b11617-qwen3-4b-{system.lower()}-{machine}-text-v1.json")
                catalog = json.loads(resource.read_text())
                validate_contract(catalog)
                profile = catalog["profile"]
                ids.add(profile["qualification_id"])
                self.assertEqual(profile["qualification_id"], catalog["catalog_id"])
                self.assertEqual((profile["system"], profile["machine"], profile["client_version"]),
                                 (system, machine, "0.160.0"))
                self.assertEqual(profile["schema_version"], 7)
                self.assertEqual(profile["task_types"], ["interactive"])
                self.assertIsNone(profile["coding_evidence"])
                self.assertEqual((profile["max_request_bytes"], profile["max_output_tokens"], profile["context_tokens"]),
                                 (4096, 2048, 8192))
                self.assertEqual((profile["startup_timeout_seconds"], profile["upstream_timeout_seconds"]), (120, 360))
                self.assertEqual(profile["runtime_sha256"], catalog["runtime"]["sha256"])
                self.assertEqual(catalog["model"]["sha256"],
                                 "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5")
                self.assertEqual(catalog["model"]["size_bytes"], 2497280256)
        self.assertEqual(len(ids), 3)

    def test_apple_silicon_keeps_its_original_bootstrap_and_generic_catalog_ids(self):
        self.assertEqual(self.preview("Darwin", "arm64")["catalog_id"],
                         "codex0160-llamab11617-qwen3-4b-bootstrap-text-v1")
        receipt = self.command("Darwin", "arm64", "client", "acquire", "codex", "--dry-run",
                               "--executable", str(self.executable), "--directory", str(self.assets))
        self.assertEqual(receipt["catalog_id"],
                         "codex0160-llamab11617-qwen3-4b-single-agent-http-experiment-v1")


if __name__ == "__main__":
    unittest.main()
