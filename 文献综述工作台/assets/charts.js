/* ============================================================================
 * charts.js —— 通用 SVG 图表引擎（锁死文件，请勿改写）
 * ----------------------------------------------------------------------------
 * 这是本规范的视觉基线。所有图表必须由本文件生成，不允许手写 SVG、
 * 不允许引用外部图表库（ECharts/Chart.js/D3 等），不允许用图片代替。
 * 原因：只有同一份渲染代码才能保证不同人、不同项目的产出在像素级一致。
 *
 * 可用函数（签名详见函数上方注释）：
 *   svg(w, h, inner, cls)               SVG 画布包装
 *   niceMax(v)                          刻度取整
 *   chartStack(data, opt)               堆叠柱状图（按年份/分组）
 *   chartDonut(items, opt)              环形图（仅用于互斥单值占比）
 *   chartHBars(items, opt)              横向条形图（多标签分布用这个）
 *   chartScatter(points, opt)           散点图
 *   chartHeat(rows, cols, opt)          简单热力网格
 *   squarify(items, W, H)               矩形树图布局算法
 *   textW(s, fs)                        单行文字宽度估算
 *   chartTreemap(items, opt)            矩形树图
 *   chartSankey(sk, opt)                三级桑基图
 *   heatMatrix(rows, cols, getV, opt)   带表头的交叉热力矩阵
 *   chartScatterDS(points, opt)         双指标四象限散点
 * ========================================================================== */

function svg(vbw, vbh, inner, extra) {
  return `<svg class="chart ${extra || ''}" viewBox="0 0 ${vbw} ${vbh}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}
function niceMax(v) {
  if (v <= 5) return 5;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / p * 2) / 2 * p;
}

/* ------------------------------------------------------------------ 默认色板
 * 分类色必须区分得开 —— 一张饼图如果全画成同一种灰，读者根本分不出哪块是哪个主题，
 * 图表就退化成一张装饰图。config 里每个 topic 建议自带 color；但一旦作者忘了写，
 * 图表不能因此变成单色（V4.7：曾出现过"主题构成环形图全灰"的事故）。
 * 所以这里的规则是：显式 color > 按序取色板。
 * 这八色在明暗两种主题下都经得起对比度检查，且色相间距足够大，不靠明度区分。
 */
const SERIES = ['#2f6feb', '#0e9c9c', '#c0392b', '#d97706', '#6b4bbd', '#8d9db2', '#3f7d20', '#b8468a'];
function seriesColor(i) {
  // V4.9：config.layout.palette（build 注入成 window.CHART_PALETTE）优先，否则用默认 SERIES
  const P = (typeof window !== 'undefined' && Array.isArray(window.CHART_PALETTE)
             && window.CHART_PALETTE.length) ? window.CHART_PALETTE : SERIES;
  return P[((i % P.length) + P.length) % P.length];
}
if (typeof window !== 'undefined') window.SERIES = SERIES;

/** 堆叠柱状图：data = [{label, parts:[{k,v,c}]}] */
function chartStack(data, opt = {}) {
  const W = opt.w || 660, H = opt.h || 230, pl = 34, pr = 8, pt = 12, pb = 32;
  const iw = W - pl - pr, ih = H - pt - pb;
  const max = niceMax(Math.max(1, ...data.map(d => sum(d.parts.map(x => x.v)))));
  const bw = Math.min(46, iw / Math.max(1, data.length) * 0.62);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const y = pt + ih - ih * i / 4;
    g += `<line class="grid-l" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/>`;
    g += `<text class="axis" x="${pl - 6}" y="${y + 3}" text-anchor="end">${Math.round(max * i / 4)}</text>`;
  }
  const step = iw / Math.max(1, data.length);
  data.forEach((d, i) => {
    const cx = pl + step * (i + 0.5);
    let y0 = pt + ih;
    const tot = sum(d.parts.map(x => x.v));
    d.parts.forEach(p => {
      if (!p.v) return;
      const hh = ih * p.v / max;
      y0 -= hh;
      g += `<rect class="bar" data-act="${opt.act || ''}" data-val="${esc(d.label)}"
        x="${cx - bw / 2}" y="${y0}" width="${bw}" height="${Math.max(0.5, hh)}" rx="2"
        fill="${p.c}" data-tip="${esc(d.label)}｜${esc(p.k)}：${p.v}"><title>${esc(d.label)} ${esc(p.k)} ${p.v}</title></rect>`;
    });
    g += `<text class="axis" x="${cx}" y="${H - pb + 14}" text-anchor="middle">${esc(String(d.label))}</text>`;
    if (tot) g += `<text class="axis" x="${cx}" y="${y0 - 4}" text-anchor="middle" style="fill:var(--ink2);font-weight:600">${tot}</text>`;
  });
  return svg(W, H, g);
}

/** 环形图 */
function chartDonut(items, opt = {}) {
  const size = 220, r = 82, cx = size / 2, cy = size / 2, th = opt.thickness || 26;
  const total = sum(items.map(i => i.v)) || 1;
  let a0 = -Math.PI / 2, g = '';
  items.forEach((it, i) => {
    const a1 = a0 + Math.PI * 2 * it.v / total;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    /* 配色三步走：显式 c > items 自带 code 对应的色板位 > 按序取色板。
       少了最后一步，作者忘写 color 时整张饼图会变成同一个颜色（灰），分块信息全丢。 */
    const c = it.c || seriesColor(i);
    if (it.v > 0) {
      g += `<path d="M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}" fill="none"
        stroke="${c}" stroke-width="${th}" data-tip="${esc(it.k)}：${it.v} 篇（${pct(it.v, total)}%）"
        data-act="${opt.act || ''}" data-val="${esc(it.code || it.k)}" style="cursor:pointer"/>`;
    }
    a0 = a1;
  });
  g += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" style="font-size:26px;font-weight:700;fill:var(--ink)">${total}</text>`;
  g += `<text x="${cx}" y="${cy + 16}" text-anchor="middle" style="font-size:11px;fill:var(--muted)">${esc(opt.centerLabel || '篇')}</text>`;
  return svg(size, size, g, 'donut');
}

/** 横向条形 */
function chartHBars(items, opt = {}) {
  const W = opt.w || 660, rowH = opt.rowH || 26, H = items.length * rowH + 12;
  const max = Math.max(1, ...items.map(i => i.v));
  const lw = opt.labelW || 150;
  let g = '';
  items.forEach((it, i) => {
    const y = 6 + i * rowH;
    const w = (W - lw - 60) * it.v / max;
    /* 条上显示的是给人看的标签（"2025 年"），传给筛选的必须是机器能比的值（"2025"）。
       早期版本直接拿 it.k 当 data-val，导致点年份条永远是 0 篇 —— 标签里混了单位就对不上。
       取值优先级与 chartDonut 保持一致：val 显式指定 > code > k。 */
    const val = it.val != null ? it.val : (it.code != null ? it.code : it.k);
    g += `<text class="axis" x="0" y="${y + 15}" style="fill:var(--ink2);font-size:11.5px">${esc(it.k)}</text>`;
    g += `<rect x="${lw}" y="${y + 5}" width="${Math.max(1, w)}" height="13" rx="3" fill="${it.c || 'var(--accent)'}" opacity=".85"
      data-tip="${esc(it.k)}：${it.v}${opt.unit || ' 篇'}" data-act="${opt.act || ''}" data-val="${esc(val)}" style="cursor:pointer"/>`;
    g += `<text class="axis" x="${lw + Math.max(1, w) + 6}" y="${y + 15}" style="fill:var(--ink2);font-size:11px">${it.v}</text>`;
  });
  return svg(W, H, g, 'hbars');
}

/** 散点：x=相关性 y=难度 半径=学习价值 颜色=主题 */
function chartScatter(points, opt = {}) {
  const W = 880, H = 430, pl = 44, pr = 14, pt = 14, pb = 40;
  const iw = W - pl - pr, ih = H - pt - pb;
  const x = v => pl + iw * clamp(v, 0, 100) / 100;
  const y = v => pt + ih - ih * (clamp(v, 1, 5) - 1) / 4;
  let g = '';
  // 四象限底色
  // 高耦合 + 低难度 = 优先开始（右下象限）用强调色浅底标出
  g += `<rect x="${x(72)}" y="${y(3.2)}" width="${x(100) - x(72)}" height="${y(1) - y(3.2)}" fill="color-mix(in srgb,var(--accent) 9%,transparent)"/>`;
  for (let i = 0; i <= 4; i++) {
    const yy = pt + ih * i / 4;
    g += `<line class="grid-l" x1="${pl}" y1="${yy}" x2="${W - pr}" y2="${yy}"/>`;
  }
  for (let i = 0; i <= 4; i++) {
    const xx = pl + iw * i / 4;
    g += `<line class="grid-l" x1="${xx}" y1="${pt}" x2="${xx}" y2="${pt + ih}"/>`;
    g += `<text class="axis" x="${xx}" y="${H - pb + 15}" text-anchor="middle">${i * 25}</text>`;
  }
  for (let d = 1; d <= 5; d++) {
    g += `<text class="axis" x="${pl - 8}" y="${y(d) + 3}" text-anchor="end">${d}</text>`;
  }
  g += `<text class="axis" x="${pl + iw / 2}" y="${H - 8}" text-anchor="middle" style="font-size:11px">项目直接耦合度 →</text>`;
  g += `<text class="axis" transform="translate(11,${pt + ih / 2}) rotate(-90)" text-anchor="middle" style="font-size:11px">阅读难度 →</text>`;
  g += `<text x="${pl + 6}" y="${pt + 13}" style="font-size:10.5px;fill:var(--muted)">低耦合 · 高难度（暂缓）</text>`;
  g += `<text x="${W - pr - 6}" y="${pt + 13}" text-anchor="end" style="font-size:10.5px;fill:var(--muted)">高耦合 · 高难度（先补前置知识）</text>`;
  g += `<text x="${pl + 6}" y="${pt + ih - 5}" style="font-size:10.5px;fill:var(--muted)">低耦合 · 低难度（补充阅读）</text>`;
  g += `<text x="${W - pr - 6}" y="${pt + ih - 5}" text-anchor="end" style="font-size:10.5px;fill:var(--accent);font-weight:600">高耦合 · 低难度（优先开始）</text>`;
  points.forEach((p, i) => {
    const r = 3 + (p.lv - 40) / 60 * 5;
    /* 气泡颜色同上：没有显式色就按序取色板。全灰的气泡图等于没有分类维度。 */
    const c = p.c || seriesColor(i);
    g += `<circle cx="${x(p.rl)}" cy="${y(p.df)}" r="${clamp(r, 3, 9)}" fill="${c}" fill-opacity=".62"
      stroke="${c}" stroke-width="1" style="cursor:pointer"
      data-act="open" data-val="${p.id}" data-tip="${esc(p.t)}<br>耦合 ${p.rl}｜学习价值 ${p.lv}｜难度 ${p.df}｜${esc(p.tp)}"/>`;
  });
  return svg(W, H, g);
}

/** 热力矩阵 */
function chartHeat(rows, cols, opt = {}) {
  let h = '<table class="heat"><thead><tr><th class="rowh">论文</th>';
  cols.forEach(c => { h += `<th>${esc(c.short)}</th>`; });
  h += '</tr></thead><tbody>';
  rows.forEach(r => {
    h += `<tr><th class="rowh" title="${esc(r.title)}"><span data-act="open" data-val="${r.id}" style="cursor:pointer">${esc(r.title.slice(0, 30))}</span></th>`;
    cols.forEach(c => {
      const v = (r.scores || {})[c.id] || 0;
      const a = v <= 0 ? 0 : clamp(0.12 + v / 14, 0.12, 1);
      const txt = v >= 7 ? '●' : v >= 5 ? '◐' : v > 0 ? '·' : '';
      h += `<td style="background:${v > 0 ? `color-mix(in srgb,var(--accent) ${Math.round(a * 100)}%,transparent)` : 'var(--line2)'};color:${a > 0.55 ? '#fff' : 'var(--ink2)'}"
        data-act="open" data-val="${r.id}" data-tip="${esc(r.title.slice(0, 40))}<br>${esc(c.name)}：关联强度 ${v.toFixed(1)}">${txt}</td>`;
    });
    h += '</tr>';
  });
  return h + '</tbody></table>';
}

/* ------------------------------------------------ V2 图表：矩形树图 / 桑基图 / 交叉热力 / 双指标散点 */

/** 平方化树图布局（squarified treemap），输入已按 v 降序 */
function squarify(items, W, H) {
  const res = [];
  const total = sum(items.map(d => d.v));
  if (!total || W <= 0 || H <= 0) return res;
  const nodes = items.map(d => Object.assign({}, d, { a: d.v / total * W * H }));
  let i = 0, rx = 0, ry = 0, rw = W, rh = H;
  const worst = (row, side) => {
    const s = sum(row.map(d => d.a));
    if (!s) return Infinity;
    const mx = Math.max.apply(null, row.map(d => d.a));
    const mn = Math.min.apply(null, row.map(d => d.a)) || 1e-6;
    return Math.max(side * side * mx / (s * s), (s * s) / (side * side * mn));
  };
  while (i < nodes.length && rw > 1 && rh > 1) {
    const side = Math.min(rw, rh);
    const row = [nodes[i]];
    let j = i + 1;
    while (j < nodes.length && worst(row.concat(nodes[j]), side) <= worst(row, side)) {
      row.push(nodes[j]); j++;
    }
    const ra = sum(row.map(d => d.a));
    if (rw >= rh) {
      const cw = ra / rh;
      let oy = ry;
      row.forEach(d => { const dh = d.a / cw; res.push(Object.assign({}, d, { x: rx, y: oy, w: cw, h: dh })); oy += dh; });
      rx += cw; rw -= cw;
    } else {
      const ch = ra / rw;
      let ox = rx;
      row.forEach(d => { const dw = d.a / ch; res.push(Object.assign({}, d, { x: ox, y: ry, w: dw, h: ch })); ox += dw; });
      ry += ch; rh -= ch;
    }
    i = j;
  }
  return res;
}

/** 估算单行文字宽度：中日韩字符按 1 em，其余按 0.56 em */
function textW(s, fs) {
  let w = 0;
  for (const ch of String(s)) {
    w += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? fs : fs * 0.56;
  }
  return w;
}

/** 场景矩形树图：面积=论文数，点击筛选场景 */
function chartTreemap(items, opt = {}) {
  const W = opt.w || 640, H = opt.h || 296;
  const data = items.filter(d => d.v > 0).sort((a, b) => b.v - a.v);
  if (!data.length) return '<div class="empty">当前筛选下无场景数据</div>';
  const total = sum(data.map(d => d.v));
  const rects = squarify(data, W, H);
  const PADL = 9, PADR = 7;
  let g = '';
  rects.forEach(r => {
    const rel = r.v / data[0].v;
    const a = 0.16 + 0.66 * rel;
    const dark = a > 0.5;
    const fg = dark ? '#fff' : 'var(--ink)';
    const fg2 = dark ? 'rgba(255,255,255,.82)' : 'var(--muted)';
    // 标签只做「放得下就完整显示、放不下就不显示」，不做残词截断；
    // 完整信息由 <title> 与 data-tip 承担，避免小块上出现「自然…」这类碎片文字。
    const avail = r.w - PADL - PADR;
    const name = textW(r.k, 11.5) <= avail ? r.k : '';
    const qty = `${r.v} ${opt.unit || '篇'} · ${pct(r.v, total)}%`;
    const qtyFit = textW(qty, 10.5) <= avail;
    g += `<g data-act="${opt.act || 'scene'}" data-val="${esc(r.k)}" style="cursor:pointer"
        data-tip="${esc(r.k)}：${r.v} ${opt.unit || '篇'}（${pct(r.v, total)}%）">
      <rect x="${(r.x + 1.2).toFixed(1)}" y="${(r.y + 1.2).toFixed(1)}"
        width="${Math.max(0, r.w - 2.4).toFixed(1)}" height="${Math.max(0, r.h - 2.4).toFixed(1)}" rx="5"
        fill="${r.c}" fill-opacity="${a.toFixed(2)}" stroke="var(--panel)" stroke-width="1.5"/>
      <title>${esc(r.k)} ${r.v}</title>
      ${name && r.h > 24 ? `<text x="${(r.x + PADL).toFixed(1)}" y="${(r.y + 19).toFixed(1)}"
        style="font-size:11.5px;font-weight:650;fill:${fg};pointer-events:none">${esc(name)}</text>` : ''}
      ${qtyFit && r.h > 42 ? `<text x="${(r.x + PADL).toFixed(1)}" y="${(r.y + 34).toFixed(1)}"
        style="font-size:10.5px;fill:${fg2};pointer-events:none">${esc(qty)}</text>` : ''}
    </g>`;
  });
  return svg(W, H, g, 'treemap');
}

/** 桑基图：三级流（平台 → 场景 → 研究任务），每篇论文在每个维度只计一次 */
function chartSankey(sk, opt = {}) {
  const W = opt.w || 900;
  const nw = 13, pt = 22, pb = 14, pad = 9, labelW = 124;
  const HALO = 'paint-order:stroke;stroke:var(--panel);stroke-width:3.4px;stroke-linejoin:round';
  // 三列的名称映射与配色由调用方传入，引擎本身不认识任何业务名词
  const C0 = opt.color0 || {}, C1 = opt.color1 || {}, C2 = opt.color2 || {};
  const name2 = opt.nameCol2 || (k => k);
  const lv = [[], [], []];
  (sk.c0 || []).forEach(d => lv[0].push({ id: 'p|' + d.k, k: d.k, v: d.v, c: C0[d.k] || 'var(--muted)', act: opt.act0 || 'col0', val: d.k }));
  (sk.c1 || []).forEach(d => lv[1].push({ id: 's|' + d.k, k: d.k, v: d.v, c: C1[d.k] || 'var(--muted)', act: opt.act1 || 'col1', val: d.k }));
  (sk.c2 || []).forEach(d => lv[2].push({ id: 't|' + d.k, k: name2(d.k), v: d.v, c: C2[d.k] || 'var(--accent2)', act: opt.act2 || 'col2', val: d.k }));
  const total = sum(lv[0].map(n => n.v));
  if (!total) return '<div class="empty">当前筛选下无数据</div>';

  const maxLen = Math.max(1, lv[0].length, lv[1].length, lv[2].length);
  const H = opt.h || Math.max(400, Math.min(620, maxLen * 44 + 46));
  const avail = H - pt - pb - pad * (maxLen - 1);
  const scale = avail / total;

  lv.forEach(list => {
    const totH = sum(list.map(n => n.v)) * scale + pad * Math.max(0, list.length - 1);
    let y = pt + Math.max(0, (H - pt - pb - totH) / 2);
    list.forEach(n => { n.y = y; n.h = Math.max(2, n.v * scale); y += n.h + pad; });
  });

  const map = {};
  lv.forEach(list => list.forEach(n => { map[n.id] = n; }));
  const x0 = labelW + 8, x1 = W / 2 - nw / 2, x2 = W - labelW - nw - 8;

  const mk = (raw, pre) => raw.map(l => ({ a: pre[0] + l.s, b: pre[1] + l.t, v: l.v }))
    .filter(l => map[l.a] && map[l.b])
    .sort((x, y) => (map[x.a].y - map[y.a].y) || (map[x.b].y - map[y.b].y));
  const L01 = mk(sk.l01 || [], ['p|', 's|']);
  const L12 = mk(sk.l12 || [], ['s|', 't|']);

  const off = {};
  Object.keys(map).forEach(k => { off[k] = map[k].y; });
  const ribbon = (xa, xb, y0, y1, h) => {
    const cx = (xa + xb) / 2;
    return `M${xa.toFixed(1)},${y0.toFixed(1)} C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${xb.toFixed(1)},${y1.toFixed(1)}` +
      ` L${xb.toFixed(1)},${(y1 + h).toFixed(1)} C${cx.toFixed(1)},${(y1 + h).toFixed(1)} ${cx.toFixed(1)},${(y0 + h).toFixed(1)} ${xa.toFixed(1)},${(y0 + h).toFixed(1)} Z`;
  };

  let g = '';
  const drawLinks = (links, xa, xb) => {
    links.forEach(l => {
      const h = Math.max(0.5, l.v * scale);
      const sy = off[l.a]; off[l.a] += h;
      const ty = off[l.b]; off[l.b] += h;
      g += `<path d="${ribbon(xa, xb, sy, ty, h)}" fill="${map[l.a].c}" fill-opacity=".24"
        data-tip="${esc(map[l.a].k)} → ${esc(map[l.b].k)}：${l.v} 篇"/>`;
    });
  };
  drawLinks(L01, x0 + nw, x1);
  Object.keys(map).forEach(k => { off[k] = map[k].y; });
  drawLinks(L12, x1 + nw, x2);

  const drawNodes = (list, x, side) => {
    let lastY = -999;
    list.forEach(n => {
      g += `<rect x="${x}" y="${n.y.toFixed(1)}" width="${nw}" height="${n.h.toFixed(1)}" rx="2.5" fill="${n.c}"
        data-act="${n.act}" data-val="${esc(n.val)}" style="cursor:pointer"
        data-tip="${esc(n.k)}：${n.v} 篇（${pct(n.v, total)}%）"/>`;
      const cy = n.y + n.h / 2 + 3.9;
      if (n.h < 8 || cy - lastY < 12.5) return;
      lastY = cy;
      const txt = `${n.k.length > 11 ? n.k.slice(0, 10) + '…' : n.k} ${n.v}`;
      const anchor = side === 'right' ? 'start' : 'start';
      const tx = side === 'left' ? x - 8 : x + nw + 8;
      g += `<text x="${tx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="${side === 'left' ? 'end' : 'start'}"
        style="font-size:${side === 'mid' ? 10.5 : 11}px;fill:var(--ink2);cursor:pointer;${HALO}"
        data-act="${n.act}" data-val="${esc(n.val)}">${esc(txt)}</text>`;
    });
  };
  drawNodes(lv[0], x0, 'left');
  drawNodes(lv[1], x1, 'mid');
  drawNodes(lv[2], x2, 'right');

  g += `<text x="${x0 + nw / 2}" y="11" text-anchor="middle" style="font-size:10px;fill:var(--muted)">采集平台</text>`;
  g += `<text x="${x1 + nw / 2}" y="11" text-anchor="middle" style="font-size:10px;fill:var(--muted)">拍摄场景</text>`;
  g += `<text x="${x2 + nw / 2}" y="11" text-anchor="middle" style="font-size:10px;fill:var(--muted)">研究任务</text>`;
  return svg(W, H, g, 'sankey');
}

/** 交叉热力表：rows × cols 的共现矩阵 */
function heatMatrix(rows, cols, getV, opt = {}) {
  const vals = [];
  rows.forEach(r => cols.forEach(c => vals.push(getV(r, c) || 0)));
  const max = Math.max(1, Math.max.apply(null, vals));
  let h = `<table class="heat hm"><thead><tr><th class="rowh">${esc(opt.corner || '平台 ＼ 模态')}</th>`;
  cols.forEach(c => {
    h += `<th title="${esc(c.k)}"><span class="hcol" data-act="${opt.colAct || ''}" data-val="${esc(c.k)}">${esc(c.k)}</span></th>`;
  });
  h += '</tr></thead><tbody>';
  rows.forEach(r => {
    h += `<tr><th class="rowh"><span class="hrow" data-act="${opt.rowAct || ''}" data-val="${esc(r.k)}">${esc(r.k)}</span></th>`;
    cols.forEach(c => {
      const v = getV(r, c) || 0;
      const a = v ? clamp(0.1 + v / max, 0.1, 1) : 0;
      h += `<td style="background:${v ? `color-mix(in srgb,var(--accent) ${Math.round(a * 100)}%,transparent)` : 'var(--line2)'};color:${a > 0.62 ? '#fff' : v ? 'var(--ink2)' : 'var(--line)'}"
        data-tip="${esc(r.k)} × ${esc(c.k)}：${v} 篇">${v || '·'}</td>`;
    });
    h += '</tr>';
  });
  return h + '</tbody></table>';
}

/** 双指标散点：数据场景适配度 × 算法学习价值 */
function chartScatterDS(points, opt = {}) {
  const W = 880, H = 400, pl = 46, pr = 16, pt = 16, pb = 42;
  const iw = W - pl - pr, ih = H - pt - pb;
  const x = v => pl + iw * clamp(v, 0, 100) / 100;
  const y = v => pt + ih - ih * clamp(v, 0, 100) / 100;
  const XT = 60, YT = 60;
  let g = '';
  // 四象限：右上（数据贴合 + 价值高）为最优先区
  g += `<rect x="${x(XT)}" y="${pt}" width="${x(100) - x(XT)}" height="${y(YT) - pt}"
    fill="color-mix(in srgb,var(--accent) 9%,transparent)"/>`;
  for (let i = 0; i <= 4; i++) {
    const yy = pt + ih * i / 4;
    g += `<line class="grid-l" x1="${pl}" y1="${yy}" x2="${W - pr}" y2="${yy}"/>`;
  }
  for (let i = 0; i <= 4; i++) {
    const xx = pl + iw * i / 4;
    g += `<line class="grid-l" x1="${xx}" y1="${pt}" x2="${xx}" y2="${pt + ih}"/>`;
    g += `<text class="axis" x="${xx}" y="${H - pb + 15}" text-anchor="middle">${i * 25}</text>`;
  }
  g += `<line x1="${x(XT)}" y1="${pt}" x2="${x(XT)}" y2="${pt + ih}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="4 3" opacity=".55"/>`;
  g += `<line x1="${pl}" y1="${y(YT)}" x2="${W - pr}" y2="${y(YT)}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="4 3" opacity=".55"/>`;
  for (let i = 0; i <= 4; i++) g += `<text class="axis" x="${pl - 8}" y="${y(i * 25) + 3}" text-anchor="end">${i * 25}</text>`;
  g += `<text class="axis" x="${pl + iw / 2}" y="${H - 8}" text-anchor="middle" style="font-size:11px">数据与场景适配度 →</text>`;
  g += `<text class="axis" transform="translate(11,${pt + ih / 2}) rotate(-90)" text-anchor="middle" style="font-size:11px">算法学习价值 →</text>`;
  g += `<text x="${pl + 6}" y="${pt + 13}" style="font-size:10.5px;fill:var(--muted)">数据不贴合 · 价值高（学方法，别学实验设置）</text>`;
  g += `<text x="${W - pr - 6}" y="${pt + 13}" text-anchor="end" style="font-size:10.5px;fill:var(--accent);font-weight:600">数据贴合 · 价值高（首选精读）</text>`;
  g += `<text x="${pl + 6}" y="${pt + ih - 5}" style="font-size:10.5px;fill:var(--muted)">两者皆低（暂缓）</text>`;
  g += `<text x="${W - pr - 6}" y="${pt + ih - 5}" text-anchor="end" style="font-size:10.5px;fill:var(--muted)">数据贴合 · 价值一般（作实验对照）</text>`;
  points.forEach(p => {
    const r = 2.8 + (p.rl - 40) / 60 * 4.6;
    g += `<circle cx="${x(p.x)}" cy="${y(p.y)}" r="${clamp(r, 2.8, 8.5)}" fill="${p.c}" fill-opacity=".6"
      stroke="${p.c}" stroke-width="1" style="cursor:pointer"
      data-act="open" data-val="${p.id}"
      data-tip="${esc(p.t)}<br>数据适配度 ${Math.round(p.x)}｜学习价值 ${Math.round(p.y)}｜项目耦合 ${Math.round(p.rl)}｜${esc(p.tp)}"/>`;
  });
  return svg(W, H, g);
}


/* ------------------------------------------------ V3 图表：研究方向树 / 六维雷达 / 时间线 */

/** 创新潜力 → 颜色。用语义变量而不是硬编码色值，深色主题下才不会失效。 */
function noveltyColor(v) {
  if (v >= 75) return 'var(--bad)';
  if (v >= 60) return 'var(--warn)';
  if (v >= 45) return 'var(--accent)';
  return 'var(--muted)';
}

/**
 * 研究方向树。四个变量挤在一张图里，每个通道各管一件事，不许混用：
 *   枝粗  = 机会分 opportunityScore（越粗越值得投入）
 *   枝色  = 创新潜力 novelty（红=高，蓝=中，灰=低）
 *   节点高 = 本库支撑篇数 localSupport（越高说明这批文献里越有底子）
 *   边框  = 风险 risk（越厚越危险，≥70 加虚线）
 * 为什么不用二维散点：方向天然是树状包含关系，散点会丢掉父子结构；
 * 而树本身只能表达包含，必须靠额外的视觉通道把评分贴上去。
 *
 * nodes = [{id, name, level, parentId, opp, novelty, local, risk, ext, sel}]
 */
function chartTree(nodes, opt = {}) {
  const rowH = opt.rowH || 46;
  // 一级方向靠左，子方向占右。只支持两级：本规范的方向树就是"一级主题 + 子方向"，
  // 再深的层级靠"子方向里的 techRoute"表达，画出来反而读不懂。
  // 两列之间留 64px：这个间距就是"树枝"本身的长度。原来是 12px，
  // 连线只剩一个小钩子，粗细差异完全看不出来 —— 枝粗这个视觉通道等于废掉。
  const colX = [16, 496];
  const colW = [416, 372];
  // 画布按实际用到的列收窄。viewBox 会等比缩放到容器宽度，如果留一条空列，
  // 文字会被整体缩到 67%，在小屏幕上就看不清了。
  const W = opt.w || (colX[1] + colW[1] + 16);
  const gapY = 14;
  const kidsOf = {};
  nodes.forEach(n => { if (n.parentId) (kidsOf[n.parentId] = kidsOf[n.parentId] || []).push(n); });
  const roots = nodes.filter(n => !n.parentId || n.level === 1);

  // 纵向布点：每个一级方向的块高 = 子方向数 × 行高，没有子方向就按 1 行
  let y = 16;
  const pos = {};
  roots.forEach(r => {
    const kids = kidsOf[r.id] || [];
    const blockH = Math.max(1, kids.length) * rowH + gapY;
    pos[r.id] = { y: y + (blockH - gapY) / 2 - 20, cx: colX[0] + colW[0] / 2 };
    kids.forEach((k, i) => {
      pos[k.id] = { y: y + i * rowH + 4, cx: colX[1] + colW[1] / 2 };
    });
    y += blockH;
  });

  /* 子方向若指向一个不存在的一级方向，上面的循环永远不会给它布点，
     它就静默消失了 —— 读者只会觉得"少了一块"，不会知道数据里 parentId 写错。
     这里把没落到位的节点补到末尾单独一行，并在图上标出来。 */
  const orphans = nodes.filter(n => !pos[n.id]);
  orphans.forEach((n, i) => {
    pos[n.id] = { y: y + i * rowH + 4, cx: colX[0] + colW[0] / 2 };
  });
  if (orphans.length) y += orphans.length * rowH + gapY;

  // 图例不画在 SVG 里：卡片头上有一行通道说明，
  // 画两遍会变成"一图两套说法"，还白占 22px 高度、把整棵树压小。
  const H = Math.max(170, y + 6);

  const nodeH = n => clamp(26 + Math.sqrt(Math.max(0, n.local || 0)) * 7, 26, 42);
  const strokeW = n => 1 + clamp((n.risk || 0), 0, 100) / 100 * 2.2;

  /* 枝粗用"本批内相对"映射，不用绝对值：机会分常年落在 50–85 这段，
     按 /100 换算出来只差 1–2px，看着就是一样粗。归一化到 2–11px，
     任何量纲下都能看出谁更值得投入。图例里写明"相对本批"。 */
  const allKids = [];
  roots.forEach(r => (kidsOf[r.id] || []).forEach(k => allKids.push(k)));
  const oVals = allKids.map(k => k.opp || 0);
  const oMin = Math.min.apply(null, oVals.concat([0]));
  const oMax = Math.max.apply(null, oVals.concat([0]));
  const branchW = k => {
    const t = oMax > oMin ? ((k.opp || 0) - oMin) / (oMax - oMin) : 0.5;
    return 2 + t * 9;
  };

  let g = '';
  // 先画连线，后画节点，避免线压在方块上
  roots.forEach(r => {
    (kidsOf[r.id] || []).forEach(k => {
      const a = pos[r.id], b = pos[k.id];
      if (!a || !b) return;
      const x1 = colX[0] + colW[0], y1 = a.y + nodeH(r) / 2;
      const x2 = colX[1], y2 = b.y + nodeH(k) / 2;
      const mx = (x1 + x2) / 2;
      g += `<path d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" fill="none"
        stroke="${noveltyColor(k.novelty)}" stroke-width="${branchW(k).toFixed(1)}"
        stroke-opacity=".55" stroke-linecap="round"/>`;
    });
  });

  const drawNode = (n, x, w) => {
    const p = pos[n.id]; if (!p) return '';
    const h = nodeH(n);
    const c = noveltyColor(n.novelty);
    const dash = (n.risk || 0) >= 70 ? ' stroke-dasharray="5 3"' : '';
    const sw = (n.sel ? 2.6 : strokeW(n));
    const label = n.name.length > 20 ? n.name.slice(0, 19) + '…' : n.name;
    const metric = `机会 ${Math.round(n.opp || 0)}｜库内 ${n.local || 0}｜外部 ${n.ext || 0}`;
    const tip = `${esc(n.name)}<br>机会分 ${Math.round(n.opp || 0)}｜创新潜力 ${n.novelty || 0}｜风险 ${n.risk || 0}`
      + `<br>本库支撑 ${n.local || 0} 篇｜外部文献 ${n.ext || 0} 篇`;
    /* 编号：树里到底有几个方向，读者要能不靠数方框就看出来。
       编号放在方块内左上角，与标题错开 13px，不挤占标题字数。 */
    const num = n.idx == null ? '' : `<text x="${x + 9}" y="${p.y + (h >= 34 ? 16 : h / 2 + 4)}"
      style="font-size:10px;font-weight:700;fill:${c};opacity:.85">${n.idx}</text>`;
    return `<g style="cursor:pointer" data-act="dir-open" data-val="${esc(n.id)}" data-tip="${tip}">
      <rect x="${x}" y="${p.y}" width="${w}" height="${h}" rx="7"
        fill="color-mix(in srgb,${c} 11%,var(--panel))"
        stroke="${c}" stroke-width="${sw}"${dash}/>
      <rect x="${x}" y="${p.y}" width="3.5" height="${h}" rx="1.5" fill="${c}"/>
      ${num}
      <text x="${x + (n.idx == null ? 11 : 29)}" y="${p.y + (h >= 34 ? 16 : h / 2 + 4)}" style="font-size:12px;font-weight:600;fill:var(--ink)">${esc(label)}</text>
      ${h >= 34 ? `<text x="${x + 29}" y="${p.y + h - 6}" style="font-size:10px;fill:var(--muted)">${esc(metric)}</text>` : ''}
    </g>`;
  };

  roots.forEach(r => { g += drawNode(r, colX[0], colW[0]); });
  roots.forEach(r => (kidsOf[r.id] || []).forEach(k => { g += drawNode(k, colX[1], colW[1]); }));
  orphans.forEach(o => { g += drawNode(o, colX[0], colW[0]); });   // 父方向缺失的节点也要画出来

  return svg(W, H, g, 'tree');
}

/**
 * 六维雷达。单篇外部文献的评分构成用雷达，比六条横条更容易一眼看出"偏科"。
 * items = [{label, v}]，v 为 0-100。
 */
function chartRadar(items, opt = {}) {
  const S = 300, cx = S / 2, cy = S / 2 + 4, R = 92;
  const n = items.length || 1;
  const ang = i => -Math.PI / 2 + Math.PI * 2 * i / n;
  let g = '';
  for (let r = 1; r <= 4; r++) {
    const pts = items.map((_, i) => {
      const a = ang(i), rr = R * r / 4;
      return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
    }).join(' ');
    g += `<polygon points="${pts}" fill="none" stroke="var(--line)" stroke-width="1"/>`;
  }
  items.forEach((it, i) => {
    const a = ang(i);
    g += `<line x1="${cx}" y1="${cy}" x2="${(cx + R * Math.cos(a)).toFixed(1)}" y2="${(cy + R * Math.sin(a)).toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
    const lx = cx + (R + 16) * Math.cos(a), ly = cy + (R + 16) * Math.sin(a);
    const anchor = Math.abs(Math.cos(a)) < 0.25 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
    g += `<text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${anchor}"
      style="font-size:10.5px;fill:var(--ink2)">${esc(it.label)}</text>`;
    g += `<text x="${lx.toFixed(1)}" y="${(ly + 15).toFixed(1)}" text-anchor="${anchor}"
      style="font-size:10px;fill:var(--muted)">${Math.round(it.v)}</text>`;
  });
  const poly = items.map((it, i) => {
    const a = ang(i), rr = R * clamp(it.v, 0, 100) / 100;
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  g += `<polygon points="${poly}" fill="color-mix(in srgb,var(--accent) 22%,transparent)"
    stroke="var(--accent)" stroke-width="1.6"/>`;
  items.forEach((it, i) => {
    const a = ang(i), rr = R * clamp(it.v, 0, 100) / 100;
    g += `<circle cx="${(cx + rr * Math.cos(a)).toFixed(1)}" cy="${(cy + rr * Math.sin(a)).toFixed(1)}" r="2.8"
      fill="var(--accent)"/>`;
  });
  return svg(S, S + 16, g, 'radar');
}

/**
 * 时间线。用于年份分布：竖条 + 折线，能同时看出"哪年多"和"趋势往哪走"。
 * items = [{k:'2024', v:6}]，按 k 排序后传入。
 */
function chartTimeline(items, opt = {}) {
  const W = opt.w || 660, H = opt.h || 200;
  const pl = 30, pr = 14, pt = 14, pb = 34;
  const iw = W - pl - pr, ih = H - pt - pb;
  const max = niceMax(Math.max(1, ...items.map(i => i.v)));
  const step = items.length > 1 ? iw / (items.length - 1) : iw;
  const bw = Math.min(34, iw / Math.max(1, items.length) * 0.42);
  let g = '';
  for (let i = 0; i <= 3; i++) {
    const y = pt + ih - ih * i / 3;
    g += `<line class="grid-l" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/>`;
    g += `<text class="axis" x="${pl - 6}" y="${y + 3}" text-anchor="end">${Math.round(max * i / 3)}</text>`;
  }
  const pts = [];
  items.forEach((it, i) => {
    const cx = items.length > 1 ? pl + step * i : pl + iw / 2;
    const hh = ih * it.v / max;
    g += `<rect x="${cx - bw / 2}" y="${pt + ih - hh}" width="${bw}" height="${Math.max(0.8, hh)}" rx="2.5"
      fill="var(--accent)" opacity=".78" data-tip="${esc(it.k)} 年：${it.v} 篇"/>`;
    g += `<text class="axis" x="${cx}" y="${H - pb + 15}" text-anchor="middle">${esc(it.k)}</text>`;
    if (it.v) g += `<text class="axis" x="${cx}" y="${pt + ih - hh - 4}" text-anchor="middle" style="fill:var(--ink2)">${it.v}</text>`;
    pts.push(`${cx.toFixed(1)},${(pt + ih - hh).toFixed(1)}`);
  });
  if (pts.length > 1) {
    g += `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent2)" stroke-width="1.6" stroke-opacity=".8"/>`;
  }
  return svg(W, H, g, 'timeline');
}



/* ==========================================================================
 * 分层有向流程图 —— 项目拆解地图专用（V4.0）
 * --------------------------------------------------------------------------
 * nodes = [{ id, name, layer, importance 1-5, status, risk 0-100, cat, keyPath, sel }]
 * edges = [[fromId, toId], ...]
 *
 * 为什么竖着画：项目模块是按"层次"推进的（问题→建模→算法→数值→系统→验证），
 * 横着排 6 列会把画布撑到 1000px 以上，在中间栏里被等比缩到 0.7，字全糊；
 * 竖着排每层只占一行，宽度由"单层最多几个模块"决定，稳定在 650px 左右。
 *
 * 五个视觉通道各管一件事（图例由调用方在卡片下方渲染，不在 SVG 里再写一遍）：
 *   位置 = 所处层次      填充 = 任务类别      边框 = 实现状态
 *   块高 = 项目重要性    右上角三角 = 高风险  虚线边框 = 非关键路径
 * ========================================================================== */
function dagCatColor(cat) {
  const m = {
    '问题定义': 'var(--brand)', '建模': 'var(--accent2)', '算法': 'var(--accent)',
    '数值': 'var(--violet)', '系统': 'var(--warn)', '验证': 'var(--ok)',
  };
  return m[cat] || 'var(--muted)';
}
function dagStatusColor(st) {
  const m = { '已验证': 'var(--ok)', '进行中': 'var(--warn)', '未开始': 'var(--muted)' };
  return m[st] || 'var(--muted)';
}

/* 中文断行：按字数硬切，最多两行，第二行末尾加省略号。
   SVG 没有自动换行，只能自己算。 */
function dagWrap(s, perLine, maxLines) {
  s = String(s || '');
  const lines = [];
  for (let i = 0; i < s.length && lines.length < maxLines; i += perLine) {
    lines.push(s.slice(i, i + perLine));
  }
  if (s.length > perLine * maxLines && lines.length) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, perLine - 1) + '…';
  }
  return lines;
}

function chartDag(nodes, edges, opt = {}) {
  nodes = nodes || []; edges = edges || [];
  if (!nodes.length) return svg(320, 80, '<text x="12" y="44" style="font-size:11px;fill:var(--muted)">没有项目模块</text>', 'dag');

  const NW = opt.nw || 150;      // 节点宽
  const HG = 14;                 // 同层横向间距
  const RG = 42;                 // 层间纵向间距（留出箭头与曲线）
  const PAD = 14;
  const hOf = n => 24 + clamp(n.importance || 3, 1, 5) * 4;   // 28–44

  /* 按实际出现过的层次压缩成连续行：数据里的 layer 是 1..6 这种人读编号，
     直接当数组下标会在前面空出一整行，白占 42px 高度。 */
  const lvSet = {};
  nodes.forEach(n => { const L = n.layer == null ? 0 : Math.max(0, n.layer | 0); lvSet[L] = 1; });
  const lvList = Object.keys(lvSet).map(Number).sort((x, y) => x - y);
  const rowOf = {};
  lvList.forEach((L, i) => { rowOf[L] = i; });
  const layers = lvList.map(() => []);
  nodes.forEach(n => {
    const L = n.layer == null ? 0 : Math.max(0, n.layer | 0);
    layers[rowOf[L]].push(n);
  });

  const widths = layers.map(a => (a.length ? a.length * NW + (a.length - 1) * HG : 0));
  const innerW = Math.max(NW, Math.max.apply(null, widths.concat([0])));
  const W = innerW + PAD * 2;

  const pos = {};
  let y = PAD;
  layers.forEach(arr => {
    const hmax = arr.length ? Math.max.apply(null, arr.map(hOf)) : 0;
    const total = arr.length * NW + Math.max(0, arr.length - 1) * HG;
    let x = PAD + (innerW - total) / 2;
    arr.forEach(n => {
      const h = hOf(n);
      pos[n.id] = { x: x, y: y + (hmax - h) / 2, w: NW, h: h };
      x += NW + HG;
    });
    y += hmax + RG;
  });
  const H = Math.max(120, y - RG + PAD);

  let g = '';

  /* --- 连线先画，避免压在方块上 --- */
  edges.forEach(e => {
    const a = pos[e[0]], b = pos[e[1]];
    if (!a || !b) return;
    const x1 = a.x + a.w / 2, y1 = a.y + a.h;
    const x2 = b.x + b.w / 2, y2 = b.y;
    const back = y2 < y1 + 6;      // 同层或反向依赖：正常贝塞尔会折回压住方块
    let d;
    if (!back) {
      const dy = Math.max(16, (y2 - y1) / 2);
      d = `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
    } else {
      // 从右侧绕出去再拐回来，避免和同层节点重叠
      const r = 26;
      d = `M${x1},${y1} C${x1 + r},${y1 + 10} ${x2 + r},${y2 - 10} ${x2},${y2}`;
    }
    g += `<path d="${d}" fill="none" stroke="var(--line)" stroke-width="1.3"/>`;
    g += `<path d="M${x2 - 3.6},${y2 - 5} L${x2 + 3.6},${y2 - 5} L${x2},${y2} Z" fill="var(--line)"/>`;
  });

  /* --- 节点 --- */
  nodes.forEach(n => {
    const p = pos[n.id]; if (!p) return;
    const c = dagCatColor(n.cat);
    const sc = dagStatusColor(n.status);
    const riskHi = (n.risk || 0) >= 70;
    const dash = n.keyPath === false ? ' stroke-dasharray="4 3"' : '';
    const ring = n.sel ? `<rect x="${p.x - 3}" y="${p.y - 3}" width="${p.w + 6}" height="${p.h + 6}" rx="10"
        fill="none" stroke="var(--accent)" stroke-width="1.6" opacity=".55"/>` : '';
    const lines = dagWrap(n.name, 11, 2);
    const ty = p.y + p.h / 2 - ((lines.length - 1) * 7);
    g += `<g data-act="state" data-k="labMod" data-val="${n.id}" style="cursor:pointer"
        data-tip="${String(n.tip || n.name).replace(/"/g, '&quot;')}">`
      + ring
      + `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" fill="${c}" opacity=".13"/>`
      + `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" fill="none"
          stroke="${sc}" stroke-width="${n.sel ? 2.2 : 1.5}"${dash}/>`
      + `<rect x="${p.x}" y="${p.y + 2}" width="3.5" height="${p.h - 4}" rx="1.6" fill="${c}"/>`
      + lines.map((ln, i) => `<text x="${p.x + p.w / 2}" y="${ty + i * 14}" text-anchor="middle"
          style="font-size:10.5px;fill:var(--ink);font-weight:600">${ln}</text>`).join('')
      + (riskHi ? `<path d="M${p.x + p.w - 13},${p.y + 1} L${p.x + p.w - 1},${p.y + 13}"
          stroke="var(--bad)" stroke-width="2.4" fill="none" stroke-linecap="round"/>` : '')
      + `</g>`;
  });

  return svg(W, H, g, 'dag');
}

/* ------------------------------------------------ 提示气泡 */
/* 只负责把 [data-tip] 的内容显示出来；点击行为统一由 app.bind.js 处理，
   图表不需要各自绑定事件。 */
(function () {
  const tip = document.getElementById('tip');
  if (!tip) return;
  document.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-tip]');
    if (!t) { tip.classList.remove('on'); return; }
    tip.innerHTML = t.getAttribute('data-tip');
    tip.classList.add('on');
    const r = t.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 10,
      Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
    tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + 'px';
  });
  document.addEventListener('mouseout', e => {
    if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('[data-tip]')) {
      tip.classList.remove('on');
    }
  });
})();

