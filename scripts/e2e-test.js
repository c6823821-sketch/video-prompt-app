/* 端到端验证：填 Key -> 选视频 -> 抽帧 -> 调模型 -> 出结果 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const key = process.env.REA_VLM_KEY;
  const video = process.argv[2];
  if (!key || !video) { console.error('需要 REA_VLM_KEY 和视频路径'); process.exit(1); }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // 填设置
  await page.click('#btn-settings');
  await page.fill('#api-key', key);
  await page.fill('#base-url', 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  await page.selectOption('#frame-count', '16');
  await page.click('.modal-body .btn.block');
  await page.waitForTimeout(900);

  // 选视频
  await page.setInputFiles('#file-input', video);

  // 等结果（最多 3 分钟）
  try {
    await page.waitForSelector('#result:not(.hidden)', { timeout: 180000 });
    const text = await page.locator('#prompt-content').innerText();
    const info = await page.locator('#video-info').innerText();
    console.log('=== INFO ===');
    console.log(info);
    console.log('=== PROMPT (first 900 chars) ===');
    console.log(text.slice(0, 900));
    console.log('=== BLOCKS ===', await page.locator('.prompt-block').count());
    fs.writeFileSync(path.join(__dirname, 'e2e-result.txt'), info + '\n\n' + text, 'utf8');
  } catch (e) {
    console.error('等待结果超时:', e.message);
    const toast = await page.locator('#toast').innerText().catch(() => '');
    console.error('toast:', toast);
  }
  console.log('=== ERRORS ===');
  console.log(errors.length ? errors.join('\n') : 'none');
  await page.screenshot({ path: path.join(__dirname, 'e2e-screenshot.png'), fullPage: true });
  await browser.close();
})();
