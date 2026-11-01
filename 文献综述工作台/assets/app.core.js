/* ============================================================================
 * app.core.js —— 应用核心（锁死文件，请勿改写）
 * ----------------------------------------------------------------------------
 * 职责：状态管理、筛选、排序、视图路由、详情抽屉、主题、导入导出。
 * 不含任何业务名词 —— 主题体系、技术环节、评分档位、预设全部来自 CONFIG。
 *
 * 依赖（由构建脚本按顺序注入到 window 上）：
 *   window.LIT_CONFIG  项目配置（config.json）
 *   window.LIT_PAPERS  论文数组（papers.json）
 *   window.LIT_META    统计元信息（meta.json，可选）
 *   window.VIEWS       视图函数表，形如 { dash: fn, db: fn, ... }
 *
 * 约定：视图函数签名统一为 fn(papers, cfg) -> html 字符串；
 *       其中 papers 是已过滤的结果，cfg 是 CONFIG。
 * ========================================================================== */

const CFG = window.LIT_CONFIG || {};
const P = window.LIT_PAPERS || [];
const M = window.LIT_META || {};

/* ---- V3.0 新增数据源。全部允许缺失：旧项目不提供这四个文件也能正常打开，
        新模块只在对应数据存在时才显示有内容的页面。 ---- */
const LAND = window.LIT_LANDSCAPE || null;      // 研究现状报告（8 问）
const DIRS = window.LIT_DIRECTIONS || [];       // 研究方向树
const EXT = window.LIT_EXTERNAL || [];          // 外部推荐文献
const EXT_CAND = window.LIT_EXTERNAL_CANDIDATES || [];  // 候选池（用于解释"为什么它没被推荐"）
const SESSION = window.LIT_SESSION || null;     // 检索会话记录
/* V4.0 科研工程思维实验室。用户产生的状态（选择、笔记、掌握度、重要性调整）
   一律只进 S 并落 localStorage，绝不写回 lab.json —— 重新生成内容时不能覆盖人的判断。 */
const LAB = window.LIT_LAB || null;

const TOPICS = {};          // id -> 名称
const TOPIC_META = {};      // id -> 完整定义
(CFG.topics || []).forEach(t => { TOPICS[t.id] = t.name; TOPIC_META[t.id] = t; });
/* 主题配色兜底（V4.7）
 * config 里每个 topic 都可以带 color；作者忘了写是常事，而后果不是"少个颜色"
 * 这么轻 —— 环形图和散点气泡会全部退化成同一种灰，分类维度整个消失，
 * 读者看到的是一张看不出差别的图（V4.7 事故：主题构成饼图全灰）。
 * 所以顺序是：显式 color > 按主题在 config 里的次序取默认色板。
 * 函数放在锁定层，任何项目（哪怕自带旧 views.js）都能用上。 */
const TOPIC_ORDER = (CFG.topics || []).map(t => t.id);
function topicColorOf(id) {
  const t = TOPIC_META[id];
  if (t && t.color) return t.color;
  const i = TOPIC_ORDER.indexOf(id);
  return seriesColor(i < 0 ? 0 : i);
}
const STAGES = CFG.stages || [];
const STAGE_NAME = {};
STAGES.forEach(s => { STAGE_NAME[s.id] = s.name; });

const STATUS = CFG.statuses || ['未阅读', '待阅读', '正在阅读', '已初读', '已精读', '暂时跳过'];
const BANDS = CFG.bands || [
  { min: 85, name: '核心相关', color: '#c0392b', action: '优先精读' },
  { min: 70, name: '高度相关', color: '#d97706', action: '列入必读' },
  { min: 50, name: '中度相关', color: '#2f6feb', action: '补充理解' },
  { min: 30, name: '间接关联', color: '#6b7d94', action: '按需阅读' },
  { min: 0, name: '外围相关', color: '#c3ccda', action: '暂不优先' },
];
const DL = CFG.dlCategories || [];
const DL_COLOR = CFG.dlColors || {};
const EXTRA = CFG.extraTags || [];   // 额外标签维度（可选模块用）

function bandOf(score) {
  for (const b of BANDS) if (score >= b.min) return b;
  return BANDS[BANDS.length - 1];
}
function bandColor(name) {
  const b = BANDS.find(x => x.name === name);
  return b ? b.color : 'var(--muted)';
}

const BY = {};
P.forEach(p => { BY[p.id] = p; });
/* 外部文献也登记进 BY，这样它们可以直接复用同一个详情抽屉：
   阅读状态、笔记、收藏都按 id 存在 localStorage 里，与本地文献完全同构。
   用 kind 字段区分，抽屉据此决定显示哪一套标签。 */
EXT.forEach(e => { e.kind = 'external'; if (!BY[e.id]) BY[e.id] = e; });

const DIR_BY = {};
DIRS.forEach(d => { DIR_BY[d.id] = d; });
const EXT_BY = {};
EXT.forEach(e => { EXT_BY[e.id] = e; });

/* ------------------------------------------------------------------ 状态层 */
const LS_KEY = CFG.lsKey || 'lit-workbench-v1';

function defaultFilters() {
  return {
    q: '', topic: [], year: [], stage: [], dl: [], status: [],
    relMin: 0, learnMin: 0, diffMin: 1, diffMax: 5,
    bands: [], extra: {},
  };
}
const S = {
  view: 'dash',
  filters: defaultFilters(),
  sort: 'priority',
  page: 1,
  pageSize: 50,
  mode: 'table',
  theme: 'light',
  cmp: [],
  notes: {},
  status: {},
  star: {},
  weights: CFG.weights || { relevance: 0.55, learning: 0.45, difficulty: 4.0 },
  /* ---- 待审核数据：解析期发现的问题，人工确认后置 1 ---- */
  reviewDone: {},      // 问题条目 id -> 1
  /* ---- V3.0 ---- */
  dirSel: '',          // 方向探索页当前选中的方向 id
  dirCmp: [],          // 方向对比列表（2–4 个）
  dirFav: {},          // 方向收藏
  dirSort: 'opp',      // 方向排序：opp | novelty | local | ext
  extAccess: 'all',    // 外部文献访问状态筛选：all | open_access | paywalled | unknown
  extDir: '',          // 外部文献按方向筛选（'' = 全部）
  extSort: 'total',    // 外部文献排序：total | relevance | recency | citations
  extW: CFG.extScoreWeights || { relevance: 30, subdirection: 20, dataScenario: 15, learning: 15, evidence: 10, recency: 10 },
  /* ---- V4.0 科研工程思维实验室 ---- */
  labTab: 'map',       // map | model | impl | exp | train
  labMod: '',          // 当前选中的项目模块 id
  labAlgo: '',         // 建模页当前对比的算法 id（'' = 不单独选）
  labLevel: '1',       // 四级解释展开到第几级：1 直觉 / 2 数学 / 3 求解 / 4 数值工程
  labMode: 'guide',    // 学习模式：guide 引导 | ref 参考 | challenge 挑战
  labStat: {},         // 模块实现状态 模块id -> 未开始|进行中|已验证
  labImp: {},          // 用户调整过的模块重要性 模块id -> 1..5
  labDepOff: {},       // 用户移除的依赖 模块id -> [depId]
  labChoice: {},       // 算法选择记录 模块id -> 算法id
  labCheck: {},        // 适用性自检勾选 模块id -> [检查项id]
  labReason: {},       // 选择理由 模块id -> 文本
  labNote: {},         // 学习笔记 单元/模块id -> 文本
  labPick: {},         // 决策题作答 题目id -> 选项id
  labMastery: {},      // 掌握度 学习单元id -> none|seen|explain|derive|verified|variant
  labPrio: {},         // 用户调整的优先级 单元id -> P0..P3
  labFail: '',         // 失败分析页当前展开的失败模式 id
  labDiag: {},         // 逆向诊断输入（按题目 id 存文本，必须是对象，否则写不进去）
  labExpLog: {},       // 实验实测记录 实验id -> 文本
  labChallenge: {},    // 挑战模式下用户先写下的分析方案 题目id -> 文本
};

function statusOf(id) { return S.status[id] || '未阅读'; }

function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      filters: S.filters, sort: S.sort, mode: S.mode, theme: S.theme,
      notes: S.notes, status: S.status, star: S.star, weights: S.weights, cmp: S.cmp,
      reviewDone: S.reviewDone,
      dirSel: S.dirSel, dirCmp: S.dirCmp, dirFav: S.dirFav, dirSort: S.dirSort,
      extAccess: S.extAccess, extDir: S.extDir, extSort: S.extSort, extW: S.extW,
      /* V4.0：用户产生的教学状态 */
      labTab: S.labTab, labMod: S.labMod, labAlgo: S.labAlgo, labLevel: S.labLevel, labMode: S.labMode,
      labStat: S.labStat, labImp: S.labImp, labDepOff: S.labDepOff, labChoice: S.labChoice,
      labCheck: S.labCheck, labReason: S.labReason, labNote: S.labNote, labPick: S.labPick,
      labMastery: S.labMastery, labPrio: S.labPrio, labDiag: S.labDiag,
      labExpLog: S.labExpLog, labChallenge: S.labChallenge,
    }));
  } catch (e) { /* 隐私模式下可能失败，不影响使用 */ }
}
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    Object.assign(S.filters, o.filters || {});
    if (o.sort) S.sort = o.sort;
    if (o.mode) S.mode = o.mode;
    if (o.theme) S.theme = o.theme;
    S.notes = o.notes || {}; S.status = o.status || {}; S.star = o.star || {};
    if (o.weights) S.weights = o.weights;
    S.cmp = o.cmp || [];
    S.reviewDone = o.reviewDone || {};
    /* V3.0：旧备份里没有这些键，缺失时保持默认值 */
    if (o.dirSel) S.dirSel = o.dirSel;
    S.dirCmp = o.dirCmp || []; S.dirFav = o.dirFav || {};
    if (o.dirSort) S.dirSort = o.dirSort;
    if (o.extAccess) S.extAccess = o.extAccess;
    if (typeof o.extDir === 'string') S.extDir = o.extDir;
    if (o.extSort) S.extSort = o.extSort;
    if (o.extW) S.extW = o.extW;
    /* V4.0：缺键时保持默认，不把旧备份判为损坏 */
    ['labTab', 'labMod', 'labAlgo', 'labLevel', 'labMode'].forEach(k => {
      if (typeof o[k] === 'string') S[k] = o[k];
    });
    ['labStat', 'labImp', 'labDepOff', 'labChoice', 'labCheck', 'labReason', 'labNote',
      'labPick', 'labMastery', 'labPrio', 'labDiag', 'labExpLog', 'labChallenge'].forEach(k => {
      if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) S[k] = o[k];
    });
  } catch (e) { /* 状态损坏则忽略，用默认值 */ }
}

/* ------------------------------------------------------------------ 方向 */
function openDir(id) {
  S.dirSel = id;
  saveState();
  go('explore');
}
function dirOf(id) { return DIR_BY[id] || null; }
function childrenOf(id) { return DIRS.filter(d => d.parentId === id); }
function rootsOf() { return DIRS.filter(d => !d.parentId || d.level === 1); }
function dirFaved(id) { return !!S.dirFav[id]; }

/** 外部文献的六维加权总分。权重可在页面上调，因此必须实时算而不是读死数据。 */
function extTotal(e) {
  const s = e.score || {};
  const w = S.extW || {};
  const part = [
    [s.relevance || 0, w.relevance],
    [s.subdirectionMatch || 0, w.subdirection],
    [s.dataScenarioFit || 0, w.dataScenario],
    [s.learningValue || 0, w.learning],
    [s.evidenceQuality || 0, w.evidence],
    [s.recency || 0, w.recency],
  ];
  let sum2 = 0, wsum = 0;
  part.forEach(([v, ww]) => { if (ww) { sum2 += v * ww / 100; wsum += ww; } });
  return wsum ? round1(sum2 * 100 / wsum) : 0;
}
function round1(v) { return Math.round(v * 10) / 10; }

/* ------------------------------------------------------------------ 筛选层 */
function matchText(p, q) {
  if (!q) return true;
  const hay = [p.title, p.titleEn, p.authors, p.keywords, p.overview, p.method, p.venue,
    (p.datasets || []).join(' '), Object.values(p.tags || {}).flat().join(' ')].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.indexOf(w) >= 0);
}

function filtered(base) {
  const f = S.filters;
  const src = base || P;
  return src.filter(p => {
    if (!matchText(p, f.q)) return false;
    if (f.topic.length && f.topic.indexOf(p.topic) < 0) return false;
    if (f.year.length && f.year.indexOf(String(p.year)) < 0) return false;
    if (f.dl.length && f.dl.indexOf(p.dl) < 0) return false;
    if (f.status.length && f.status.indexOf(statusOf(p.id)) < 0) return false;
    if (f.stage.length && !(p.stages || []).some(s => f.stage.indexOf(s) >= 0)) return false;
    if ((p.relevance || 0) < f.relMin) return false;
    if ((p.learning || 0) < f.learnMin) return false;
    if ((p.difficulty || 0) < f.diffMin || (p.difficulty || 0) > f.diffMax) return false;
    if (f.bands.length && f.bands.indexOf(p.band) < 0) return false;
    for (const dim of EXTRA) {
      const want = (f.extra && f.extra[dim.key]) || [];
      if (want.length) {
        const have = (p.tags && p.tags[dim.key]) || [];
        if (!want.some(v => have.indexOf(v) >= 0)) return false;
      }
    }
    return true;
  });
}

function prio(p) {
  const w = S.weights;
  return w.relevance * (p.relevance || 0) + w.learning * (p.learning || 0)
    - (w.difficulty || 4) * ((p.difficulty || 2.5) - 2.2);
}

const SORTS = {
  priority: (a, b) => prio(b) - prio(a),
  relevance: (a, b) => (b.relevance || 0) - (a.relevance || 0),
  learning: (a, b) => (b.learning || 0) - (a.learning || 0),
  year: (a, b) => (b.year || 0) - (a.year || 0),
  difficulty: (a, b) => (a.difficulty || 0) - (b.difficulty || 0),
};
(CFG.extraScores || []).forEach(x => { SORTS[x.key] = (a, b) => ((b.extraScores || {})[x.key] || 0) - ((a.extraScores || {})[x.key] || 0); });

function sortPapers(arr, key) { return arr.slice().sort(SORTS[key] || SORTS.priority); }

function activeFilterCount() {
  const f = S.filters; let n = 0;
  n += f.topic.length + f.year.length + f.dl.length + f.status.length + f.stage.length + f.bands.length;
  if (f.q) n++;
  if (f.relMin) n++; if (f.learnMin) n++;
  if (f.diffMin > 1 || f.diffMax < 5) n++;
  for (const k in (f.extra || {})) n += (f.extra[k] || []).length ? 1 : 0;
  return n;
}

/* ------------------------------------------------------------------ 交互 */
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('on');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 1800);
}

function toggleIn(key, val) {
  const a = S.filters[key];
  const i = a.indexOf(val);
  if (i >= 0) a.splice(i, 1); else a.push(val);
  S.page = 1; render();
}

function applyPreset(id) {
  const pre = (CFG.presets || []).find(x => x.id === id);
  if (!pre) return;
  S.filters = Object.assign(defaultFilters(), JSON.parse(JSON.stringify(pre.set || {})));
  S.page = 1;
  go('db');
  toast('已应用预设：' + pre.label);
}

/* ------------------------------------------------------------------ 路由 */
const VIEW_TITLE = {};
/* V4.6.1：只记名字，不记 desc。页头副标题已随骨架 #viewSub 一起移除——
   config.views[].desc 是施工期的模块自述，不属于页面正文，
   即使 config 里写了也不会出现在成品上。 */
(CFG.views || []).forEach(v => { VIEW_TITLE[v.id] = [v.name, '']; });

/* 注意：views.js 在本文件之后注入，所以不能在这里缓存 window.VIEWS，
   必须每次渲染时现取，否则会永远拿到空对象。 */
function renderView(id) {
  const VV = window.VIEWS || {};
  const fn = VV[id];
  if (typeof fn === 'function') return fn(filtered(), CFG);
  const t = VIEW_TITLE[id] || [id, ''];
  return placeholder(t[0]);
}

function placeholder(name) {
  return `<div class="card"><div class="card-h"><h3>${name}</h3></div>
    <div class="card-b"><div class="empty">该模块尚未实现。请在 views.js 中定义 VIEWS['${name}'] 函数。</div></div></div>`;
}

function go(view) {
  S.view = view;
  document.querySelectorAll('#nav button').forEach(b => {
    const on = b.dataset.view === view;
    b.classList.toggle('on', on);
    // 读屏与键盘用户靠 aria-current 知道当前在哪一页
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const t = VIEW_TITLE[view] || [view, ''];
  const el = document.getElementById('viewTitle'); if (el) el.textContent = t[0];
  const sub = document.getElementById('viewSub'); if (sub) sub.textContent = t[1] || '';
  render();
  const v = document.getElementById('view'); if (v) v.scrollTop = 0;
  window.scrollTo(0, 0);
}

function render() {
  const host = document.getElementById('view');
  if (!host) return;
  try {
    host.innerHTML = renderView(S.view);
  } catch (e) {
    host.innerHTML = `<div class="card"><div class="card-h"><h3>渲染失败</h3></div>
      <div class="card-b"><div class="empty">${esc(e && e.message ? e.message : e)}</div></div></div>`;
    console.error(e);
  }
  updateChrome();
  /* 渲染后钩子：ui.js 的吸附块、math.js 的公式兜底都挂在这里。
     用数组是因为钩子会越来越多，单个 afterRender 只能留一个，先挂的会被覆盖。 */
  (window.AFTER_RENDER || []).forEach(fn => {
    try { fn(); } catch (e) { console.error(e); }
  });
  if (typeof afterRender === 'function') afterRender();
}

function updateChrome() {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('side-count', P.length + ' 篇');
  // V4.6.1：side-gen（"生成于…"）随骨架一起移除，set 找不到节点会静默跳过，
  // 老版本骨架仍兼容。生成时间留在 meta.json 里，不再上页面。
  // 导航上的计数：只有 config 里标了 count:true 的视图才会生成计数节点，
  // set() 找不到节点会静默跳过，所以这里不需要判断视图有没有配。
  set('nav-c-dash', P.length);
  set('nav-c-db', filtered().length);
  set('nav-c-prog', P.filter(p => ['已初读', '已精读'].indexOf(statusOf(p.id)) >= 0).length);
  set('nav-c-explore', DIRS.length);
  set('nav-c-external', EXT.length);
}

/* ------------------------------------------------------------------ 详情抽屉 */
let drawerId = null;
// 关闭抽屉后把焦点还给刚才那个按钮，否则键盘用户会被丢回页面顶部
let lastFocus = null;

function openDrawer(id) {
  drawerId = id;
  const p = BY[id];
  if (!p) return;
  const head = document.getElementById('drawerHead');
  const body = document.getElementById('drawerBody');
  // 外部文献与本地文献的字段完全不同：前者没有 overview/method，但有六维打分与
  // 访问状态。硬套同一套标签只会显示一堆"—"，因此按 kind 分流标签集合。
  const isExt = p.kind === 'external';
  const tabs = (isExt && (CFG.extTabs || []).length) ? CFG.extTabs : (CFG.detailTabs || []);
  head.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px">
      <div style="flex:1;min-width:0">
        <h3 style="margin:0;font-size:15px;line-height:1.45">${esc(p.title)}</h3>
        ${p.titleEn ? `<div class="tiny muted" style="margin-top:4px">${esc(p.titleEn)}</div>` : ''}
      </div>
      <button class="btn ghost sm" id="drawerClose" type="button" aria-label="关闭详情">✕</button>
    </div>
    <div class="tiny muted" style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap">
      <span>${esc(dash(p.year))}</span><span>${esc(dash(p.venue))}</span>
      ${p.authors ? `<span>${esc(p.authors)}</span>` : ''}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
      ${tabs.map((t, i) => `<button class="btn sm${i === 0 ? ' on' : ''}" data-dtab="${t.id}">${esc(t.label)}</button>`).join('')}
    </div>`;
  body.innerHTML = '';
  const dw = document.getElementById('drawer');
  lastFocus = document.activeElement;
  dw.classList.add('on');
  dw.setAttribute('aria-hidden', 'false');
  document.getElementById('drawerMask').classList.add('on');
  showTab(tabs[0] ? tabs[0].id : null);
  const closeBtn = document.getElementById('drawerClose');
  if (closeBtn) closeBtn.focus();
}

function showTab(tabId) {
  const p = BY[drawerId]; if (!p) return;
  document.querySelectorAll('#drawerHead [data-dtab]').forEach(b => b.classList.toggle('on', b.dataset.dtab === tabId));
  const body = document.getElementById('drawerBody');
  const fn = (window.TABS || {})[tabId];
  body.innerHTML = fn ? fn(p, CFG) : `<div class="empty">该标签未实现</div>`;
}

function closeDrawer() {
  const dw = document.getElementById('drawer');
  dw.classList.remove('on');
  dw.setAttribute('aria-hidden', 'true');
  document.getElementById('drawerMask').classList.remove('on');
  drawerId = null;
  if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  lastFocus = null;
}

/* ------------------------------------------------------------ 单篇笔记导出
 * 笔记是读者自己的劳动成果，只存在浏览器里等于随时会丢。这里把它和这篇论文的
 * 题录信息一起写成一份 txt：既有出处（回头能找到原文），也有笔记本身。
 * 导出前先把输入框里还没保存的内容存下来 —— 否则导出的会是上一次保存的版本。 */
function noteFileName(p) {
  const t = String((p && p.title) || '未命名').replace(/[\\/:*?"<>|\r\n]/g, '').trim();
  return '笔记_' + (p && p.id ? p.id : 'x') + '_' + (t.length > 24 ? t.slice(0, 24) : t) + '.txt';
}

function noteText(p) {
  const st = statusOf(p.id);
  const note = (S.notes[p.id] || '').trim();
  const L = [];
  L.push('笔记导出 · ' + String(p.title || '').trim());
  L.push('导出时间：' + new Date().toLocaleString('zh-CN'));
  L.push('');
  L.push('【文献题录】');
  L.push('编号：' + dash(p.id));
  L.push('标题：' + dash(p.title));
  if (p.titleEn) L.push('英文标题：' + dash(p.titleEn));
  L.push('作者：' + dash(Array.isArray(p.authors) ? p.authors.join('、') : p.authors));
  if (p.unit) L.push('单位：' + dash(p.unit));
  L.push('年份：' + dash(p.year));
  L.push('出处：' + dash(p.venue));
  if (p.doi) L.push('DOI：' + dash(p.doi) + (p.doiUrl ? '（' + p.doiUrl + '）' : ''));
  if (p.keywords) L.push('关键词：' + dash(p.keywords));
  if (p.kind === 'external') {
    L.push('来源库：' + dash(p.sourceDatabase || p.source));
    L.push('访问状态：' + dash(p.accessStatus));
    if (p.citationCount != null) L.push('被引：' + p.citationCount + '（' + dash(p.citationSource) + '）');
    if (p.score && p.score.total != null) L.push('推荐综合分：' + p.score.total + ' / 100');
    if (p.recommendationReason) L.push('推荐理由：' + p.recommendationReason);
  } else {
    if (p.topic) L.push('一级主题：' + dash(TOPICS[p.topic] || p.topic));
    if ((p.stages || []).length) L.push('技术环节：' + (p.stages || []).map(s => (STAGE_NAME[s] || s)).join(' / '));
    if (p.relevance != null) L.push('项目耦合度：' + p.relevance);
    if (p.learning != null) L.push('学习价值：' + p.learning);
    if (p.difficulty != null) L.push('阅读难度：' + p.difficulty);
    if (p.hasCode != null) L.push('有代码：' + (p.hasCode ? '是' : '否'));
    if ((p.datasets || []).length) L.push('数据集：' + p.datasets.join('、'));
    if ((p.metrics || []).length) L.push('指标：' + p.metrics.join('、'));
  }
  L.push('');
  L.push('【阅读状态】' + st);
  L.push('');
  L.push('【我的笔记】');
  L.push(note || '（尚未写笔记）');
  L.push('');
  L.push('—— 由文献工作台导出。题录来自检索/整理结果，笔记为本人所写，两者分开保存。');
  return L.join('\r\n');
}

function exportNote(id) {
  // 输入框里可能有还没点保存的内容，先落盘再导出
  const box = document.getElementById('noteBox');
  if (box && box.dataset.noteId === id) {
    const t = box.value || '';
    if ((S.notes[id] || '') !== t) { S.notes[id] = t; saveState(); }
  }
  const p = BY[id];
  if (!p) { toast('找不到这篇文献'); return; }
  const blob = new Blob(['\ufeff' + noteText(p)], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = noteFileName(p);
  a.click();
  toast('已导出 ' + (p.id || '') + ' 的笔记');
}

/* ------------------------------------------------------------------ 主题 */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  S.theme = t;
  const b = document.getElementById('themeBtn');
  if (b) b.textContent = t === 'dark' ? '浅色' : '深色';
  saveState();
}

/* ------------------------------------------------------------------ 导出 */
function exportCSV() {
  const cols = [
    ['id', '编号'], ['title', '标题'], ['titleEn', '英文标题'], ['year', '年份'],
    ['venue', '期刊/会议'], ['authors', '作者'], ['unit', '单位'],
    ['topic', '一级主题'], ['dl', '方法类型'], ['stages', '技术环节'],
    ['relevance', '项目耦合度'], ['learning', '学习价值'], ['difficulty', '阅读难度'],
    ['band', '相关档位'], ['evidence', '证据置信度'],
    ['datasets', '数据集'], ['metrics', '指标'], ['hasCode', '有代码'],
    ['status', '阅读状态'], ['note', '笔记'],
  ];
  const rows = [cols.map(c => c[1]).join(',')];
  filtered().forEach(p => {
    rows.push(cols.map(c => {
      let v;
      if (c[0] === 'topic') v = TOPICS[p.topic] || p.topic;
      else if (c[0] === 'stages') v = (p.stages || []).map(s => STAGE_NAME[s] || s).join(' / ');
      else if (c[0] === 'datasets') v = (p.datasets || []).join(' / ');
      else if (c[0] === 'hasCode') v = p.hasCode ? '是' : '否';
      else if (c[0] === 'status') v = statusOf(p.id);
      else if (c[0] === 'note') v = S.notes[p.id] || '';
      else v = p[c[0]];
      return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    }).join(','));
  });
  const blob = new Blob(['\ufeff' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (CFG.project && CFG.project.short ? CFG.project.short : 'literature') + '_文献表.csv';
  a.click();
}

/* 暴露给视图层与绑定层使用 */
window.APP = {
  S, CFG, P, M, BY, TOPICS, TOPIC_META, STAGES, STAGE_NAME, STATUS, BANDS, DL, DL_COLOR, EXTRA,
  TOPIC_ORDER, topicColorOf,
  LAND, DIRS, DIR_BY, EXT, EXT_BY, EXT_CAND, SESSION, LAB,
  bandOf, bandColor, statusOf, filtered, sortPapers, prio, go, render, toast, applyPreset,
  toggleIn, openDrawer, closeDrawer, showTab, saveState, exportCSV, exportNote, activeFilterCount,
  applyTheme, loadStatePublic: loadState,
  defaultFiltersPublic: defaultFilters,
  openDir, dirOf, childrenOf, rootsOf, dirFaved, extTotal,
};
