"""Public maintainer-tool loader and a fake external check executor."""
import importlib.util
from pathlib import Path
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location(
    'koto_repair_feedback_candidate', Path(__file__).resolve().parents[1] / 'tools/local_repair_mcp.py')
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


def check_result(exit_code=0, *, timed_out=False):
    return {'check_exit_code': exit_code, 'timed_out': timed_out, 'stdout': '',
            'stderr': '' if exit_code == 0 else 'AssertionError: actual != expected'}


class MemoryProject:
    def __init__(self, source='value = 1\n'):
        self.source = source
        self.saves = []
        self.check = Mock(return_value=check_result())

    def read(self):
        return self.source

    def save(self, content):
        self.saves.append(content)
        self.source = content
