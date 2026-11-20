const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:3000/');
  const buf = fs.readFileSync(process.argv[2]).toString('base64');
  const r = await p.evaluate(async (b64) => {
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    try {
      const ac = new (window.AudioContext||window.webkitAudioContext)();
      const audio = await ac.decodeAudioData(arr.buffer);
      return { ok:true, channels:audio.numberOfChannels, duration:audio.duration, sr:audio.sampleRate };
    } catch(e) { return { ok:false, err:String(e) }; }
  }, buf);
  console.log(JSON.stringify(r));
  await b.close();
})();
