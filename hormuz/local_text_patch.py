"""Compile model-supplied complete lines to the existing native patch format."""
import unicodedata


MAX_TEXT_BYTES = 32 * 1024
MAX_PATCH_BYTES = 128 * 1024
MAX_PATH_BYTES = 1024
TEXT_PATCH_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'properties': {
        'path': {'type': 'string', 'minLength': 1, 'maxLength': MAX_PATH_BYTES,
            'description': 'Relative POSIX path of an existing file inside the permitted workspace.'},
        'old_text': {'type': 'string', 'minLength': 1, 'maxLength': MAX_TEXT_BYTES,
            'description': 'Exact complete LF-separated old lines to replace; at most 32 KiB UTF-8. No CR or NUL.'},
        'new_text': {'type': 'string', 'maxLength': MAX_TEXT_BYTES,
            'description': 'Replacement complete LF-separated lines, or empty to delete. At most 32 KiB UTF-8; no CR or NUL.'},
    }, 'required': ['path', 'old_text', 'new_text'],
    'description': 'Replace supplied complete lines in an existing file through the declared native patch tool. '
        'No file is read or searched by this compiler. The host retains context matching, approvals and writes. '
        'A terminal LF separates lines rather than adding another blank line; native file-ending newline policy applies. '
        'This is not an inline substring or exact-byte EOF replacement interface.'}


class TextPatchError(ValueError):
    """A bounded input error which never includes submitted text."""


def _require(condition, code):
    if not condition:
        raise TextPatchError(code)


def _utf8(value):
    try:
        return value.encode('utf-8')
    except UnicodeError:
        raise TextPatchError('invalid_text_encoding') from None


def compile_text_patch(edit):
    """Return native Update File input without reading, searching or writing."""
    _require(type(edit) is dict and set(edit) == {'path', 'old_text', 'new_text'}, 'invalid_edit_fields')
    path, old, new = edit['path'], edit['old_text'], edit['new_text']
    _require(type(path) is str and bool(path) and len(path) <= MAX_PATH_BYTES, 'invalid_edit_path')
    _require(not path.startswith('/') and '\\' not in path and ':' not in path
        and all(part not in ('', '.', '..') for part in path.split('/'))
        and not any(unicodedata.category(char) in {'Cc', 'Zl', 'Zp'} for char in path), 'invalid_edit_path')
    _require(len(_utf8(path)) <= MAX_PATH_BYTES, 'edit_path_too_large')
    _require(type(old) is str and bool(old) and type(new) is str, 'invalid_edit_text')
    for text in (old, new):
        _require(len(text) <= MAX_TEXT_BYTES, 'edit_text_too_large')
        _require('\x00' not in text and '\r' not in text, 'unsupported_edit_text')
        _require(len(_utf8(text)) <= MAX_TEXT_BYTES, 'edit_text_too_large')
    lines = ['*** Begin Patch', '*** Update File: ' + path, '@@']
    for prefix, text in (('-', old), ('+', new)):
        if text:
            # The native protocol addresses lines, not terminal-LF bytes.
            # Keep actual blank lines and every supplied line character intact.
            pieces = text.split('\n')
            if pieces[-1] == '':
                pieces.pop()
            lines.extend(prefix + line for line in pieces)
    patch = '\n'.join([*lines, '*** End Patch', ''])
    _require(len(_utf8(patch)) <= MAX_PATCH_BYTES, 'compiled_patch_too_large')
    return patch
