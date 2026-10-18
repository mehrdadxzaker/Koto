"""Patch one verified GGUF template and prove that every tensor byte is preserved.

GGUF v3 tensor offsets are relative to the aligned tensor-data section. Retain
all header/tensor records, replacing only tokenizer.chat_template and padding.
This performs no network request, model completion, or live settings change.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import time

DIRECTORY = Path(__file__).resolve().parent
PRIVATE = Path('/private/tmp/koto-devstral-preparation-20261018')
ORIGINAL = PRIVATE / 'assets/model.gguf'
FINAL = PRIVATE / 'assets/model-codex-role-v1.gguf'
EXPECTED = 'bfd11c8679c6b81eb43763505465d7dcfa72e460ab1c220ecc235a3efadd7f7f'
LIMIT = 16 * 1024 ** 3


def digest(path):
    result = hashlib.sha256()
    deadline = time.monotonic() + 120
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            if time.monotonic() > deadline:
                raise RuntimeError('Checksum deadline exceeded')
            result.update(block)
    return result.hexdigest()


def header(path):
    deadline = time.monotonic() + 10
    sizes = {0:1, 1:1, 2:2, 3:2, 4:4, 5:4, 6:4, 7:1, 10:8, 11:8, 12:8}
    with path.open('rb') as source:
        def take(size):
            if time.monotonic() > deadline or size > 1024 * 1024 or source.tell() + size > 64 * 1024 * 1024:
                raise RuntimeError('GGUF header bound exceeded')
            raw = source.read(size)
            if len(raw) != size:
                raise RuntimeError('Truncated GGUF header')
            return raw
        def integer(size):
            return int.from_bytes(take(size), 'little')
        def skip(size):
            if size > 64 * 1024 * 1024 or source.tell() + size > 64 * 1024 * 1024:
                raise RuntimeError('GGUF metadata bound exceeded')
            source.seek(size, 1)
        def value(kind):
            if kind == 8:
                skip(integer(8))
            elif kind == 9:
                subtype, count = integer(4), integer(8)
                if subtype == 9 or count > 1000000:
                    raise RuntimeError('Unsupported GGUF array')
                for _ in range(count):
                    value(subtype)
            else:
                skip(sizes[kind])
        if take(4) != b'GGUF' or integer(4) != 3:
            raise RuntimeError('Require the verified little-endian GGUF v3')
        tensors, count = integer(8), integer(8)
        if tensors > 100000 or count > 100000:
            raise RuntimeError('GGUF inventory bound exceeded')
        template = None
        alignment = 32
        for _ in range(count):
            key = take(integer(8)).decode()
            kind = integer(4)
            if key == 'tokenizer.chat_template':
                if kind != 8 or template is not None:
                    raise RuntimeError('Require exactly one string chat template')
                start = source.tell()
                text = take(integer(8)).decode()
                template = (start, source.tell(), text)
            elif key == 'general.alignment':
                if kind != 4:
                    raise RuntimeError('Unsupported alignment type')
                alignment = integer(4)
            else:
                value(kind)
        metadata_end = source.tell()
        if template is None or alignment < 8 or alignment > 4096 or alignment % 8:
            raise RuntimeError('Invalid GGUF template or alignment')
        for _ in range(tensors):
            name_size = integer(8)
            if name_size > 64:
                raise RuntimeError('Invalid tensor name')
            take(name_size)
            dimensions = integer(4)
            if not 1 <= dimensions <= 4:
                raise RuntimeError('Invalid tensor dimensions')
            take(dimensions * 8)
            take(4)
            if integer(8) % alignment:
                raise RuntimeError('Unaligned tensor offset')
        info_end = source.tell()
        data_start = info_end + (-info_end % alignment)
        source.seek(0)
        raw = source.read(info_end)
    return {'template': template, 'alignment': alignment, 'metadata_end': metadata_end,
            'info_end': info_end, 'data_start': data_start, 'raw': raw, 'tensors': tensors}


def write_json(path, value):
    with path.open('x') as target:
        json.dump(value, target, indent=2)
        target.write('\n')
    path.chmod(0o600)


def main():
    if FINAL.exists() or (PRIVATE / 'effective-artifact.json').exists():
        raise RuntimeError('Preserve an existing derivative; no overwrite')
    if ORIGINAL.stat().st_size != 14334438272 or digest(ORIGINAL) != EXPECTED:
        raise RuntimeError('Publisher artifact integrity changed')
    original_identity = ORIGINAL.stat()
    old = header(ORIGINAL)
    start, end, template = old['template']
    publisher_template = (DIRECTORY / 'publisher-chat-template.jinja').read_text()
    if template != publisher_template:
        raise RuntimeError('Publisher template differs from retained source')
    preamble = (DIRECTORY / 'codex-role-preamble.jinja').read_text()
    corrected = preamble + template
    replacement = struct.pack('<Q', len(corrected.encode())) + corrected.encode()
    prefix = old['raw'][:start] + replacement + old['raw'][end:]
    padding = b'\x00' * (-len(prefix) % old['alignment'])
    expected_size = len(prefix) + len(padding) + ORIGINAL.stat().st_size - old['data_start']
    if expected_size > LIMIT or shutil.disk_usage(PRIVATE).free < 2 * expected_size:
        raise RuntimeError('Derivative exceeds disk/size budget')
    partial = FINAL.with_suffix('.gguf.part')
    deadline = time.monotonic() + 120
    with partial.open('xb') as target, ORIGINAL.open('rb') as source:
        partial.chmod(0o600)
        target.write(prefix)
        target.write(padding)
        source.seek(old['data_start'])
        for block in iter(lambda: source.read(1024 * 1024), b''):
            if time.monotonic() > deadline:
                raise RuntimeError('Derivative copy deadline exceeded; preserve partial')
            target.write(block)
        target.flush()
        os.fsync(target.fileno())
    new = header(partial)
    if (new['template'][2] != corrected or new['tensors'] != old['tensors']
            or partial.stat().st_size != expected_size
            or new['raw'][new['metadata_end']:] != old['raw'][old['metadata_end']:]):
        raise RuntimeError('Derived GGUF structure or tensor table changed')
    complete = hashlib.sha256()
    tensor_digest = hashlib.sha256()
    deadline = time.monotonic() + 120
    with ORIGINAL.open('rb') as source, partial.open('rb') as target:
        complete.update(target.read(new['data_start']))
        source.seek(old['data_start'])
        while True:
            if time.monotonic() > deadline:
                raise RuntimeError('Tensor comparison deadline exceeded')
            left, right = source.read(1024 * 1024), target.read(1024 * 1024)
            if left != right:
                raise RuntimeError('Tensor bytes changed; preserve partial')
            if not left:
                break
            complete.update(right)
            tensor_digest.update(right)
    current = ORIGINAL.stat()
    if (current.st_ino, current.st_size, current.st_mtime_ns) != (original_identity.st_ino, original_identity.st_size, original_identity.st_mtime_ns):
        raise RuntimeError('Source artifact changed during derivation')
    os.link(partial, FINAL)
    partial.unlink()
    model_hash = complete.hexdigest()
    receipt = {'document_version':1, 'derivation':'codex-same-role-coalescing.v1',
        'original_path':str(ORIGINAL), 'original_bytes':ORIGINAL.stat().st_size, 'original_sha256':EXPECTED,
        'derived_path':str(FINAL), 'derived_bytes':FINAL.stat().st_size, 'derived_sha256':model_hash,
        'changed_metadata_keys':['tokenizer.chat_template'], 'tensor_count':old['tensors'],
        'tensor_info_bytes_identical':True, 'tensor_data_byte_comparison_identical':True,
        'tensor_data_sha256':tensor_digest.hexdigest(), 'tensor_data_bytes':ORIGINAL.stat().st_size-old['data_start'],
        'original_data_start':old['data_start'], 'derived_data_start':new['data_start'],
        'original_template_sha256':hashlib.sha256(template.encode()).hexdigest(),
        'derived_template_sha256':hashlib.sha256(corrected.encode()).hexdigest(),
        'preamble_sha256':digest(DIRECTORY/'codex-role-preamble.jinja'), 'derivation_script_sha256':digest(Path(__file__)),
        'model_completion_requests':0, 'quality_evidence':False}
    descriptor = {'artifact_kind':'local_template_compatibility_derivative',
        'base_model':'mistralai/Devstral-Small-2-24B-Instruct-2512', 'path':str(FINAL),
        'bytes':FINAL.stat().st_size, 'sha256':model_hash, 'publisher_artifact_sha256':EXPECTED,
        'chat_template_sha256':receipt['derived_template_sha256'], 'tensor_data_unchanged':True,
        'locally_verified':True, 'qualification':'unknown'}
    for name, record in [('template-derivation-receipt.json',receipt), ('effective-artifact.json',descriptor)]:
        write_json(PRIVATE/name,record)
        write_json(DIRECTORY/name,record)
    with (DIRECTORY/'codex-chat-template.jinja').open('x') as out:
        out.write(corrected)
    print(json.dumps({'derived_bytes':FINAL.stat().st_size,'derived_sha256':model_hash,
        'tensor_bytes_identical':True,'tensor_count':old['tensors'],'model_completion_requests':0}), flush=True)


if __name__ == '__main__':
    main()
