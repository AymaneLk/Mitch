'use strict';
// One-use, loopback-only setup page. No key is printed or written in plaintext.
// Close Mitch before running this with Electron; reopen it when setup succeeds.
const {app,safeStorage,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {Store}=require('../core');
const {AI}=require('../ai');
const {DEFAULT_MODEL,deepseekHeaders,checkDeepSeek}=require('../deepseek-ai');
const root=path.resolve(__dirname,'..'),reportPath=path.join(root,'test-output','deepseek-live-result.json');
app.setName('Mitch');
app.setPath('userData',path.join(app.getPath('appData'),'Pixie Windows Companion'));
app.setAppUserModelId('local.independent.pixie.windows');
app.on('window-all-closed',()=>{});
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page=body=>'<!doctype html><meta charset="utf-8"><title>Mitch · DeepSeek setup</title><style>body{font:18px system-ui;background:#f6f5ef;color:#263226;max-width:720px;margin:70px auto;padding:32px}input,button{font:inherit;padding:14px;margin:10px 0;display:block;width:100%;box-sizing:border-box}button{background:#303c2c;color:white;border:0;border-radius:8px}small{line-height:1.6}</style><h1>Mitch · DeepSeek</h1>'+body;

async function connect(key){
  deepseekHeaders(key);
  if(!await safeStorage.isAsyncEncryptionAvailable())throw new Error('Windows secure storage is unavailable.');
  const settings={localOnly:true,chatProvider:'deepseek',deepseekChatModel:DEFAULT_MODEL,allowScreen:false};
  const started=Date.now(),timings={},calls=[];
  let at=Date.now();await checkDeepSeek(fetch,settings,key,AbortSignal.timeout(120000));timings.connectionMs=Date.now()-at;
  let requests=0;
  const boundedFetch=async(url,options)=>{
    if(++requests>6)throw new Error('The connection test reached its request limit.');
    const response=await fetch(url,options);
    if(!response.ok){const diagnostic=await response.clone().json().catch(()=>({}));console.error(JSON.stringify({request:requests,status:response.status,message:String(diagnostic.error?.message||'').replaceAll(key,'[REDACTED]').replace(/sk-[a-zA-Z0-9_-]+/g,'[REDACTED]').slice(0,700)}));}
    return response;
  };
  const ai=new AI(()=>settings,async()=>{throw new Error('OpenAI is disabled');},async(name)=>{
    calls.push(name);
    if(name!=='read_notes')throw new Error('Only synthetic read_notes is allowed in this test.');
    return {notes:[{title:'Connection test',text:'Mitch connection code: ORCHID.'}]};
  },boundedFetch,async()=>key);
  at=Date.now();const toolAnswer=await ai.chat('Use read_notes with query "connection test" and report the connection code.');
  timings.toolRoundTripMs=Date.now()-at;
  if(calls.length!==1||calls[0]!=='read_notes'||!toolAnswer.includes('ORCHID'))throw new Error('DeepSeek did not complete the synthetic tool check.');
  at=Date.now();await ai.request('responses',{instructions:'Return JSON with status equal to ok.',input:[{role:'user',content:'Check the connection.'}],response_format:{type:'json_schema',json_schema:{schema:{type:'object',properties:{status:{const:'ok'}},required:['status'],additionalProperties:false}}}});timings.jsonMs=Date.now()-at;
  const pixels=Buffer.alloc(320*160*4);
  for(let y=0;y<160;y++)for(let x=0;x<320;x++){const p=(y*320+x)*4;pixels[p]=x<160?0:255;pixels[p+2]=x<160?255:0;pixels[p+3]=255;}
  const image=nativeImage.createFromBitmap(pixels,{width:320,height:160}).toDataURL();
  settings.allowScreen=true;at=Date.now();const vision=await ai.see(image,'What color is the LEFT half of this synthetic test image? Answer only the color in English.');timings.visionMs=Date.now()-at;
  if(!/\bred\b/i.test(vision))throw new Error('DeepSeek did not identify the synthetic vision fixture correctly.');
  const store=new Store(path.join(app.getPath('appData'),'Pixie Windows Companion'));
  store.data.encryptedDeepSeekKey=(await safeStorage.encryptStringAsync(key)).toString('base64');
  Object.assign(store.data.settings,{chatProvider:'deepseek',deepseekChatModel:DEFAULT_MODEL});store.save();
  const report={status:'connected',at:new Date().toISOString(),model:DEFAULT_MODEL,elapsedMs:Date.now()-started,timings,checks:['model availability','text inference','synthetic tool round trip','validated structured JSON','synthetic image recognition','encrypted key saved'],realDesktopActions:false};
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  return report;
}

app.whenReady().then(()=>{
  const route='/'+crypto.randomBytes(24).toString('hex');let origin='',busy=false,used=false;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.headers.host!==new URL(origin).host||req.url!==route){res.writeHead(404).end();return;}
    if(req.method==='GET'&&!used){res.end(page('<p>Connect DeepSeek Flash to Mitch. This check uses a few small API requests and a synthetic image. Your key is saved encrypted by Windows.</p><form method="post"><label for="key">DeepSeek API key</label><input id="key" name="key" type="password" autocomplete="off" required maxlength="4096"><button>Connect and test</button></form><small>Chat and allowed screen content use your DeepSeek credit. Speech stays on your PC.</small>'));return;}
    if(req.method!=='POST'||req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')||busy||used){console.error(JSON.stringify({setupRejected:true,method:req.method,sameOrigin:req.headers.origin===origin,originPresent:!!req.headers.origin,formType:req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'),busy,used}));res.writeHead(403).end();return;}
    busy=true;
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw new Error('Input is too large.');}
      let key=new URLSearchParams(body).get('key')?.trim();body='';
      const report=await connect(key);key='';used=true;
      console.log(JSON.stringify(report));res.end(page('<h2>DeepSeek connected</h2><p>Text, tools, JSON and image recognition passed. The API key is saved securely. You can reopen Mitch.</p>'));
      setTimeout(()=>server.close(()=>app.exit(0)),1500);
    }catch(error){busy=false;res.statusCode=400;res.end(page('<h2>Connection not saved</h2><p>'+escape(error.message)+'</p><p>Return to this setup address to try again.</p>'));console.error('DeepSeek setup failed: '+error.message);}
  });
  server.listen(0,'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;console.log('SETUP_URL '+origin+route);});
  setTimeout(()=>server.close(()=>app.exit(1)),20*60*1000).unref();
}).catch(error=>{console.error(error.message);app.exit(1);});
