'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function({BrowserWindow,screen,dispatch,overlay,activityScope,directory}){
  const run=(name,args)=>dispatch(name,args,{activityScope}),checks=[];let win;
  try{
    for(const display of screen.getAllDisplays()){
      const title=`Mitch measured target ${process.pid}`;
      win=new BrowserWindow({title,x:display.workArea.x+100,y:display.workArea.y+100,width:1000,height:700,show:false,webPreferences:{sandbox:true,contextIsolation:true}});
      await win.loadFile(path.join(__dirname,'grounding-fixture.html'));
      await win.webContents.executeJavaScript(`document.title=${JSON.stringify(title)}`);win.show();win.focus();
      await new Promise(resolve=>setTimeout(resolve,300));
      const listed=await run('computer_list_windows',{query:title}),target=listed.windows.find(w=>w.pid===process.pid&&w.title===title);assert.ok(target);
      const observed=await run('computer_observe',{scope:'window',pid:target.pid,window_id:target.window_id});
      const profile=observed.targets?.find(t=>t.name==='Profile');assert.ok(profile,'The real button must be measured by Windows. '+JSON.stringify({...observed,_images:undefined}));
      const args={snapshot:observed.snapshot,target_id:profile.target_id,expected_name:profile.name};
      const marked=await run('draw_computer_target',{...args,shape:'circle',color:'green'});assert.equal(marked.status,'drawn');assert.equal(marked.display_id,display.id);
      // Wait for the actual overlay renderer, then measure its painted pixels.
      await overlay.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const image=await overlay.webContents.capturePage(),bitmap=image.toBitmap(),size=image.getSize();
      let left=size.width,top=size.height,right=-1,bottom=-1;
      for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){
        const i=(y*size.width+x)*4;if(bitmap[i+1]>200&&bitmap[i+1]-bitmap[i+2]>60&&bitmap[i+1]-bitmap[i]>60){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
      }
      assert.ok(right>left&&bottom>top,'The green ring must actually be painted.');
      const bounds=overlay.getContentBounds(),rect=await win.webContents.executeJavaScript('window.targetRect()'),content=win.getContentBounds();
      const actual={x:bounds.x+(left+right)/2*bounds.width/size.width,y:bounds.y+(top+bottom)/2*bounds.height/size.height};
      const expected={x:content.x+rect.x+rect.width/2,y:content.y+rect.y+rect.height/2};
      const error={x:actual.x-expected.x,y:actual.y-expected.y};
      assert.ok(Math.abs(error.x)<=3&&Math.abs(error.y)<=3,JSON.stringify({actual,expected,error,bounds,content}));
      const clicked=await run('computer_input',{...args,kind:'click'});assert.ok(['verified','unverified'].includes(clicked.status),JSON.stringify(clicked));
      const hit=(await win.webContents.executeJavaScript('window.hits')).at(-1);assert.equal(hit?.id,'profile');
      const next=clicked.targets.find(t=>t.name==='Profile');
      win.setPosition(content.x+30,content.y+30);
      const stale=await run('draw_computer_target',{snapshot:clicked.snapshot,target_id:next.target_id,expected_name:next.name,shape:'circle',color:'green'});assert.equal(stale.status,'error','A moved window must invalidate its old target location.');
      checks.push({display:display.id,scaleFactor:display.scaleFactor,circleErrorPixels:error,click:hit,staleWindowRefused:true});
      await run('clear_screen_drawings',{});win.destroy();win=null;
    }
    fs.writeFileSync(path.join(directory,'measured-target-integration.json'),JSON.stringify({status:'passed',at:new Date().toISOString(),checks},null,2));
  }catch(error){fs.writeFileSync(path.join(directory,'measured-target-integration.json'),JSON.stringify({status:'failed',at:new Date().toISOString(),checks,error:error.message},null,2));throw error;}
  finally{await run('clear_screen_drawings',{});if(win&&!win.isDestroyed())win.destroy();}
};
