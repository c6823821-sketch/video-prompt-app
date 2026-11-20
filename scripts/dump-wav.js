const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:3000/');
  const buf = fs.readFileSync(process.argv[2]);
  const b64 = buf.toString('base64');
  const out = await p.evaluate(async (b64) => {
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    const ac = new (window.AudioContext||window.webkitAudioContext)();
    const audio = await ac.decodeAudioData(arr.buffer);
    const targetRate=16000;
    const off = new OfflineAudioContext(1, Math.ceil(audio.duration*targetRate), targetRate);
    const src=off.createBufferSource(); src.buffer=audio; src.connect(off.destination);
    const rendered=await off.startRendering();
    const ch=rendered.getChannelData(0);
    let max=0,sum=0;
    for(let i=0;i<ch.length;i++){const a=Math.abs(ch[i]);if(a>max)max=a;sum+=a;}
    const ab=new ArrayBuffer(44+ch.length*2); const v=new DataView(ab);
    const wr=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
    wr(0,'RIFF');v.setUint32(4,36+ch.length*2,true);wr(8,'WAVE');wr(12,'fmt ');
    v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,targetRate,true);v.setUint32(28,targetRate*2,true);
    v.setUint16(32,2,true);v.setUint16(34,16,true);wr(36,'data');v.setUint32(40,ch.length*2,true);
    for(let i=0;i<ch.length;i++){const s=Math.max(-1,Math.min(1,ch[i]));v.setInt16(44+i*2,s<0?s*0x8000:s*0x7FFF,true);}
    let bb=''; const bytes=new Uint8Array(ab); const C=0x8000;
    for(let i=0;i<bytes.length;i+=C) bb+=String.fromCharCode.apply(null,bytes.subarray(i,i+C));
    return {wav:btoa(bb), max:max, avg:sum/ch.length, len:ch.length, origDur:audio.duration, origCh:audio.numberOfChannels};
  }, b64);
  fs.writeFileSync(process.argv[3], Buffer.from(out.wav,'base64'));
  console.log('max=',out.max,'avg=',out.avg,'len=',out.len,'origDur=',out.origDur,'origCh=',out.origCh);
  await b.close();
})();
