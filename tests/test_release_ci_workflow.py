"""Candidate CI admission through the maintainer command and API evidence files."""
from pathlib import Path
import copy
import json
import subprocess
import sys
import tempfile
import unittest


TOOL = Path(__file__).resolve().parents[1] / 'tools' / 'verify_release_ci.py'
SOURCE = 'a' * 40


class ReleaseCIWorkflowTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='koto-release-ci-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.run = {
            'id': 42, 'run_attempt': 1, 'repository': {'full_name': 'example/koto'},
            'head_sha': SOURCE, 'head_branch': 'main', 'event': 'push',
            'path': '.github/workflows/ci.yml', 'status': 'completed', 'conclusion': 'success',
        }
        names = ['Build router distributions', 'CI / required',
                 'Router workflow (Python 3.11)', 'Router workflow (Python 3.12)',
                 'Router workflow (Python 3.13)', 'Router workflow (Python 3.14)']
        self.jobs = {'total_count': 6, 'jobs': [
            {'id': number, 'run_id': 42, 'name': name, 'status': 'completed', 'conclusion': 'success'}
            for number, name in enumerate(names, 100)
        ]}

    def command(self):
        for name, document in [('run.json', self.run), ('jobs.json', self.jobs)]:
            (self.root / name).write_text(json.dumps(document), encoding='utf-8')
        return subprocess.run(
            [sys.executable, str(TOOL), '--repository', 'example/koto', '--source', SOURCE,
             str(self.root / 'run.json'), str(self.root / 'jobs.json')],
            cwd=self.root, capture_output=True, text=True, timeout=10)

    def test_full_exact_main_ci_admits_a_candidate_without_granting_publication(self):
        result = self.command()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout), {
            'schema_id': 'koto.release-ci', 'schema_version': 1, 'repository': 'example/koto',
            'source_commit': SOURCE, 'ci_run_id': 42, 'run_attempt': 1,
            'status': 'passed', 'publishing_approved': False,
        })

    def test_other_repository_or_mixed_run_jobs_cannot_supply_release_evidence(self):
        self.run['repository']['full_name'] = 'someone-else/koto'
        result = self.command()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual(result.stdout, '')
        self.run['repository']['full_name'] = 'example/koto'
        self.jobs['jobs'][0]['run_id'] = 43
        result = self.command()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual(result.stdout, '')

    def test_malformed_identifiers_and_repeated_jobs_cannot_certify_ci(self):
        original_run, original_jobs = copy.deepcopy(self.run), copy.deepcopy(self.jobs)
        for invalid in ('boolean_run', 'boolean_attempt', 'duplicate_job', 'short_commit'):
            with self.subTest(invalid=invalid):
                self.run, self.jobs = copy.deepcopy(original_run), copy.deepcopy(original_jobs)
                if invalid == 'boolean_run':
                    self.run['id'] = True
                    for job in self.jobs['jobs']:
                        job['run_id'] = True
                elif invalid == 'boolean_attempt':
                    self.run['run_attempt'] = True
                elif invalid == 'duplicate_job':
                    self.jobs['jobs'][1]['id'] = self.jobs['jobs'][0]['id']
                else:
                    self.run['head_sha'] = 'main'
                result = self.command()
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertEqual(result.stdout, '')
                self.assertNotIn('Traceback', result.stderr)


if __name__ == '__main__':
    unittest.main()
