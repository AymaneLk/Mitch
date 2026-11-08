const api=window.companion,pet=document.getElementById('pet'),captions=document.getElementById('captions'),talk=document.getElementById('talk');
let revision=-1;
document.getElementById('face').onclick=()=>api.window('open');
talk.onclick=()=>api.window('voice');
function render(state){
  if(state.revision<revision)return;revision=state.revision;
  pet.className=['pet',state.state,state.size,state.expanded?'expanded':''].join(' ');
  document.getElementById('status').textContent=state.label;
  const action=state.state==='idle'?'Start talking':state.state==='connecting'?'Cancel connection':'End conversation';
  talk.title=action;talk.setAttribute('aria-label',action);talk.disabled=state.state==='closing';
  // Keep nodes stable as deltas arrive. Transcript text never becomes markup.
  while(captions.children.length>state.turns.length)captions.lastChild.remove();
  state.turns.forEach((turn,index)=>{
    let row=captions.children[index];
    if(!row){row=document.createElement('div');row.innerHTML='<span class="speaker"></span><p class="words" dir="auto"></p>';captions.append(row);}
    row.className='caption'+(index===state.turns.length-1?' current':'');row.dataset.speaker=turn.speaker;
    row.firstChild.textContent=turn.speaker==='You'?'YOU':'MITCH';
    const words=row.lastChild;if(words.textContent!==turn.text){words.textContent=turn.text;words.scrollTop=words.scrollHeight;}
  });
}
api.on('petState',render);
api.petState().then(render).catch(()=>{document.getElementById('status').textContent='Open Mitch to reconnect';});
