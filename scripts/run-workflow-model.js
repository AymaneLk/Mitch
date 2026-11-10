'use strict';
const path=require('node:path');
const {connect,app}=require('./chatgpt-benchmark-host');
const {runBenchmark,runCacheBenchmark}=require('./benchmark-workflow-model');
let host,passed=false;
connect().then(async value=>{
  host=value;const run=process.argv.includes('--cache')?runCacheBenchmark:runBenchmark;
  const report=await run({settings:host.settings,directory:path.resolve(__dirname,'../test-output'),modelRequest:(body,signal)=>host.provider.request(body,{signal,allowScreen:false}),repeats:1,versions:['workflow'],onProgress:p=>console.log(JSON.stringify(p))});
  passed=report.status==='completed';console.log(JSON.stringify({status:report.status,summary:report.summary}));
}).catch(error=>console.error(error.message)).finally(()=>{host?.close();app.exit(passed?0:1);});
