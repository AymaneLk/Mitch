'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const files=['manifest.json','worker.js','tab-operations.js','page-operations.js','page-agent.js','site-operations.js','site-agent.js','popup.html','popup.js'];
function prepareBrowserExtension({source,destination,token,port=22133}){
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid browser bridge port.');
  if(typeof token!=='string'||! /^[A-Za-z0-9_-]{43,128}$/.test(token))throw Error('Invalid browser connection token.');
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
  if(!manifest.key)throw Error('Browser extension identity is missing.');
  const extensionId=crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
  fs.mkdirSync(destination,{recursive:true});
  for(const file of files)fs.copyFileSync(path.join(source,file),path.join(destination,file));
  fs.copyFileSync(path.join(source,'..','action-plan.js'),path.join(destination,'action-plan.js'));
  fs.copyFileSync(path.join(source,'..','public-site-task.js'),path.join(destination,'public-site-task.js'));
  if(port!==22133){manifest.content_security_policy.extension_pages=manifest.content_security_policy.extension_pages.replaceAll('127.0.0.1:22133',`127.0.0.1:${port}`);fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2));}
  // This file is created only in the user's private application profile, never
  // the source tree or packaged archive. It is not sent to the model or UI.
  fs.writeFileSync(path.join(destination,'config.js'),'globalThis.MITCH_BROWSER_CONFIG = '+JSON.stringify({token,port})+';\n',{mode:0o600});
  return {extensionId,directory:destination};
}
module.exports={prepareBrowserExtension};
