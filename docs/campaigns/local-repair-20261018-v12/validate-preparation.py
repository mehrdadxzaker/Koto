"""Validate independent checker sensitivity without native model inference."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile


DIRECTORY = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=DIRECTORY / 'checker-completion-validation.json')
    arguments = parser.parse_args()
    target = arguments.output
    if target.exists() or (DIRECTORY / "frozen-manifest.json").exists():
        raise RuntimeError("Preserve existing preparation evidence")
    corpus = json.loads((DIRECTORY / "corpus.json").read_text())
    references = json.loads(arguments.references.read_text())
    outcomes = []
    spec = importlib.util.spec_from_file_location('frozen_campaign', DIRECTORY / 'campaign-runner.py')
    driver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(driver)
    with tempfile.TemporaryDirectory(prefix="koto-569-v12-checkers-") as temporary:
        root = Path(temporary)
        driver.ROOT = driver.retained.ROOT = root
        (root / 'project').mkdir()
        (root / 'tmp').mkdir()
        for case in corpus["entries"]:
            oracle = driver.PRIVATE / 'checkers' / (case['case_id'] + '.py')
            codes = {}
            for label, code in (("baseline", case["files"]["solution.py"]), ("reference", references[case["case_id"]])):
                implementation = root / "project/solution.py"
                implementation.write_text(code)
                receipt = driver.checker(case)
                codes[label + '_check'] = receipt
                codes[label + "_exit_code"] = receipt['exit_code']
            outcomes.append({"case_id": case["case_id"], **codes,
                "checks_unchanged": hashlib.sha256(oracle.read_bytes()).hexdigest() == case["checks_sha256"]})
    passed = len(outcomes) == 16 and all(row["baseline_exit_code"] == 1 and row["reference_exit_code"] == 0
                                        and row['reference_check']['assertions_completed']
                                        and row["checks_unchanged"] for row in outcomes)
    evidence = {"document_version": 2, "campaign_id": corpus["campaign_id"], "native_model_inferences": 0,
                "reference_implementations_are_model_evidence": False, "cases": outcomes, "passed": passed}
    target.write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({"cases": len(outcomes), "native_model_inferences": 0, "passed": passed}))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
