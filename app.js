// 喬喬集點屋 · main app
// 單頁 + hash routing；資料存 localStorage + Cloudflare Worker 同步

// ====== 設定 ======
const SYNC_BASE = 'https://celesterewards-sync.saygmulovesgreen.workers.dev';
const STORAGE_KEY = 'celesterewards.v1';
const PIN_KEY = 'celesterewards.pin';

// ====== 狀態 ======
const defaultState = () => ({
  balance: { current: 0, lifetime: 0, today: 0, lastResetDate: todayStr() },
  tasks: [],
  gifts: [],
  history: [],
  auth: { pinHash: null, webauthnCredId: null },
  updatedAt: 0,
});

let state = loadLocal();
let pin = localStorage.getItem(PIN_KEY) || '';
let syncTimer = null;

// ====== 工具 ======
function todayStr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultState(), ...JSON.parse(raw) } : defaultState();
  } catch { return defaultState(); }
}
function saveLocal() {
  state.updatedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleSync();
}
async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function dailyReset() {
  const today = todayStr();
  if (state.balance.lastResetDate !== today) {
    state.balance.today = 0;
    state.balance.lastResetDate = today;
    state.tasks.forEach(t => { if (t.limitMode === 'daily') t.doneToday = 0; });
    saveLocal();
  }
}

// 每 15 秒 pull + 切回前景時 pull（近即時跨裝置同步）
let pullTimer = null;
function startSyncPolling() {
  if (pullTimer) return;
  pullTimer = setInterval(() => { if (document.visibilityState === 'visible') syncPull(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncPull(); });
}

// ====== Sync ======
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncPush, 800);
}
async function syncPush() {
  if (!pin) return;
  try {
    await fetch(`${SYNC_BASE}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Pin': pin },
      body: JSON.stringify(state),
    });
  } catch (e) {
    console.warn('sync push failed', e);
  }
}
async function syncPull() {
  if (!pin) return;
  try {
    const res = await fetch(`${SYNC_BASE}/state`, { headers: { 'X-Pin': pin } });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.state && data.state.updatedAt > (state.updatedAt || 0)) {
      state = { ...defaultState(), ...data.state };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
    }
  } catch (e) {
    console.warn('sync pull failed', e);
  }
}

// ====== Toast ======
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ====== Confetti ======
function confetti() {
  const root = document.createElement('div');
  root.className = 'confetti';
  const emojis = ['🎉', '✨', '⭐', '💖', '🌟', '🎊'];
  for (let i = 0; i < 30; i++) {
    const s = document.createElement('span');
    s.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    s.style.left = `${Math.random() * 100}%`;
    s.style.animationDelay = `${Math.random() * 0.5}s`;
    s.style.animationDuration = `${1 + Math.random()}s`;
    root.appendChild(s);
  }
  document.body.appendChild(root);
  setTimeout(() => root.remove(), 2500);
}

// ====== Modal ======
// close() 只移除 backdrop，不會觸發 onClose（onClose 只在使用者主動取消時才跑：按 × 或點背景）。
function showModal({ title, content, center = false, onClose = null }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop' + (center ? ' center' : '');
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.position = 'relative';
  modal.innerHTML = `
    <button class="close" aria-label="close">×</button>
    ${title ? `<h2>${title}</h2>` : ''}
    <div class="modal-body"></div>
  `;
  modal.querySelector('.modal-body').appendChild(content);
  let closed = false;
  const dismiss = () => { if (closed) return; closed = true; backdrop.remove(); if (onClose) onClose(); };
  modal.querySelector('.close').onclick = dismiss;
  backdrop.onclick = (e) => { if (e.target === backdrop) dismiss(); };
  backdrop.appendChild(modal);
  root.appendChild(backdrop);
  return {
    close: () => { if (!closed) { closed = true; backdrop.remove(); } },
    body: modal.querySelector('.modal-body'),
  };
}

// ====== PIN keypad ======
function showPinPad({ title, length = 4, onComplete }) {
  let entered = '';
  let busy = false;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="pin-display">
      ${Array(length).fill(0).map(() => '<div class="pin-dot"></div>').join('')}
    </div>
    <div class="keypad"></div>
  `;
  const dots = () => wrap.querySelectorAll('.pin-dot');
  const updateDots = () => dots().forEach((d, i) => d.classList.toggle('filled', i < entered.length));
  const shakeDots = () => { dots().forEach(d => { d.classList.add('error'); setTimeout(() => d.classList.remove('error'), 350); }); };

  const keypad = wrap.querySelector('.keypad');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  keys.forEach(k => {
    const b = document.createElement('button');
    b.className = 'key-btn' + (!k || k === '⌫' ? ' special' : '');
    b.textContent = k;
    if (!k) b.style.visibility = 'hidden';
    b.onclick = async () => {
      if (busy) return;
      if (k === '⌫') {
        entered = entered.slice(0, -1);
      } else if (k && entered.length < length) {
        entered += k;
      }
      updateDots();
      if (entered.length === length) {
        busy = true;
        const ok = await onComplete(entered);
        if (ok === false) {
          shakeDots();
          setTimeout(() => { entered = ''; updateDots(); busy = false; }, 400);
        } else {
          // success path — reset for potential next stage
          entered = '';
          updateDots();
          busy = false;
        }
      }
    };
    keypad.appendChild(b);
  });
  return wrap;
}

// ====== WebAuthn (Face ID) ======
async function tryWebAuthnRegister() {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: '喬喬集點屋', id: location.hostname },
        user: { id: userId, name: 'celeste', displayName: '喬喬' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000,
      },
    });
    if (!cred) return null;
    return btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
  } catch (e) {
    console.warn('WebAuthn register failed', e);
    return null;
  }
}
async function tryWebAuthnVerify() {
  if (!state.auth.webauthnCredId) return false;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credIdBytes = Uint8Array.from(atob(state.auth.webauthnCredId), c => c.charCodeAt(0));
    await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: 'public-key', id: credIdBytes, transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return true;
  } catch (e) {
    console.warn('WebAuthn verify failed', e);
    return false;
  }
}

// ====== Auth gate（Face ID 或 PIN） ======
async function authenticate(label = '請驗證身份') {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (ok) => { if (resolved) return; resolved = true; resolve(ok); };

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <p style="text-align:center;color:var(--muted);font-size:13px;margin-bottom:16px;">${label}</p>
      <button class="btn btn-primary btn-block" id="faceid-btn" style="margin-bottom:12px;">
        <span style="font-size:20px">😊</span> 用 Face ID
      </button>
      <p style="text-align:center;color:var(--muted);font-size:12px;margin:14px 0 8px;">或輸入密碼</p>
    `;
    const pad = showPinPad({
      length: 4,
      onComplete: async (entered) => {
        const hash = await sha256(entered);
        if (hash === state.auth.pinHash) {
          modal.close();
          finish(true);
          return true;
        }
        return false;
      },
    });
    wrap.appendChild(pad);

    const modal = showModal({
      title: '🔐 驗證',
      content: wrap,
      center: true,
      onClose: () => finish(false),
    });

    const fbtn = wrap.querySelector('#faceid-btn');
    if (!state.auth.webauthnCredId) fbtn.style.display = 'none';
    fbtn.onclick = async () => {
      const ok = await tryWebAuthnVerify();
      if (ok) { modal.close(); finish(true); }
      else toast('Face ID 失敗，改用密碼吧', 'error');
    };
    // 不自動觸發 Face ID（iOS 必須使用者手勢；自動跳出會被擋）
  });
}

// ====== 初始設定（首次開啟） ======
async function setupFirstTime() {
  return new Promise((resolve) => {
    let stage = 'pin1';
    let firstPin = '';

    const wrap = document.createElement('div');
    const intro = document.createElement('p');
    intro.style.cssText = 'text-align:center;color:var(--muted);font-size:14px;margin-bottom:6px;';
    intro.textContent = '請設定 4 位數密碼';
    wrap.appendChild(intro);
    const pad = showPinPad({
      length: 4,
      onComplete: async (entered) => {
        if (stage === 'pin1') {
          firstPin = entered;
          stage = 'pin2';
          intro.textContent = '再輸入一次確認';
          return true;
        }
        if (stage === 'pin2') {
          if (entered !== firstPin) {
            intro.textContent = '兩次不一樣，再來一次';
            stage = 'pin1';
            return false;
          }
          state.auth.pinHash = await sha256(entered);
          stage = 'syncpin';
          intro.textContent = '設定 4 位數同步 PIN（跨裝置共用，可跟密碼一樣）';
          return true;
        }
        if (stage === 'syncpin') {
          pin = entered;
          localStorage.setItem(PIN_KEY, pin);
          // try to register Face ID
          intro.textContent = '正在嘗試啟用 Face ID...';
          const credId = await tryWebAuthnRegister();
          if (credId) state.auth.webauthnCredId = credId;
          saveLocal();
          modal.close();
          toast(credId ? '✨ Face ID 啟用成功' : '密碼設定完成（Face ID 不支援）', 'success');
          resolve(true);
          return true;
        }
      },
    });
    wrap.appendChild(pad);

    const modal = showModal({ title: '🌸 歡迎來到喬喬集點屋', content: wrap, center: true });
  });
}

// ====== Routing ======
function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '') || 'home';
  return h.split('/');
}
function nav(path) { location.hash = '#/' + path; }

window.addEventListener('hashchange', render);

// ====== Render Pages ======
const app = () => document.getElementById('app');

function render() {
  dailyReset();
  const [page, sub] = currentRoute();
  const root = app();
  root.innerHTML = '';
  if (page === 'home') return renderHome(root);
  if (page === 'tasks') return renderTasks(root);
  if (page === 'shop') return renderShop(root);
  if (page === 'history') return renderHistory(root);
  if (page === 'admin') return renderAdmin(root, sub);
  nav('home');
}

function renderHome(root) {
  root.innerHTML = `
    <div class="app-header"><h1>🌸 喬喬集點屋 🌸</h1></div>
    <div class="balance-card">
      <div class="balance-label">目前點數</div>
      <div class="balance-num"><span class="pop">${state.balance.current}</span></div>
      <div class="balance-meta">
        <div>累積 <b>${state.balance.lifetime}</b></div>
        <div>今天 <b>+${state.balance.today}</b></div>
      </div>
    </div>
    <div class="tabs">
      <button class="tab-btn" data-go="tasks"><span class="emoji">📝</span>任務</button>
      <button class="tab-btn" data-go="shop"><span class="emoji">🎁</span>商店</button>
      <button class="tab-btn" data-go="history"><span class="emoji">📖</span>紀錄</button>
    </div>
    <button class="btn btn-block btn-ghost" id="admin-btn" style="margin-top:24px;">🔐 管理模式</button>
    <div style="position:fixed;bottom:8px;left:0;right:0;text-align:center;font-size:11px;color:var(--muted);opacity:0.6;">
      ${APP_VERSION} · <a href="#" onclick="clearCacheAndReload();return false;" style="color:inherit;">清除快取</a>
    </div>
  `;
  root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => nav(b.dataset.go));
  root.querySelector('#admin-btn').onclick = async () => {
    if (await authenticate('進入管理模式')) nav('admin');
  };
}

function renderTasks(root) {
  const visible = state.tasks.filter(t => !t.archived);
  root.innerHTML = `
    <div class="page-head">
      <button class="back-btn" data-back>← 回家</button>
      <h2>📝 任務</h2>
      <div style="width:60px"></div>
    </div>
  `;
  if (visible.length === 0) {
    root.innerHTML += `<div class="empty"><div class="emoji">🌷</div><p>還沒有任務喔～</p></div>`;
  } else {
    visible.forEach(t => {
      const dailyMaxed = t.limitMode === 'daily' && t.doneToday >= t.limitN;
      const totalMaxed = t.limitMode === 'total' && t.doneCount >= t.limitN;
      const maxed = dailyMaxed || totalMaxed;
      const remaining = dailyMaxed ? '今天已做完啦 ✅'
        : totalMaxed ? '已完成全部 🎯'
        : t.limitMode === 'daily' ? `今天還能做 ${t.limitN - t.doneToday} 次`
        : t.limitMode === 'total' ? `還剩 ${t.limitN - t.doneCount} 次`
        : `無限次`;
      const card = document.createElement('div');
      card.className = 'action-card';
      card.innerHTML = `
        <div class="action-card-head">
          <div class="card-icon">${t.emoji || '⭐'}</div>
          <div class="card-body">
            <div class="card-title">${escapeHtml(t.name)}</div>
            <div class="card-sub">${remaining}</div>
          </div>
          <div class="card-points">+${t.points}</div>
        </div>
        <button class="btn-go" ${maxed ? 'disabled style="opacity:0.45"' : ''}>${maxed ? '今天先到這～' : '我完成了！ 🎉'}</button>
      `;
      if (!maxed) card.querySelector('.btn-go').onclick = () => completeTask(t.id);
      root.appendChild(card);
    });
  }
  root.querySelector('[data-back]').onclick = () => nav('home');
}

async function completeTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  if (t.limitMode === 'daily' && t.doneToday >= t.limitN) return toast('今天已達上限', 'error');
  if (t.limitMode === 'total' && t.doneCount >= t.limitN) return toast('累積已達上限', 'error');
  if (await authenticate(`確認完成「${t.name}」+${t.points} 點`) === false) return;
  // 加點
  state.balance.current += t.points;
  state.balance.lifetime += t.points;
  state.balance.today += t.points;
  t.doneCount++;
  if (t.limitMode === 'daily') t.doneToday++;
  // 自動消失
  if (t.limitMode === 'total' && t.doneCount >= t.limitN) t.archived = true;
  state.history.unshift({
    id: uid(), ts: Date.now(), type: 'task', delta: t.points, label: t.name, reason: '',
  });
  saveLocal();
  confetti();
  toast(`+${t.points} 點～太棒了！`, 'success');
  render();
}

function renderShop(root) {
  const visible = state.gifts.filter(g => g.status === 'active');
  root.innerHTML = `
    <div class="page-head">
      <button class="back-btn" data-back>← 回家</button>
      <h2>🎁 商店</h2>
      <div style="width:60px"></div>
    </div>
    <div class="balance-card" style="padding:18px">
      <div class="balance-label">妳的點數</div>
      <div class="balance-num" style="font-size:2.5rem">${state.balance.current}</div>
    </div>
  `;
  if (visible.length === 0) {
    root.innerHTML += `<div class="empty"><div class="emoji">🛍️</div><p>商店還在準備中～</p></div>`;
  } else {
    visible.forEach(g => {
      const affordable = state.balance.current >= g.price;
      const card = document.createElement('div');
      card.className = 'action-card';
      card.innerHTML = `
        ${g.image ? `<img class="gift-image" src="${g.image}" alt="">` : ''}
        <div class="action-card-head">
          <div class="card-body">
            <div class="card-title">${escapeHtml(g.name)}</div>
            <div class="card-sub">${affordable ? '可以兌換 ✨' : `還差 ${g.price - state.balance.current} 點`}</div>
          </div>
          <div class="card-points">${g.price} 點</div>
        </div>
        <button class="btn-go mint" ${affordable ? '' : 'disabled style="opacity:0.5"'}>兌換 🎀</button>
      `;
      card.querySelector('.btn-go').onclick = () => buyGift(g.id);
      root.appendChild(card);
    });
  }
  root.querySelector('[data-back]').onclick = () => nav('home');
}

async function buyGift(id) {
  const g = state.gifts.find(x => x.id === id);
  if (!g) return;
  if (state.balance.current < g.price) return toast('點數不夠喔', 'error');
  if (await authenticate(`確認兌換「${g.name}」-${g.price} 點`) === false) return;
  state.balance.current -= g.price;
  state.history.unshift({
    id: uid(), ts: Date.now(), type: 'purchase', delta: -g.price, label: g.name, reason: '',
  });
  saveLocal();
  confetti();
  toast(`兌換成功！記得跟姐姐拿喔～`, 'success');
  render();
}

function renderHistory(root) {
  let filter = 'all';
  function draw() {
    root.innerHTML = `
      <div class="page-head">
        <button class="back-btn" data-back>← 回家</button>
        <h2>📖 紀錄</h2>
        <div style="width:60px"></div>
      </div>
      <div class="chips">
        <button class="chip ${filter==='all'?'active':''}" data-f="all">全部</button>
        <button class="chip ${filter==='task'?'active':''}" data-f="task">任務</button>
        <button class="chip ${filter==='purchase'?'active':''}" data-f="purchase">兌換</button>
        <button class="chip ${filter==='manual'?'active':''}" data-f="manual">手動</button>
      </div>
      <div id="hlist"></div>
    `;
    const list = root.querySelector('#hlist');
    const items = state.history.filter(h => filter === 'all' || h.type === filter);
    if (items.length === 0) {
      list.innerHTML = `<div class="empty"><div class="emoji">📭</div><p>還沒有紀錄</p></div>`;
    } else {
      items.forEach(h => {
        const div = document.createElement('div');
        div.className = 'history-item';
        const emoji = h.type === 'task' ? '⭐' : h.type === 'purchase' ? '🎁' : '✏️';
        const time = new Date(h.ts).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        div.innerHTML = `
          <div class="history-icon ${h.type}">${emoji}</div>
          <div class="history-body">
            <div class="history-label">${escapeHtml(h.label)}</div>
            <div class="history-meta">${time}${h.reason ? ' · ' + escapeHtml(h.reason) : ''}</div>
          </div>
          <div class="history-delta ${h.delta > 0 ? 'plus' : 'minus'}">${h.delta > 0 ? '+' : ''}${h.delta}</div>
        `;
        list.appendChild(div);
      });
    }
    root.querySelectorAll('[data-f]').forEach(c => c.onclick = () => { filter = c.dataset.f; draw(); });
    root.querySelector('[data-back]').onclick = () => nav('home');
  }
  draw();
}

function renderAdmin(root, sub) {
  if (sub === 'tasks') return renderAdminTasks(root);
  if (sub === 'shop') return renderAdminShop(root);
  if (sub === 'balance') return renderAdminBalance(root);
  root.innerHTML = `
    <div class="page-head">
      <button class="back-btn" data-back>← 回家</button>
      <h2>🔐 管理</h2>
      <div style="width:60px"></div>
    </div>
    <div class="admin-grid">
      <button class="admin-tile" data-go="admin/tasks"><span class="emoji">📝</span>任務管理</button>
      <button class="admin-tile" data-go="admin/shop"><span class="emoji">🎁</span>商店管理</button>
      <button class="admin-tile" data-go="admin/balance"><span class="emoji">💰</span>手動加扣</button>
      <button class="admin-tile" data-go="history"><span class="emoji">📖</span>紀錄</button>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="card-row">
        <div class="card-icon">🔑</div>
        <div class="card-body">
          <div class="card-title">同步 PIN</div>
          <div class="card-sub">${pin || '(未設)'}</div>
        </div>
        <button class="btn btn-ghost" id="reset-pin">改</button>
      </div>
    </div>
    <button class="btn btn-block btn-danger" id="reset-app" style="margin-top:24px;">完全重置</button>
  `;
  root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => nav(b.dataset.go));
  root.querySelector('[data-back]').onclick = () => nav('home');
  root.querySelector('#reset-pin').onclick = async () => {
    const newPin = prompt('輸入新的同步 PIN（4-8 位數字）');
    if (newPin && /^\d{4,8}$/.test(newPin)) {
      pin = newPin;
      localStorage.setItem(PIN_KEY, pin);
      toast('已更新');
      render();
      syncPush();
    }
  };
  root.querySelector('#reset-app').onclick = async () => {
    if (!confirm('真的要清除所有資料嗎？此動作無法復原')) return;
    if (await authenticate('確認重置') === false) return;
    localStorage.clear();
    location.reload();
  };
}

function renderAdminTasks(root) {
  root.innerHTML = `
    <div class="page-head">
      <button class="back-btn" data-back>← 回管理</button>
      <h2>📝 任務管理</h2>
      <button class="btn btn-primary" id="add-task" style="padding:8px 14px;font-size:13px;">+ 新增</button>
    </div>
    <div id="tlist"></div>
  `;
  const list = root.querySelector('#tlist');
  state.tasks.forEach(t => {
    const div = document.createElement('div');
    div.className = 'card';
    const status = t.archived ? '<span class="tag disabled">已完成消失</span>' : '';
    div.innerHTML = `
      <div class="card-row">
        <div class="card-icon">${t.emoji || '⭐'}</div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(t.name)} ${status}</div>
          <div class="card-sub">+${t.points} 點 · ${describeLimit(t)}</div>
        </div>
        <button class="btn btn-ghost" data-edit="${t.id}">編輯</button>
      </div>
    `;
    div.querySelector('[data-edit]').onclick = () => taskForm(t);
    list.appendChild(div);
  });
  root.querySelector('#add-task').onclick = () => taskForm(null);
  root.querySelector('[data-back]').onclick = () => nav('admin');
}

function describeLimit(t) {
  if (t.limitMode === 'daily') return `每天 ${t.limitN} 次（已 ${t.doneToday}）`;
  if (t.limitMode === 'total') return `累積 ${t.limitN} 次（已 ${t.doneCount}）`;
  return '無限次';
}

function taskForm(t) {
  const editing = !!t;
  const data = t || { id: uid(), name: '', emoji: '⭐', points: 1, limitMode: 'daily', limitN: 1, doneCount: 0, doneToday: 0, archived: false };
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-row"><label>名稱</label><input id="f-name" value="${escapeAttr(data.name)}" placeholder="例如：整理書桌"></div>
    <div class="form-row"><label>表情</label><input id="f-emoji" value="${escapeAttr(data.emoji)}" placeholder="⭐" maxlength="2"></div>
    <div class="form-row"><label>每次得幾點</label><input id="f-points" type="number" min="1" value="${data.points}"></div>
    <div class="form-row"><label>上限模式</label>
      <select id="f-mode">
        <option value="daily">每天 N 次（每天重置）</option>
        <option value="total">累積 N 次後消失</option>
        <option value="infinite">無限次</option>
      </select>
    </div>
    <div class="form-row" id="limitn-row"><label>N =</label><input id="f-n" type="number" min="1" value="${data.limitN}"></div>
    <button class="btn btn-block btn-primary" id="save">${editing ? '儲存' : '建立'}</button>
    ${editing ? '<button class="btn btn-block btn-danger" id="del" style="margin-top:8px;">刪除</button>' : ''}
  `;
  form.querySelector('#f-mode').value = data.limitMode;
  const updateLimitVisibility = () => {
    form.querySelector('#limitn-row').style.display = form.querySelector('#f-mode').value === 'infinite' ? 'none' : 'block';
  };
  form.querySelector('#f-mode').onchange = updateLimitVisibility;
  updateLimitVisibility();

  const modal = showModal({ title: editing ? '編輯任務' : '新增任務', content: form });

  form.querySelector('#save').onclick = () => {
    const name = form.querySelector('#f-name').value.trim();
    if (!name) return toast('請輸入名稱', 'error');
    data.name = name;
    data.emoji = form.querySelector('#f-emoji').value || '⭐';
    data.points = Math.max(1, parseInt(form.querySelector('#f-points').value) || 1);
    data.limitMode = form.querySelector('#f-mode').value;
    data.limitN = data.limitMode === 'infinite' ? 0 : Math.max(1, parseInt(form.querySelector('#f-n').value) || 1);
    if (data.limitMode === 'total' && data.doneCount >= data.limitN) data.archived = false; // 編輯後可能解除消失
    if (!editing) state.tasks.push(data);
    saveLocal();
    modal.close();
    render();
  };
  if (editing) form.querySelector('#del').onclick = () => {
    if (!confirm('確定刪除？')) return;
    state.tasks = state.tasks.filter(x => x.id !== data.id);
    saveLocal();
    modal.close();
    render();
  };
}

function renderAdminShop(root) {
  root.innerHTML = `
    <div class="page-head">
      <button class="back-btn" data-back>← 回管理</button>
      <h2>🎁 商店管理</h2>
      <button class="btn btn-primary" id="add-gift" style="padding:8px 14px;font-size:13px;">+ 新增</button>
    </div>
    <div id="glist"></div>
  `;
  const list = root.querySelector('#glist');
  state.gifts.forEach(g => {
    const div = document.createElement('div');
    div.className = 'card';
    const tag = g.status === 'active' ? '<span class="tag mint">啟用</span>' :
                g.status === 'disabled' ? '<span class="tag disabled">停用</span>' :
                '<span class="tag disabled">已刪除</span>';
    div.innerHTML = `
      <div class="card-row">
        <div class="card-icon">${g.image ? `<img src="${g.image}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;">` : '🎁'}</div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(g.name)} ${tag}</div>
          <div class="card-sub">${g.price} 點</div>
        </div>
        <button class="btn btn-ghost" data-edit="${g.id}">編輯</button>
      </div>
    `;
    div.querySelector('[data-edit]').onclick = () => giftForm(g);
    list.appendChild(div);
  });
  root.querySelector('#add-gift').onclick = () => giftForm(null);
  root.querySelector('[data-back]').onclick = () => nav('admin');
}

function giftForm(g) {
  const editing = !!g;
  const data = g || { id: uid(), name: '', price: 10, image: '', status: 'active' };
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-row"><label>名稱</label><input id="f-name" value="${escapeAttr(data.name)}" placeholder="例如：小貼紙一張"></div>
    <div class="form-row"><label>價格（點數）</label><input id="f-price" type="number" min="1" value="${data.price}"></div>
    <div class="form-row"><label>圖片（選用）</label><input id="f-image" type="file" accept="image/*"></div>
    <div id="preview-wrap" style="margin-bottom:14px;">${data.image ? `<img src="${data.image}" style="width:100%;border-radius:14px;">` : ''}</div>
    <div class="form-row"><label>狀態</label>
      <select id="f-status">
        <option value="active">啟用（妹妹看得到）</option>
        <option value="disabled">停用（妹妹看不到，保留資料）</option>
      </select>
    </div>
    <button class="btn btn-block btn-primary" id="save">${editing ? '儲存' : '建立'}</button>
    ${editing ? '<button class="btn btn-block btn-danger" id="del" style="margin-top:8px;">刪除</button>' : ''}
  `;
  form.querySelector('#f-status').value = data.status === 'deleted' ? 'disabled' : data.status;

  const modal = showModal({ title: editing ? '編輯獎品' : '新增獎品', content: form });

  form.querySelector('#f-image').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) return toast('圖片太大（請小於 1.5MB）', 'error');
    const dataUrl = await fileToDataUrl(file);
    const compressed = await compressImage(dataUrl, 600);
    data.image = compressed;
    form.querySelector('#preview-wrap').innerHTML = `<img src="${compressed}" style="width:100%;border-radius:14px;">`;
  };

  form.querySelector('#save').onclick = () => {
    const name = form.querySelector('#f-name').value.trim();
    if (!name) return toast('請輸入名稱', 'error');
    data.name = name;
    data.price = Math.max(1, parseInt(form.querySelector('#f-price').value) || 1);
    data.status = form.querySelector('#f-status').value;
    if (!editing) state.gifts.push(data);
    saveLocal();
    modal.close();
    render();
  };
  if (editing) form.querySelector('#del').onclick = () => {
    if (!confirm('確定刪除？此筆資料不會還原')) return;
    state.gifts = state.gifts.filter(x => x.id !== data.id);
    saveLocal();
    modal.close();
    render();
  };
}

function renderAdminBalance(root) {
  root.innerHTML = `
    <div class="page-head">
      <button class="back-btn" data-back>← 回管理</button>
      <h2>💰 手動加扣</h2>
      <div style="width:60px"></div>
    </div>
    <div class="balance-card">
      <div class="balance-label">目前點數</div>
      <div class="balance-num">${state.balance.current}</div>
    </div>
    <div class="form-row">
      <label>變動</label>
      <input id="d-delta" type="number" placeholder="例如 +5 或 -3">
    </div>
    <div class="form-row">
      <label>原因（選填）</label>
      <input id="d-reason" placeholder="例如：補登 / 表現很棒">
    </div>
    <button class="btn btn-block btn-primary" id="apply">套用 🔐</button>
  `;
  root.querySelector('[data-back]').onclick = () => nav('admin');
  root.querySelector('#apply').onclick = async () => {
    const delta = parseInt(root.querySelector('#d-delta').value);
    if (isNaN(delta) || delta === 0) return toast('請輸入變動數字', 'error');
    const reason = root.querySelector('#d-reason').value.trim();
    if (await authenticate(`確認 ${delta > 0 ? '加' : '扣'} ${Math.abs(delta)} 點`) === false) return;
    state.balance.current = Math.max(0, state.balance.current + delta);
    if (delta > 0) {
      state.balance.lifetime += delta;
      state.balance.today += delta;
    }
    state.history.unshift({
      id: uid(), ts: Date.now(), type: 'manual', delta, label: delta > 0 ? '手動加點' : '手動扣點', reason,
    });
    saveLocal();
    toast(`已${delta > 0 ? '加' : '扣'} ${Math.abs(delta)} 點`, 'success');
    render();
  };
}

// ====== Helpers ======
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(file);
  });
}
function compressImage(dataUrl, maxDim) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = height * maxDim / width; width = maxDim; }
        else { width = width * maxDim / height; height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUrl;
  });
}

// ====== Service worker + 強制更新 ======
const APP_VERSION = 'v1.0.6';

function clearCacheAndReload() {
  if (!confirm('清除快取並重新載入？')) return;
  Promise.all([
    'caches' in window ? caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))) : Promise.resolve(),
    'serviceWorker' in navigator ? navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))) : Promise.resolve(),
  ]).then(() => setTimeout(() => location.reload(true), 300));
}
window.clearCacheAndReload = clearCacheAndReload;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // 偵測新版本：每次回到 app 時檢查
    reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(sw);
        }
      });
    });
  }).catch(() => {});
}

function showUpdateBanner(newSw) {
  if (document.getElementById('update-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:var(--pink);color:white;padding:10px 18px;border-radius:24px;font-weight:700;font-size:14px;z-index:3000;box-shadow:0 4px 16px rgba(255,143,168,0.4);cursor:pointer;border:2px solid var(--pink-deep);';
  banner.innerHTML = '✨ 有新版本！點此更新';
  banner.onclick = () => {
    newSw.postMessage('SKIP_WAITING');
    setTimeout(() => location.reload(), 300);
  };
  document.body.appendChild(banner);
}

// ====== Boot ======
(async function boot() {
  if (!state.auth.pinHash) {
    await setupFirstTime();
  } else if (pin) {
    await syncPull();
  }
  render();
  startSyncPolling();
})();
