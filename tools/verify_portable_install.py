"""Exercise a wheel's installed entrypoints in a fresh tool environment."""
from email.parser import BytesParser
import argparse
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tempfile
import time
import zipfile


class _WindowsJob:
    """Own a gated worker and every descendant before it can start a command."""
    def __init__(self):
        import ctypes
        from ctypes import wintypes

        class Limits(ctypes.Structure):
            _fields_ = [('process_time', ctypes.c_int64), ('job_time', ctypes.c_int64),
                        ('flags', wintypes.DWORD), ('minimum', ctypes.c_size_t),
                        ('maximum', ctypes.c_size_t), ('active', wintypes.DWORD),
                        ('affinity', ctypes.c_size_t), ('priority', wintypes.DWORD),
                        ('scheduling', wintypes.DWORD)]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [('basic', Limits), ('io', ctypes.c_uint64 * 6),
                        ('process_memory', ctypes.c_size_t), ('job_memory', ctypes.c_size_t),
                        ('peak_process_memory', ctypes.c_size_t), ('peak_job_memory', ctypes.c_size_t)]

        self.api = ctypes.WinDLL('kernel32', use_last_error=True)
        for name, arguments, result in (
            ('CreateJobObjectW', [ctypes.c_void_p, wintypes.LPCWSTR], wintypes.HANDLE),
            ('SetInformationJobObject', [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD], wintypes.BOOL),
            ('OpenProcess', [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE),
            ('AssignProcessToJobObject', [wintypes.HANDLE, wintypes.HANDLE], wintypes.BOOL),
            ('CloseHandle', [wintypes.HANDLE], wintypes.BOOL),
        ):
            function = getattr(self.api, name)
            function.argtypes, function.restype = arguments, result
        self.handle = self.api.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = ExtendedLimits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def assign(self, pid):
        import ctypes

        process = self.api.OpenProcess(0x0101, False, pid)  # SET_QUOTA | TERMINATE
        if not process:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            if not self.api.AssignProcessToJobObject(self.handle, process):
                raise ctypes.WinError(ctypes.get_last_error())
        finally:
            self.api.CloseHandle(process)

    def close(self):
        if self.handle:
            self.api.CloseHandle(self.handle)
            self.handle = None


def run_command(command, *, cwd, environment, expected=0, timeout=15):
    """Run a verification operation, stopping its owned tree on every exit."""
    job = _WindowsJob() if os.name == 'nt' else None
    process = None
    timed_out = None
    try:
        if job is not None:
            # Wait for the parent's stdin handshake before spawning anything.
            # Assignment therefore precedes ensurepip/pip and has no spawn race.
            worker = ('import json,subprocess,sys; command=json.loads(sys.stdin.readline()); '
                      'raise SystemExit(subprocess.call(command,stdin=subprocess.DEVNULL))')
            process = subprocess.Popen([sys.executable, '-c', worker], cwd=cwd, env=environment,
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            job.assign(process.pid)
            stdout, stderr = process.communicate(json.dumps(command) + '\n', timeout=timeout)
        else:
            process = subprocess.Popen(command, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                       start_new_session=True)
            stdout, stderr = process.communicate(timeout=timeout)
        result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
    except subprocess.TimeoutExpired as error:
        timed_out = error
        raise
    finally:
        if job is not None:
            job.close()
        elif process is not None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if process is not None:
            if process.poll() is None:
                process.kill()
            try:
                stdout, stderr = process.communicate(timeout=2)
                # Windows reports no partial output until its reader threads
                # see EOF. Preserve the bounded post-cleanup result for callers.
                if timed_out is not None:
                    timed_out.output, timed_out.stderr = stdout, stderr
            except subprocess.TimeoutExpired:
                for stream in (process.stdin, process.stdout, process.stderr):
                    if stream is not None:
                        stream.close()
                process.wait(timeout=2)
    if result.returncode != expected:
        raise RuntimeError(f'{command[0]} exited {result.returncode}: {result.stderr[-8000:]}')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('distribution', type=Path, help='one wheel or a directory containing one wheel')
    args = parser.parse_args()
    source = args.distribution.resolve()
    wheels = list(source.glob('*.whl')) if source.is_dir() else [source]
    if len(wheels) != 1 or not wheels[0].is_file() or wheels[0].suffix != '.whl':
        parser.error('select exactly one built wheel')
    wheel = wheels[0]
    with zipfile.ZipFile(wheel) as archive:
        metadata = [name for name in archive.namelist() if name.endswith('.dist-info/METADATA')]
        if len(metadata) != 1:
            parser.error('wheel must contain one package metadata record')
        package = BytesParser().parsebytes(archive.read(metadata[0]))
        if package['Name'] != 'koto-router' or not package['Version']:
            parser.error('expected a versioned koto-router wheel')
        version = package['Version']
    with tempfile.TemporaryDirectory(prefix='koto-portable-install-') as temporary:
        root = Path(temporary)
        install = root / 'environment'
        work = root / 'unrelated-directory'
        work.mkdir()
        environment = {key: value for key, value in os.environ.items()
                       if key not in {'PYTHONPATH', 'PYTHONHOME', 'KOTO_CONFIG', 'HORMUZ_CONFIG'}}
        environment.update(XDG_CONFIG_HOME=str(root / 'settings'), XDG_DATA_HOME=str(root / 'data'),
                           CODEX_HOME=str(root / 'codex'), KOTO_HISTORY_HOME=str(root / 'history'),
                           PYTHONDONTWRITEBYTECODE='1', PIP_NO_INPUT='1', PIP_DISABLE_PIP_VERSION_CHECK='1',
                           PIP_RETRIES='2', PIP_TIMEOUT='30')
        # Exercise timeout cleanup on the actual OS before starting an installer.
        marker = root / 'surviving-verifier-child'
        child = f'import time,pathlib; time.sleep(2); pathlib.Path({str(marker)!r}).touch()'
        parent = ('import subprocess,sys,time; '
                  f'subprocess.Popen([sys.executable,"-c",{child!r}]); '
                  'print("descendant started",flush=True); time.sleep(60)')
        try:
            run_command([sys.executable, '-c', parent], cwd=work, environment=environment, timeout=1)
            raise RuntimeError('verification deadline did not stop its command')
        except subprocess.TimeoutExpired as error:
            output = error.output or b''
            if isinstance(output, bytes):
                output = output.decode()
            if 'descendant started' not in output:
                raise RuntimeError('timeout check did not reach its child boundary') from error
        time.sleep(2.2)
        if marker.exists():
            raise RuntimeError('verification timeout left a descendant running')
        scripts = install / ('Scripts' if os.name == 'nt' else 'bin')
        python = scripts / ('python.exe' if os.name == 'nt' else 'python')

        def run(command, *, expected=0, timeout=15):
            return run_command(command, cwd=work, environment=environment,
                               expected=expected, timeout=timeout)

        run([sys.executable, '-m', 'venv', str(install)], timeout=180)
        run([str(python), '-m', 'pip', 'install', str(wheel)], timeout=180)
        imported = json.loads(run([str(python), '-I', '-c',
            'import json,koto,hormuz; print(json.dumps([koto.__file__,hormuz.__file__]))']).stdout)
        if not all(Path(path).resolve().is_relative_to(install.resolve()) for path in imported):
            raise RuntimeError('entrypoints imported a package outside the new environment')
        checked = []
        for name in ('koto', 'hormuz'):
            command = str(scripts / (name + '.exe' if os.name == 'nt' else name))
            if 'usage: koto ' not in run([command, '--help']).stdout:
                raise RuntimeError('installed help is unavailable: ' + name)
            if run([command, '--version']).stdout.strip() != version:
                raise RuntimeError('installed version differs from wheel metadata: ' + name)
            default = run([command, 'config', 'path']).stdout.strip()
            if Path(default) != root / 'settings' / 'koto' / 'config.json':
                raise RuntimeError('configuration depends on the working directory')
            explicit = root / 'explicit.json'
            if Path(run([command, '--config', str(explicit), 'config', 'path']).stdout.strip()) != explicit:
                raise RuntimeError('explicit configuration was not selected')
            project = root / 'project'
            if Path(run([command, '--project', str(project), 'config', 'path']).stdout.strip()) != project / '.koto' / 'config.json':
                raise RuntimeError('explicit project configuration was not selected')
            manifest = json.loads(run([command, 'contract', 'manifest']).stdout)
            identities = {(row['schema_id'], row['schema_version']) for row in manifest['schemas']}
            if not {('koto.native-task', 1), ('koto.native-task', 2)} <= identities:
                raise RuntimeError('installed contract manifest is incomplete')
            if os.name == 'nt':
                denied = run([command, 'client', 'status', 'codex', '--client-home', str(root / 'unsupported-home')], expected=2)
                error = json.loads(denied.stdout or denied.stderr)
                if error['error']['code'] != 'connected_client_platform_unsupported':
                    raise RuntimeError('unsupported native connections did not report their platform')
                if 'Traceback' in denied.stdout + denied.stderr:
                    raise RuntimeError('unsupported native connections crashed')
            checked.append(name)
        for name in ('settings', 'data', 'codex', 'history', 'project', 'unsupported-home'):
            if (root / name).exists():
                raise RuntimeError('inspection commands created user state: ' + name)
    print(json.dumps({'portable_installation': 'passed', 'version': version,
                      'system': platform.system(), 'machine': platform.machine(),
                      'entrypoints': checked, 'models_downloaded': False,
                      'native_runtime_qualification': False}, sort_keys=True))


if __name__ == '__main__':
    main()
