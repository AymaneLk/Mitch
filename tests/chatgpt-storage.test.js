'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {protectedStorage}=require('../chatgpt-storage');
const {Store}=require('../core');
const {ignorePackageFile}=require('../package-files');
test('protected storage writes only ciphertext and fails closed if Windows encryption is unavailable',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mitch-auth-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const key=crypto.randomBytes(32),iv=crypto.randomBytes(12);
  const secure={isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async text=>{const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(text),cipher.final()]);return Buffer.concat([cipher.getAuthTag(),data]);},decryptStringAsync:async data=>{const cipher=crypto.createDecipheriv('aes-256-gcm',key,iv);cipher.setAuthTag(data.subarray(0,16));return {result:Buffer.concat([cipher.update(data.subarray(16)),cipher.final()]).toString()};}};
  const storage=protectedStorage(directory,secure),saved={version:1,accessToken:'never-plaintext',refreshToken:'private-refresh'};await storage.write(saved);
  const disk=fs.readFileSync(path.join(directory,'chatgpt-auth.json'),'utf8');assert.ok(!disk.includes('never-plaintext'));assert.ok(!disk.includes('private-refresh'));assert.deepEqual(await storage.read(),saved);assert.equal(fs.existsSync(path.join(directory,'chatgpt-auth.json.tmp')),false);
  secure.isAsyncEncryptionAvailable=async()=>false;await assert.rejects(storage.write({accessToken:'replacement'}),/unavailable/);assert.equal(fs.readFileSync(path.join(directory,'chatgpt-auth.json'),'utf8'),disk);
  secure.decryptStringAsync=async()=>{throw Error('OS failure');};await assert.rejects(storage.read(),/could not unlock/);
});
test('retired provider settings migrate without deleting notes or local voice configuration',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mitch-migration-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  fs.writeFileSync(path.join(directory,'library.json'),JSON.stringify({settings:{chatProvider:'deepseek',deepseekChatModel:'old',allowDesktop:true},encryptedDeepSeekKey:'retired-ciphertext',notes:[{id:'kept',text:'A note'}]}));
  const store=new Store(directory);store.save();assert.equal(store.data.settings.chatProvider,'chatgpt');assert.equal(store.data.settings.transcriptionProvider,'local');assert.equal(store.data.settings.allowDesktop,true);assert.equal(store.data.notes[0].id,'kept');assert.equal(store.data.encryptedDeepSeekKey,undefined);assert.equal(store.data.settings.deepseekChatModel,undefined);
  store.data.settings.chatProvider='local';store.save();assert.equal(new Store(directory).data.settings.chatProvider,'local');
});
test('OAuth files are excluded from packaging even inside permitted directories',()=>{
  for(const file of ['/chatgpt-auth.json','/chatgpt-auth.json.tmp','/ui/chatgpt-auth.json','/vendor/chatgpt-auth.json.tmp'])assert.equal(ignorePackageFile(file),true);
});
