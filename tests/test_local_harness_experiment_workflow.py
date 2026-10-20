"""The maintainer comparison retains failures and starts each episode clean."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest


def experiment():
    path = Path(__file__).resolve().parents[1] / 'tools/compare_local_harness.py'
    spec = importlib.util.spec_from_file_location('local_harness_comparison', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LocalHarnessExperimentTests(unittest.TestCase):
    def test_next_episode_cannot_inherit_authored_tests_or_follow_directory_links(self):
        tool = experiment()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = root / 'project'
            project.mkdir()
            (project / 'solution.py').write_text('changed')
            (project / 'test_previous.py').write_text('previous model context')
            (project / '__pycache__').mkdir()
            (project / '__pycache__/cached.pyc').write_bytes(b'old bytecode')
            outside = root / 'outside'
            outside.mkdir()
            (outside / 'keep').write_text('preserve')
            (project / 'linked').symlink_to(outside, target_is_directory=True)
            tool.reset_project(project, 'def repaired(): pass\n')
            self.assertEqual([path.name for path in project.iterdir()], ['solution.py'])
            self.assertEqual((project / 'solution.py').read_text(), 'def repaired(): pass\n')
            self.assertEqual((outside / 'keep').read_text(), 'preserve')

    @unittest.skipUnless(sys.platform == 'darwin', 'Real macOS sandbox checker')
    def test_checker_timeout_deleted_source_and_runtime_errors_are_retained(self):
        tool = experiment()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'solution.py'
            source.write_text('value = 1\n')
            checks = root / 'checks.py'
            checks.write_text('import time\ntime.sleep(10)\n')
            result = tool.independent_check(checks, source, python=sys.executable,
                                             environment=os.environ, timeout=0.2)
            self.assertEqual(result['termination'], 'timeout')
            self.assertNotEqual(result['exit_code'], 0)
            source.unlink()
            missing = tool.independent_check(checks, source, python=sys.executable, environment=os.environ)
            self.assertEqual((missing['termination'], missing['exit_code']), ('missing_source', 2))
            source.write_text('value = 1\n')
            checks.write_text('raise RuntimeError("generated code error")\n')
            error = tool.independent_check(checks, source, python=sys.executable, environment=os.environ)
            self.assertEqual(error['termination'], 'completed')
            self.assertNotEqual(error['exit_code'], 0)
            self.assertIn('generated code error', error['stderr'])


if __name__ == '__main__':
    unittest.main()
