/* smoke.js —— 用最小 DOM 桩跑一遍所有视图，验证不出异常、不空屏
 * 不依赖任何第三方库：只想知道"页面渲染出来没有"，不需要真实浏览器。
 * 用法：node scripts/smoke.js <产出的HTML>
 */
const fs = require('fs');

const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');

/* 按顺序取出全部内联 <script> 块。数据段（window.LIT_*）与逻辑段是两个块，
   只取后者会看到 0 篇论文，冒烟测试就变成了空跑。 */
const blocks = [];
{
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] && m[1].trim()) blocks.push(m[1]);
  }
}
if (!blocks.length) { console.error('找不到内联脚本'); process.exit(2); }

/* ---------------- 最小 DOM 桩 ---------------- */
function mkEl(id) {
  const el = {
    id, textContent: '', innerHTML: '', className: '', value: '', style: {},
    dataset: {}, children: [], offsetWidth: 120, offsetHeight: 40,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; },
    setAttribute() {}, getAttribute(k) { return this.dataset[k] || null; },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 30 }; },
    closest() { return null; }, querySelectorAll() { return []; },
    querySelector() { return null; }, click() {},
  };
  return el;
}
const store = {};
const doc = {
  readyState: 'complete',
  documentElement: mkEl('html'),
  body: mkEl('body'),
  getElementById() { return null; },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  addEventListener() {},
  createElement(t) { return mkEl(t); },
};

global.window = global;
global.document = doc;
global.navigator = { userAgent: 'node' };
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
global.Blob = function () {}; global.URL = { createObjectURL: () => 'blob:x' };
global.confirm = () => false;
global.scrollTo = () => {};
global.setTimeout = (fn) => 0;
global.clearTimeout = () => {};
global.console_ = console;

/* ---------------- 执行内联脚本 ---------------- */
try {
  blocks.forEach((b, i) => {
    // eslint-disable-next-line no-new-func
    new Function(b)();
    if (!window.APP && i === blocks.length - 1) throw new Error('最后一个脚本块执行后 APP 仍未初始化');
  });
} catch (e) {
  console.error('脚本执行失败：' + e.message);
  process.exit(3);
}

const A = window.APP;
if (!A) { console.error('window.APP 未初始化'); process.exit(4); }

/* ---------------- 逐视图渲染 ---------------- */
const views = (A.CFG.views || []).map(v => v.id);
let fail = 0;

/* V4.7.1：空值检查统一走这里。
   旧正则要求 >undefined< 三个字符紧挨着尖括号，于是 'undefined 本批文献的…'
   这种写进句子的泄漏两边都放行。现在剥掉 script/style 后按"整词"查，
   并把命中的上下文一起打出来，方便直接定位。 */
function leakOf(markup) {
  const s = String(markup || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const m = s.match(/(?:[\s>"'（(【])((?:undefined|NaN))(?=[\s<"'，。、：；！？）)】]|$)/)
    || s.match(/\b(undefined|NaN)\b/);
  if (!m) return '';
  const at = m.index + m[0].indexOf(m[1]);
  return s.slice(Math.max(0, at - 30), at + 30).replace(/\s+/g, ' ').trim();
}

console.log('视图渲染检查：');
const papers = A.filtered();
for (const id of views) {
  const fn = (window.VIEWS || {})[id];
  if (typeof fn !== 'function') { console.log('  ✗ ' + id + '  没有渲染函数'); fail++; continue; }
  let out;
  try {
    out = fn(papers, A.CFG);
  } catch (e) {
    console.log('  ✗ ' + id + '  抛出异常：' + e.message); fail++; continue;
  }
  const len = (out || '').length;
  const emptyish = /class="empty"/.test(out || '') && len < 900;
  const leak = leakOf(out);
  /* V4.7.1：返回空串以前被当 ok（"✓ 0 字符"）。渲染不出东西就是坏的。 */
  const flag = len < 100 ? '渲染为空' : emptyish ? '空态' : leak ? '含 undefined/NaN' : 'ok';
  if (flag !== 'ok') fail++;
  console.log('  ' + (flag === 'ok' ? '✓' : '✗') + ' ' + id.padEnd(10) + String(len).padStart(7) + ' 字符  ' + flag
    + (leak ? '\n      命中：' + leak : ''));
}

/* ---------------- 编号对照块（吸附 + 可拖动） ----------------
   DOM 桩没有真实节点，这里只验证 markup 来自 ui.js 的 sidLegend：
   自己手写 <div class="sidmap"> 的页面不会有拖动柄和复位按钮。 */
const stagesCfg = A.CFG.stages || [];
if (stagesCfg.length >= 3 && typeof (window.VIEWS || {}).map === 'function') {
  console.log('\n编号对照块检查：');
  const out = window.VIEWS.map(papers, A.CFG) || '';
  const hasPin = /class="sidmap"[^>]*data-pin=/.test(out);
  const hasGrip = /data-pin-drag/.test(out) && /data-pin-reset/.test(out);
  if (hasPin && hasGrip) console.log('  ✓ 由 sidLegend 生成（吸附 + 拖动柄 + 钉回）');
  else { console.log('  ✗ 对照块缺少吸附/拖动结构（data-pin / data-pin-drag / data-pin-reset）'); fail++; }
}

/* ---------------- 抽屉标签 ---------------- */
console.log('\n详情标签检查：');
const t1 = A.P[0];
const t2 = (A.EXT || [])[0];
const tabSets = [
  ['本地文献', t1, (A.CFG.detailTabs || [])],
  ['外部文献', t2, (A.CFG.extTabs || [])],
];
for (const [name, sample, tabs] of tabSets) {
  if (!sample) { console.log('  - ' + name + '：没有可比对的数据，跳过'); continue; }
  for (const t of tabs) {
    const fn = (window.TABS || {})[t.id];
    if (typeof fn !== 'function') { console.log('  ✗ ' + name + '/' + t.id + ' 未实现'); fail++; continue; }
    try {
      const o = fn(sample, A.CFG) || '';
      const leak = leakOf(o);
      if (leak) { console.log('  ✗ ' + name + '/' + t.id + ' 含 undefined/NaN：' + leak); fail++; }
      else console.log('  ✓ ' + name + '/' + t.id + '  ' + o.length + ' 字符');
    } catch (e) {
      console.log('  ✗ ' + name + '/' + t.id + ' 抛出异常：' + e.message); fail++;
    }
  }
}

/* ---------------- 带状态的渲染（默认状态覆盖不到的分支） ---------------- */
console.log('\n交互状态分支：');
/* 分支按「页面存在 + 数据存在」条件加入：只有本地文献的项目（例如
   examples/ 下的验证案例）没有 explore/external 这两页，不该被判为失败。 */
const roots = (A.DIRS || []).filter(d => !d.parentId || d.level === 1);
const hasView = id => typeof (window.VIEWS || {})[id] === 'function';
const variants = [];
if (hasView('explore') && roots.length) {
  variants.push(['explore 选中方向', 'explore', () => { A.S.dirSel = roots[0].id; }]);
  variants.push(['explore 方向对比', 'explore', () => {
    A.S.dirSel = roots[0].id;
    A.S.dirCmp = (A.DIRS || []).slice(0, 3).map(d => d.id);
  }]);
}
if (hasView('external') && (A.EXT || []).length) {
  variants.push(['external 只看开放获取', 'external', () => { A.S.extAccess = 'open_access'; }]);
  variants.push(['external 按方向筛选', 'external', () => {
    A.S.extAccess = 'all';
    const d = (A.DIRS || []).filter(x => (A.EXT || []).some(e => (e.directionIds || []).indexOf(x.id) >= 0))[0];
    A.S.extDir = d ? d.id : '';
  }]);
}
if (!variants.length) console.log('  - 本项目没有方向/外部文献页，交互分支跳过');

/* V4.0 实验室：五个标签页各跑一遍。默认状态只能覆盖第一页，
   后面四页要是没进过渲染，出错了也发现不了。 */
const LABD = A.LAB || null;
if (LABD && (LABD.modules || []).length) {
  const M = LABD.modules;
  const m1 = M[0].id;
  const m2 = (M[1] || M[0]).id;
  const withAlgo = M.filter(m => (LABD.algorithms || []).some(a => (a.moduleIds || []).indexOf(m.id) >= 0));
  const mA = (withAlgo[0] || M[0]).id;
  const algOfM = (LABD.algorithms || []).filter(a => (a.moduleIds || []).indexOf(mA) >= 0)[0];
  const fail0 = (LABD.failures || [])[0];
  const ex0 = (LABD.exercises || [])[0];

  variants.push(
    ['lab 拆解地图', 'lab', () => { A.S.labTab = 'map'; A.S.labMod = m1; }],
    ['lab 换模块', 'lab', () => { A.S.labTab = 'map'; A.S.labMod = m2; A.S.labStat = {}; A.S.labStat[m2] = '已验证'; A.S.labImp = {}; A.S.labImp[m2] = 5; }],
    ['lab 建模与算法', 'lab', () => {
      A.S.labTab = 'model'; A.S.labMod = mA;
      A.S.labChoice = {}; if (algOfM) A.S.labChoice[mA] = algOfM.id;
      A.S.labCheck = {}; A.S.labCheck[mA] = ['data', 'assume'];
      A.S.labReason = {}; A.S.labReason[mA] = '冒烟测试写的一条理由';
    }],
    ['lab 原理到工程', 'lab', () => { A.S.labTab = 'impl'; A.S.labMod = mA; A.S.labLevel = '4'; }],
    /* 没有候选算法的模块也要过一遍「建模与算法」：这条分支会去全量模块里找
       "最近的有算法模块"，走的是没被上面几项覆盖的代码路径。 */
    ['lab 无算法模块', 'lab', () => {
      const noAlgo = M.filter(m => !(LABD.algorithms || []).some(a => (a.moduleIds || []).indexOf(m.id) >= 0));
      A.S.labTab = 'model'; A.S.labMod = (noAlgo[0] || M[0]).id;
      A.S.labChoice = {}; A.S.labCheck = {}; A.S.labReason = {};
    }],
    ['lab 实验与失败', 'lab', () => {
      A.S.labTab = 'exp'; A.S.labMod = mA;
      A.S.labFail = fail0 ? fail0.id : '';
      A.S.labDiag = {}; A.S.labDiag.d = fail0 ? (fail0.keywords || []).slice(0, 3).join(' ') : '';
    }],
    ['lab 交互训练', 'lab', () => {
      A.S.labTab = 'train'; A.S.labMode = 'guide';
      A.S.labPick = {}; if (ex0 && ex0.options && ex0.options[0]) A.S.labPick[ex0.id] = ex0.options[0].id;
    }],
    ['lab 挑战模式', 'lab', () => { A.S.labTab = 'train'; A.S.labMode = 'challenge'; }],
    ['lab 参考模式', 'lab', () => { A.S.labTab = 'train'; A.S.labMode = 'ref'; }]
  );
}
for (const [name, view, setup] of variants) {
  setup();
  try {
    const o = (window.VIEWS[view])(papers, A.CFG) || '';
    const leak = leakOf(o);
    if (leak) { console.log('  ✗ ' + name + ' 含 undefined/NaN：' + leak); fail++; }
    else console.log('  ✓ ' + name + '  ' + o.length + ' 字符');
  } catch (e) {
    console.log('  ✗ ' + name + ' 抛出异常：' + e.message); fail++;
  }
}
A.S.dirSel = ''; A.S.dirCmp = []; A.S.extAccess = 'all'; A.S.extDir = '';
A.S.labTab = 'map'; A.S.labLevel = '1'; A.S.labMode = 'guide'; A.S.labPick = {};

/* ---------------- 导出函数 ---------------- */
console.log('\n导出与计算：');
try {
  /* 空数组的 every() 恒为 true，会打出没有内容的假 ✓，所以先判有没有数据 */
  if (!(A.EXT || []).length) {
    console.log('  - 本项目没有外部推荐文献，extTotal 跳过');
  } else {
    const list = A.EXT.slice(0, 3).map(e => ({ e, t: A.extTotal(e) }));
    const ok = list.every(x => x.t > 0);
    console.log('  ' + (ok ? '✓' : '✗') + ' 六维加权总分可计算：'
      + list.map(x => x.t.toFixed(1)).join(', '));
    if (!ok) fail++;
  }
} catch (e) { console.log('  ✗ extTotal 抛异常：' + e.message); fail++; }

console.log('\n' + (fail ? '结果：' + fail + ' 处问题' : '结果：全部通过'));
process.exit(fail ? 1 : 0);
