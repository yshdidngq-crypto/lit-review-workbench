#!/usr/bin/env node
/* ============================================================================
 * validate.js —— 产出校验（零依赖，只需 Node，不必 npm install）
 * ----------------------------------------------------------------------------
 * 用法： node validate.js dist/xxx_文献工作台.html
 *
 * 作用：检查产出的 HTML 是否严格符合本规范。它检查的不是"好不好看"，
 * 而是"和组里其他人产出的是不是同一套" —— 颜色、字体、类名、注入顺序、
 * 数据完整性。任何一项不通过，就说明格式已经跑偏，必须修到全绿再交付。
 *
 * 退出码：0 = 全部通过；1 = 有未通过项。
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.log('用法: node validate.js <output.html>');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.log('文件不存在: ' + file);
  process.exit(1);
}

const html = fs.readFileSync(file, 'utf8');
const fails = [];
const warns = [];
const oks = [];
const skips = [];

function ok(name, detail) { oks.push({ name, detail }); }
function bad(name, detail, fix) { fails.push({ name, detail, fix }); }
function warn(name, detail) { warns.push({ name, detail }); }
/* V4.7.1：没数据可查的项单独记，不再混进 oks。
   以前它走 ok('…','未提供（跳过）')，于是"没查"也被算进"N 项检查全绿"——
   一个没有任何方向/外部文献/实验室的项目照样得到"全绿，可以交付"。 */
function skip(name, detail) { skips.push({ name, detail }); }

/* ---------------------------------------------------------------- 1. 样式基线 */
// 这些值一旦被改动，产出就和别人的不一致了。必须精确匹配。
const CSS_BASE = {
  '--bg': '#f3f1ec',
  '--panel': '#fbfaf6',
  '--ink': '#1c1a17',
  '--brand': '#274b6d',
  '--accent': '#2c5f8a',
  '--accent2': '#3f6f5e',
  '--line': '#e3ded3',
  '--r': '10px',
};
const rootMatch = html.match(/:root\s*\{([^}]*)\}/);
if (!rootMatch) {
  bad('样式基线', '未找到 :root 变量块', '应直接使用 assets/base.css，不要自行重写样式');
} else {
  const block = rootMatch[1];
  const wrong = [];
  for (const [k, v] of Object.entries(CSS_BASE)) {
    const m = block.match(new RegExp(k.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+);'));
    if (!m) { wrong.push(k + ' 缺失'); continue; }
    if (m[1].trim().toLowerCase() !== v.toLowerCase()) {
      wrong.push(k + ' = ' + m[1].trim() + '（应为 ' + v + '）');
    }
  }
  if (wrong.length) {
    bad('样式基线', '颜色变量被改动：' + wrong.join('；'), '恢复为 assets/base.css 的原始值，不要改主题色');
  } else {
    ok('样式基线', ':root 的 8 个基准变量与规范完全一致');
  }
}

const darkMatch = html.match(/html\[data-theme="dark"\]\s*\{([^}]*)\}/);
if (!darkMatch) bad('深色主题', '缺少 html[data-theme="dark"] 变量块', '使用完整的 base.css');
else if (!/--bg\s*:\s*#171614/i.test(darkMatch[1])) bad('深色主题', '深色主题 --bg 不是 #171614', '使用完整的 base.css');
else ok('深色主题', '深色主题变量完整');

const fontMatch = html.match(/font-family\s*:\s*"Segoe UI"[^;}]*/i);
if (!fontMatch) bad('字体栈', 'body 字体栈不是规范值', '使用完整的 base.css');
else if (!/PingFang SC/.test(fontMatch[0]) || !/Microsoft YaHei/.test(fontMatch[0])) {
  bad('字体栈', '字体栈缺少中文回退字体', '使用完整的 base.css');
} else ok('字体栈', 'Segoe UI → PingFang SC → Microsoft YaHei');

/* ---------------------------------------------------------------- 2. 结构基线 */
const STRUCT = ['.app', '.side', '.main', '#view', '.drawer', '.card', '.card-h', '.card-b',
  '.tag', '.score', '.prog-row', '.empty', '.btn', '.chip'];
const missingStruct = STRUCT.filter(s => {
  const cls = s.startsWith('#') ? s.slice(1) : s.replace(/^\./, '');
  return !new RegExp('(id|class)="[^"]*\\b' + cls + '\\b').test(html);
});
/* 无障碍基线（V4.8.2）：不属于新增检查项，而是骨架的组成部分。
 * 少了它们，键盘用户和读屏用户就用不了这个页面。 */
const A11Y = [
  ['class="skip"', '跳转链接'],
  [':focus-visible', '焦点环'],
  ['prefers-reduced-motion', '减少动效'],
  ['aria-label="模块导航"', '导航语义标签'],
];
const missingA11y = A11Y.filter(x => html.indexOf(x[0]) < 0).map(x => x[1]);
if (missingStruct.length) bad('结构基线', '缺少骨架元素：' + missingStruct.join(', '), '使用 assets/index.tpl.html 并调用 ui.js 的构件函数');
else if (missingA11y.length) bad('结构基线', '缺少无障碍基线：' + missingA11y.join('、'), '使用 assets/index.tpl.html 与完整的 base.css（这两样是锁死的，改坏了就要还原）');
else ok('结构基线', '骨架元素齐全（' + STRUCT.length + ' 项）+ 无障碍基线 4 项');

/* 2.1 V4.6.1 已废弃的旁白节点不得回流：logo 副标题、侧栏来源行、页头副标题。 */
const STALE_CHROME = ['/*__LOGO_SUB__*/', '/*__SIDE_SRC__*/', 'id="viewSub"', 'id="side-gen"'];
const staleChrome = STALE_CHROME.filter(s => html.indexOf(s) >= 0);
if (staleChrome.length) bad('结构基线', '出现已废弃的旁白节点：' + staleChrome.join(', '), '使用 V4.6.1 的 assets/index.tpl.html（logo 副标题 / 侧栏来源行 / 页头副标题已删除）');

/* ---------------------------------------------------------------- 3. 禁止项 */
/* 判"外链"不能全文搜 http。真实文献数据里，摘要字段本身就可能带 DOI 或出版社链接，
 * 这些是书目数据，不会被浏览器加载，断网也不影响页面。
 * 必须拦的是"会去网络取东西"的四种写法：script/link/img/iframe/source 的取资源属性、
 * CSS 的 @import 与 url()、以及运行时的 fetch/XHR。 */
const svgNS = /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g;
const noNS = html.replace(svgNS, '');

const loaders = [
  [/<script\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\//gi, '<script src>'],
  [/<link\b[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\//gi, '<link href>'],
  [/<img\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\//gi, '<img src>'],
  [/<(?:iframe|embed|object|source|video|audio)\b[^>]*\b(?:src|data)\s*=\s*["']?(?:https?:)?\/\//gi, '<iframe/src>'],
  [/@import\s+(?:url\()?["']?(?:https?:)?\/\//gi, '@import'],
  [/url\(\s*["']?(?:https?:)?\/\//gi, 'CSS url()'],
  [/@font-face[\s\S]{0,200}?https?:\/\//gi, '@font-face 远程字体'],
  [/\b(?:fetch|importScripts)\s*\(\s*["'`](?:https?:)?\/\//gi, 'fetch() 远程请求'],
  [/new\s+XMLHttpRequest[\s\S]{0,200}?\.open\s*\(\s*["'][A-Z]+["']\s*,\s*["'](?:https?:)?\/\//gi, 'XHR 远程请求'],
];
const hits = loaders.filter(([re]) => re.test(noNS)).map(([, name]) => name);
if (hits.length) {
  bad('离线自包含', '存在会联网加载资源的位置：' + [...new Set(hits)].join('、'),
    '移除 CDN/远程字体/远程图片，所有资源必须内联；<a href> 超链接与数据里的 DOI 不算资源引用');
} else {
  const nLink = (noNS.match(/<a\b[^>]*\bhref\s*=\s*["']https?:/gi) || []).length;
  ok('离线自包含', nLink
    ? '无联网加载（含 ' + nLink + ' 个可点击外链，断网时仅跳转失效，不影响页面本身）'
    : '无外部资源引用');
}

if (/<link[^>]+stylesheet/i.test(html)) bad('禁止项', '存在 <link rel="stylesheet">', 'CSS 必须内联到 <style>');
if (/@import/i.test(html)) bad('禁止项', '存在 @import', 'CSS 必须内联');
if (/window\.echarts|\becharts\.init|new\s+Chart\s*\(|d3\.select|Highcharts\.chart/i.test(html)) {
  bad('禁止项', '真实调用了第三方图表库', '图表必须用 assets/charts.js 生成');
} else ok('禁止项', '无第三方图表库调用');
/* 查 <img> 必须先剥掉 <script> 里的字符串：KaTeX 内部会把 \includegraphics 的
 * 节点序列化成 '<img src="…">'，那是它源码里的一段文本，不是页面里的图片。
 * 不剥离就会把"合法内联库"误判成"用了位图"。 */
const htmlNoScript = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
const imgs = htmlNoScript.match(/<img\s/gi);
if (imgs) bad('禁止项', '存在 <img> 标签 ' + imgs.length + ' 处', '图表必须是内联 SVG，不允许用图片');
if (!imgs) ok('图表规范', '全部图表为内联 SVG，无位图');

/* ---------------------------------------------------------------- 4. 注入顺序 */
/* assets/lab.js 是工程实验室模块。V4.7 起该模块改为「用户自选」——
 * 没启用就不注入，产物里也不该有它。所以它不进固定顺序表，
 * 而是单独判断：产物里出现了 lab 视图，就必须有 lab.js；没有就不查。 */
const ORDER = ['assets/katex.min.js', 'assets/charts.js', 'assets/ui.js', 'assets/app.core.js',
  'src/views.js', 'src/tabs.js', 'assets/app.bind.js', 'assets/math.js'];
const hasLabView = (() => {
  const c = extractJSON(html, 'window.LIT_CONFIG=');   // 函数声明会提升，可提前调用
  return !!(c && Array.isArray(c.views) && c.views.some(v => v && v.id === 'lab'));
})();
if (hasLabView) ORDER.splice(ORDER.indexOf('src/tabs.js'), 0, 'assets/lab.js');
const pos = ORDER.map(f => html.indexOf('/* ==== ' + f + ' ==== */'));
const missOrder = ORDER.filter((f, i) => pos[i] < 0);
if (missOrder.length) {
  bad('脚本注入', '缺少模块：' + missOrder.join(', '), '用 scripts/build.py 构建，不要手工拼接');
} else {
  let badOrder = null;
  for (let i = 1; i < pos.length; i++) if (pos[i] < pos[i - 1]) badOrder = ORDER[i] + ' 出现在 ' + ORDER[i - 1] + ' 之前';
  if (badOrder) bad('脚本注入', '模块顺序错误：' + badOrder, '用 scripts/build.py 构建');
  else ok('脚本注入', ORDER.length + ' 个模块顺序正确');
}

/* ---------------------------------------------------------------- 5. 数据完整性 */
/** 从 HTML 里抠出 prefix= 后面的 JSON 值：做括号配对，跳过字符串内的括号与转义 */
function extractJSON(src, prefix) {
  const i = src.indexOf(prefix);
  if (i < 0) return null;
  let j = i + prefix.length;
  while (j < src.length && /\s/.test(src[j])) j++;
  const open = src[j];
  if (open !== '{' && open !== '[') return null;
  const start = j;
  let depth = 0, inStr = false, esc = false;
  for (; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(src.slice(start, j + 1)); } catch (e) { return null; }
      }
    }
  }
  return null;
}

const CFG = extractJSON(html, 'window.LIT_CONFIG=');
const PAPERS = extractJSON(html, 'window.LIT_PAPERS=');
const META = extractJSON(html, 'window.LIT_META=');

if (!CFG) bad('数据段', 'window.LIT_CONFIG 无法解析', '用 build.py 生成，不要手工编辑 data 段');
else if (!CFG.project || !CFG.topics || !CFG.views) bad('数据段', 'LIT_CONFIG 缺少 project/topics/views', '见 examples/config.example.json');
/* V4.9.2：没配 statuses 时详情页的「阅读状态」一个按钮都不出现，用户会以为
   自己点了没反应。这不是可选字段，缺了就是功能静默失效，必须报出来。 */
else if (!Array.isArray(CFG.statuses) || !CFG.statuses.length) bad('数据段', 'LIT_CONFIG 没有配 statuses（阅读状态列表）', '在 config.json 里加一段 "statuses": ["未阅读", "正在阅读", "已初读", "已精读"]；不配的话读了也改不了状态');
else ok('数据段', 'LIT_CONFIG 正常（主题 ' + CFG.topics.length + ' 类，模块 ' + CFG.views.length + ' 个，阅读状态 ' + CFG.statuses.length + ' 档）');

if (!PAPERS) bad('数据段', 'window.LIT_PAPERS 无法解析', '用 build.py 生成');
else if (!Array.isArray(PAPERS) || !PAPERS.length) bad('数据段', 'LIT_PAPERS 为空', '检查 data/papers.json');
else {
  const REQ = ['id', 'title', 'topic', 'relevance', 'learning', 'difficulty'];
  const lack = [];
  const topicIds = new Set((CFG && CFG.topics || []).map(t => t.id));
  PAPERS.forEach((p, i) => {
    REQ.forEach(k => { if (p[k] === undefined || p[k] === null || p[k] === '') lack.push(`#${i + 1}(${p.id || '?'}) 缺 ${k}`); });
    if (p.topic && topicIds.size && !topicIds.has(p.topic)) lack.push(`${p.id} 的 topic=「${p.topic}」不在配置中`);
  });
  if (lack.length) bad('论文数据', '字段缺失 ' + lack.length + ' 处，例如：' + lack.slice(0, 5).join('；'), '补齐字段后重新 build');
  else ok('论文数据', PAPERS.length + ' 篇，字段完整、主题归属有效');
}

if (!/window\.VIEWS\s*=/.test(html)) bad('视图层', '未找到 window.VIEWS 定义', 'src/views.js 必须以 window.VIEWS = {...} 导出；若要全部用通用骨架，本项目不要建 src/views.js');
else {
  // 两种合法写法都认：VIEWS.dash = function / dash: function / dash: (papers, cfg) => …
  const want = (CFG && CFG.views || []).map(v => v.id);
  const lackV = want.filter(id => !new RegExp('[.\\s{]' + id + '\\s*[:=]\\s*(function|\\()').test(html));
  /* V4.7.1：从 warn 改成 bad。config.views 里登记了、src/views.js 里却没有渲染函数，
     页面上就是一个"该标签未实现"的空块 —— 这是缺件，不是提醒。 */
  if (lackV.length) bad('视图层', '以下模块在 config.views 里登记了，但 src/views.js 没有渲染函数（页面会显示占位提示）：' + lackV.join(', '), '要么在 src/views.js 补上 window.VIEWS.' + lackV[0] + ' = function(papers, cfg){...}（内置十页可省略，缺了会自动用 assets/views.base.js 的通用版），要么把它从 config.json 的 views 里删掉');
  else ok('视图层', '全部 ' + want.length + ' 个模块都有渲染函数');
}
if (!((CFG && CFG.detailTabs) || []).length) {
  warn('详情页', 'config.detailTabs 是空的，点开任意一篇只会看到"该标签未实现"',
    '在 config.json 里写 detailTabs（V4.12.1 起 build.py 会自动补 6 项默认值）');
}
if (!/window\.TABS\s*=/.test(html)) bad('详情页', '未找到 window.TABS 定义', 'src/tabs.js 必须以 window.TABS = {...} 导出');
else ok('详情页', 'TABS 已定义');

/* ---------------------------------------------------------------- 6. 内容质量 */
// 本架构的正文由 JS 渲染，所以统计全文中文（含 JSON 数据与视图文案），
// 而不是剥掉 script 后的静态文本 —— 后者永远只有导航几个字。
const cn = (html.match(/[\u4e00-\u9fa5]/g) || []).length;
if (cn < 5000) bad('内容量', '全文中文字符仅 ' + cn + '，明显偏少', '检查是否只放了骨架、没有真实论文摘要与说明文字');
else ok('内容量', '全文中文字符约 ' + cn + ' 个');

const textOnly = html.replace(/<[^>]+>/g, ' ');
if (/TODO|待补充|PLACEHOLDER/.test(textOnly)) {
  warn('占位符', '正文中出现 TODO/待补充/占位 等字样，交付前应清理');
}

// 正文是 JS 渲染的，引擎源码里本来就有 undefined / NaN 的判空写法，
// 所以要剥掉 <script> 与 <style> 再看静态文本；真正的空值泄漏只会出现在
// 数据段的字符串里（例如把 "undefined" 当内容写进了 overview）。
const bodyText = html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ');
const leaks = [];
if (PAPERS && Array.isArray(PAPERS)) {
  PAPERS.forEach(p => Object.keys(p).forEach(k => {
    const v = p[k];
    if (typeof v === 'string' && /\bundefined\b|\bNaN\b/.test(v)) leaks.push((p.id || '?') + '.' + k);
    if (Array.isArray(v) && v.some(x => typeof x === 'string' && /\bundefined\b|\bNaN\b/.test(x))) leaks.push((p.id || '?') + '.' + k);
  }));
}
/* V4.7.1：正文由 JS 渲染，剥掉 <script> 就等于剥掉了真正要查的东西 ——
   有人把 "undefined" 直接写进句子（例如 'undefined 本批文献的…'），旧逻辑看不见。
   这里补一层：找"前后 8 个字符内有中文"的 undefined/NaN。
   katex/charts 里的判空写法（"undefined"!=typeof）周围全是 ASCII，不会误报；
   真正的空值泄漏一定长在文案或数据字符串里，周围必有中文。 */
const zhLeaks = [];
{
  /* 注释不渲染，先剔掉再扫（否则"说明里提到 undefined"也会误报），
     只剔块注释和整行 // 注释，避免伤到 "https://…" 这类字符串。 */
  const scanText = html
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/[^\n]*/gm, ' ');
  const re = /(?:undefined|NaN)/g;
  let m;
  while ((m = re.exec(scanText)) !== null) {
    const s = Math.max(0, m.index - 8);
    const ctx = scanText.slice(s, m.index + m[0].length + 8);
    if (/[\u4e00-\u9fa5]/.test(ctx)) {
      zhLeaks.push(scanText.slice(Math.max(0, m.index - 14), m.index + m[0].length + 14)
        .replace(/\s+/g, ' ').trim());
    }
  }
}
if (leaks.length || zhLeaks.length) {
  const parts = [];
  if (leaks.length) parts.push('数据字段 ' + leaks.length + ' 处：' + leaks.slice(0, 4).join('，'));
  if (zhLeaks.length) parts.push('文案 ' + zhLeaks.length + ' 处：' + zhLeaks.slice(0, 4).map(s => '「' + s + '」').join('，'));
  bad('渲染值', '有 undefined/NaN 漏进正文 —— ' + parts.join('；'), '检查该字段是否有值，或改写为「未报告」「无」；文案里的 undefined 是拼串时变量为空，去掉它或补默认值');
} else if (/undefined|NaN(?![\w])/.test(bodyText)) warn('渲染值', '静态文本中出现 undefined/NaN，请检查');
else ok('渲染值', '无空值泄漏');

/* ---------------------------------------------------------------- 7. V3 数据结构 */
/* V3 的四份数据可以都不存在（只有本地文献的项目同样合法）。因此这四项检查
   永远输出一行：没数据记"未查"（skip），有数据就真查。
   这样无论项目用不用新模块，检查项总数都是固定的，输出格式不会跳。
   V4.7.1：没查的项不再算"全绿"。汇总行明确写"X 项通过、Y 项无数据未查"。 */
const DIRECTIONS = extractJSON(html, 'window.LIT_DIRECTIONS=');
const EXTERNAL = extractJSON(html, 'window.LIT_EXTERNAL=');
const SESSION = extractJSON(html, 'window.LIT_SESSION=');
const LANDSCAPE = extractJSON(html, 'window.LIT_LANDSCAPE=');

const hasDirs = Array.isArray(DIRECTIONS) && DIRECTIONS.length > 0;
const hasExt = Array.isArray(EXTERNAL) && EXTERNAL.length > 0;

/* --- 7.1 方向树 --- */
if (!hasDirs) skip('方向数据', '未提供（跳过，本项未查）');
else {
  const REQD = ['id', 'level', 'name', 'oneLine', 'problem', 'whyOpportunity',
    'keywords', 'techRoute', 'minExperiment', 'expectedOutput'];
  const errs = [];
  const dIds = new Set(DIRECTIONS.map(d => d.id));
  const dById = {};
  DIRECTIONS.forEach(d => { dById[d.id] = d; });
  DIRECTIONS.forEach(d => {
    REQD.forEach(k => {
      if (d[k] === undefined || d[k] === null || d[k] === '' || (Array.isArray(d[k]) && !d[k].length)) {
        errs.push((d.id || '?') + ' 缺 ' + k);
      }
    });
    if (d.parentId) {
      if (!dIds.has(d.parentId)) errs.push(d.id + ' 的 parentId=' + d.parentId + ' 不存在');
      else if (d.level !== (dById[d.parentId].level || 0) + 1) errs.push(d.id + ' 的 level 与父节点不匹配');
    } else if (d.level !== 1) errs.push(d.id + ' 无 parentId 但 level≠1');
    // 关键词是方向↔文献关联的唯一依据，没有英文词就一个外部文献都挂不上
    const kw = d.keywords || [];
    if (kw.length && !kw.some(k => /[A-Za-z]{3,}/.test(k))) errs.push(d.id + ' 的 keywords 里没有英文词，外部关联会全空');
  });
  const deep = DIRECTIONS.filter(d => (d.level || 1) > 2);
  if (deep.length) warn('方向树', '有 ' + deep.length + ' 个三级及更深的方向（如 ' + deep[0].id
    + '），方向树图只画两级，这些节点不会显示；请把它们的内容并进父方向的 techRoute');
  if (errs.length) bad('方向数据', '共 ' + errs.length + ' 处问题：' + errs.slice(0, 5).join('；'), '修 data/directions.json 后重跑 link.py');
  else ok('方向数据', DIRECTIONS.length + ' 个（一级 ' + DIRECTIONS.filter(d => d.level === 1).length + ' 个），字段完整');
}

/* --- 7.2 外部文献：DOI 格式与打分明细 --- */
if (!hasExt) skip('外部文献', '未提供（跳过，本项未查）');
else {
  const DOI_RE = /^10\.\d{4,9}\/\S+$/;
  const badDoi = [];
  const noScore = [];
  EXTERNAL.forEach(e => {
    const doi = (e.doi || '').trim();
    if (doi && !DOI_RE.test(doi)) badDoi.push((e.id || '?') + '=' + doi);
    const s = e.score || {};
    if (typeof s.total !== 'number') noScore.push(e.id || '?');
  });
  if (badDoi.length) {
    bad('外部文献', '有 ' + badDoi.length + ' 条 DOI 格式不合法：' + badDoi.slice(0, 3).join('，'),
      'DOI 只能来自检索结果原始字段，不许手写（铁律 7）');
  } else if (noScore.length) {
    bad('外部文献', '有 ' + noScore.length + ' 条缺六维打分明细', '重跑 discover.py，页面靠这份明细解释推荐理由');
  } else {
    const oa = EXTERNAL.filter(e => e.accessStatus === 'open_access').length;
    ok('外部文献', EXTERNAL.length + ' 篇，DOI 合法、打分明细齐全（开放获取 ' + oa + ' 篇）');
  }
}

/* --- 7.3 双向关联对称性 --- */
/* 这一项专治"页面两侧数字对不上"：方向说关联 5 篇、文献页只有 3 篇，
   读者会立刻不信任整份报告。必须逐个方向核对集合相等。 */
if (!hasDirs || !hasExt) skip('双向关联', '未提供（跳过，本项未查）');
else {
  const byId = {};
  EXTERNAL.forEach(e => { byId[e.id] = e; });
  const extIds = new Set(EXTERNAL.map(e => e.id));
  const mis = [];
  DIRECTIONS.forEach(d => {
    const ev = d.externalEvidence || {};
    const listed = ev.recommendedExternalIds || [];
    listed.forEach(id => { if (!extIds.has(id)) mis.push(d.id + ' 指向不存在的文献 ' + id); });
    if (d.externalLinkMode === 'aggregated') return;   // 父方向是聚合结果，不参与对称性比较
    const actual = EXTERNAL.filter(e => (e.directionIds || []).indexOf(d.id) >= 0).map(e => e.id).sort().join(',');
    const declared = listed.slice().sort().join(',');
    if (actual !== declared) mis.push(d.id + ' 两侧不一致（方向侧 ' + (listed.length) + ' 篇 / 文献侧 ' + actual.split(',').filter(Boolean).length + ' 篇）');
  });
  if (mis.length) bad('双向关联', '共 ' + mis.length + ' 处不对称：' + mis.slice(0, 4).join('；'), '重跑 scripts/link.py');
  else {
    const linked = EXTERNAL.filter(e => (e.directionIds || []).length).length;
    ok('双向关联', '方向↔文献两侧一致（' + linked + ' / ' + EXTERNAL.length + ' 篇已挂方向）');
  }
}

/* --- 7.4 研究现状报告 --- */
if (!LANDSCAPE || !Array.isArray(LANDSCAPE.answers) || !LANDSCAPE.answers.length) skip('现状报告', '未提供（跳过，本项未查）');
else {
  const ans = LANDSCAPE.answers;
  const noCav = ans.filter(a => !a.caveat || !String(a.caveat).trim());
  const noHead = ans.filter(a => !a.headline || !String(a.headline).trim());
  if (noCav.length) {
    bad('现状报告', noCav.length + ' 条答案缺 caveat（口径说明）', '口径说明是防止把样本薄误读成学术空白的唯一机制，不能删（铁律 6）');
  } else if (noHead.length) {
    bad('现状报告', noHead.length + ' 条答案缺结论句', '重跑 scripts/landscape.py');
  } else if (ans.length !== 8) {
    warn('现状报告', '答案数为 ' + ans.length + '，规范是 8 问（Q1–Q5、Q7、Q8、Q10）');
    ok('现状报告', ans.length + ' 问，口径齐全');
  } else ok('现状报告', '8 问，结论句与口径说明齐全');
}

/* --- 7.5 外部文献标签 --- */
if (!hasExt) skip('外部标签', '未提供（跳过，本项未查）');
else {
  const want = (CFG && CFG.extTabs || []).map(t => t.id);
  if (!want.length) bad('外部标签', 'config.extTabs 未配置', '外部文献没有 overview/method，硬套 detailTabs 会显示一堆"—"');
  else {
    const lackT = want.filter(id => !new RegExp('[.\\s{]' + id + '\\s*[:=]\\s*(function|\\()').test(html));
    if (lackT.length) bad('外部标签', '以下标签未实现：' + lackT.join(', '), '在 src/tabs.js 里补 window.TABS.' + lackT[0]);
    else ok('外部标签', want.length + ' 个标签均已实现');
  }
}

/* --- 7.6 主题配色（V4.7）
 * 事故记录：主题构成环形图与散点气泡全部渲染成同一种灰，分类维度整个消失。
 * 根因是 config 的 topics 没有 color，视图层退化成 var(--muted)。
 * 锁定层已加默认色板兜底（不会全灰了），但作者仍应显式指定颜色 ——
 * 默认色板是"不至于出错"，作者指定才是"分得清楚"。
 * 所以这里查的是"有没有显式颜色"，而不是"最终是不是灰的"。 */
if (CFG && Array.isArray(CFG.topics) && CFG.topics.length) {
  const noColor = CFG.topics.filter(t => !t || !t.color).map(t => (t && t.id) || '?');
  if (noColor.length)
    bad('主题配色', '以下主题没有 color：' + noColor.join(', '),
      '在 config.json 的 topics 里给每个主题加 color（如 "color": "#2f6feb"）；缺色时图表会退化成单色，分类维度消失');
  else ok('主题配色', CFG.topics.length + ' 个主题均已指定颜色');
}

/* 数据侧的同一条病（V4.11.1）：config 配了色，但 data/landscape.json 是早于配色的旧文件，
 * 里面 rows 的 color 全是空串，环形图照样只能整张一色。这里给提醒，不挡交付。 */
const noRowColor = ((LANDSCAPE && LANDSCAPE.answers) || [])
  .filter(a => a && a.chart === 'donut' && Array.isArray(a.rows) && a.rows.length >= 3)
  .filter(a => a.rows.every(r => !r || !r.color))
  .map(a => a.id || a.title || '?');
if (noRowColor.length)
  warn('主题配色', '现状报告里这些问题的 rows 全部没有 color：' + noRowColor.join(', ')
    + '（像是早于配色的旧文件）', '重跑 scripts/landscape.py，或在 config.json 的 topics 里补 color 后重新生成');


/* ---------------------------------------------------------------- 8. 工程思维实验室（V4.0）
 * 这一块查的不是"好不好看"，是"会不会教错"：
 *   - 引用了不存在的论文 → 页面上点开是空的，等于编造；
 *   - 学习单元缺某一级解释 → 学生看到的是结论，不是推导；
 *   - 决策题没有判定 → 变成了没有反馈的问卷；
 *   - 失败模式没有关键词 → 逆向诊断永远匹配不到。
 * 每条都必须真的能挡住一类错误，凑数的检查一律不加。
 */
const LAB = extractJSON(html, 'window.LIT_LAB=');
const hasLab = !!(LAB && Array.isArray(LAB.modules) && LAB.modules.length);
const PAPER_IDS = new Set((PAPERS || []).map(p => p.id));
const EXT_IDS = new Set((Array.isArray(EXTERNAL) ? EXTERNAL : []).map(e => e.id));
const refOK = id => PAPER_IDS.has(id) || EXT_IDS.has(id);

if (!hasLab) {
  skip('实验室数据', '未提供（跳过，本项未查）');
} else {
  const MODS = LAB.modules || [];
  const ALGS = LAB.algorithms || [];
  const UNITS = LAB.learning || [];
  const EXPS = LAB.experiments || [];
  const FAILS = LAB.failures || [];
  const EXCS = LAB.exercises || [];
  const MOD_IDS = new Set(MODS.map(m => m.id));

  /* --- 8.1 模块：必填项 + id 唯一 + 依赖合法 --- */
  const REQ_MOD = ['id', 'title', 'layer', 'cat', 'problemStatement', 'whyNeeded',
    'inputRequirements', 'outputDefinition', 'prerequisites', 'mathQuestions',
    'dependencies', 'importance', 'implementationRisks', 'validationCriteria', 'relatedPaperIds'];
  const lackMod = [];
  const seen = new Set();
  MODS.forEach((m, i) => {
    REQ_MOD.forEach(k => {
      if (m[k] === undefined || m[k] === null || m[k] === '') lackMod.push(`#${i + 1}(${m.id || '?'}) 缺 ${k}`);
    });
    if (seen.has(m.id)) lackMod.push('重复 id：' + m.id);
    seen.add(m.id);
    if (!Array.isArray(m.mathQuestions) || !m.mathQuestions.length) lackMod.push((m.id || '?') + ' 没有数学问题（这层是最容易被跳过的一层）');
    if (!Array.isArray(m.validationCriteria) || !m.validationCriteria.length) lackMod.push((m.id || '?') + ' 没有验证判据');
    (m.dependencies || []).forEach(d => {
      if (!MOD_IDS.has(d)) lackMod.push((m.id || '?') + ' 依赖的 ' + d + ' 不存在');
      if (d === m.id) lackMod.push((m.id || '?') + ' 依赖了自己');
    });
  });
  if (!LAB.profile || !LAB.profile.researchGoal) lackMod.push('profile.researchGoal 未填写（没有研究目标，拆解就没有依据）');
  if (lackMod.length) {
    bad('模块拆解', '共 ' + lackMod.length + ' 处：' + lackMod.slice(0, 5).join('；'),
      '模块是这一页的骨架，缺项会让下方十项说明出现"—"');
  } else {
    ok('模块拆解', MODS.length + ' 个模块，依赖与必填项齐全');
  }

  /* profile 里的项目标签必须由数据自己带（facts），不能靠页面写死「阶段」「基础」。
     旧字段留着不会报错，但页面已经不渲染了 —— 提醒一句，免得以为丢了内容。 */
  const legacyProf = ['projectStage', 'mode', 'userKnowledgeLevel']
    .filter(k => LAB.profile && Object.prototype.hasOwnProperty.call(LAB.profile, k));
  if (legacyProf.length) {
    warn('项目标签', 'profile 里还有旧字段 ' + legacyProf.join(' / ') + '，页面不再渲染',
      '改成 profile.facts: [{k:"阶段", v:"…"}]，标签由项目自己写（见 08 契约 2.1）');
  }

  /* --- 8.2 论文引用必须落在真实存在的条目上 --- */  const bogus = [];
  const pushRef = (where, ids) => (ids || []).forEach(id => { if (!refOK(id)) bogus.push(where + ' → ' + id); });
  MODS.forEach(m => pushRef(m.id, m.relatedPaperIds));
  ALGS.forEach(a => pushRef(a.id, a.relatedPaperIds));
  // evidence 允许写成单个对象或对象数组（数据契约里两种都合法）
  const evArr = x => (!x ? [] : Array.isArray(x) ? x : [x]);
  UNITS.forEach(u => {
    pushRef(u.id, u.paperIds);
    evArr(u.evidence).forEach(e => pushRef(u.id, (e && e.refs) || []));
  });
  EXPS.forEach(e => pushRef(e.id, e.paperIds));
  FAILS.forEach(f => pushRef(f.id, f.paperIds));
  EXCS.forEach(q => (q.options || []).forEach(o => pushRef(q.id, o.refs)));
  (LAB.profile && LAB.profile.questions || []).forEach(q => pushRef('profile.questions', q.refs));
  if (bogus.length) {
    bad('实验室引用', bogus.length + ' 处指向本库不存在的条目：' + bogus.slice(0, 4).join('；'),
      '这些点开会是空的。删掉，或改成 knowledgeGap 让学生去外部文献页补检');
  } else {
    ok('实验室引用', '全部论文引用都能在本库点开（' + (PAPER_IDS.size + EXT_IDS.size) + ' 条可选）');
  }

  /* --- 8.3 算法：归属模块、分层、证据分级 --- */
  const algErr = [];
  const TIERS = ['learn', 'quick', 'fit', 'research'];
  const LEVELS = ['paper', 'inference', 'doc', 'ai', 'spec'];
  ALGS.forEach(a => {
    if (!(a.moduleIds || []).length) algErr.push((a.id || '?') + ' 没有归属模块，页面上永远不显示');
    (a.moduleIds || []).forEach(mid => { if (!MOD_IDS.has(mid)) algErr.push((a.id || '?') + ' 归属的模块 ' + mid + ' 不存在'); });
    if (TIERS.indexOf(a.tier) < 0) algErr.push((a.id || '?') + ' 的 tier=' + a.tier + ' 不在 ' + TIERS.join('/'));
    if (!a.evidence || LEVELS.indexOf(a.evidence.level) < 0) algErr.push((a.id || '?') + ' 缺证据分级（level 必须是 ' + LEVELS.join('/') + '）');
    if (!(a.limitations || []).length) algErr.push((a.id || '?') + ' 没有写限制（只写优点的算法推荐等于广告）');
    if (!a.requires || typeof a.requires !== 'object') algErr.push((a.id || '?') + ' 缺 requires（适用性自检靠它判硬条件）');
  });
  /* expectsAlgorithms:false 的模块本来就不是"选算法"的层（问题定义、可辨识性分析、
     系统集成），没有候选算法是对的，不该报警。 */
  const noAlg = MODS.filter(m => m.expectsAlgorithms !== false
    && !ALGS.some(a => (a.moduleIds || []).indexOf(m.id) >= 0)).map(m => m.id);
  if (algErr.length) bad('实验室算法', algErr.slice(0, 5).join('；'), '算法必须能落到模块、能分级、能说清限制');
  else ok('实验室算法', ALGS.length + ' 个，分层与证据分级齐全');
  if (noAlg.length) warn('实验室算法', noAlg.length + ' 个模块没有候选算法（' + noAlg.join('、') + '），页面上会提示去外部补检');

  /* --- 8.4 学习单元：四级解释缺一不可 --- */
  const unitErr = [];
  const LV = ['intuition', 'math', 'solve', 'numeric'];
  const PRIOS = ['P0', 'P1', 'P2', 'P3'];
  UNITS.forEach(u => {
    if (!MOD_IDS.has(u.moduleId)) unitErr.push((u.id || '?') + ' 挂在不存在的模块 ' + u.moduleId);
    LV.forEach(k => {
      const v = u.levels && u.levels[k];
      if (!v || String(v).trim().length < 20) unitErr.push((u.id || '?') + ' 的 ' + k + ' 级解释缺失或过短');
    });
    if (PRIOS.indexOf(u.priority) < 0) unitErr.push((u.id || '?') + ' 的 priority 不在 P0–P3');
    if (!(u.evidence || []).length) unitErr.push((u.id || '?') + ' 没有证据分级（不许裸结论）');
    if (!(u.practiceTasks || []).length) unitErr.push((u.id || '?') + ' 没有动手练习，掌握度无从判断');
  });
  if (unitErr.length) {
    bad('学习单元', unitErr.slice(0, 5).join('；'),
      '四级解释少一级，学生就只能看到结论；证据分级缺失等于把推测当事实');
  } else {
    ok('学习单元', UNITS.length + ' 个，四级解释齐备且都有证据分级');
  }

  /* --- 8.5 实验与失败模式 --- */
  const expErr = [];
  EXPS.forEach(e => {
    ['hypothesis', 'failureCriteria', 'reproducibility'].forEach(k => {
      if (!e[k] || !String(e[k]).trim()) expErr.push((e.id || '?') + ' 缺 ' + k);
    });
    if (!(e.metrics || []).length) expErr.push((e.id || '?') + ' 没有评价指标');
    if (!(e.baseline || []).length) expErr.push((e.id || '?') + ' 没有基线（没有基线就没有可比性）');
    (e.moduleIds || []).forEach(mid => { if (!MOD_IDS.has(mid)) expErr.push((e.id || '?') + ' 挂在不存在的模块 ' + mid); });
  });
  const failErr = [];
  FAILS.forEach(f => {
    if (!(f.keywords || []).length) failErr.push((f.id || '?') + ' 没有 keywords，逆向诊断永远匹配不到');
    if (!(f.diagnosis || []).length) failErr.push((f.id || '?') + ' 没有诊断步骤（只说"可能错了"没有用）');
    if (!(f.causes || []).length) failErr.push((f.id || '?') + ' 没有可能原因');
  });
  if (expErr.length || failErr.length) {
    bad('实验与失败', (expErr.concat(failErr)).slice(0, 5).join('；'),
      '没有失败判据的实验不算设计；没有诊断步骤的失败模式只能吓人');
  } else {
    ok('实验与失败', EXPS.length + ' 个实验方案 / ' + FAILS.length + ' 条失败模式');
  }

  /* --- 8.6 决策题：必须有判定与解释 --- */
  const qErr = [];
  const VERD = ['good', 'partial', 'wrong'];
  EXCS.forEach(q => {
    const opts = q.options || [];
    if (opts.length < 2) qErr.push((q.id || '?') + ' 选项少于 2 个');
    opts.forEach(o => {
      if (VERD.indexOf(o.verdict) < 0) qErr.push((q.id || '?') + '/' + (o.id || '?') + ' 缺 verdict');
      if (!o.why || String(o.why).trim().length < 10) qErr.push((q.id || '?') + '/' + (o.id || '?') + ' 没有解释');
    });
    if (q.moduleId && !MOD_IDS.has(q.moduleId)) qErr.push((q.id || '?') + ' 挂在不存在的模块 ' + q.moduleId);
  });
  if (qErr.length) {
    bad('科研决策题', qErr.slice(0, 5).join('；'),
      '题目没有判定与解释，就只是问卷；学员得不到任何反馈');
  } else {
    const nGood = EXCS.filter(q => (q.options || []).some(o => o.verdict === 'good')).length;
    ok('科研决策题', EXCS.length + ' 题，' + nGood + ' 题有可判为"方向正确"的选项');
  }

  /* --- 8.7 条件假设：必须显式写出"哪些判断是假设" --- */
  const asm = (LAB.profile && LAB.profile.assumptions) || [];
  if (!asm.length) {
    warn('条件假设', 'profile.assumptions 为空：读者会以为所有判断都已被证实',
      '缺数据时形成的拆解必须标注哪些属于条件假设');
  } else {
    ok('条件假设', asm.length + ' 条已显式标注');
  }
}

/* ---------------------------------------------------- 8.8 编号对照（S1、S2…）
 * 技术环节在 config.json 里是有序的，图谱页自然会用 S1/S2 当行头、列头。
 * 编号本身不含语义：读者看到 S7 时如果找不到"S7 = RANSAC 与最小二乘精化"，
 * 这张表就等于没有标签。对照表压在图注或表格末尾不算数 —— 那时读者已经困惑过一次。
 * 判据：stages ≥ 3（一定会出现编号）时，产物里必须出现编号对照块；
 * 而且这块必须吸附 + 可拖动（data-pin + position:sticky）：
 * 只"置顶"解决第一屏，读到下方"论文 × 环节"矩阵时对照照样出画。 */
if (CFG && Array.isArray(CFG.stages) && CFG.stages.length >= 3) {
  const n = CFG.stages.length;
  const hasBlock = /class="sidmap"/.test(html);
  const hasPin = /class="sidmap"[^>]*data-pin/.test(html);
  const hasStick = /\.sidmap\{[^}]*position:sticky/.test(html);
  if (!hasBlock) {
    bad('编号对照', '有 ' + n + ' 个技术环节，但页面上没有 S 编号对照',
      '在技术图谱页最上方放红色编号对照块（调用 ui.js 的 sidLegend(stages)），'
      + '把 S1—S' + n + ' 与环节全名逐条列出；不要只写在表格末尾或图注里');
  } else if (!hasPin || !hasStick) {
    bad('编号对照', '对照块没有吸附/可拖动能力，滚过一屏就看不到了',
      '用 ui.js 的 sidLegend() 生成（自带 data-pin 与 sticky 吸附、按住手柄可拖动），'
      + '不要手写 <div class="sidmap"> 静态块');
  } else {
    ok('编号对照', 'S1—S' + n + ' 已逐条给出环节全名（置顶红色 + 吸附可拖动）');
  }
} else {
  skip('编号对照', '本项目没有编号化的技术环节，本项未查');
}

/* ---------------------------------------------------- 9. 文案腔调（旁白检查）
 * 页面是工具，不是讲义。下面这些话的共同点是：删掉之后信息一点没少，
 * 它们只是在替读者解释"这块是干什么的""你该怎么想"。工具不该这么说话。
 * 只查这些几乎不可能出现在正当内容里的短语，避免误伤正文。
 * 放在最后一项：它是最后一道关，其它检查都过了再看措辞。 */
const NARRATION = [
  '可以把这里理解', '这里可以理解为', '你可以理解为',
  '点击扇区', '点击条形', '点击区域', '点击图例',
  '供反思', '是你的切入点', '这一层只统计',
  /* V4.5 新增：下面这些是 V4.4 之前真实出现在产出里、已被删掉的旁白。
     加进库里是为了防止下次生成又把它们写回来。 */
  '状态会立即保存', '建议按四段写', '点模块切换', '点标题逐级展开',
  '这批文献是什么、不是什么', '先划清边界', '为什么推荐',
  '失败也必须写出来', '写死的规则，不是临场判断', '覆盖局限，必须随报告一起给出',
  '这次检索漏了什么', '点任意节点在下方展开', '这批文献里没有的模块也会画出来',
  /* V4.6.1 新增：图下解读、步骤口径、卡副题、页头副标题这几类灰字再次清零。
     下面短语都来自已被删掉的原话，写回任何一处都会在这里报 ✗。 */
  '每一跳都能在「检索记录」页核到', '是最该先读的；右上象限',
  '难度 ≤ 3 且优先级靠前', '耦合度处于前 15%', '决定你的切入点',
  '篇数越少，越可能是值得切入的空白', '枝粗＝机会分，本批内相对比较',
  '边框＝风险', '拖动后松手即重算',
  /* V4.7 新增：三步阅读路径的卡片副题。作者写了"全部由这批数据算出，不是预设书单"，
     读者点开三步看到的就是这批论文，这句话在复述一件已经摆在眼前的事。 */
  '全部由这批数据算出',
];
const narr = NARRATION.filter(w => html.indexOf(w) >= 0);
if (narr.length) {
  bad('文案腔调', '出现 ' + narr.length + ' 处旁白式文案：' + narr.join('、'),
    '删掉这些句子（页头 desc / 图表下方 / 结论区）—— 删后信息量不变，就说明它本来是多余的。见铁律 13');
} else ok('文案腔调', '无旁白式文案（' + NARRATION.length + ' 类短语零命中）');

/* V4.9 新增：AI 味书面腔（只扫"模型自己写的文案"，不扫论文原文）
 * 为什么单开一层：'闭环'、'显著提升'、'综上所述' 这些词在真实论文里也会出现
 * （控制论里闭环就是闭环），放进上面那个扫全文的列表会误伤整批数据。
 * 所以这里先把 <script>window.LIT_CONFIG…</script> 整段数据剥掉，
 * 剩下的才是模板 + views.js 里的措辞——那才是模型自己说的话。 */
const AI_TELL = ['综上所述', '值得注意的是', '不难看出', '由此可见',
  '赋能', '打造', '助力', '一站式', '全方位', '显著提升',
  '具有重要意义', '提供了新思路', '在当今时代', '总而言之', '众所周知'];
const shellHtml = html.replace(/<script[^>]*>(?=[\s\S]{0,800}window\.LIT_)[\s\S]*?<\/script>/g, ' ');
const aiHit = AI_TELL.filter(w => shellHtml.indexOf(w) >= 0);
if (aiHit.length) {
  bad('文案腔调', '出现 ' + aiHit.length + ' 处 AI 味套话：' + aiHit.join('、'),
    '换成具体的话，或者直接删掉。真实论文里几乎不出现这些词，出现就说明是模型在替读者总结（见铁律 13、§4.1 反面清单）；'
    + '如果确实要保留，请确认它在讲一个具体事实，而不是在收尾');
}

/* ---------------------------------------------------- 10. 数据质量（V4.6）
 * 前面 28 项查的是"格式与结构对不对"，没有一项查"内容是不是真的"。
 * 一篇空壳论文、一个抽错的年份、一档错位的评分，照样能全绿通过 ——
 * 那样"通过"两个字就会被高估。这一项只做数据层面能被确证的四件事：
 * 年份是否合法、题名是否像作者行、题名是否重复、band 与 relevance 是否对得上。 */
if (PAPERS && Array.isArray(PAPERS) && PAPERS.length) {
  const thisYear = new Date().getFullYear();
  const yBad = [], tBad = [], dupT = [], bandMis = [], thin = [], badType = [];
  // V4.6.1 修正：原来用 \W 删标点，但 JS 的 \W 只认 ASCII 字母数字，
  // 中文整段会被删光 —— 两条只差中文的题名（如 CA01/CA03）就剩同一个英文词，
  // 被误判成重复。改成只删标点/符号/空白（\p{P}\p{S}），中文按原样保留。
  const normT = t => String(t || '').replace(/[\s\p{P}\p{S}_]+/gu, '').toLowerCase();
  const seenT = new Map();
  const bands = ((CFG && CFG.bands) || [])
    .filter(b => b && typeof b.min === 'number')
    .sort((a, b) => b.min - a.min);
  PAPERS.forEach(p => {
    const y = p.year;
    if (y !== undefined && y !== null && y !== '') {
      const s = String(y).trim();
      if (!/^\d{4}$/.test(s)) yBad.push(p.id + ':' + s);
      else if (+s < 1900 || +s > thisYear + 1) yBad.push(p.id + ':' + s);
    }
    const t = String(p.title || '').trim();
    if (t.length < 4) tBad.push(String(p.id || '?'));
    // 题名像作者行：短、含中文逗号、且没有任何字母 —— PDF 抽错行时会这样
    else if (t.length < 26 && /，/.test(t) && !/[A-Za-z]/.test(t)) tBad.push(p.id + ':疑似作者行');
    const k = normT(t);
    /* V4.6.1：查重豁免 mergedIds。契约说"重复篇目合并记 mergedIds"，
       但旧逻辑无视这个标记照样报 ✗ —— 按契约修完数据反而过不了门禁，
       等于把修复路线堵死。现在：重复条目只要用 mergedIds 指向首条就放行，
       没标的照旧报错（没标记的重复依然是错）。 */
    if (k) {
      if (seenT.has(k)) {
        const firstId = seenT.get(k);
        const merged = Array.isArray(p.mergedIds) ? p.mergedIds : (p.mergedIds ? [p.mergedIds] : []);
        if (!merged.includes(firstId)) dupT.push(firstId + '/' + p.id);
      } else seenT.set(k, p.id);
    }
    if (bands.length && typeof p.relevance === 'number' && p.band) {
      const exp = (bands.find(b => p.relevance >= b.min) || bands[bands.length - 1]).name;
      if (exp !== p.band) bandMis.push(p.id + ':' + p.band + '→' + exp);
    }
    const hasBody = ['overview', 'method', 'conclusion'].some(f => {
      const v = String(p[f] || '').trim();
      return v && v !== '未报告' && v !== '无';
    });
    if (!hasBody) thin.push(String(p.id || '?'));
    // 类型：datasets/metrics/stages 必须是数组。写成字符串时页面看着正常，
    // 但导出笔记里 p.metrics.join() 会抛异常 —— 表现成"点了导出没反应"。
    ['datasets', 'metrics', 'stages'].forEach(f => {
      const v = p[f];
      if (v !== undefined && v !== null && v !== '' && !Array.isArray(v)) badType.push(p.id + '.' + f);
    });
  });
  const errs = [];
  if (yBad.length) errs.push(yBad.length + ' 篇年份非法：' + yBad.slice(0, 5).join('、'));
  if (tBad.length) errs.push(tBad.length + ' 篇题名可疑：' + tBad.slice(0, 5).join('、'));
  if (dupT.length) errs.push(dupT.length + ' 组题名重复（应合并记 mergedIds）：' + dupT.slice(0, 5).join('、'));
  // band 允许是人工勾的档位（demo 就是 24/24 都不按分数机械换算），所以只提示不判错。
  if (bandMis.length) warn('数据质量', bandMis.length + ' 篇 band 与 relevance 阈值推算不一致'
    + '（档位是人工勾的可忽略；若是自动落档，说明改过分数没重定 bands.min）：' + bandMis.slice(0, 5).join('、'));
  if (badType.length) errs.push(badType.length + ' 处字段类型不对（datasets/metrics/stages 必须是数组）：' + badType.slice(0, 5).join('、'));
  if (errs.length) {
    bad('数据质量', errs.join('；'),
      '改 data/papers.json 后重新 build：年份写四位整数、重复篇目合并进 mergedIds、'
      + 'datasets/metrics/stages 写成数组');
  } else {
    ok('数据质量', PAPERS.length + ' 篇年份/题名合法、无重复题名'
      + (thin.length ? '；但 ' + thin.length + ' 篇没有任何正文（只有题名与打分）' : '，正文齐全'));
  }
} else {
  skip('数据质量', '无论文数据，本项未查');
}

/* ---------------------------------------------------------------- 输出 */
const line = '─'.repeat(64);
console.log('\n' + line);
console.log('产出校验：' + path.basename(file) + '  (' + (fs.statSync(file).size / 1024 / 1024).toFixed(2) + ' MB)');
console.log(line);
oks.forEach(o => console.log('  ✓ ' + pad(o.name) + o.detail));
warns.forEach(o => console.log('  ! ' + pad(o.name) + o.detail));
/* V4.7.1：未查项用 ○ 单独列出，不让它伪装成 ✓ */
skips.forEach(o => console.log('  ○ ' + pad(o.name) + o.detail));
fails.forEach(o => {
  console.log('  ✗ ' + pad(o.name) + o.detail);
  if (o.fix) console.log('      修复：' + o.fix);
});
console.log(line);
const totalChecks = oks.length + skips.length;
if (fails.length) {
  console.log('结果：不通过（' + fails.length + ' 项未过，' + warns.length + ' 项提醒）');
  console.log('要求：修到 0 项未过再交付。\n');
  process.exit(1);
} else {
  console.log('结果：通过（' + oks.length + ' 项检查通过'
    + (skips.length ? '、' + skips.length + ' 项无数据未查' : '')
    + (warns.length ? '，' + warns.length + ' 项提醒' : '') + '）'
    + (skips.length ? '　共 ' + totalChecks + ' 项' : ''));
  if (skips.length) {
    console.log('说明：○ 那 ' + skips.length + ' 项是因为 data/ 里没有对应数据，本次没查，'
      + '不代表通过 —— 补齐数据后再跑一次才算数。');
  }
  console.log('这份 HTML 与组内其它产出格式一致，可以交付。\n');
}

function pad(s) { return (s + '　'.repeat(Math.max(0, 5 - s.length))).padEnd(12, ' '); }
