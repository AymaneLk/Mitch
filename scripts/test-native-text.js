const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),runtime=process.env.MITCH_ENGINE_APP||root,electron=process.versions.electron?require('electron'):null;
const {ComputerUse}=require(path.join(runtime,'computer-use')),{CuaClient}=require(path.join(runtime,'cua-client'));
const report={status:'running',version:require(path.join(runtime,'package.json')).version,packaged:runtime.endsWith('.asar'),cases:[]};
if(report.packaged)report.runtimeSha256=createHash('sha256').update(require('original-fs').readFileSync(runtime)).digest('hex');
async function run(){
 const tag=randomUUID(),file=path.join(root,'test-output','engine-native-text-'+tag+'.txt');fs.writeFileSync(file,'Original');
 const child=spawn(path.join(process.env.SystemRoot,'System32/notepad.exe'),[file],{stdio:'ignore'}),computer=new ComputerUse({client:new CuaClient({executable:path.join(report.packaged?runtime+'.unpacked':runtime,'vendor/cua-driver/cua-driver.exe')}),getSettings:()=>({allowDesktop:true}),confirm:async()=>true});
 try{
  let target;for(let i=0;i<40;i++){target=(await computer.listWindows()).windows.find(w=>w.pid===child.pid&&w.title.includes(tag));if(target)break;await new Promise(r=>setTimeout(r,100));}assert.ok(target,'Owned native fixture not found');
  const initial=await computer.inspect(target),control=initial.controls.find(c=>c.editable);assert.ok(control);const at=performance.now();
  const result=await computer.action({snapshot:initial.snapshot,control_id:control.control_id,expected_name:control.name,kind:'type',text:'Exact native text'});assert.equal(result.verification,'native_api');assert.equal(result.observation.controls.find(c=>c.editable).value,'Exact native text');report.cases.push({case:'unsupported UIA pattern uses exact native capability',passed:true,ms:Math.round(performance.now()-at)});
  for(const fields of [{before:'Stale value'},{pid:target.pid+100000},{name:'Unobserved control'}]){
   const refused=await computer.nativeText.replace({pid:target.pid,window_id:target.window_id,name:control.name,before:'Exact native text',text:'Must not be written',...fields});assert.equal(refused.action_attempted,false);assert.equal(refused.refused,true);const after=await computer.inspect(target);assert.equal(after.controls.find(c=>c.editable).value,'Exact native text');report.cases.push({case:'reject '+Object.keys(fields)[0],passed:true});
  }
  report.status='passed';
 }finally{await computer.stop();child.kill();}
}
(electron?electron.app.whenReady():Promise.resolve()).then(run).catch(e=>{report.status='failed';report.error=e.message;}).finally(()=>{fs.writeFileSync(path.join(root,'test-output/native-text-live.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(electron)electron.app.exit(report.status==='passed'?0:1);else process.exitCode=report.status==='passed'?0:1;});
