#!/usr/bin/env node
/* check_docs.js —— 文档一致性检查（V4.12.4）
 *
 * 为什么要有它：门禁一直只查 HTML。结果两版包（4.9.1 与 codex 的 4.12.3）
 * 都把文档切坏过一次，而 validate/smoke 全绿 —— 因为损坏发生在 .md 里。
 * 这里只查五件"一查就准、几乎不会误报"的事：
 *   1) SKILL.md 的 Step 1–8 章节齐全（删半节、跳号都会露出来）
 *   2) 文档里点名的文件都在（examples/x、references/x.md、assets/x、scripts/x）
 *   3) 没有空代码围栏（删内容只删一半的典型痕迹）
 *   4) "见 Step X" 指向的 Step 真的存在
 *   5) 没有 assets/lab.js 时，文档里不许再留 --with-lab / features.lab / data/lab.json
 *      这类操作性指令（声明性说明允许，只看那行有没有"不含/已移除/忽略"）
 *
 * 用法：node scripts/check_docs.js [项目目录]     退出码 0 = 通过，1 = 有问题
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const bad = [];
const ok = [];
function fail(where, msg) { bad.push(where + '  ' + msg); }
function pass(msg) { ok.push(msg); }

function read(p) { return fs.readFileSync(p, 'utf8'); }
function exists(p) { return fs.existsSync(path.join(ROOT, p)); }

/* 要查的文档：根目录三份 + references/*.md */
const docs = [];
for (const f of ['SKILL.md', '快速开始.md', '先读我.txt', 'CHANGELOG.md']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) docs.push({ name: f, text: read(p) });
}
const refDir = path.join(ROOT, 'references');
if (fs.existsSync(refDir) && fs.statSync(refDir).isDirectory()) {
  for (const f of fs.readdirSync(refDir).sort()) {
    if (f.endsWith('.md')) docs.push({ name: 'references/' + f, text: read(path.join(refDir, f)) });
  }
}
if (!docs.length) { console.error('没找到任何文档，路径不对？' + ROOT); process.exit(2); }

/* 1) SKILL.md 的 Step 章节目录 */
const skill = docs.find(d => d.name === 'SKILL.md');
if (skill) {
  const have = (skill.text.match(/^#{2,4}\s*Step\s*(\d+)/gm) || [])
    .map(s => parseInt(s.replace(/[^\d]/g, ''), 10));
  const missing = [1, 2, 3, 4, 5, 6, 7, 8].filter(n => have.indexOf(n) < 0);
  if (missing.length) fail('SKILL.md', '缺少 Step 章节：' + missing.join('、') + '（现有 ' + have.join(',') + '）');
  else pass('SKILL.md 的 Step 1–8 齐全');
}

/* 2) 文档点名的文件是否存在 */
const refRe = /`((?:examples|references|assets|scripts)\/[A-Za-z0-9_\-.\/]+)`/g;
const seen = new Set();
/* CHANGELOG 是历史记录：它提到当年存在过的文件（如 lab.js）是正常的，
   不该拿"今天文件在不在"去判它。所以只对现行文档查，历史记录跳过。 */
const currentDocs = docs.filter(d => d.name !== 'CHANGELOG.md');
for (const d of currentDocs) {
  /* 按行扫：一行里如果写着"这些文件不在包里/已移除"，它就是在声明缺失，
     不该再按"文件必须存在"去判它。 */
  const kept = d.text.split('\n')
    .filter(l => !/不含|不在包里|已移除|已删|忽略|遗留/.test(l)).join('\n');
  let m;
  const re = new RegExp(refRe.source, 'g');
  while ((m = re.exec(kept)) !== null) {
    let rel = m[1].replace(/\/+$/, '');
    if (seen.has(rel)) continue;
    seen.add(rel);
    /* 允许写到文件名一半（如 scripts/build.py）与目录 */
    if (exists(rel)) continue;
    fail(d.name, '点名的路径不存在：' + rel);
  }
}
if (!seen.size) pass('文档里没有可校验的路径引用');
else pass('检查了 ' + seen.size + ' 个被点名的路径');

/* 3) 空代码围栏 */
for (const d of docs) {
  const hits = d.text.split('\n');
  for (let i = 0; i < hits.length - 1; i++) {
    if (/^\s*```[A-Za-z]*\s*$/.test(hits[i]) && /^\s*```\s*$/.test(hits[i + 1])) {
      fail(d.name + ':' + (i + 1), '空代码围栏（连着两个 ``` ，内容被删掉了）');
    }
  }
}

/* 4) "见 Step X" / "第 X 步" 指向的 Step 必须存在 */
if (skill) {
  const have = new Set((skill.text.match(/^#{2,4}\s*Step\s*(\d+)/gm) || [])
    .map(s => parseInt(s.replace(/[^\d]/g, ''), 10)));
  for (const d of docs) {
    const lines = d.text.split('\n');
    lines.forEach((line, i) => {
      const m = line.match(/见\s*Step\s*(\d+)|Step\s*(\d+)\s*(?:那|里|的)/);
      if (!m) return;
      const n = parseInt(m[1] || m[2], 10);
      if (!have.has(n)) fail(d.name + ':' + (i + 1), '引用了不存在的 Step ' + n + '：' + line.trim().slice(0, 60));
    });
  }
}

/* 5) 没有 lab.js 的时候，不许留操作性 lab 指令 */
const hasLabJs = exists('assets/lab.js');
const opRe = /--with-lab|features\.lab|data\/lab\.json|assets\/lab\.js/;
if (!hasLabJs) {
  for (const d of currentDocs) {
    d.text.split('\n').forEach((line, i) => {
      if (!opRe.test(line)) return;
      if (/不含|已移除|已删|忽略|遗留|不在包里|不再认/.test(line)) return; /* 声明性说明放行 */
      fail(d.name + ':' + (i + 1), '本包没有 lab.js，却还留着操作性指令：' + line.trim().slice(0, 70));
    });
  }
}

/* 输出 */
console.log('\n文档检查：' + ROOT);
console.log('-'.repeat(64));
ok.forEach(s => console.log('  ✓ ' + s));
bad.forEach(s => console.log('  ✗ ' + s));
console.log('-'.repeat(64));
if (bad.length) {
  console.log('结果：不通过（' + bad.length + ' 处问题）');
  process.exit(1);
}
console.log('结果：通过（文档与文件、章节、围栏都对齐）');
