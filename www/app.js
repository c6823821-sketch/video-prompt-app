/* 视频反推提示词 · 手机端核心逻辑 */
'use strict';

const DEFAULT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const VERSION = '1.1.0';
const REPO = 'c6823821-sketch/video-prompt-app'; // GitHub 仓库（自动更新用）

const $ = id => document.getElementById(id);
const state = {
  key: '', model: 'qwen3-vl-plus', frames: 16, base: DEFAULT_BASE,
  history: [], videoName: '', duration: 0, framesData: [], result: null, transcript: ''
};

/* ---------- 存储 ---------- */
function lsGet(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch(e) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} }
function loadSettings() {
  const s = lsGet('vpa_settings', {});
  state.key = s.key || ''; state.model = s.model || 'qwen3-vl-plus';
  state.frames = s.frames || 16; state.base = s.base || DEFAULT_BASE;
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

/* ---------- 音频转文字 ---------- */
function encodeWav(audioBuffer, maxSeconds) {
  // 手动线性插值降采样到 16k 单声道 PCM16（不用 OfflineAudioContext，部分手机/浏览器会输出静音）
  const targetRate = 16000;
  const ch = audioBuffer.getChannelData(0);
  const srcRate = audioBuffer.sampleRate;
  const total = Math.min(ch.length, Math.floor((maxSeconds || 170) * srcRate));
  const outLen = Math.floor(total * targetRate / srcRate);
  const buf = new ArrayBuffer(44 + outLen * 2);
  const v = new DataView(buf);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); v.setUint32(4, 36 + outLen * 2, true); wr(8, 'WAVE');
  wr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, targetRate, true); v.setUint32(28, targetRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wr(36, 'data'); v.setUint32(40, outLen * 2, true);
  const ratio = srcRate / targetRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio, i0 = Math.floor(pos), frac = pos - i0;
    let s = ch[i0] * (1 - frac) + (ch[i0 + 1] || 0) * frac;
    s = Math.max(-1, Math.min(1, s));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return 'data:audio/wav;base64,' + btoa(bin);
}
async function extractTranscript(file) {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return '';
  const ac = new Ctor();
  try {
    const arr = await file.arrayBuffer();
    let audio;
    try { audio = await ac.decodeAudioData(arr); }
    catch (e) { return ''; } // 音轨解码失败就跳过，不影响画面分析
    if (!audio || audio.duration < 0.5) return '';
    // ASR 上限约 3 分钟，encodeWav 内部只取前 170 秒
    const dataUri = encodeWav(audio, 170);
    const resp = await fetch(state.base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.key },
      body: JSON.stringify({ model: 'qwen3-asr-flash', stream: false,
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: dataUri } }] }] })
    });
    if (!resp.ok) return '';
    const j = await resp.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  } catch (e) { return ''; }
  finally { try { ac.close(); } catch (e) {} }
}

/* ---------- 调模型 ---------- */
function buildPrompt(frameCount, duration, transcript) {
  const audioPart = transcript && transcript.trim()
    ? `\n\n【视频旁白/口播原文（语音识别得到）】\n${transcript.trim()}\n\n请把这段旁白也应该出现在复刻视频的字幕/口播中，并在提示词里标明字幕的文字内容和出现时机。`
    : '\n\n（本条视频没有识别到清晰的人声旁白，只按画面分析。）';
  return `这是一个视频的 ${frameCount} 张关键帧（按时间顺序，覆盖约 ${duration.toFixed(1)} 秒）。${audioPart}
请逆向分析这个视频，输出可直接用于 AI 视频生成模型（如即梦、可灵、Sora、Veo）的复刻提示词。

严格按以下格式输出（Markdown）：

## 整体判断
一句话：画面是怎么做的（实拍/AI生成/图文动效/混合）、主体是谁或什么、整体风格；有无口播/字幕。

## 逐镜提示词
按画面变化分镜（不是每帧一段，相邻画面相同就合并成一镜）。每镜写：
- 画面：主体、环境、构图、光线、色彩、画面里出现的文字/字幕
- 动作：这一镜发生什么、怎么动
- 运镜：机位、景别、推拉摇移
- 字幕/口播：这一镜对应的旁白文字（如有）

## 整合提示词（中文）
把整条视频浓缩成一段可直接复制的生成提示词，包含：主体外观、场景、光线、色调、动作顺序、运镜、节奏、风格、字幕文字、口播内容。

## Integrated Prompt (English)
The single ready-to-use English prompt for video generation models, including on-screen text and narration.

要求：
1. 只描述你从帧里和旁白里真正看到/听到的内容，看不清的写"不确定"，不要编造。
2. 动作和运镜写具体（比如"缓慢向右推镜"而不是"有运镜"）。
3. 画面里出现的文字要原样写出来（这是字幕/封面文案，复刻时必须还原）。
4. 中文提示词 200-400 字，英文 100-200 词。
5. 不要输出分析过程、免责声明或额外说明。`;
}
async function callVLM(frames) {
  const content = [];
  frames.forEach((f, i) => {
    content.push({ type: 'text', text: `【关键帧 ${i + 1} · 约 ${f.t.toFixed(2)} 秒】` });
    content.push({ type: 'image_url', image_url: { url: f.data } });
  });
  content.push({ type: 'text', text: buildPrompt(frames.length, state.duration, state.transcript) });

  const resp = await fetch(state.base.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.key },
    body: JSON.stringify({ model: state.model, messages: [{ role: 'user', content }], max_tokens: 4000 })
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
    onProgress(40, '识别旁白声音…', '正在把音轨转成文字');
    state.transcript = await extractTranscript(file);
    onProgress(50, '发送给视觉模型…', frames.length + ' 帧' + (state.transcript ? ' + 旁白文字' : '') + '，正在分析');
    const prompt = await callVLM(frames);
    onProgress(95, '整理结果…');
    state.result = prompt;
    renderResult(prompt, file);
    saveHistory({ name: file.name, time: Date.now(), duration: state.duration,
      frames: frames.length, prompt, size: file.size, transcript: state.transcript });
    onProgress(100, '完成 ✓');
    setTimeout(() => $('progress-card').classList.add('hidden'), 900);
  } catch (e) {
    $('progress-card').classList.add('hidden');
    showError(e);
    console.error(e);
  }
}
function renderResult(prompt, file) {
  $('video-info').textContent = '视频：' + file.name + ' · ' + state.duration.toFixed(1) + ' 秒 · 分析 ' + state.framesData.length + ' 帧' + (state.transcript ? ' · 含旁白' : '');
  const tb = $('transcript-box');
  if (state.transcript && state.transcript.trim()) {
    $('transcript-text').textContent = state.transcript;
    tb.classList.remove('hidden');
  } else tb.classList.add('hidden');
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
function showError(e) {
  const box = $('error-card');
  if (!box) { toast('出错：' + e.message); return; }
  let hint = '';
  const m = String(e.message || e);
  if (m.includes('解码') || m.includes('时长')) hint = '\n\n建议：换成 mp4（H.264）格式，微信/抖音转存过的视频常被加密，先导出成mp4再试。';
  else if (m.includes('接口报错 401')) hint = '\n\n建议：API Key 填错了，去设置里重新粘贴一遍。';
  else if (m.includes('接口报错 400')) hint = '\n\n建议：视频帧数太多或文件太大，去设置把抽帧数调到 8 试试。';
  else if (m.includes('超时') || m.includes('fetch')) hint = '\n\n建议：检查网络，或换 4G/WiFi 重试。';
  $('error-msg').textContent = '出错：' + m + hint;
  box.classList.remove('hidden');
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function closeError() { $('error-card').classList.add('hidden'); }

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
