const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({main,pet,screen,directory,version})=>{
  const run=code=>main.webContents.executeJavaScript(code);
  const read=code=>pet.webContents.executeJavaScript(code);
  const until=async(code,predicate)=>{for(let i=0;i<80;i++){const value=await read(code);if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Pet display did not update: '+code);};
  const snapshot=async name=>{await new Promise(resolve=>setTimeout(resolve,100));fs.writeFileSync(path.join(directory,name),(await pet.webContents.capturePage()).toPNG());};
  const visible=main.isVisible(),originalBounds=pet.getBounds();
  try{
    await run("window.companion.localAction('set_pixie_size',{size:'small'})");
    main.hide();assert.equal(main.isVisible(),false);
    await run("live.change('connecting','Connecting your voice…')");
    await until("document.getElementById('status').textContent",value=>value==='Connecting…');
    assert.equal(pet.getBounds().width,440);assert.equal(pet.isFocusable(),false);
    await snapshot('pet-connecting.png');
    await run("live.channel={readyState:'open',close(){this.readyState='closed'}};live.change('active','Listening. Talk naturally.')");
    const emit=async(type,delta)=>run(`live.receive(${JSON.stringify({type:`session.${type}_transcript.delta`,delta})})`);
    await emit('input','Hi Mitch, ');await emit('input','what have I got planned today?');
    await emit('output','Good morning! ');await emit('output','Let’s take a look at your day.');
    await until("document.querySelectorAll('.words').length",value=>value===2);
    const words=await read("[...document.querySelectorAll('.words')].map(node=>node.textContent)");
    assert.deepEqual(words,['Hi Mitch, what have I got planned today?','Good morning! Let’s take a look at your day.']);
    assert.equal(await read("document.getElementById('status').textContent"),'Listening');
    assert.match(await run("document.getElementById('voiceCaption').textContent"),/Mitch: Good morning!/);
    await snapshot('pet-captions.png');
    await emit('input','واش تقدر توريني شنو عندي اليوم؟');
    await until("document.querySelector('.caption:last-child .words').textContent",value=>value.includes('اليوم'));
    assert.equal(await read("getComputedStyle(document.querySelector('.caption:last-child .words')).direction"),'rtl');
    await snapshot('pet-captions-rtl.png');
    await emit('output','<img src=x onerror=alert(1)>');
    await until("document.querySelector('.caption:last-child .words').textContent",value=>value.includes('<img'));
    assert.equal(await read("document.querySelectorAll('#captions img').length"),0);
    await emit('output',' Long streaming transcript.'.repeat(90));
    await until("document.querySelector('.caption:last-child .words').textContent.length",value=>value===1200);
    const scrolling=await read("(()=>{const p=document.querySelector('.caption:last-child .words');return p.scrollHeight-p.clientHeight-p.scrollTop})()");assert.ok(scrolling<=1);
    await assert.rejects(read("window.companion.voiceDisplay({type:'status',state:'active'})"),/Untrusted app frame/);
    await run("window.companion.stopTasks()");
    await until("document.querySelectorAll('.words').length",value=>value===0);assert.equal(pet.getBounds().width,180);
    await emit('input','Late transcript');assert.equal(await read("document.querySelectorAll('.words').length"),0);
    for(const display of screen.getAllDisplays()){
      const area=display.workArea;pet.setBounds({x:area.x+area.width-180,y:area.y+area.height-112,width:180,height:112});
      await run("live.change('connecting','Connecting your voice…')");
      await until("document.getElementById('status').textContent",value=>value==='Connecting…');
      const bounds=pet.getBounds();assert.ok(bounds.x>=area.x&&bounds.x+bounds.width<=area.x+area.width);assert.ok(bounds.y>=area.y&&bounds.y+bounds.height<=area.y+area.height);
      await run('live.cleanup()');await until("document.getElementById('pet').classList.contains('idle')",Boolean);
    }
    fs.writeFileSync(path.join(directory,'pet-integration.json'),JSON.stringify({status:'passed',version,at:new Date().toISOString(),checks:['connecting and listening in floating pet','live input/output transcript deltas through real renderer IPC while main window hidden','automatic RTL text','bounded scrolling transcript','inert transcript markup','trusted sender restriction','Stop clears captions and late events stay cleared','expansion stays on each monitor','pet does not take focus'],scope:'Synthetic transcript events through the existing LiveVoice event handler; no paid voice session.'},null,2));
  }finally{await run('live.cleanup()');pet.setBounds(originalBounds);if(visible)main.showInactive();}
};
