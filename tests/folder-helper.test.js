'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');
test('real PowerShell folder functions reject unknown and namespace tab ambiguity without UI input',{skip:process.platform!=='win32'},()=>{
  const result=spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'folder-helper-functions.ps1'),'-HelperFile',path.join(__dirname,'..','folder-helper.ps1')],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  const report=JSON.parse(result.stdout.trim());assert.equal(report.passed,10);assert.equal(report.ui_operations,0);
});
