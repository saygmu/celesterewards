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
  el.className = `toast adult-ui ${type}`;
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
function showModal({ title, content, center = false, onClose = null, className = '' }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop' + (center ? ' center' : '');
  const modal = document.createElement('div');
  modal.className = 'modal' + (className ? ' ' + className : '');
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
    wrap.className = 'adult-ui';
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
      className: 'adult-ui',
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
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <p style="text-align:center;color:var(--muted);font-size:13px;margin-bottom:18px;">妳第一次開這個 app，選一個：</p>
      <button class="btn btn-block btn-primary" id="b-new" style="margin-bottom:10px;">🌸 新建帳號</button>
      <button class="btn btn-block btn-mint" id="b-restore">☁️ 從雲端還原（已用過）</button>
    `;
    const modal = showModal({ title: '歡迎來到喬喬集點屋', content: wrap, center: true, className: 'adult-ui' });
    wrap.querySelector('#b-new').onclick = () => {
      modal.close();
      newAccountFlow().then(resolve);
    };
    wrap.querySelector('#b-restore').onclick = () => {
      modal.close();
      restoreFlow().then((ok) => {
        if (ok) resolve(true);
        else setupFirstTime().then(resolve);
      });
    };
  });
}

async function newAccountFlow() {
  return new Promise((resolve) => {
    let stage = 'pin1';
    let firstPin = '';
    const wrap = document.createElement('div');
    const intro = document.createElement('p');
    intro.style.cssText = 'text-align:center;color:var(--muted);font-size:14px;margin-bottom:6px;';
    intro.textContent = '設定 4 位數密碼（任務 / 兌換時用）';
    wrap.appendChild(intro);
    const pad = showPinPad({
      length: 4,
      onComplete: async (entered) => {
        if (stage === 'pin1') {
          firstPin = entered; stage = 'pin2';
          intro.textContent = '再輸入一次確認';
          return true;
        }
        if (stage === 'pin2') {
          if (entered !== firstPin) {
            intro.textContent = '兩次不一樣，重新輸入';
            stage = 'pin1';
            return false;
          }
          state.auth.pinHash = await sha256(entered);
          stage = 'syncpin';
          intro.textContent = '設定 4 位數同步 PIN（跨裝置共用）';
          return true;
        }
        if (stage === 'syncpin') {
          pin = entered;
          localStorage.setItem(PIN_KEY, pin);
          intro.textContent = '正在嘗試啟用 Face ID...';
          const credId = await tryWebAuthnRegister();
          if (credId) state.auth.webauthnCredId = credId;
          saveLocal();
          modal.close();
          toast(credId ? '✨ Face ID 啟用成功' : '帳號建立完成', 'success');
          resolve(true);
          return true;
        }
      },
    });
    wrap.appendChild(pad);
    const modal = showModal({ title: '🌸 新建帳號', content: wrap, center: true, className: 'adult-ui' });
  });
}

async function restoreFlow() {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    const intro = document.createElement('p');
    intro.style.cssText = 'text-align:center;color:var(--muted);font-size:14px;margin-bottom:6px;';
    intro.textContent = '輸入妳之前用過的同步 PIN';
    wrap.appendChild(intro);
    const pad = showPinPad({
      length: 4,
      onComplete: async (entered) => {
        intro.textContent = '從雲端載入中...';
        try {
          const res = await fetch(`${SYNC_BASE}/state`, { headers: { 'X-Pin': entered } });
          if (!res.ok) throw new Error('not ok');
          const data = await res.json();
          if (!data || !data.state || !data.state.auth || !data.state.auth.pinHash) {
            intro.textContent = '這個 PIN 沒有資料';
            return false;
          }
          state = { ...defaultState(), ...data.state };
          state.auth.webauthnCredId = null;
          pin = entered;
          localStorage.setItem(PIN_KEY, pin);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          intro.textContent = '載入成功！嘗試啟用 Face ID...';
          const credId = await tryWebAuthnRegister();
          if (credId) {
            state.auth.webauthnCredId = credId;
            saveLocal();
          }
          modal.close();
          toast('✨ 從雲端還原成功', 'success');
          resolve(true);
          return true;
        } catch (e) {
          intro.textContent = '雲端連不上或 PIN 錯誤';
          return false;
        }
      },
    });
    wrap.appendChild(pad);
    const modal = showModal({
      title: '☁️ 從雲端還原',
      content: wrap,
      center: true,
      className: 'adult-ui',
      onClose: () => resolve(false),
    });
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
  // 妹妹看的頁面套上 mei-view（用注音圓體）；管理頁不套
  const meiPages = new Set(['home', 'tasks', 'shop', 'history', 'spin']);
  document.body.classList.toggle('mei-view', meiPages.has(page));
  if (page === 'home') return renderHome(root);
  if (page === 'tasks') return renderTasks(root);
  if (page === 'shop') return renderShop(root);
  if (page === 'history') return renderHistory(root);
  if (page === 'spin') return renderSpin(root, sub);
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
      <button class="tab-btn" data-go="spin"><span class="emoji">🎰</span>轉盤</button>
      <button class="tab-btn" data-go="history"><span class="emoji">📖</span>紀錄</button>
    </div>
    <button class="btn btn-block btn-ghost adult-ui" id="admin-btn" style="margin-top:24px;">🔐 管理模式</button>
    <div class="adult-ui" style="position:fixed;bottom:8px;left:0;right:0;text-align:center;font-size:11px;color:var(--muted);opacity:0.6;">
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
      const hasSpinner = t.spinner && t.spinner.enabled;
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
        <button class="btn-go fixed-btn" ${maxed ? 'disabled style="opacity:0.45"' : ''}>${maxed ? '今天先到這～' : `我完成了！+${t.points} 🎉`}</button>
        ${hasSpinner && !maxed ? `<button class="btn-go mint spin-btn">🎰 碰運氣（${t.spinner.min}～${t.spinner.max} 點）</button>` : ''}
      `;
      if (!maxed) card.querySelector('.fixed-btn').onclick = () => completeTask(t.id);
      if (hasSpinner && !maxed) card.querySelector('.spin-btn').onclick = () => nav('spin/' + t.id);
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
  applyTaskPoints(t, t.points, '');
  toast(`+${t.points} 點～太棒了！`, 'success');
}

function applyTaskPoints(t, points, reason) {
  state.balance.current += points;
  state.balance.lifetime += points;
  state.balance.today += points;
  t.doneCount++;
  if (t.limitMode === 'daily') t.doneToday++;
  if (t.limitMode === 'total' && t.doneCount >= t.limitN) t.archived = true;
  state.history.unshift({
    id: uid(), ts: Date.now(), type: 'task', delta: points, label: t.name, reason,
  });
  saveLocal();
  confetti();
  render();
}

function renderSpin(root, taskId) {
  if (!taskId) return renderStandaloneSpin(root);
  const t = state.tasks.find(x => x.id === taskId);
  if (!t || !t.spinner || !t.spinner.enabled) {
    nav('tasks');
    return;
  }
  const dailyMaxed = t.limitMode === 'daily' && t.doneToday >= t.limitN;
  const totalMaxed = t.limitMode === 'total' && t.doneCount >= t.limitN;
  if (dailyMaxed || totalMaxed) { toast('已達上限', 'error'); nav('tasks'); return; }

  const min = t.spinner.min, max = t.spinner.max;
  root.innerHTML = `
    <div class="page-head">
      <button class="back-btn" data-back>← 取消</button>
      <h2>🎰 碰運氣</h2>
      <div style="width:60px"></div>
    </div>
    <div class="action-card" style="text-align:center;padding:32px 20px;">
      <div style="font-size:14px;color:var(--muted);margin-bottom:8px;">${escapeHtml(t.name)}</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:24px;">範圍 ${min} ～ ${max} 點</div>
      <div id="spin-display" style="font-family:'Quicksand',sans-serif;font-weight:700;font-size:7rem;line-height:1;color:var(--pink-deep);margin:24px 0;transition:transform .2s;">?</div>
      <button id="spin-btn" class="btn-go" style="font-size:18px;padding:18px;">🎰 轉！</button>
    </div>
  `;
  root.querySelector('[data-back]').onclick = () => nav('tasks');
  const display = root.querySelector('#spin-display');
  const btn = root.querySelector('#spin-btn');
  let spinning = false;

  btn.onclick = async () => {
    if (spinning) return;
    if (await authenticate(`確認轉「${t.name}」的轉盤`) === false) return;
    spinning = true;
    btn.disabled = true;
    btn.style.opacity = 0.5;
    btn.textContent = '轉動中...';
    const finalValue = Math.floor(Math.random() * (max - min + 1)) + min;
    // 動畫：快速跳數字 → 漸慢 → 停在 finalValue
    const totalDuration = 2400;
    const start = Date.now();
    function tick() {
      const elapsed = Date.now() - start;
      const progress = Math.min(1, elapsed / totalDuration);
      // ease-out 速度
      const interval = 50 + progress * progress * 350;
      if (elapsed < totalDuration) {
        display.textContent = Math.floor(Math.random() * (max - min + 1)) + min;
        display.style.transform = `scale(${1 + Math.sin(elapsed/80)*0.04})`;
        setTimeout(tick, interval);
      } else {
        display.textContent = finalValue;
        display.style.transform = 'scale(1.2)';
        setTimeout(() => { display.style.transform = 'scale(1)'; }, 250);
        showSpinResult(t, finalValue);
      }
    }
    tick();
  };
}

function showSpinResult(t, value) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <p style="text-align:center;font-size:1.2rem;margin-bottom:12px;">
      🎉 妳轉到了 <b style="color:var(--pink-deep);font-family:'Quicksand',sans-serif;font-size:2rem;">+${value}</b> 點！
    </p>
    <p style="text-align:center;color:var(--muted);font-size:13px;margin-bottom:20px;">
      （由「${escapeHtml(t.name)}」轉盤轉出）
    </p>
    <button class="btn btn-block btn-primary" id="claim">收下 ✨</button>
  `;
  const modal = showModal({ title: '🎰 結果', content: wrap, center: true });
  wrap.querySelector('#claim').onclick = () => {
    applyTaskPoints(t, value, `由轉盤轉出（${t.name}）`);
    toast(`+${value} 點 收下啦！`, 'success');
    modal.close();
    nav('tasks');
  };
}

// 獨立轉盤（不綁任務） - 管理用
function renderStandaloneSpin(root) {
  let min = 1, max = 10, reason = '';
  let spinning = false;
  function draw(state2) {
    root.innerHTML = `
      <div class="page-head">
        <button class="back-btn" data-back>← 回家</button>
        <h2>🎰 轉盤</h2>
        <div style="width:60px"></div>
      </div>
      <div class="form-row row-2 adult-ui">
        <label>點數範圍</label>
        <input id="s-min" type="number" min="1" value="${min}" placeholder="最少">
        <input id="s-max" type="number" min="1" value="${max}" placeholder="最多">
      </div>
      <div class="form-row adult-ui">
        <label>原因（選填，會記在紀錄）</label>
        <input id="s-reason" value="${escapeAttr(reason)}" placeholder="例如：今天表現超棒">
      </div>
      <div class="action-card" style="text-align:center;padding:32px 20px;">
        <div id="spin-display" style="font-family:'Quicksand',sans-serif;font-weight:700;font-size:7rem;line-height:1;color:var(--pink-deep);margin:24px 0;transition:transform .2s;">${state2 || '?'}</div>
        <button id="spin-btn" class="btn-go" style="font-size:18px;padding:18px;">🎰 轉！</button>
      </div>
    `;
    root.querySelector('[data-back]').onclick = () => nav('home');
    const minIn = root.querySelector('#s-min');
    const maxIn = root.querySelector('#s-max');
    const reasonIn = root.querySelector('#s-reason');
    minIn.oninput = () => { min = Math.max(1, parseInt(minIn.value) || 1); };
    maxIn.oninput = () => { max = Math.max(min, parseInt(maxIn.value) || min); };
    reasonIn.oninput = () => { reason = reasonIn.value; };

    const display = root.querySelector('#spin-display');
    const btn = root.querySelector('#spin-btn');

    btn.onclick = async () => {
      if (spinning) return;
      const a = Math.max(1, parseInt(minIn.value) || 1);
      const b = Math.max(a, parseInt(maxIn.value) || a);
      const r = reasonIn.value.trim();
      if (await authenticate('確認轉動轉盤') === false) return;
      spinning = true;
      btn.disabled = true; btn.style.opacity = 0.5; btn.textContent = '轉動中...';
      const finalValue = Math.floor(Math.random() * (b - a + 1)) + a;
      const totalDuration = 2400;
      const start = Date.now();
      function tick() {
        const elapsed = Date.now() - start;
        const interval = 50 + (elapsed/totalDuration)**2 * 350;
        if (elapsed < totalDuration) {
          display.textContent = Math.floor(Math.random() * (b - a + 1)) + a;
          display.style.transform = `scale(${1 + Math.sin(elapsed/80)*0.04})`;
          setTimeout(tick, interval);
        } else {
          display.textContent = finalValue;
          display.style.transform = 'scale(1.2)';
          setTimeout(() => { display.style.transform = 'scale(1)'; }, 250);
          showAdminSpinResult(finalValue, r || '由轉盤轉出');
        }
      }
      tick();
    };
  }
  draw();
}

function showAdminSpinResult(value, reason) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <p style="text-align:center;font-size:1.2rem;margin-bottom:12px;">
      🎉 轉到了 <b style="color:var(--pink-deep);font-family:'Quicksand',sans-serif;font-size:2rem;">+${value}</b> 點
    </p>
    <p style="text-align:center;color:var(--muted);font-size:13px;margin-bottom:20px;">原因：${escapeHtml(reason)}</p>
    <button class="btn btn-block btn-primary" id="claim">記下這筆 ✨</button>
    <button class="btn btn-block btn-ghost" id="cancel" style="margin-top:8px;">不要這次（取消）</button>
  `;
  const modal = showModal({ title: '🎰 結果', content: wrap, center: true, className: 'adult-ui' });
  wrap.querySelector('#claim').onclick = () => {
    state.balance.current += value;
    state.balance.lifetime += value;
    state.balance.today += value;
    state.history.unshift({
      id: uid(), ts: Date.now(), type: 'manual', delta: value, label: '轉盤獎勵', reason,
    });
    saveLocal();
    toast(`+${value} 已加上`, 'success');
    modal.close();
    render();
  };
  wrap.querySelector('#cancel').onclick = () => modal.close();
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

function renderHistory(root, fromAdmin = false) {
  // 走 admin/history 路由時 render() 已關掉 mei-view，這裡只切回家鈕文字 / 目標
  let filter = 'all';
  function draw() {
    root.innerHTML = `
      <div class="page-head">
        <button class="back-btn" data-back>← ${fromAdmin ? '回管理' : '回家'}</button>
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
    root.querySelector('[data-back]').onclick = () => nav(fromAdmin ? 'admin' : 'home');
  }
  draw();
}

function renderAdmin(root, sub) {
  if (sub === 'tasks') return renderAdminTasks(root);
  if (sub === 'shop') return renderAdminShop(root);
  if (sub === 'balance') return renderAdminBalance(root);
  if (sub === 'spin') return renderStandaloneSpin(root);
  if (sub === 'history') return renderHistory(root, true);
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
      <button class="admin-tile" data-go="admin/history"><span class="emoji">📖</span>紀錄</button>
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
    <button class="btn btn-block btn-ghost" id="logout" style="margin-top:24px;">🚪 登出（資料留在雲端）</button>
    <button class="btn btn-block btn-danger" id="wipe-all" style="margin-top:8px;font-size:13px;">⚠️ 清除雲端資料（不可復原）</button>
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
  root.querySelector('#logout').onclick = async () => {
    if (!confirm('登出後本機資料會清空，但雲端資料保留。下次開啟可選「從雲端還原」。')) return;
    if (await authenticate('確認登出') === false) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PIN_KEY);
    location.reload();
  };
  root.querySelector('#wipe-all').onclick = async () => {
    if (!confirm('⚠️ 這會清掉本機 + 雲端的所有資料，無法復原。確定？')) return;
    if (await authenticate('確認清除全部') === false) return;
    // 推一個 null state 上去等同清空（worker 不支援 DELETE，直接寫空）
    try {
      if (pin) await fetch(`${SYNC_BASE}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Pin': pin },
        body: JSON.stringify(defaultState()),
      });
    } catch {}
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
          <div class="card-sub">+${t.points} 點 · ${describeLimit(t)}${t.spinner && t.spinner.enabled ? ` · 🎰 ${t.spinner.min}~${t.spinner.max}` : ''}</div>
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
  const data = t || { id: uid(), name: '', emoji: '⭐', points: 1, limitMode: 'daily', limitN: 1, doneCount: 0, doneToday: 0, archived: false, spinner: null };
  if (!data.spinner) data.spinner = { enabled: false, min: 1, max: 10 };
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-row"><label>名稱</label><input id="f-name" value="${escapeAttr(data.name)}" placeholder="例如：整理書桌"></div>
    <div class="form-row"><label>表情</label><input id="f-emoji" value="${escapeAttr(data.emoji)}" placeholder="⭐" maxlength="2"></div>
    <div class="form-row"><label>每次得幾點（固定）</label><input id="f-points" type="number" min="1" value="${data.points}"></div>
    <div class="form-row"><label>上限模式</label>
      <select id="f-mode">
        <option value="daily">每天 N 次（每天重置）</option>
        <option value="total">累積 N 次後消失</option>
        <option value="infinite">無限次</option>
      </select>
    </div>
    <div class="form-row" id="limitn-row"><label>N =</label><input id="f-n" type="number" min="1" value="${data.limitN}"></div>

    <div class="form-row" style="border-top:1px dashed var(--border);padding-top:14px;margin-top:14px;">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
        <input id="f-spin-on" type="checkbox" ${data.spinner.enabled ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--pink-deep);">
        <span>🎰 加上「碰運氣轉盤」選項</span>
      </label>
      <div style="font-size:12px;color:var(--muted);margin-top:4px;">開啟後妹妹完成這個任務時可以挑「拿固定點」或「轉看看」</div>
    </div>
    <div class="form-row row-2" id="spin-range-row">
      <label>轉盤點數範圍</label>
      <input id="f-spin-min" type="number" min="1" value="${data.spinner.min}" placeholder="最少">
      <input id="f-spin-max" type="number" min="1" value="${data.spinner.max}" placeholder="最多">
    </div>

    <button class="btn btn-block btn-primary" id="save">${editing ? '儲存' : '建立'}</button>
    ${editing ? '<button class="btn btn-block btn-danger" id="del" style="margin-top:8px;">刪除</button>' : ''}
  `;
  form.querySelector('#f-mode').value = data.limitMode;
  const updateLimitVisibility = () => {
    form.querySelector('#limitn-row').style.display = form.querySelector('#f-mode').value === 'infinite' ? 'none' : 'block';
  };
  form.querySelector('#f-mode').onchange = updateLimitVisibility;
  updateLimitVisibility();

  const updateSpinVisibility = () => {
    form.querySelector('#spin-range-row').style.display = form.querySelector('#f-spin-on').checked ? 'grid' : 'none';
  };
  form.querySelector('#f-spin-on').onchange = updateSpinVisibility;
  updateSpinVisibility();

  const modal = showModal({ title: editing ? '編輯任務' : '新增任務', content: form, className: 'adult-ui' });

  form.querySelector('#save').onclick = () => {
    const name = form.querySelector('#f-name').value.trim();
    if (!name) return toast('請輸入名稱', 'error');
    data.name = name;
    data.emoji = form.querySelector('#f-emoji').value || '⭐';
    data.points = Math.max(1, parseInt(form.querySelector('#f-points').value) || 1);
    data.limitMode = form.querySelector('#f-mode').value;
    data.limitN = data.limitMode === 'infinite' ? 0 : Math.max(1, parseInt(form.querySelector('#f-n').value) || 1);
    if (data.limitMode === 'total' && data.doneCount >= data.limitN) data.archived = false;

    const spinOn = form.querySelector('#f-spin-on').checked;
    const sMin = Math.max(1, parseInt(form.querySelector('#f-spin-min').value) || 1);
    const sMax = Math.max(sMin, parseInt(form.querySelector('#f-spin-max').value) || sMin);
    data.spinner = { enabled: spinOn, min: sMin, max: sMax };

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

  const modal = showModal({ title: editing ? '編輯獎品' : '新增獎品', content: form, className: 'adult-ui' });

  form.querySelector('#f-image').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return toast('圖片太大（請小於 15MB）', 'error');
    try {
      const compressed = await compressImage(file, 800);
      data.image = compressed;
      form.querySelector('#preview-wrap').innerHTML = `<img src="${compressed}" style="width:100%;border-radius:14px;">`;
    } catch (err) {
      toast('圖片處理失敗：' + err.message, 'error');
    }
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
async function compressImage(fileOrDataUrl, maxDim) {
  // 用 createImageBitmap 確保 EXIF 旋轉正確（橫式照片不會跑掉）
  let bitmap;
  try {
    if (typeof fileOrDataUrl === 'string') {
      const blob = await (await fetch(fileOrDataUrl)).blob();
      bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } else {
      bitmap = await createImageBitmap(fileOrDataUrl, { imageOrientation: 'from-image' });
    }
  } catch (e) {
    // fallback：用 Image
    return new Promise((resolve, reject) => {
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
      img.onerror = () => reject(new Error('image load failed'));
      if (typeof fileOrDataUrl === 'string') img.src = fileOrDataUrl;
      else { const r = new FileReader(); r.onload = () => (img.src = r.result); r.readAsDataURL(fileOrDataUrl); }
    });
  }
  let { width, height } = bitmap;
  if (width > maxDim || height > maxDim) {
    if (width > height) { height = height * maxDim / width; width = maxDim; }
    else { width = width * maxDim / height; height = maxDim; }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

// ====== Service worker + 強制更新 ======
const APP_VERSION = 'v1.0.24';

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
  banner.className = 'adult-ui';
  banner.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top, 0px) + 12px);left:50%;transform:translateX(-50%);background:var(--pink);color:white;padding:10px 18px;border-radius:24px;font-weight:700;font-size:14px;z-index:3000;box-shadow:0 4px 16px rgba(255,143,168,0.4);cursor:pointer;border:2px solid var(--pink-deep);';
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
