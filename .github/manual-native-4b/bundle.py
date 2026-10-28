"""Temporary manual observation preparation and content-verified rehydration.

No command in this file runs a model. Windows `prepare` downloads only three pinned
assets. Native execution lives exclusively in observe.mjs. Never archive this
script's directory: the operator's private evidence key is NOT a runner input.
"""
from pathlib import Path, PurePosixPath
import errno, hashlib, json, os, platform, re, shutil, stat, subprocess, sys, tarfile, time, unicodedata, urllib.error, urllib.request, zipfile

if os.environ.get('OBS_EXECUTION') != 'windows-actions' or os.environ.get('GITHUB_ACTIONS') != 'true':
    raise SystemExit('Windows Actions preparation only. Linux Docker uses the separately owned offline wrapper; no implicit acquisition or automatic observation is allowed here.')
OP = os.environ.get('OBS_OPERATION')
ID = os.environ.get('OBS_ID', '')
SHA = os.environ.get('OBS_CANDIDATE', '')
if not re.fullmatch(r'[a-z][a-z0-9-]{7,47}', ID) or not re.fullmatch(r'[a-f0-9]{40}', SHA):
    raise SystemExit('A unique observation id and exact candidate commit are required.')
VARIANT = 'qwen3-4b'
ROOT = Path.home() / '.koto-native-observations-4b' / ID
if 'OBS_ROOT' in os.environ and Path(os.environ['OBS_ROOT']) != ROOT:
    raise SystemExit('The native home/path identity changed; no restoration is allowed.')
WINDOWS = os.name == 'nt'
ACQUISITION_DEADLINE = None
SETTINGS = None
PREPARE_BOOTSTRAPPED = False
if platform.system() != 'Windows' or platform.machine().lower() not in ['x86_64','amd64']:
    raise SystemExit('Only the explicitly selected native Windows x64 runner is supported by this Actions driver.')
ASSETS = {
    'model': ('https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf',
              2497280256, '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5'),
    'llama': ('https://github.com/ggml-org/llama.cpp/releases/download/b11935/llama-b11935-bin-win-cpu-x64.zip', 24255768, 'd13e3d617a724eef10a533b18d1178b5292f7f1395965adf4e83b1ab4e9fc4b6'),
    'opencode': ('https://github.com/anomalyco/opencode/releases/download/v1.19.4/opencode-windows-x64-baseline.zip', 81744966, '21cac96abb146b0f6e770680ea7855fc4f354c7966aab39f5be9859b0df1deac'),
}

def resource_exhausted(error):
    pending=[error]; seen=set()
    for _ in range(8):
        if not pending: return False
        value=pending.pop(0)
        if id(value) in seen: continue
        seen.add(id(value))
        if getattr(value,'errno',None) in {errno.EMFILE,errno.ENFILE,errno.EADDRNOTAVAIL,errno.ENOBUFS}: return True
        for key in ['reason','__cause__','__context__']:
            child=getattr(value,key,None)
            if isinstance(child,BaseException): pending.append(child)
    return False

def archive_inventory(files, directories):
    seen={}; explicit=set()
    for name,kind in [(n,'directory') for n in directories]+[(n,'file') for n in files]:
        if not isinstance(name,str) or not name or unicodedata.normalize('NFC',name)!=name or any(ord(c)<32 for c in name):
            raise RuntimeError('archive_path_invalid')
        p=PurePosixPath(name)
        if p.is_absolute() or p.as_posix()!=name or '..' in p.parts or ':' in name or '\\' in name:
            raise RuntimeError('archive_path_invalid')
        if any(part.rstrip(' .')!=part or re.fullmatch(r'(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?',part) for part in p.parts):
            raise RuntimeError('archive_windows_reserved_path')
        if name in explicit: raise RuntimeError('archive_duplicate_path')
        explicit.add(name)
        for i in range(1,len(p.parts)+1):
            part='/'.join(p.parts[:i]); part_kind=kind if i==len(p.parts) else 'directory'; key=part.casefold()
            prior=seen.get(key)
            if prior and prior!=(part,part_kind): raise RuntimeError('archive_parent_alias_or_type_conflict')
            seen[key]=(part,part_kind)

def digest(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        while block := f.read(1024 * 1024): h.update(block)
    return h.hexdigest()

def save(p, value):
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    p.write_text(json.dumps(value, indent=2) + '\n')
    p.chmod(0o600)

def owned_preparation(args, cwd, label, timeout, env, mode='run'):
    halt=ROOT/'evidence'/'preparation-halt.json'
    if halt.exists(): raise RuntimeError('preparation_already_halted')
    raw=ROOT/'evidence'/'raw'; raw.mkdir(parents=True,exist_ok=True,mode=0o700)
    request=raw/f'{label}.request.json'
    if request.exists(): raise RuntimeError('preparation_command_label_reused')
    git=shutil.which('git')
    node=shutil.which('node')
    if not git or not node: raise RuntimeError('existing_node_and_git_required')
    save(request,{'root':str(ROOT),'candidate':SHA,'mode':mode,'label':label,'git':git,
                  'args':args,'cwd':str(cwd),'timeoutMs':timeout*1000})
    # This JS supervisor owns the Windows Job and its bounded timeout/cleanup.
    # Do not use subprocess.run(timeout), which would kill only that supervisor
    # before it can await job cleanup. Product helper build/tool calls are also
    # individually bounded; no native model is involved in this runner.
    try:
        r=subprocess.run([node,str(Path(__file__).with_name('windows-preparation-runner.mjs')),str(request)],
                         env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if len(r.stdout)>65536 or len(r.stderr)>65536: raise RuntimeError('preparation_supervisor_output_bound')
        try: meta=json.loads(r.stdout)
        except ValueError: raise RuntimeError('preparation_cleanup_unconfirmed')
        receipt=raw/f'{label}.owned.json'
        if not receipt.is_file() or receipt.stat().st_size>65536: raise RuntimeError('preparation_cleanup_unconfirmed')
        settled=json.loads(receipt.read_text())
        if settled.get('candidate')!=SHA or settled.get('label')!=label or settled.get('mode')!=mode:
            raise RuntimeError('preparation_cleanup_unconfirmed')
        outcome=settled.get('outcome') or {}
        if mode=='run' and (outcome.get('error')=='cleanup_unconfirmed' or not outcome):
            raise RuntimeError('preparation_cleanup_unconfirmed')
        if r.returncode or meta.get('status')!='complete' or settled.get('error'):
            code=settled.get('error') or 'preparation_failed'
            raise RuntimeError(code if re.fullmatch(r'[a-z][a-z0-9_]+',code) else 'preparation_failed')
        if mode=='run' and (outcome.get('status')!='succeeded' or outcome.get('error')):
            raise RuntimeError('preparation_failed')
        output=raw/f'{label}.stdout'
        if output.stat().st_size>8*1024**2: raise RuntimeError('preparation_output_bound')
        return output.read_text(encoding='utf-8')
    except Exception as error:
        save(halt,{'error':str(error),'label':label,'candidate':SHA})
        raise

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
               XDG_CACHE_HOME=str(ROOT/'host'/'cache'),XDG_STATE_HOME=str(ROOT/'host'/'state'),KOTO_STATE_DIR=str(ROOT/'state'))
    env.pop('OPENCODE_CONFIG_DIR',None); env.pop('OPENCODE_CONFIG_CONTENT',None)
    for key in list(env):
        if key.upper() in ['NODE_OPTIONS','NODE_PATH']: env.pop(key)
    bootstrap_labels={'host-admission','candidate-head','project-clone','project-checkout','git-config-user.name','git-config-user.email','git-config-core.autocrlf'}
    if sys.argv[1]=='prepare' and not PREPARE_BOOTSTRAPPED and label in bootstrap_labels and args[0] in ['git','node']:
        # Only finite Git source preparation and the pure Node memory snapshot
        # precede the native helper. No npm/client/compiler process uses this path.
        pass
    else:
        return owned_preparation(args,cwd,label,timeout,env)
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
                    if count > size or time.monotonic() - started > SETTINGS['bounds']['assetAttemptTimeoutSeconds'] or time.monotonic() >= ACQUISITION_DEADLINE:
                        raise RuntimeError('asset_download_bound')
                    h.update(block); f.write(block)
            if count != size or h.hexdigest() != expected: raise RuntimeError('asset_digest_mismatch')
            save(ROOT/'evidence'/f'asset-{name}.json', {'url':url,'bytes':count,'sha256':expected,'attempts':attempt+1,'priorFailures':failures})
            return target
        except Exception as e:
            failures.append(type(e).__name__)
            if target.exists(): target.unlink()
            if resource_exhausted(e):
                save(ROOT/'evidence'/f'asset-{name}.json', {'status':'failed','error':'resource_exhausted','failures':failures})
                raise RuntimeError('asset_resource_exhausted') from e
            if isinstance(e, urllib.error.HTTPError) and e.code == 429: break
            if time.monotonic() >= ACQUISITION_DEADLINE: break
            if attempt < 2: time.sleep((2 ** (attempt + 1)) + int.from_bytes(os.urandom(1),'big')/255)
    save(ROOT/'evidence'/f'asset-{name}.json', {'url':url,'status':'failed','failures':failures})
    raise RuntimeError('pinned_asset_acquisition_failed')

def extract_asset(archive, destination):
    destination.mkdir(mode=0o700)
    if archive.suffix == '.zip':
        with zipfile.ZipFile(archive) as z:
            if len(z.infolist())>50000: raise RuntimeError('asset_entry_bound')
            if sum(i.file_size for i in z.infolist()) > 1024**3: raise RuntimeError('asset_unpack_bound')
            archive_inventory([i.filename for i in z.infolist() if not i.is_dir()],
                              [i.filename.rstrip('/') for i in z.infolist() if i.is_dir()])
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
    if not isinstance(SETTINGS,dict): raise RuntimeError('reviewed_installation_settings_required')
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
    inventory=[[r['path'],r['bytes'],r['sha256']] for r in sorted(rows,key=lambda r:r['path'])]
    inventory_sha=hashlib.sha256(json.dumps(inventory,separators=(',',':'),ensure_ascii=False).encode('utf-8')).hexdigest()
    save(ROOT/'evidence'/'package.json', {'candidate':SHA,'tarSha256':digest(ROOT/'assets'/'koto.tgz'),
         'payloadInventorySha256':inventory_sha,'payloadFiles':len(rows),'payload':rows})
    equivalence=SETTINGS.get('priorPlatformEquivalence') if OP!='idle' else None
    if equivalence is not None and (len(rows)!=equivalence['payloadFiles']
        or inventory_sha!=equivalence['payloadInventorySha256']):
        raise RuntimeError('reviewed_equivalence_payload_changed')

def prepare():
    if OP not in ['observe','idle','controls'] or ROOT.exists(): raise RuntimeError('fresh_observation_root_required')
    global SETTINGS, ACQUISITION_DEADLINE, PREPARE_BOOTSTRAPPED
    # Exact settings and both prior human reviews are checked before any asset request.
    settings_path=Path(os.environ.get('OBS_SETTINGS_FILE',''))
    expected=os.environ.get('OBS_SETTINGS_SHA','')
    if not settings_path.is_file() or not re.fullmatch(r'[a-f0-9]{64}',expected):
        raise RuntimeError('reviewed_settings_file_and_hash_required')
    validation=subprocess.run(['node',str(Path(__file__).with_name('reviewed-settings.mjs')),'validate',str(settings_path),expected,SHA],
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
    if validation.returncode or len(validation.stdout)>65536:
        raise RuntimeError('reviewed_settings_or_prior_platform_gates_not_satisfied')
    SETTINGS=json.loads(validation.stdout)
    ACQUISITION_DEADLINE=time.monotonic()+SETTINGS['bounds']['acquisitionTimeoutSeconds']
    ROOT.mkdir(parents=True,mode=0o700)
    for sub in ['assets','tools','state','host/config','host/data','host/cache','host/state','evidence/raw','out','disabled-hooks']:
        (ROOT/sub).mkdir(parents=True,exist_ok=True,mode=0o700)
    environment()
    (ROOT/'reviewed-settings.json').write_bytes(settings_path.read_bytes())
    (ROOT/'reviewed-settings.json').chmod(0o600)
    if digest(ROOT/'reviewed-settings.json')!=expected: raise RuntimeError('reviewed_settings_changed_during_preparation')
    bootstrap_env={k:v for k,v in os.environ.items() if not re.search('TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|CREDENTIAL',k,re.I)
                   and k.upper() not in ['NODE_OPTIONS','NODE_PATH']}
    bootstrap_env['KOTO_STATE_DIR']=str(ROOT/'state')
    # Python mode=0700 does not establish a Windows DACL. Protect only this
    # fresh disposable tree before creating source/helper/native workspaces.
    # Product ancestor/DACL checks remain unchanged and authoritative.
    owned_preparation([],ROOT,'private-root',15,bootstrap_env,mode='private-root')
    save(ROOT/'evidence'/'operator-prior-platform-reviews.json',SETTINGS['gates'])
    disk_free=shutil.disk_usage(ROOT).free
    if disk_free < SETTINGS['bounds']['freeDiskBeforeAssetsBytes']: raise RuntimeError('reviewed_disk_reserve_required')
    admission=json.loads(command(['node','--input-type=module','-e',
        "import {freemem,totalmem,availableParallelism} from 'node:os'; import {readFileSync} from 'node:fs'; "
        "const rawFreeBytes=freemem(); let availableBytes=rawFreeBytes,source='os-freemem'; "
        "if(process.platform==='linux'){const m=/^MemAvailable:\\s+(\\d+)\\s+kB$/m.exec(readFileSync('/proc/meminfo','utf8')); if(!m)throw Error('memory_admission_unavailable');availableBytes=Number(m[1])*1024;source='linux-MemAvailable';} "
        "console.log(JSON.stringify({totalBytes:totalmem(),rawFreeBytes,availableBytes,source,cpus:availableParallelism()}));"],ROOT,'host-admission'))
    admission['freeDiskBytes']=disk_free
    save(ROOT/'evidence'/'host-admission.json',admission)
    if admission['availableBytes'] < SETTINGS['bounds']['minimumAvailableBytes'] or admission['cpus'] < SETTINGS['bounds']['minimumCpus']: raise RuntimeError('four_b_host_admission_failed')
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
    for relative,key in [('src/local-models.js','localModelsSha256'),('src/core.d.ts','coreTypesSha256')]:
        if digest(source/relative)!=SETTINGS['candidateApi'][key]: raise RuntimeError('reviewed_candidate_api_changed')
    owned_preparation([],source,'helper-bootstrap',120,bootstrap_env,mode='bootstrap')
    PREPARE_BOOTSTRAPPED=True
    command(['npm','run','check'],source,'source-check')
    pack = json.loads(command(['npm','pack','--ignore-scripts','--offline','--json','--pack-destination',str(ROOT/'assets')],source,'npm-pack'))
    if len(pack) != 1: raise RuntimeError('single_package_required')
    (ROOT/'assets'/pack[0]['filename']).rename(ROOT/'assets'/'koto.tgz')
    install_package()
    # The requested source and the installed package must agree, not just the tar.
    for item in json.loads((ROOT/'evidence'/'package.json').read_text())['payload']:
        if digest(source/item['path']) != item['sha256']: raise RuntimeError('source_package_mismatch')
    catalog_path=ROOT/'install'/'node_modules'/'@mehrdadxzaker'/'koto'/'src'/'model-catalog.js'
    model_entry=json.loads(command(['node','--input-type=module','-e',
        "const {LOCAL_MODEL_CATALOG}=await import(process.argv[1]); console.log(JSON.stringify(LOCAL_MODEL_CATALOG.find(x=>x.id==='qwen-compact')));",
        catalog_path.as_uri()],ROOT,'catalog-model'))
    if (model_entry.get('url'),model_entry.get('bytes'),model_entry.get('sha256'))!=ASSETS['model']:
        raise RuntimeError('candidate_catalog_pin_changed')
    save(ROOT/'evidence'/'catalog-model.json',model_entry)
    installed=ROOT/'install'/'node_modules'/'@mehrdadxzaker'/'koto'
    for relative,key in [('src/local-models.js','localModelsSha256'),('src/core.d.ts','coreTypesSha256')]:
        if digest(installed/relative)!=SETTINGS['candidateApi'][key]: raise RuntimeError('reviewed_candidate_api_changed')
    model=None; llama=None
    if OP=='observe':
        model=download('model')
        extract_asset(download('llama'),ROOT/'tools'/'llama')
    extract_asset(download('opencode'),ROOT/'tools'/'opencode')
    if OP=='observe': llama=find_executable(ROOT/'tools'/'llama','llama-server.exe' if WINDOWS else 'llama-server')
    opencode=find_executable(ROOT/'tools'/'opencode','opencode.exe' if WINDOWS else 'opencode')
    config={'$schema':'https://opencode.ai/config.json','autoupdate':False,'share':'disabled',
         'plugin':[],'mcp':{},'lsp':False,'formatter':False,'compaction':{'auto':False},
         'agent':{'build':{'steps':SETTINGS['native']['steps']},'title':{'disable':True}},
         'permission':{'*':'deny','read':'allow','list':'allow','glob':'allow','grep':'allow',
             'edit':{'*':'deny','docs/WINDOWS_TERMINAL_OPERATOR_NOTE.md':'allow','*/docs/WINDOWS_TERMINAL_OPERATOR_NOTE.md':'allow'},'bash':'deny','question':'allow'},
         'enabled_providers':['local'],'model':'local/koto-qwen3-4b','small_model':'local/koto-qwen3-4b',
         'provider':{'local':{'npm':'@ai-sdk/openai-compatible','name':'Owned loopback model',
             'options':{'baseURL':'http://127.0.0.1:18089/v1',**SETTINGS['native']['providerOptions']},
             'models':{'koto-qwen3-4b':{'name':'Qwen3 4B pinned GGUF','tool_call':True,'limit':{'context':SETTINGS['runtime']['contextSize'],'output':SETTINGS['native']['outputTokens']},'options':SETTINGS['native']['modelOptions']}}}}}
    save(ROOT/'host'/'opencode.json',config)
    opencode_version=command([opencode,'--version'],ROOT,'opencode-version',timeout=15).strip()
    if opencode_version!='1.19.4': raise RuntimeError('opencode_version_mismatch')
    effective_text=command([opencode,'debug','config'],ROOT,'opencode-effective-config',timeout=30)
    effective=json.loads(effective_text)
    for key in ['autoupdate','share','plugin','mcp','lsp','formatter','compaction','enabled_providers','model','small_model','permission']:
        if effective.get(key)!=config[key]: raise RuntimeError('native_effective_config_changed')
    if effective.get('provider',{}).get('local',{}).get('options')!=config['provider']['local']['options']:
        raise RuntimeError('native_effective_endpoint_changed')
    if effective.get('agent',{}).get('title',{}).get('disable') is not True or effective.get('agent',{}).get('build',{}).get('steps')!=SETTINGS['native']['steps']:
        raise RuntimeError('native_effective_agent_changed')
    if effective.get('provider',{}).get('local',{}).get('models')!=config['provider']['local']['models']:
        raise RuntimeError('native_effective_model_settings_changed')
    save(ROOT/'evidence'/'native-config.json',{'requestedSha256':digest(ROOT/'host'/'opencode.json'),
         'effectiveSha256':hashlib.sha256(effective_text.encode()).hexdigest(),'checkedBeforeModelStart':True})
    if OP=='observe': command([llama,'--version'],ROOT,'llama-version',timeout=15)
    save(ROOT/'evidence'/'host.json',{'system':platform.platform(),'architecture':platform.machine(),
         'node':command(['node','--version'],ROOT,'node-version').strip(),'opencode':opencode_version,
         'runnerImage':os.environ.get('ImageVersion'),'runnerImageOS':os.environ.get('ImageOS')})
    save(ROOT/'prepared.json', {'schemaVersion':1,'variant':'idle-opencode' if OP in ['idle','controls'] else VARIANT,'candidate':SHA,'root':str(ROOT),'platform':platform.system(),
         'llama':llama,'opencode':opencode,'model':str(model) if model else None,'assets':{'opencode':ASSETS['opencode']} if OP in ['idle','controls'] else ASSETS,'reviewedSettingsSha256':expected,'candidateApi':SETTINGS['candidateApi']})
    if OP=='idle':
        save(ROOT/'idle-bindings.json',{'schemaVersion':1,'kind':'koto-windows-idle-bindings','approvedForExecution':True,
             'candidate':SHA,'opencodeSha256':digest(Path(opencode)),'nativeConfigSha256':digest(ROOT/'host'/'opencode.json'),
             'opencodeArchiveSha256':ASSETS['opencode'][2]})

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
    if meta.get('name')!=f'native-4b-{ID}-{os.environ["OBS_RUNNER"]}': raise RuntimeError('source_artifact_name_changed')

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
        for relative in ['evidence','host','control','control-worktrees','project','state','reviewed-settings.json','npm-cache/_logs']:
            p=ROOT/relative
            if p.exists(): raw.add(p,arcname=relative,recursive=True)
    public={'schemaVersion':1,'variant':VARIANT,'candidate':SHA,'root':str(ROOT),'operation':OP,'runner':os.environ['OBS_RUNNER'],
            'observationId':ID,'runId':os.environ.get('GITHUB_RUN_ID'),'driverRevision':os.environ.get('GITHUB_SHA'),
            'reviewedSettingsSha256':os.environ.get('OBS_SETTINGS_SHA')}
    if OP in ['idle','controls']:
        public['rehydration']='unavailable_idle_diagnosis' if OP=='idle' else 'unavailable_cli_controls_only'
        public['interpretation']='No model, task, contribution or integration; encrypted native controls require manual review.'
        save(ROOT/'out'/'receipt.json',public); return
    observation=ROOT/'evidence'/'observation.json'
    if not observation.exists():
        public['rehydration']='unavailable_no_observation'
        save(ROOT/'out'/'receipt.json',public); return
    data=json.loads(observation.read_text())
    session=Path(data['sessionRoot']) if data.get('sessionRoot') else None
    try:
        if (ROOT/'evidence'/'preparation-halt.json').exists(): raise RuntimeError('preparation_halted_requires_review')
        if not session or not session.is_relative_to(ROOT/'control'): raise RuntimeError('session_path_changed')
        state=json.loads((session/'project-session.json').read_text())
        if state.get('active') or any(a['status'] in ['pending','running'] for a in state['agents']): raise RuntimeError('session_not_settled')
        if any(not a.get('commandOutcome') for a in state['agents']): raise RuntimeError('command_cleanup_evidence_missing')
        if any('cleanup_unconfirmed' in json.dumps(a) for a in state['agents']): raise RuntimeError('cleanup_not_confirmed')
        runtime=json.loads((ROOT/'evidence'/'runtime-completion.json').read_text())
        if runtime.get('error') in ['cleanup_unconfirmed','local_memory_cleanup_unconfirmed']: raise RuntimeError('runtime_cleanup_not_confirmed')
        if runtime.get('error') or runtime.get('status') not in ['cancelled','succeeded']: raise RuntimeError('runtime_failed_'+str(runtime.get('error') or runtime.get('status')))
        if data.get('failure'): raise RuntimeError('observation_failed_'+str(data['failure']))
        if any(session.glob('*.lock')) or (session/'contribution-attempt.json').exists(): raise RuntimeError('retained_lock_or_attempt')
        if OP=='observe' and any(v.get('outsideOwnership') for v in data.get('inspections',{}).values()): raise RuntimeError('outside_ownership')
        if data.get('projectAfter')!=data.get('projectBefore') or data.get('projectBefore')!={'head':SHA,'status':''}:
            raise RuntimeError('original_project_changed')
        # Ignored native history is not a contribution and must not leak into
        # the public bundle merely because it was created inside a worktree.
        source_files=set(command(['git','ls-tree','-r','--name-only','-z',SHA],ROOT/'project','source-public-inventory').split('\0'))
        # This explicitly assigned public documentation note is the only new
        # path allowed. Bind it to the actual inspected contribution; never
        # include arbitrary untracked files or ignored native history.
        note='docs/WINDOWS_TERMINAL_OPERATOR_NOTE.md'
        contributor=ROOT/'control-worktrees'/session.name/'agent-contributor'
        integration_workspace=ROOT/'control-worktrees'/session.name/'integration'
        allowed_new_files=set()
        note_file=contributor/note
        if note_file.exists():
            review=data.get('inspections',{}).get('contributor',{})
            if (note in source_files or Path(review.get('path',''))!=contributor
                or review.get('owns')!=[note] or review.get('integrationChangedPaths')!=[note]
                or review.get('outsideOwnership')!=[] or review.get('conflicts')!=[]
                or not re.fullmatch(r'[a-f0-9]{64}',review.get('reviewToken',''))
                or note_file.is_symlink() or not note_file.is_file()
                or not 0<note_file.stat().st_size<=16384):
                raise RuntimeError('new_operator_note_requires_exact_owned_review')
            note_bytes=note_file.read_bytes()
            if b'\0' in note_bytes: raise RuntimeError('new_operator_note_not_text')
            note_bytes.decode('utf-8')
            allowed_new_files.add(note_file)
            if OP=='integrate':
                integrated=json.loads((ROOT/'evidence'/'integration.json').read_text())
                target=integration_workspace/note
                if (integrated.get('error') or integrated.get('result',{}).get('status')!='integrated'
                    or integrated.get('approvedReviewToken')!=review['reviewToken']
                    or integrated.get('after',{}).get('integrationChangedPaths')!=[]
                    or integrated.get('projectBefore')!={'head':SHA,'status':''}
                    or integrated.get('projectAfter')!=integrated.get('projectBefore')
                    or target.is_symlink() or not target.is_file()
                    or target.stat().st_size!=len(note_bytes) or target.read_bytes()!=note_bytes):
                    raise RuntimeError('integrated_operator_note_changed_or_unconfirmed')
                allowed_new_files.add(target)
        worktree_roots=[ROOT/'project']+[p for p in (ROOT/'control-worktrees').glob('*/*') if p.is_dir()]
        for workspace in worktree_roots:
            for p in safe_files(workspace):
                relative=p.relative_to(workspace).as_posix()
                if relative=='.git' or relative.startswith('.git/'): continue
                if relative not in source_files and p not in allowed_new_files:
                    raise RuntimeError('untracked_or_ignored_file_requires_private_review')
        includes=[ROOT/'project',ROOT/'control-worktrees',ROOT/'state'/'native',ROOT/'disabled-hooks',ROOT/'assets'/'koto.tgz',ROOT/'prepared.json',ROOT/'reviewed-settings.json']
        # Only minimal control JSON and empty disabled-hooks; raw events stay encrypted.
        control_files=[p for p in safe_files(ROOT/'control') if p.name!='events.jsonl']
        allowed_control={'project-session.json','workspaces.json','workspace-manifest.json','manifest.json'}
        if any(p.name not in allowed_control and not (OP=='integrate' and re.fullmatch(r'contribution-attempt-[a-f0-9-]{36}\.json',p.name)) for p in control_files):
            raise RuntimeError('unexpected_control_file_requires_review')
        files=[p for base in includes for p in safe_files(base)]+control_files
        files += [p for p in (ROOT/'evidence').glob('*.json') if p.name!='integration.json' or OP=='integrate']
        unique={p.relative_to(ROOT).as_posix():p for p in files}
        if sum(p.stat().st_size for p in unique.values())>1024**3: raise RuntimeError('rehydration_size_bound')
        if any(p.name.endswith('.lock') for p in unique.values()): raise RuntimeError('retained_git_or_helper_lock')
        # Refuse unreviewed/unsupported external Git object stores and executable hooks.
        if any(name.endswith('/objects/info/alternates') for name in unique): raise RuntimeError('external_git_objects')
        manifest={'schemaVersion':1,'variant':VARIANT,'candidate':SHA,'root':str(ROOT),'platform':platform.system(),'files':[],'directories':[]}
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
    global SETTINGS
    if OP!='integrate' or ROOT.exists(): raise RuntimeError('fresh_restore_root_required')
    bundle=Path(os.environ['OBS_DOWNLOAD_DIRECTORY'])/'rehydration.zip'
    if not re.fullmatch(r'[a-f0-9]{64}',os.environ.get('OBS_BUNDLE_SHA','')) or digest(bundle)!=os.environ['OBS_BUNDLE_SHA']:
        raise RuntimeError('reviewed_bundle_digest_changed')
    with zipfile.ZipFile(bundle) as z:
        if len(z.infolist())>50001 or z.getinfo('REHYDRATION-MANIFEST.json').file_size>16*1024**2:
            raise RuntimeError('rehydration_manifest_bound')
        manifest=json.loads(z.read('REHYDRATION-MANIFEST.json'))
        if manifest.get('variant')!=VARIANT or manifest.get('candidate')!=SHA or manifest.get('root')!=str(ROOT) or manifest.get('platform')!=platform.system():
            raise RuntimeError('rehydration_host_or_path_changed')
        rows=manifest['files']; names=[r['path'] for r in rows]
        if len(rows)>50000 or len(manifest['directories'])>50000: raise RuntimeError('rehydration_entry_bound')
        archive_inventory(names,manifest['directories'])
        for row in rows:
            info=z.getinfo(row['path'])
            if type(row['bytes']) is not int or not 0<=row['bytes']<=512*1024**2 or info.file_size!=row['bytes'] \
               or stat.S_ISLNK(info.external_attr>>16) or info.is_dir() or type(row['mode']) is not int or not 0<=row['mode']<=0o777 \
               or not re.fullmatch(r'[a-f0-9]{64}',row['sha256']): raise RuntimeError('rehydration_entry_invalid')
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
    if digest(ROOT/'reviewed-settings.json')!=os.environ.get('OBS_SETTINGS_SHA'): raise RuntimeError('restored_settings_changed')
    validation=subprocess.run(['node',str(Path(__file__).with_name('reviewed-settings.mjs')),'validate',
        str(ROOT/'reviewed-settings.json'),os.environ['OBS_SETTINGS_SHA'],SHA],
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
    if validation.returncode or len(validation.stdout)>65536:
        raise RuntimeError('restored_settings_or_prior_platform_gates_not_satisfied')
    SETTINGS=json.loads(validation.stdout)
    restored_env={k:v for k,v in os.environ.items() if not re.search('TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|CREDENTIAL',k,re.I)
                  and k.upper() not in ['NODE_OPTIONS','NODE_PATH']}
    restored_env['KOTO_STATE_DIR']=str(ROOT/'state')
    owned_preparation([],ROOT,'restored-private-root',15,restored_env,mode='private-root')
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
