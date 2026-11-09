// Ephemeral presentation only. Spoken words are never written to disk.
class PetPresentation {
  constructor(){this.state='idle';this.phase=null;this.wake='off';this.size='small';this.turns=[];this.revision=0;}
  update(message){
    if(!message||typeof message!=='object')throw new Error('Invalid voice display update.');
    if(message.type==='status'){
      if(!['idle','connecting','active','closing'].includes(message.state))throw new Error('Invalid voice display state.');
      if(message.phase!=null&&!['listening','working','speaking'].includes(message.phase))throw new Error('Invalid voice display phase.');
      this.state=message.state;
      this.phase=this.state==='active'?(message.phase||'listening'):null;
      if(['idle','connecting'].includes(this.state))this.turns=[];
    }else if(message.type==='caption'){
      if(!['You','Mitch'].includes(message.speaker)||typeof message.delta!=='string'||message.delta.length>8192)throw new Error('Invalid voice caption.');
      if(this.state!=='active'||!message.delta)return false;
      let turn=this.turns.at(-1);
      if(turn?.speaker!==message.speaker||message.newTurn===true){turn={speaker:message.speaker,text:''};this.turns.push(turn);this.turns=this.turns.slice(-2);}
      turn.text=((message.replace===true?'':turn.text)+message.delta).slice(-1200);
    }else throw new Error('Invalid voice display update.');
    this.revision++;return true;
  }
  setWake(status){this.wake=status;this.revision++;}
  setSize(size){this.size=size==='giant'?'giant':'small';this.revision++;}
  snapshot(){
    const expanded=this.state!=='idle';
    const labels={off:'Ready when you are',starting:'Getting ready…',listening:'Say “Hi Mitch”',waking:'Connecting…',busy:'Microphone in use',paused:'Paused',setup:'Set up voice',error:'Voice unavailable'};
    const label=this.state==='active'?{listening:'Listening',working:'Working…',speaking:'Speaking…'}[this.phase]:{connecting:'Connecting…',closing:'Ending conversation…'}[this.state]||labels[this.wake]||labels.off;
    return {revision:this.revision,state:this.state,phase:this.phase,label,size:this.size,expanded,turns:this.turns.map(turn=>({...turn})),
      width:expanded?440:this.size==='giant'?360:180,
      height:(this.size==='giant'?160:82)+30+(this.turns.length?this.turns.length*72+8:0)};
  }
}
module.exports={PetPresentation};
