const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:3000/');
  const b64 = fs.readFileSync(process.argv[2]).toString('base64');
  const r = await p.evaluate(async (b64) => {
    const bin=atob(b64);const arr=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
    const ac=new (window.AudioContext||window.webkitAudioContext)();
    const audio=await ac.decodeAudioData(arr.buffer);
    const ch=audio.getChannelData(0);
    let max=0,sum=0,nz=0;
    for(let i=0;i<ch.length;i++){const a=Math.abs(ch[i]);if(a>max)max=a;sum+=a;if(a>0.001)nz++;}
    return {max,avg:sum/ch.length,nonzero:nz,total:ch.length,sr:audio.sampleRate};
  },b64);
  console.log(JSON.stringify(r));
  await b.close();
})();
