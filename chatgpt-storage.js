'use strict';
const fs=require('node:fs'),path=require('node:path');
function protectedStorage(directory,safeStorage,filename='chatgpt-auth.json'){
  if(!['chatgpt-auth.json','mcp-auth.json'].includes(filename))throw Error('Invalid secure storage name.');
  const file=path.join(directory,filename);
  return {
    async read(){if(!fs.existsSync(file))return null;const envelope=JSON.parse(fs.readFileSync(file,'utf8'));if(envelope.version!==1||typeof envelope.encrypted!=='string')throw Error('Saved ChatGPT storage is invalid.');try{const value=await safeStorage.decryptStringAsync(Buffer.from(envelope.encrypted,'base64'));return JSON.parse(value.result);}catch{throw Error('Windows could not unlock the saved ChatGPT connections.');}},
    async write(value){if(!await safeStorage.isAsyncEncryptionAvailable())throw Error('Windows secure storage is unavailable.');const encrypted=(await safeStorage.encryptStringAsync(JSON.stringify(value))).toString('base64');fs.mkdirSync(directory,{recursive:true});const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify({version:1,encrypted}),{mode:0o600});fs.renameSync(temporary,file);},
  };
}
module.exports={protectedStorage};
