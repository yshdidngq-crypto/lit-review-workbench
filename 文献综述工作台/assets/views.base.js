/* ============================================================================
 * views.base.js —— 通用视图层（锁死文件，一个字都不要改）
 * ----------------------------------------------------------------------------
 * 十一个视图的完整实现：dash / landscape / map / explore / novelty / external /
 * db / cmp / decide / prog / session。全部只读 config.json 与 data/，不含任何
 * 项目专有措辞 —— 换一批论文、换一个方向，它输出的仍是同一套版式。
 *
 * 项目要改哪一页，就在 src/views.js 里用同名函数覆盖那一页：
 *     window.VIEWS = window.VIEWS || {};
 *     window.VIEWS.dash = function (papers, cfg) { return '…'; };
 * build.py 会在 src/views.js 之后做一次合并，写过的覆盖这里，没写的用这里。
 *
 * 规则（与以前一样）：
 *   1. 只能用 ui.js 的构件函数拼装（card / kpi / grid / table / progRow / tag …）；
 *   2. 图表只能用 charts.js 的函数，不允许手写 SVG 或引入图表库；
 *   3. 返回的 HTML 由骨架里的 #view 容器承载，不要再套外层 div；
 *   4. 交互一律用 data-* 约定（见 app.bind.js 顶部注释），不要 addEventListener。
 * ========================================================================== */
/* == IIFE 起点 == */
/* 整段包进函数作用域：底座里的 topicName / statusTag / clip … 这些顶层小工具
   不会和项目 src/views.js 里的同名变量撞车（同学那份就这么崩过）。 */
(function () {
'use strict';


/* ---------------------------------------------------------------- 通用小工具 */
function topicName(id) { return TOPICS[id] || id; }
/* 主题色：显式 color 优先，缺了就按主题次序取默认色板。
   原来这里直接退化成 var(--muted)（灰），作者忘写 color 时整张饼图和
   整片气泡都会变成同一个颜色，分类维度直接消失（V4.7 事故）。
   兜底逻辑放在锁定层的 topicColorOf 里，这里只做转发。 */
function topicColor(id) {
  const t = TOPIC_META[id];
  if (t && t.color) return t.color;
  if (typeof topicColorOf === 'function') return topicColorOf(id);
  return 'var(--muted)';
}
function tagTopic(id) { return colorTag(topicName(id), topicColor(id)); }

/* 这个标签不是纯文字，是能点的一格：点一下进下一档阅读状态。
   以前它只显示文字，用户读完回来一看还是「未阅读」，以为程序坏了 ——
   其实页面上根本没有能改状态的地方。 */
function statusTag(id) {
  const s = statusOf(id);
  const cls = s === '已精读' ? 't-ok' : s === '正在阅读' ? 't-topic' : s === '待阅读' ? 't-warn' : 't-mute';
  return `<button class="tag ${cls}" data-act="status-next" data-val="${esc(id)}"
    title="点一下切到下一个阅读状态">${esc(s)}</button>`;
}

function scoreOf(p, key) {
  if (key === 'relevance') return p.relevance || 0;
  if (key === 'learning') return p.learning || 0;
  return (p.extraScores || {})[key] || 0;
}

/* 表格里的长标题截断。直接用 slice 会切在单词中间（"…Analysis o"），
   而且没有省略号，读者看不出这句话是被截过的。这里尽量停在词边界并补「…」。 */
function clip(s, n) {
  s = String(s == null ? '' : s);
  if (s.length <= n) return s;
  let cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  if (sp > n * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/[\s,;:.·、]+$/, '') + '…';
}

/* ---------------------------------------------------------- 待审核数据（解析期问题）
 * 这份数据只回答一件事：这批文献里哪几篇的元数据不能直接采信，问题出在哪个字段。
 * 不设"可信度百分比"这类合成指标 —— 合成出来的数字没法核对，也没法修。
 * 每条问题的字段：
 *   id       稳定且唯一的编号，用来记住"已确认"（改成随机值会让确认状态全丢）
 *   paperId  关联的论文 id；没有就留空，卡片只显示问题本身
 *   field    title | author | year | venue | doi | duplicate | missing | pdf
 *   problem  问题是什么。要写"哪里不对"，不要写"建议关注"
 *   basis    依据（跟哪个来源比对出来的）—— 可选
 *   fix      建议改成什么 —— 可选，但不自动应用：改数据必须经过人
 */
const REVIEW_FIELD = {
  title: ['标题', 'var(--warn)'],
  author: ['作者', 'var(--accent2)'],
  year: ['年份', 'var(--violet)'],
  venue: ['期刊', 'var(--accent)'],
  body: ['正文', 'var(--bad)'],
  doi: ['DOI', 'var(--bad)'],
  duplicate: ['重复', 'var(--bad)'],
  missing: ['缺字段', 'var(--muted)'],
  pdf: ['无全文', 'var(--muted)'],
};

function reviewList(items, papers) {
  const byId = {};
  (papers || []).forEach(p => { byId[p.id] = p; });
  const done = (S && S.reviewDone) || {};
  const row = (q, i) => {
    const qid = q.id || ('q' + i);
    const ok = !!done[qid];
    const fm = REVIEW_FIELD[q.field] || [q.field || '其他', 'var(--muted)'];
    const p = q.paperId ? byId[q.paperId] : null;
    const tail = [q.basis ? '依据：' + q.basis : '', q.fix ? '建议：' + q.fix : ''].filter(Boolean);
    return `<div class="rev${ok ? ' on' : ''}">
      <span class="rev-tag" style="color:${fm[1]};border-color:${fm[1]}">${esc(fm[0])}</span>
      <div class="rev-body">
        <div class="rev-h">${p
          ? `<span class="rev-link" data-act="open" data-val="${esc(p.id)}">${esc(clip(p.title, 56))}</span>
             <span class="tiny muted">${esc(p.id)}</span>`
          : `<span>${esc(q.title || '未关联到具体文献')}</span>`}</div>
        <div class="rev-p">${esc(q.problem || '')}</div>
        ${tail.length ? `<div class="tiny muted rev-src">${tail.map(esc).join(' ｜ ')}</div>` : ''}
      </div>
      <button class="rev-btn${ok ? ' on' : ''}" data-act="obj-flip" data-k="reviewDone"
        data-id="${esc(qid)}" title="${ok ? '点一下撤销确认' : '确认这条已经处理'}">${ok ? '已确认' : '确认'}</button>
    </div>`;
  };
  /* 按字段分组：解析问题往往成百上千条（174 篇里 166 篇没写具体数据集名就是一类），
     一次全铺开会把仪表板撑成十几屏，读者根本翻不到底。
     分组后先看到"哪一类问题最多"，每类默认给 5 条，其余折叠 —— 用原生 details，
     不加 JS 绑定、不破坏离线自包含。 */
  const groups = [], idx = {};
  items.forEach((q, i) => {
    const f = q.field || 'other';
    if (!idx[f]) { idx[f] = { field: f, list: [] }; groups.push(idx[f]); }
    idx[f].list.push(q);
  });
  const SHOW = 5;
  return groups.map(g => {
    const fm = REVIEW_FIELD[g.field] || [g.field, 'var(--muted)'];
    const head = `<div class="rev-group"><span class="rev-tag" style="color:${fm[1]};border-color:${fm[1]}">${esc(fm[0])}</span>
      <span class="tiny muted">${g.list.length} 处</span></div>`;
    const top = g.list.slice(0, SHOW).map((q, i) => row(q, i)).join('');
    const rest = g.list.slice(SHOW);
    const more = rest.length
      ? `<details class="rev-more"><summary class="tiny muted">展开其余 ${rest.length} 处</summary>
         ${rest.map((q, i) => row(q, SHOW + i)).join('')}</details>`
      : '';
    return head + top + more;
  }).join('');
}

/* ---------------------------------------------------------------- 总览仪表板 */
window.VIEWS_BASE = window.VIEWS_BASE || {};
window.VIEWS_BASE.dash = function (papers, cfg) {
  const all = papers;
  const n = all.length;
  if (!n) return emptyBox('当前筛选下没有文献，请调整条件或点「重置筛选」');

  // 档位阈值一律从 cfg.bands 取，不要写死数字 —— 换了数据集阈值就变了
  const BANDS = (cfg.bands || []).slice().sort((a, b) => b.min - a.min);
  const tCore = (BANDS[0] || { min: 85 }).min;
  const tHigh = (BANDS[1] || BANDS[0] || { min: 70 }).min;
  const bandNameOf = v => {
    for (const b of BANDS) if (v >= b.min) return b.name;
    return BANDS.length ? BANDS[BANDS.length - 1].name : '—';
  };
  const core = all.filter(p => (p.relevance || 0) >= tCore).length;
  const high = all.filter(p => (p.relevance || 0) >= tHigh).length;
  const read = all.filter(p => ['已初读', '已精读'].indexOf(statusOf(p.id)) >= 0).length;
  const years = all.map(p => p.year).filter(Boolean);
  const y0 = Math.min.apply(null, years), y1 = Math.max.apply(null, years);
  const avgDiff = (sum(all.map(p => p.difficulty || 0)) / n).toFixed(1);

  // 主题分布
  const topicItems = (cfg.topics || []).map(t => ({
    k: t.name, code: t.id, c: t.color || 'var(--muted)',
    v: all.filter(p => p.topic === t.id).length,
  })).filter(x => x.v > 0);

  // 年份分布。k 是给人看的标签（带"年"），val 是给筛选用机器值 —— 两者必须分开，
  // 否则点年份条会拿 "2025 年" 去和 p.year 的 2025 比，永远筛不出东西。
  const yearMap = {};
  all.forEach(p => { if (p.year) yearMap[p.year] = (yearMap[p.year] || 0) + 1; });
  const yearItems = Object.keys(yearMap).sort()
    .map(y => ({ k: y + ' 年', val: y, v: yearMap[y], c: 'var(--accent)' }));

  const kpiRow = grid(5, [
    kpi('文献总量', n, '篇', 'var(--accent)', 100),
    kpi('高相关（≥' + tHigh + '）', high, '占 ' + pct(high, n) + '%', 'var(--warn)', pct(high, n)),
    kpi('核心精读候选（≥' + tCore + '）', core, '篇', 'var(--bad)', pct(core, n) * 4),
    kpi('已读', read, '占 ' + pct(read, n) + '%', 'var(--ok)', pct(read, n)),
    kpi('平均难度', avgDiff, '/ 5', 'var(--violet)', Number(avgDiff) * 20),
  ].join(''));

  const mainRow = grid(2, [
    card('主题构成', '按一级主题计，每篇只计一次',
      `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <div style="flex:0 0 200px;max-width:200px">${chartDonut(topicItems, { act: 'topic', centerLabel: '篇' })}</div>
        <div style="flex:1;min-width:190px">${topicItems.map(t => progRowDot(t.k, t.c, pct(t.v, n), t.v + ' 篇')).join('')}</div>
      </div>`),
    card('发表年份分布', y0 + ' — ' + y1,
      chartBox(chartHBars(yearItems, { act: 'year', labelW: 78, rowH: 26 }))),
  ].join(''));

  // 相关程度：五个档位横排成一格一格。原来用竖排进度条与待审核卡片并排，
  // 但两者高度差三倍，左卡下面会空出一大块 —— 横排一格一档，占一行就够。
  const bandCell = BANDS.map(b => {
    const v = all.filter(p => bandNameOf(p.relevance || 0) === b.name).length;
    return `<div class="bandcell">
      <div class="bc-n">${esc(b.name)}</div>
      <div class="bc-v" style="color:${b.color}">${v}</div>
      <div class="bc-t">≥ ${b.min}</div>
    </div>`;
  }).join('');

  const bandRow = cardWide('与本方向的相关程度', '',
    `<div class="bandgrid">${bandCell}</div>`);

  // 待审核数据：解析阶段留下的具体问题，逐个字段指名。
  const RV = (M.review || []).filter(Boolean);
  const rvDone = RV.filter((q, i) => (S.reviewDone || {})[q.id || ('q' + i)]).length;
  const rvLeft = RV.length - rvDone;
  const rvPapers = RV.map(q => q.paperId).filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i).length;

  const reviewRow = cardWide('待审核数据',
    RV.length ? `${rvLeft} 处待处理 · 涉及 ${rvPapers} 篇` : '本次解析未记录异常',
    RV.length
      ? reviewList(RV, all)
      : `<div class="tiny muted" style="padding:6px 0">没有需要人工核对的条目。</div>`);

  // 关键结论：自动挑出最值得注意的几条
  const top3 = sortPapers(all.filter(p => (p.relevance || 0) >= 80), 'priority').slice(0, 3);
  const gapNote = (M.gaps || []).filter(g => (g.count || 0) <= 2);
  // 标题里的条数按实际凑出来的算 —— 写死"三个"而只渲染出两条，读者会以为丢了内容
  const nJudge = 1 + (gapNote.length ? 1 : 0) + (top3.length ? 1 : 0);

  const conclusion = cardWide('本批文献的' + (nJudge === 1 ? '结论' : nJudge + ' 个判断'), '', [
    `<div class="tiny" style="line-height:1.85">`,
    `<div><b>规模</b>：${n} 篇文献，跨度 ${y0}—${y1} 年，其中 ${high} 篇与本方向高度相关（≥${tHigh}）。</div>`,
    gapNote.length
      ? `<div style="margin-top:6px"><b>薄弱环节</b>：${gapNote.map(g => esc(g.name) + '（' + g.count + ' 篇）').join('、')}。</div>`
      : '',
    top3.length
      ? `<div style="margin-top:6px"><b>优先精读</b>：${top3.map(p => `<span data-act="open" data-val="${p.id}" style="color:var(--accent);cursor:pointer">${esc(p.title.slice(0, 22))}…</span>`).join('；')}</div>`
      : '',
    `</div>`,
  ].join(''));

  return kpiRow + mainRow + bandRow + reviewRow + conclusion;
};

/* ---------------------------------------------------------------- 技术图谱 */
window.VIEWS_BASE.map = function (papers, cfg) {
  const all = papers;
  const stages = cfg.stages || [];
  if (!stages.length) return emptyBox('config.json 未定义技术环节（stages），无法生成图谱');

  const rows = stages.map(s => ({
    id: s.id, name: s.name, desc: s.desc,
    n: all.filter(p => (p.stages || []).indexOf(s.id) >= 0).length,
  }));
  const maxN = Math.max(1, ...rows.map(r => r.n));

  /* 编号对照必须置顶，且吸附跟随：S1 这类编号本身不含语义，
     读者看到下方矩阵时若对照已滚出画面，等于没给。
     sidLegend 由 ui.js 提供（吸附 + 可拖动 + 收起），这里只传数据。 */
  const sidLegendBlock = sidLegend(stages, {
    key: 'map',
    suffix: '下方三张图同此编号',
  });

  const left = card('研究环节覆盖', '标红 = 本批不超过 2 篇',
    `<div class="sidrows">${rows.map(r =>
      progRow(r.id + '　' + r.name, r.n === 0 ? 'var(--line)' : (r.n <= 2 ? 'var(--bad)' : 'var(--accent)'), r.n * 100 / maxN, r.n + ' 篇')
    ).join('')}</div>`);

  // 环节 × 主题 交叉密度：看每个环节是被哪一派方法覆盖的
  const topicCols = (cfg.topics || []).filter(t => all.some(p => p.topic === t.id));
  const colId = {};
  topicCols.forEach(t => { colId[t.name] = t.id; });
  const cross = chartBox(
    heatMatrix(
      // 行标签用环节编号：热力表的行头固定 110px 宽，长名会被截断；
      // 编号对照已置顶，这里不再重复全名
      rows.map(r => ({ k: r.id, name: r.name })),
      topicCols.map(t => ({ k: t.name })),
      (r, c) => all.filter(p => (p.stages || []).indexOf(r.k) >= 0 && p.topic === colId[c.k]).length,
      { corner: '环节 ＼ 主题' }
    )
  );
  const right = card('环节 × 主题 交叉分布', '', cross);

  // 论文 × 环节 热力矩阵（通栏，避免与左侧卡片高度悬殊）
  const sample = sortPapers(all, 'relevance').slice(0, 24);
  const cells = sample.map(p => ({ p, set: new Set(p.stages || []) }));
  const head = '<tr><th style="width:230px">论文</th>' + stages.map(s => `<th title="${esc(s.name)}" style="font-weight:500;white-space:nowrap">${esc(s.id)}</th>`).join('') + '</tr>';
  const body = cells.map(c => `<tr>
      <td class="ttl" data-act="open" data-val="${c.p.id}" style="max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" title="${esc(c.p.title)}">${esc(c.p.title)}</td>
      ${stages.map(s => `<td style="text-align:center">${c.set.has(s.id)
        ? '<span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:var(--accent)"></span>'
        : '<span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:var(--line2)"></span>'}</td>`).join('')}
    </tr>`).join('');
  const matrix = cardWide('论文 × 环节', '按耦合度取前 24 篇',
    `<div style="overflow:auto"><table class="db" style="font-size:11.5px"><thead>${head}</thead><tbody>${body}</tbody></table></div>`);

  return sidLegendBlock + grid(2, [left, right].join('')) + matrix;
};

/* ---------------------------------------------------------------- 文献数据库 */
window.VIEWS_BASE.db = function (papers, cfg) {
  const all = papers;
  const f = S.filters;
  const list = sortPapers(all, S.sort);
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / S.pageSize));
  const page = Math.min(S.page, pages);
  const slice = list.slice((page - 1) * S.pageSize, page * S.pageSize);

  /* --- 筛选面板 --- */
  const chipRow = (label, key, items) => items.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0">
      <span class="tiny muted" style="flex:0 0 62px">${esc(label)}</span>
      ${items.map(it => `<button class="chip${(f[key] || []).indexOf(it.v) >= 0 ? ' on' : ''}" data-chip="${key}" data-val="${esc(it.v)}">${esc(it.t)}</button>`).join('')}
    </div>` : '';

  const years = [...new Set(all.map(p => p.year).filter(Boolean))].sort((a, b) => b - a);
  const topicItems = (cfg.topics || []).map(t => ({ v: t.id, t: t.name + ' ' + all.filter(p => p.topic === t.id).length }));
  const stageItems = (cfg.stages || []).map(s => ({ v: s.id, t: s.name }));

  const panel = card('筛选', '共 ' + activeFilterCount() + ' 个条件生效',
    `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input data-f="q" value="${esc(f.q)}" placeholder="关键词…" style="flex:1;min-width:180px;padding:5px 9px;border:1px solid var(--line);border-radius:7px;background:var(--panel2)">
      <select data-f="sort" style="padding:5px 9px;border:1px solid var(--line);border-radius:7px;background:var(--panel2)">
        <option value="priority"${S.sort === 'priority' ? ' selected' : ''}>综合优先级</option>
        <option value="relevance"${S.sort === 'relevance' ? ' selected' : ''}>项目耦合度</option>
        <option value="learning"${S.sort === 'learning' ? ' selected' : ''}>学习价值</option>
        <option value="year"${S.sort === 'year' ? ' selected' : ''}>发表年份</option>
        <option value="difficulty"${S.sort === 'difficulty' ? ' selected' : ''}>阅读难度</option>
      </select>
      <button class="btn sm${S.mode === 'table' ? ' on' : ''}" data-mode="table">表格</button>
      <button class="btn sm${S.mode === 'cards' ? ' on' : ''}" data-mode="cards">卡片</button>
    </div>
    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <span class="tiny muted" style="flex:0 0 62px">一键预设</span>
      ${(cfg.presets || []).map(x => `<button class="chip preset" data-preset="${x.id}" title="${esc(x.desc || '')}">${esc(x.label)}</button>`).join('')}
    </div>
    ${chipRow('一级主题', 'topic', topicItems)}
    ${chipRow('技术环节', 'stage', stageItems)}
    ${chipRow('年份', 'year', years.map(y => ({ v: String(y), t: String(y) })))}
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;align-items:center">
      <label class="tiny muted">耦合度 ≥ <b>${f.relMin}</b>
        <input type="range" min="0" max="100" step="5" value="${f.relMin}" data-f="relMin" style="width:120px;vertical-align:middle"></label>
      <label class="tiny muted">学习价值 ≥ <b>${f.learnMin}</b>
        <input type="range" min="0" max="100" step="5" value="${f.learnMin}" data-f="learnMin" style="width:120px;vertical-align:middle"></label>
      <button class="btn sm" data-act="clear">清空条件</button>
    </div>`);

  /* --- 列表 --- */
  let body;
  if (S.mode === 'cards') {
    body = `<div class="cards">${slice.map(p => `
      <div class="card pcard" data-act="open" data-val="${p.id}" style="cursor:pointer">
        <div class="t" style="font-size:12.5px;font-weight:650;line-height:1.5">${esc(p.title)}</div>
        <div class="m tiny muted" style="margin-top:4px">${esc(dash(p.year))} · ${esc((p.venue || '出处未记录').slice(0, 40))}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px">${tagTopic(p.topic)}${tag(p.dl)}</div>
        <div class="foot" style="display:flex;gap:12px;margin-top:10px;font-size:11px;color:var(--muted)">
          <span>耦合 <b style="color:var(--ink)">${Math.round(p.relevance || 0)}</b></span>
          <span>价值 <b style="color:var(--ink)">${Math.round(p.learning || 0)}</b></span>
          <span>难度 <b style="color:var(--ink)">${p.difficulty}</b></span>
          <span style="margin-left:auto">${statusTag(p.id)}</span>
        </div>
      </div>`).join('')}</div>`;
  } else {
    body = table(
      [{ t: '#', w: 40 }, { t: '论文' }, { t: '主题', w: 120 }, { t: '耦合', w: 90 }, { t: '价值', w: 90 }, { t: '难度', w: 60 }, { t: '状态', w: 84 }],
      slice.map((p, i) => [
        `<span class="muted">${(page - 1) * S.pageSize + i + 1}</span>`,
        `<div class="ttl" data-act="open" data-val="${p.id}" style="cursor:pointer;font-weight:600">${esc(p.title)}</div>
         <div class="tiny muted">${esc(dash(p.year))} · ${esc((p.venue || '未记录').slice(0, 46))}</div>`,
        tagTopic(p.topic),
        scoreBar(p.relevance || 0),
        scoreBar(p.learning || 0),
        dots(p.difficulty || 0),
        statusTag(p.id),
      ]), 'db');
  }

  const pager = `<div style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:12px">
      <span class="muted">共 ${total} 篇 · 第 ${page}/${pages} 页</span>
      <span style="margin-left:auto"></span>
      <button class="btn sm" data-page="${Math.max(1, page - 1)}"${page === 1 ? ' disabled' : ''}>上一页</button>
      <button class="btn sm" data-page="${Math.min(pages, page + 1)}"${page === pages ? ' disabled' : ''}>下一页</button>
    </div>`;

  return panel + `<div class="card" style="margin-top:14px">
      <div class="card-h"><h3>文献列表</h3><span class="hint">当前命中 ${total} 篇，点击标题查看详情</span></div>
      <div class="card-b">${body}${pager}</div></div>`;
};

/* ---------------------------------------------------------------- 文献对比 */
window.VIEWS_BASE.cmp = function (papers, cfg) {
  const all = papers;
  const picked = (S.cmp || []).map(id => BY[id]).filter(Boolean);
  const opt = sortPapers(all, 'relevance').slice(0, 120);

  const picker = card('选择文献', '可选 2–4 篇',
    `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <select id="cmpSelect" style="flex:1;min-width:260px;padding:5px 9px;border:1px solid var(--line);border-radius:7px;background:var(--panel2)">
        <option value="">— 选择一篇加入对比 —</option>
        ${opt.map(p => `<option value="${p.id}">[${esc(p.year || '?')}] ${esc(p.title.slice(0, 46))}</option>`).join('')}
      </select>
      <button class="btn primary sm" id="cmpAdd">加入</button>
      <button class="btn sm" id="cmpClear"${picked.length ? '' : ' disabled'}>清空</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${picked.map(p => `<span class="chip on">${esc(p.title.slice(0, 18))}…</span>`).join('') || '<span class="tiny muted">尚未选择</span>'}</div>`);

  if (picked.length < 2) {
    return picker + `<div class="card" style="margin-top:14px"><div class="card-b">${emptyBox('请至少选择 2 篇文献进行对比')}</div></div>`;
  }

  const rows = [
    ['发表年份', p => esc(dash(p.year))],
    ['期刊 / 会议', p => esc((p.venue || '—').slice(0, 40))],
    ['第一作者', p => esc((p.authors || '—').slice(0, 24))],
    ['一级主题', p => tagTopic(p.topic)],
    ['方法类型', p => tag(p.dl)],
    ['项目耦合度', p => scoreBar(p.relevance)],
    ['学习价值', p => scoreBar(p.learning)],
    ['阅读难度', p => dots(p.difficulty)],
    ['涉及环节', p => (p.stages || []).map(s => tag(STAGE_NAME[s] || s)).join(' ') || '—'],
    ['数据集', p => esc((p.datasets || []).join('、') || '—')],
    ['评价指标', p => esc((p.metrics || '—').slice(0, 60))],
    ['有开源代码', p => p.hasCode ? tag('有', 't-ok') : tag('未提及', 't-mute')],
    ['阅读状态', p => statusTag(p.id)],
  ];

  const head = ['对比项'].concat(picked.map(p => p.id));
  const body = rows.map(r => `<tr><th style="width:110px;text-align:left">${esc(r[0])}</th>${picked.map(p => `<td>${r[1](p)}</td>`).join('')}</tr>`).join('');

  return picker + `<div class="card" style="margin-top:14px">
      <div class="card-h"><h3>横向对比</h3><span class="hint">${picked.length} 篇</span></div>
      <div class="card-b"><table class="db"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody></table></div></div>`;
};

/* ---------------------------------------------------------------- 学习决策 */
window.VIEWS_BASE.decide = function (papers, cfg) {
  const all = papers;
  if (!all.length) return emptyBox('当前筛选下没有文献');

  const pts = all.filter(p => p.relevance != null).map(p => ({
    rl: p.relevance, df: p.difficulty || 3, lv: p.learning || 50,
    c: topicColor(p.topic), id: p.id, t: p.title, tp: topicName(p.topic),
  }));

  /* 图下不再配"右下象限最该先读"这类解读：坐标轴和颜色已经是全部信息，
     怎么读、先读哪篇是读者自己的决策，替他说一遍就是旁白。 */
  const scatter = card('耦合度 × 阅读难度', '气泡大小代表学习价值，颜色代表主题',
    chartBox(chartScatter(pts)));

  const order = sortPapers(all, 'priority').slice(0, 8);
  const list = card('精读推荐顺序', '按耦合度、学习价值与难度的加权结果',
    order.map((p, i) => `<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--line2);align-items:baseline">
        <span class="muted" style="flex:0 0 18px;font-variant-numeric:tabular-nums">${i + 1}</span>
        <div style="flex:1;min-width:0">
          <div data-act="open" data-val="${p.id}" style="cursor:pointer;font-weight:600;font-size:12.5px">${esc(p.title)}</div>
          <div class="tiny muted" style="margin-top:2px">${esc(dash(p.year))} · ${esc(topicName(p.topic))} · ${esc(p.dl)}</div>
        </div>
        <div style="flex:0 0 auto;text-align:right">${scoreBar(p.relevance)}</div>
      </div>`).join(''));

  // 三步路径：用数据自己算出"先读什么"，而不是凭感觉列。
  // 每步下面不再写筛选口径的灰字（V4.6.1 删）——口径想知道就点开论文看字段，
  // 写出来只是一行没人读的注释行。注意：注释里不要原样引用被禁短语，否则文案腔调门禁会命中。
  function miniList(title, arr) {
    return subTitle(title)
      + (arr.length
        ? arr.map(p => `<div data-act="open" data-val="${p.id}" style="cursor:pointer;padding:2px 0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(p.title)}">· ${esc(p.title)}</div>`).join('')
        : `<div class="tiny muted">（当前筛选下没有符合条件的）</div>`);
  }
  const rank = sortPapers(all, 'priority');
  const stepA = rank.filter(p => (p.difficulty || 5) <= 3).slice(0, 3);
  const stepB = rank.filter(p => (p.relevance || 0) >= Math.max(1, ...rank.map(x => x.relevance || 0)) * 0.85).slice(0, 3);
  const gapStages = (cfg.stages || []).map(s => ({ id: s.id, n: all.filter(p => (p.stages || []).indexOf(s.id) >= 0).length }))
    .filter(x => x.n > 0).sort((a, b) => a.n - b.n).slice(0, 1);
  const stepC = gapStages.length
    ? all.filter(p => (p.stages || []).indexOf(gapStages[0].id) >= 0).slice(0, 3) : [];
  const path = cardWide('三步阅读路径', '',
    miniList('第一步 · 打底', stepA)
    + miniList('第二步 · 主线', stepB)
    + miniList('第三步 · 补空白', stepC));

  // 环节缺口
  const gaps = (cfg.stages || []).map(s => ({
    name: s.name, n: all.filter(p => (p.stages || []).indexOf(s.id) >= 0).length,
  })).sort((a, b) => a.n - b.n).slice(0, 5);

  /* 底部那句"既意味着缺少方案，也意味着存在可发表的空间"是在替读者下判断，
     条形本身已经说明了篇数，结论交给读者自己想；副题"篇数越少越值得切入"
     也是同一个毛病，一并去掉。 */
  const gapCard = card('最缺文献支撑的环节', '',
    gaps.map(g => progRow(g.name, g.n <= 2 ? 'var(--bad)' : 'var(--accent)', g.n * 100 / Math.max(1, all.length), g.n + ' 篇')).join(''));

  // 左栏放两张卡（散点 + 路径），右栏放推荐列表，两栏高度才协调
  const leftCol = `<div>${scatter}${path}</div>`;
  return `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:start">${leftCol}${list}</div>`
    + `<div style="margin-top:14px">${gapCard}</div>`;
};

/* ---------------------------------------------------------------- 阅读进度 */
window.VIEWS_BASE.prog = function (papers, cfg) {
  const all = papers;
  const cnt = {};
  (cfg.statuses || []).forEach(s => { cnt[s] = 0; });
  P.forEach(p => { const s = statusOf(p.id); cnt[s] = (cnt[s] || 0) + 1; });

  const items = (cfg.statuses || []).map(s => ({ k: s, v: cnt[s] || 0, c: s === '已精读' ? 'var(--ok)' : s === '已初读' ? 'var(--accent2)' : s === '正在阅读' ? 'var(--accent)' : 'var(--muted)' })).filter(x => x.v > 0);

  const stat = card('阅读状态分布', '全部 ' + P.length + ' 篇',
    chartBox(chartDonut(items, { centerLabel: '篇' }), '状态保存在本机浏览器，换电脑会丢失，请定期导出'));

  const noted = P.filter(p => (S.notes[p.id] || '').trim()).length;
  const starred = Object.keys(S.star || {}).filter(k => S.star[k]).length;
  const kpiRow = grid(4, [
    kpi('已精读', cnt['已精读'] || 0, '篇', 'var(--ok)', 100),
    kpi('在读', cnt['正在阅读'] || 0, '篇', 'var(--accent)', 60),
    kpi('已写笔记', noted, '篇', 'var(--violet)', 60),
    kpi('收藏', starred, '篇', 'var(--warn)', 40),
  ].join(''));

  const list = sortPapers(P.filter(p => ['已初读', '已精读', '正在阅读'].indexOf(statusOf(p.id)) >= 0), 'year');
  const tableCard = card('阅读记录', list.length + ' 篇有进度',
    list.length ? table(
      [{ t: '论文' }, { t: '状态', w: 90 }, { t: '笔记', w: 60 }],
      list.map(p => [
        `<span class="ttl" data-act="open" data-val="${p.id}" style="cursor:pointer">${esc(p.title)}</span>`,
        statusTag(p.id),
        (S.notes[p.id] || '').trim() ? tag('有', 't-ok') : tag('无', 't-mute'),
      ]), 'db')
      : emptyBox('还没有任何阅读记录。打开任意论文，在「我的笔记」里标记状态即可。'));

  const tool = card('备份与导出', '换电脑或清理浏览器前务必导出',
    `<div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn primary" id="btnExportJson">导出进度备份</button>
      <button class="btn" id="btnExportCsv">导出当前文献表 CSV</button>
      <button class="btn" id="btnImport">导入备份</button>
      <button class="btn ghost" id="btnWipe">清除全部本地数据</button>
    </div>
    <input type="file" id="fileImport" accept=".json" style="display:none">
    <div class="tiny muted" style="margin-top:8px;line-height:1.7">
      备份内容包含：阅读状态、笔记、收藏、对比列表、权重设置。不包含论文数据本身（论文数据内嵌在 HTML 里）。
    </div>`);

  return kpiRow + grid(2, [stat, tool].join('')) + `<div style="margin-top:14px">${tableCard}</div>`;
};

/* ============================================================================
 * V3.0 四个新视图：研究现状 / 方向探索 / 外部文献 / 检索记录
 * ----------------------------------------------------------------------------
 * 共同约束（比 V2 更严，因为这三页会直接被写进报告）：
 *   1. 页面上出现的每个数字都必须能在数据里找到出处，不允许"大约""若干"；
 *   2. 任何"空白""机会""领先"之类的判断，必须紧跟着写出它的口径与反证条件；
 *   3. 数据文件缺失时给出明确指引，而不是渲染一张空图表。
 * ========================================================================== */

const APPD = () => window.APP;

/* ---------------------------------------------------------------- 研究现状 */
window.VIEWS_BASE.landscape = function (papers, cfg) {
  const L = APPD().LAND;
  if (!L || !(L.answers || []).length) {
    return emptyBox('本次构建没有生成研究现状报告。先运行 scripts/landscape.py <项目目录>，再重新构建。');
  }
  const sc = L.scope || {};
  const A = {};
  (L.answers || []).forEach(a => { A[a.id] = a; });

  /* 每张卡只留三样：标题、一句结论、一张图。
     问句（把标题又问一遍）、要点列表、逐问口径说明，都是在替读者复述图里已经有的数字，
     一律不渲染。这些字段仍留在 landscape.json 里，只是不上页面。 */
  const qblock = (a, body) => card('Q' + a.no + ' · ' + a.title, '',
    `<div class="qans">${esc(a.headline || '')}</div>`
    + (body ? `<div style="margin-top:10px">${body}</div>` : ''));

  /* 环形图 + 右侧图例列表。主题构成与质量标记结构相同，抽出来免得两边各写一遍 */
  const donutRows = (rows, act) => `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <div style="flex:0 0 190px;max-width:190px">${chartDonut(
      rows.map((r, i) => ({ k: r.name || r.k, v: r.v, c: r.color || seriesColor(i), code: r.k })),
      { act: act || '', centerLabel: '篇' })}</div>
      <div style="flex:1;min-width:170px">${rows.map((r, i) =>
        progRowDot(r.name || r.k, r.color || seriesColor(i), r.share || 0, r.v + ' 篇')).join('')}</div>
    </div>`;

  /* 数据集清单：名字后面直接跟「哪几篇」，读者不用再跳去数据库里搜一遍。
     篇数已经在上面条形图右侧标过，这里不重复写。 */
  const dsBlock = a => {
    const idTag = id => `<span class="dsid" data-act="open" data-val="${esc(id)}">${esc(id)}</span>`;
    const rows = (a.rows || []).map(r => `<div class="dsline">
        <span class="dsname">${esc(r.k)}${r.public === true ? '<i class="dspub">公开</i>'
      : r.public === false ? '<i class="dspriv">非公开</i>' : ''}</span>
        <span class="dsids">${(r.ids || []).map(idTag).join('')}</span>
      </div>`).join('');
    return `<div class="dsblock">${rows}</div>
      <div class="dsfoot">
        <div><b>有开源代码 ${a.codeCount || 0} 篇</b> ${(a.codeIds || []).map(idTag).join('') || '无'}</div>
        <div><b>未报告数据集 ${a.noDsCount || 0} 篇</b> ${(a.noDsIds || []).map(idTag).join('') || '无'}</div>
      </div>`;
  };

  /* 每问的图由数据的形状决定，而不是统一塞一个条形图 */
  const bodyOf = a => {
    if (!a || !a.rows || !a.rows.length) return '';
    if (a.id === 'q1') return donutRows(a.rows, 'topic');
    if (a.id === 'q3') return chartBox(chartTimeline(a.rows.map(r => ({ k: r.k, v: r.v }))));
    /* V4.12.1：交叉矩阵的列来自数据里的 dl（方法派别）受控字段。
       这个字段为空时矩阵只剩行头、肉眼像排版坏了 —— 退回条形图。 */
    if (a.id === 'q4' && a.cross && (a.dlCols || []).length) {
      const idx = {};
      a.cross.forEach(r => { idx[r.k] = {}; (r.cells || []).forEach(c => { idx[r.k][c.k] = c.v; }); });
      const matrix = heatMatrix(
        a.cross.map(r => ({ k: r.name, raw: r.k })),
        (a.dlCols || []).map(k => ({ k })),
        (row, col) => (idx[row.raw] || {})[col.k] || 0,
        { corner: '主题 ＼ 方法' }
      );
      return `<div class="landscape-matrix">
        <div class="landscape-matrix-note">共 ${(a.dlCols || []).length} 种方法；横向滚动表格可查看全部列，悬停列名可查看全称。</div>
        <div class="landscape-matrix-scroll" role="region" aria-label="主题与方法交叉表，可横向滚动" tabindex="0">${matrix}</div>
      </div>`;
    }
    if (a.id === 'q5') {
      return chartHBars(a.rows.map(r => ({ k: r.k, v: r.v, c: 'var(--accent)' })),
        { labelW: 108, rowH: 22 }) + dsBlock(a);
    }
    if (a.id === 'q8') return donutRows(a.rows, '');
    /* 行标签直接写环节全名。S1 这类编号在这里没有任何对照（对照块在图谱页），
       读者看到 S7 不知道是什么；全名比编号长，标签列相应加宽。 */
    return chartHBars(a.rows.map(r => ({
      k: r.name || r.k, v: r.v,
      c: r.id === 'q2' && r.thin ? 'var(--warn)' : 'var(--accent)',
    })), { labelW: 208, rowH: 24 });
  };

  const kpiRow = grid(5, [
    kpi('纳入分析', sc.paperCount || 0, '篇', 'var(--accent)', 100),
    kpi('时间跨度', sc.yearFrom + '—' + sc.yearTo, '年', 'var(--accent2)', 60),
    kpi('一级主题', sc.topicCount || 0, '类', 'var(--violet)', 50),
    kpi('技术环节', sc.stageCount || 0, '个', 'var(--warn)', 50),
    kpi('刊物/单位', (sc.venueCount || 0) + ' / ' + (sc.unitCount || 0), '个', 'var(--ok)', 40),
  ].join(''));

  /* 四条口径集中放页顶并编号。逐问的 caveat 不再单独渲染 —— 同一类提醒说十遍，
     读者会当成模板话跳过；集中说一次才有人看。数据里仍保留 caveat（校验脚本要求）。 */
  const boundary = cardWide('警告', '',
    `<ol style="margin:0;padding-left:22px;font-size:12px;line-height:2">${
      (L.boundary || []).map(b => `<li>${esc(b)}</li>`).join('')}</ol>`);

  /* 只剩 8 问（Q6 指标、Q9 共识已删），两两一行。缺哪个就跳过，不占位不留空卡 */
  const pair = (x, y) => {
    const s = [x, y].filter(k => A[k]).map(k => qblock(A[k], bodyOf(A[k]))).join('');
    return s ? grid(2, s) : '';
  };
  const row = (x, y) => { const s = pair(x, y); return s ? `<div style="margin-top:14px">${s}</div>` : ''; };

  const full = key => A[key] ? `<div class="landscape-full">${qblock(A[key], bodyOf(A[key]))}</div>` : '';
  return kpiRow + boundary + row('q1', 'q2') + full('q3') + full('q4')
    + row('q5', 'q6') + row('q7', 'q8');
};

/* ---------------------------------------------------------------- 方向探索 */
window.VIEWS_BASE.explore = function (papers, cfg) {
  const A0 = APPD();
  const DIRS = A0.DIRS || [];
  if (!DIRS.length) {
    return emptyBox('本次构建没有研究方向数据。先在 data/directions.json 里撰写方向树，运行 scripts/link.py，再重新构建。');
  }
  const S = A0.S;

  const keyOf = d => d.derived || {};
  const sortKey = S.dirSort || 'opp';
  const valOf = d => {
    if (sortKey === 'novelty') return d.novelty || 0;
    if (sortKey === 'local') return keyOf(d).localCount || 0;
    if (sortKey === 'ext') return keyOf(d).externalCount || 0;
    return keyOf(d).opportunityScore || 0;
  };
  const roots = DIRS.filter(d => !d.parentId || d.level === 1)
    .slice().sort((a, b) => valOf(b) - valOf(a));
  const kidsOf = id => DIRS.filter(d => d.parentId === id).slice().sort((a, b) => valOf(b) - valOf(a));

  /* --- 树 --- */
  /* 编号用父子层级式（1 / 1.1 / 1.2 / 2 …），不用 1..9 顺序号：
     顺序号会把左列打成 1、4、7，读者反而以为中间漏了节点。 */
  const ordered = [];
  const idxOf = {};
  roots.forEach((r, ri) => {
    idxOf[r.id] = String(ri + 1);
    ordered.push(r);
    kidsOf(r.id).forEach((k, ki) => { idxOf[k.id] = (ri + 1) + '.' + (ki + 1); ordered.push(k); });
  });
  const nodes = ordered.map(d => ({
    id: d.id, name: d.name, level: d.level, parentId: d.parentId, idx: idxOf[d.id],
    opp: keyOf(d).opportunityScore || 0, novelty: d.novelty || 50, risk: d.risk || 50,
    local: keyOf(d).localCount || 0, ext: keyOf(d).externalCount || 0,
    sel: S.dirSel === d.id,
  }));
  const nRoot = ordered.filter(d => !d.parentId || d.level === 1).length;
  const treeCard = cardWide('研究方向树',
    `${nodes.length} 个节点（一级 ${nRoot} · 子方向 ${nodes.length - nRoot}）· 枝粗＝机会分 · 点节点展开论证`,
    /* 图例说明（枝粗/枝色/节点高/边框各代表什么）删掉了：这一行四句话读者不会读，
       真想弄懂图例的点开一个节点看数字对得上即可，保留它只是给页面添一行灰字。 */
    chartBox(chartTree(nodes)));

  /* --- 工具条 --- */
  const sortChip = (k, t) => `<button class="chip${sortKey === k ? ' on' : ''}"
      data-act="state" data-k="dirSort" data-val="${k}">${esc(t)}</button>`;
  const toolbar = card('方向清单', DIRS.length + ' 个方向',
    `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <span class="tiny muted">排序</span>
      ${sortChip('opp', '机会分')}${sortChip('novelty', '创新潜力')}${sortChip('local', '本库支撑')}${sortChip('ext', '外部文献')}
    </div>`
    + roots.map(r => {
      const k = keyOf(r);
      const kids = kidsOf(r.id);
      return `<div class="dircard${S.dirSel === r.id ? ' sel' : ''}" data-act="dir-open" data-val="${esc(r.id)}"
          style="border-left-color:${noveltyColor(r.novelty || 50)}">
          <div class="dh">${esc(r.name)}${A0.dirFaved(r.id) ? ' <span style="color:var(--warn)">★</span>' : ''}</div>
          <div class="dl2">${esc(r.oneLine || '')}</div>
          <div class="dm">
            <span>机会 <b>${Math.round(k.opportunityScore || 0)}</b></span>
            <span>创新 <b>${r.novelty || 0}</b></span>
            <span>风险 <b>${r.risk || 0}</b></span>
            <span>库内 <b>${k.localCount || 0}</b></span>
            <span>外部 <b>${k.externalCount || 0}</b></span>
          </div>
        </div>`
        + kids.map(c => {
          const kc = keyOf(c);
          return `<div class="dircard${S.dirSel === c.id ? ' sel' : ''}" data-act="dir-open" data-val="${esc(c.id)}"
              style="margin-left:20px;border-left-color:${noveltyColor(c.novelty || 50)};padding:8px 11px">
              <div class="dh" style="font-size:12px">${esc(c.name)}${A0.dirFaved(c.id) ? ' <span style="color:var(--warn)">★</span>' : ''}</div>
              <div class="dl2" style="font-size:11px">${esc(c.oneLine || '')}</div>
              <div class="dm">
                <span>机会 <b>${Math.round(kc.opportunityScore || 0)}</b></span>
                <span>创新 <b>${c.novelty || 0}</b></span>
                <span>外部 <b>${kc.externalCount || 0}</b></span>
              </div>
            </div>`;
        }).join('');
    }).join(''));

  /* --- 选中方向的完整论证 --- */
  const d = S.dirSel ? A0.DIR_BY[S.dirSel] : null;
  let detail;
  if (!d) {
    detail = card('方向详情', '', emptyBox('从左侧清单或上方树里点一个方向，这里会展开它的完整论证：'
      + '要解决什么问题、为什么是机会、怎么起步、最小实验是什么。'));
  } else {
    const k = keyOf(d);
    const localPapers = (d.localSupport || {}).paperIds || [];
    const extIds = (d.externalEvidence || {}).recommendedExternalIds || [];
    /* 卡片顶部的「收藏 / 加入对比」两个按钮已去掉：方向对比在下方有专门的
       对照区，收藏又不会改变任何结论，两个按钮只是占地方。 */
    detail = card(d.name, (d.level === 1 ? '一级方向' : '子方向') + ' · 机会分 ' + Math.round(k.opportunityScore || 0),
      `<div class="tiny muted" style="line-height:1.85">${esc(d.oneLine || '')}</div>`
      + sep()
      + subTitle('要解决的问题') + `<div style="font-size:12.5px;line-height:1.85">${esc(d.problem || '—')}</div>`
      + subTitle('为什么可能是机会') + `<div style="font-size:12.5px;line-height:1.85">${esc(d.whyOpportunity || '—')}</div>`
      + (k.riskNote ? note(esc(k.riskNote), 'warn') : '')
      + subTitle('技术路线')
      + `<ol style="margin:0;padding-left:20px;font-size:12.5px;line-height:1.95">${
        (d.techRoute || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol>`
      + subTitle('最小可验证实验') + `<div style="font-size:12.5px;line-height:1.85">${esc(d.minExperiment || '—')}</div>`
      + subTitle('预期产出') + `<div style="font-size:12.5px;line-height:1.85">${esc(d.expectedOutput || '—')}</div>`
      + sep()
      /* 这四个数原来是紧接正文的一行裸数字，看不出在说哪件事；补一句抬头并加底色，
         让读者知道这是"风险画像"而不是又一段结论。 */
      + `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:11px;
          color:var(--muted);background:var(--panel2);border-radius:8px;padding:7px 10px">
          <span style="color:var(--ink);font-weight:600">风险画像</span>
          <span>创新潜力 <b style="color:var(--ink)">${d.novelty || 0}</b></span>
          <span>成熟度 <b style="color:var(--ink)">${d.maturity || 0}</b></span>
          <span>风险 <b style="color:var(--ink)">${d.risk || 0}</b></span>
          <span>外部拥挤度 <b style="color:var(--ink)">${k.crowdedness || 0}%</b></span>
        </div>`
      + subTitle('本库支撑（' + localPapers.length + ' 篇）')
      + (localPapers.length
        ? localPapers.map(id => {
          const p = A0.BY[id];
          if (!p) return '';
          return `<div data-act="open" data-val="${id}" style="cursor:pointer;padding:3px 0;font-size:11.5px;
              border-bottom:1px solid var(--line2)">· ${esc(p.title)}</div>`;
        }).join('')
        : `<div class="tiny muted">本批文献里没有直接支撑，这正是机会所在，也意味着起步要自己搭基线。</div>`)
      + subTitle('外部推荐（' + extIds.length + ' 篇）')
      + (extIds.length
        ? extIds.slice(0, 8).map(id => {
          const e = A0.EXT_BY[id];
          if (!e) return '';
          return `<div data-act="open" data-val="${id}" style="cursor:pointer;padding:3px 0;font-size:11.5px;
              border-bottom:1px solid var(--line2)">· ${esc((e.title || '').slice(0, 74))}
              <span class="tiny muted">${esc(e.year || '')}</span></div>`;
        }).join('') + (extIds.length > 8
          ? `<div class="tiny muted" style="margin-top:4px">另有 ${extIds.length - 8} 篇见「外部文献」页</div>` : '')
        : `<div class="tiny muted">外部检索没有命中与之对应的文献。这可能是真空白，也可能是检索词没覆盖到 ——
            两种情况处理方式完全不同，不要直接当成"没人做过"。</div>`));
  }

  const col = `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.12fr);gap:14px;align-items:start">
      ${toolbar}${detail}</div>`;

  /* --- 方向对比 --- */
  const cmpIds = S.dirCmp || [];
  let cmpCard = '';
  if (cmpIds.length >= 2) {
    const ds = cmpIds.map(id => A0.DIR_BY[id]).filter(Boolean);
    const rows = [
      ['层级', x => tag(x.level === 1 ? '一级' : '子方向', 't-topic')],
      ['机会分', x => scoreBar(keyOf(x).opportunityScore || 0)],
      ['创新潜力', x => scoreBar(x.novelty || 0)],
      ['成熟度', x => scoreBar(x.maturity || 0)],
      ['风险', x => scoreBar(x.risk || 0, 'var(--bad)')],
      ['本库支撑', x => (keyOf(x).localCount || 0) + ' 篇'],
      ['外部文献', x => (keyOf(x).externalCount || 0) + ' 篇'],
      ['外部拥挤度', x => (keyOf(x).crowdedness || 0) + '%'],
      ['最小实验', x => esc((x.minExperiment || '—').slice(0, 90))],
    ];
    cmpCard = cardWide('方向横向对比', ds.length + ' 个方向',
      /* 清空按钮原来夹在表格与说明之间，像一行游离的孤元素；
         挪到表格右上方，和表格形成一组。 */
      `<div style="display:flex;justify-content:flex-end;margin:-4px 0 8px">`
      + `<button class="btn sm ghost" data-act="state" data-k="dirCmp" data-clear="1">清空对比</button></div>`
      + `<table class="db"><thead><tr><th style="width:96px">对比项</th>${
        ds.map(x => `<th>${esc(x.name)}</th>`).join('')}</tr></thead><tbody>${
        rows.map(r => `<tr><th style="text-align:left;font-weight:500">${esc(r[0])}</th>${
          ds.map(x => `<td>${r[1](x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      + note('对比只用于并排看清差异，不产生"综合排名"。机会分是加权公式的结果，换一组权重排序就可能变，'
        + '不要把它当成客观真理。', 'info'));
  } else if (cmpIds.length === 1) {
    cmpCard = cardWide('方向横向对比', '已选 1 个',
      note('再选一个方向即可并排对比（最多 4 个）。', 'info'));
  }

  return treeCard + col + cmpCard;
};

/* ---------------------------------------------------------------- 外部文献 */
window.VIEWS_BASE.external = function (papers, cfg) {
  const A0 = APPD();
  const EXT = (A0.EXT || []).slice();
  if (!EXT.length) {
    return emptyBox('本次构建没有外部文献数据。运行 scripts/discover.py <项目目录> --en "…" 之后重新构建。');
  }
  const S = A0.S;
  const SESSION = A0.SESSION || {};

  const total = e => (S.extSort === 'total' ? A0.extTotal(e) : (e.score || {}).total || 0);
  const recalc = EXT.map(e => ({ e, t: A0.extTotal(e) }));
  recalc.sort((a, b) => {
    if (S.extSort === 'relevance') return ((b.e.score || {}).relevance || 0) - ((a.e.score || {}).relevance || 0);
    if (S.extSort === 'recency') return ((b.e.score || {}).recency || 0) - ((a.e.score || {}).recency || 0);
    if (S.extSort === 'citations') return (b.e.citationCount || 0) - (a.e.citationCount || 0);
    return b.t - a.t;
  });
  const pool = recalc.filter(x => {
    if (S.extAccess && S.extAccess !== 'all' && x.e.accessStatus !== S.extAccess) return false;
    if (S.extDir && (x.e.directionIds || []).indexOf(S.extDir) < 0) return false;
    return true;
  });

  const nOa = EXT.filter(e => e.accessStatus === 'open_access').length;
  const nPay = EXT.filter(e => e.accessStatus === 'paywalled').length;
  const nUnk = EXT.filter(e => e.accessStatus === 'unknown').length;

  const kpiRow = grid(5, [
    kpi('推荐文献', EXT.length, '篇', 'var(--accent)', 100),
    kpi('开放获取', nOa, '可直接读全文', 'var(--ok)', nOa * 100 / Math.max(1, EXT.length)),
    kpi('需订阅', nPay, '篇', 'var(--warn)', nPay * 100 / Math.max(1, EXT.length)),
    kpi('状态未知', nUnk, '篇', 'var(--muted)', nUnk * 100 / Math.max(1, EXT.length)),
    kpi('候选池', (A0.EXT_CAND || []).length, '篇中选出', 'var(--violet)', 60),
  ].join(''));

  /* 漏斗只列数据里真有的那几跳：旧版 search_session.json 没有前三个字段，
     缺的跳直接不出现，不能拿别的数字顶上（那正是原来名实不符的成因）。 */
  const funnelText = [
    ['原始命中', SESSION.rawHitCount],
    ['跨源去重', SESSION.uniqueHitCount],
    ['过硬性筛选', SESSION.passedScreeningCount],
    ['候选池', SESSION.candidateCount || EXT.length],
    ['推荐', EXT.length],
  ].filter(x => x[1] != null).map(x => x[0] + ' ' + x[1]).join(' → ');

  /* 检索概览卡不再带页间导航提示（V4.6.1 删）：这是页面之间的使用说明，
     不是这张卡的数据，读者第一次找不到检索记录页时自然会翻侧栏。 */
  const head = cardWide('检索概览', '',
    kvList([
      ['检索日期', esc(SESSION.searchDate || '—')],
      ['检索词', String((SESSION.searchQueries || []).length) + ' 组'],
      ['成功的数据源', esc((SESSION.sourcesSucceeded || []).join('、') || '—')],
      ['硬性排除', String(SESSION.excludedCount || 0) + ' 篇（撤稿／跨年／相关度过低／研究对象不符）'],
    ], 2)
    /* 漏斗单独占一行。塞进 kvList 的 92px 标签列里会被折成三行，
       而且原来那个"原始命中 → 去重后"标签配的是候选池数字，名实不符。 */
    + `<div class="tiny muted" style="margin-top:8px;line-height:1.9;font-variant-numeric:tabular-nums">`
    + '检索漏斗：' + funnelText + '</div>');

  /* --- 权重调节 --- */
  const W = S.extW || {};
  /* "时效"这个词读者不知道在说什么（是论文发表得新？还是数据新？），
     所以在标签上写明"发表时效"，并把口径挂在 title 里——不占版面，悬停可见。 */
  const wRow = (k, label, tip) => `<div class="wrow">
      <span class="wn"${tip ? ` title="${esc(tip)}"` : ''}>${esc(label)}</span>
      <input type="range" min="0" max="40" step="5" value="${W[k] || 0}" data-extw="${k}">
      <span class="wv" data-extwv="${k}">${W[k] || 0}</span>
    </div>`;
  /* 评分权重卡副题删掉（V4.6.1）：滑杆旁边数字实时在变，交互结果自己会说话。 */
  const weightCard = card('评分权重', '',
    wRow('relevance', '相关性', '标题/摘要与本方向术语的覆盖程度')
    + wRow('subdirection', '子方向匹配', '命中的是本方向下的哪个子方向')
    + wRow('dataScenario', '数据场景', '数据形态与本项目是否同一类')
    + wRow('learning', '学习价值', '方法是否可复用到本项目')
    + wRow('evidence', '证据质量', '元数据完整度：有 DOI、有摘要、有出处')
    + wRow('recency', '发表时效', '发表年份越近越高，与论文本身的新颖性无关')
    + `<div style="display:flex;gap:8px;margin-top:9px">
        <button class="btn sm" data-act="state" data-k="extW" data-clear="1">恢复默认</button>
      </div>`);

  const accessChip = (v, t) => `<button class="chip${(S.extAccess || 'all') === v ? ' on' : ''}"
      data-act="state" data-k="extAccess" data-val="${v}">${esc(t)}</button>`;
  const dirChip = (v, t, on) => `<button class="chip${on ? ' on' : ''}"
      data-act="state" data-k="extDir" data-val="${esc(v)}">${esc(t)}</button>`;
  const dirCount = {};
  EXT.forEach(e => (e.directionIds || []).forEach(id => { dirCount[id] = (dirCount[id] || 0) + 1; }));
  const filterCard = card('筛选与导出', '命中 ' + pool.length + ' / ' + EXT.length + ' 篇',
    `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <span class="tiny muted" style="flex:0 0 62px">获取方式</span>
      ${accessChip('all', '全部')}${accessChip('open_access', '开放获取 ' + nOa)}
      ${accessChip('paywalled', '需订阅 ' + nPay)}${accessChip('unknown', '未知 ' + nUnk)}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <span class="tiny muted" style="flex:0 0 62px">方向</span>
      ${dirChip('', '全部', !S.extDir)}
      ${(A0.DIRS || []).filter(d => dirCount[d.id]).map(d => dirChip(d.id, d.name.slice(0, 10) + ' ' + dirCount[d.id], S.extDir === d.id)).join('')}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <span class="tiny muted" style="flex:0 0 62px">排序</span>
      ${[['total', '加权总分'], ['relevance', '原始相关度'], ['recency', '发表时效'], ['citations', '被引']].map(x =>
      `<button class="chip${S.extSort === x[0] ? ' on' : ''}" data-act="state" data-k="extSort" data-val="${x[0]}">${x[1]}</button>`).join('')}
    </div>`
    + sep()
    + `    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn primary sm" id="btnExtCsv">导出当前列表 CSV</button>
      <button class="btn sm" id="btnExtBib">导出 BibTeX</button>
      <button class="btn sm" id="btnExtRis">导出 RIS</button>
    </div>`);

  /* --- 列表 --- */
  const accessColor = s => s === 'open_access' ? 'var(--ok)' : s === 'paywalled' ? 'var(--warn)' : 'var(--muted)';
  const list = pool.length
    ? pool.map(({ e, t }) => {
      const sc = e.score || {};
      /* 六维是相关性/子方向/数据场景/学习价值/证据质量/时效。原来把"加权总分"
         当成第七格塞进同一个 3 列网格，结果证据质量被挤到第二行以外、页面根本不显示。 */
      const dims = [
        ['相关性', sc.relevance], ['子方向', sc.subdirectionMatch],
        ['数据场景', sc.dataScenarioFit], ['学习价值', sc.learningValue],
        ['证据质量', sc.evidenceQuality], ['发表时效', sc.recency],
      ];
      return `<div class="extcard" style="border-left:3px solid ${accessColor(e.accessStatus)}">
        <div class="etop">
          <div class="et" data-act="open" data-val="${esc(e.id)}" style="cursor:pointer">${esc(e.title || '(无标题)')}</div>
          <div class="etot"><b>${sc.total == null ? '—' : Math.round(t)}</b><i>加权总分</i></div>
        </div>
        <div class="em">${esc(e.year || '—')} · ${esc((e.venue || '出处未记录').slice(0, 52))}${
        (e.authors || []).length ? ' · ' + esc(e.authors[0]) : ''}</div>
        <div class="eb">
          ${tag(accessLabel(e.accessStatus), e.accessStatus === 'open_access' ? 't-ok' : e.accessStatus === 'paywalled' ? 't-warn' : 't-mute')}
          ${(e.directionIds || []).slice(0, 3).map(id => {
          const d = A0.DIR_BY[id];
          return colorTag(d ? d.name.slice(0, 12) : id, '#6b4bbd');
        }).join('')}
          ${e.alreadyInLocalLibrary ? tag('已在本地库', 't-topic') : ''}
          ${(sc.penalties || []).length ? tag('已降权', 't-bad') : ''}
        </div>
        <div class="es">${dims.map(d2 => `<div>${esc(d2[0])}<b>${d2[1] == null ? '—' : Math.round(d2[1])}</b></div>`).join('')}</div>
        <div style="margin-top:9px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn sm" data-act="open" data-val="${esc(e.id)}">查看详情</button>
          ${e.doi ? `<a class="btn sm ghost" href="https://doi.org/${esc(e.doi)}" target="_blank" rel="noopener noreferrer">DOI</a>` : ''}
          ${e.openAccessPdfUrl ? `<a class="btn sm ghost" href="${esc(e.openAccessPdfUrl)}" target="_blank" rel="noopener noreferrer">开放获取 PDF</a>` : ''}
        </div>
      </div>`;
    }).join('')
    : emptyBox('当前筛选下没有文献，换个条件试试');

  return kpiRow + head
    + grid(2, [weightCard, filterCard].join(''))
    + `<div class="card" style="margin-top:14px">
        <div class="card-h"><h3>推荐清单</h3><span class="hint">共 ${pool.length} 篇 · 按${
      S.extSort === 'total' ? '当前权重下的总分' : '所选指标'}排序</span></div>
        <div class="card-b">${list}</div></div>`;
};

/* ---------------------------------------------------------------- 检索记录 */
window.VIEWS_BASE.session = function (papers, cfg) {
  const A0 = APPD();
  const S = A0.SESSION;
  if (!S) {
    return emptyBox('本次构建没有检索记录。运行 scripts/discover.py 后会生成 data/search_session.json。');
  }
  const cands = A0.EXT_CAND || [];
  const recIds = {};
  (A0.EXT || []).forEach(e => { recIds[e.id] = 1; });

  /* researchQuery 是 discover.py 用 " | " 拼起来的全部检索组。
     六组串成一行会占三行、内容又和上面的有序表完全重复，只留第一组打头。 */
  const rqList = String(S.researchQuery || '').split('|').map(x => x.trim()).filter(Boolean);
  const rqText = rqList.length > 1
    ? rqList[0] + '（共 ' + rqList.length + ' 组，见上表）'
    : (rqList[0] || '—');

  /* 漏斗五格：只报"合并 53 条"这类单点数字，读者没法自己复核总量，
     因为中间少一格就减不通。能一路减到底，这页才起到存档作用。 */
  const kpiRow = grid(5, [
    kpi('原始命中', S.rawHitCount || '—', '条', 'var(--muted)', 100),
    kpi('跨源去重', S.uniqueHitCount || '—', '合并 ' + (S.duplicateCount || 0) + ' 条', 'var(--violet)', 90),
    kpi('通过硬性筛选', S.passedScreeningCount || '—', '排除 ' + (S.excludedCount || 0) + ' 条', 'var(--accent2)', 55),
    kpi('进入候选池', S.candidateCount || 0, '上限 50 篇', 'var(--accent)', 40),
    kpi('正式推荐', S.recommendedCount || 0, '篇', 'var(--ok)', 30),
  ].join(''));

  const qCard = card('实际执行的检索词', '检索日期 ' + (S.searchDate || '—') + ' · '
    + (S.searchQueries || []).length + ' 组',
    `<ol style="margin:0;padding-left:20px;font-size:12px;line-height:1.95">${
      (S.searchQueries || []).map(q => `<li>${esc(q)}</li>`).join('')}</ol>`
    + sep()
    + `<div class="tiny muted" style="line-height:1.8">研究主题：${esc(rqText)}</div>`
    + (S.coreTerms || S.platformTerms
      ? `<div class="tiny muted" style="line-height:1.8">平台词：${esc((S.platformTerms || S.coreTerms || []).join(' '))}<br>
          对象词：${esc((S.objectTerms || []).join(' ') || '（未设置，不做对象硬性排除）')}</div>` : ''));

  const srcRows = (S.sourcesAttempted || []).map(s => {
    const ok = (S.sourcesSucceeded || []).indexOf(s) >= 0;
    const fail = (S.sourcesFailed || []).filter(f => f.source === s);
    return [esc(s), ok ? tag('成功', 't-ok') : tag('失败', 't-bad'),
      esc(fail.length ? (fail[0].error || '') : '—')];
  });
  /* 三张卡片右上角的提示语全部去掉：那些话是在替读者解释该怎么看这张表，
     而卡片标题本身已经说清楚了内容是什么。 */
  const srcCard = card('数据源与请求结果', '', srcRows.length
    ? table([{ t: '数据源' }, { t: '状态', w: 70 }, { t: '失败原因' }], srcRows)
    : emptyBox('没有数据源记录'));

  const ruleCard = card('筛选规则', '',
    `<ul style="margin:0;padding-left:18px;font-size:11.5px;line-height:1.95">${
      (S.selectionRules || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul>`);

  /* 标题不写"漏了什么"——那是自责口吻，读起来像检讨；
     内容是本次检索覆盖不到的地方，直接叫"本次检索不足"。 */
  const limitCard = card('本次检索不足', '',
    `<ul style="margin:0;padding-left:18px;font-size:11.5px;line-height:1.95">${
      (S.coverageLimitations || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul>`);

  const exRows = (S.excludedSample || []).map(x => [
    `<span style="font-size:11.5px" title="${esc(x.title || '')}">${esc(clip(x.title, 120))}</span>`,
    `<span class="tiny muted">${esc(x.reason || '')}</span>`]);
  const exCard = cardWide('被硬性排除的条目（样例）', '共 ' + (S.excludedCount || 0) + ' 条', exRows.length
    ? table([{ t: '标题' }, { t: '排除理由', w: 300 }], exRows, 'db')
    : emptyBox('没有排除记录'));

  const rejRows = (S.rejectedSample || []).map(x => [
    `<span style="font-size:11.5px" title="${esc(x.title || '')}">${esc(clip(x.title, 120))}</span>`,
    `<span class="tiny muted">${esc(x.reason || '')}</span>`]);
  const rejCard = cardWide('进入候选池但未入选', '多样性上限或排序靠后', rejRows.length
    ? table([{ t: '标题' }, { t: '原因', w: 220 }], rejRows, 'db')
    : emptyBox('没有记录'));

  const candRows = cands.slice(0, 50).map((e, i) => [
    `<span class="muted" style="font-variant-numeric:tabular-nums">${i + 1}</span>`,
    `<span class="ttl" data-act="open" data-val="${esc(e.id)}" style="cursor:pointer;font-size:11.5px">${esc(clip(e.title, 110))}</span>`,
    esc(e.year || '—'),
    String((e.score || {}).total == null ? '—' : (e.score || {}).total),
    recIds[e.id] ? tag('已推荐', 't-ok') : tag('未入选', 't-mute'),
  ]);
  const candCard = cardWide('候选池全表', cands.length + ' 条（候选池上限 50）', candRows.length
    ? table([{ t: '#', w: 34 }, { t: '标题' }, { t: '年份', w: 60 }, { t: '总分', w: 60 }, { t: '结果', w: 72 }], candRows, 'db')
    : emptyBox('没有候选池数据'));

  return kpiRow
    + grid(2, [qCard, srcCard].join(''))
    + `<div style="margin-top:14px">${grid(2, [ruleCard, limitCard].join(''))}</div>`
    + exCard + rejCard
    + candCard
    + note('把这一页和「研究现状」页一起存档：前者说明数据从哪来、怎么筛的，后者说明这批数据能支撑什么结论。'
      + '只留结论不留下检索记录，报告无法复核。', 'info');
};

/* ============================================================================
 * 以下为交互补丁：对比选择、进度导出。不属于任何视图，在每次渲染后执行。
 * ========================================================================== */
window.afterRender = function () {
  const add = document.getElementById('cmpAdd');
  if (add) {
    add.onclick = function () {
      const sel = document.getElementById('cmpSelect');
      const id = sel && sel.value;
      if (!id) return toast('请先选择一篇文献');
      if ((S.cmp || []).indexOf(id) >= 0) return toast('已在对比列表中');
      if ((S.cmp || []).length >= 4) return toast('最多对比 4 篇');
      S.cmp = (S.cmp || []).concat([id]);
      saveState(); render();
    };
  }
  const clr = document.getElementById('cmpClear');
  if (clr) clr.onclick = function () { S.cmp = []; saveState(); render(); };

  const ej = document.getElementById('btnExportJson');
  if (ej) ej.onclick = function () {
    const data = { status: S.status, notes: S.notes, star: S.star, cmp: S.cmp, weights: S.weights, exported: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '阅读进度备份_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
  };
  const ec = document.getElementById('btnExportCsv');
  if (ec) ec.onclick = function () { exportCSV(); };
  const bi = document.getElementById('btnImport');
  const fi = document.getElementById('fileImport');
  if (bi && fi) {
    bi.onclick = function () { fi.click(); };
    fi.onchange = function () {
      const f = fi.files && fi.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = function () {
        try {
          const o = JSON.parse(rd.result);
          S.status = o.status || {}; S.notes = o.notes || {}; S.star = o.star || {};
          S.cmp = o.cmp || []; if (o.weights) S.weights = o.weights;
          saveState(); render(); toast('已导入备份');
        } catch (e) { toast('备份文件无法解析'); }
      };
      rd.readAsText(f);
    };
  }
  const wb = document.getElementById('btnWipe');
  if (wb) wb.onclick = function () {
    if (!confirm('将清除本机的阅读状态、笔记与收藏，且无法恢复。确定继续？')) return;
    S.status = {}; S.notes = {}; S.star = {}; S.cmp = [];
    saveState(); render(); toast('已清除本地数据');
  };

  /* ---- V3.0 外部文献页：权重滑块与三种导出 ---- */
  document.querySelectorAll('[data-extw]').forEach(inp => {
    const k = inp.dataset.extw;
    // 拖动时只更新右侧数字（便宜），松手才重排（贵）。否则每移动 1px 就整页重绘。
    inp.oninput = function () {
      const lab = document.querySelector('[data-extwv="' + k + '"]');
      if (lab) lab.textContent = inp.value;
    };
    inp.onchange = function () {
      S.extW = S.extW || {};
      S.extW[k] = Number(inp.value) || 0;
      saveState(); render();
    };
  });
  const bc = document.getElementById('btnExtCsv');
  if (bc) bc.onclick = function () { exportExtList('csv'); };
  const bb = document.getElementById('btnExtBib');
  if (bb) bb.onclick = function () { exportExtList('bib'); };
  const br = document.getElementById('btnExtRis');
  if (br) br.onclick = function () { exportExtList('ris'); };
};

/* ============================================================================
 * 外部文献导出（CSV / BibTeX / RIS）
 * ----------------------------------------------------------------------------
 * 只导出检索到的元数据与评分，不导出全文，也不补全任何缺失字段：
 * 卷期页码在数据库返回里就常常是空的，凭空补等于造假。
 * ========================================================================== */
function currentExtList() {
  const A0 = window.APP;
  const S = A0.S;
  return (A0.EXT || []).filter(e => {
    if (S.extAccess && S.extAccess !== 'all' && e.accessStatus !== S.extAccess) return false;
    if (S.extDir && (e.directionIds || []).indexOf(S.extDir) < 0) return false;
    return true;
  }).map(e => ({ e, t: A0.extTotal(e) }))
    .sort((a, b) => b.t - a.t);
}

function dlFile(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

function exportExtList(kind) {
  const rows = currentExtList();
  if (!rows.length) return toast('当前筛选下没有可导出的文献');
  const stamp = new Date().toISOString().slice(0, 10);
  const base = '外部文献_补充推荐_' + stamp;

  if (kind === 'csv') {
    const head = ['编号', '标题', '作者', '年份', '期刊/会议', 'DOI', '访问状态',
      '开放获取链接', '加权总分', '相关度', '子方向匹配', '数据场景', '学习价值', '证据质量', '时效',
      '关联方向', '来源库', '检索日期', '摘要'];
    const lines = [head.join(',')];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    rows.forEach(({ e, t }) => {
      const s = e.score || {};
      const dirs = (e.directionIds || []).map(id => {
        const d = window.APP.DIR_BY[id]; return d ? d.name : id;
      }).join(' / ');
      lines.push([e.id, e.title, (e.authors || []).join('; '), e.year, e.venue, e.doi,
        accessLabel(e.accessStatus), e.openAccessPdfUrl, t, s.relevance, s.subdirectionMatch,
        s.dataScenarioFit, s.learningValue, s.evidenceQuality, s.recency, dirs,
        e.sourceDatabase, e.retrievedAt, e.abstract].map(q).join(','));
    });
    dlFile(base + '.csv', '\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    return toast('已导出 ' + rows.length + ' 条 CSV');
  }

  const authorSplit = a => {
    const t = String(a || '').trim();
    if (!t) return '';
    const parts = t.split(/\s+/);
    if (parts.length < 2) return t;
    const last = parts.pop();
    return last + ', ' + parts.join(' ');
  };
  const bibKey = e => {
    const fam = String(((e.authors || [])[0] || 'anon').split(/\s+/).pop() || 'anon')
      .replace(/[^A-Za-z]/g, '').toLowerCase();
    const w = String(e.title || 'untitled').split(/\s+/)[0].replace(/[^A-Za-z]/g, '').toLowerCase();
    return fam + (e.year || '') + w;
  };

  if (kind === 'bib') {
    const out = rows.map(({ e }) => {
      const type = e.type === 'preprint' ? 'misc' : 'article';
      const f = [
        '@' + type + '{' + bibKey(e) + ',',
        '  title   = {' + String(e.title || '').replace(/[{}]/g, '') + '},',
        '  author  = {' + (e.authors || []).map(authorSplit).filter(Boolean).join(' and ') + '},',
      ];
      if (e.venue) f.push('  journal = {' + String(e.venue).replace(/[{}]/g, '') + '},');
      if (e.year) f.push('  year    = {' + e.year + '},');
      if (e.doi) f.push('  doi     = {' + e.doi + '},');
      if (e.paperUrl) f.push('  url     = {' + e.paperUrl + '},');
      f.push('  note    = {检索自 ' + (e.sourceDatabase || '数据库') + '，' + (e.retrievedAt || '') + '，附加评分 ' + window.APP.extTotal(e) + '/100，未核验全文},');
      f.push('}');
      return f.join('\n');
    }).join('\n\n');
    dlFile(base + '.bib', out, 'application/x-bibtex;charset=utf-8');
    return toast('已导出 ' + rows.length + ' 条 BibTeX');
  }

  const ris = rows.map(({ e }) => {
    const L = ['TY  - ' + (e.type === 'preprint' ? 'UNPB' : 'JOUR')];
    L.push('TI  - ' + (e.title || ''));
    (e.authors || []).forEach(a => { const n = authorSplit(a); if (n) L.push('AU  - ' + n); });
    if (e.year) L.push('PY  - ' + e.year);
    if (e.venue) L.push('JO  - ' + e.venue);
    if (e.doi) L.push('DO  - ' + e.doi);
    if (e.paperUrl) L.push('UR  - ' + e.paperUrl);
    if (e.abstract) L.push('AB  - ' + String(e.abstract).replace(/\s+/g, ' '));
    L.push('N1  - 检索自 ' + (e.sourceDatabase || '') + '（' + (e.retrievedAt || '') + '），附加评分 ' + window.APP.extTotal(e) + '/100');
    L.push('ER  - ');
    return L.join('\n');
  }).join('\n\n');
  dlFile(base + '.ris', ris, 'application/x-research-info-systems;charset=utf-8');
  return toast('已导出 ' + rows.length + ' 条 RIS');
}

/* ================================================================ 查新（V4.10）
   这一页回答写之前的问题：我打算这么做，别人是不是已经做过了。
   分数是机械的（标题与摘要里关键词的覆盖率，越少见的词权重越高），
   它只把最像的几十篇摆到一起，不做判断 —— 所以页面上一句结论都不写。 */
function riskTag(r) {
  const m = { overlap: ['可能撞车', 't-bad'], partial: ['部分重合', 't-warn'], clear: ['关系不大', 't-mute'] };
  const v = m[r] || ['—', 't-mute'];
  return tag(v[0], v[1]);
}

window.VIEWS_BASE.novelty = function () {
  const A = window.APP || {};
  const N = A.NOVELTY;
  if (!N || !(N.candidates || []).length) {
    return card('查新', '', emptyBox('还没有查新结果。'
      + '（生成方式：用一段方案跑 novelty.py，或在对话里给出方向后重新构建）'));
  }
  const c = N.counts || {};
  const near = N.recent || {};
  const ry = (N.window || {}).recentYears || 2;
  const cs = (N.candidates || []).slice(0, 40);
  const cov = N.coverage || {};
  const src = (N.sources || []).map(x => x.name + (x.ok ? ' ' + x.hits + ' 条' : ' 不可用')).join('；');

  /* 方案原文完整显示：不截断、不加省略号。命中的关键词在正文里标红，
     比在下面单列一排 chip 更容易看出"这句话命中了什么"。 */
  const draftText = String(((N.draft || {}).text) || ((N.draft || {}).head) || '');
  const focusTerms = (N.focus || []).slice().sort(function (a, b) { return b.length - a.length; });
  function markFocus(txt) {
    let out = esc(txt);
    focusTerms.forEach(function (t) {
      if (!t) return;
      const safe = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp('(' + safe + ')', 'gi'), '<mark class="kw">$1</mark>');
    });
    return out;
  }
  const head = card('所查方案', '',
    '<div style="line-height:1.95;color:var(--ink2);white-space:pre-wrap;word-break:break-word">'
    + markFocus(draftText) + '</div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">'
    + (N.focus || []).map(t => tag(t, 't-topic')).join('') + '</div>');

  const kpis = grid(3,
    kpi('可能撞车', c.overlap || 0, '近 ' + ry + ' 年内 ' + (near.overlap || 0) + ' 篇', 'var(--bad)')
    + kpi('部分重合', c.partial || 0, '近 ' + ry + ' 年内 ' + (near.partial || 0) + ' 篇', 'var(--warn)')
    + kpi('关系不大', c.clear || 0, '只是碰上了同一个词', 'var(--muted)'));

  const rows = cs.map(x => [
    riskTag(x.risk),
    esc(String(x.year || '—')),
    '<a href="' + esc(x.url || '#') + '" target="_blank" rel="noopener">'
      + esc(String(x.title || '').slice(0, 92)) + '</a>'
      + (x.venue ? '<div class="tiny muted">' + esc(String(x.venue).slice(0, 60)) + '</div>' : ''),
    esc((x.hitTerms || []).join('、')),
    esc(x.source || ''),
    esc(String(x.score == null ? '—' : x.score)),
  ]);

  const tableBox = cardWide('最像的 ' + cs.length + ' 篇', '',
    table([{ t: '风险', w: 92 }, { t: '年份', w: 56 }, { t: '题目', w: 420 },
      { t: '命中的词', w: 150 }, { t: '来源', w: 72 }, { t: '分', w: 44 }], rows));

  /* 检索元信息：什么时候查的、命中的最新一篇是哪年 —— 判断"这条结果新不新"只靠这两项 */
  const genRaw = String(N.generated || '');
  const gen = genRaw ? genRaw.replace('T', ' ').slice(0, 16) : '未记录';
  const nowYear = new Date().getFullYear();
  const latest = (N.candidates || []).reduce(function (m, x) {
    const y = Number(x.year) || 0;
    return y > nowYear ? m : Math.max(m, y);
  }, 0);
  const meta = card('检索信息', '', kvList([
    ['检索时间', esc(gen)],
    ['命中最新', latest ? latest + ' 年' : '未记录'],
    ['时间窗', esc(((N.window || {}).since || '') + ' 起（最近 '
      + ((N.window || {}).years || 5) + ' 年）')],
    ['来源', esc(src || '—')],
  ]));

  const cvg = '本次检索 ' + (N.queries || []).length + ' 条检索式，原始命中 ' + (cov.rawHits || 0)
    + ' 条，去重后 ' + (cov.unique || 0) + ' 条。来源：' + (src || '—')
    + '。时间窗：最近 ' + ((N.window || {}).years || 5) + ' 年（'
    + ((N.window || {}).since || '') + ' 起）；本次未查询中文论文库。';

  const boundary = note(cvg, 'info')
    + '<div style="margin-top:8px">'
    + note('查新程度与准确度取决于提供给 Agent 的文案是否具体；方向越具体，结果可靠性越强。', 'info')
    + note('风险分是三档机械规则（标题与摘要里的关键词覆盖率），不是判断。'
      + '是否与当前方向重合，需阅读原文确认；本区域只提供参考。', 'warn')
    + note('「暂未找到同类」只等于这两个论文库内没有；其他论文库未作查询，'
      + '不等于方案一定创新。', 'warn')
    + note('如需更换方向或更新时间，在本 agent 对话中重新输入更新后的论文方向，'
      + '重新生成后本页随之更新。', 'info')
    + '</div>';

  return meta + head + kpis + tableBox + card('这批结果的边界', '', boundary);
};

})();
/* == IIFE 终点 == */
