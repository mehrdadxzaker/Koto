"""Versioned startup limits stay bounded without widening historical profiles."""
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from hormuz.contracts import ContractValidationError, contract_manifest, validate_contract
from hormuz.managed_llama import ManagedLlamaProfile, runtime_arguments


class BootstrapProfileTests(unittest.TestCase):
    def profile(self, version):
        return json.loads((Path(__file__).parent / f"fixtures/local-setup-profile-v{version}.json").read_text())

    def test_version_six_accepts_a_bounded_text_startup_without_coding_evidence(self):
        profile = self.profile(6)
        validate_contract(profile)
        self.assertTrue(any(item["schema_id"] == "hormuz.local-setup-profile" and item["schema_version"] == 6
                            for item in contract_manifest()["schemas"]))
        for change in ({"startup_timeout_seconds": 121}, {"task_types": ["code_change"]}, {"coding_evidence": {}}):
            with self.subTest(change=change), self.assertRaises(ContractValidationError):
                validate_contract({**profile, **change})

    def test_historical_profiles_keep_their_sixty_second_limit(self):
        for version in range(1, 6):
            with self.subTest(version=version):
                profile = self.profile(version)
                validate_contract(profile)
                with self.assertRaises(ContractValidationError):
                    validate_contract({**profile, "startup_timeout_seconds": 61})

    def test_version_seven_binds_a_smaller_context_and_rejects_invalid_or_legacy_shapes(self):
        profile = self.profile(7)
        validate_contract(profile)
        for change in ({"context_tokens": 0}, {"context_tokens": True}, {"context_tokens": 32769},
                       {"max_output_tokens": 8192, "context_tokens": 4096}, {"schema_version": 6},
                       {"max_request_bytes": 5121}, {"max_request_bytes": 4096, "max_output_tokens": 3073}):
            with self.subTest(change=change), self.assertRaises(ContractValidationError):
                validate_contract({**profile, **change})
        validate_contract({**profile, "max_request_bytes": 5120})
        validate_contract({**profile, "max_request_bytes": 4096, "max_output_tokens": 3072})

    def test_only_the_new_bootstrap_runtime_avoids_gpu_offload_on_confirmed_macos_vms(self):
        cases = [("bootstrap-vm", 5, "darwin", "1\n", True),
                 ("physical-mac", 5, "darwin", "0\n", False),
                 ("unknown-mac", 5, "darwin", "unknown\n", False),
                 ("other-platform", 5, "linux", "1\n", False),
                 *((f"historical-v{version}", version, "darwin", "1\n", False) for version in range(1, 5))]
        for name, version, platform, observed, cpu in cases:
            value = json.loads((Path(__file__).parent / f"fixtures/managed-llama-profile-v{version}.json").read_text())
            profile = ManagedLlamaProfile(**value, port=12345, alias="local-code", output_tokens=2048)
            with self.subTest(name=name), patch("hormuz.managed_llama.sys.platform", platform), \
                    patch("hormuz.managed_llama.subprocess.run", return_value=subprocess.CompletedProcess(
                        [], 0, observed, "")) as probe:
                command = runtime_arguments(profile)
                self.assertEqual("--n-gpu-layers" in command, cpu)
                if cpu:
                    self.assertEqual(command[command.index("--n-gpu-layers") + 1], "0")
                if version == 5 and platform == "darwin":
                    probe.assert_called_once()
                    self.assertEqual(probe.call_args.args[0], ["/usr/sbin/sysctl", "-n", "kern.hv_vmm_present"])
                    self.assertLessEqual(probe.call_args.kwargs["timeout"], 2)
                else:
                    probe.assert_not_called()

    def test_unavailable_vm_probe_preserves_automatic_selection_without_retry(self):
        value = json.loads((Path(__file__).parent / "fixtures/managed-llama-profile-v5.json").read_text())
        profile = ManagedLlamaProfile(**value, port=12345, alias="local-code", output_tokens=2048)
        for observed in (OSError("unavailable"), subprocess.TimeoutExpired("sysctl", 2),
                         subprocess.CompletedProcess([], 1, "1\n", "denied")):
            with self.subTest(observed=observed), patch("hormuz.managed_llama.sys.platform", "darwin"), \
                    patch("hormuz.managed_llama.subprocess.run", **(
                        {"side_effect": observed} if isinstance(observed, Exception) else {"return_value": observed})) as probe:
                self.assertNotIn("--n-gpu-layers", runtime_arguments(profile))
                probe.assert_called_once()
