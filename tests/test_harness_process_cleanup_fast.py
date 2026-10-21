"""A signal-permission race is safe only after the owned child is reaped."""
import errno
import importlib.util
from pathlib import Path
import signal
import subprocess
import unittest
from unittest.mock import Mock, call, patch


def comparison_tool():
    path = Path(__file__).resolve().parents[1] / 'tools/compare_local_harness.py'
    spec = importlib.util.spec_from_file_location('harness_cleanup_comparison', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class HarnessProcessCleanupTests(unittest.TestCase):
    def setUp(self):
        self.tool = comparison_tool()
        self.process = Mock(pid=314159, returncode=None)
        self.process.wait.return_value = 0
        self.denied = PermissionError(errno.EPERM, 'Operation not permitted')

    def test_exited_child_permission_race_after_term_is_reaped(self):
        with patch.object(self.tool.os, 'killpg', side_effect=[None, self.denied]) as kill:
            self.tool.stop(self.process)
        self.assertEqual(kill.call_args_list,
                         [call(self.process.pid, signal.SIGTERM), call(self.process.pid, signal.SIGKILL)])
        self.assertGreaterEqual(self.process.wait.call_count, 2)
        self.assertTrue(all(item == call(timeout=2) for item in self.process.wait.call_args_list))

    def test_permission_race_before_first_signal_waits_for_exit(self):
        self.process.wait.return_value = 7
        with patch.object(self.tool.os, 'killpg', side_effect=self.denied) as kill:
            self.tool.stop(self.process)
        kill.assert_called_once_with(self.process.pid, signal.SIGTERM)
        self.process.wait.assert_any_call(timeout=2)

    def test_live_permission_denial_preserves_error_after_bounded_wait(self):
        self.process.wait.side_effect = subprocess.TimeoutExpired('owned child', 2)
        with patch.object(self.tool.os, 'killpg', side_effect=self.denied) as kill:
            with self.assertRaises(PermissionError) as raised:
                self.tool.stop(self.process)
        self.assertIs(raised.exception, self.denied)
        self.process.wait.assert_called_once_with(timeout=2)
        kill.assert_called_once_with(self.process.pid, signal.SIGTERM)

    def test_live_permission_denial_during_kill_is_not_an_exit(self):
        self.process.wait.side_effect = subprocess.TimeoutExpired('owned child', 2)
        with patch.object(self.tool.os, 'killpg', side_effect=[None, self.denied]):
            with self.assertRaises(PermissionError) as raised:
                self.tool.stop(self.process)
        self.assertIs(raised.exception, self.denied)
        self.assertEqual(self.process.wait.call_args_list, [call(timeout=2), call(timeout=2)])

    def test_already_exited_leader_does_not_skip_group_descendant_cleanup(self):
        self.process.returncode = 0
        self.process.poll.return_value = 0
        with patch.object(self.tool.os, 'killpg') as kill:
            self.tool.stop(self.process)
        self.assertEqual(kill.call_args_list,
                         [call(self.process.pid, signal.SIGTERM), call(self.process.pid, signal.SIGKILL)])
        self.process.poll.assert_not_called()

    def test_timeout_keeps_finite_term_then_kill_escalation(self):
        self.process.wait.side_effect = [subprocess.TimeoutExpired('owned child', 2), 0, 0]
        with patch.object(self.tool.os, 'killpg') as kill:
            self.tool.stop(self.process)
        self.assertEqual(kill.call_args_list,
                         [call(self.process.pid, signal.SIGTERM), call(self.process.pid, signal.SIGKILL)])
        self.assertEqual(self.process.wait.call_args_list, [call(timeout=2)] * 3)

    def test_missing_group_still_reaps_owned_child(self):
        with patch.object(self.tool.os, 'killpg', side_effect=ProcessLookupError()) as kill:
            self.tool.stop(self.process)
        kill.assert_called_once_with(self.process.pid, signal.SIGTERM)
        self.process.wait.assert_called_once_with(timeout=2)

    def test_other_signal_errors_are_not_swallowed(self):
        failure = OSError(errno.EIO, 'signal failure')
        with patch.object(self.tool.os, 'killpg', side_effect=failure):
            with self.assertRaises(OSError) as raised:
                self.tool.stop(self.process)
        self.assertIs(raised.exception, failure)
        self.process.wait.assert_not_called()


if __name__ == '__main__':
    unittest.main()
