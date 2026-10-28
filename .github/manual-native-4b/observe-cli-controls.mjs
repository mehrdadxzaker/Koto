// Draft only: an explicit false approval in bindings prevents every workload.
// This invokes the installed CLI; it never starts a model or submits a task.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, lstatSync, realpathSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a,b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const under = (base,file) => { const r=path.relative(base,file); return r!==''&&!r.startsWith('..')&&!path.isAbsolute(r); };
function bytes(file,max=8*1024**2) {
  const st=lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>max||!same(realpathSync(file),file))fail('input_file_unsafe');
  return readFileSync(file);
}
const json = (file,max) => JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes(file,max)));
const [bindingFile,driverDirectory] = process.argv.slice(2);
if(!bindingFile||!driverDirectory)fail('explicit_bindings_and_driver_required');
const bindingBytes=bytes(bindingFile,65536), binding=JSON.parse(bindingBytes);
const standalone=process.env.OBS_OPERATION==='controls';
if(binding.approvedForExecution!==true)fail('cli_control_draft_not_approved');
if(process.platform!=='win32'||process.arch!=='x64'||process.env.GITHUB_ACTIONS!=='true'
  ||process.env.OBS_EXECUTION!=='windows-actions'||!['observe','controls'].includes(process.env.OBS_OPERATION)
  ||!/^[a-z][a-z0-9-]{7,47}$/.test(process.env.OBS_ID??'')
  ||binding.candidate!==process.env.OBS_CANDIDATE||binding.candidate!=='caa5ca62142a1c0f9de7921f8ee10aa6f6155814')fail('explicit_windows_cli_control_required');
const mainRoot=path.join(homedir(),'.koto-native-observations-4b',process.env.OBS_ID);
// Existing sealing encrypts evidence recursively, while public rehydration
// admits only evidence/*.json. Keep every complement file below this raw root.
const root=path.join(mainRoot,'evidence','raw','windows-cli-control');
if(!same(mainRoot,process.env.OBS_ROOT??'')||!same(realpathSync(mainRoot),mainRoot)||existsSync(root))fail('separate_fresh_cli_root_required');
const installed=path.join(mainRoot,'install','node_modules','@mehrdadxzaker','koto');
const prepared=json(path.join(mainRoot,'prepared.json'),65536);
let observationBytes,observation,runtimeBytes;
if(prepared.candidate!==binding.candidate||prepared.reviewedSettingsSha256!==process.env.OBS_SETTINGS_SHA)
  fail('prepared_candidate_or_settings_changed');
if(standalone) {
  if(prepared.variant!=='idle-opencode'||prepared.llama!==null||prepared.model!==null
    ||Object.keys(prepared.assets??{}).join(',')!=='opencode')fail('standalone_idle_preparation_required');
} else {
  observationBytes=bytes(path.join(mainRoot,'evidence','observation.json'));
  observation=JSON.parse(observationBytes);
  runtimeBytes=bytes(path.join(mainRoot,'evidence','runtime-completion.json'),65536);
  const runtime=JSON.parse(runtimeBytes);
  if(prepared.variant!=='qwen3-4b'||observation.candidate!==binding.candidate||observation.failure!==null
    ||runtime.error||!['cancelled','succeeded'].includes(runtime.status)
    ||!under(path.join(mainRoot,'control'),observation.sessionRoot??''))fail('prior_api_cleanup_not_qualified');
}
for(const [relative,expected] of Object.entries(binding.sourceFileSha256??{})) {
  if(!/^[a-f0-9]{64}$/.test(expected)||relative.includes('..')||path.isAbsolute(relative)
    ||hash(bytes(path.join(installed,relative)))!==expected)fail('installed_cli_source_changed');
}
if(Object.keys(binding.sourceFileSha256??{}).length!==8)fail('cli_source_binding_required');
const packageEvidence=json(path.join(mainRoot,'evidence','package.json'));
for(const item of packageEvidence.payload??[]) {
  if(!under(installed,path.join(installed,item.path))||hash(bytes(path.join(installed,item.path)))!==item.sha256)fail('installed_package_changed');
}
if(packageEvidence.payload?.length!==53||new Set(packageEvidence.payload.map(item=>item.path)).size!==53
  ||packageEvidence.candidate!==binding.candidate)fail('package_evidence_missing');
const settingsModule=path.join(driverDirectory,'reviewed-settings.mjs');
if(hash(bytes(settingsModule))!=='0accb7aa7d0cc515dd6483ec11d40cf780ab6a16744d9cfac448d88bb71cfc6a')fail('reviewed_validator_changed');
const {loadSettings}=await import(pathToFileURL(settingsModule));
loadSettings(path.join(mainRoot,'reviewed-settings.json'),process.env.OBS_SETTINGS_SHA,{candidate:binding.candidate});

// Preserve HOME/USERPROFILE. Fresh invocation-only XDG paths contain no auth.
for(const key of Object.keys(process.env))if(/TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|CREDENTIAL/i.test(key))delete process.env[key];
for(const key of Object.keys(process.env))if(/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/.test(key))delete process.env[key];
delete process.env.NODE_OPTIONS;delete process.env.NODE_PATH;
delete process.env.OPENCODE_CONFIG_DIR;delete process.env.OPENCODE_CONFIG_CONTENT;
process.env.KOTO_STATE_DIR=path.join(mainRoot,'state'); // Reuse only the verified helper; never build.
const api=await import(pathToFileURL(path.join(installed,'src/index.js')));
const {startSetupCommand}=await import(pathToFileURL(path.join(installed,'src/setup-command.js')));
const {startTerminalCommand}=await import(pathToFileURL(path.join(installed,'src/terminal-session.js')));
if(!standalone) {
  const prior=api.readProjectSession(observation.sessionRoot);
  if(prior.active||prior.agents.length!==2||prior.agents.some(a=>['pending','running'].includes(a.status)||!a.commandOutcome
    ||a.commandOutcome.error||!['cancelled','succeeded'].includes(a.commandOutcome.status)))fail('prior_agents_not_cleaned');
  if(readdirSync(observation.sessionRoot).some(n=>n.endsWith('.lock')||n==='contribution-attempt.json'))fail('prior_controls_unsettled');
}
const helperDirectory=path.join(mainRoot,'state','native');
const helperPath=await api.resolveTerminalHelper({directory:helperDirectory});
const configBytes=bytes(path.join(mainRoot,'host','opencode.json'),65536);
const config=json(path.join(mainRoot,'host','opencode.json'),65536);
const configEvidence=json(path.join(mainRoot,'evidence','native-config.json'),65536);
if(hash(configBytes)!==configEvidence.requestedSha256||config.provider?.local?.options?.baseURL!=='http://127.0.0.1:18089/v1'
  ||config.agent?.title?.disable!==true||config.compaction?.auto!==false)fail('reviewed_native_config_changed');
if(!under(path.join(mainRoot,'tools','opencode'),prepared.opencode)||!lstatSync(prepared.opencode).isFile())fail('prepared_native_executable_changed');
mkdirSync(root,{recursive:false,mode:0o700});
for(const d of ['evidence','host/config','host/data','host/cache','host/state','state','disabled-hooks','npm-cache'])mkdirSync(path.join(root,d),{recursive:true,mode:0o700});
writeFileSync(path.join(root,'bindings.json'),bindingBytes,{flag:'wx',mode:0o600});
writeFileSync(path.join(root,'host','opencode.json'),configBytes,{flag:'wx',mode:0o600});
const env={...process.env,KOTO_STATE_DIR:path.join(root,'state'),TERM:'xterm-256color',
  XDG_CONFIG_HOME:path.join(root,'host','config'),XDG_DATA_HOME:path.join(root,'host','data'),
  XDG_CACHE_HOME:path.join(root,'host','cache'),XDG_STATE_HOME:path.join(root,'host','state'),
  OPENCODE_CONFIG:path.join(root,'host','opencode.json'),OPENCODE_DISABLE_PROJECT_CONFIG:'true',
  OPENCODE_DISABLE_AUTOUPDATE:'true',OPENCODE_DISABLE_MODELS_FETCH:'true',OPENCODE_PURE:'1',
  OPENCODE_DISABLE_DEFAULT_PLUGINS:'true',OPENCODE_DISABLE_LSP_DOWNLOAD:'true',OPENCODE_DISABLE_FFF:'1',
  OPENCODE_DISABLE_CLAUDE_CODE:'true',OPENCODE_DISABLE_EXTERNAL_SKILLS:'true',OPENCODE_EXPERIMENTAL:'false',
  OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS:'false',OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER:'true',
  npm_config_offline:'true',npm_config_cache:path.join(root,'npm-cache'),npm_config_audit:'false',
  npm_config_fund:'false',npm_config_update_notifier:'false',GIT_OPTIONAL_LOCKS:'0',
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL',GIT_TERMINAL_PROMPT:'0'};
const controller=new AbortController();let handle,outcome,errorCode,outerCleanup,setupHandle,setupOutcome;
let outputBytes=0,screen='',ended=false,deadline,sessionRoot,firstError,deadlineExpired=false;
const events=[],actions=[],setup=[],errors=[],cleanupErrors=[];
function remember(error,fallback='cli_control_incomplete') {
  const code=typeof error==='string'?error:error?.code;
  const value=['EMFILE','ENFILE','EADDRNOTAVAIL','ENOBUFS'].includes(code)?'cli_control_resource_exhausted'
    :typeof code==='string'&&/^[a-z][a-z0-9_]+$/.test(code)?code:fallback;
  firstError??=value;
  const record={at:new Date().toISOString(),code:value};
  if(errors.length<64)errors.push(record);
  if(value.endsWith('cleanup_unconfirmed')&&cleanupErrors.length<32)cleanupErrors.push(record);
  const p=v=>v?.endsWith('cleanup_unconfirmed')?3:/(?:socket|resource)_exhausted$/.test(v??'')?2:v?1:0;
  if(p(value)>p(errorCode))errorCode=value;
}
function stop(){controller.abort();try{handle?.stop();}catch(e){remember(e);}try{setupHandle?.stop();}catch(e){remember(e);}}
const interrupt=()=>{remember('cli_control_interrupted');stop();};
process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
function capture(event,label) {
  try {
    const line=JSON.stringify({at:new Date().toISOString(),label,event})+'\n';
    const terminalText=label==='outer'&&event.type==='output'?(event.text??''):'';
    outputBytes+=Buffer.byteLength(line)+Buffer.byteLength(terminalText);
    if(outputBytes>16*1024**2)fail('cli_control_evidence_bound');
    appendFileSync(path.join(root,'evidence','events.jsonl'),line,{mode:0o600});
    if(label==='outer'&&event.type==='output') {
      screen=(screen+terminalText).slice(-65536);
      appendFileSync(path.join(root,'evidence','outer.vt'),terminalText,{mode:0o600});
    }
    if(label==='outer'&&event.type==='terminal_cleanup')outerCleanup=event;
    if(event.type!=='output'&&events.length<256)events.push({label,...event});
  } catch(e){remember(e,'cli_control_evidence_write_failed');stop();}
}
async function owned(command,args,cwd,label,timeoutMs=15000) {
  controller.signal.throwIfAborted();let stdout='';
  try {
    setupHandle=await startSetupCommand({id:'cliSetup',command,args,cwd,env,timeoutMs,signal:controller.signal,onEvent(event){capture(event,label);if(event.type==='output'&&event.stream==='stdout')stdout+=event.text??'';}});
    setupHandle.endInput();setupOutcome=await setupHandle.completion;
    setup.push({label,outcome:setupOutcome});
    if(setupOutcome.error||setupOutcome.status!=='succeeded')fail(setupOutcome.error??'cli_control_setup_failed');
    return stdout;
  } finally {
    if(setupHandle){
      try{setupHandle.stop();}catch(e){remember(e,'cli_control_setup_stop_failed');}
      try{setupOutcome=await setupHandle.completion;if(setupOutcome.error)remember(setupOutcome.error);}
      finally{setupHandle=undefined;}
    }
  }
}
async function endpointAbsent() {
  // One connect-only observation, no HTTP/model payload and no retry.
  let socket;
  try {await new Promise((resolve,reject)=>{
    socket=createConnection({host:'127.0.0.1',port:18089});socket.setTimeout(1000);
    socket.once('connect',()=>reject(Object.assign(new Error('owned_endpoint_still_present'),{code:'owned_endpoint_still_present'})));
    socket.once('timeout',()=>reject(Object.assign(new Error('endpoint_absence_unknown'),{code:'endpoint_absence_unknown'})));
    socket.once('error',e=>e.code==='ECONNREFUSED'?resolve():reject(e));
  });}finally{socket?.destroy();}
  actions.push({at:new Date().toISOString(),action:'endpoint_absent',endpoint:'127.0.0.1:18089',evidence:'ECONNREFUSED'});
}
function running(){controller.signal.throwIfAborted();if(deadlineExpired)fail('cli_control_observation_deadline');}
function visibleScreen(){return stripVTControlCharacters(screen);}
function markerPresent(marker){
  const visible=visibleScreen();
  // ConPTY represents trailing blanks with cursor movement/erase sequences.
  // This marker routes input only; raw output still requires semantic review.
  return marker==='Agents>'?/(?:^|[\r\n])Agents>[ \t]*(?:[\r\n]|$)/.test(visible):visible.includes(marker);
}
async function gate(marker,milliseconds,label){
  const end=Date.now()+milliseconds;
  while(!markerPresent(marker)&&Date.now()<end&&!controller.signal.aborted&&!deadlineExpired&&!ended)await delay(100);
  running();if(!markerPresent(marker))fail(label);
  actions.push({at:new Date().toISOString(),action:'routing_marker_observed',label,meaning:'Input routing only; not an acceptance pass.'});
}
function send(text,label){
  running();screen='';const accepted=handle.send(text);
  actions.push({at:new Date().toISOString(),action:label,accepted,inputSha256:hash(Buffer.from(text))});
  if(!accepted)fail('cli_control_input_rejected');
}
const pause=async ms=>{await delay(ms,undefined,{signal:controller.signal});running();};
function readInner(){
  const control=path.join(root,'control');
  if(!sessionRoot){
    if(!existsSync(control))return;
    const sessions=readdirSync(control).filter(n=>/^s-[A-Za-z0-9-]+$/.test(n));
    if(sessions.length>1)fail('cli_inner_session_missing_or_ambiguous');
    if(!sessions.length)return;
    sessionRoot=path.join(control,sessions[0]);
  }
  if(!existsSync(path.join(sessionRoot,'project-session.json')))return;
  return api.readProjectSession(sessionRoot);
}
async function waitInnerReady(milliseconds){
  const end=Date.now()+milliseconds;
  while(Date.now()<end&&!ended){
    running();const state=readInner();
    if(state?.agents.length===1&&state.agents[0].id==='idle'&&state.agents[0].status==='running'){
      const filename=path.join(sessionRoot,'events.jsonl');
      if(existsSync(filename)){
        const lines=bytes(filename,16*1024**2).toString('utf8').split('\n');lines.pop();
        let records;try{records=lines.filter(Boolean).map(line=>JSON.parse(line));}catch{fail('cli_inner_events_invalid');}
        const ready=records.find(e=>e.agentId==='idle'&&e.type==='pty_ready'&&e.transport==='pty');
        const native=records.filter(e=>e.agentId==='idle'&&e.type==='output').map(e=>e.text??'').join('').slice(-65536);
        if(ready&&stripVTControlCharacters(native).includes('Ask anything')){
          actions.push({at:new Date().toISOString(),action:'inner_native_ready',pid:ready.pid,
            terminalSessionId:ready.terminalSessionId,meaning:'Retained running state, PTY readiness and native idle UI; not useful-task acceptance.'});
          return;
        }
      }
    }
    await delay(100);
  }
  running();fail('cli_inner_native_readiness_missing');
}
function innerSettled(state){return state&&!state.active&&state.agents.length===1&&state.agents[0].id==='idle'
  &&!['pending','running'].includes(state.agents[0].status)&&state.agents[0].commandOutcome
  &&!state.agents[0].commandOutcome.error;}
async function gracefulCleanup(){
  // Ordinary routing failures first return to Koto, stop the inner workload and
  // let the real CLI persist its outcome. The outer Job remains the backstop.
  const cleanupSend=(text,action)=>{
    screen='';
    const accepted=handle.send(text);actions.push({at:new Date().toISOString(),action,accepted});return accepted;
  };
  if(!cleanupSend('\x1d','cleanup_detach_requested'))return;
  const routeEnd=Date.now()+2000;
  while(!markerPresent('Agents>')&&Date.now()<routeEnd&&!ended&&!controller.signal.aborted)await delay(100);
  if(ended||controller.signal.aborted||!markerPresent('Agents>')){
    actions.push({at:new Date().toISOString(),action:'cleanup_controls_not_observed'});return;
  }
  actions.push({at:new Date().toISOString(),action:'cleanup_koto_controls_observed'});
  if(!cleanupSend('\x15:stop all\r','cleanup_inner_stop_requested'))return;
  const end=Date.now()+15000;
  let settled=false;
  while(Date.now()<end&&!ended&&!controller.signal.aborted){
    if(innerSettled(readInner())){settled=true;break;}
    await delay(100);
  }
  actions.push({at:new Date().toISOString(),action:'cleanup_inner_settlement_readback',settled});
  if(!settled||ended||controller.signal.aborted)return;
  const quitRouteEnd=Date.now()+2000;
  while(!markerPresent('Agents>')&&Date.now()<quitRouteEnd&&!ended&&!controller.signal.aborted)await delay(100);
  if(ended||controller.signal.aborted||!markerPresent('Agents>')){
    actions.push({at:new Date().toISOString(),action:'cleanup_quit_controls_not_observed'});return;
  }
  if(!cleanupSend('\x15:quit\r','cleanup_quit_requested'))return;
  const quitEnd=Date.now()+5000;
  while(Date.now()<quitEnd&&!ended&&!controller.signal.aborted)await delay(100);
}
try {
  deadline=setTimeout(()=>{remember('cli_control_preparation_deadline');stop();},120000);
  const git=await api.resolveAgentExecutable('git.exe');
  const project=path.join(root,'project');
  await owned(git,['-c','core.autocrlf=false','-c',`core.hooksPath=${path.join(root,'disabled-hooks')}`,'clone','--no-local','--no-hardlinks','--no-checkout',path.join(mainRoot,'project'),project],root,'clone',30000);
  await owned(git,['-c','core.autocrlf=false','-c',`core.hooksPath=${path.join(root,'disabled-hooks')}`,'checkout','--detach',binding.candidate],project,'checkout');
  await owned(git,['config','--local','core.hooksPath',path.join(root,'disabled-hooks')],project,'hooks');
  await owned(git,['config','--local','core.autocrlf','false'],project,'line-endings');
  const before={head:(await owned(git,['rev-parse','HEAD'],project,'head')).trim(),status:(await owned(git,['status','--porcelain=v1','--untracked-files=all'],project,'status')).trim()};
  if(before.head!==binding.candidate||before.status!==''||existsSync(path.join(project,'.git','objects','info','alternates')))fail('separate_project_identity_changed');
  const agent=api.createAgentProfile({kind:'opencode',id:'idle',command:prepared.opencode,model:'local/koto-qwen3-4b',transport:'pty',timeoutMs:65000,
    task:'Remain idle. No task prompt is submitted in this CLI control observation.',owns:['docs/NATIVE_SESSIONS.md']});
  agent.args=['--model','local/koto-qwen3-4b'];
  const plan=api.validateProjectPlan({schemaVersion:1,project,goal:'Observe actual Koto CLI controls with one idle native terminal.',
    controlRoot:path.join(root,'control'),nativeHelperDirectory:helperDirectory,maxConcurrency:1,timeoutMs:70000,agents:[agent]});
  writeFileSync(path.join(root,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
  const effective=JSON.parse(await owned(prepared.opencode,['debug','config'],root,'effective-config',15000));
  for(const key of ['autoupdate','share','plugin','mcp','lsp','formatter','compaction','enabled_providers','model','small_model','permission'])
    if(JSON.stringify(effective[key])!==JSON.stringify(config[key]))fail('cli_control_effective_config_changed');
  for(const key of ['options','models'])if(JSON.stringify(effective.provider?.local?.[key])!==JSON.stringify(config.provider?.local?.[key]))fail('cli_control_effective_provider_changed');
  if(effective.agent?.title?.disable!==true||effective.agent?.build?.steps!==config.agent?.build?.steps)fail('cli_control_effective_agent_changed');
  await endpointAbsent();
  clearTimeout(deadline);
  deadline=setTimeout(()=>{remember('cli_control_observation_deadline');deadlineExpired=true;},60000);
  handle=startTerminalCommand({id:'cli',command:process.execPath,args:[path.join(installed,'bin/koto.js'),'project','start',path.join(root,'plan.json'),'--start'],
    cwd:project,env,timeoutMs:90000,columns:100,rows:30,helperPath,signal:controller.signal,onEvent:event=>capture(event,'outer')});
  handle.completion.then(result=>{outcome=result;ended=true;}).catch(e=>{ended=true;remember(e);stop();});
  await gate('Agents>',20000,'initial_koto_controls_missing');
  await waitInnerReady(15000);
  send(':status\r','status_before_attach');await gate('Agents>',3000,'status_controls_missing');
  await pause(1000);
  // Two explicit ownership handoffs in the same idle native session. This is
  // bounded product acceptance, with no prompt/model and unchanged deadlines.
  for(const [cycle,columns,rows] of [[1,132,36],[2,100,30]]) {
    const prefix=cycle===1?'':'second_';
    send(':attach idle\r',`${prefix}attach_requested`);
    await gate('Ask anything',8000,`${prefix}foreground_native_ui_missing`);
    const accepted=handle.resize(columns,rows);
    actions.push({at:new Date().toISOString(),action:`${prefix}outer_console_resize`,columns,rows,accepted});
    if(!accepted)fail('outer_console_resize_rejected');
    await pause(3000);send('\x1d',`${prefix}detach_requested`);
    await gate('[idle] detached. Returned to Koto controls.',5000,`${prefix}exact_koto_detach_marker_missing`);
    await gate('Agents>',2000,`${prefix}detached_koto_prompt_missing`);
    send(':status\r',`${prefix}status_after_detach`);
    await gate('Agents>',3000,`${prefix}returned_status_controls_missing`);
  }
  send(':stop idle\r','inner_stop_requested');
  await gate('Agents ended. Inspect and explicitly integrate contributions, or :quit to retain all worktrees.',15000,'inner_stop_controls_missing');
  await gate('Agents>',2000,'settled_koto_controls_missing');
  send(':quit\r','quit_requested');
  const quitDeadline=Date.now()+15000;
  while(!ended&&Date.now()<quitDeadline){running();await delay(100);}
  running();if(!ended)fail('cli_control_quit_deadline');
  outcome=await handle.completion;
  if(outerCleanup?.cleanup!=='confirmed'||outcome.error==='cleanup_unconfirmed')fail('cli_control_cleanup_unconfirmed');
  // Intentional inner stop makes the CLI's report cancelled and its exit code 1.
  if((outcome.error&&!(outcome.error==='exit_failed'&&outcome.exitCode===1))
    ||!['succeeded','failed'].includes(outcome.status)||![0,1].includes(outcome.exitCode))fail(outcome.error??'unexpected_cli_exit');
} catch(e){remember(e,/^[a-z][a-z0-9_]+$/.test(e?.message??'')?e.message:'cli_control_incomplete');}
finally {
  clearTimeout(deadline);
  try {if(setupHandle){try{setupHandle.stop();}catch(e){remember(e);}try{setupOutcome=await setupHandle.completion;}catch(e){remember(e);}}}
  finally {try {if(handle){
    if(!ended&&!controller.signal.aborted){try{await gracefulCleanup();}catch(e){remember(e,'cli_control_graceful_cleanup_failed');}}
    if(!ended)actions.push({at:new Date().toISOString(),action:'owned_outer_stop_fallback'});
    try{handle.stop();}catch(e){remember(e);}try{outcome=await handle.completion;}catch(e){remember(e);}
  }}
    finally {clearTimeout(deadline);process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}}
}
// All readback and logging occurs after owned process completion.
if(setupOutcome?.error)remember(setupOutcome.error);
if(outcome?.error&&!(outcome.error==='exit_failed'&&outcome.exitCode===1))remember(outcome.error);
let innerState;
try {
  const control=path.join(root,'control');
  const sessions=existsSync(control)?readdirSync(control).filter(n=>/^s-[A-Za-z0-9-]+$/.test(n)):[];
  if(sessions.length!==1)fail('cli_inner_session_missing_or_ambiguous');
  sessionRoot=path.join(control,sessions[0]);innerState=api.readProjectSession(sessionRoot);
  if(innerState.active||innerState.agents.length!==1||innerState.agents[0].id!=='idle'
    ||['pending','running'].includes(innerState.agents[0].status)||!innerState.agents[0].commandOutcome)fail('cli_inner_cleanup_unconfirmed');
  if(innerState.agents[0].commandOutcome.error)fail(innerState.agents[0].commandOutcome.error);
  if(outerCleanup?.cleanup!=='confirmed')fail('cli_control_cleanup_unconfirmed');
}catch(e){remember(e);}
const receipt={schemaVersion:1,kind:'koto-windows-cli-control-observation',candidate:binding.candidate,
  observationId:process.env.OBS_ID,root,mainRoot,bindingsSha256:hash(bindingBytes),
  route:standalone?'standalone-idle-controls':'post-model-controls',
  priorObservationSha256:observationBytes?hash(observationBytes):null,priorRuntimeCompletionSha256:runtimeBytes?hash(runtimeBytes):null,
  nativeExecutableSha256:hash(bytes(prepared.opencode,256*1024**2)),nativeConfigSha256:hash(configBytes),
  outcome,outerCleanup,innerState,sessionRoot,setup,setupOutcome,events,actions,error:errorCode??null,
  firstError:firstError??null,errors,cleanupErrors,
  noTaskPromptSubmitted:true,noModelStarted:true,cliControlsSemanticallyVerified:false,
  nativeRedrawVerified:false,humanTerminalRestorationVerified:false,
  interpretation:'Requires human inspection of actual CLI/native output and retained cleanup. Sending controls is not a pass.'};
try{writeFileSync(path.join(root,'evidence','observation.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});}
catch(e){remember(e,'cli_control_receipt_write_failed');}
process.stdout.write(JSON.stringify({root,error:errorCode??null,semanticReviewRequired:true})+'\n');
if(errorCode)process.exitCode=1;
