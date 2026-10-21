"""Recheck authored fixtures offline; this does not run Codex or a model.

Always use a new --output file so every control run remains reviewable.
"""

import argparse
import hashlib
import json
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    # Reserve the result exclusively before executing anything. Failure evidence
    # is still written if a fixture fails; an existing result is never replaced.
    with args.output.open('x') as result_file:
        report = {'campaign_id': 'local-repair-20261019-v17',
                  'model_requests': 0, 'python_version': sys.version,
                  'corpus_sha256': sha((root / 'corpus.json').read_bytes()),
                  'all_controls_passed': False, 'cases': []}
        try:
            corpus = json.loads((root / 'corpus.json').read_text())
            entries = corpus['entries']
            assert len(entries) == 16, 'expected exactly 16 predeclared cases'
            assert len({entry['id'] for entry in entries}) == 16, 'duplicate case ID'
            assert len({entry['task_sha256'] for entry in entries}) == 16, 'duplicate task'
            for family in ('arithmetic', 'text', 'collections', 'validation_state'):
                assert sum(x['partition'] == 'development' and x['family'] == family for x in entries) == 1
                assert sum(x['partition'] == 'held_out' and x['family'] == family for x in entries) == 3
            for entry in entries:
                path = root / entry['case_file']
                assert sha(path.read_bytes()) == entry['case_sha256'], 'case changed'
                case = json.loads(path.read_text())
                for field, digest_field in (('prompt', 'task_sha256'),
                                            ('initial_solution', 'initial_sha256'),
                                            ('checker', 'checks_sha256'),
                                            ('reference_solution', 'reference_sha256')):
                    assert case[field] == entry[field], 'corpus and case disagree'
                    assert sha(case[field].encode()) == entry[digest_field], 'source changed'
                control = {'id': case['id'], 'case_sha256': entry['case_sha256'],
                           'task_sha256': entry['task_sha256'],
                           'checks_sha256': entry['checks_sha256'], 'passed': False}
                report['cases'].append(control)
                with tempfile.TemporaryDirectory(prefix='koto-v17-controls-') as temp:
                    work = Path(temp)
                    checker = work / 'checker.py'
                    solution = work / 'solution.py'
                    wrapper = work / 'complete.py'
                    marker = 'ASSERTIONS_COMPLETED_' + secrets.token_hex(24)
                    checker.write_text(case['checker'])
                    wrapper.write_text("import runpy,sys\n" +
                                       "sys.argv=sys.argv[1:]\n" +
                                       "runpy.run_path(sys.argv[0],run_name='__main__')\n" +
                                       'print(' + repr(marker) + ')\n')
                    for label, field in (('baseline', 'initial_solution'),
                                         ('reference', 'reference_solution')):
                        # The baseline runs first. A failed baseline assertion
                        # must be established before writing its reference.
                        solution.write_text(case[field])
                        completed = subprocess.run(
                            [sys.executable, '-I', '-S', str(wrapper), str(checker), str(solution)],
                            capture_output=True, text=True, timeout=5, cwd=work)
                        stdout = completed.stdout.replace(marker, '<completion-marker>')
                        control[label] = {'exit': completed.returncode,
                                          'stdout': stdout,
                                          'stderr': completed.stderr.replace(str(work), '<fixture>'),
                                          'assertions_completed': completed.stdout.splitlines().count(marker) == 1,
                                          'completion_marker_sha256': sha(marker.encode())}
                        if label == 'baseline':
                            assert completed.returncode == 1 and 'AssertionError' in completed.stderr
                            assert marker not in completed.stdout
                        else:
                            assert completed.returncode == 0
                            assert completed.stdout.splitlines().count(marker) == 1
                            assert completed.stdout.splitlines()[-1] == marker
                    assert sha(checker.read_bytes()) == entry['checks_sha256'], 'checker changed'
                    control['passed'] = True
            report['all_controls_passed'] = True
        except BaseException as exc:
            report['error'] = type(exc).__name__ + ': ' + str(exc)
            raise
        finally:
            json.dump(report, result_file, indent=2, ensure_ascii=False)
            result_file.write('\n')
    print(json.dumps({'model_requests': 0, 'cases': len(report['cases']),
                      'all_controls_passed': report['all_controls_passed']}))


if __name__ == '__main__':
    main()
