/* ============================================================
 *  闪卡学习 - 本地卡片记忆学习工具
 *  存储: IndexedDB  交互: SPA + 底部 Tab  答案: 翻转自判
 *  修复：滑动方向/动画速度/页面抖动/只切卡片不重绘
 * ============================================================ */

/* ---------- 1. IndexedDB ---------- */
const DB_NAME = 'FlashCardDB';
const DB_VERSION = 2;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('chapters')) {
        const s = d.createObjectStore('chapters', { keyPath: 'id' });
        s.createIndex('parentId', 'parentId');
        s.createIndex('createdAt', 'createdAt');
      } else {
        const s = req.transaction.objectStore('chapters');
        if (!s.indexNames.contains('parentId')) s.createIndex('parentId', 'parentId');
      }
      if (!d.objectStoreNames.contains('cards')) {
        const s = d.createObjectStore('cards', { keyPath: 'id' });
        s.createIndex('chapterId', 'chapterId');
        s.createIndex('wrongCount', 'wrongCount');
      }
      if (!d.objectStoreNames.contains('settings')) {
        d.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}
function tx(store, mode = 'readonly') { return db.transaction(store, mode).objectStore(store); }
function getAll(store) { return new Promise((res, rej) => { const r = tx(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function get(store, id) { return new Promise((res, rej) => { const r = tx(store).get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function put(store, val) { return new Promise((res, rej) => { const r = tx(store, 'readwrite').put(val); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }
function del(store, id) { return new Promise((res, rej) => { const r = tx(store, 'readwrite').delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }
function clearStore(store) { return new Promise((res, rej) => { const r = tx(store, 'readwrite').clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }

/* ---------- 2. 设置 ---------- */
const defaultSettings = {
  cardsPerSession: 20,
  sortMode: 'due_first',
  darkMode: 'auto',
  version: 2
};
async function getSetting(key) {
  const s = await get('settings', key);
  return s !== undefined ? s.value : defaultSettings[key];
}
async function setSetting(key, value) { await put('settings', { key, value }); }

/* ---------- 3. 工具 ---------- */
function uid(prefix = 'c') { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6); }
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), 2000);
}
function escapeHtml(str) { return String(str == null ? '' : str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s])); }
function renderQuestion(text) { return escapeHtml(text).replace(/___/g, '<span class="blank">_____</span>'); }
function applyTheme() {
  const theme = localStorage.getItem('theme') || 'auto';
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}
async function breadcrumb(nodeId) {
  const parts = [];
  let cur = await get('chapters', nodeId);
  while (cur) { parts.unshift(cur.name); cur = cur.parentId ? await get('chapters', cur.parentId) : null; }
  return parts;
}

/* ---------- 4. 进度条 ---------- */
let _progTimer = null;
function ensureProgressEl() {
  let el = document.getElementById('importProgress');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'importProgress';
  el.className = 'import-progress';
  el.innerHTML = `
    <div class="import-progress-card card">
      <div class="import-progress-title" id="importProgressTitle">导入中…</div>
      <div class="progress-bar"><div class="progress-fill" id="importProgressBar" style="width:0%"></div></div>
      <div class="import-progress-text" id="importProgressText">准备…</div>
    </div>`;
  document.body.appendChild(el);
  return el;
}
function showImportProgress(stage, opts = {}) {
  const el = ensureProgressEl();
  const title = document.getElementById('importProgressTitle');
  const bar = document.getElementById('importProgressBar');
  const text = document.getElementById('importProgressText');
  el.classList.add('show');
  clearTimeout(_progTimer);
  if (stage === 'parse') {
    title.textContent = '📖 解析中…'; bar.style.width = '8%'; text.textContent = '正在解析结构…';
  } else if (stage === 'write') {
    title.textContent = '✍️ 导入中…'; bar.style.width = '20%'; text.textContent = `0 / ${opts.total || '?'} 张卡片`;
  } else if (stage === 'done') {
    title.textContent = '✅ 完成'; bar.style.width = '100%';
    text.textContent = `${opts.nodeCount || 0} 个目录节点，${opts.cardCount || 0} 张卡片已保存`;
  }
}
function updateImportProgress({ done, total }) {
  const el = document.getElementById('importProgress');
  if (!el || !el.classList.contains('show')) return;
  const bar = document.getElementById('importProgressBar');
  const text = document.getElementById('importProgressText');
  const pct = total ? Math.round(done / total * 100) : 0;
  if (bar) bar.style.width = (20 + pct * 0.8) + '%';
  if (text) text.textContent = `${done} / ${total || '?'} 张卡片`;
}
function hideImportProgress() {
  const el = document.getElementById('importProgress');
  if (!el) return;
  _progTimer = setTimeout(() => { el.classList.remove('show'); }, 300);
}

/* ---------- 5. 导入 ---------- */
async function importText(text) {
  showImportProgress('parse');
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  let parsed;
  try { parsed = parseImportText(text); } catch (e) { hideImportProgress(); toast('解析失败：' + e.message); return; }
  hideImportProgress();
  const { tree, stat } = parsed;
  if (!tree.length || stat.cards === 0) { toast('未解析到有效内容（需含 "|答案"）'); return; }
  showImportPreview(tree, '文本导入');
}

async function importTreeBatch(treeNodes, onProgress) {
  const chapters = [], cards = [];
  let nodeCount = 0, cardCount = 0;
  const walk = (nodes, parentId, orderOffset = 0) => {
    nodes.forEach((node, i) => {
      const id = uid('nd');
      chapters.push({ id, name: node.name, level: node.level, parentId, order: orderOffset + i, createdAt: Date.now() });
      nodeCount++;
      for (const c of (node.cards || [])) {
        cards.push({ id: uid('cd'), chapterId: id, question: c.question, answers: c.answers, hint: c.hint || '', correctStreak: 0, wrongCount: 0, lastReviewed: 0, easeFactor: 2.5, flagged: false, tags: [], difficulty: 0 });
        cardCount++;
      }
      walk(node.children || [], id, 0);
    });
  };
  walk(treeNodes, null);

  await new Promise((resolve, reject) => {
    const t = db.transaction(['chapters', 'cards'], 'readwrite');
    const chStore = t.objectStore('chapters');
    const cdStore = t.objectStore('cards');
    for (const ch of chapters) chStore.put(ch);
    let done = 0;
    for (const cd of cards) {
      const req = cdStore.put(cd);
      req.onsuccess = () => { done++; if (onProgress && done % 10 === 0) onProgress(done, cards.length); };
    }
    t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(new Error('写入被中止'));
  });
  if (onProgress) onProgress(cards.length, cards.length);
  return { nodeCount, cardCount };
}

/* ---------- 6. 导出/导入备份 ---------- */
async function exportJSON() {
  const [chapters, cards, settings] = await Promise.all([getAll('chapters'), getAll('cards'), getAll('settings')]);
  const data = { version: 2, chapters, cards, settings, exportedAt: Date.now() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `flashcards-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  toast('备份已导出');
}

async function importJSON(file) {
  try {
    showImportProgress('parse');
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.cards) || !Array.isArray(data.chapters)) { hideImportProgress(); toast('文件格式不正确'); return; }
    if (!Array.isArray(data.settings)) data.settings = [];
    const bad = data.cards.find(c => !c || !c.id || typeof c.question !== 'string' || !Array.isArray(c.answers));
    if (bad) { hideImportProgress(); toast('卡片数据格式有误'); return; }
    await clearStore('cards'); await clearStore('chapters'); await clearStore('settings');
    showImportProgress('write', { total: data.cards.length });
    let done = 0;
    for (const c of data.chapters) await put('chapters', c);
    for (const c of data.cards) { await put('cards', c); done++; if (done % 20 === 0) updateImportProgress({ done, total: data.cards.length }); }
    for (const s of data.settings) await put('settings', s);
    const dm = data.settings.find(s => s.key === 'darkMode');
    if (dm) localStorage.setItem('theme', dm.value);
    showImportProgress('done', { nodeCount: data.chapters.length, cardCount: data.cards.length });
    toast('备份恢复成功');
    currentTab = 'home'; navStack.length = 0;
    await new Promise(r => setTimeout(r, 500)); hideImportProgress(); render();
  } catch (e) { console.error(e); hideImportProgress(); toast('导入失败：' + e.message); }
}

/* ---------- 7. 记忆排序 ---------- */
async function getDueCards(scopeNodeId) {
  const allCards = await getAll('cards');
  let chapterIds = null;
  if (scopeNodeId) chapterIds = await getDescendantIds(scopeNodeId);
  let cards = scopeNodeId ? allCards.filter(c => chapterIds.includes(c.chapterId)) : allCards;
  const mode = await getSetting('sortMode');
  if (mode === 'wrong_first') {
    cards.sort((a, b) => (b.wrongCount - a.wrongCount) || (a.correctStreak - b.correctStreak) || (a.lastReviewed - b.lastReviewed));
  } else if (mode === 'random') {
    cards.sort(() => Math.random() - 0.5);
  } else {
    cards.sort((a, b) => {
      const aw = a.wrongCount > 0 ? 0 : 1; const bw = b.wrongCount > 0 ? 0 : 1;
      if (aw !== bw) return aw - bw;
      const an = a.lastReviewed === 0 ? 0 : 1; const bn = b.lastReviewed === 0 ? 0 : 1;
      if (an !== bn) return an - bn;
      return a.lastReviewed - b.lastReviewed;
    });
  }
  const limit = await getSetting('cardsPerSession');
  return cards.slice(0, limit);
}
async function getDescendantIds(nodeId) {
  const result = [nodeId];
  const all = await getAll('chapters');
  const children = all.filter(c => c.parentId === nodeId);
  for (const child of children) result.push(...await getDescendantIds(child.id));
  return result;
}

/* ---------- 8. 路由 ---------- */
const app = document.getElementById('app');
const headerTitle = document.getElementById('header-title');
let currentTab = 'home';
let navStack = [];
const routes = { home: renderHome, study: renderStudy, wrong: renderWrong, settings: renderSettings };

async function render() {
  applyTheme();
  app.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'page';
  app.appendChild(page);
  const fn = routes[currentTab];
  if (fn) await fn(page);
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentTab));
  const backBtn = document.getElementById('header-back');
  const canBack = (currentTab === 'home' && navStack.length > 0) || (currentTab === 'study' && studyState);
  backBtn.style.display = canBack ? 'block' : 'none';
}

/* ---------- 9. 首页 ---------- */
async function renderHome(page) {
  headerTitle.textContent = '闪卡学习';
  const allChapters = await getAll('chapters');
  const allCards = await getAll('cards');
  const currentParentId = navStack.length ? navStack[navStack.length - 1].id : null;
  const children = allChapters.filter(c => c.parentId === currentParentId).sort((a, b) => {
    if (a.order != null && b.order != null) return a.order - b.order;
    return a.createdAt - b.createdAt;
  });
  const flagged = allCards.filter(c => c.flagged).length;
  const wrong = allCards.filter(c => c.wrongCount > 0).length;

  if (!currentParentId) {
    page.innerHTML = `
      <div class="card text-center">
        <div style="font-size:32px;font-weight:800;color:var(--primary)">${allCards.length}</div>
        <div class="text-sub">总卡片数 · ${countLeafNodes(allChapters)} 个知识点</div>
      </div>
      <div class="card" style="display:flex;gap:16px;text-align:center">
        <div style="flex:1"><div style="font-size:20px;font-weight:700;color:var(--danger)">${wrong}</div><div class="text-sub">待复习错题</div></div>
        <div style="flex:1"><div style="font-size:20px;font-weight:700;color:var(--warning)">${flagged}</div><div class="text-sub">已标记</div></div>
      </div>
      ${wrong > 0 ? `<button class="btn btn-primary btn-block mt8" id="quickWrong">🎯 直接刷错题</button>` : ''}`;
    if (wrong > 0) page.querySelector('#quickWrong').onclick = () => { const cards = allCards.filter(c => c.wrongCount > 0); startStudyWithCards(cards, '错题练习'); };
  }

  if (navStack.length) {
    const crumbs = navStack.map((n, i) => `<span class="crumb ${i === navStack.length - 1 ? 'current' : ''}" data-i="${i}">${escapeHtml(n.name)}</span>`).join('<span class="crumb-sep">›</span>');
    page.insertAdjacentHTML('beforeend', `<div class="breadcrumb"><span class="crumb back-all" id="backAll">🏠</span><span class="crumb-sep">›</span>${crumbs}</div>`);
    page.querySelector('#backAll').onclick = () => { navStack.length = 0; render(); };
    page.querySelectorAll('.crumb[data-i]').forEach(el => { el.onclick = () => { const i = Number(el.dataset.i); if (i < navStack.length - 1) { navStack.length = i + 1; render(); } }; });
  } else {
    page.insertAdjacentHTML('beforeend', `<h2 style="font-size:15px;margin:16px 0 8px;color:var(--text-sub)">📚 目录结构</h2>`);
  }

  if (!children.length) {
    if (!currentParentId) page.insertAdjacentHTML('beforeend', `<div class="empty-state"><div class="empty-icon">📚</div><div>还没有内容，去「设置」导入讲义吧</div></div>`);
    return;
  }

  for (const node of children) {
    const hasChildren = allChapters.some(c => c.parentId === node.id);
    const directCards = allCards.filter(c => c.chapterId === node.id);
    const subCount = countSubCards(node.id, allChapters, allCards);
    const reviewed = countReviewed(node.id, allChapters, allCards);
    const pct = subCount ? Math.round(reviewed / subCount * 100) : 0;
    const icon = node.level === 1 ? '📖' : node.level === 2 ? '📄' : '🔹';
    const div = document.createElement('div');
    div.className = 'card chapter-item';
    div.draggable = true;
    div.dataset.id = node.id;
    div.innerHTML = `
      <div class="chapter-info"><div class="chapter-name">${icon} ${escapeHtml(node.name)}</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="chapter-meta"><span>${subCount} 题</span><span>已学 ${reviewed}</span>${subCount ? `<span>正确率 ${calcAccuracy(node.id, allChapters, allCards)}%</span>` : ''}</div>
      </div>
      <div class="chapter-right">
        ${directCards.length > 0 && hasChildren ? `<button class="mini-study-btn" data-study="1">▶ ${directCards.length}</button>` : ''}
        <span class="chapter-arrow">${hasChildren ? '›' : '▶'}</span>
      </div>`;
    div.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', node.id); div.classList.add('dragging'); });
    div.addEventListener('dragover', e => e.preventDefault());
    div.addEventListener('drop', async e => { e.preventDefault(); const fromId = e.dataTransfer.getData('text/plain'); if (fromId === node.id) return; await reorderChapters(currentParentId, fromId, node.id); render(); });
    div.addEventListener('dragend', () => div.classList.remove('dragging'));
    const studyBtn = div.querySelector('[data-study]');
    if (studyBtn) studyBtn.addEventListener('click', (e) => { e.stopPropagation(); startStudyWithCards(directCards, node.name); });
    div.onclick = () => { if (hasChildren) { navStack.push({ id: node.id, name: node.name, level: node.level }); render(); } else if (directCards.length > 0) { startStudy(node.id); } else toast('该节点下暂无卡片'); };
    page.appendChild(div);
  }
}

async function reorderChapters(parentId, fromId, toId) {
  const all = await getAll('chapters');
  const list = all.filter(c => c.parentId === parentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const from = list.find(c => c.id === fromId);
  const to = list.find(c => c.id === toId);
  if (!from || !to) return;
  const without = list.filter(c => c.id !== fromId);
  const toIdx = without.findIndex(c => c.id === toId);
  without.splice(toIdx, 0, from);
  without.forEach((c, i) => { c.order = i; put('chapters', c); });
}
function countSubCards(nodeId, allChapters, allCards) { const ids = getDescendantIdsSync(nodeId, allChapters); return allCards.filter(c => ids.includes(c.chapterId)).length; }
function countReviewed(nodeId, allChapters, allCards) { const ids = getDescendantIdsSync(nodeId, allChapters); return allCards.filter(c => ids.includes(c.chapterId) && c.lastReviewed > 0).length; }
function calcAccuracy(nodeId, allChapters, allCards) { const ids = getDescendantIdsSync(nodeId, allChapters); const cards = allCards.filter(c => ids.includes(c.chapterId)); if (!cards.length) return 0; const good = cards.reduce((s, c) => s + (c.correctStreak > 0 ? 1 : 0), 0); return Math.round(good / cards.length * 100); }
function getDescendantIdsSync(nodeId, allChapters) { const result = [nodeId]; const children = allChapters.filter(c => c.parentId === nodeId); for (const child of children) result.push(...getDescendantIdsSync(child.id, allChapters)); return result; }
function countLeafNodes(allChapters) { return allChapters.filter(c => c.level === 3).length; }

/* ---------- 10. 刷题（修复版：滑动不抖 + 只切卡片） ---------- */
let studyState = null;

async function startStudy(nodeId) {
  const cards = await getDueCards(nodeId);
  if (!cards.length) { toast('该知识点暂无题目或已全部掌握'); return; }
  const path = await breadcrumb(nodeId);
  studyState = { scopeNodeId: nodeId, path, queue: cards, index: 0, correct: 0, wrong: 0, sessionWrong: [] };
  currentTab = 'study'; render();
}

function startStudyWithCards(cards, title) {
  if (!cards.length) { toast('没有可刷的卡片'); return; }
  studyState = { scopeNodeId: null, path: [title], queue: cards.slice(0, 200), index: 0, correct: 0, wrong: 0, sessionWrong: [] };
  currentTab = 'study'; render();
}

async function renderStudy(page) {
  if (!studyState || !studyState.queue.length) {
    const allCards = await getAll('cards');
    if (allCards.length) { startStudyWithCards(allCards, '全部卡片'); return; }
    headerTitle.textContent = '刷题';
    page.innerHTML = `<div class="empty-state"><div class="empty-icon">🎯</div><div>请先导入讲义，再开始刷题</div></div>`;
    return;
  }

  const { queue, index, correct, wrong, path } = studyState;
  const card = queue[index];
 const progressPct = queue.length ? Math.round((index + 1) / queue.length * 100) : 0;
  const pathStr = (path && path.length) ? path.join(' › ') : '';
  headerTitle.textContent = pathStr.length > 12 ? '…' + pathStr.slice(-12) : (pathStr || '刷题');

  // ★ 首次渲染完整 DOM
  page.innerHTML = `
    <div class="study-container-fixed" id="studyContainer">
      <div class="study-breadcrumb">${escapeHtml(pathStr)}</div>
      <div class="study-progress">
        <div class="study-progress-bar"><div class="study-progress-fill" id="progressFill" style="width:${progressPct}%"></div></div>
        <div class="study-progress-text" id="progressText">${index + 1} / ${queue.length}　✅ ${correct}　❌ ${wrong}</div>
      </div>
      <div class="flashcard-track" id="flashcardTrack">
        <div class="flashcard-slide" id="flashcardSlide">
          ${renderCardInner(card, pathStr)}
        </div>
      </div>
      <div class="judge-btns">
        <button class="judge-btn judge-wrong" id="btnWrong">❌ 记错了</button>
        <button class="judge-btn judge-right" id="btnRight">✅ 记住了</button>
      </div>
    </div>
  `;
  bindStudyEvents();
}

// ★ 只替换卡片内容，不重绘整个页面
function updateCardContent(card) {
  const slideEl = document.getElementById('flashcardSlide');
  if (!slideEl) return;
  const { path } = studyState;
  const pathStr = (path && path.length) ? path.join(' › ') : '';
  slideEl.innerHTML = renderCardInner(card, pathStr);
}

function renderCardInner(card, pathStr) {
  return `
    <div class="flashcard" id="flashcard">
      <div class="flashcard-inner">
        <div class="flashcard-face flashcard-front">
          <div style="font-size:18px;line-height:1.8">${renderQuestion(card.question)}</div>
          <span class="tap-hint">👆 点击查看答案 · 左右滑动切题</span>
        </div>
        <div class="flashcard-face flashcard-back">
          <div class="flashcard-answer">${card.answers.map(a => escapeHtml(a)).join(' / ')}</div>
          ${card.hint ? `<div class="flashcard-hint">提示：${escapeHtml(card.hint)}</div>` : ''}
          <div class="flashcard-chapter">${escapeHtml(pathStr)}</div>
          <button class="flag-btn ${card.flagged ? 'flagged' : ''}" id="flagBtn" style="position:absolute;top:12px;right:12px">${card.flagged ? '⭐' : '☆'}</button>
        </div>
      </div>
    </div>
  `;
}

function updateProgressUI() {
  const { queue, index, correct, wrong } = studyState;
  const fill = document.getElementById('progressFill');
  const text = document.getElementById('progressText');
  if (fill) fill.style.width = queue.length ? Math.round((index + 1) / queue.length * 100) + '%' : '0%';
  if (text) text.textContent = `${index + 1} / ${queue.length}　✅ ${correct}　❌ ${wrong}`;
}

function bindStudyEvents() {
  const track = document.getElementById('flashcardTrack');
  const slideEl = document.getElementById('flashcardSlide');

  // 翻转
  const fc = document.getElementById('flashcard');
  if (fc) {
    fc.onclick = (e) => { if (e.target.id !== 'flagBtn') fc.classList.toggle('flipped'); };
  }

  // 判分
  document.getElementById('btnRight').onclick = () => judgeCard(true);
  document.getElementById('btnWrong').onclick = () => judgeCard(false);

  // 标记
  const flagBtn = document.getElementById('flagBtn');
  if (flagBtn) flagBtn.onclick = async (e) => {
    e.stopPropagation();
    const card = studyState.queue[studyState.index];
    card.flagged = !card.flagged;
    await put('cards', card);
    flagBtn.textContent = card.flagged ? '⭐' : '☆';
    toast(card.flagged ? '已标记' : '已取消标记');
  };

  // ===== 滑动手势 =====
  let startX = 0, startY = 0, isSwiping = false, hasTriggered = false;

  track.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isSwiping = false;
    hasTriggered = false;
    slideEl.style.transition = 'none';
    slideEl.style.transform = 'translateX(0)';
    // ★ 锁死页面
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
  }, { passive: false });

  track.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (!isSwiping && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
      isSwiping = true;
    }

    if (isSwiping) {
      e.preventDefault();
      e.stopPropagation();
      const maxPull = window.innerWidth * 0.35;
      const clamped = Math.max(-maxPull, Math.min(maxPull, dx * 0.65));
      slideEl.style.transform = `translateX(${clamped}px)`;
    }
  }, { passive: false });

  track.addEventListener('touchend', e => {
    // ★ 恢复页面
    document.body.style.overflow = '';
    document.body.style.touchAction = '';

    if (!isSwiping || hasTriggered) {
      slideEl.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
      slideEl.style.transform = 'translateX(0)';
      return;
    }

    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) < 70) {
      slideEl.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
      slideEl.style.transform = 'translateX(0)';
      return;
    }

    hasTriggered = true;
    const slideOutX = dx > 0 ? window.innerWidth : -window.innerWidth;
    slideEl.style.transition = 'transform 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    slideEl.style.transform = `translateX(${slideOutX}px)`;

    setTimeout(() => {
      if (dx > 0) {
        // 右滑 → 上一张
        if (studyState.index > 0) {
          studyState.index--;
          updateCardContent(studyState.queue[studyState.index]);
          updateProgressUI();
          slideEl.style.transition = 'none';
          slideEl.style.transform = `translateX(-${window.innerWidth}px)`;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              slideEl.style.transition = 'transform 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
              slideEl.style.transform = 'translateX(0)';
            });
          });
        } else {
          toast('已经是第一张');
          slideEl.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
          slideEl.style.transform = 'translateX(0)';
        }
      } else {
        // 左滑 → 下一张
        if (studyState.index < studyState.queue.length - 1) {
          studyState.index++;
          updateCardContent(studyState.queue[studyState.index]);
          updateProgressUI();
          slideEl.style.transition = 'none';
          slideEl.style.transform = `translateX(${window.innerWidth}px)`;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              slideEl.style.transition = 'transform 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
              slideEl.style.transform = 'translateX(0)';
            });
          });
        } else {
          toast('已经是最后一张');
          slideEl.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
          slideEl.style.transform = 'translateX(0)';
        }
      }

      // 重新绑定翻转事件
      const newFc = document.getElementById('flashcard');
      if (newFc) {
        newFc.onclick = (e) => { if (e.target.id !== 'flagBtn') newFc.classList.toggle('flipped'); };
      }
      const newFlag = document.getElementById('flagBtn');
      if (newFlag) newFlag.onclick = async (e) => {
        e.stopPropagation();
        const c = studyState.queue[studyState.index];
        c.flagged = !c.flagged;
        await put('cards', c);
        newFlag.textContent = c.flagged ? '⭐' : '☆';
        toast(c.flagged ? '已标记' : '已取消标记');
      };
    }, 430);
  });

  track.addEventListener('touchcancel', () => {
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
    slideEl.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
    slideEl.style.transform = 'translateX(0)';
  });
}

async function judgeCard(remembered) {
  const card = studyState.queue[studyState.index];
  card.lastReviewed = Date.now();
  if (remembered) { card.correctStreak += 1; studyState.correct++; }
  else { card.wrongCount += 1; card.correctStreak = 0; studyState.wrong++; studyState.sessionWrong.push(card.id); }
  await put('cards', card);
  studyState.index++;
  if (studyState.index >= studyState.queue.length) { renderStudyDone(); return; }
  updateCardContent(studyState.queue[studyState.index]);
  updateProgressUI();
}

async function renderStudyDone() {
  const { correct, wrong, scopeNodeId } = studyState;
  const total = correct + wrong;
  const pct = total ? Math.round(correct / total * 100) : 0;
  headerTitle.textContent = '完成';
  app.innerHTML = `
    <div class="page text-center" style="padding-top:40px">
      <div style="font-size:56px">🎉</div>
      <h2 style="margin:16px 0">本轮完成</h2>
      <div class="card">
        <div style="font-size:40px;font-weight:800;color:var(--primary)">${pct}%</div>
        <div class="text-sub">正确率</div>
        <div style="display:flex;justify-content:center;gap:24px;margin-top:12px"><span>✅ ${correct}</span><span>❌ ${wrong}</span><span>共 ${total}</span></div>
      </div>
      <button class="btn btn-primary btn-block mt16" id="againBtn">再刷一轮</button>
      <button class="btn btn-ghost btn-block mt8" id="homeBtn">返回目录</button>
    </div>`;
  document.getElementById('againBtn').onclick = () => { if (scopeNodeId) startStudy(scopeNodeId); else { const cards = (studyState.queue || []).slice(); startStudyWithCards(cards, studyState.path?.[0] || '练习'); } };
  document.getElementById('homeBtn').onclick = () => { currentTab = 'home'; studyState = null; render(); };
}

/* ---------- 11. 错题本 ---------- */
async function renderWrong(page) {
  headerTitle.textContent = '错题本';
  const allCards = await getAll('cards');
  const wrong = allCards.filter(c => c.wrongCount > 0);
  const allChapters = await getAll('chapters');
  const topNodes = allChapters.filter(c => c.level === 1).sort((a, b) => a.createdAt - b.createdAt);
  page.innerHTML = `<div class="text-sub" style="margin-bottom:8px">共 ${wrong.length} 道错题（按错误次数排序）</div>`;
  if (!wrong.length) { page.innerHTML += `<div class="empty-state"><div class="empty-icon">✨</div><div>太棒了，没有错题！</div></div>`; return; }

  const renderGroup = (title, cards, container) => {
    if (!cards.length) return;
    container.insertAdjacentHTML('beforeend', `<h3 class="wrong-group-title">${escapeHtml(title)} <span class="wrong-count">${cards.length}</span></h3>`);
    cards.sort((a, b) => b.wrongCount - a.wrongCount);
    for (const c of cards.slice(0, 10)) {
      const div = document.createElement('div');
      div.className = 'card wrong-card';
      div.innerHTML = `<div class="text-sub" style="margin-bottom:6px">错 ${c.wrongCount} 次</div><div style="font-size:15px;margin-bottom:8px">${renderQuestion(c.question)}</div><div class="flashcard-answer" style="font-size:15px">${c.answers.map(a=>escapeHtml(a)).join(' / ')}</div>`;
      container.appendChild(div);
    }
  };

  if (topNodes.length) {
    for (const top of topNodes) { const ids = getDescendantIdsSync(top.id, allChapters); renderGroup(top.name, wrong.filter(c => ids.includes(c.chapterId)), page); }
    const allTopIds = topNodes.flatMap(n => getDescendantIdsSync(n.id, allChapters));
    renderGroup('其他', wrong.filter(c => !allTopIds.includes(c.chapterId)), page);
  } else {
    wrong.sort((a, b) => b.wrongCount - a.wrongCount);
    for (const c of wrong) {
      const div = document.createElement('div');
      div.className = 'card wrong-card';
      div.innerHTML = `<div class="text-sub" style="margin-bottom:6px">错 ${c.wrongCount} 次</div><div style="font-size:15px;margin-bottom:8px">${renderQuestion(c.question)}</div><div class="flashcard-answer" style="font-size:15px">${c.answers.map(a=>escapeHtml(a)).join(' / ')}</div>`;
      page.appendChild(div);
    }
  }

  const btn = document.createElement('button');
  btn.className = 'btn btn-primary btn-block mt16'; btn.textContent = '只刷全部错题';
  btn.onclick = () => startStudyWithCards(wrong, '错题练习');
  page.appendChild(btn);
}

/* ---------- 12. 设置 ---------- */
async function renderSettings(page) {
  headerTitle.textContent = '设置';
  const darkMode = await getSetting('darkMode');
  const sortMode = await getSetting('sortMode');
  const perSession = await getSetting('cardsPerSession');
  page.innerHTML = `
    <div class="card">
      <h3 style="margin-bottom:12px">📥 导入讲义</h3>
      <p class="text-sub" style="margin-bottom:8px">支持 <b>Word (.docx)</b>、<b>.txt</b>、<b>.json</b> 备份。</p>
      <textarea class="import-area" id="importText" placeholder="粘贴文本格式内容..."></textarea>
      <button class="btn btn-primary btn-block mt8" id="importBtn">解析并预览</button>
      <div class="text-center text-sub mt8">— 或 —</div>
      <button class="btn btn-ghost btn-block" id="fileBtn">选择 .docx / .txt / .json 文件</button>
      <input type="file" class="file-input" id="fileInput" accept=".txt,.json,.docx,text/plain,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
    </div>
    <div class="card">
      <h3 style="margin-bottom:12px">📤 数据备份</h3>
      <button class="btn btn-ghost btn-block" id="exportBtn">导出备份 (JSON)</button>
    </div>
    <div class="card">
      <h3 style="margin-bottom:12px">⚙️ 学习设置</h3>
      <div class="settings-row"><label>每轮题目数</label><input type="number" id="setPerSession" value="${perSession}" min="5" max="200" style="width:80px"></div>
      <div class="settings-row"><label>出题顺序</label><select id="setSort"><option value="due_first" ${sortMode==='due_first'?'selected':''}>错题/未学优先</option><option value="wrong_first" ${sortMode==='wrong_first'?'selected':''}>错误次数优先</option><option value="random" ${sortMode==='random'?'selected':''}>随机</option></select></div>
      <div class="settings-row"><label>主题</label><select id="setDark"><option value="auto" ${darkMode==='auto'?'selected':''}>跟随系统</option><option value="light" ${darkMode==='light'?'selected':''}>亮色</option><option value="dark" ${darkMode==='dark'?'selected':''}>暗色</option></select></div>
    </div>
    <div class="card"><h3 style="margin-bottom:12px">🗑️ 危险区</h3><button class="btn btn-danger btn-block" id="clearBtn">清空所有数据</button></div>`;

  document.getElementById('importBtn').onclick = async () => { const text = document.getElementById('importText').value; if (!text.trim()) { toast('请先粘贴内容'); return; } await importText(text); };
  document.getElementById('fileBtn').onclick = () => document.getElementById('fileInput').click();
  document.getElementById('fileInput').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return; e.target.value = '';
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith('.json')) { await importJSON(file); return; }
      if (name.endsWith('.docx')) { showImportProgress('parse'); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const { tree, stat } = await parseDocx(file); hideImportProgress(); if (!tree.length || stat.cards === 0) { toast('未从 Word 中解析到内容'); return; } showImportPreview(tree, file.name); return; }
      const text = await file.text(); await importText(text);
    } catch (err) { hideImportProgress(); console.error(err); toast('导入失败：' + err.message); }
  };
  document.getElementById('exportBtn').onclick = exportJSON;
  document.getElementById('setPerSession').onchange = async (e) => { await setSetting('cardsPerSession', Number(e.target.value)); toast('已保存'); };
  document.getElementById('setSort').onchange = async (e) => { await setSetting('sortMode', e.target.value); toast('已保存'); };
  document.getElementById('setDark').onchange = async (e) => { localStorage.setItem('theme', e.target.value); await setSetting('darkMode', e.target.value); applyTheme(); };
  document.getElementById('clearBtn').onclick = async () => { if (confirm('确定清空所有数据？此操作不可恢复！建议先导出备份。')) { await clearStore('cards'); await clearStore('chapters'); await clearStore('settings'); toast('已清空'); navStack.length = 0; render(); } };
}

/* ---------- 13. 启动 ---------- */
document.querySelectorAll('.tab').forEach(tab => { tab.onclick = () => { currentTab = tab.dataset.tab; if (currentTab !== 'study') studyState = null; render(); }; });
document.getElementById('header-back').onclick = () => { if (currentTab === 'study') { currentTab = 'home'; studyState = null; render(); } else if (currentTab === 'home' && navStack.length > 0) { navStack.pop(); render(); } };

(async function init() {
  await openDB();
  for (const k of Object.keys(defaultSettings)) { const existing = await get('settings', k); if (existing === undefined) await put('settings', { key: k, value: defaultSettings[k] }); }
  applyTheme(); render();
  if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('SW 注册失败', e); } }
})();
