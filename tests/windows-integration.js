const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');const root=path.resolve(__dirname,'..');const resultFile=path.join(root,'test-output','windows-fixture-result.txt');fs.mkdirSync(path.dirname(resultFile),{recursive:true});
function helper(data){return new Promise((resolve,reject)=>{const p=spawn(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'windows.ps1')],{windowsHide:true});let out='',err='';const timer=setTimeout(()=>{p.kill();reject(new Error('helper timeout'));},20000);p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',()=>{clearTimeout(timer);try{resolve(JSON.parse(out));}catch{reject(new Error(err||out));}});p.stdin.end(JSON.stringify(data));});}
async function run(){
 const fixture=spawn(shell,['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'windows-fixture.ps1'),'-OutputFile',resultFile],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 fixture.stderr.on('data',b=>process.stderr.write(b));fixture.stdout.on('data',b=>process.stdout.write(b));
 try{
  let inspected;for(let i=0;i<10;i++){await new Promise(r=>setTimeout(r,500));inspected=await helper({action:'inspect',query:'Companion Accessibility Test Fixture'});if(inspected.status==='inspected')break;}
  if(inspected.status!=='inspected'){const all=await helper({action:'inspect',query:''});console.log('Fixture process',fixture.pid,'matching windows',all.windows.filter(w=>w.pid===fixture.pid));}
  assert.equal(inspected.status,'inspected',JSON.stringify(inspected));
  assert.ok(!JSON.stringify(inspected).includes('not-a-real-secret'));
  const input=inspected.controls.find(c=>c.type==='Win32.Edit'&&!c.password),button=inspected.controls.find(c=>c.name==='Confirm test'),password=inspected.controls.find(c=>c.password);assert.ok(input);assert.ok(button);assert.ok(password);
  const common={pid:inspected.window.pid,handle:inspected.window.handle};
  const protectedResult=await helper({...common,action:'type',control_id:password.id,text:'should not write'});assert.equal(protectedResult.status,'error');
  const text='Verified Windows automation — سلام';
  const typed=await helper({...common,action:'type',control_id:input.id,text});assert.equal(typed.status,'text_set',JSON.stringify(typed));
  const wrongLabel=await helper({...common,action:'click',control_id:button.id,expected_name:'Wrong label'});assert.equal(wrongLabel.status,'error');
  const clicked=await helper({...common,action:'click',control_id:button.id,expected_name:'Confirm test'});assert.equal(clicked.status,'activated',JSON.stringify(clicked));
  for(let i=0;i<10&&!fs.existsSync(resultFile);i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(fs.readFileSync(resultFile,'utf8').replace(/^\uFEFF/,''),text);
  const result={status:'passed',checks:['Windows UI Automation inspection','password content redaction including Win32 fallback','password edit refusal','Unicode text set and readback','changed control label refusal','real button activation']};fs.writeFileSync(path.join(root,'test-output','windows-integration.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{fixture.kill();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
