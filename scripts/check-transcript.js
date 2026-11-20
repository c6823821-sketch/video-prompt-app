const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const key = process.env.REA_VLM_KEY;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await p.click('#btn-settings');
  await p.fill('#api-key', key);
  await p.selectOption('#frame-count', '16');
  await p.click('.modal-body .btn.block');
  await p.waitForTimeout(800);
  await p.setInputFiles('#file-input', process.argv[2]);
  await p.waitForSelector('#result:not(.hidden)', { timeout: 180000 });
  const t = await p.locator('#transcript-text').innerText().catch(()=>'(无)');
  console.log('=== 浏览器识别的旁白 ===');
  console.log(t || '(空)');
  await b.close();
})();
