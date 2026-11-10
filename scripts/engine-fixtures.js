'use strict';
const http=require('node:http');
const shell=(body,script)=>`<!doctype html><html><head><meta charset="utf-8"><title>Unfamiliar workspace</title><style>body{font:18px Segoe UI;padding:24px}button,input{font:inherit;margin:6px;padding:8px}section{border:1px solid #aaa;padding:12px;margin:8px}label{display:block}iframe{width:650px;height:280px;border:1px solid #aaa}dialog{padding:25px}</style></head><body><h1>Unfamiliar workspace</h1>${body}<script>window.fixture={actions:[],saved:null};const f=window.fixture;${script}</script></body></html>`;
function fixturePage(mode,childBase){
 if(mode==='repeated')return shell('<main id="rows"></main><main id="editor"></main><label>Save status<input aria-label="Save status" id="status" readonly value="Not saved"></label>',`
  f.records={Harbor:'Harbor',Iris:'Iris',Wren:'Wren'};for(const name of ['Wren','Harbor','Iris']){const section=document.createElement('section');section.setAttribute('role','group');section.setAttribute('aria-label','Record '+name);section.innerHTML='<h2>'+name+'</h2><button>Edit</button>';section.querySelector('button').onclick=()=>{f.actions.push('edit:'+name);document.querySelector('#editor').innerHTML='<label>Title<input aria-label="Title" value="'+f.records[name]+'"></label><button id="save">Save changes</button>';document.querySelector('#save').onclick=()=>{const value=document.querySelector('[aria-label="Title"]').value;f.records[name]=value;f.saved={record:name,value};f.actions.push('save:'+name);document.querySelector('#status').value='Saved '+value;};};document.querySelector('#rows').append(section);}
 `);
 if(mode==='shadow')return shell('<section id="component" aria-label="Embedded settings"></section>',`
  const root=document.querySelector('#component').attachShadow({mode:'open'});root.innerHTML='<style>label{display:block}input,button{font:18px Segoe UI;margin:8px;padding:8px}</style><label>Public label<input aria-label="Public label" value="Original"></label><button>Apply changes</button><label>Save status<input aria-label="Save status" readonly value="Not saved"></label>';root.querySelector('button').onclick=()=>{f.actions.push('apply');f.saved=root.querySelector('[aria-label="Public label"]').value;root.querySelector('[aria-label="Save status"]').value='Saved '+f.saved;};
 `);
 if(mode==='frame')return shell('<label>Reference<input aria-label="Reference" value="Original"></label><button id="apply">Apply changes</button>',`
  document.querySelector('#apply').onclick=()=>{const value=document.querySelector('[aria-label="Reference"]').value;f.actions.push('apply');f.saved=value;parent.postMessage({fixtureSaved:value},'*');};
 `);
 if(mode==='iframe')return shell(`<iframe title="Embedded editor" src="${childBase}/frame"></iframe><label>Save status<input aria-label="Save status" id="status" readonly value="Not saved"></label>`,`
  addEventListener('message',e=>{if(e.origin!==${JSON.stringify(childBase)}||e.source!==document.querySelector('iframe').contentWindow||typeof e.data?.fixtureSaved!=='string')return;f.actions.push('frame-saved');f.saved=e.data.fixtureSaved;document.querySelector('#status').value='Saved '+f.saved;});
 `);
 if(mode==='large')return shell('<nav id="catalog" aria-label="Catalog"></nav><label>Public label<input aria-label="Public label" value="Original"></label><button id="apply">Apply changes</button><label>Save status<input aria-label="Save status" id="status" readonly value="Not saved"></label>',`
  for(let i=0;i<220;i++){const b=document.createElement('button');b.textContent='Browse category '+i;b.onclick=()=>f.actions.push('UNREQUESTED:'+i);document.querySelector('#catalog').append(b);}
  document.querySelector('#apply').onclick=()=>{f.saved=document.querySelector('[aria-label="Public label"]').value;f.actions.push('apply');document.querySelector('#status').value='Saved '+f.saved;};
 `);
 if(mode==='popup')return shell('<main id="editor"><button id="open">Edit settings</button></main><label>Save status<input aria-label="Save status" id="status" readonly value="Not saved"></label>',`
  document.querySelector('#open').onclick=()=>{f.actions.push('open');const d=document.createElement('dialog');d.setAttribute('aria-label','Editing mode');d.innerHTML='<p>Continue into edit mode</p><button>Continue editing</button>';document.body.append(d);d.showModal();d.querySelector('button').onclick=()=>{f.actions.push('continue');d.close();d.remove();document.querySelector('#editor').innerHTML='<label>Public label<input aria-label="Public label" value="Original"></label><button id="apply">Apply changes</button>';document.querySelector('#apply').onclick=()=>{f.saved=document.querySelector('[aria-label="Public label"]').value;f.actions.push('apply');document.querySelector('#status').value='Saved '+f.saved;};};};
 `);
 return shell('<p>Unknown fixture</p>','');
}
async function startFixtures(){
 let childBase;const handler=(req,res)=>{const mode=new URL(req.url,'http://127.0.0.1').pathname.slice(1);res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'});res.end(fixturePage(mode,childBase));};
 const primary=http.createServer(handler),child=http.createServer(handler),listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',r));
 await listen(child);childBase='http://127.0.0.1:'+child.address().port;await listen(primary);const base='http://127.0.0.1:'+primary.address().port;
 return {base,childBase,close:()=>Promise.all([primary,child].map(server=>new Promise(r=>server.close(r))))};
}
module.exports={startFixtures};
