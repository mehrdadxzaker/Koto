"""Offline harness development; no router configuration or host mutation."""
import json
import sys


def add_commands(commands):
    harness = commands.add_parser('harness', help='Draft offline guidance improvements from frozen failed traces')
    operations = harness.add_subparsers(dest='harness_command', required=True)
    for operation in ('improve', 'verify'):
        command = operations.add_parser(operation)
        command.add_argument('--evidence', action='append', required=True,
                             help='Explicit frozen trace or outcome JSON/JSONL; at most 8 regular files')
        if operation == 'improve':
            command.add_argument('--base-profile', choices=('qwen-code.v8', 'qwen-code.v10'), default='qwen-code.v10')
            command.add_argument('--output', required=True, help='New private review bundle directory; never overwritten')
        else:
            command.add_argument('--bundle', required=True, help='Existing bundle to verify against its original evidence')


def run(args):
    from ..harness_improvement import (ImprovementError, LIMITS, build_proposal,
                                       read_evidence, verify_bundle, write_bundle)
    try:
        if len(args.evidence) > LIMITS['files']:
            raise ImprovementError('evidence_limit')
        evidence = []
        total = 0
        for path in args.evidence:
            raw = read_evidence(path)
            total += len(raw)
            if total > LIMITS['total_bytes']:
                raise ImprovementError('evidence_limit')
            evidence.append(raw)
        if args.harness_command == 'verify':
            result = verify_bundle(args.bundle, evidence)
        else:
            result = build_proposal(evidence, args.base_profile)
            write_bundle(args.output, result)
        print(json.dumps(result, sort_keys=True, allow_nan=False))
        return 0
    except ImprovementError as error:
        print(json.dumps({'error': {'code': error.code}, 'applied': False,
                          'model_requests': 0, 'executed_commands': 0}), file=sys.stderr)
        return 2
