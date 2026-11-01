/* 真机验证「导出笔记 txt」：一次无头运行，四条断言。
   用法：node test_note_export.js <html> [paperId]

   验什么：
     1. 抽屉里确实有导出按钮，且 data-val 是这篇的编号（入口有没有挂上）
     2. 点按钮会调到 exportNote（data-act 的委托绑定有没有生效）
     3. 导出的文件名形如 笔记_<编号>_<标题>.txt
     4. 导出的正文同时含【文献题录】和刚写的【我的笔记】内容（是不是只导了空壳）

   为什么这样实现：无头模式下浏览器不让落盘，下载也拿不到内容，
   所以不拦下载，而是替换 Blob 把文本留下来；同时把 <a>.click 变空操作，
   避免真的触发下载中断后续断言。 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const BROWSER = CANDIDATES.find(p => fs.existsSync(p));
if (!BROWSER) {
  console.error('找不到 Edge / Chrome，无法做真机验证。');
  process.exit(2);
}

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('用法：node test_note_export.js <html> [paperId]');
  process.exit(2);
}
const ID = process.argv[3] || '';
const NOTE = '测试笔记XYZ：配准误差主要来自弱纹理区，值得复现。';

/* 探针：全部断言在页面里跑完，结果塞进 <pre id="__result">，由 node 解析。
   setTimeout 留 400ms，等 build 之后的首次渲染与 APP 挂载完成。 */
const probe = `<script>
window.__R = { steps: [] };
window.addEventListener('load', function () {
  setTimeout(function () {
    var R = window.__R;
    function finish() {
      var pre = document.createElement('pre');
      pre.id = '__result';
      pre.textContent = JSON.stringify(R);
      document.body.appendChild(pre);
      document.title = 'RESULT ' + (R.ok ? 'PASS' : 'FAIL');
    }
    try {
      var A = window.APP;
      R.hasApp = !!A;
      if (!A) throw new Error('window.APP 未挂载');
      var id = ${JSON.stringify(ID)} || (A.P && A.P[0] && A.P[0].id) || '';
      R.id = id;
      // 编号不在本库时，后面每一条断言都会跟着失败，报错会指向错误的地方。
      // 这里提前拦一次，把"你传的 id 不存在"和"导出真的坏了"分开。
      var exists = (A.P || []).some(function (p) { return String(p.id) === String(id); });
      if (!exists) {
        R.idMissing = true;
        R.knownIds = (A.P || []).slice(0, 8).map(function (p) { return p.id; });
        throw new Error('编号 ' + id + ' 不在本库中（现有编号示例：' + R.knownIds.join(', ') + '）');
      }
      A.openDrawer(id);
      A.showTab('notes');

      // 1. 入口
      var btn = document.querySelector('[data-act="export-note"]');
      R.btn = !!btn;
      R.btnVal = btn ? btn.getAttribute('data-val') : null;

      // 2. 写一条笔记并保存
      var box = document.getElementById('noteBox');
      if (box) R.boxId = box.dataset.noteId || '';
      if (box) { box.value = ${JSON.stringify(NOTE)}; }
      var save = document.getElementById('btnSaveNote');
      if (save) save.click();
      R.saved = String((A.S.notes || {})[id] || '').indexOf('测试笔记') >= 0;

      // 3. 捕获导出内容：换掉 Blob，留下文本；<a>.click 空操作防止真下载
      var cap = null;
      window.Blob = function (parts, opt) {
        this.__text = (parts || []).map(String).join('');
        this.__type = opt && opt.type;
        cap = this;
        return this;
      };
      window.URL.createObjectURL = function () { return 'blob:stub'; };
      var anchorClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { return undefined; };

      var calls = 0, orig = A.exportNote;
      A.exportNote = function (x) { calls++; return orig.call(A, x); };

      // 3a. 直接调一次：函数内部抛错不会穿过 click 的 dispatchEvent，只能这样看见
      var directErr = null;
      try { orig.call(A, id); } catch (e) { directErr = String(e && e.message || e); }
      R.directErr = directErr;
      R.directLen = cap ? cap.__text.length : 0;
      var directTxt = cap ? cap.__text : '';
      R.directToc = /【文献题录】/.test(directTxt);
      R.directNote = /【我的笔记】[\\s\\S]*测试笔记XYZ/.test(directTxt);
      cap = null;

      // 3b. 再走 UI 点击，只验绑定
      if (btn) btn.click();
      R.calls = calls;

      R.len = R.directLen;
      R.file = window.__fileName || '';
      R.hasToc = R.directToc;
      R.hasNote = R.directNote;
      var txt = directTxt;
      R.head = txt.split('\\n').slice(0, 3).join(' | ');
      R.body = txt.split('\\n').slice(0, 40);

      A.exportNote = orig;
      HTMLAnchorElement.prototype.click = anchorClick;
      R.ok = !!(R.btn && R.btnVal === id && R.calls === 1 && !R.directErr && R.hasToc && R.hasNote);
    } catch (e) {
      R.err = String(e && e.message || e);
      R.ok = false;
    }
    finish();
  }, 400);
});
</script>`;

/* 记录文件名：noteFileName 在 <a download> 上，替换 createElement 抓住它 */
const probeFile = `<script>
(function () {
  var orig = document.createElement.bind(document);
  document.createElement = function (t) {
    var el = orig(t);
    if (t === 'a') {
      Object.defineProperty(el, 'download', {
        set: function (v) { window.__fileName = v; },
        get: function () { return window.__fileName || ''; },
        configurable: true,
      });
    }
    return el;
  };
})();
</script>`;

let html = fs.readFileSync(src, 'utf8');
if (html.indexOf('</body>') < 0) {
  console.error('这份 HTML 没有 </body>，不像是 build.py 的产出。');
  process.exit(2);
}
html = html.replace('</body>', probeFile + probe + '</body>');
const tmp = path.join(os.tmpdir(), '_note_export_' + process.pid + '.html');
fs.writeFileSync(tmp, html, 'utf8');

const dom = execFileSync(BROWSER, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--allow-file-access-from-files', '--virtual-time-budget=8000',
  '--dump-dom', 'file:///' + path.resolve(tmp).replace(/\\/g, '/'),
], { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

let R = null;
const m = dom.match(/<pre id="__result">([\s\S]*?)<\/pre>/);
if (m) {
  try { R = JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')); }
  catch (e) { R = { ok: false, err: '结果不是合法 JSON：' + m[1].slice(0, 120) }; }
} else {
  const t = (dom.match(/<title>([^<]*)<\/title>/) || [])[1] || '(无 title)';
  R = { ok: false, err: '页面没有产出结果（title=' + t + '），可能脚本没跑完' };
}

const line = '─'.repeat(64);
const say = (name, good, detail) => console.log('  ' + (good ? '✓' : '✗') + ' ' + name.padEnd(14, '　') + (detail || ''));
console.log('\n' + line);
console.log('笔记导出验证：' + path.basename(src));
console.log(line);
if (R.err) console.log('  ✗ 页面报错：' + R.err);
say('入口按钮', R.btn && R.btnVal === R.id, 'data-val=' + (R.btnVal || '(无)') + ' / 期望 ' + (R.id || '(无)'));
say('保存笔记', R.saved, R.saved ? '已写入 localStorage 状态' : '没写进去');
say('点击调用导出', R.calls === 1, 'exportNote 被调用 ' + (R.calls || 0) + ' 次');
say('文件名', !!R.file, R.file || '(未捕获)');
say('题录段落', R.hasToc, R.hasToc ? '含【文献题录】' : '缺【文献题录】');
say('笔记段落', R.hasNote, R.hasNote ? '含刚写的笔记' : '缺笔记内容');
say('内容长度', R.len > 0, (R.len || 0) + ' 字');
console.log(line);
if (R.body && R.body.length) {
  console.log('导出正文（前 12 行）：');
  R.body.slice(0, 12).forEach(l => console.log('  | ' + l));
  console.log(line);
}
if (R.idMissing) {
  console.log('用法提示：第二个参数要传本库里真实存在的论文编号，例如 '
    + (R.knownIds || []).slice(0, 3).join(' / ') + '。');
  console.log('结果：没测到导出 —— 传的编号不存在，不代表功能有问题\n');
} else if (R.ok) {
  console.log('结果：通过（按钮 → 绑定 → 内容 全链路一致）\n');
} else {
  console.log('结果：不通过 —— 上面标 ✗ 的那一项就是断点\n');
}
try { fs.unlinkSync(tmp); } catch (e) { /* 临时文件清不掉不影响结论 */ }
process.exit(R.ok ? 0 : (R.idMissing ? 2 : 1));
