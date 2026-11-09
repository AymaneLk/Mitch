'use strict';

// A proposal is not evidence that a target exists. Only the box verifier may
// turn it into actionable bounds. Keep this transport local and credential-free.
const ENDPOINT='http://127.0.0.1:22135';
const validPoint=point=>point&&['x','y'].every(k=>Number.isFinite(point[k])&&point[k]>=0&&point[k]<=1);
class LocalGrounder {
  constructor({fetcher=fetch,now=Date.now,timeoutMs=3000}={}){this.fetch=fetcher;this.now=now;this.timeoutMs=timeoutMs;this.cooldownUntil=0;}
  async health(signal){
    signal?.throwIfAborted();
    try{
      const bounded=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(400)]);
      const response=await this.fetch(ENDPOINT+'/health',{headers:{'X-Mitch-Grounding':'1'},redirect:'error',signal:bounded});
      const data=await response.json();signal?.throwIfAborted();
      return {ready:response.ok&&data.ready===true,model:'GoClick-Base',device:data.device==='cuda'?'GPU':'CPU'};
    }catch{signal?.throwIfAborted();return {ready:false,model:'GoClick-Base',device:'CPU'};}
  }
  async propose(image,label,signal){
    signal?.throwIfAborted();
    if(this.now()<this.cooldownUntil)return null;
    if(typeof image!=='string'||image.length>18000000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image))throw Error('Invalid local grounding image.');
    if(typeof label!=='string'||!label.trim()||label.length>180)throw Error('Invalid local grounding label.');
    try{
      const bounded=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(this.timeoutMs)]);
      const response=await this.fetch(ENDPOINT+'/locate',{method:'POST',headers:{'Content-Type':'application/json','X-Mitch-Grounding':'1'},redirect:'error',body:JSON.stringify({image,label}),signal:bounded});
      if(!response.ok)throw Error('Local grounding unavailable.');
      const data=await response.json();signal?.throwIfAborted();
      if(data.found!==true||!validPoint(data.point))return null;
      return {point:{x:data.point.x,y:data.point.y},source:'goclick',grounding_only:true};
    }catch{
      signal?.throwIfAborted();
      // A busy/offline CPU must not delay every later action in the task.
      this.cooldownUntil=this.now()+30000;return null;
    }
  }
}
module.exports={LocalGrounder,validPoint};
