"""Versioned startup limits stay bounded without widening historical profiles."""
import json
from pathlib import Path
import unittest

from hormuz.contracts import ContractValidationError, contract_manifest, validate_contract


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
