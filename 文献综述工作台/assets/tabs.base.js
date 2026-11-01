/* ============================================================================
 * tabs.base.js —— 通用详情标签（锁死文件，一个字都不要改）
 * ----------------------------------------------------------------------------
 * 九个标签：understand / project / eval / guide / notes / raw / extAbs /
 * extWhere / extDir。项目在 src/tabs.js 里覆盖同名标签即可。
 * ========================================================================== */
/* == IIFE 起点 == */
/* 整段包进函数作用域：底座里的 topicName / statusTag / clip … 这些顶层小工具
   不会和项目 src/views.js 里的同名变量撞车（同学那份就这么崩过）。 */
(function () {
'use strict';


window.TABS_BASE = window.TABS_BASE || {};

/* ---------------------------------------------------------------- 三分钟理解 */
window.TABS_BASE.understand = function (p) {
  const blocks = [
    ['出发点', p.overview || ''],
    ['提出问题', p.method || ''],
    ['数据与结果', p.data || ''],
    ['结论', p.conclusion || ''],
  ].filter(b => (b[1] || '').trim());

  if (!blocks.length) return emptyBox('该条目没有可用的正文摘要');

  return card('原文四段摘录', '按【出发点】【提出方法】【效果】整理，未做改写',
    blocks.map((b, i) => `<div style="margin-bottom:14px">
        <div class="tiny b" style="color:var(--accent);margin-bottom:5px">${i + 1}. ${esc(b[0])}</div>
        <div style="font-size:12.5px;line-height:1.85;white-space:pre-wrap">${esc(b[1])}</div>
      </div>`).join(''));
};

/* ---------------------------------------------------------------- 与本项目的关系 */
window.TABS_BASE.project = function (p, cfg) {
  const bd = p.relevanceBreakdown || {};
  const keys = Object.keys(bd);
  return card('项目耦合度拆解', '总分 ' + Math.round(p.relevance || 0) + ' / 100',
    keys.length
      ? keys.map(k => {
        const v = bd[k];
        const num = typeof v === 'number' ? v : (v && v.score) || 0;
        const why = typeof v === 'object' && v ? (v.reason || '') : '';
        return `<div style="padding:6px 0;border-bottom:1px solid var(--line2)">
            <div style="display:flex;gap:10px;align-items:center">
              <span style="flex:0 0 130px;font-size:12px">${esc(k)}</span>
              <span style="flex:1">${scoreBar(num)}</span>
            </div>
            ${why ? `<div class="tiny muted" style="margin-top:3px;padding-left:130px">${esc(why)}</div>` : ''}
          </div>`;
      }).join('')
      : note('该条目没有分维度打分记录。请在生成数据时补充 relevanceBreakdown 字段，以便说明分数是怎么来的。', 'warn')
      + sep()
      + kvList([
        ['相关档位', esc(p.band || '—')],
        ['证据置信度', esc(p.evidence || '—')],
        ['涉及环节', (p.stages || []).map(s => tag(STAGE_NAME[s] || s)).join(' ') || '—'],
      ]));
};

/* ---------------------------------------------------------------- 科研评价 */
window.TABS_BASE.eval = function (p) {
  const rows = [
    ['数据集', (p.datasets || []).length ? esc(p.datasets.join('、')) : '未报告'],
    ['评价指标', p.metrics ? esc(p.metrics) : '未报告'],
    ['开源代码', p.hasCode ? tag('有', 't-ok') : tag('未提及', 't-mute')],
    ['学习价值', scoreBar(p.learning)],
    ['阅读难度', dots(p.difficulty)],
    ['方法类型', tag(p.dl)],
  ];
  return card('实验与可复现性', '据正文抽取，未报告即标"未报告"', kvList(rows))
    + `<div style="margin-top:14px">${card('判断建议', '',
      note('数据与指标齐全、且有开源代码的条目，复现成本最低，适合作为你实验的对照基线；'
        + '只有指标没有数据的条目，只能作为思路参考。', 'info'))}</div>`;
};

/* ---------------------------------------------------------------- 学习指导 */
window.TABS_BASE.guide = function (p) {
  const concepts = [];
  if ((p.dl || '').indexOf('深度') >= 0) concepts.push('卷积网络/Transformer 基础');
  if ((p.stages || []).indexOf('S2') >= 0 || (p.stages || []).indexOf('S3') >= 0) concepts.push('特征匹配与误匹配剔除');
  if ((p.stages || []).indexOf('S4') >= 0) concepts.push('几何变换模型与鲁棒估计');
  if ((p.stages || []).indexOf('S5') >= 0) concepts.push('像素级融合策略');
  if ((p.stages || []).indexOf('S6') >= 0) concepts.push('特征级融合与对齐');
  if ((p.stages || []).indexOf('S7') >= 0) concepts.push('评价指标与消融实验设计');
  if (!concepts.length) concepts.push('先读摘要与引言，判断与本方向的关联');

  const questions = [
    '它解决的具体问题是什么？这个问题在我的场景里存在吗？',
    '它的方法能拆出哪几个可以独立复用的模块？',
    '它的实验设置（数据、指标、对比基线）我能照搬吗？差在哪里？',
  ];

  return card('读前要掌握', '按条目所属环节推断',
    `<div style="display:flex;gap:6px;flex-wrap:wrap">${concepts.map(c => tag(c, 't-topic')).join('')}</div>`)
    + `<div style="margin-top:14px">${card('读完应该能回答', '',
      `<ol style="margin:0;padding-left:20px;font-size:12.5px;line-height:2">${questions.map(q => `<li>${esc(q)}</li>`).join('')}</ol>`)}</div>`;
};

/* ---------------------------------------------------------------- 我的笔记 */
window.TABS_BASE.notes = function (p, cfg) {
  const st = S.status[p.id] || '未阅读';
  const noteText = S.notes[p.id] || '';

  /* 项目没配 statuses 时不能一个字都不给：回落到 app.core 的默认 6 档，
     否则「阅读状态」是一块空白，用户以为这功能坏了。 */
  const sts = (cfg.statuses && cfg.statuses.length) ? cfg.statuses
    : ((window.APP && window.APP.STATUS) || []);
  const statusBtns = sts.map(s =>
    `<button class="btn sm${st === s ? ' on' : ''}" data-act="status-set" data-val="${p.id}" data-status="${esc(s)}">${esc(s)}</button>`
  ).join('');

  /* 输入框上方原本有一段"教你怎么记"的模板提示，那是旁白，而且每个人
     记笔记的习惯不一样。导出按钮才是真需要的东西——笔记留在浏览器里随时会丢。 */
  return card('阅读状态', '',
    `<div style="display:flex;gap:6px;flex-wrap:wrap">${statusBtns}</div>`)
    + `<div style="margin-top:14px">${card('笔记', '',
      `<textarea id="noteBox" data-note-id="${p.id}" placeholder="在这里写…"
        style="width:100%;min-height:150px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--panel2);font-family:inherit;font-size:12.5px;line-height:1.75;resize:vertical">${esc(noteText)}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
        <button class="btn primary sm" id="btnSaveNote" data-note-id="${p.id}">保存笔记</button>
        <button class="btn sm" data-act="export-note" data-val="${esc(p.id)}"
          title="把这篇的题录与笔记导出成一份 txt">导出笔记 txt</button>
        <span class="tiny muted" id="noteHint">${noteText ? '已有笔记 ' + noteText.length + ' 字' : '尚未写笔记'}</span>
      </div>`)}</div>`;
};

/* ---------------------------------------------------------------- 原文摘要 */
window.TABS_BASE.raw = function (p) {
  const flags = [];
  if (p.flags && p.flags.bodySuspect) flags.push('正文与标题疑似错配');
  if (p.flags && p.flags.titleEnSuspect) flags.push('英文标题存疑');
  if (p.flags && p.flags.dupTitle) flags.push('同题异源（另有同名条目）');

  return (flags.length ? note('该条目存在数据问题：' + flags.join('、') + '。引用前请核对原文。', 'warn') + sep() : '')
    + kvList([
      ['编号', esc(p.id)],
      ['中文标题', esc(p.title)],
      ['英文标题', esc(p.titleEn || '—')],
      ['作者', esc(p.authors || '—')],
      ['单位', esc(p.unit || '—')],
      ['年份', esc(dash(p.year))],
      ['出处', esc(p.venue || '—')],
      ['关键词', esc(p.keywords || '—')],
      ['合并条目', (p.mergedIds || []).length ? esc(p.mergedIds.join('、')) : '无'],
    ])
    + sep()
    + `<div style="font-size:12.5px;line-height:1.9;white-space:pre-wrap">${
      esc([p.overview, p.method, p.data, p.conclusion].filter(Boolean).join('\n\n') || '（无正文）')
    }</div>`;
};

/* ============================================================================
 * V3.0 外部文献专用标签
 * ----------------------------------------------------------------------------
 * 外部文献没有 overview / method / data / conclusion，但有六维打分明细与
 * 访问状态。因此不复用「三分钟理解」，改用下面四个标签。
 * 标签 id 必须与 config.json 的 extTabs 一一对应。
 * ========================================================================== */

/* ---------------------------------------------------------------- 摘要原文 */
window.TABS_BASE.extAbs = function (e) {
  const a = (e.abstract || '').trim();
  return a
    ? card('摘要原文', '来自检索接口返回，未做改写或翻译',
      `<div style="font-size:12.5px;line-height:1.9;white-space:pre-wrap">${esc(a)}</div>`)
    : card('摘要原文', '', note('这条记录没有返回摘要。只有标题可核验，因此它的相关度判断可信度较低——'
      + '在把它当作依据之前，请先打开原文确认内容。', 'warn'));
};

/* ---------------------------------------------------------------- 出处与获取 */
window.TABS_BASE.extWhere = function (e) {
  const doiUrl = e.doiUrl || (e.doi ? 'https://doi.org/' + e.doi : '');
  const oa = e.openAccessPdfUrl || '';
  const link = (u, t) => u
    ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : '—';
  return card('出处', '检索结果原始字段', kvList([
    ['标题', esc(e.title || '—')],
    ['作者', esc((e.authors || []).slice(0, 6).join('、') || '未返回')],
    ['年份', esc(e.year == null ? '—' : e.year)],
    ['期刊/会议', esc(e.venue || '—')],
    ['DOI', e.doi ? link(doiUrl, e.doi) : '无（该记录没有 DOI）'],
    ['被引', e.citationCount == null ? '—' : (e.citationCount + '（' + esc(e.citationSource || '来源未知') + '，跨年份不可直接比较）')],
    ['来源库', esc(e.sourceDatabase || e.source || '—')],
    ['检索日期', esc(e.retrievedAt || '—')],
    ['访问状态', esc(accessLabel(e.accessStatus))],
    ['开放获取 PDF', oa ? link(oa, '打开 PDF') : '未提供'],
    ['数据库记录页', e.paperUrl ? link(e.paperUrl, '打开') : '—'],
  ]));
};

/* ---------------------------------------------------------------- 关联方向 */
window.TABS_BASE.extDir = function (e) {
  const ids = e.directionIds || [];
  const m = {};
  (e.directionMatch || []).forEach(x => { m[x.directionId] = x; });
  if (!ids.length) {
    return card('关联方向', '', note('这条文献没有与任何研究方向建立关联。'
      + '通常意味着它与你的三个方向都不直接对口，可作外围参考。', 'info'));
  }
  return card('关联方向', ids.length + ' 个', ids.map(id => {
    const d = (window.APP && window.APP.DIR_BY[id]) || null;
    const mm = m[id] || {};
    return `<div class="dircard" data-act="dir-open" data-val="${esc(id)}" style="margin-bottom:7px">
        <div class="dh">${esc(d ? d.name : id)}</div>
        <div class="dl2">${esc(d ? d.oneLine : '')}</div>
        <div class="dm"><span>术语重合 <b>${mm.overlap || 0}</b></span>
          <span>共享术语：${esc((mm.sharedTerms || []).join(' / ') || '—')}</span></div>
      </div>`;
  }).join(''));
};

function accessLabel(s) {
  return s === 'open_access' ? '开放获取' : s === 'paywalled' ? '需订阅' : '状态未知';
}

})();
/* == IIFE 终点 == */
