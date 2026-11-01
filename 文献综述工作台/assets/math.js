/* ============================================================================
 * math.js —— 把正文里的 LaTeX 公式排版出来（KaTeX 已内联，完全离线）
 * ----------------------------------------------------------------------------
 * 为什么放在锁定层而不是视图层：公式散布在论文详情、方向论证、工程实验室的
 * 数学问题里，如果让每个视图各自调用渲染函数，漏一处就是一处原始 TeX。
 * 这里挂在渲染之后统一扫一遍 DOM，视图层照常输出 $...$ 即可。
 *
 * 支持四种写法（前后各两枚）：
 *   $$ ... $$   行间公式（居中、独占一行）
 *   $ ... $     行内公式
 *   \[ ... \]   行间公式（LaTeX 原生写法）
 *   \( ... \)   行内公式（LaTeX 原生写法）
 *
 * 三条硬约束：
 *   1. 渲染失败不许吞内容 —— KaTeX 报错就把原文原样留下，读者至少还能看到 TeX；
 *   2. 不许重复渲染 —— 已生成的 .katex 子树整棵跳过；
 *   3. 不许碰代码块、输入框、SVG —— 那里出现的 $ 是数据，不是公式。
 * ========================================================================== */
(function () {
  'use strict';
  if (typeof window.katex === 'undefined') return;

  var SKIP = 'script,style,textarea,pre,code,noscript,.katex,.katex-display,[data-nomath]';
  var PAT = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]{1,200}?\$|\\\([\s\S]*?\\\))/g;

  function skip(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.namespaceURI && el.namespaceURI.indexOf('svg') >= 0) return true;
    return !!el.closest(SKIP);
  }

  /* 一段文字切成「普通文字 / 公式」两种片段 */
  function split(text) {
    var out = [], last = 0, m;
    PAT.lastIndex = 0;
    while ((m = PAT.exec(text))) {
      if (m.index > last) out.push({ t: text.slice(last, m.index) });
      var raw = m[0], tex, display;
      if (raw.slice(0, 2) === '$$') { display = true; tex = raw.slice(2, -2); }
      else if (raw.slice(0, 2) === '\\[') { display = true; tex = raw.slice(2, -2); }
      else if (raw.slice(0, 2) === '\\(') { display = false; tex = raw.slice(2, -2); }
      else { display = false; tex = raw.slice(1, -1); }
      out.push({ tex: tex, display: display });
      last = m.index + raw.length;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  }

  function renderOne(part) {
    var wrap = document.createElement(part.display ? 'span' : 'span');
    wrap.className = part.display ? 'mth mth-d' : 'mth';
    try {
      window.katex.render(part.tex.trim(), wrap, {
        displayMode: !!part.display,
        throwOnError: true,
        strict: false,
        trust: false,
        output: 'html',
      });
      return wrap;
    } catch (e) {
      wrap.className = 'mth mth-err';
      wrap.textContent = (part.display ? '$$' : '$') + part.tex + (part.display ? '$$' : '$');
      wrap.title = '公式解析失败：' + (e && e.message ? e.message : e);
      return wrap;
    }
  }

  function run(root) {
    if (!root || !root.isConnected && root !== document.body) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || n.nodeValue.indexOf('$') < 0 && n.nodeValue.indexOf('\\(') < 0
          && n.nodeValue.indexOf('\\[') < 0) return NodeFilter.FILTER_REJECT;
        if (skip(n.parentElement)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var jobs = [], n;
    while ((n = walker.nextNode())) jobs.push(n);
    jobs.forEach(function (node) {
      var parts = split(node.nodeValue);
      if (parts.length < 2) return;           // 没有成对分隔符，原样留着
      var frag = document.createDocumentFragment(), changed = false;
      parts.forEach(function (p) {
        if (p.t != null) { frag.appendChild(document.createTextNode(p.t)); return; }
        frag.appendChild(renderOne(p));
        changed = true;
      });
      if (changed && node.parentNode) node.parentNode.replaceChild(frag, node);
    });
  }

  var pending = null;
  function schedule(root) {
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(function () {
      pending = null;
      run(root || document.getElementById('view') || document.body);
    });
  }

  /* 与 app.core 的钩子对接：每次视图渲染完扫一遍 */
  window.afterRender = function () {
    schedule(document.getElementById('view'));
    var dr = document.getElementById('drawerBody');
    if (dr) schedule(dr);
  };

  /* 抽屉、标签页、筛选面板都是局部重绘，observer 兜住这些路径 */
  function watch() {
    ['view', 'drawerBody'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || !window.MutationObserver) return;
      new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) {
          for (var j = 0; j < ms[i].addedNodes.length; j++) {
            var nd = ms[i].addedNodes[j];
            if (nd.nodeType === 1 && !nd.classList.contains('katex')) { schedule(el); return; }
            if (nd.nodeType === 3) { schedule(el); return; }
          }
        }
      }).observe(el, { childList: true, subtree: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch);
  } else {
    watch();
  }
  window.__renderMath = run;
})();
