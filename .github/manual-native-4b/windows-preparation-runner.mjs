// Own Windows preparation workloads through the exact candidate's Job Object.
// Bootstrap uses that candidate's existing bounded helper-build implementation.
import { readFileSync, writeFileSync, realpathSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSettings } from './reviewed-settings.mjs';

const fail = code => { throw new Error(code); };
const same = (a,b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
if (process.platform !== 'win32' || process.arch !== 'x64' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.OBS_EXECUTION !== 'windows-actions') fail('explicit_windows_preparation_required');
const requestFile = process.argv[2];
if (!requestFile || statSync(requestFile).size > 65536) fail('preparation_request_bound');
const request = JSON.parse(readFileSync(requestFile, 'utf8'));
const root = path.join(homedir(), '.koto-native-observations-4b', process.env.OBS_ID ?? '');
if (!/^[a-z][a-z0-9-]{7,47}$/.test(process.env.OBS_ID ?? '') || !same(request.root,root)
  || !same(realpathSync(root),root) || !/^[a-f0-9]{40}$/.test(request.candidate ?? '')
  || request.candidate !== process.env.OBS_CANDIDATE || !/^[a-z][a-z0-9-]{0,63}$/.test(request.label ?? '')
  || !['bootstrap','run'].includes(request.mode)) fail('preparation_identity_changed');
const source = path.join(root,'project');
const settings = loadSettings(path.join(root,'reviewed-settings.json'),process.env.OBS_SETTINGS_SHA,{candidate:request.candidate});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [relative,key] of [['src/local-models.js','localModelsSha256'],['src/core.d.ts','coreTypesSha256']]) {
  if (hash(readFileSync(path.join(source,relative))) !== settings.candidateApi[key]) fail('preparation_candidate_api_changed');
}
if (!path.isAbsolute(request.git ?? '') || /\.(?:cmd|bat)$/i.test(request.git)) fail('preparation_git_executable_required');
// One bounded read-only Git invocation before importing the selected source.
const head = execFileSync(request.git,['-C',source,'rev-parse','HEAD'], {
  encoding:'utf8',timeout:5000,maxBuffer:4096,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},windowsHide:true,
}).trim();
if (head !== request.candidate) fail('preparation_candidate_head_changed');
process.env.KOTO_STATE_DIR = path.join(root,'state');
delete process.env.NODE_OPTIONS; delete process.env.NODE_PATH;
const { buildTerminalHelper, resolveTerminalHelper } = await import(pathToFileURL(path.join(source,'src/terminal-helper.js')));
const raw = path.join(root,'evidence','raw');
const outputPaths = { stdout:path.join(raw,`${request.label}.stdout`), stderr:path.join(raw,`${request.label}.stderr`) };
const receiptPath = path.join(raw,`${request.label}.owned.json`);
const controller = new AbortController();
const interrupt = () => { remember('preparation_interrupted'); controller.abort(); };
process.once('SIGINT',interrupt); process.once('SIGTERM',interrupt);
let handle, outcome, errorCode, helper, bytes = 0, timer;
const stdout=[],stderr=[],events=[];
const remember = (error,fallback='preparation_failed') => {
  const candidate=typeof error==='string'?error:error?.code;
  const code=typeof candidate==='string'&&/^[a-z][a-z0-9_]+$/.test(candidate)?candidate:fallback;
  const priority=v=>v?.endsWith('cleanup_unconfirmed')?3:/(?:socket|resource)_exhausted$/.test(v??'')?2:v?1:0;
  if(priority(code)>priority(errorCode))errorCode=code;
};
try {
  if (request.mode==='bootstrap') {
    // No npm/client workload exists before the product has built its helper.
    // The product compiler/developer-tool calls have their own output/time bounds
    // and retain uncertain cleanup. Do not kill their owning JS supervisor.
    helper=await buildTerminalHelper({directory:path.join(root,'state','native')});
    if(controller.signal.aborted)remember('preparation_interrupted');
  } else {
    if (!Number.isSafeInteger(request.timeoutMs)||request.timeoutMs<1||request.timeoutMs>120000
      || !Array.isArray(request.args)||request.args.length<1||request.args.length>128
      || request.args.some(a=>typeof a!=='string'||a.includes('\0')||Buffer.byteLength(a)>16384)
      || !path.isAbsolute(request.cwd??'') || !same(request.cwd,root)&&!same(request.cwd,source)) fail('preparation_command_invalid');
    helper=await resolveTerminalHelper({directory:path.join(root,'state','native')});
    let [command,...args]=request.args;
    if(command==='npm') {
      const npmCli=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
      if(!existsSync(npmCli)||!statSync(npmCli).isFile())fail('bundled_npm_cli_required');
      command=process.execPath; args=[npmCli,...args];
    } else if(command==='node') command=process.execPath;
    else if(command==='git') command=request.git;
    if(!path.isAbsolute(command)||/\.(?:cmd|bat)$/i.test(command))fail('preparation_native_executable_required');
    const { startSetupCommand }=await import(pathToFileURL(path.join(source,'src/setup-command.js')));
    timer=setTimeout(()=>{remember('preparation_timeout');controller.abort();},request.timeoutMs);
    handle=await startSetupCommand({id:'preparation',command,args,cwd:request.cwd,
      env:{...process.env},timeoutMs:request.timeoutMs,signal:controller.signal,onEvent(event){
        if(event.type==='output') {
          const chunk=Buffer.from(event.text??'');bytes+=chunk.length;
          if(bytes>8*1024**2){remember('preparation_output_bound');controller.abort();return;}
          (event.stream==='stderr'?stderr:stdout).push(chunk);
        } else if(events.length<128) events.push(event);
      }});
    handle.endInput();
    outcome=await handle.completion;
    if(outcome.error||outcome.status!=='succeeded')remember(outcome.error??'preparation_command_failed');
  }
} catch(error) {
  remember(error,/^[a-z][a-z0-9_]+$/.test(error?.message??'')?error.message:'preparation_failed');
} finally {
  try {
    if(handle) {
      try { handle.stop(); } catch(error) { remember(error,'preparation_stop_failed'); }
      try {
        outcome=await handle.completion;
        if(outcome.error||outcome.status!=='succeeded')remember(outcome.error??'preparation_command_failed');
      } catch(error) { remember(error,'preparation_completion_failed'); }
    }
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
  }
}
// Filesystem failure is reported only after owned cleanup has been awaited.
try {
  writeFileSync(outputPaths.stdout,Buffer.concat(stdout),{flag:'wx',mode:0o600});
  writeFileSync(outputPaths.stderr,Buffer.concat(stderr),{flag:'wx',mode:0o600});
  writeFileSync(receiptPath,`${JSON.stringify({schemaVersion:1,candidate:request.candidate,
    mode:request.mode,label:request.label,helper,outcome,error:errorCode??null,outputBytes:bytes,events},null,2)}\n`,{flag:'wx',mode:0o600});
} catch(error) { remember(error,'preparation_evidence_write_failed'); }
process.stdout.write(`${JSON.stringify({status:errorCode?'failed':'complete',error:errorCode??null,receiptPath,outputPaths})}\n`);
if(errorCode)process.exitCode=1;
