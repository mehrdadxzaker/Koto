"""Pure public prompt, classifier and receipt rules; no network, files or processes."""
import copy
import unittest

from hormuz.contracts import ContractValidationError, validate_contract
from hormuz.personal_selection import predict, prompt_text


class PersonalSelectionFastTests(unittest.TestCase):
    def test_prompt_features_use_latest_user_text_within_utf8_byte_limit(self):
        cases = [
            ("latest user only", {"messages": [
                {"role": "user", "content": "earlier user text"},
                {"role": "assistant", "content": "earlier assistant text"},
                {"role": "user", "content": "latest user text"},
                {"role": "assistant", "content": "later assistant text"},
            ]}, "latest user text"),
            ("ordered text parts ignore image", {"messages": [
                {"role": "user", "content": [
                    {"type": "input_text", "text": "first line"},
                    {"type": "input_image", "image_url": "data:image/png;base64,AA==",
                     "text": "ignored image text"},
                    {"type": "text", "text": "second line"},
                ]},
            ]}, "first line\nsecond line"),
            ("ASCII at byte limit", {"input": "a" * 8192}, "a" * 8192),
            ("ASCII above byte limit", {"input": "a" * 8193}, ""),
            ("multibyte at byte limit", {"input": "é" * 4096}, "é" * 4096),
            ("multibyte above byte limit", {"input": "é" * 4097}, ""),
            ("empty request", {}, ""),
            ("image only", {"input": [
                {"type": "input_image", "image_url": "data:image/png;base64,AA=="},
            ]}, ""),
            ("assistant only", {"messages": [
                {"role": "assistant", "content": "not user features"},
            ]}, ""),
        ]
        for name, value, expected in cases:
            with self.subTest(case=name):
                self.assertEqual(prompt_text(value), expected)

    def test_nearest_model_choice_abstains_for_unknown_ambiguous_or_ineligible_work(self):
        examples = [{"text": "invoice tally seven boxes", "model": "local-fast", "task": "a" * 64},
                    {"text": "inventory report nine crates", "model": "local-code", "task": "b" * 64}]
        cases = [("invoice tally seven boxes today", {"local-fast", "local-code"}, "local-fast"),
                 ("INVOICE TALLY SEVEN BOXES TODAY", {"local-fast", "local-code"}, "local-fast"),
                 ("invoice,tally;seven/boxes!today", {"local-fast", "local-code"}, "local-fast"),
                 ("inventory report nine crates today", {"local-fast", "local-code"}, "local-code"),
                 ("translate bonjour", {"local-fast", "local-code"}, None),
                 ("invoice tally seven boxes", {"local-code"}, None),
                 ("", {"local-fast"}, None),
                 ("!?.,;:-_()", {"local-fast", "local-code"}, None)]
        for text, eligible, expected in cases:
            with self.subTest(text=text, eligible=eligible):
                self.assertEqual(predict(examples, text, eligible)[0], expected)
        conflicting = [*examples, {"text": "invoice tally seven boxes", "model": "cloud", "task": "c" * 64}]
        self.assertIsNone(predict(conflicting, "invoice tally seven boxes", {"local-fast", "cloud"})[0])

    def test_evaluation_receipts_reject_booleans_disguised_as_resource_limits(self):
        value = {"schema_id": "koto.personal-selection-evaluation", "schema_version": 1,
                 "planned": 0, "submitted": 0, "passed": 0, "observations": [],
                 "retries": 0, "concurrency": 1, "local_only": True}
        validate_contract(value)
        for field, invalid in (("concurrency", True), ("retries", False), ("planned", False)):
            with self.subTest(field=field):
                bad = copy.deepcopy(value)
                bad[field] = invalid
                with self.assertRaises(ContractValidationError):
                    validate_contract(bad)
