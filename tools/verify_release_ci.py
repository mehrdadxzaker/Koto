"""Validate recorded GitHub CI evidence for an exact-main release candidate."""
from pathlib import Path
import argparse
import json
import os
import re
import stat


REQUIRED = {'Build router distributions', 'CI / required',
            *(f'Router workflow (Python {version})' for version in ('3.11', '3.12', '3.13', '3.14'))}


def verify_ci(run, result, repository, source):
    """Check the full source checkpoint; this never grants product acceptance."""
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('expected a GitHub owner/name')
    if not re.fullmatch(r'[0-9a-f]{40}', source):
        raise ValueError('expected a complete lowercase source commit SHA')
    if not isinstance(run, dict) or not isinstance(result, dict):
        raise ValueError('CI evidence must be JSON objects')
    if any(type(run.get(name)) is not int or run[name] <= 0 for name in ('id', 'run_attempt')):
        raise ValueError('CI run and attempt IDs must be positive integers')
    if not (run['repository']['full_name'] == repository
            and run['head_sha'] == source and run['head_branch'] == 'main'
            and run['event'] == 'push' and run['path'] == '.github/workflows/ci.yml'
            and run['status'] == 'completed' and run['conclusion'] == 'success'):
        raise ValueError('expected successful push CI for the exact main commit')
    jobs = result['jobs']
    if (not isinstance(jobs, list) or type(result['total_count']) is not int
            or not 1 <= len(jobs) <= 100 or result['total_count'] != len(jobs)):
        raise ValueError('incomplete CI job evidence')
    if any(not isinstance(job, dict) or type(job.get('id')) is not int or job['id'] <= 0
           or type(job.get('run_id')) is not int or job['run_id'] != run['id'] for job in jobs):
        raise ValueError('CI job evidence belongs to a different run')
    if len({job['id'] for job in jobs}) != len(jobs):
        raise ValueError('CI job evidence repeats a job ID')
    for name in REQUIRED:
        matches = [job for job in jobs if job['name'] == name]
        if len(matches) != 1 or matches[0]['status'] != 'completed' or matches[0]['conclusion'] != 'success':
            raise ValueError('missing successful required job: ' + name)
    return {'schema_id': 'koto.release-ci', 'schema_version': 1, 'repository': repository,
            'source_commit': source, 'ci_run_id': run['id'], 'run_attempt': run['run_attempt'],
            'status': 'passed', 'publishing_approved': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', required=True, help='expected GitHub owner/name')
    parser.add_argument('--source', required=True, help='expected complete source commit SHA')
    parser.add_argument('run', type=Path, help='GitHub workflow-run JSON')
    parser.add_argument('jobs', type=Path, help='complete GitHub workflow-jobs JSON')
    args = parser.parse_args()
    try:
        documents = []
        for path in (args.run, args.jobs):
            descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK | getattr(os, 'O_NOFOLLOW', 0))
            with os.fdopen(descriptor, 'rb') as handle:
                info = os.fstat(handle.fileno())
                if not stat.S_ISREG(info.st_mode) or path.is_symlink():
                    raise ValueError('CI evidence must be a regular file')
                content = handle.read(2 * 1024 * 1024 + 1)
            if len(content) > 2 * 1024 * 1024:
                raise ValueError('CI evidence exceeds the 2 MiB file limit')
            documents.append(json.loads(content.decode('utf-8')))
        result = verify_ci(documents[0], documents[1],
                           args.repository, args.source)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(2, f'release-ci: {error}\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
