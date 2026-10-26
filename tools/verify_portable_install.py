"""Exercise a wheel's installed entrypoints in a fresh tool environment."""
from email.parser import BytesParser
import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile
import venv
import zipfile


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
        venv.EnvBuilder(with_pip=True).create(install)
        scripts = install / ('Scripts' if os.name == 'nt' else 'bin')
        python = scripts / ('python.exe' if os.name == 'nt' else 'python')

        def run(command, *, expected=0, timeout=15):
            result = subprocess.run(command, cwd=work, env=environment, capture_output=True,
                                    text=True, timeout=timeout)
            if result.returncode != expected:
                raise RuntimeError(f'{command[0]} exited {result.returncode}: {result.stderr[-8000:]}')
            return result

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
