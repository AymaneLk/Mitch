'use strict';

const identity=window=>`${window.pid}:${window.window_id}`;
// Correlate the requested launch with a newly observed window. Never guess an
// existing target when several instances have the same title.
async function launchAndInspect({app,launch,computer,signal,delay=ms=>new Promise(r=>setTimeout(r,ms))}){
  const check=()=>signal?.throwIfAborted();check();
  let before;
  try{before=await computer.listWindows({query:app.name});}catch{}
  check();
  if(before&&!before.degraded&&!before.truncated&&before.windows.length===1&&typeof computer.focus==='function'){
    const observation=await computer.focus(before.windows[0],{signal});check();
    return {status:'focused_existing',app:app.name,observation,message:'The app was already open. I brought its existing window forward. Continue from this exact window; do not launch another instance.'};
  }
  check();await launch();check();
  const base={status:'launch_requested',app:app.name};
  if(!before||before.degraded||before.truncated)return base;
  const prior=new Set(before.windows.map(identity));let latest;
  for(let attempt=0;attempt<5;attempt++){
    if(attempt)await delay(150);check();
    try{latest=await computer.listWindows({query:app.name});}catch{return base;}
    check();if(latest.degraded||latest.truncated)return {...base,message:'The app launch was requested, but window discovery is incomplete.'};
    const fresh=latest.windows.filter(window=>!prior.has(identity(window))&&!window.minimized&&window.on_screen!==false);
    if(fresh.length!==1)continue;
    let observation;try{observation=typeof computer.focus==='function'?await computer.focus(fresh[0],{signal}):await computer.inspect(fresh[0]);}catch{continue;}
    check();
    if(observation.status==='inspected'&&observation.controls?.length)return {status:'opened',app:app.name,observation,message:'This is the newly opened window. Reuse its snapshot and controls for the next step; no separate window search is needed.'};
  }
  return {...base,...(latest?{windows:latest.windows}:{}),message:'No unique new accessible window was identified. Inspect an exact main-window identity from the returned list before input. An internal app window can have no controls; check its main ApplicationFrameHost window before switching to screenshots.'};
}
module.exports={launchAndInspect};
