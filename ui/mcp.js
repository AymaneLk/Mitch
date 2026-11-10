(() => {
 const api=window.companion,host=document.getElementById('mcpConnections'),notice=document.getElementById('mcpNotice');
 const labels={disabled:'Off',not_installed:'Runtime missing',needs_credentials:'Account setup needed',needs_authorization:'Authorize your account',error:'Connection needs attention',connecting:'Connecting…',connected:'Connected',ready:'Ready to connect'};
 const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
 async function action(button,fn){button.disabled=true;notice.textContent='';try{const state=await fn();if(state?.servers)render(state);else if(state?.message)notice.textContent=state.message;}catch(e){notice.textContent=e.message.replace(/^Error invoking.*?Error: /,'');}finally{button.disabled=false;}}
 function button(text,fn){const b=el('button',text,'secondary');b.type='button';b.onclick=()=>action(b,fn);return b;}
 function render(state){
  const pending=Object.fromEntries([...host.querySelectorAll('input[data-key]')].map(e=>[e.dataset.key,e.value]));
  document.getElementById('mcpRoots').textContent='Local file access: '+state.roots.join(' · ');
  host.replaceChildren(...state.servers.map(server=>{
   const card=el('section',null,'mcp-card'),heading=el('div',null,'mcp-heading');heading.append(el('strong',server.name),el('span',labels[server.status]+(server.tools?' · '+server.tools+' tools':''),'fineprint'));card.append(heading,el('p',server.description,'fineprint'));
   const actions=el('div',null,'settings-actions');actions.append(button(server.enabled?'Turn off':'Turn on',()=>api.mcpEnabled(server.id,!server.enabled)));
   if(server.enabled&&server.status!=='not_installed')actions.append(button('Check connection',()=>api.mcpCheck(server.id)));
   if(server.fields.length){
    const details=el('details');details.open=server.status==='needs_credentials';details.append(el('summary','Account settings'));const fields=[];
    for(const [name,label,type] of server.fields){const row=el('label',label),input=el('input');input.type=type||'text';input.autocomplete='off';input.dataset.key=server.id+':'+name;input.value=pending[input.dataset.key]||(name==='email'?server.email:'');input.placeholder=server.hasCredentials?'Saved; leave blank to keep':'';row.append(input);details.append(row);fields.push([name,input]);}
    details.append(button('Save connection',async()=>{const result=await api.mcpConfigure(server.id,Object.fromEntries(fields.map(([name,input])=>[name,input.value])));fields.forEach(([,input])=>input.value='');return result;}));
    if(server.help)details.append(el('p',server.help,'fineprint'));
    if(server.setup)details.append(button('Open account setup',()=>api.mcpSetup(server.id)));
    card.append(details);
    if(['google','spotify'].includes(server.id)&&server.configured)actions.append(button('Authorize account',()=>api.mcpAuthorize(server.id)));
   }
   if(server.message)card.append(el('p',server.message,'fineprint'));card.append(actions);return card;
  }));
 }
 document.getElementById('mcpChooseRoots').onclick=function(){action(this,()=>api.mcpChooseRoots());};
 api.on('mcpState',render);api.mcpStatus().then(render).catch(e=>{notice.textContent=e.message;});
})();
