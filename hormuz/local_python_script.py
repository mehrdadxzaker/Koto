"""Quote model-authored Python for the existing host command tool.

Koto only constructs command text. The coding client retains execution,
permissions, approval, working-directory selection and the actual result.
"""
import shlex


MAX_SCRIPT_BYTES = 32 * 1024
MAX_COMMAND_BYTES = 128 * 1024

SCRIPT_SCHEMA = {
    'type': 'string', 'minLength': 1, 'maxLength': MAX_SCRIPT_BYTES,
    'description': (
        'Python source, at most 32 KiB of UTF-8, passed unchanged to the existing '
        'host command tool. Use actual newline characters for multiline Python '
        'statements. Use assertions against the saved code for verification; '
        'only actual host results provide execution evidence.'),
}


class ScriptSpecError(ValueError):
    """A bounded validation code that never includes the submitted source."""


def compile_script(script):
    """Return shell-quoted command text without parsing or executing the source."""
    if type(script) is not str or not script or '\x00' in script:
        raise ScriptSpecError('invalid_script')
    try:
        encoded = script.encode('utf-8')
    except UnicodeEncodeError:
        raise ScriptSpecError('invalid_script') from None
    if len(encoded) > MAX_SCRIPT_BYTES:
        raise ScriptSpecError('script_too_large')
    command = 'python3 -c ' + shlex.quote(script)
    if len(command.encode('utf-8')) > MAX_COMMAND_BYTES:
        raise ScriptSpecError('command_too_large')
    return command
