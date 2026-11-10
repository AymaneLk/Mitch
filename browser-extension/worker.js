'use strict';
importScripts('config.js','action-plan.js','public-site-task.js','tab-operations.js','page-operations.js','site-operations.js');
const configuredPort=globalThis.MITCH_BROWSER_CONFIG?.port;
const ENDPOINT='ws://127.0.0.1:'+(Number.isInteger(configuredPort)&&configuredPort>=1024&&configuredPort<=65535?configuredPort:22133)+'/mitch-browser';
const operations=MitchTabOperations.createTabOperations(chrome),pageOperations=MitchPageOperations.createPageOperations(chrome),pending=new Map();
const siteOperations=MitchSiteOperations.createSiteOperations(chrome,{sites:MitchPublicSites});
const sessionId=crypto.randomUUID();
let socket,ready=false,reconnectTimer,heartbeat,backoff=500,clientId,connecting=false;
let status='Mitch is not connected.',pageAccess=false;
async function refreshPermissions(){try{pageAccess=await chrome.permissions.contains({origins:['http://*/*','https://*/*']});}catch{pageAccess=false;}if(ready)safeSend(socket,{type:'page_access',enabled:pageAccess});}
const safeSend=(connection,message)=>{if(connection?.readyState===WebSocket.OPEN)connection.send(JSON.stringify(message));};
function scheduleReconnect(){
  if(reconnectTimer)return;
  reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect();},backoff);
  backoff=Math.min(backoff*2,15000);
}
function browserName(){const ua=navigator.userAgent;return /OPR\/|Opera/i.test(ua)?'opera':/Edg\//i.test(ua)?'edge':'chrome';}
async function identity(){
  if(clientId)return clientId;
  const stored=await chrome.storage.local.get('mitchBrowserClientId');
  clientId=typeof stored.mitchBrowserClientId==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(stored.mitchBrowserClientId)?stored.mitchBrowserClientId:crypto.randomUUID();
  if(clientId!==stored.mitchBrowserClientId)await chrome.storage.local.set({mitchBrowserClientId:clientId});
  return clientId;
}
async function connect(){
  if(connecting||socket?.readyState===WebSocket.OPEN||socket?.readyState===WebSocket.CONNECTING)return;
  const token=globalThis.MITCH_BROWSER_CONFIG?.token;
  if(typeof token!=='string'||token.length<32||token.length>512){status='Open Mitch to finish connecting this extension.';return;}
  connecting=true;
  try{
    await identity();await refreshPermissions();
    const connection=new WebSocket(ENDPOINT);socket=connection;
    connection.onopen=()=>{
      if(socket!==connection)return;
      status='Connecting to Mitch…';
      safeSend(connection,{type:'hello',token,clientId,browser:browserName(),sessionId,capabilities:['tabs','pages','page-recovery-v1','page-navigation-v1','public-sites-v1'],pageAccess});
      clearInterval(heartbeat);
      heartbeat=setInterval(()=>safeSend(connection,{type:'ping'}),20000);
    };
    connection.onmessage=event=>{
      if(socket!==connection||typeof event.data!=='string'||event.data.length>262144)return;
      let message;try{message=JSON.parse(event.data);}catch{return connection.close(1002,'Invalid message');}
      if(!message||typeof message!=='object'||Array.isArray(message))return connection.close(1002,'Invalid message');
      if(message.type==='ready'){ready=true;backoff=500;status='Connected to Mitch.';return;}
      if(message.type==='ping'){safeSend(connection,{type:'pong'});return;}
      if(message.type==='pong')return;
      if(message.type==='cancel'){const job=pending.get(message.id);if(job){job.cancelled=true;pageOperations.cancel(message.id);}return;}
      if(!ready||message.type!=='command'||typeof message.id!=='string')return;
      if(pending.has(message.id))return; // The original reply remains authoritative.
      if(pending.size>=32){safeSend(connection,{type:'result',id:message.id,result:{status:'refused',code:'busy',verified:false,action_attempted:false,message:'Too many pending browser requests.'}});return;}
      const job={cancelled:false,connection,page:message.method==='site.task'||typeof message.method==='string'&&message.method.startsWith('page.')};pending.set(message.id,job);
      const handler=message.method==='site.task'?siteOperations:typeof message.method==='string'&&message.method.startsWith('page.')?pageOperations:operations;
      handler.execute(message.method,message.args,{id:message.id,deadline:message.deadline,isCancelled:()=>job.cancelled||socket!==connection||!ready})
        .then(result=>{if(socket===connection&&ready)safeSend(connection,{type:'result',id:message.id,result});})
        .catch(()=>{if(socket===connection&&ready)safeSend(connection,{type:'result',id:message.id,result:{status:'error',code:'internal_error',verified:false,outcome_unknown:true,message:'The browser request ended without a confirmed result.'}});})
        .finally(()=>{if(pending.get(message.id)===job)pending.delete(message.id);});
    };
    connection.onerror=()=>{status='Mitch is not connected.';};
    connection.onclose=()=>{
      if(socket!==connection)return;
      ready=false;socket=null;clearInterval(heartbeat);heartbeat=null;status='Mitch is not connected.';
      for(const [id,job] of pending)if(job.connection===connection){job.cancelled=true;pageOperations.cancel(id);}
      scheduleReconnect();
    };
  }catch{status='Mitch is not connected.';scheduleReconnect();}
  finally{connecting=false;}
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message?.type==='mitch_browser_status'){reply({connected:ready,status,capabilities:['tabs','pages','page-recovery-v1','page-navigation-v1','public-sites-v1'],pageAccess});return;}
  if(message?.type==='mitch_browser_permissions_changed'){refreshPermissions().then(()=>reply({connected:ready,status,pageAccess}));return true;}
  if(message?.type==='mitch_browser_reconnect'){connect();reply({connected:ready,status});}
});
chrome.permissions?.onAdded?.addListener(refreshPermissions);
chrome.permissions?.onRemoved?.addListener(()=>{refreshPermissions();for(const [id,job] of pending)if(job.page){job.cancelled=true;pageOperations.cancel(id);}});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='mitch-browser-reconnect')connect();});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.alarms.create('mitch-browser-reconnect',{periodInMinutes:1});
connect();
