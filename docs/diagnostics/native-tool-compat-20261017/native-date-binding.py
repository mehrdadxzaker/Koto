"""Bind one captured native user environment to the operator's current day.

This changes only the operator's probe plan, before arming. It never rewrites a
native request or router response, and never changes an instruction/tool profile.
"""
import copy
import datetime
import re
from zoneinfo import ZoneInfo


def bind_native_date(items):
    result = copy.deepcopy(items)
    matches = []
    for item in result:
        if item.get('type') != 'message' or item.get('role') != 'user':
            continue
        for part in item.get('content', []):
            if part.get('type') != 'input_text':
                continue
            text = part.get('text', '')
            if not text.startswith('<environment_context>\n'):
                continue
            dates = list(re.finditer(r'(?<=<current_date>)\d{4}-\d{2}-\d{2}(?=</current_date>)', text))
            zones = re.findall(r'<timezone>([^<]+)</timezone>', text)
            if len(dates) != 1 or len(zones) != 1 or zones[0] != 'America/Chicago':
                raise RuntimeError('Require one recognized native date and timezone')
            datetime.date.fromisoformat(dates[0].group())
            matches.append((part, dates[0]))
    if len(matches) != 1:
        raise RuntimeError('Require exactly one captured native user environment')
    now = datetime.datetime.now(ZoneInfo('America/Chicago'))
    if now.date() != (now + datetime.timedelta(seconds=120)).date():
        raise RuntimeError('Do not arm a 90-second native episode across midnight')
    part, match = matches[0]
    text = part['text']
    part['text'] = text[:match.start()] + now.date().isoformat() + text[match.end():]
    return result
