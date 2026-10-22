"""Historical treatments retain immutable identity and frozen request evidence."""
from copy import deepcopy
from dataclasses import FrozenInstanceError
import json
from pathlib import Path
import unittest

from hormuz.codex_llama import CodexLlamaRequest
from hormuz.coding_qualification import request_profile_digest
from tests.test_local_harness_v5_transport_fast import wire_digest


class LocalHarnessManifestTests(unittest.TestCase):
    def test_single_preparation_interface_preserves_native_bindings_and_rejects_unknown_profiles(self):
        from hormuz.local_harness_request import prepare_request

        fixture = json.loads((Path(__file__).parent / 'fixtures/local-harness-pre-manifest.json').read_text())
        native = CodexLlamaRequest(fixture['requests']['no_tool_history'])
        original = deepcopy(native.value)
        prepared = prepare_request(deepcopy(original), native.declarations, native.identities,
                                   native.original_tool_aliases, profile='qwen-code.v15')
        self.assertEqual(wire_digest(prepared.value),
                         fixture['profiles']['qwen-code.v15']['no_tool_history']['wire_sha256'])
        self.assertEqual(set(prepared.derived_checks), {'koto_python', 'koto_replace', 'koto_integer_checks'})
        self.assertEqual(prepared.derived_checks['koto_python']['target'], 'exec_command')
        self.assertEqual(prepared.derived_checks['koto_replace']['target'], 'apply_patch')
        self.assertEqual(native.value, original)
        with self.assertRaisesRegex(ValueError, 'unsupported_local_harness'):
            prepare_request(native.value, native.declarations, native.identities,
                            native.original_tool_aliases, profile='unreviewed')
        self.assertEqual(native.value, original)
        plain = prepare_request(deepcopy(original), native.declarations, native.identities,
                                native.original_tool_aliases, profile=None)
        self.assertEqual(plain.value, original)
        self.assertEqual(plain.derived_checks, {})

    def test_resolved_profiles_and_their_policies_cannot_be_changed(self):
        from hormuz.local_harness_profiles import PROFILE_MANIFESTS, resolve_profile

        manifest = resolve_profile('qwen-code.v15')
        self.assertEqual((manifest.name, manifest.capability, manifest.model),
                         ('qwen-code.v15', 'qwen_code_v15', 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M'))
        self.assertIs(PROFILE_MANIFESTS[manifest.name], manifest)
        for target, field, value in (
                (manifest, 'model', 'other-model'),
                (manifest.checkpoint, 'kind', 'none'),
                (manifest.compute, 'phase_caps', False),
                (manifest.helpers[0], 'kind', 'other-tool')):
            with self.subTest(field=field):
                with self.assertRaises(FrozenInstanceError):
                    setattr(target, field, value)
        with self.assertRaises(TypeError):
            PROFILE_MANIFESTS[manifest.name] = manifest
        with self.assertRaisesRegex(ValueError, 'unsupported_local_harness'):
            resolve_profile('qwen-code.v16')

    def test_all_historical_wire_outputs_and_qualification_fingerprints_stay_frozen(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/local-harness-pre-manifest.json').read_text())
        for profile, cases in fixture['profiles'].items():
            for name, expected in cases.items():
                with self.subTest(profile=profile, case=name):
                    request = fixture['requests'][name]
                    original = deepcopy(request)
                    value = CodexLlamaRequest(request, harness=profile).value
                    self.assertEqual(wire_digest(value), expected['wire_sha256'])
                    self.assertEqual(request_profile_digest(value), expected['qualification_sha256'])
                    self.assertEqual(request, original)
