/* ============================================================
 * 导入预览编辑界面
 * 挖空即答案 / 手动分段 / 合并 / 删除 / 添加
 * ============================================================ */

let importDraft = null;
let importDraftNodeId = null;
let _draftSeq = 0;
const draftId = (p) => p + '_' + (++_draftSeq);

function initDraft(tree) {
  const root = { id: draftId('nd'), level: 0, name: 'root', children: tree, cards: [] };
  const assign = (nodes) => {
    for (const n of nodes) {
      n.id = draftId('nd');
      n.children = n.children || [];
      n.cards = n.cards || [];
      for (const c of n.cards) {
        c.id = draftId('cd');
        if (!Array.isArray(c.answers)) c.answers = [];
        if (typeof c.question !== 'string') c.question = '';
      }
      assign(n.children);
    }
  };
  assign(root.children);
  return root;
}

function findNodeById(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  for (const c of (root.children || [])) {
    const r = findNodeById(c, id);
    if (r) return r;
  }
  return null;
}

function getNodePath(root, id, path = []) {
  if (!root) return null;
  if (root.id === id) return [...path, root.name];
  for (const c of (root.children || [])) {
    const r = getNodePath(c, id, [...path, root.name]);
    if (r) return r;
  }
  return null;
}

function flattenNodes(root, list = []) {
  for (const c of (root.children || [])) { list.push(c); flattenNodes(c, list); }
  return list;
}

function findFirstNodeWithCards(root) {
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.cards && n.cards.length) return n;
      const r = walk(n.children || []);
      if (r) return r;
    }
    return null;
  };
  return walk(root.children);
}

function showImportPreview(tree, sourceName) {
  if (!tree.length) { toast('没有可导入的内容'); return; }
  importDraft = initDraft(tree);
  const first = findFirstNodeWithCards(importDraft) || flattenNodes(importDraft)[0];
  importDraftNodeId = first ? first.id : null;
  renderImportPreview();
  document.getElementById('importPreview').classList.add('show');
}

function ensurePreviewEl() {
  let overlay = document.getElementById('importPreview');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'importPreview';
  overlay.className = 'import-preview';
  document.body.appendChild(overlay);
  return overlay;
}

function renderImportPreview() {
  const overlay = ensurePreviewEl();
  const root = importDraft;
  if (!root) return;
  const nodes = flattenNodes(root);
  const currentNode = findNodeById(root, importDraftNodeId);
  const totalCards = nodes.reduce((s, n) => s + (n.cards ? n.cards.length : 0), 0);

  overlay.innerHTML = `
    <div class="preview-header">
      <button class="preview-back" id="previewBack">‹ 返回</button>
      <h2 class="preview-title">导入预览（${totalCards}）</h2>
      <button class="preview-confirm" id="previewConfirm">确认导入</button>
    </div>
    <div class="preview-body">
      <div class="preview-toolbar">
        <label>知识点</label>
        <select id="previewNodeSelect">
          ${nodes.map(n => {
            const p = getNodePath(root, n.id) || [n.name];
            const label = p.slice(1).join(' › ') || n.name || '(未命名)';
            const cnt = n.cards ? n.cards.length : 0;
            return `<option value="${n.id}" ${n.id === importDraftNodeId ? 'selected' : ''}>${escapeHtml(label)}（${cnt}）</option>`;
          }).join('')}
        </select>
      </div>
      <div class="preview-cards" id="previewCards">
        ${currentNode ? renderCardsHtml(currentNode) : '<div class="empty-state">没有可编辑的知识点</div>'}
      </div>
    </div>
  `;
  bindPreviewEvents();
}

function renderCardsHtml(node) {
  const cards = node.cards || [];
  const body = cards.length ? cards.map((c, i) => `
    <div class="draft-card card" data-idx="${i}">
      <div class="draft-card-header">
        <span class="draft-card-no">#${i + 1}</span>
        <div class="draft-card-actions">
          ${i > 0 ? '<button class="draft-btn" data-action="merge-up">⬆ 合并到上一张</button>' : ''}
          <button class="draft-btn" data-action="delete">🗑 删除</button>
        </div>
      </div>
      <div class="draft-question" contenteditable="true" data-idx="${i}">${escapeHtml(c.question || '')}</div>
      <div class="draft-toolbar">
        <button class="draft-btn" data-action="blank">✂ 挖空选中</button>
        <button class="draft-btn" data-action="split">↓ 在此分段</button>
      </div>
      <div class="draft-answer">
        <span class="draft-answer-label">答案：</span>
        <span class="draft-answer-list">${
          (c.answers && c.answers.length)
            ? c.answers.map((a, ai) => `<span class="draft-answer-item" data-ai="${ai}" title="点击取消挖空">${escapeHtml(a)}</span>`).join('')
            : '<span class="text-sub">（选中题干文字后点"挖空"）</span>'
        }</span>
      </div>
    </div>
  `).join('') : '<div class="empty-state" style="padding:30px 10px">该知识点下暂无卡片</div>';

  return body + `<button class="bt
