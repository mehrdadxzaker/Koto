"""Check observable native/engine preparation receipts, without a completion.

The input-token threshold is a preparation target, not a measured latency claim.
Only an actual bounded native episode can establish repair performance.
"""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    request = json.loads((args.directory / 'captured-request.json').read_text())
    receipt = json.loads((args.directory / 'preflight.json').read_text())
    tokens = receipt['input_tokens']['input_tokens']
    names = [tool['name'] for tool in request['tools']]
    checks = {
        'first_prompt_at_most_4000_tokens': tokens <= 4000,
        'native_tools_preserved': names == ['exec_command', 'write_stdin', 'request_user_input',
                                          'view_image', 'get_goal', 'create_goal', 'update_goal'],
        'native_text_preserved_by_template': receipt.get('native_text_blocks_preserved_in_order'),
        'no_model_completion': receipt['model_completion_requests'] == 0
                               and receipt['work_state']['totals']['attempts'] == 0,
        'settings_restored': receipt['settings_restored'],
        'owned_listeners_closed': receipt['owned_listeners_closed'],
    }
    result = {'input_tokens': tokens, 'checks': checks, 'passed': all(checks.values()),
              'model_completion_requests': 0, 'model_quality_evidence': False}
    with args.output.open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print(json.dumps(result))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
