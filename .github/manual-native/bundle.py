"""Temporary manual observation preparation and content-verified rehydration.

No command in this file runs a model. `prepare` downloads only the three pinned
assets. Native execution lives exclusively in observe.mjs. Never archive this
script's directory: the operator's private evidence key is NOT a runner input.
"""
from pathlib import Path, PurePosixPath
import hashlib, json, os, platform, re, shutil, stat, subprocess, sys, tarfile, time, urllib.error, urllib.request, zipfile

if os.environ.get('GITHUB_ACTIONS') != 'true':
    raise SystemExit('This temporary script requires an explicitly dispatched Actions job.')
OP = os.environ.get('OBS_OPERATION')
ID = os.environ.get('OBS_ID', '')
SHA = os.environ.get('OBS_CANDIDATE', '')
if not re.fullmatch(r'[a-z][a-z0-9-]{7,47}', ID) or not re.fullmatch(r'[a-f0-9]{40}', SHA):
    raise SystemExit('A unique observation id and exact candidate commit are required.')
ROOT = Path.home() / '.koto-native-observations' / ID
if 'OBS_ROOT' in os.environ and Path(os.environ['OBS_ROOT']) != ROOT:
    raise SystemExit('The native home/path identity changed; no restoration is allowed.')
WINDOWS = os.name == 'nt'
ACQUISITION_DEADLINE = time.monotonic() + 600
if platform.system() not in ['Linux','Windows'] or platform.machine().lower() not in ['x86_64','amd64']:
    raise SystemExit('Only the explicitly selected native x64 Linux or Windows runner is supported.')
ASSETS = {
    'model': ('https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/f86cb2c1fa58255f8052cc32aeede1b7482d4361/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf',
              1117320768, 'cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046'),
    'llama': (('https://github.com/ggml-org/llama.cpp/releases/download/b11935/llama-b11935-bin-win-cpu-x64.zip', 24255768, 'd13e3d617a724eef10a533b18d1178b5292f7f1395965adf4e83b1ab4e9fc4b6') if WINDOWS else
              ('https://github.com/ggml-org/llama.cpp/releases/download/b11935/llama-b11935-bin-ubuntu-x64.tar.gz', 22510930, '292803ab33750b8fee028df2b988b146f1f96d75ee7570c86f2eff01479bff55')),
    'opencode': (('https://github.com/anomalyco/opencode/releases/download/v1.19.4/opencode-windows-x64-baseline.zip', 81744966, '21cac96abb146b0f6e770680ea7855fc4f354c7966aab39f5be9859b0df1deac') if WINDOWS else
                 ('https://github.com/anomalyco/opencode/releases/download/v1.19.4/opencode-linux-x64-baseline.tar.gz', 79667571, '1697ef40558d378bd2f72efa8fafe1bed1f0e664f09247b9357556b95dbc7cbc')),
}

def digest(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        while block := f.read(1024 * 1024): h.update(block)
    return h.hexdigest()

def save(p, value):
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    p.write_text(json.dumps(value, indent=2) + '\n')
    p.chmod(0o600)

def command(args, cwd, label, timeout=120):
    env = dict({k:v for k,v in os.environ.items() if not re.search('TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|CREDENTIAL',k,re.I)},
               npm_config_cache=str(ROOT/'npm-cache'), npm_config_offline='true',
               npm_config_audit='false', npm_config_fund='false', npm_config_update_notifier='false', GIT_OPTIONAL_LOCKS='0')
    env.update(OPENCODE_CONFIG=str(ROOT/'host'/'opencode.json'),OPENCODE_DISABLE_AUTOUPDATE='1',OPENCODE_DISABLE_MODELS_FETCH='1',
               OPENCODE_DISABLE_PROJECT_CONFIG='1',OPENCODE_PURE='1',OPENCODE_DISABLE_DEFAULT_PLUGINS='true',
               OPENCODE_DISABLE_LSP_DOWNLOAD='true',OPENCODE_DISABLE_FFF='1',OPENCODE_DISABLE_CLAUDE_CODE='true',
               OPENCODE_DISABLE_EXTERNAL_SKILLS='true',OPENCODE_EXPERIMENTAL='false',OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS='false',
               OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER='true',
               XDG_CONFIG_HOME=str(ROOT/'host'/'config'),XDG_DATA_HOME=str(ROOT/'host'/'data'),
               XDG_CACHE_HOME=str(ROOT/'host'/'cache'),XDG_STATE_HOME=str(ROOT/'host'/'state'))
    env.pop('OPENCODE_CONFIG_DIR',None); env.pop('OPENCODE_CONFIG_CONTENT',None)
    # cmd.exe is needed only for npm's standard .cmd wrapper, never for agent argv.
    if WINDOWS and args[0] == 'npm':
        args = [os.environ.get('ComSpec', r'C:\Windows\System32\cmd.exe'), '/d', '/s', '/c', subprocess.list2cmdline(args)]
    r = subprocess.run(args, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    raw = ROOT/'evidence'/'raw'; raw.mkdir(parents=True, exist_ok=True, mode=0o700)
    (raw/f'{label}.stdout').write_bytes(r.stdout); (raw/f'{label}.stderr').write_bytes(r.stderr)
    if r.returncode: raise RuntimeError(f'{label}_failed')
    return r.stdout.decode('utf-8')

def environment():
    with open(os.environ['GITHUB_ENV'], 'a') as f:
        for k,v in {'OBS_ROOT':str(ROOT), 'KOTO_STATE_DIR':str(ROOT/'state')}.items(): f.write(f'{k}={v}\n')

def download(name):
    url, size, expected = ASSETS[name]
    target = ROOT/'assets'/('model.gguf' if name == 'model' else name + ('.zip' if WINDOWS else '.tar.gz'))
    failures = []
    for attempt in range(3):
        if time.monotonic() >= ACQUISITION_DEADLINE: break
        h = hashlib.sha256(); count = 0; started = time.monotonic()
        try:
            req = urllib.request.Request(url, headers={'User-Agent':'Koto-manual-native-observation'})
            with urllib.request.urlopen(req, timeout=60) as response, target.open('wb') as f:
                if not response.url.startswith('https://'): raise RuntimeError('insecure_redirect')
                while block := response.read(1024 * 1024):
                    count += len(block)
                    if count > size or time.monotonic() - started > 300 or time.monotonic() >= ACQUISITION_DEADLINE:
                        raise RuntimeError('asset_download_bound')
                    h.update(block); f.write(block)
            if count != size or h.hexdigest() != expected: raise RuntimeError('asset_digest_mismatch')
            save(ROOT/'evidence'/f'asset-{name}.json', {'url':url,'bytes':count,'sha256':expected,'attempts':attempt+1,'priorFailures':failures})
            return target
        except Exception as e:
            failures.append(type(e).__name__)
            if target.exists(): target.unlink()
            if isinstance(e, urllib.error.HTTPError) and e.code == 429: break
            if time.monotonic() >= ACQUISITION_DEADLINE: break
            if attempt < 2: time.sleep((2 ** (attempt + 1)) + int.from_bytes(os.urandom(1),'big')/255)
    save(ROOT/'evidence'/f'asset-{name}.json', {'url':url,'status':'failed','failures':failures})
    raise RuntimeError('pinned_asset_acquisition_failed')

def extract_asset(archive, destination):
    destination.mkdir(mode=0o700)
    if archive.suffix == '.zip':
        with zipfile.ZipFile(archive) as z:
            if sum(i.file_size for i in z.infolist()) > 1024**3: raise RuntimeError('asset_unpack_bound')
            for item in z.infolist():
                name = PurePosixPath(item.filename)
                if name.is_absolute() or '..' in name.parts or ':' in item.filename or '\\' in item.filename:
                    raise RuntimeError('asset_archive_path')
                if stat.S_ISLNK(item.external_attr >> 16): raise RuntimeError('asset_archive_link')
            z.extractall(destination)
    else:
        with tarfile.open(archive) as t:
            if sum(m.size for m in t.getmembers()) > 1024**3: raise RuntimeError('asset_unpack_bound')
            t.extractall(destination, filter='data')

def find_executable(root, name):
    matches = [p for p in root.rglob(name) if p.is_file() and not p.is_symlink()]
    if len(matches) != 1: raise RuntimeError('native_executable_ambiguous')
    matches[0].chmod(matches[0].stat().st_mode | 0o700)
    return str(matches[0].resolve())

def install_package():
    command(['npm','install','--ignore-scripts','--no-audit','--no-fund','--offline','--no-save','--package-lock=false',
             '--prefix',str(ROOT/'install'),str(ROOT/'assets'/'koto.tgz')], ROOT, 'npm-install')
    installed = ROOT/'install'/'node_modules'/'@mehrdadxzaker'/'koto'
    rows = []
    with tarfile.open(ROOT/'assets'/'koto.tgz') as archive:
        for m in archive.getmembers():
            if not m.isfile(): continue
            relative = PurePosixPath(m.name).relative_to('package').as_posix()
            expected = archive.extractfile(m).read()
            p = installed/relative
            if not p.is_file() or p.is_symlink() or p.read_bytes() != expected: raise RuntimeError('installed_payload_mismatch')
            rows.append({'path':relative,'sha256':hashlib.sha256(expected).hexdigest(),'bytes':len(expected)})
    actual = sorted(p.relative_to(installed).as_posix() for p in installed.rglob('*') if p.is_file())
    if actual != sorted(r['path'] for r in rows): raise RuntimeError('installed_payload_extra')
    save(ROOT/'evidence'/'package.json', {'candidate':SHA,'tarSha256':digest(ROOT/'assets'/'koto.tgz'),'payload':rows})

def prepare():
    if OP != 'observe' or ROOT.exists(): raise RuntimeError('fresh_observation_root_required')
    ROOT.mkdir(parents=True,mode=0o700)
    for sub in ['assets','tools','state','host/config','host/data','host/cache','host/state','evidence/raw','out','disabled-hooks']:
        (ROOT/sub).mkdir(parents=True,exist_ok=True,mode=0o700)
    environment()
    if shutil.disk_usage(ROOT).free < 4 * 1024**3: raise RuntimeError('four_gib_disk_reserve_required')
    source = Path(os.environ['OBS_CANDIDATE_DIRECTORY']).resolve()
    head = command(['git','rev-parse','HEAD'],source,'candidate-head').strip()
    if head != SHA: raise RuntimeError('candidate_checkout_mismatch')
    command(['git','-c',f'core.hooksPath={ROOT/"disabled-hooks"}','clone','--no-local','--no-hardlinks','--no-checkout',str(source),str(ROOT/'project')],ROOT,'project-clone')
    command(['git','-c','core.autocrlf=false','checkout','--detach',SHA],ROOT/'project','project-checkout')
    for key,value in [('user.name','Koto Native Observation'),('user.email','koto-observation@users.noreply.github.com'),('core.autocrlf','false')]:
        command(['git','config','--local',key,value],ROOT/'project','git-config-'+key)
    if (ROOT/'project'/'.git'/'objects'/'info'/'alternates').exists(): raise RuntimeError('external_git_objects_unsupported')
    # Package the fresh core.autocrlf=false checkout, including on Windows.
    # The checkout Action's host line-ending defaults must not change payload.
    source=ROOT/'project'
    command(['npm','run','check'],source,'source-check')
    pack = json.loads(command(['npm','pack','--ignore-scripts','--offline','--json','--pack-destination',str(ROOT/'assets')],source,'npm-pack'))
    if len(pack) != 1: raise RuntimeError('single_package_required')
    (ROOT/'assets'/pack[0]['filename']).rename(ROOT/'assets'/'koto.tgz')
    install_package()
    # The requested source and the installed package must agree, not just the tar.
    for item in json.loads((ROOT/'evidence'/'package.json').read_text())['payload']:
        if digest(source/item['path']) != item['sha256']: raise RuntimeError('source_package_mismatch')
    model=download('model')
    extract_asset(download('llama'),ROOT/'tools'/'llama')
    extract_asset(download('opencode'),ROOT/'tools'/'opencode')
    llama=find_executable(ROOT/'tools'/'llama','llama-server.exe' if WINDOWS else 'llama-server')
    opencode=find_executable(ROOT/'tools'/'opencode','opencode.exe' if WINDOWS else 'opencode')
    config={'$schema':'https://opencode.ai/config.json','autoupdate':False,'share':'disabled',
         'plugin':[],'mcp':{},'lsp':False,'formatter':False,'compaction':{'auto':False},
         'agent':{'build':{'steps':4},'title':{'disable':True}},
         'permission':{'*':'deny','read':'allow','list':'allow','glob':'allow','grep':'allow',
             'edit':{'*':'deny','docs/INSTALLATION.md':'allow','*/docs/INSTALLATION.md':'allow'},'bash':'deny','question':'allow'},
         'enabled_providers':['local'],'model':'local/koto-qwen-coder','small_model':'local/koto-qwen-coder',
         'provider':{'local':{'npm':'@ai-sdk/openai-compatible','name':'Owned loopback model',
             'options':{'baseURL':'http://127.0.0.1:18089/v1','timeout':120000,'headerTimeout':120000,'chunkTimeout':30000},
             'models':{'koto-qwen-coder':{'name':'Qwen2.5 Coder 1.5B pinned GGUF','tool_call':True,'limit':{'context':8192,'output':512}}}}}}
    save(ROOT/'host'/'opencode.json',config)
    opencode_version=command([opencode,'--version'],ROOT,'opencode-version',timeout=15).strip()
    if opencode_version!='1.19.4': raise RuntimeError('opencode_version_mismatch')
    effective_text=command([opencode,'debug','config'],ROOT,'opencode-effective-config',timeout=30)
    effective=json.loads(effective_text)
    for key in ['autoupdate','share','plugin','mcp','lsp','formatter','compaction','enabled_providers','model','small_model','permission']:
        if effective.get(key)!=config[key]: raise RuntimeError('native_effective_config_changed')
    if effective.get('provider',{}).get('local',{}).get('options')!=config['provider']['local']['options']:
        raise RuntimeError('native_effective_endpoint_changed')
    if effective.get('agent',{}).get('title',{}).get('disable') is not True or effective.get('agent',{}).get('build',{}).get('steps')!=4:
        raise RuntimeError('native_effective_agent_changed')
    save(ROOT/'evidence'/'native-config.json',{'requestedSha256':digest(ROOT/'host'/'opencode.json'),
         'effectiveSha256':hashlib.sha256(effective_text.encode()).hexdigest(),'checkedBeforeModelStart':True})
    command([llama,'--version'],ROOT,'llama-version',timeout=15)
    save(ROOT/'evidence'/'host.json',{'system':platform.platform(),'architecture':platform.machine(),
         'node':command(['node','--version'],ROOT,'node-version').strip(),'opencode':opencode_version,
         'runnerImage':os.environ.get('ImageVersion'),'runnerImageOS':os.environ.get('ImageOS')})
    save(ROOT/'prepared.json', {'schemaVersion':1,'candidate':SHA,'root':str(ROOT),'platform':platform.system(),
         'llama':llama,'opencode':opencode,'model':str(model),'assets':ASSETS})

def verify_reference():
    if OP != 'integrate': raise RuntimeError('integration_operation_required')
    if not all(re.fullmatch(r'[0-9]+',os.environ.get(k,'')) for k in ['OBS_ARTIFACT_ID','OBS_SOURCE_RUN']): raise RuntimeError('immutable_artifact_identity_required')
    expected=os.environ.get('OBS_ARTIFACT_DIGEST','')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',expected): raise RuntimeError('artifact_digest_required')
    req=urllib.request.Request(f'https://api.github.com/repos/mehrdadxzaker/Koto/actions/artifacts/{os.environ["OBS_ARTIFACT_ID"]}',
        headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
    with urllib.request.urlopen(req,timeout=30) as response:
        data=response.read(65537)
    if len(data)>65536: raise RuntimeError('artifact_metadata_bound')
    meta=json.loads(data)
    if meta.get('digest')!=expected or meta.get('expired') or str(meta.get('workflow_run',{}).get('id'))!=os.environ['OBS_SOURCE_RUN']:
        raise RuntimeError('source_artifact_identity_changed')
    if meta.get('name')!=f'native-{ID}-{os.environ["OBS_RUNNER"]}': raise RuntimeError('source_artifact_name_changed')

def safe_files(base):
    if not base.exists(): return []
    result=[]
    for p in [base,*base.rglob('*')]:
        if p.is_symlink() or not (p.is_file() or p.is_dir()): raise RuntimeError('rehydration_special_file_unsupported')
        if p.is_file(): result.append(p)
    return result

def seal():
    if not ROOT.exists(): return
    (ROOT/'out').mkdir(exist_ok=True,mode=0o700)
    # Preserve every raw file in encrypted evidence, never in the public bundle.
    with tarfile.open(ROOT/'raw-evidence.tar','w') as raw:
        for relative in ['evidence','host','control','control-worktrees','project','state']:
            p=ROOT/relative
            if p.exists(): raw.add(p,arcname=relative,recursive=True)
    public={'schemaVersion':1,'candidate':SHA,'root':str(ROOT),'operation':OP,'runner':os.environ['OBS_RUNNER']}
    observation=ROOT/'evidence'/'observation.json'
    if not observation.exists():
        public['rehydration']='unavailable_no_observation'
        save(ROOT/'out'/'receipt.json',public); return
    data=json.loads(observation.read_text())
    session=Path(data['sessionRoot']) if data.get('sessionRoot') else None
    try:
        if not session or not session.is_relative_to(ROOT/'control'): raise RuntimeError('session_path_changed')
        state=json.loads((session/'project-session.json').read_text())
        if state.get('active') or any(a['status'] in ['pending','running'] for a in state['agents']): raise RuntimeError('session_not_settled')
        if any(not a.get('commandOutcome') for a in state['agents']): raise RuntimeError('command_cleanup_evidence_missing')
        if any('cleanup_unconfirmed' in json.dumps(a) for a in state['agents']): raise RuntimeError('cleanup_not_confirmed')
        runtime=json.loads((ROOT/'evidence'/'runtime-completion.json').read_text())
        if runtime.get('error') or runtime.get('status') not in ['cancelled','succeeded']: raise RuntimeError('runtime_cleanup_not_confirmed')
        if any(session.glob('*.lock')) or (session/'contribution-attempt.json').exists(): raise RuntimeError('retained_lock_or_attempt')
        if OP=='observe' and any(v.get('outsideOwnership') for v in data.get('inspections',{}).values()): raise RuntimeError('outside_ownership')
        if data.get('projectAfter')!=data.get('projectBefore') or data.get('projectBefore')!={'head':SHA,'status':''}:
            raise RuntimeError('original_project_changed')
        # Ignored native history is not a contribution and must not leak into
        # the public bundle merely because it was created inside a worktree.
        source_files=set(command(['git','ls-tree','-r','--name-only','-z',SHA],ROOT/'project','source-public-inventory').split('\0'))
        worktree_roots=[ROOT/'project']+[p for p in (ROOT/'control-worktrees').glob('*/*') if p.is_dir()]
        for workspace in worktree_roots:
            for p in safe_files(workspace):
                relative=p.relative_to(workspace).as_posix()
                if relative=='.git' or relative.startswith('.git/'): continue
                if relative not in source_files: raise RuntimeError('untracked_or_ignored_file_requires_private_review')
        includes=[ROOT/'project',ROOT/'control-worktrees',ROOT/'state'/'native',ROOT/'disabled-hooks',ROOT/'assets'/'koto.tgz',ROOT/'prepared.json']
        # Only minimal control JSON and empty disabled-hooks; raw events stay encrypted.
        control_files=[p for p in safe_files(ROOT/'control') if p.name!='events.jsonl']
        allowed_control={'project-session.json','workspaces.json','workspace-manifest.json','manifest.json'}
        if OP=='observe' and any(p.name not in allowed_control for p in control_files): raise RuntimeError('unexpected_control_file_requires_review')
        files=[p for base in includes for p in safe_files(base)]+control_files
        files += [p for p in (ROOT/'evidence').glob('*.json') if p.name!='integration.json' or OP=='integrate']
        unique={p.relative_to(ROOT).as_posix():p for p in files}
        if sum(p.stat().st_size for p in unique.values())>1024**3: raise RuntimeError('rehydration_size_bound')
        if any(p.name.endswith('.lock') for p in unique.values()): raise RuntimeError('retained_git_or_helper_lock')
        # Refuse unreviewed/unsupported external Git object stores and executable hooks.
        if any(name.endswith('/objects/info/alternates') for name in unique): raise RuntimeError('external_git_objects')
        manifest={'schemaVersion':1,'candidate':SHA,'root':str(ROOT),'platform':platform.system(),'files':[],'directories':[]}
        dirs=set()
        for p in unique.values():
            for parent in p.parents:
                if parent==ROOT: break
                dirs.add(parent.relative_to(ROOT).as_posix())
        dirs.update([str(p.relative_to(ROOT)).replace('\\','/') for p in (ROOT/'control').rglob('*') if p.is_dir()])
        dirs.add('disabled-hooks')
        manifest['directories']=sorted(dirs)
        archive=ROOT/'out'/'rehydration.zip'
        with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            for relative,p in sorted(unique.items()):
                row={'path':relative,'bytes':p.stat().st_size,'sha256':digest(p),'mode':stat.S_IMODE(p.stat().st_mode)}
                manifest['files'].append(row); z.write(p,relative)
            z.writestr('REHYDRATION-MANIFEST.json',json.dumps(manifest,indent=2)+'\n')
        public.update(rehydration='available',bundleSha256=digest(archive),fileCount=len(unique),
            reviewToken=data.get('inspections',{}).get('contributor',{}).get('reviewToken'),
            interpretation='Unreviewed native observations; no automatic acceptance or integration.')
        if OP=='integrate' and (ROOT/'evidence'/'integration.json').exists():
            integration=json.loads((ROOT/'evidence'/'integration.json').read_text())
            public['integration']={'status':integration.get('result',{}).get('status'),
                'integrationCommit':integration.get('result',{}).get('integrationCommit'),
                'originalProjectUnchanged':integration.get('projectAfter')==integration.get('projectBefore'),
                'error':integration.get('error')}
    except Exception as e:
        public['rehydration']='refused'; public['reason']=str(e)
    save(ROOT/'out'/'receipt.json',public)

def restore():
    if OP!='integrate' or ROOT.exists(): raise RuntimeError('fresh_restore_root_required')
    bundle=Path(os.environ['OBS_DOWNLOAD_DIRECTORY'])/'rehydration.zip'
    if not re.fullmatch(r'[a-f0-9]{64}',os.environ.get('OBS_BUNDLE_SHA','')) or digest(bundle)!=os.environ['OBS_BUNDLE_SHA']:
        raise RuntimeError('reviewed_bundle_digest_changed')
    with zipfile.ZipFile(bundle) as z:
        manifest=json.loads(z.read('REHYDRATION-MANIFEST.json'))
        if manifest.get('candidate')!=SHA or manifest.get('root')!=str(ROOT) or manifest.get('platform')!=platform.system():
            raise RuntimeError('rehydration_host_or_path_changed')
        rows=manifest['files']; names=[r['path'] for r in rows]
        if len(names)!=len(set(n.casefold() for n in names)) or sorted(z.namelist())!=sorted(names+['REHYDRATION-MANIFEST.json']):
            raise RuntimeError('rehydration_inventory_changed')
        for name in names+manifest['directories']:
            p=PurePosixPath(name)
            if p.is_absolute() or '..' in p.parts or ':' in name or '\\' in name or not name:
                raise RuntimeError('rehydration_path_invalid')
        if sum(r['bytes'] for r in rows)>1024**3: raise RuntimeError('rehydration_size_bound')
        ROOT.mkdir(parents=True,mode=0o700); environment()
        for name in manifest['directories']: (ROOT/name).mkdir(parents=True,exist_ok=True,mode=0o700)
        for row in rows:
            content=z.read(row['path'])
            if len(content)!=row['bytes'] or hashlib.sha256(content).hexdigest()!=row['sha256']: raise RuntimeError('rehydration_file_changed')
            target=ROOT/row['path']; target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            with target.open('xb') as f: f.write(content)
            target.chmod(row['mode'] & 0o777)
    # New files are owned by the new runner, never a restored foreign SID/UID.
    # Koto independently checks private ownership, ACLs, paths and the old token.
    install_package()
    save(ROOT/'evidence'/'restoration.json',{'bundleSha256':os.environ['OBS_BUNDLE_SHA'],'files':len(rows),'pathsRewritten':False,'candidate':SHA})

actions={'prepare':prepare,'verify-reference':verify_reference,'seal':seal,'restore':restore}
try:
    actions[sys.argv[1]]()
except Exception as error:
    if ROOT.exists():
        raw=ROOT/'evidence'/'raw'; raw.mkdir(parents=True,exist_ok=True,mode=0o700)
        with (raw/'preparation-errors.jsonl').open('a') as f:
            f.write(json.dumps({'operation':sys.argv[1],'type':type(error).__name__,'message':str(error)})+'\n')
    raise
