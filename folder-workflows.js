'use strict';

const path=require('node:path');
const MAX_QUERY=1000,MAX_MATCHES=50;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const opaque=value=>typeof value==='string'&&value.length>0&&value.length<=80&&!/[\x00-\x20\x7f]/.test(value);
const bad=output=>!plain(output)||output.outcome_unknown||output.requires_review||output.recovery_required||output.input_suppressed||output.refused||output.cancelled||output.canceled||output.degraded||output.truncated||['error','refused','cancelled','canceled','interrupted','observation_failed','partial'].includes(output.status);
const textEqual=(a,b)=>a.normalize('NFC').toLowerCase()===b.normalize('NFC').toLowerCase();

// Only local Win32 directories are eligible here. The backend also checks
// existence/type and resolves the selected observation again before opening.
function localPath(value){
  if(typeof value!=='string'||value.length>MAX_QUERY||!(/^[a-z]:[\\/]/i.test(value))||/[\x00-\x1f\x7f<>"|?*]/.test(value)||value.slice(2).includes(':'))return null;
  const parts=value.slice(3).split(/[\\/]/);
  if(parts.some(part=>part==='.'||part==='..'||/[. ]$/.test(part)))return null;
  return path.win32.normalize(value).replace(/\\+$/,'').toLowerCase()||null;
}
function samePath(a,b){const left=localPath(a),right=localPath(b);return left!==null&&left===right;}
function target(value){
  let query=value.trim(),quoted=false;
  for(const [left,right]of [['"','"'],["'","'"],['“','”']]){
    if(query.startsWith(left)){
      if(!query.endsWith(right)||query.length<3)return null;
      query=query.slice(left.length,-right.length);quoted=true;
      if(query.includes(left)||left!==right&&query.includes(right))return null;
      break;
    }
  }
  if(!query.trim()||!quoted&&query!==query.trim()||query.length>MAX_QUERY||/[\x00-\x1f\x7f<>"|?*“”]/.test(query))return null;
  if(!quoted&&/(?:[;&`$]|\b(?:and|then)\s+(?:delete|remove|run|execute|send|upload|download|create|rename|copy|move|open|launch)\b)/i.test(query))return null;
  if(/^[a-z]:[\\/]/i.test(query))return localPath(query)?{query,absolute:true}:null;
  if(/[\\/:]/.test(query)||/[. ]$/.test(query)||query==='.'||query==='..')return null;
  if(!quoted&&(/[';&`$]/.test(query)||/\b(?:and|then|with|because|before|after|except|delete|remove|run|execute|send|upload|download|create|rename|copy|move|open|launch)\b/i.test(query)))return null;
  // A bare file-looking request must not enter a folder/app opening shortcut.
  // Quoted folder names may legitimately contain dots; the backend is still
  // required to confirm that the observed target is a directory.
  if(!quoted&&/\.(?:exe|com|bat|cmd|ps1|msi|lnk|url|dll|js|vbs|txt|pdf|docx?|xlsx?|pptx?|zip|rar|7z|png|jpe?g|gif|mp[34]|wav)$/i.test(query))return null;
  return {query,absolute:false};
}
function parseFolderWorkflow(text){
  if(typeof text!=='string'||!text.trim()||text.length>MAX_QUERY+100||/[\r\n\x00]/.test(text))return null;
  if(/[\\/]\.[.!?]*$/.test(text.trim()))return null;
  const source=text.trim().replace(/^(?:(?:please|can you|could you|would you)\s+)+/i,'').replace(/[.!?]+$/,'').trim();
  let candidate;
  const before=source.match(/^open\s+(?:the\s+)?(?:folder|directory)\s+(.+)$/i);
  const after=source.match(/^open\s+(?:the\s+)?(.+?)\s+(?:folder|directory)$/i);
  if(before||after)candidate=target((before||after)[1]);
  else{
    const direct=source.match(/^open\s+(.+)$/i),parsed=direct&&target(direct[1]);
    if(parsed?.absolute)candidate=parsed;
  }
  return candidate?{kind:'open_folder',query:candidate.query}:null;
}
function checkedDiscovery(output,plan){
  if(bad(output)||output.status!=='ok'||output.complete!==true||!opaque(output.snapshot)||!Array.isArray(output.matches)||output.matches.length>MAX_MATCHES)return null;
  const ids=new Set(),paths=new Set(),absolute=localPath(plan.query);
  for(const folder of output.matches){
    const normalized=localPath(folder?.path);
    if(!plain(folder)||!opaque(folder.folder_id)||normalized===null||ids.has(folder.folder_id)||paths.has(normalized))return null;
    if(absolute?normalized!==absolute:!textEqual(path.win32.basename(folder.path.replace(/[\\/]+$/,'')),plan.query))return null;
    ids.add(folder.folder_id);paths.add(normalized);
  }
  return output.matches;
}
function verifyFolderCompletion(text,events){
  const plan=typeof text==='string'?parseFolderWorkflow(text):text;
  if(!plan||plan.kind!=='open_folder'||!Array.isArray(events)||events.length!==2)return null;
  const [found,opened]=events,output=opened?.output;
  if(found?.name!=='folders_find'||found.args?.query!==plan.query||opened?.name!=='folders_open')return null;
  const matches=checkedDiscovery(found.output,plan);
  if(!matches||matches.length!==1||opened.args?.snapshot!==found.output.snapshot||opened.args?.folder_id!==matches[0].folder_id)return null;
  if(bad(output)||!['opened','focused_existing'].includes(output.status)||output.verified!==true||output.foreground_verified!==true||!samePath(output.path,matches[0].path))return null;
  if(output.folder_id!==undefined&&output.folder_id!==matches[0].folder_id)return null;
  return {decision:'complete',answer:`Opened ${matches[0].path}.`,reason:'Explorer confirmed the selected directory path and Windows confirmed its window is in front.'};
}
async function runFolderWorkflow({text,dispatch,context={}}){
  const plan=parseFolderWorkflow(text),events=[];
  if(!plan)return {handled:false,events,reason:'No complete explicit folder-open request matched.'};
  const check=()=>{context.signal?.throwIfAborted();context.assertActive?.();};
  const finish=(answer,reason)=>({handled:true,events,plan,answer,...(reason?{reason}:{})});
  const run=async(name,args)=>{
    check();let output;
    try{output=await dispatch(name,args,context);}catch(error){check();output={status:'error',message:String(error?.message||'Folder operation failed'),...(name==='folders_open'?{action_attempted:error?.action_attempted!==false&&error?.refused!==true,outcome_unknown:error?.refused!==true}:{} )};}
    check();events.push({name,args,output});return output;
  };
  const found=await run('folders_find',{query:plan.query}),matches=checkedDiscovery(found,plan);
  if(!matches)return finish('I could not safely identify that folder from the searched locations. Give me its full local folder path.','Folder discovery was incomplete or invalid; no folder was opened.');
  if(!matches.length)return finish(`I could not find the folder “${plan.query}” in the searched locations. Give me its full local folder path.`,'No exact folder match in the declared search scope.');
  if(matches.length>1){
    const listed=matches.slice(0,5).map(folder=>folder.path).join('\n');
    return finish(`I found more than one matching folder. Which full path should I open?\n${listed}${matches.length>5?'\nThere are additional matches; provide the full path.':''}`,'Multiple exact folder paths require clarification; no folder was opened.');
  }
  const opened=await run('folders_open',{snapshot:found.snapshot,folder_id:matches[0].folder_id});
  const verified=verifyFolderCompletion(plan,events);
  if(verified)return finish(verified.answer);
  return finish(opened?.action_attempted===false||opened?.refused===true?'Windows refused the folder operation. I did not repeat it or try clicking.':'I tried to open that folder, but could not verify its Explorer path and foreground window. I did not repeat the action.','The exact selected path and foreground result were not both verified.');
}
module.exports={parseFolderWorkflow,runFolderWorkflow,verifyFolderCompletion};
