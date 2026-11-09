'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {AI}=require('../ai');

async function main() {
  const results=[];
  const settings=()=>({chatProvider:'local',transcriptionProvider:'local',localChatModel:'mitch-local',allowScreen:true});
  const noKey=async()=>{throw new Error('Local test attempted to access cloud credentials.');};
  async function run(name,fn){const start=Date.now();const detail=await fn();const result={name,passed:true,ms:Date.now()-start,...detail};results.push(result);console.log(JSON.stringify(result));}
  await run('chat',async()=>{
    const ai=new AI(settings,noKey,()=>{throw new Error('Unexpected action');});
    const text=await ai.chat('Reply with only MITCH_LOCAL_OK. Do not use tools.');assert.match(text,/MITCH_LOCAL_OK/);return {text};
  });
  await run('tool round trip',async()=>{
    const calls=[];
    const ai=new AI(settings,noKey,async(name,args)=>{calls.push({name,args});assert.equal(name,'create_note');assert.equal(args.title,'Local architecture test');assert.equal(args.text,'apples and bread');return {status:'saved',id:'integration-fixture-only',title:args.title};});
    const text=await ai.chat('Use create_note exactly once to save a note with title "Local architecture test" and text "apples and bread". Then briefly confirm.');
    assert.equal(calls.length,1);return {text,calls};
  });
  const fixture=path.join(__dirname,'../test-output/local-vision.png');
  if(fs.existsSync(fixture))await run('vision',async()=>{
    const ai=new AI(settings,noKey,()=>{});const text=await ai.see('data:image/png;base64,'+fs.readFileSync(fixture).toString('base64'),'What color is the large square? Reply with one common English color name, not a hex code.');assert.match(text,/red/i);return {text};
  });
  fs.mkdirSync(path.join(__dirname,'../test-output'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'../test-output/local-ai-results.json'),JSON.stringify(results,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
