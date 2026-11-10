'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
class Resources{
 constructor(){this.samples=[];this.file=path.join(__dirname,'../test-output','resource-control-'+process.pid+'.json');this.error=null;}
 async start(){
  fs.writeFileSync(this.file,JSON.stringify({stop:false}));
  this.child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'benchmark-resources.ps1'),'-RootPid',String(process.pid),'-ControlFile',this.file],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let buffer='';this.child.stdout.on('data',data=>{buffer+=data;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const sample=JSON.parse(line);if(Number.isFinite(sample.at)&&Array.isArray(sample.processes))this.samples.push(sample);}catch{}}});
  this.child.stderr.on('data',()=>{this.error='Resource sampler could not read all process counters.';});this.child.on('error',()=>{this.error='Resource sampler unavailable.';});
  const until=Date.now()+8000;while(!this.samples.length&&!this.error&&Date.now()<until)await new Promise(r=>setTimeout(r,50));
  if(!this.samples.length)this.error||='Resource sampler timed out.';
  return this;
 }
 begin(){return Date.now();}
 async end(start,end=Date.now()){
  const until=Date.now()+3000;while(!this.error&&(!this.samples.length||this.samples.at(-1).at<end)&&Date.now()<until)await new Promise(r=>setTimeout(r,50));
  const first=this.samples.findLastIndex(s=>s.at<=start),last=this.samples.findIndex(s=>s.at>=end);
  if(first<0||last<=first)return {available:false,error:this.error||'Insufficient samples'};
  const samples=this.samples.slice(first,last+1);let cpu=0,peak=0;
  for(let i=0;i<samples.length;i++){
   peak=Math.max(peak,samples[i].processes.reduce((sum,p)=>sum+p.rss,0));if(!i)continue;
   const previous=new Map(samples[i-1].processes.map(p=>[p.pid,p.cpu]));
   for(const p of samples[i].processes)cpu+=Math.max(0,p.cpu-(previous.get(p.pid)??0));
  }
  const wall=samples.at(-1).at-samples[0].at;
  return {available:true,scope:'Benchmark controller and live descendants: native driver, owned browser/renderers and owned app helpers; sampler excluded. Sample boundaries approximate task boundaries.',samples:samples.length,sampleWindowMs:wall,cpuSeconds:Math.round(cpu*1000)/1000,cpuPercentOneCore:Math.round(cpu*1000000/wall)/10,peakResidentMB:Math.round(peak/104857.6)/10};
 }
 async stop(){if(!this.child)return;fs.writeFileSync(this.file,JSON.stringify({stop:true}));const child=this.child;await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,2000))]);if(child.exitCode===null)child.kill();}
}
module.exports={Resources};
