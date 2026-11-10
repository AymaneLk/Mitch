'use strict';
const path=require('node:path');
const {connect,app}=require('./chatgpt-benchmark-host');
const {runBenchmark}=require('./benchmark-chatgpt');
let host,passed=false;
console.log(JSON.stringify({phase:'starting',scope:'synthetic OAuth transport benchmark'}));
connect().then(async value=>{
  host=value;console.log(JSON.stringify({phase:'connected',models:host.auth.publicState().models,selected:host.auth.model()}));
  const report=await runBenchmark({...host,directory:path.resolve(__dirname,'../test-output')});passed=report.status==='completed';console.log(JSON.stringify({status:report.status,summary:report.summary}));
}).catch(error=>console.error(error.message)).finally(()=>{host?.close();app.exit(passed?0:1);});
