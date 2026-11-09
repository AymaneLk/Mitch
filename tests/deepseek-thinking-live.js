'use strict';
// Opt-in real API check inside Mitch's normal secure-storage profile.
// Only synthetic notes are exposed; this instance has no desktop dispatcher.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {AI}=require('../ai');
module.exports=async function({ai:host,directory}){
  const report={status:'running',at:new Date().toISOString(),requests:[],actions:[],realDesktopActions:false};
  try{
    const settings={...host.getSettings(),chatProvider:'deepseek',allowScreen:false};
    const fetcher=async(url,options)=>{
      if(report.requests.length>=6)throw new Error('Synthetic test request limit reached');
      const body=JSON.parse(options.body),started=Date.now();
      assert.equal(body.thinking.type,'enabled');assert.equal(body.reasoning_effort,'high');
      const entry={thinking:body.thinking.type,effort:body.reasoning_effort,continuations:body.messages.filter(m=>m.role==='assistant'&&m.reasoning_content).length};
      report.requests.push(entry);
      const response=await host.fetch(url,options),data=await response.clone().json().catch(()=>({}));
      Object.assign(entry,{status:response.status,duration_ms:Date.now()-started,returnedReasoning:!!data.choices?.[0]?.message?.reasoning_content,finishReason:data.choices?.[0]?.finish_reason,usage:data.usage});
      return response;
    };
    const ai=new AI(()=>settings,async()=>{throw new Error('OpenAI disabled');},async name=>{
      assert.equal(name,'read_notes','Only synthetic reads are permitted');report.actions.push(name);
      return{notes:[{title:'Fixture',text:'The synthetic code is ORCHID.'}]};
    },fetcher,host.getDeepSeekKey);
    // Includes legacy plain history created before thinking was enabled.
    ai.history=[{role:'user',content:'This is a synthetic connection test.'},{role:'assistant',content:'Ready.'}];
    const first=await ai.chat('Use read_notes with query "fixture" once, then tell me the synthetic code.');
    assert.match(first,/ORCHID/i);assert.equal(report.actions.length,1);
    const second=await ai.chat('Use read_notes with query "fixture" once again to confirm the code.');
    assert.match(second,/ORCHID/i);assert.equal(report.actions.length,2);
    assert.ok(report.requests.some(r=>r.continuations>0));assert.ok(report.requests.some(r=>r.returnedReasoning));
    const format={type:'json_schema',json_schema:{schema:{type:'object',properties:{status:{const:'ok'}},required:['status'],additionalProperties:false}}};
    await ai.request('responses',{instructions:'Return JSON with status equal to ok.',input:[{role:'user',content:'Check this synthetic result.'}],response_format:format});
    report.status='passed';report.checks=['thinking High default','legacy history accepted','two synthetic tool turns','reasoning continuation accepted','structured completion check'];
  }catch(error){report.status='failed';report.error=String(error.message).slice(0,400);}
  finally{fs.writeFileSync(path.join(directory,'deepseek-thinking-live.json'),JSON.stringify(report,null,2));}
  return report;
};
