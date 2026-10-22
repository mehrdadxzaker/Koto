"""Configuration selection rules use no subprocess or router fixture."""
from contextlib import chdir
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from hormuz.config import ConfigError
from hormuz.config_location import resolve_config, router_home, user_asset_directory


class ConfigLocationTests(unittest.TestCase):
    def test_user_default_ignores_working_directory_files_and_dangling_links(self):
        with tempfile.TemporaryDirectory() as directory, chdir(directory), patch.dict(os.environ, {}, clear=True):
            expected = Path.home() / ".config/koto/config.json"
            self.assertEqual(resolve_config(), expected)
            Path("hormuz.json").write_text("{}")
            self.assertEqual(resolve_config(), expected)
            Path("koto.json").write_text("{}")
            self.assertEqual(resolve_config(), expected)
            Path("koto.json").unlink()
            Path("koto.json").symlink_to("missing-config.json")
            self.assertEqual(resolve_config(), expected)

    def test_explicit_selection_precedes_environment_and_legacy_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            new, old = root / "new.json", root / "old.json"
            cases = [
                ("new-over-legacy", {"KOTO_CONFIG": str(new), "HORMUZ_CONFIG": str(old)}, {}, new),
                ("legacy", {"HORMUZ_CONFIG": str(old)}, {}, old),
                ("explicit-relative", {"KOTO_CONFIG": str(new)}, {"explicit": "./explicit.json"}, Path.cwd() / "explicit.json"),
                ("project", {"KOTO_CONFIG": str(new)}, {"project": directory}, root / ".koto/config.json"),
                ("xdg", {"XDG_CONFIG_HOME": directory}, {}, root / "koto/config.json"),
            ]
            for name, environment, options, expected in cases:
                with self.subTest(name=name), patch.dict(os.environ, environment, clear=True):
                    self.assertEqual(resolve_config(**options), expected)
                    self.assertFalse(expected.exists())

    def test_relative_environment_paths_are_rejected_and_assets_have_a_user_default(self):
        for name in ("KOTO_CONFIG", "HORMUZ_CONFIG", "XDG_CONFIG_HOME"):
            with self.subTest(name=name), patch.dict(os.environ, {name: "relative.json"}, clear=True):
                with self.assertRaises(ConfigError):
                    resolve_config()
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(user_asset_directory(), Path.home() / ".local/share/koto/assets")
        with patch.dict(os.environ, {"XDG_DATA_HOME": "relative"}, clear=True):
            with self.assertRaises(ConfigError):
                user_asset_directory()

    def test_control_home_is_bound_to_the_selected_config_without_following_its_link(self):
        with tempfile.TemporaryDirectory() as directory, chdir(directory):
            Path("selected.json").symlink_to("missing.json")
            self.assertEqual(router_home("selected.json"), Path.cwd() / "selected.json.codex")


if __name__ == "__main__":
    unittest.main()
