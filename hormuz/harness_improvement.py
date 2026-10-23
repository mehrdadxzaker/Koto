"""Bounded, offline harness proposals from explicitly selected frozen evidence.

Transcript text is data. Only fixed recipes can enter a candidate; this module
does not execute commands, call models, or register a runtime capability.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import stat

from .compaction_formats import strict_json_loads
from .local_harness import V8_GUIDANCE, V10_GUIDANCE


LIMITS = {'files': 8, 'file_bytes': 1048576, 'total_bytes': 4194304,
          'observations': 128, 'events_per_file': 4096, 'references_per_rule': 16,
          'guidance_bytes': 4096}
BASES = {'qwen-code.v8': V8_GUIDANCE, 'qwen-code.v10': V10_GUIDANCE}
# Ordered recipes are an intentionally small editable surface. They add model
# guidance only; permissions, tools, routing and qualification have no entry here.
RULES = {
    'interpreter_unavailable': ('execution',
        'Use the declared interpreter or host Python helper for checks. A missing '
        'generic python command is an invocation failure; it does not establish '
        'that Python is absent. If no declared executable is available, report '
        'that concrete environment blocker.'),
    'shell_syntax_failed': ('execution',
        'For multiline Python checks, prefer a declared script helper and supply '
        'literal newlines in its script argument. When only a shell tool is '
        'available, use a script file with the declared interpreter. Inspect the '
        'parser error before correcting quoting; do not repeatedly escape the same command.'),
    'command_failed': ('execution',
        'Resolve the latest failed check invocation before treating it as '
        'verification. Read its actual exit status and error; a printed test '
        'definition or success message cannot replace successful assertions.'),
    'repeated_command_failed': ('execution',
        'After the same command fails twice, stop submitting identical command '
        'text. Inspect the concrete error, make a focused correction within the '
        'existing host budget, or report the blocker.'),
    'independent_check_failed': ('verification',
        'Before reporting a repair, run the unchanged original checks against '
        'the saved implementation after the final edit. Preserve failing '
        'requirements and report remaining failures explicitly.'),
    'native_completion_missing': ('verification',
        'After verification, finish the native turn with a concise report of '
        'the saved change, actual check result, and any blocker. Passing saved '
        'checks alone does not establish completion of the native episode.'),
}
REPORT_FIELDS = {'schema_id', 'schema_version', 'recipe_version', 'base_profile',
                 'base_guidance_sha256', 'sources', 'observations', 'findings',
                 'candidates', 'composed_guidance', 'review_required', 'applied',
                 'quality', 'qualification', 'execution', 'limits'}
FILES = ('proposal.json', 'base-guidance.txt', 'candidate-guidance.txt',
         'candidate.patch', 'EXPERIENCE.md')


class ImprovementError(ValueError):
    """Content-free refusal suitable for the public CLI."""

    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _require(condition, code='invalid_evidence'):
    if not condition:
        raise ImprovementError(code)


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _integer(value, minimum=None):
    return type(value) is int and (minimum is None or minimum <= value <= 1000000)


def _identifier(value):
    return type(value) is str and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', value) is not None


def _digest(value):
    return type(value) is str and re.fullmatch(r'[0-9a-f]{64}', value) is not None


def _parse(raw):
    try:
        text = raw.decode('utf-8')
        try:
            value = strict_json_loads(text)
        except ValueError:
            lines = text.splitlines()
            _require(1 < len(lines) <= LIMITS['events_per_file'])
            events = [strict_json_loads(line) for line in lines if line.strip()]
            _require(events and all(type(event) is dict and type(event.get('type')) is str for event in events))
            return 'native-jsonl.v1', {'native_events': events}
        _require(type(value) is dict)
        if 'native_events' in value:
            return 'native-trace.v1', value
        if (value.get('schema_version') == 1 and type(value.get('schema_version')) is int
                and value.get('evidence_kind') == 'completed_audited_36_episode_development_task_comparison'):
            return 'audited-episodes.v1', value
        if 'outcomes' in value and _digest(value.get('frozen_plan_sha256')):
            return 'comparison.v1', value
        raise ImprovementError('unsupported_evidence')
    except (UnicodeError, ValueError, RecursionError, TypeError) as error:
        if isinstance(error, ImprovementError):
            raise
        raise ImprovementError('invalid_evidence') from None


def _trace(value, source, findings):
    events = value['native_events']
    _require(type(events) is list and 0 < len(events) <= LIMITS['events_per_file'])
    case = value.get('case_id', 'trace')
    _require(_identifier(case))
    if 'arm' in value:
        _require(value['arm'] in ('baseline', 'adapted'))
    if 'source_sha256' in value:
        _require(type(value.get('source_after')) is str and
                 _sha(value['source_after'].encode()) == value['source_sha256'], 'source_digest_mismatch')
    failures, tool_errors, repeated = 0, 0, {}
    for index, event in enumerate(events):
        _require(type(event) is dict and type(event.get('type')) is str)
        if event['type'] != 'item.completed':
            continue
        item = event.get('item')
        _require(type(item) is dict and type(item.get('type')) is str)
        if item.get('status') == 'failed':
            tool_errors += 1
        if item['type'] != 'command_execution':
            continue
        _require(_integer(item.get('exit_code')) and type(item.get('command')) is str and
                 type(item.get('aggregated_output')) is str and item.get('status') in ('completed', 'failed'))
        if item['exit_code'] == 0:
            continue
        failures += 1
        pointer = f'/native_events/{index}'
        findings.append(('command_failed', source, pointer))
        output = item['aggregated_output']
        if re.search(r'command not found: python(?:3)?(?:\s|$)|python(?:3)? not found(?:\s|$)', output):
            findings.append(('interpreter_unavailable', source, pointer))
        if re.search(r'parse error near|SyntaxError: (?:unexpected character after line continuation|unterminated string)', output):
            findings.append(('shell_syntax_failed', source, pointer))
        command_hash = _sha(item['command'].encode())
        repeated[command_hash] = repeated.get(command_hash, 0) + 1
        if repeated[command_hash] == 2:
            findings.append(('repeated_command_failed', source, pointer))
    return [{'source_sha256': source, 'pointer': '/native_events', 'case_id': case,
             'profile': None, 'full_success': None, 'saved_checker_pass': None,
             'normal_native_completion': None, 'command_failures': failures,
             'native_tool_errors': tool_errors}]


def _episodes(value, source, findings, comparison):
    rows = value['outcomes' if comparison else 'episodes']
    _require(type(rows) is list and 0 < len(rows) <= LIMITS['observations'])
    result, identities = [], set()
    for index, row in enumerate(rows):
        _require(type(row) is dict and _identifier(row.get('case_id')))
        pointer = f'/{"outcomes" if comparison else "episodes"}/{index}'
        if comparison:
            _require(row.get('arm') in ('baseline', 'adapted'))
            profile = row['arm']
            _require(all(type(row.get(key)) is bool for key in
                         ('passed', 'turn_completed', 'implementation_changed', 'checks_unchanged')))
            check = row.get('independent_check')
            _require(type(check) is dict and _integer(check.get('exit_code')))
            _require(type(check.get('termination')) is str and _integer(row.get('check_exit_code')))
            _require(check['exit_code'] == row['check_exit_code'])
            checked = check['exit_code'] == 0 and check['termination'] == 'completed'
            completed, full = row['turn_completed'], row['passed']
            changed = row['implementation_changed'] and checked and row['checks_unchanged']
            errors, commands = row.get('tool_errors'), None
            identity = (profile, row['case_id'])
        else:
            profile = row.get('profile')
            _require(type(profile) is str and re.fullmatch(r'qwen-code\.v[1-9][0-9]?', profile) is not None)
            _require(_integer(row.get('repetition'), 1))
            _require(all(type(row.get(key)) is bool for key in
                         ('full_success', 'saved_checker_pass', 'changed_saved_checker_pass', 'normal_native_completion')))
            _require(_integer(row.get('checker_exit_code')) and type(row.get('checker_termination')) is str)
            checked, changed = row['saved_checker_pass'], row['changed_saved_checker_pass']
            _require(checked == (row['checker_exit_code'] == 0 and row['checker_termination'] == 'completed'))
            _require(not changed or checked)
            completed, full = row['normal_native_completion'], row['full_success']
            errors, commands = row.get('native_tool_errors'), row.get('commands_recorded_with_nonzero_exit')
            _require(_integer(commands, 0))
            identity = (profile, row['case_id'], row['repetition'])
        _require(identity not in identities)
        identities.add(identity)
        _require(_integer(errors, 0) and _integer(row.get('client_exit_code')) and
                 type(row.get('termination')) is str)
        _require(full == (changed and completed and row['client_exit_code'] == 0 and row['termination'] == 'completed'))
        if not checked:
            findings.append(('independent_check_failed', source, pointer))
        if not completed or row['client_exit_code'] != 0 or row['termination'] != 'completed':
            findings.append(('native_completion_missing', source, pointer))
        if commands:
            findings.append(('command_failed', source, pointer))
        result.append({'source_sha256': source, 'pointer': pointer, 'case_id': row['case_id'],
                       'profile': profile, 'full_success': full, 'saved_checker_pass': checked,
                       'normal_native_completion': completed, 'command_failures': commands,
                       'native_tool_errors': errors})
    return result


def _candidates(findings):
    selected = {item['rule'] for item in findings}
    return [{'scope': scope, 'rules': [name for name, (kind, _) in RULES.items() if name in selected and kind == scope],
             'guidance': '\n'.join(text for name, (kind, text) in RULES.items() if name in selected and kind == scope)}
            for scope in ('execution', 'verification')
            if any(name in selected and kind == scope for name, (kind, _) in RULES.items())]


def build_proposal(evidence, base_profile='qwen-code.v10'):
    """Propose and compose fixed guidance from bounded bytes; perform no execution."""
    _require(type(base_profile) is str and base_profile in BASES, 'unsupported_base_profile')
    _require(type(evidence) in (list, tuple) and 0 < len(evidence) <= LIMITS['files'], 'evidence_limit')
    _require(all(type(raw) is bytes and len(raw) <= LIMITS['file_bytes'] for raw in evidence), 'evidence_limit')
    _require(sum(map(len, evidence)) <= LIMITS['total_bytes'], 'evidence_limit')
    ordered = sorted((_sha(raw), raw) for raw in evidence)
    _require(len({digest for digest, _ in ordered}) == len(ordered), 'duplicate_evidence')
    sources, observations, found = [], [], []
    for source, raw in ordered:
        kind, value = _parse(raw)
        rows = (_trace(value, source, found) if kind.startswith('native-') else
                _episodes(value, source, found, kind == 'comparison.v1'))
        observations.extend(rows)
        _require(len(observations) <= LIMITS['observations'], 'evidence_limit')
        sources.append({'sha256': source, 'format': kind, 'observations': len(rows)})
    _require(found, 'no_supported_failure')
    findings = []
    for rule in RULES:
        references = [{'source_sha256': source, 'pointer': pointer}
                      for name, source, pointer in found if name == rule]
        if references:
            findings.append({'rule': rule, 'count': len(references),
                             'references': references[:LIMITS['references_per_rule']]})
    candidates = _candidates(findings)
    composed = '\n\n'.join(candidate['guidance'] for candidate in candidates)
    _require(len(composed.encode()) <= LIMITS['guidance_bytes'], 'guidance_limit')
    report = {'schema_id': 'hormuz.harness-improvement', 'schema_version': 1, 'recipe_version': 1,
              'base_profile': base_profile, 'base_guidance_sha256': _sha(BASES[base_profile].encode()),
              'sources': sources, 'observations': observations, 'findings': findings,
              'candidates': candidates, 'composed_guidance': composed, 'review_required': True,
              'applied': False, 'quality': 'unmeasured', 'qualification': 'unqualified',
              'execution': {'model_requests': 0, 'commands': 0}, 'limits': dict(LIMITS)}
    validate_proposal(report)
    return report


def validate_proposal(value):
    """Validate the review-only v1 contract; source authenticity needs bundle verification."""
    try:
        _validate_proposal(value)
    except (TypeError, KeyError, AttributeError, RecursionError):
        raise ImprovementError('invalid_proposal') from None


def _validate_proposal(value):
    _require(type(value) is dict and set(value) == REPORT_FIELDS, 'invalid_proposal')
    _require(value['schema_id'] == 'hormuz.harness-improvement' and
             type(value['schema_version']) is int and value['schema_version'] == 1 and
             type(value['recipe_version']) is int and value['recipe_version'] == 1, 'invalid_proposal')
    _require(type(value['base_profile']) is str and value['base_profile'] in BASES and
             value['base_guidance_sha256'] == _sha(BASES[value['base_profile']].encode()), 'invalid_proposal')
    _require(value['review_required'] is True and value['applied'] is False and
             value['quality'] == 'unmeasured' and value['qualification'] == 'unqualified' and
             value['execution'] == {'model_requests': 0, 'commands': 0} and
             all(type(n) is int for n in value['execution'].values()) and
             value['limits'] == LIMITS and all(type(n) is int for n in value['limits'].values()), 'invalid_proposal')
    sources = value['sources']
    _require(type(sources) is list and 0 < len(sources) <= LIMITS['files'], 'invalid_proposal')
    for source in sources:
        _require(type(source) is dict and set(source) == {'sha256', 'format', 'observations'} and
                 _digest(source['sha256']) and source['format'] in
                 ('native-trace.v1', 'native-jsonl.v1', 'audited-episodes.v1', 'comparison.v1') and
                 _integer(source['observations'], 1), 'invalid_proposal')
    hashes = {source['sha256'] for source in sources}
    _require(len(hashes) == len(sources), 'invalid_proposal')
    rows = value['observations']
    _require(type(rows) is list and 0 < len(rows) <= LIMITS['observations'] and
             sum(source['observations'] for source in sources) == len(rows), 'invalid_proposal')
    row_fields = {'source_sha256', 'pointer', 'case_id', 'profile', 'full_success',
                  'saved_checker_pass', 'normal_native_completion', 'command_failures', 'native_tool_errors'}
    for row in rows:
        _require(type(row) is dict and set(row) == row_fields and row['source_sha256'] in hashes and
                 _identifier(row['case_id']) and (row['profile'] is None or _identifier(row['profile'])) and
                 type(row['pointer']) is str and re.fullmatch(r'/(?:native_events|(?:episodes|outcomes)/[0-9]+)', row['pointer']) and
                 all(row[key] is None or type(row[key]) is bool for key in
                     ('full_success', 'saved_checker_pass', 'normal_native_completion')) and
                 (row['command_failures'] is None or _integer(row['command_failures'], 0)) and
                 _integer(row['native_tool_errors'], 0), 'invalid_proposal')
    findings = value['findings']
    _require(type(findings) is list and 0 < len(findings) <= len(RULES), 'invalid_proposal')
    seen = set()
    for finding in findings:
        _require(type(finding) is dict and set(finding) == {'rule', 'count', 'references'} and
                 type(finding['rule']) is str and finding['rule'] in RULES and finding['rule'] not in seen and
                 _integer(finding['count'], 1) and type(finding['references']) is list and
                 len(finding['references']) == min(finding['count'], LIMITS['references_per_rule']), 'invalid_proposal')
        seen.add(finding['rule'])
        for ref in finding['references']:
            _require(type(ref) is dict and set(ref) == {'source_sha256', 'pointer'} and
                     ref['source_sha256'] in hashes and type(ref['pointer']) is str and
                     re.fullmatch(r'/(?:native_events|episodes|outcomes)/[0-9]+', ref['pointer']), 'invalid_proposal')
    _require(value['candidates'] == _candidates(findings) and value['composed_guidance'] ==
             '\n\n'.join(candidate['guidance'] for candidate in _candidates(findings)), 'invalid_proposal')


def read_evidence(path):
    """Read one regular local file without following a final symlink or blocking on a FIFO."""
    try:
        path = Path(path)
        _require(not path.is_symlink(), 'evidence_unavailable')
        flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
        with os.fdopen(os.open(path, flags), 'rb') as stream:
            info = os.fstat(stream.fileno())
            _require(stat.S_ISREG(info.st_mode), 'evidence_unavailable')
            _require(info.st_size <= LIMITS['file_bytes'], 'evidence_limit')
            raw = stream.read(LIMITS['file_bytes'] + 1)
        _require(len(raw) <= LIMITS['file_bytes'], 'evidence_limit')
        return raw
    except OSError:
        raise ImprovementError('evidence_unavailable') from None


def bundle_files(report):
    """Render a self-contained draft and a reviewable patch, without runtime configuration."""
    validate_proposal(report)
    base = BASES[report['base_profile']] + '\n'
    candidate = base + '\nProposed guidance (subordinate to host, repository and user instructions):\n' + report['composed_guidance'] + '\n'
    patch = ''.join(difflib.unified_diff(base.splitlines(keepends=True), candidate.splitlines(keepends=True),
                                         fromfile='base-guidance.txt', tofile='candidate-guidance.txt'))
    lessons = ['# Harness improvement hypothesis', '',
               'Review required. Candidate quality is unmeasured; coding qualification is unqualified.',
               'This offline analysis ran zero model requests and zero transcript commands.',
               'Archived successes and failures remain observations of their original executions.',
               'No candidate execution or causal improvement is established.', '']
    lessons += ['## Recorded execution comparison', '',
                'Counts below describe archived episodes, including repeated tasks. They are not new coverage.', '',
                '| Recorded profile/arm | Episodes | Full success | Saved checker passed | Native completion |',
                '| --- | ---: | ---: | ---: | ---: |']
    profiles = sorted({row['profile'] for row in report['observations'] if row['profile'] is not None})
    for profile in profiles:
        rows = [row for row in report['observations'] if row['profile'] == profile]
        counts = [sum(row[key] is True for row in rows) for key in
                  ('full_success', 'saved_checker_pass', 'normal_native_completion')]
        lessons.append(f'| {profile} | {len(rows)} | {counts[0]} | {counts[1]} | {counts[2]} |')
    unknown = sum(row['profile'] is None for row in report['observations'])
    lessons += ['', f'Native traces without independent outcome records: {unknown}; task quality remains unknown.', '']
    for finding in report['findings']:
        lessons += [f"## {finding['rule']}", '', f"Recorded observations: {finding['count']}", '',
                    RULES[finding['rule']][1], '']
        lessons += [f"- {ref['source_sha256']}#{ref['pointer']}" for ref in finding['references']]
        lessons += ['']
    return {'proposal.json': (json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + '\n').encode(),
            'base-guidance.txt': base.encode(), 'candidate-guidance.txt': candidate.encode(),
            'candidate.patch': patch.encode(), 'EXPERIENCE.md': ('\n'.join(lessons) + '\n').encode()}


def write_bundle(output, report):
    """Create a new private bundle exclusively; never overwrite retained evidence."""
    files = bundle_files(report)
    path = Path(output)
    directory_fd = None
    created = []
    made_directory = False
    try:
        path = path.parent.resolve(strict=True) / path.name
        try:
            path.mkdir(mode=0o700)
            made_directory = True
        except FileExistsError:
            raise ImprovementError('output_exists') from None
        directory_fd = os.open(path, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | getattr(os, 'O_NOFOLLOW', 0)) if os.name != 'nt' else None
        for name, data in files.items():
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
            fd = os.open(name, flags, 0o600, dir_fd=directory_fd) if directory_fd is not None else os.open(path / name, flags, 0o600)
            created.append(name)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
    except OSError:
        for name in created:
            if directory_fd is not None:
                os.unlink(name, dir_fd=directory_fd)
            else:
                (path / name).unlink()
        if made_directory:
            path.rmdir()
        raise ImprovementError('output_unavailable') from None
    finally:
        if directory_fd is not None:
            os.close(directory_fd)


def verify_bundle(bundle, evidence):
    """Regenerate every artifact against unchanged evidence and the exact base guidance."""
    path = Path(bundle)
    _require(not path.is_symlink() and path.is_dir(), 'bundle_mismatch')
    try:
        _require({entry.name for entry in path.iterdir()} == set(FILES), 'bundle_mismatch')
        report = strict_json_loads(read_evidence(path / 'proposal.json').decode('utf-8'))
        validate_proposal(report)
        expected = build_proposal(evidence, report['base_profile'])
        _require(report == expected, 'bundle_mismatch')
        for name, data in bundle_files(expected).items():
            _require(read_evidence(path / name) == data, 'bundle_mismatch')
        return expected
    except (OSError, ValueError, UnicodeError, RecursionError, TypeError, KeyError):
        raise ImprovementError('bundle_mismatch') from None
