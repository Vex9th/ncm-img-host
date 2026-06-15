'use strict';

// ---------- 本地存储 ----------
const LS_COOKIE = 'ncm_cookie';
const LS_HISTORY = 'ncm_history';
const getCookie = () => localStorage.getItem(LS_COOKIE) || '';
const setCookie = (c) => localStorage.setItem(LS_COOKIE, c);
const clearCookie = () => localStorage.removeItem(LS_COOKIE);
const getHistory = () => { try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch { return []; } };
const setHistory = (h) => localStorage.setItem(LS_HISTORY, JSON.stringify(h));

// ---------- API ----------
async function api(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  return res.json();
}

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const loginView = $('#login-view');
const appView = $('#app-view');
const userArea = $('#user-area');
const qrStatus = $('#qr-status');
const qrRefresh = $('#qr-refresh');

let pollTimer = null;

function toast(msg) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1600);
}

// ---------- 视图切换 ----------
function showLogin() {
  appView.hidden = true; loginView.hidden = false; userArea.innerHTML = '';
  startQrLogin();
}
function showApp(profile) {
  loginView.hidden = true; appView.hidden = false;
  stopPoll();
  userArea.innerHTML = `<img src="${profile.avatarUrl}" alt=""><span>${profile.nickname}</span><button id="logout">退出</button>`;
  $('#logout').onclick = () => { clearCookie(); showLogin(); };
  renderHistory();
}

function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

// ---------- 二维码登录 ----------
async function startQrLogin() {
  stopPoll();
  qrStatus.textContent = '加载中…';
  qrRefresh.hidden = true;
  const keyRes = await api('/api/qr/key', { cookie: getCookie() });
  if (keyRes.code !== 200) { qrStatus.textContent = '获取二维码失败'; qrRefresh.hidden = false; return; }
  const unikey = keyRes.data.unikey;
  const createRes = await api('/api/qr/create', { key: unikey });
  const qrurl = createRes.data.qrurl;

  const wrap = $('#qr-canvas-wrap');
  wrap.innerHTML = '';
  new QRCode(wrap, { text: qrurl, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  qrStatus.textContent = '等待扫码…';

  pollTimer = setInterval(async () => {
    const r = await api('/api/qr/check', { key: unikey });
    if (r.code === 802) { qrStatus.textContent = '已扫码，请在手机确认'; }
    else if (r.code === 803) {
      stopPoll();
      setCookie(r.data.cookie);
      qrStatus.textContent = '登录成功';
      await boot();
    } else if (r.code === 800) {
      stopPoll();
      qrStatus.textContent = '二维码已过期';
      qrRefresh.hidden = false;
    }
  }, 2500);
}
qrRefresh.onclick = startQrLogin;

// ---------- 启动 ----------
async function boot() {
  const cookie = getCookie();
  if (cookie) {
    const st = await api('/api/login/status', { cookie });
    if (st.code === 200) { showApp(st.data); return; }
    clearCookie();
  }
  showLogin();
}
boot();

// ---------- 去重哈希 ----------
async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- 上传单文件（XHR 取进度）----------
function uploadFile(file, onProgress) {
  return new Promise((resolve) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('filename', file.name);
    fd.append('cookie', getCookie());
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({ code: 500, msg: '响应解析失败' }); } };
    xhr.onerror = () => resolve({ code: 502, msg: '网络错误' });
    xhr.send(fd);
  });
}

// ---------- 上传列表项 ----------
function addUploadItem(name) {
  const li = document.createElement('li');
  li.className = 'upload-item';
  li.innerHTML = `<span class="name">${name}</span><div class="progress"><i></i></div><span class="state">等待</span>`;
  $('#upload-list').appendChild(li);
  return {
    setProgress: (p) => { li.querySelector('i').style.width = `${Math.round(p * 100)}%`; },
    setState: (s) => { li.querySelector('.state').textContent = s; },
    remove: () => setTimeout(() => li.remove(), 1500),
  };
}

// ---------- 处理一批文件（并发）----------
async function handleFiles(files) {
  const history = getHistory();
  const imgs = [...files].filter((f) => f.type.startsWith('image/'));
  await Promise.all(imgs.map(async (file) => {
    const item = addUploadItem(file.name);
    const buf = await file.arrayBuffer();
    const hash = await sha256(buf);
    const dup = history.find((h) => h.hash === hash);
    if (dup) { item.setState('已存在'); item.setProgress(1); item.remove(); toast('图片已上传过，复用历史'); return; }

    item.setState('上传中');
    const res = await uploadFile(file, item.setProgress);
    if (res.code === 401) { item.setState('未登录'); clearCookie(); showLogin(); return; }
    if (res.code !== 200) { item.setState('失败'); toast(res.msg || '上传失败'); return; }

    item.setProgress(1); item.setState('完成'); item.remove();
    const record = { picId: res.data.picId, url: res.data.url, filename: file.name, size: file.size, time: Date.now(), hash };
    history.unshift(record); setHistory(history); renderHistory();
  }));
}

// ---------- 拖拽 / 点击 / 粘贴 ----------
const dropzone = $('#dropzone');
const fileInput = $('#file-input');
dropzone.onclick = () => fileInput.click();
fileInput.onchange = () => { handleFiles(fileInput.files); fileInput.value = ''; };
dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
dropzone.ondragleave = () => dropzone.classList.remove('dragover');
dropzone.ondrop = (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); };
window.addEventListener('paste', (e) => {
  const files = [...e.clipboardData.items].filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile());
  if (files.length) handleFiles(files);
});

// ---------- 格式化复制文本 ----------
function formatLink(record, fmt) {
  const { url, filename } = record;
  switch (fmt) {
    case 'markdown': return `![${filename}](${url})`;
    case 'html': return `<img src="${url}" alt="${filename}">`;
    case 'thumb': return `${url}?param=200y200`;
    default: return url;
  }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('已复制'); }
  catch { toast('复制失败'); }
}

// ---------- 渲染历史 ----------
function renderHistory() {
  const grid = $('#history-grid');
  const fmt = $('#format-select').value;
  const history = getHistory();
  grid.innerHTML = '';
  for (const r of history) {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <img src="${r.url}?param=300y0" alt="${r.filename}" loading="lazy">
      <div class="actions">
        <button class="copy">复制</button>
        <button class="del">删除</button>
      </div>`;
    card.querySelector('.copy').onclick = () => copyText(formatLink(r, $('#format-select').value));
    card.querySelector('.del').onclick = () => {
      setHistory(getHistory().filter((x) => x.picId !== r.picId));
      renderHistory();
    };
    grid.appendChild(card);
  }
}
$('#format-select').onchange = renderHistory;
