'use strict';

const {randomUUID}=require('node:crypto');
const path=require('node:path').win32;
const TTL=30000,MAX_MATCHES=24;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
function fault(code,message,attempted=false){return Object.assign(Error(message),{code,refused:!attempted,...(attempted?{action_attempted:true,outcome_unknown:true}:{})});}
function localDirectoryPath(value){
  if(typeof value!=='string'||value.length>2048||!(/^[A-Za-z]:[\\/]/.test(value))||/[\x00-\x1f<>"|?*]/.test(value)||value.slice(2).includes(':')||/^\\\\/.test(value))throw fault('folder_invalid_path','Use an ordinary absolute local folder path.');
  const normalized=path.normalize(value);
  if(normalized.split('\\').some(segment=>segment!==''&&/[. ]$/.test(segment)))throw fault('folder_invalid_path','Folder paths with trailing spaces or dots are not supported.');
  return normalized.length>3?normalized.replace(/\\+$/,''):normalized;
}
const samePath=(a,b)=>localDirectoryPath(a).toLowerCase()===localDirectoryPath(b).toLowerCase();
function folderQuery(value){
  if(typeof value!=='string'||!value.trim()||value.length>2048||/[\x00-\x1f<>"|?*]/.test(value))throw fault('folder_invalid_query','Use one folder name or an absolute local folder path.');
  // The parser already removes request punctuation/quoting. Preserve literal
  // leading and internal spaces in a quoted Windows folder name.
  const query=value;
  if(/^[A-Za-z]:[\\/]/.test(query))return localDirectoryPath(query);
  if(/[\\/:]/.test(query)||/[. ]$/.test(query)||query==='.'||query==='..')throw fault('folder_invalid_query','Use a folder name or an absolute local path; URLs and shell commands are not folder paths.');
  return query;
}
const check=context=>{context?.signal?.throwIfAborted();context?.assertActive?.();};

/** Folder paths are discovered by the Windows Shell helper. Model arguments
 * can only select an opaque, short-lived discovered folder ID, never launch a
 * file, command, URL or arbitrary guessed path through this API. */
class FolderAccess{
  constructor({helper,now=Date.now,ttlMs=TTL}={}){
    if(typeof helper!=='function'||!Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>120000)throw new TypeError('A bounded Windows folder helper is required.');
    Object.assign(this,{helper,now,ttlMs});this.snapshots=new Map();this.scopes=new Map();this.defaultScope=Symbol('folders');
  }
  scope(context={}){const key=context.activityScope??context.signal??this.defaultScope;if(!this.scopes.has(key)){this.scopes.set(key,{paths:new Set(),unknown:false});if(this.scopes.size>128)this.scopes.delete(this.scopes.keys().next().value);}return this.scopes.get(key);}
  async find({query}={},context={}){
    check(context);query=folderQuery(query);
    const result=await this.helper({action:'discover',query},context);check(context);
    if(!plain(result)||result.status!=='ok'||typeof result.complete!=='boolean'||result.complete&&result.truncated||!Array.isArray(result.matches)||result.matches.length>MAX_MATCHES||typeof result.search_scope!=='string')throw fault('folder_invalid_result','Windows did not return a valid folder discovery result.');
    const entries=new Map(),matches=[];
    for(const row of result.matches){
      if(!plain(row)||typeof row.name!=='string'||row.name.length>256||!Array.isArray(row.open_windows)||row.open_windows.length>64||row.open_windows.some(id=>!Number.isSafeInteger(id)||id<=0))throw fault('folder_invalid_result','Windows returned an invalid folder candidate.');
      const actual=localDirectoryPath(row.path),key=actual.toLowerCase();
      const expectedName=path.basename(actual)||actual;
      if(row.name.toLowerCase()!==expectedName.toLowerCase()||(/^[A-Za-z]:[\\/]/.test(query)?!samePath(query,actual):query.toLowerCase()!==expectedName.toLowerCase()))throw fault('folder_invalid_result','Windows returned a folder outside the exact requested name or path.');
      if([...entries.values()].some(entry=>entry.path.toLowerCase()===key))throw fault('folder_invalid_result','Windows returned duplicate folder candidates.');
      const folder_id=randomUUID(),entry={path:actual,name:row.name,open_windows:[...new Set(row.open_windows)]};entries.set(folder_id,entry);matches.push({folder_id,...entry});
    }
    for(const [key,value] of this.snapshots)if(this.now()-value.created>this.ttlMs)this.snapshots.delete(key);
    if(this.snapshots.size>=64)this.snapshots.delete(this.snapshots.keys().next().value);
    const snapshot=randomUUID();this.snapshots.set(snapshot,{created:this.now(),entries,used:false,complete:result.complete});
    return {status:'ok',query,snapshot,matches,complete:result.complete,search_scope:result.search_scope.slice(0,500),...(result.truncated?{truncated:true}:{}),...(typeof result.message==='string'?{message:result.message.slice(0,500)}:{})};
  }
  async open({snapshot,folder_id}={},context={}){
    check(context);const observed=this.snapshots.get(snapshot),entry=observed?.entries.get(folder_id),scope=this.scope(context);
    if(scope.unknown)throw fault('folder_outcome_unknown','An earlier folder operation has an unknown result. Check Explorer before making a new request.');
    if(!entry||this.now()-observed.created>this.ttlMs||observed.used)throw fault('folder_stale_snapshot','Discover the folder again before choosing an exact result.');
    if(!observed.complete)throw fault('folder_incomplete_discovery','Folder discovery was incomplete; use an explicit full folder path.');
    if(scope.paths.has(entry.path.toLowerCase()))throw fault('folder_replay_blocked','This task already attempted that exact folder. It will not be opened again.');
    // Reserve before invoking Windows. A lost response must not launch twice.
    observed.used=true;scope.paths.add(entry.path.toLowerCase());check(context);
    let output;
    try{output=await this.helper({action:'open',path:entry.path},context);check(context);}
    catch(error){scope.unknown=true;throw fault('folder_outcome_unknown','Windows did not confirm the folder operation. Check Explorer; no retry was sent.',true);}
    if(!plain(output)||!['opened','focused_existing','refused','unverified'].includes(output.status)||typeof output.action_attempted!=='boolean'){
      scope.unknown=true;throw fault('folder_invalid_result','Windows returned an unconfirmed folder operation. No retry was sent.',true);
    }
    if(output.outcome_unknown)scope.unknown=true;
    if(output.status==='refused'&&output.action_attempted===false)return {status:'refused',verified:false,action_attempted:false,refused:true,code:typeof output.code==='string'?output.code:'folder_refused',message:typeof output.message==='string'?output.message:'Windows refused this folder operation.'};
    let exact=false;try{exact=samePath(output.path,entry.path);}catch{}
    if(!exact||output.verified!==true||output.foreground_verified!==true||!Number.isSafeInteger(output.window_id)||output.window_id<=0||!['opened','focused_existing'].includes(output.status))return {status:'unverified',verified:false,action_attempted:output.action_attempted,path:entry.path,foreground_verified:false,outcome_unknown:!!output.outcome_unknown,code:typeof output.code==='string'?output.code:'folder_verification_failed',message:'The folder operation was sent, but Windows did not confirm that the exact folder is in front. No retry was sent.'};
    return {status:output.status,verified:true,action_attempted:output.action_attempted,path:entry.path,name:entry.name,window_id:output.window_id,foreground_verified:true,verification:'Windows Shell exact folder path and foreground HWND'};
  }
}
module.exports={FolderAccess,folderQuery,localDirectoryPath};
