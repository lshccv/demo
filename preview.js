/* ============================================================
 * 导入预览编辑界面 - 修复版
 * 修复：回车换行保留 / 分段合并不跳回顶部
 * ============================================================ */

let importDraft = null;
let importDraftNodeId = null;
let _draftSeq = 0;
const draftId = (p) => p + '_' + (++_draftSeq);
let _previewKeepIdx = 0;

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
  _previewKeepIdx = 0;
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

/* ===== 核心修复：contenteditable 回车换行保留 ===== */
function editableToText(el) {
  if (!el) return '';
  const html = el.innerHTML;
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/p>/gi, '\n')
    .replace(/<div[^>]*>/gi, '\n')
    .replace(/<\/div>/gi, '')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function renderImportPreview(keepIdx) {
  if (typeof keepIdx === 'number') _previewKeepIdx = keepIdx;

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

  // ★ 关键：渲染后自动滚动到正在编辑的卡片
  requestAnimationFrame(() => {
    const el = document.querySelector(`.draft-card[data-idx="${_previewKeepIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
    const ed = document.querySelector(`.draft-question[data-idx="${_previewKeepIdx}"]`);
    if (ed) ed.focus({ preventScroll: true });
  });
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

  return body + `<button class="btn btn-ghost btn-block mt8" data-action="add-card">+ 添加空白卡片</button>`;
}

function bindPreviewEvents() {
  const overlay = document.getElementById('importPreview');
  if (!overlay) return;

  const backBtn = overlay.querySelector('#previewBack');
  if (backBtn) {
    backBtn.onclick = () => {
      if (confirm('放弃导入？已编辑的内容会丢失。')) {
        importDraft = null;
        overlay.classList.remove('show');
      }
    };
  }

  const confirmBtn = document.getElementById('previewConfirm');
  if (confirmBtn) {
    confirmBtn.onclick = () => { window.doConfirmImport(); };
  }

  const sel = overlay.querySelector('#previewNodeSelect');
  if (sel) sel.onchange = () => { importDraftNodeId = sel.value; _previewKeepIdx = 0; renderImportPreview(); };

  overlay.querySelectorAll('.draft-question').forEach(editor => {
    const idx = Number(editor.dataset.idx);
    editor.addEventListener('input', () => {
      const node = findNodeById(importDraft, importDraftNodeId);
      if (node && node.cards[idx]) {
        node.cards[idx].question = editableToText(editor);
      }
    });
    editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  });

  overlay.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const card = btn.closest('.draft-card');
      const idx = card ? Number(card.dataset.idx) : -1;
      handlePreviewAction(btn.dataset.action, idx);
    };
  });

  overlay.querySelectorAll('.draft-answer-item').forEach(el => {
    el.onclick = () => {
      const card = el.closest('.draft-card');
      undoBlank(Number(card.dataset.idx), Number(el.dataset.ai));
    };
  });
}

function handlePreviewAction(action, idx) {
  if (action === 'blank') doBlank(idx);
  else if (action === 'split') doSplit(idx);
  else if (action === 'merge-up') doMergeUp(idx);
  else if (action === 'delete') doDelete(idx);
  else if (action === 'add-card') doAddCard();
}

function getCaretOffset(container, range) {
  const pre = range.cloneRange();
  pre.selectNodeContents(container);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

function refreshAnswerList(idx) {
  const node = findNodeById(importDraft, importDraftNodeId);
  if (!node || !node.cards[idx]) return;
  const card = node.cards[idx];
  const list = document.querySelector(`.draft-card[data-idx="${idx}"] .draft-answer-list`);
  if (!list) return;
  if (!card.answers.length) {
    list.innerHTML = '<span class="text-sub">（选中题干文字后点"挖空"）</span>';
    return;
  }
  list.innerHTML = card.answers.map((a, ai) =>
    `<span class="draft-answer-item" data-ai="${ai}" title="点击取消挖空">${escapeHtml(a)}</span>`
  ).join('');
  list.querySelectorAll('.draft-answer-item').forEach(el => {
    el.onclick = () => {
      const cardEl = el.closest('.draft-card');
      undoBlank(Number(cardEl.dataset.idx), Number(el.dataset.ai));
    };
  });
}

function doBlank(idx) {
  const node = findNodeById(importDraft, importDraftNodeId);
  if (!node || !node.cards[idx]) return;
  const card = node.cards[idx];
  const editor = document.querySelector(`.draft-question[data-idx="${idx}"]`);
  if (!editor) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) { toast('请先选中要挖空的文字'); return; }
  const range = sel.getRangeAt(0);
  if (range.collapsed || !editor.contains(range.commonAncestorContainer)) {
    toast('请先选中题干中要挖空的文字'); return;
  }
  const text = range.toString();
  if (!text.trim()) { toast('选中的内容为空'); return; }
  range.deleteContents();
  range.insertNode(document.createTextNode('___'));
  card.question = editableToText(editor);
  card.answers.push(text);
  refreshAnswerList(idx);
}

function doSplit(idx) {
  const node = findNodeById(importDraft, importDraftNodeId);
  if (!node || !node.cards[idx]) return;
  const card = node.cards[idx];
  const editor = document.querySelector(`.draft-question[data-idx="${idx}"]`);
  const sel = window.getSelection();
  if (!sel.rangeCount) { toast('请把光标放在要分段的位置'); return; }
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) { toast('请把光标放在题干内'); return; }
  const fullText = editor.textContent;
  const offset = getCaretOffset(editor, range);
  const before = fullText.slice(0, offset).trim();
  const after = fullText.slice(offset).trim();
  if (!before || !after) { toast('请在题干中间分段'); return; }

  const blanksBefore = (before.match(/___/g) || []).length;
  const answersBefore = card.answers.slice(0, blanksBefore);
  const answersAfter = card.answers.slice(blanksBefore);

  card.question = before;
  card.answers = answersBefore;
  node.cards.splice(idx + 1, 0, { id: draftId('cd'), question: after, answers: answersAfter });
  renderImportPreview(idx + 1);
}

function doMergeUp(idx) {
  if (idx <= 0) return;
  const node = findNodeById(importDraft, importDraftNodeId);
  if (!node) return;
  const prev = node.cards[idx - 1];
  const cur = node.cards[idx];
  prev.question = (prev.question + ' ' + cur.question).trim();
  prev.answers = prev.answers.concat(cur.answers);
  node.cards.splice(idx, 1);
  renderImportPreview(idx - 1 < 0 ? 0 : idx - 1);
}

function doDelete(idx) {
  const node = findNodeById(importDraft, importDraftNodeId);
  if (!node) return;
  if (!confirm('删除这张卡片？')) return;
  node.cards.splice(idx, 1);
  renderImportPreview(idx);
}

function doAddCard() {
  const node = findNodeById(importDraft, importDraftNodeId);
  if (!node) return;
  node.cards.push({ id: draftId('cd'), question: '', answers: [] });
  renderImportPreview(node.cards.length - 1);
}

function undoBlank(idx, ai) {
  const node = findNodeById(importDraft, importDraftNodeId);
  if (!node || !node.cards[idx]) return;
  const card = node.cards[idx];
  const answer = card.answers[ai];
  if (answer === undefined) return;
  let count = -1;
  card.question = card.question.replace(/___/g, (m) => {
    count++;
    return count === ai ? answer : m;
  });
  card.answers.splice(ai, 1);
  renderImportPreview(idx);
}

window.doConfirmImport = async function doConfirmImport() {
  if (!importDraft) {
    toast('没有可导入的内容（草稿为空）。请重新导入 Word 文件。');
    return;
  }

  const nodes = flattenNodes(importDraft);
  let totalCards = 0;
  for (const n of nodes) {
    if (n.cards) {
      n.cards = n.cards.filter(c => c.question.trim() && c.answers.length);
      totalCards += n.cards.length;
    }
  }

  if (!totalCards) {
    toast('没有有效卡片（每张卡片需要题干和至少一个答案）');
    return;
  }

  document.getElementById('importPreview').classList.remove('show');

  try {
    showImportProgress('write', { total: totalCards });
    const result = await importTreeBatch(importDraft.children, (done, total) => {
      updateImportProgress({ done, total });
    });
    showImportProgress('done', { nodeCount: result.nodeCount, cardCount: totalCards });

    importDraft = null;
    currentTab = 'home';
    navStack.length = 0;
    await new Promise(r => setTimeout(r, 500));
    hideImportProgress();
    render();
  } catch (e) {
    hideImportProgress();
    toast('导入失败：' + e.message);
    console.error('[doConfirmImport] 错误:', e);
  }
};

setTimeout(() => {
  const btn = document.getElementById('previewConfirm');
  if (btn && !btn.onclick) {
    btn.onclick = () => window.doConfirmImport();
  }
}, 800);
