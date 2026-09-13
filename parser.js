/* ============================================================
 * 解析模块：文本格式 + Word(.docx)
 * 依赖：全局无（mammoth 通过 CDN 动态加载）
 * ============================================================ */

/* ---------- 文本解析 ----------
 * 支持：
 *   # 第一篇 xxx
 *   ## 第一章 xxx
 *   ### 知识点1 xxx
 *   题干___。|答案1|答案2 / 下一题题干|答案
 * 兼容旧格式 === 章节 ===（按行切分，一行一题）
 */
function parseImportText(text) {
  const lines = text.split(/\r?\n/);
  const root = { level: 0, name: '', children: [], cards: [] };
  let stack = [root];
  let current = root;
  const stat = { headings: 0, cards: 0, ignored: 0 };

  const ensureNode = (level, name) => {
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    const node = { level, name, children: [], cards: [] };
    parent.children.push(node);
    stack.push(node);
    current = node;
  };

  let buf = '';
  const flush = () => {
    const content = buf.trim();
    buf = '';
    if (!content) return;
    const segments = content.includes('/') ? content.split('/') : content.split(/\r?\n/);
    for (const raw of segments) {
      const seg = raw.trim();
      if (!seg) { stat.ignored++; continue; }
      const idx = seg.indexOf('|');
      if (idx === -1) { stat.ignored++; continue; }
      const question = seg.slice(0, idx).trim();
      const answers = seg.slice(idx + 1).split('|').map(s => s.trim()).filter(a => a);
      if (!question || !answers.length) { stat.ignored++; continue; }
      current.cards.push({ question, answers });
      stat.cards++;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    let m = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (m) { flush(); ensureNode(m[1].length, m[2].trim()); stat.headings++; continue; }
    m = line.match(/^===?\s*(.+?)\s*===?$/);
    if (m) { flush(); ensureNode(2, m[1].trim()); stat.headings++; continue; }
    if (!line.includes('|')) { stat.ignored++; continue; }
    buf += line + '\n';
  }
  flush();

  // 兜底：只有题目、没有标题 -> 归入"未分类"
  if (root.cards.length) {
    root.children.unshift({ level: 1, name: '未分类', children: [], cards: root.cards });
    root.cards = [];
  }
  return { tree: root.children, stat };
}

/* ---------- Word(.docx) 解析 ---------- */
let _mammothLoading = null;
function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  if (_mammothLoading) return _mammothLoading;
  _mammothLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js';
    s.onload = () => resolve(window.mammoth);
    s.onerror = () => { _mammothLoading = null; reject(new Error('无法加载 Word 解析库，请检查网络')); };
    document.head.appendChild(s);
  });
  return _mammothLoading;
}

async function parseDocx(file) {
  const mammoth = await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const styleMap = [
    "p[style-name='Heading 1'] => h1:fresh",
    "p[style-name='Heading 2'] => h2:fresh",
    "p[style-name='Heading 3'] => h3:fresh",
    "p[style-name='标题 1'] => h1:fresh",
    "p[style-name='标题 2'] => h2:fresh",
    "p[style-name='标题 3'] => h3:fresh",
  ];
  const result = await mammoth.convertToHtml({ arrayBuffer }, { styleMap });
  return parseHtmlToTree(result.value);
}

function parseHtmlToTree(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = { level: 0, name: '', children: [], cards: [] };
  let stack = [root];
  let current = root;
  const stat = { headings: 0, cards: 0, ignored: 0 };

  const ensureNode = (level, name) => {
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    const node = { level, name, children: [], cards: [] };
    parent.children.push(node);
    stack.push(node);
    current = node;
  };

  const walk = (node) => {
    for (const el of node.children) {
      const tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        ensureNode(Math.min(3, parseInt(tag[1], 10)), el.textContent.trim());
        stat.headings++;
      } else if (tag === 'p' || tag === 'li' || tag === 'td' || tag === 'th') {
        const text = el.textContent.trim();
        if (text) { current.cards.push({ question: text, answers: [] }); stat.cards++; }
      } else if (['ul','ol','div','table','tbody','tr','thead'].includes(tag)) {
        walk(el);
      }
    }
  };
  walk(doc.body);

  if (root.cards.length) {
    root.children.unshift({ level: 1, name: '未分类', children: [], cards: root.cards });
    root.cards = [];
  }
  return { tree: root.children, stat };
}