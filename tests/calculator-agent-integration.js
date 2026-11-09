'use strict';
// Opt-in end-to-end model/desktop test. Only Calculator receives input.
const fs=require('node:fs'),path=require('node:path');
module.exports=async function({ai,main,dispatch,desktopActivity,directory,computer}){
  const isCalculator=window=>/calculat(?:or|rice)/i.test(window?.title||'');
  const identity=window=>window&&`${window.pid}:${window.window_id}`;
  const windows=new Set(),snapshots=new Set(),events=[];
  const originalDispatch=ai.dispatch,originalRequest=ai.request;
  const scope=desktopActivity.beginScope();let requests=0;
  const filename=path.join(directory,process.env.MITCH_CALCULATOR_REPORT||'calculator-agent-baseline.json');
  const request=process.env.MITCH_CALCULATOR_REQUEST||'open calculator and do this calculation 1.5 x 188 and give me the result';
  if(process.env.MITCH_CALCULATOR_OBSERVE_ONLY==='1'){
    const listed=await dispatch('computer_list_windows',{query:'Calculatrice'},{activityScope:scope}),observations=[];
    for(const window of listed.windows||[]){
      const state=await dispatch('computer_inspect_window',{pid:window.pid,window_id:window.window_id},{activityScope:scope});
      const raw=computer.snapshots.get(state.snapshot);
      observations.push({window,state,raw:raw?.elements});
      fs.writeFileSync(path.join(directory,'calculator-observations.json'),JSON.stringify(observations,null,2));
    }
    desktopActivity.endScope(scope);return;
  }
  const started=Date.now();let answer,error,verification;
  const save=()=>fs.writeFileSync(filename,JSON.stringify({request,requests,elapsedMs:Date.now()-started,answer,error,verification,events},null,2));
  ai.history=[];
  ai.request=async function(...args){if(++requests>14)throw new Error('Bounded Calculator test reached its model-request limit.');return originalRequest.apply(ai,args);};
  ai.dispatch=async(name,args,context)=>{
    const event={name,args,atMs:Date.now()-started};events.push(event);save();
    try{
      const allowed=['list_apps','open_app','inspect_app','click_app_control','type_in_app','computer_list_windows','computer_find_window','computer_restore_window','computer_inspect_window','computer_observe','computer_input','computer_action','computer_action_sequence'];
      if(!allowed.includes(name))throw new Error('This test permits only Calculator operations.');
      if(name==='open_app'&&!/^Microsoft\.WindowsCalculator_/i.test(args.app_id))throw new Error('This test only opens Windows Calculator.');
      if(['computer_inspect_window','computer_restore_window'].includes(name)&&!windows.has(identity(args)))throw new Error('This test only targets an observed Calculator window.');
      if(name==='computer_observe'&&(args.scope!=='window'||!windows.has(identity(args))))throw new Error('This test only captures an observed Calculator window.');
      if(['computer_input','computer_action','computer_action_sequence','click_app_control','type_in_app'].includes(name)&&!snapshots.has(args.snapshot))throw new Error('This test only inputs into an observed Calculator snapshot.');
      if(name==='inspect_app'&&!/calculat(?:or|rice)/i.test(args.query))throw new Error('This test only inspects Calculator.');
      const output=await dispatch(name,args,{...context,activityScope:scope});
      for(const window of output.windows||[])if(isCalculator(window))windows.add(identity(window));
      const state=output.observation||output;
      if(isCalculator(state.window)){windows.add(identity(state.window));if(state.snapshot)snapshots.add(state.snapshot);}
      if(output._images)for(const [index,item]of output._images.entries()){const image=item.data_url.match(/^data:image\/(png|jpeg);base64,(.+)$/s);if(image)fs.writeFileSync(path.join(directory,`calculator-agent-${events.length}-${index}.${image[1]}`),Buffer.from(image[2],'base64'));}
      event.output=JSON.parse(JSON.stringify(output,(key,value)=>key==='_images'?value.map(item=>({detail:item.detail,imageOmitted:true})):key==='windows'?value.filter(isCalculator):value));
      save();return output;
    }catch(caught){event.error=caught.message;save();throw caught;}
  };
  try{
    answer=await ai.chat(request,undefined,scope);
    const last=[...events].reverse().map(event=>event.output?.observation||event.output).find(state=>isCalculator(state?.window)&&state.controls?.length);
    if(last){
      const fresh=await dispatch('computer_inspect_window',{pid:last.window.pid,window_id:last.window.window_id},{activityScope:scope});
      const display=fresh.controls?.find(control=>/^(?:L.affichage est |Display is )/i.test(control.name))?.name;
      const actual=display?.replace(/^(?:L.affichage est |Display is )/i,'').trim();
      const expected=process.env.MITCH_CALCULATOR_EXPECTED||'282';
      verification={status:actual===expected?'passed':'failed',expected,display,window:last.window,source:'Independent live Calculator accessibility readback'};
      if(actual!==expected)throw new Error('Calculator display did not match the expected result.');
      const image=await dispatch('computer_observe',{scope:'window',pid:last.window.pid,window_id:last.window.window_id},{activityScope:scope});
      if(image._images?.[0])fs.writeFileSync(path.join(directory,'calculator-fixed-result.png'),Buffer.from(image._images[0].data_url.split(',')[1],'base64'));
    }else throw new Error('No readable Calculator result was observed.');
  }catch(caught){error=caught.message;}
  finally{ai.dispatch=originalDispatch;ai.request=originalRequest;desktopActivity.endScope(scope);save();}
  await main.webContents.executeJavaScript('go("chat");bubble('+JSON.stringify(request)+',"user");bubble('+JSON.stringify(answer||error)+',"assistant",'+!!error+');');
  main.show();main.focus();
};
