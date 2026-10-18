"""Check two intentionally wrong synthetic fixtures; never invoke a model."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile

DIRECTORY = Path(__file__).resolve().parent
REPO = DIRECTORY.parents[2]
PRIVATE = Path('/private/tmp/koto-qwen3coder-v14-preparation-20261018')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--generation', choices=('v13', 'v14'), required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert not args.output.exists()
    target = REPO / ('docs/campaigns/local-repair-20261018-' + args.generation)
    spec = importlib.util.spec_from_file_location('sensitivity_driver', target / 'campaign-runner.py')
    driver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(driver)
    corpus = {c['case_id']: c for c in json.loads((target / 'corpus.json').read_text())['entries']}
    outcomes = []
    with tempfile.TemporaryDirectory(prefix='koto-v14-sensitivity-') as temporary:
        root = Path(temporary)
        driver.ROOT = driver.retained.ROOT = root
        (root / 'project').mkdir()
        (root / 'tmp').mkdir()
        for cid, filename in [('held-gregorian-date', 'lax-date.py'), ('held-rename-key', 'lax-rename.py')]:
            fixture = PRIVATE / filename
            (root / 'project/solution.py').write_bytes(fixture.read_bytes())
            receipt = driver.checker(corpus[cid])
            outcomes.append({'case_id': cid, 'fixture_sha256': hashlib.sha256(fixture.read_bytes()).hexdigest(),
                             'checks_sha256': corpus[cid]['checks_sha256'], 'receipt': receipt,
                             'incorrect_implementation_rejected_by_assertion': receipt['exit_code'] == 1})
    passed = all(row['incorrect_implementation_rejected_by_assertion'] for row in outcomes)
    args.output.write_text(json.dumps({'checker_generation': args.generation, 'model_completions': 0,
        'fixture_origin': 'Intentionally incorrect synthetic guard omissions, not model output or private correct references.',
        'cases': outcomes, 'sensitivity_passed': passed}, indent=2) + '\n')
    print(json.dumps({'checker_generation': args.generation, 'sensitivity_passed': passed,
                      'fixture_checker_exit_codes': [row['receipt']['exit_code'] for row in outcomes], 'model_completions': 0}))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
