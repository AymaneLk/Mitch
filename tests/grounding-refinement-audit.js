'use strict';
const fs=require('node:fs'),path=require('node:path');
const {refineBox}=require('../visual-grounding');
module.exports=async function({ai,nativeImage,directory}){
  const source=JSON.parse(fs.readFileSync(path.join(directory,'coordinate-diagnostic.json'),'utf8'));
  const guesses=JSON.parse(fs.readFileSync(path.join(directory,'grounding-audit.json'),'utf8')).checks.filter(c=>c.mode==='model_box');
  const report={status:'running',at:new Date().toISOString(),checks:[]};
  try{
    for(const guessed of guesses){
      const c=source.checks.find(c=>c.display===guessed.display&&c.framed),started=Date.now();
      const image='data:image/png;base64,'+fs.readFileSync(path.join(directory,`coordinate-${c.display}-${c.framed}.png`)).toString('base64');
      const box=await refineBox({nativeImage,image,box:guessed.response,label:'small circular Profile button',locate:(image,label,signal)=>ai.locate(image,label,signal)});
      const cx=(box.left+box.right)/2,cy=(box.top+box.bottom)/2,correct=c.box;
      report.checks.push({display:c.display,duration_ms:Date.now()-started,box,hit:cx>=correct.left&&cx<=correct.right&&cy>=correct.top&&cy<=correct.bottom,error_pixels:{x:(cx-(correct.left+correct.right)/2)*c.image.width,y:(cy-(correct.top+correct.bottom)/2)*c.image.height}});
    }
    report.status='complete';
  }catch(error){report.status='failed';report.error=error.message;}
  fs.writeFileSync(path.join(directory,'grounding-refinement-audit.json'),JSON.stringify(report,null,2));
};
