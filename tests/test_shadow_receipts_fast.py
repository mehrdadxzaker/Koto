"""Historical binary advice remains readable; new binary configurations retire explicitly."""
import json
from pathlib import Path
import unittest

from hormuz.contracts import contract_manifest, validate_contract


class ShadowRoutingCompatibilityTests(unittest.TestCase):
    def test_historical_shadow_and_setup_receipts_remain_readable(self):
        for name in ("shadow-routing-v1.json", "local-setup-v3.json"):
            validate_contract(json.loads((Path(__file__).parent / "fixtures" / name).read_text()))
        identities = {(row["schema_id"], row["schema_version"]) for row in contract_manifest()["schemas"]}
        self.assertIn(("hormuz.shadow-routing", 1), identities)
        self.assertIn(("hormuz.local-setup", 3), identities)

    def test_personal_selection_compatibility_examples_are_discoverable(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/personal-selection-v1.json").read_text())
        identities = {(row["schema_id"], row["schema_version"]) for row in contract_manifest()["schemas"]}
        for value in fixture["contracts"]:
            validate_contract(value)
            self.assertIn((value["schema_id"], value["schema_version"]), identities)
