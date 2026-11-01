/* ============================================================================
 * ui.js —— 构件工厂（锁死文件，请勿改写）
 * ----------------------------------------------------------------------------
 * 为什么要有这个文件：如果每个视图都手写 <div class="card">…，不同人写的
 * 卡片结构一定会有细微差别（少个 hint、padding 用内联样式、KPI 少了进度条）。
 * 统一走这里的工厂函数，产出的 DOM 结构就是同一套。
 *
 * 约定：视图层只允许调用本文件的函数拼装页面，不要自己写 <div class="card">。
 * ========================================================================== */

/* ---------------------------------------------------------------- 基础工具 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function sum(a) { return a.reduce((x, y) => x + y, 0); }
function pct(a, b) { return b ? Math.round(a * 100 / b) : 0; }
function fmt(n) { return (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('zh-CN'); }
function dash(v) { return (v == null || v === '' || v === '无' || v === '未说明') ? '—' : v; }

/* ---------------------------------------------------------------- 公式与富文本 */
/* 公式必须在"换行转 <br>"之前处理完：一旦 $$…$$ 被拆进多个文本节点，
   任何按文本节点匹配的渲染都会失败，页面就会露出原始 TeX。
   所以这里在字符串层面切分，直接调用 KaTeX 的 renderToString。 */
function texHTML(tex, display) {
  const src = String(tex == null ? '' : tex).trim();
  if (!src) return '';
  if (typeof window.katex === 'undefined') {
    return `<span class="mth-err">${esc(src)}</span>`;
  }
  try {
    return `<span class="mth${display ? ' mth-d' : ''}">${
      window.katex.renderToString(src, {
        displayMode: !!display, throwOnError: true, strict: false, output: 'html',
      })}</span>`;
  } catch (e) {
    return `<span class="mth-err" title="公式解析失败：${esc(e && e.message)}">${
      esc(src)}</span>`;
  }
}

/* 富文本：先切公式，再处理换行与加粗。
   支持 $…$ / $$…$$ / \(…\) / \[…\]，其余一律按普通文字转义。 */
function rich(s) {
  const raw = String(s == null ? '' : s);
  if (!raw.trim()) return '';
  const PAT = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;
  let out = '', last = 0, m;
  const plain = t => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  while ((m = PAT.exec(raw))) {
    out += plain(raw.slice(last, m.index));
    const tex = m[1] != null ? m[1] : m[2] != null ? m[2] : m[3] != null ? m[3] : m[4];
    out += texHTML(tex, m[1] != null || m[2] != null);
    last = m.index + m[0].length;
  }
  out += plain(raw.slice(last));
  return out;
}

/** 富文本段落：按空行分段，公式可在段内跨行 */
function richBlocks(s) {
  const raw = String(s == null ? '' : s);
  if (!raw.trim()) return `<p style="color:var(--muted)">（暂无内容）</p>`;
  const chunks = raw.indexOf('$$') >= 0 ? [raw] : raw.split(/\n{2,}/);
  return chunks.map(b => `<p>${rich(b)}</p>`).join('');
}

/* ---------------------------------------------------------------- 版式容器 */
/* 注意：内容容器由骨架里的 <section class="view" id="view"> 提供（含 padding）。
   视图函数直接返回 HTML 片段即可，不要再自己套一层 div。 */

/** 网格：n = 2/3/4/5，对应 CSS 的 .grid.g2 … .g5 */
function grid(n, inner, style) {
  return `<div class="grid g${n}"${style ? ` style="${style}"` : ''}>${inner}</div>`;
}

/** 卡片：标题 + 右侧说明 + 卡体。hint 可省略 */
function card(title, hint, body, opt) {
  const o = opt || {};
  return `<div class="card${o.cls ? ' ' + o.cls : ''}"${o.style ? ` style="${o.style}"` : ''}>
    <div class="card-h"><h3>${esc(title)}</h3>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
      ${o.right ? `<span style="margin-left:auto">${o.right}</span>` : ''}</div>
    <div class="card-b">${body}</div>
  </div>`;
}

/** 通栏卡片（跨满整行，用于表格或长说明） */
function cardWide(title, hint, body) { return card(title, hint, body, { style: 'margin-top:14px' }); }

/** KPI 统计卡：k 标签 / v 主数值 / sub 副说明 / color 进度条颜色 / ratio 0-100 进度 */
function kpi(k, v, sub, color, ratio) {
  return `<div class="card stat">
    <div class="k">${esc(k)}</div>
    <div class="v">${v}${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    <div class="bar"><i style="width:${ratio == null ? 100 : clamp(ratio, 0, 100)}%;background:${color || 'var(--accent)'}"></i></div>
  </div>`;
}

/** 分隔线 */
function sep() { return '<hr class="sep">'; }

/** 空态 */
function emptyBox(msg) { return `<div class="empty">${esc(msg || '当前筛选下无数据')}</div>`; }

/* ---------------------------------------------------------------- 数据小件 */
/** 普通标签。cls 可选：t-topic / t-ok / t-warn / t-bad / t-mute / t-dl */
function tag(text, cls) { return `<span class="tag ${cls || 't-mute'}">${esc(text)}</span>`; }

/** 带色的标签：颜色由数据决定（如分类色、平台色） */
function colorTag(text, color) {
  const c = color || 'var(--muted)';
  return `<span class="tag" style="background:color-mix(in srgb,${c} 12%,transparent);color:${c};border-color:color-mix(in srgb,${c} 28%,transparent)">${esc(text)}</span>`;
}

/** 分数条：0-100 的值 + 迷你进度条 */
function scoreBar(v, color) {
  const val = Number(v) || 0;
  const c = color || (val >= 85 ? 'var(--bad)' : val >= 70 ? 'var(--warn)' : val >= 50 ? 'var(--accent)' : 'var(--muted)');
  return `<span class="score"><span class="v">${Math.round(val)}</span><span class="m"><i style="width:${clamp(val, 0, 100)}%;background:${c}"></i></span></span>`;
}

/** 进度行：标签 + 条 + 右侧数值，用于分布类图表 */
function progRow(label, color, ratio, right) {
  return `<div class="prog-row">
    <span class="lb">${label.indexOf('<i ') === 0 || label.indexOf('<span') === 0 ? label : esc(label)}</span>
    <span class="pb"><i style="width:${clamp(ratio, 0, 100)}%;background:${color || 'var(--accent)'}"></i></span>
    <span class="vv">${esc(right == null ? '' : right)}</span>
  </div>`;
}

/** 带色点的进度行（用于分类分布） */
function progRowDot(label, color, ratio, right) {
  return progRow(`<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:6px"></span>${esc(label)}`, color, ratio, right);
}

/** 难度圆点：1-5 */
function dots(n, max) {
  const m = max || 5;
  let s = '';
  for (let i = 1; i <= m; i++) {
    s += `<i style="display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:2px;background:${i <= n ? 'var(--accent)' : 'var(--line)'}"></i>`;
  }
  return `<span title="${n}/${m}">${s}</span>`;
}

/* ---------------------------------------------------------------- 表格 */
/**
 * 标准表格。
 * head: ['列名', ...] 或 [{t:'列名', w:80, align:'right'}, ...]
 * rows: [[cellHtml, ...], ...]，单元格内容需自行 esc
 */
function table(head, rows, cls) {
  const th = head.map(h => typeof h === 'string'
    ? `<th>${esc(h)}</th>`
    : `<th${h.w ? ` style="width:${h.w}px"` : ''}${h.align ? ` style="text-align:${h.align}"` : ''}>${esc(h.t)}</th>`).join('');
  const tb = rows.length
    ? rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${head.length}">${emptyBox('无记录')}</td></tr>`;
  return `<table class="${cls || 'db'}"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`;
}

/* ---------------------------------------------------------------- 提示块 */
/**
 * 说明/警示块。kind: info(默认) | warn | bad | ok
 * 用于"数据局限""必须注意""关键结论"这类需要在正文里强调的内容。
 */
function note(text, kind) {
  const k = kind || 'info';
  const bar = { info: 'var(--accent)', warn: 'var(--warn)', bad: 'var(--bad)', ok: 'var(--ok)' }[k];
  return `<div style="border-left:2px solid ${bar};padding:2px 0 2px 10px;margin:8px 0;font-size:12px;line-height:1.65;color:var(--ink2)">${text}</div>`;
}

/** 粗体小标题（卡片内的分组标题） */
function subTitle(text) {
  return `<div class="tiny b" style="color:var(--accent);margin:10px 0 4px">${esc(text)}</div>`;
}

/** 键值对列表（详情页用） */
function kvList(pairs, cols) {
  const inner = pairs.map(p => `<div style="display:flex;gap:8px;font-size:12px;padding:3px 0">
      <span class="muted tiny" style="flex:0 0 92px">${esc(p[0])}</span>
      <span style="flex:1;min-width:0">${p[1]}</span></div>`).join('');
  return cols ? grid(cols, inner) : inner;
}

/* ---------------------------------------------------------------- 图表包装 */
/** 图表容器：统一宽度与底部说明，保证所有图表在同一栏宽下渲染 */
function chartBox(svgHtml, caption) {
  return `<div style="width:100%;overflow:hidden">${svgHtml}${caption
    ? `<div class="tiny muted" style="margin-top:6px;line-height:1.6">${esc(caption)}</div>` : ''}</div>`;
}

/* ---------------------------------------------------------- 编号对照块 */
/* S1、S2 这类编号本身不含语义。把对照表放在页面最上方只解决第一屏：
   读到下方"论文 × 环节"矩阵时对照已经出画，读者还得往回翻。
   所以这里做成吸附 + 可拖动，位置在会话内记住（切走再回来仍在原处）。

   items 形如 [{id:'S1', name:'数据采集与配准'}, …]，直接传 CFG.stages 即可。
   opts.key 用于区分同一页面上的多块对照（默认 'default'）。 */
const PIN_POS = {};
let pinInited = false;

function sidLegend(items, opts) {
  const o = opts || {};
  const list = (items || []).filter(x => x && x.id);
  if (!list.length) return '';
  const a = list[0].id, b = list[list.length - 1].id;
  const note = o.note || ('编号对照：本页 ' + a + '—' + b + ' 指下列技术环节' +
    (o.suffix ? '，' + o.suffix : ''));
  return `<div class="sidmap" data-pin="${esc(o.key || 'default')}" data-mode="docked">
      <div class="sidmap-bar" data-pin-drag>
        <span class="sidmap-grip" title="按住拖动：可把对照表拖到任意位置">⠿</span>
        <div class="sidmap-h">${esc(note)}</div>
        <div class="sidmap-acts">
          <button class="sidmap-b" type="button" data-pin-fold title="只留标题行">收起</button>
          <button class="sidmap-b" type="button" data-pin-reset title="回到页面顶部">钉回</button>
        </div>
      </div>
      <div class="sidmap-g">${list.map(s =>
        `<div class="sidmap-i"><b>${esc(s.id)}</b><span>${esc(s.name)}</span></div>`).join('')}</div>
    </div>`;
}

/* 拖动 / 复位 / 收起：一次性装在 [data-pin] 元素上，渲染后由 AFTER_RENDER 调用 */
function pinFloat(el, left, top) {
  const r = el.getBoundingClientRect();
  if (!el._ph) {
    const ph = document.createElement('div');
    ph.className = 'sidmap-ph';
    ph.style.height = Math.round(r.height) + 'px';
    ph.innerHTML = '<span>编号对照已拖到页面上，点卡片里的「钉回」复位</span>';
    el.parentNode.insertBefore(ph, el);
    el._ph = ph;
  }
  el.dataset.mode = 'float';
  el.style.width = Math.round(r.width) + 'px';
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(top) + 'px';
}

function pinDock(el) {
  el.dataset.mode = 'docked';
  el.style.width = ''; el.style.left = ''; el.style.top = '';
  if (el._ph && el._ph.parentNode) el._ph.parentNode.removeChild(el._ph);
  el._ph = null;
}

function pinRemember(el) {
  const k = el.dataset.pin || 'default';
  PIN_POS[k] = {
    mode: el.dataset.mode,
    left: parseFloat(el.style.left) || 0,
    top: parseFloat(el.style.top) || 0,
    folded: el.classList.contains('folded'),
  };
}

function mountPin(el) {
  if (el.dataset.pinBound === '1') return;
  el.dataset.pinBound = '1';
  const k = el.dataset.pin || 'default';
  const saved = PIN_POS[k];
  const bar = el.querySelector('[data-pin-drag]');
  const foldBtn = el.querySelector('[data-pin-fold]');
  const resetBtn = el.querySelector('[data-pin-reset]');

  if (saved && saved.folded) { el.classList.add('folded'); if (foldBtn) foldBtn.textContent = '展开'; }
  if (saved && saved.mode === 'float') {
    const w = el.getBoundingClientRect().width;
    pinFloat(el, clamp(saved.left, 8, Math.max(8, innerWidth - w - 8)),
      clamp(saved.top, 8, Math.max(8, innerHeight - 48)));
  }

  if (foldBtn) foldBtn.addEventListener('click', () => {
    el.classList.toggle('folded');
    foldBtn.textContent = el.classList.contains('folded') ? '展开' : '收起';
    pinRemember(el);
  });
  if (resetBtn) resetBtn.addEventListener('click', () => { pinDock(el); pinRemember(el); });

  if (bar) bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;   // 按钮不参与拖动
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const w = r.width;
    if (el.dataset.mode !== 'float') pinFloat(el, r.left, r.top);
    const sx = e.clientX, sy = e.clientY, ox = r.left, oy = r.top;
    el.classList.add('dragging');
    try { bar.setPointerCapture(e.pointerId); } catch (err) {}

    const move = ev => {
      const nx = clamp(ox + ev.clientX - sx, 6, Math.max(6, innerWidth - w - 6));
      const ny = clamp(oy + ev.clientY - sy, 6, Math.max(6, innerHeight - 44));
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
    };
    const up = () => {
      el.classList.remove('dragging');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      pinRemember(el);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });
}

function mountPins() {
  if (!pinInited) {
    pinInited = true;
    // 窗口变小后浮动态可能落回画外，重新夹一次
    addEventListener('resize', () => {
      document.querySelectorAll('.sidmap[data-mode="float"]').forEach(el => {
        const w = el.getBoundingClientRect().width;
        el.style.left = clamp(parseFloat(el.style.left) || 0, 6, Math.max(6, innerWidth - w - 6)) + 'px';
        el.style.top = clamp(parseFloat(el.style.top) || 0, 6, Math.max(6, innerHeight - 44)) + 'px';
      });
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const el = document.querySelector('.sidmap[data-mode="float"]');
      if (el) { pinDock(el); pinRemember(el); }
    });
  }
  document.querySelectorAll('#view [data-pin]').forEach(mountPin);
}

window.AFTER_RENDER = window.AFTER_RENDER || [];
window.AFTER_RENDER.push(mountPins);

/* 以上为全部可用构件。视图层不得直接写 <div class="card"> / <table> / <svg>。 */
