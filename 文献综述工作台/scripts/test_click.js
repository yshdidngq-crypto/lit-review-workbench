#!/usr/bin/env node
/* ============================================================================
 * test_click.js —— 点一下真的点得动吗（真机交互验证，零依赖）
 * ----------------------------------------------------------------------------
 * 用法： node scripts/test_click.js <产出的HTML> [act] [期望篇数]
 *        act 默认 year，可选 topic / stage / status / band / tag
 *
 * 为什么需要它：validate.js 查静态数据，smoke.js 只敢碰"渲染不报错"。
 * 但"点下去筛出 0 篇"这类问题，静态文本完全正常 —— 条形上明明写着「2025 年」，
 * 点下去拿这个字符串去和 p.year 的 2025 比，永远对不上。只有真派发一次 click 才知道。
 *
 * 退出码：0 = 点得动且筛出了东西；1 = 有问题；2 = 本机没有 Edge/Chrome，跳过（不算失败）。
 *        没有浏览器时不要当成通过 —— 这一层根本没测。
 * 可用 EDGE_PATH 环境变量指定浏览器可执行文件。
 * ========================================================================== */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
if (!EDGE) {
  console.error('找不到 Edge / Chrome（试过 Edge、Chrome、Chromium 的常见路径）。');
  console.error('这个测试必须用真浏览器，DOM 桩测不出来 —— 所以它是"没测"，不是"通过"。');
  console.error('可用 EDGE_PATH 指定浏览器路径，例如：');
  console.error('  EDGE_PATH="D:\\Apps\\msedge.exe" node scripts/test_click.js <产出HTML>');
  process.exit(2);
}

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.log('用法: node scripts/test_click.js <产出HTML> [act] [期望篇数]');
  process.exit(1);
}
const ACT = process.argv[3] || 'year';
const WANT = process.argv[4];

const probe = `
<script>
function log(s){ var d=document.getElementById('TRES'); if(!d){d=document.createElement('pre');d.id='TRES';document.body.appendChild(d);} d.textContent += s + '\\n'; }
window.addEventListener('load', function(){
  setTimeout(function(){
    try {
      var els = [].slice.call(document.querySelectorAll('[data-act="${ACT}"]'));
      /* 主题筛选有两种写法：图表里是 data-act="topic"，独立 chip 是 data-chip="topic"。
         后者由 app.bind 的另一条分支接管，同样要能测。 */
      var viaChip = false;
      if (!els.length) {
        els = [].slice.call(document.querySelectorAll('[data-chip="${ACT}"]'));
        viaChip = els.length > 0;
      }
      log('可点元素数量（data-act=${ACT}' + (viaChip ? ' / data-chip' : '') + '）= ' + els.length);
      if (!els.length) {
        log('跳过：本页没有 ' + '${ACT}' + ' 这类可点元素（可能是设计如此，例如导读页）');
        document.title = 'DONE';
        return;
      }
      var t = els[els.length - 1];
      log('目标元素 data-val = "' + t.dataset.val + '"');
      var before = window.APP.S.filters['${ACT}'];
      log('点击前 filters.${ACT} = ' + JSON.stringify(before));
      var nBefore = window.APP.filtered().length;
      t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      setTimeout(function(){
        /* 这一段以前裸写在回调里：一旦抛异常（例如 filters 被写成 undefined），
           后面的 log 全部不执行、页面也没有 ✗，脚本就当成"通过"退 0。
           回调必须自己兜住异常，并明确记一条 ✗。 */
        try {
          var after = window.APP.S.filters['${ACT}'];
          var list = window.APP.filtered();
          log('点击后 filters.${ACT} = ' + JSON.stringify(after));
          log('筛选前 ' + nBefore + ' 篇 → 筛选后 ' + list.length + ' 篇');
          if (!after || !after.length) log('✗ 筛选状态没写入，点击没被接管');
          else if (!list.length) log('✗ 筛成 0 篇：data-val 与数据字段对不上（常见是把显示标签当取值）');
          else log('✓ 筛选生效');
          if (list.length) log('命中示例: ' + list.slice(0,3).map(function(p){return p.id;}).join(', '));
        } catch (e2) {
          log('✗ 点击后回调异常：' + e2.message);
        }
        document.title='DONE';
      }, 500);
    } catch(e){ log('异常: ' + e.message); document.title='DONE'; }
  }, 1400);
});
</script>`;

const tmp = path.join(os.tmpdir(), '_test_click_' + process.pid + '.html');
fs.writeFileSync(tmp, fs.readFileSync(src, 'utf8').replace('</body>', probe + '</body>'), 'utf8');
/* 临时 profile：否则浏览器可能复用正在运行的实例，--dump-dom 直接返回空。 */
const profile = fs.mkdtempSync(path.join(os.tmpdir(), '_edge_prof_'));

let out;
try {
  out = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile,
    '--virtual-time-budget=9000', '--dump-dom',
    /* 路径里有中文/空格时手拼 file:/// 会加载失败，交给 URL 编码 */
    pathToFileURL(tmp).href,
  ], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 60000,
  });
} catch (e) {
  console.error('浏览器没跑起来：' + e.message);
  console.error('（无头模式被安全软件拦、或浏览器升级改了参数时常见 —— 这是"没测"，不是"通过"）');
  process.exit(2);
}

const m = out.match(/<pre id="TRES">([\s\S]*?)<\/pre>/);
if (!m) { console.error('没抓到结果：页面可能没加载完'); process.exit(1); }
const text = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
console.log(text);

const bad = /✗/.test(text);
if (WANT) {
  const got = (text.match(/筛选后 (\d+) 篇/) || [])[1];
  if (String(got) !== String(WANT)) { console.log('期望 ' + WANT + ' 篇，实际 ' + got + ' 篇'); process.exit(1); }
}
process.exit(bad ? 1 : 0);
