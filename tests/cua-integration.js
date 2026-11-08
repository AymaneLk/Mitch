// Opt-in real Windows test. Only interacts with the fixture process created here.
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {CuaClient} = require('../cua-client');
const {ComputerUse} = require('../computer-use');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-output', `cua-fixture-${Date.now()}.txt`);
const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  fs.mkdirSync(path.dirname(output), {recursive:true});
  const fixture = spawn(shell, ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'windows-fixture.ps1'),'-OutputFile',output], {windowsHide:true,stdio:['ignore','ignore','pipe']});
  let fixtureError='';fixture.stderr.on('data',data=>fixtureError+=data.toString());
  const client = new CuaClient({timeoutMs:20000});
  const approved = [];
  const computer = new ComputerUse({client,getSettings:()=>({allowDesktop:true,allowScreen:false}),confirm:async request=>{
    assert.equal(request.window.pid, fixture.pid, 'Never act outside our own fixture.');
    approved.push(request.kind);return true;
  }});
  try {
    let window;
    for(let i=0;i<15;i++) {
      const list=await computer.listWindows({query:'Companion Accessibility Test Fixture'});
      window=list.windows.find(item=>item.pid===fixture.pid);
      if(window)break;
      await delay(400);
    }
    assert.ok(window,'Fixture not discovered. '+fixtureError);
    let observed=await computer.inspect(window);
    assert.ok(!JSON.stringify(observed).includes('not-a-real-secret'),'Protected content must never be returned.');
    const input=observed.controls.find(control=>control.name==='Test input');
    assert.ok(input,'Test input not found: '+JSON.stringify(observed.controls));
    const value='Pixie + Cua verified — سلام';
    const typed=await computer.action({snapshot:observed.snapshot,kind:'type',control_id:input.control_id,expected_name:input.name,text:value});
    observed=typed.observation;
    assert.ok(observed,'Typing must return a fresh observation: '+JSON.stringify(typed));
    assert.equal(observed.controls.find(control=>control.name==='Test input')?.value,value,'Read back the exact Unicode text.');
    const button=observed.controls.find(control=>control.name==='Confirm test');
    assert.ok(button,'Fixture button not found.');
    const clicked=await computer.action({snapshot:observed.snapshot,kind:'click',control_id:button.control_id,expected_name:button.name});
    for(let i=0;i<20&&!fs.existsSync(output);i++)await delay(100);
    assert.equal(fs.readFileSync(output,'utf8').replace(/^\uFEFF/,''),value,'Independent fixture file verifies the real button click.');
    await computer.stop();
    await assert.rejects(computer.listWindows({query:''}),/stopped|paused/i);
    const result={status:'passed',driverVersion:client.version,fixturePid:fixture.pid,checks:['real Cua stdio handshake','window discovery','accessibility snapshot without screenshot','password redaction','Unicode text replacement and readback','real button click independently verified by fixture file','stop prevents new calls'],approved,typingVerified:typed.verified,clickVerified:clicked.verified};
    fs.writeFileSync(path.join(root,'test-output/cua-integration.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  } finally {await computer.stop();fixture.kill();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
