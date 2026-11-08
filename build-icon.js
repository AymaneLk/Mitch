// Original procedural artwork. No assets extracted from Pixie are used.
const fs=require('node:fs'),zlib=require('node:zlib'),path=require('node:path');
const dir=path.join(__dirname,'assets');fs.mkdirSync(dir,{recursive:true});
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([head,name,data,tail]);}
function png(size){const pixels=Buffer.alloc((size*4+1)*size);for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const xx=x/size,yy=y/size;const cx=Math.max(.17,Math.min(.83,xx)),cy=Math.max(.17,Math.min(.83,yy));const inside=Math.hypot(xx-cx,yy-cy)<.14&&xx>.03&&xx<.97&&yy>.03&&yy<.97;
  let color=inside?[27,33,24,255]:[0,0,0,0];
  for(const eye of [.30,.70]){const dx=Math.abs(xx-eye),dy=Math.abs(yy-.5);if((dx<.065&&dy<.095)||(dx<.09&&dy<.065))color=[231,244,211,255];if(dx<.031&&dy<.052)color=[27,33,24,255];}
  const offset=y*(size*4+1)+1+x*4;color.forEach((v,i)=>pixels[offset+i]=v);
}const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
const images=[32,64,256].map(png),header=Buffer.alloc(6);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=6+16*images.length;const entries=images.map((image,i)=>{const entry=Buffer.alloc(16),size=[32,64,256][i];entry[0]=entry[1]=size===256?0:size;entry.writeUInt16LE(1,4);entry.writeUInt16LE(32,6);entry.writeUInt32LE(image.length,8);entry.writeUInt32LE(offset,12);offset+=image.length;return entry;});fs.writeFileSync(path.join(dir,'companion.ico'),Buffer.concat([header,...entries,...images]));fs.writeFileSync(path.join(dir,'tray.png'),images[0]);
