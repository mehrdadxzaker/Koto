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
  || !['private-root','bootstrap','run'].includes(request.mode)) fail('preparation_identity_changed');
const source = path.join(root,'project');
const settings = loadSettings(path.join(root,'reviewed-settings.json'),process.env.OBS_SETTINGS_SHA,{candidate:request.candidate,requireGates:process.env.OBS_OPERATION!=='idle'});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if(request.mode!=='private-root') {
  for (const [relative,key] of [['src/local-models.js','localModelsSha256'],['src/core.d.ts','coreTypesSha256']]) {
    if (hash(readFileSync(path.join(source,relative))) !== settings.candidateApi[key]) fail('preparation_candidate_api_changed');
  }
  if (!path.isAbsolute(request.git ?? '') || /\.(?:cmd|bat)$/i.test(request.git)) fail('preparation_git_executable_required');
  // One bounded read-only Git invocation before importing the selected source.
  const head = execFileSync(request.git,['-C',source,'rev-parse','HEAD'], {
    encoding:'utf8',timeout:5000,maxBuffer:4096,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},windowsHide:true,
  }).trim();
  if (head !== request.candidate) fail('preparation_candidate_head_changed');
}
process.env.KOTO_STATE_DIR = path.join(root,'state');
delete process.env.NODE_OPTIONS; delete process.env.NODE_PATH;
const raw = path.join(root,'evidence','raw');
const outputPaths = { stdout:path.join(raw,`${request.label}.stdout`), stderr:path.join(raw,`${request.label}.stderr`) };
const receiptPath = path.join(raw,`${request.label}.owned.json`);
const controller = new AbortController();
const interrupt = () => { remember('preparation_interrupted'); controller.abort(); };
process.once('SIGINT',interrupt); process.once('SIGTERM',interrupt);
let handle, outcome, errorCode, helper, aclPreparation, errorDetails, bytes = 0, timer;
const stdout=[],stderr=[],events=[];
const remember = (error,fallback='preparation_failed') => {
  const candidate=typeof error==='string'?error:error?.code;
  const code=typeof candidate==='string'&&/^[a-z][a-z0-9_]+$/.test(candidate)?candidate:fallback;
  const priority=v=>v?.endsWith('cleanup_unconfirmed')?3:/(?:socket|resource)_exhausted$/.test(v??'')?2:v?1:0;
  if(priority(code)>priority(errorCode))errorCode=code;
};
try {
  if(request.mode==='private-root') {
    // Fresh disposable runner tree only. No source helper exists yet. This one
    // bounded Windows PowerShell process uses .NET ACL/filesystem APIs only and
    // creates no descendants. It never edits profile/system ancestors.
    const script=String.raw`$ErrorActionPreference='Stop'
$root=[System.IO.Path]::GetFullPath($env:KOTO_OBSERVATION_PRIVATE_ROOT)
$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$trusted=@($me.Value,'S-1-5-18','S-1-5-32-544')
$report=@{status='incomplete';phase='inventory';directories=0;files=0;before=@();after=@();ancestors=@()}
$beforeAncestors=@{}
function AclSnapshot($p,$directory,$label) {
  $a=if($directory){[System.IO.Directory]::GetAccessControl($p)}else{[System.IO.File]::GetAccessControl($p)}
  $owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  $rules=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))
  if($rules.Count -gt 128){throw 'acl_rule_bound'}
  $danger=([int64][System.Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership') -bor 0x50000000
  $bad=@($rules | Where-Object {$_.AccessControlType -eq 'Allow' -and $trusted -notcontains $_.IdentityReference.Value -and (([int64]$_.FileSystemRights -band $danger) -ne 0)} | ForEach-Object {@{sid=$_.IdentityReference.Value;rights=[int64]$_.FileSystemRights;inherited=$_.IsInherited;inheritOnly=(($_.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0)}})
  @{path=$label;ownerTrusted=($trusted -contains $owner);protected=$a.AreAccessRulesProtected;untrustedWriterRules=$bad;sddl=$a.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::All)}
}
try {
  $pending=New-Object 'System.Collections.Generic.Queue[string]'
  $pending.Enqueue($root)
  $entries=New-Object 'System.Collections.Generic.List[object]'
  while($pending.Count) {
    $p=$pending.Dequeue()
    if($entries.Count -ge 50000){throw 'private_tree_entry_bound'}
    $attr=[System.IO.File]::GetAttributes($p)
    if(($attr -band [System.IO.FileAttributes]::ReparsePoint) -ne 0){throw 'private_tree_reparse_refused'}
    $directory=($attr -band [System.IO.FileAttributes]::Directory) -ne 0
    $label=if($p -eq $root){'.'}else{$p.Substring($root.Length+1)}
    $snapshot=AclSnapshot $p $directory $label
    if(!$snapshot.ownerTrusted){throw 'private_tree_owner_untrusted'}
    $entries.Add(@{path=$p;directory=$directory})
    if($report.before.Count -lt 32 -and ($label -eq '.' -or $snapshot.untrustedWriterRules.Count)){$report.before+=,$snapshot}
    if($directory){$report.directories++;foreach($child in [System.IO.Directory]::GetFileSystemEntries($p)){$pending.Enqueue($child)}}else{$report.files++}
  }
  $p=[System.IO.Directory]::GetParent($root)
  while($null -ne $p) {
    if($beforeAncestors.Count -ge 32){throw 'ancestor_bound'}
    if(($p.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0){throw 'ancestor_reparse_refused'}
    $snapshot=AclSnapshot $p.FullName $true $p.FullName
    $report.ancestors+=,$snapshot
    $beforeAncestors[$p.FullName]=$snapshot.sddl
    $p=$p.Parent
  }
  $report.phase='private_tree_acl'
  foreach($entry in $entries) {
    $acl=if($entry.directory){New-Object System.Security.AccessControl.DirectorySecurity}else{New-Object System.Security.AccessControl.FileSecurity}
    $acl.SetOwner($me)
    $acl.SetAccessRuleProtection($true,$false)
    foreach($sid in $trusted) {
      $identity=New-Object System.Security.Principal.SecurityIdentifier($sid)
      if($entry.directory){$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')}
      else{$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')}
      $acl.AddAccessRule($rule)
    }
    if($entry.directory){[System.IO.Directory]::SetAccessControl($entry.path,$acl)}else{[System.IO.File]::SetAccessControl($entry.path,$acl)}
  }
  $report.phase='readback'
  foreach($entry in $entries) {
    $label=if($entry.path -eq $root){'.'}else{$entry.path.Substring($root.Length+1)}
    $snapshot=AclSnapshot $entry.path $entry.directory $label
    if(!$snapshot.ownerTrusted -or $snapshot.untrustedWriterRules.Count -or !$snapshot.protected){throw 'private_tree_acl_readback_failed'}
    if($report.after.Count -lt 32 -and ($entry.directory -or $label -eq '.')){$report.after+=,$snapshot}
  }
  foreach($p in $beforeAncestors.Keys){if((AclSnapshot $p $true $p).sddl -ne $beforeAncestors[$p]){throw 'ancestor_acl_changed'}}
  $report.status='complete';$report.phase='complete'
}catch{$report.status='failed';$report.error=$_.Exception.Message.Substring(0,[Math]::Min(1024,$_.Exception.Message.Length))}
[Console]::Out.WriteLine(($report | ConvertTo-Json -Depth 8 -Compress))
if($report.status -ne 'complete'){exit 3}`;
    const system=process.env.SystemRoot??'C:\\Windows';
    const powershell=path.join(system,'System32','WindowsPowerShell','v1.0','powershell.exe');
    let output;
    try {
      output=execFileSync(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{
        encoding:'utf8',timeout:15000,maxBuffer:256*1024,windowsHide:true,
        env:{...process.env,KOTO_OBSERVATION_PRIVATE_ROOT:root,
          PSModulePath:path.join(system,'System32','WindowsPowerShell','v1.0','Modules')},
      });
    }catch(error){
      if(error.stdout){const chunk=Buffer.from(error.stdout).subarray(0,256*1024);stdout.push(chunk);bytes+=chunk.length;}
      if(error.stderr){const chunk=Buffer.from(error.stderr).subarray(0,16384);stderr.push(chunk);bytes+=chunk.length;}
      try{aclPreparation=JSON.parse(String(error.stdout??''));}catch{}
      throw Object.assign(new Error('Private observation ACL setup failed before helper bootstrap.'),{code:'preparation_private_acl_failed',diagnostics:aclPreparation?.error??error.code});
    }
    stdout.push(Buffer.from(output));bytes+=Buffer.byteLength(output);aclPreparation=JSON.parse(output);
    if(aclPreparation.status!=='complete')throw Object.assign(new Error('Private observation ACL readback did not complete.'),{code:'preparation_private_acl_failed'});
  } else if (request.mode==='bootstrap') {
    const {buildTerminalHelper}=await import(pathToFileURL(path.join(source,'src/terminal-helper.js')));
    // No npm/client workload exists before the product has built its helper.
    // The product compiler/developer-tool calls have their own output/time bounds
    // and retain uncertain cleanup. Do not kill their owning JS supervisor.
    helper=await buildTerminalHelper({directory:path.join(root,'state','native')});
    if(controller.signal.aborted)remember('preparation_interrupted');
  } else {
    const {resolveTerminalHelper}=await import(pathToFileURL(path.join(source,'src/terminal-helper.js')));
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
  errorDetails={code:error?.code??null,message:String(error?.message??'').slice(0,2048),
    diagnostics:typeof error?.diagnostics==='string'?error.diagnostics.slice(0,16384):null};
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
  // Detailed ACL snapshots stay in the bounded private stdout file, not the
  // <=64 KiB supervisor receipt consumed by Python. Preserve its exact digest.
  const aclSummary=aclPreparation?{status:aclPreparation.status,phase:aclPreparation.phase,
    directories:aclPreparation.directories,files:aclPreparation.files,
    error:typeof aclPreparation.error==='string'?aclPreparation.error.slice(0,1024):null,
    beforeSnapshots:aclPreparation.before?.length??0,afterSnapshots:aclPreparation.after?.length??0,
    ancestorsReadOnly:aclPreparation.ancestors?.length??0,detailsPath:outputPaths.stdout,
    detailsSha256:hash(Buffer.concat(stdout))}:undefined;
  writeFileSync(receiptPath,`${JSON.stringify({schemaVersion:1,candidate:request.candidate,
    mode:request.mode,label:request.label,helper,outcome,error:errorCode??null,errorDetails,aclPreparation:aclSummary,outputBytes:bytes,events},null,2)}\n`,{flag:'wx',mode:0o600});
} catch(error) { remember(error,'preparation_evidence_write_failed'); }
process.stdout.write(`${JSON.stringify({status:errorCode?'failed':'complete',error:errorCode??null,receiptPath,outputPaths})}\n`);
if(errorCode)process.exitCode=1;
