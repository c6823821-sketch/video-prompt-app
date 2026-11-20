/* 视频反推提示词 · 手机端核心逻辑 */
'use strict';

const DEFAULT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const VERSION = '1.0.0';
const REPO = 'jingyue-ai/video-prompt-app'; // GitHub 仓库，登录后按实际改

const $ = id => document.getElementById(id);
const state = {
  key: '', model: 'qwen3-vl-plus', frames: 6, base: DEFAULT_BASE,
  history: [], videoName: '', duration: 0, framesData: [], result: null
};

/* ---------- 存储 ---------- */
function lsGet(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch(e) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} }
function loadSettings() {
  const s = lsGet('vpa_settings', {});
  state.key = s.key || ''; state.model = s.model || 'qwen3-vl-plus';
  state.frames = s.frames || 6; state.base = s.base || DEFAULT_BASE;
  state.history = lsGet('vpa_history', []);
}
function openSettings() {
  $('api-key').value = state.key; $('model-name').value = state.model;
  $('frame-count').value = String(state.frames); $('base-url').value = state.base;
  $('app-version').textContent = VERSION;
  $('settings-msg').textContent = '';
  $('settings-modal').classList.remove('hidden');
}
function closeSettings() { $('settings-modal').classList.add('hidden'); }
function saveSettings() {
  state.key = $('api-key').value.trim();
  state.model = $('model-name').value;
  state.frames = parseInt($('frame-count').value, 10);
  state.base = $('base-url').value.trim() || DEFAULT_BASE;
  lsSet('vpa_settings', { key: state.key, model: state.model, frames: state.frames, base: state.base });
  $('settings-msg').textContent = '已保存 ✓';
  updateKeyUI();
  setTimeout(closeSettings, 700);
}
function updateKeyUI() { $('no-key').classList.toggle('hidden', !!state.key); }

/* ---------- 抽帧 ---------- */
function extractFrames(file, count) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto'; video.muted = true; video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;
    let done = false;
    const cleanup = () => { try { URL.revokeObjectURL(url); } catch(e) {} };
    video.onerror = () => { if (done) return; done = true; cleanup(); reject(new Error('视频解码失败，换 mp4 试试')); };
    video.onloadedmetadata = async () => {
      try {
        const duration = video.duration;
        if (!isFinite(duration) || duration <= 0) throw new Error('读不到视频时长');
        state.duration = duration;
        const frames = [];
        const safeCount = Math.min(count, Math.max(2, Math.floor(duration / 0.3)));
        for (let i = 0; i < safeCount; i++) {
          // 避开首尾极短处，均匀取样
          const t = duration <= 1 ? duration * (i + 0.5) / safeCount
                                  : 0.15 + (duration - 0.3) * i / Math.max(1, safeCount - 1);
          await seekTo(video, Math.min(t, Math.max(0, duration - 0.05)));
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 768 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push({ t, data: canvas.toDataURL('image/jpeg', 0.72) });
          onProgress(10 + Math.round(30 * (i + 1) / safeCount), '抽帧 ' + (i + 1) + '/' + safeCount);
        }
        cleanup(); resolve(frames);
      } catch (e) { if (!done) { done = true; cleanup(); reject(e); } }
    };
  });
}
function seekTo(video, t) {
  return new Promise((resolve, reject) => {
    let timer = setTimeout(() => { reject(new Error('抽帧超时')); }, 8000);
    const onSeek = () => { clearTimeout(timer); video.removeEventListener('seeked', onSeek); resolve(); };
    video.addEventListener('seeked', onSeek);
    try { video.currentTime = t; } catch(e) { clearTimeout(timer); video.removeEventListener('seeked', onSeek); reject(e); }
  });
}

/* ---------- 调模型 ---------- */
function buildPrompt(frameCount, duration) {
  return `这是一个视频的 ${frameCount} 张关键帧（按时间顺序，覆盖约 ${duration.toFixed(1)} 秒）。
请逆向分析这个视频，输出可直接用于 AI 视频生成模型（如即梦、可灵、Sora、Veo）的复刻提示词。

严格按以下格式输出（Markdown）：

## 整体判断
一句话：画面是怎么做的（实拍/AI生成/图文动效/混合）、主体是谁或什么、整体风格。

## 逐帧提示词
### 帧 1（约 0.0 秒）
- 画面：主体、环境、构图、光线、色彩
- 动作：这一刻发生什么、怎么动
- 运镜：机位、景别、推拉摇移

（每帧都按上面格式写，帧数与实际一致）

## 整合提示词（中文）
把整条视频浓缩成一段可直接复制的生成提示词，包含：主体外观、场景、光线、色调、动作顺序、运镜、节奏、风格。

## Integrated Prompt (English)
The single ready-to-use English prompt for video generation models.

要求：
1. 只描述你从帧里真正看到的内容，看不清的写"不确定"，不要编造。
2. 动作和运镜写具体（比如"缓慢向右推镜"而不是"有运镜"）。
3. 中文提示词 150-300 字，英文 80-150 词。
4. 不要输出分析过程、免责声明或额外说明。`;
}
async function callVLM(frames) {
  const content = [];
  frames.forEach((f, i) => {
    content.push({ type: 'text', text: `【关键帧 ${i + 1} · 约 ${f.t.toFixed(2)} 秒】` });
    content.push({ type: 'image_url', image_url: { url: f.data } });
  });
  content.push({ type: 'text', text: buildPrompt(frames.length, state.duration) });

  const resp = await fetch(state.base.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.key },
    body: JSON.stringify({ model: state.model, messages: [{ role: 'user', content }], max_tokens: 2000 })
  });
  const text = await resp.text();
  if (!resp.ok) {
    let msg = text.slice(0, 300);
    try { const j = JSON.parse(text); msg = (j.error && j.error.message) || msg; } catch(e) {}
    throw new Error('接口报错 ' + resp.status + '：' + msg);
  }
  const j = JSON.parse(text);
  const out = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!out) throw new Error('模型没返回内容');
  return out;
}

/* ---------- 流程 ---------- */
function onProgress(pct, label, detail) {
  $('progress-card').classList.remove('hidden');
  $('progress-bar').style.width = pct + '%';
  $('progress-pct').textContent = pct + '%';
  $('progress-label').textContent = label || '正在处理…';
  if (detail) $('progress-detail').textContent = detail;
}
async function handleFile(file) {
  if (!file) return;
  if (!state.key) { openSettings(); toast('先填 API Key'); return; }
  state.videoName = file.name;
  $('result').classList.add('hidden');
  try {
    onProgress(0, '读取视频…', file.name + ' · ' + (file.size / 1048576).toFixed(1) + ' MB');
    const frames = await extractFrames(file, state.frames);
    state.framesData = frames;
    onProgress(45, '发送给视觉模型…', frames.length + ' 帧已提取，正在分析');
    const prompt = await callVLM(frames);
    onProgress(95, '整理结果…');
    state.result = prompt;
    renderResult(prompt, file);
    saveHistory({ name: file.name, time: Date.now(), duration: state.duration,
      frames: frames.length, prompt, size: file.size });
    onProgress(100, '完成 ✓');
    setTimeout(() => $('progress-card').classList.add('hidden'), 900);
  } catch (e) {
    $('progress-card').classList.add('hidden');
    toast('出错：' + e.message);
    console.error(e);
  }
}
function renderResult(prompt, file) {
  $('video-info').textContent = '视频：' + file.name + ' · ' + state.duration.toFixed(1) + ' 秒 · 分析 ' + state.framesData.length + ' 帧';
  const host = $('prompt-content'); host.innerHTML = '';
  // 按 ## 分块展示
  const chunks = prompt.split(/(?=^## )/m).filter(s => s.trim());
  chunks.forEach(chunk => {
    const lines = chunk.trim().split('\n');
    const title = lines[0].replace(/^#+\s*/, '').trim() || '提示词';
    const body = lines.slice(1).join('\n').trim();
    const div = document.createElement('div'); div.className = 'prompt-block';
    const head = document.createElement('div'); head.className = 'block-head';
    const t = document.createElement('span'); t.className = 'block-title'; t.textContent = title;
    const c = document.createElement('button'); c.className = 'copy-one'; c.textContent = '复制';
    c.onclick = () => copyText(body);
    head.appendChild(t); head.appendChild(c);
    const pre = document.createElement('pre'); pre.textContent = body;
    div.appendChild(head); div.appendChild(pre); host.appendChild(div);
  });
  if (!chunks.length) {
    const div = document.createElement('div'); div.className = 'prompt-block';
    const pre = document.createElement('pre'); pre.textContent = prompt;
    div.appendChild(pre); host.appendChild(div);
  }
  $('result').classList.remove('hidden');
  $('result').scrollIntoView({ behavior: 'smooth' });
}
function saveHistory(item) {
  state.history.unshift(item);
  if (state.history.length > 30) state.history = state.history.slice(0, 30);
  lsSet('vpa_history', state.history); renderHistory();
}
function renderHistory() {
  const sec = $('history-section'); const list = $('history-list');
  if (!state.history.length) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden'); list.innerHTML = '';
  state.history.forEach((h, i) => {
    const d = document.createElement('div'); d.className = 'hist-item';
    const n = document.createElement('div'); n.className = 'hist-name'; n.textContent = h.name;
    const m = document.createElement('div'); m.className = 'hist-meta';
    m.textContent = new Date(h.time).toLocaleString('zh-CN') + ' · ' + h.duration.toFixed(1) + 's · ' + h.frames + '帧';
    d.appendChild(n); d.appendChild(m);
    d.onclick = () => {
      state.result = h.prompt;
      renderResult(h.prompt, { name: h.name });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    list.appendChild(d);
  });
}
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('已复制')).catch(() => fallbackCopy(text));
  } else fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea'); ta.value = text;
  ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta);
  ta.select(); try { document.execCommand('copy'); toast('已复制'); } catch(e) { toast('复制失败'); }
  document.body.removeChild(ta);
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2500);
}

/* ---------- 更新 ---------- */
async function checkUpdate(silent) {
  try {
    const r = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest');
    if (!r.ok) { if (!silent) toast('检查失败'); return; }
    const j = await r.json();
    const latest = (j.tag_name || '').replace(/^v/, '');
    if (compareVer(latest, VERSION) > 0) {
      $('update-info').textContent = '新版本 ' + latest + '\n' + (j.body || '').slice(0, 200);
      state.apkUrl = (j.assets || []).find(a => a.name.endsWith('.apk'))?.browser_download_url || j.html_url;
      $('update-modal').classList.remove('hidden');
    } else if (!silent) toast('已是最新版本');
  } catch(e) { if (!silent) toast('检查失败：' + e.message); }
}
function compareVer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i]||0) > (pb[i]||0)) return 1; if ((pa[i]||0) < (pb[i]||0)) return -1; }
  return 0;
}
function hideUpdate() { $('update-modal').classList.add('hidden'); }
async function downloadUpdate() {
  const url = state.apkUrl;
  if (!url) { toast('没有找到 APK'); return; }
  try {
    if (window.Capacitor && Capacitor.isNativePlatform() && window.Browser) {
      await Browser.open({ url });
    } else { window.open(url, '_blank'); }
  } catch(e) { window.open(url, '_blank'); }
}
function saveResultFile() {
  if (!state.result) { toast('还没有结果'); return; }
  const blob = new Blob([state.result], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = '提示词_' + state.videoName.replace(/\.[^.]+$/, '') + '.md';
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('已保存');
}

/* ---------- 绑定 ---------- */
$('upload-area').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
$('btn-settings').addEventListener('click', openSettings);
$('btn-copy').addEventListener('click', () => copyText(state.result || ''));
$('btn-save').addEventListener('click', saveResultFile);
$('btn-clear-history').addEventListener('click', () => {
  if (!confirm('清空所有历史记录？')) return;
  state.history = []; lsSet('vpa_history', []); renderHistory(); toast('已清空');
});

/* 拖拽支持（网页版） */
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f && f.type.startsWith('video/')) handleFile(f);
});

/* ---------- 启动 ---------- */
loadSettings(); updateKeyUI(); renderHistory();
if (window.Capacitor && Capacitor.isNativePlatform()) {
  setTimeout(() => checkUpdate(true), 2500);
}
