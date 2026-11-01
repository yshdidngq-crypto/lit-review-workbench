/* ============================================================ 通用骨架视图
   V4.8 起这一层锁死，和 base.css / charts.js / ui.js 同级。
   目的：把「内容层」从"必须重写 1,200 行代码"降级成"可选覆盖"。

   注入顺序（build.py 决定，不要手改）：
     ... → app.core.js → **views.base.js** → src/views.js（可选）→ lab.js → ...
   收尾时统一合并：
     window.VIEWS = Object.assign({}, window.VIEWS_BASE, window.VIEWS || {})

   所以：项目里写过的视图覆盖这里的通用版；没写的直接出通用版。
   通用版只读 config.json 与 data/，不含任何项目特有意措辞 —— 这也是它能被锁死的原因。
   想加项目特有的判断或叙事，就在 src/views.js 里覆盖对应的那一个视图，别的照旧。

   这一层同样遵守铁律：不手写 card / kpi / table 外壳（一律走 ui.js），
   不写旁白（"点击…可…"这类），不把施工期元数据放上页面。 */
(function () {
  'use strict';

  const A = window.APP || {};
  const BASE = {};

  /* ---------------------------------------------------------------- 小工具 */
  function CFG() { return A.CFG || {}; }
  function PS(list) { return (list || A.P || []).slice(); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function avg(arr) { return arr.length ? Math.round(sum(arr) / arr.length * 10) / 10 : 0; }
  function topicName(id) { return (A.TOPICS && A.TOPICS[id]) || id || '未分类'; }
  function topicColor(id) { return (A.topicColorOf && A.topicColorOf(id)) || 'var(--muted)'; }
  function stageName(id) { return (A.STAGE_NAME && A.STAGE_NAME[id]) || id || ''; }
  function bandOf(p) {
    if (p && p.band) return p.band;
    return (A.bandOf && A.bandOf(num(p && p.relevance))) || '';
  }
  function openBtn(id, label) {
    return '<button class="lnk" data-act="open" data-val="' + esc(id) + '">' + esc(label || '打开') + '</button>';
  }
  function topicTag(id) {
    return colorTag ? colorTag(topicName(id), topicColor(id)) : topicName(id);
  }
  function groupCount(arr, keyFn) {
    const m = {};
    arr.forEach(x => { const k = keyFn(x); m[k] = (m[k] || 0) + 1; });
    return m;
  }
  function sortByCount(m) {
    return Object.keys(m).map(k => ({ k: k, v: m[k] })).sort((a, b) => b.v - a.v);
  }
  function hasData(name) {
    if (name === 'directions') return !!(A.DIRS && A.DIRS.length);
    if (name === 'external') return !!(A.EXT && A.EXT.length);
    if (name === 'landscape') return !!(A.LAND && (A.LAND.answers || []).length);
    if (name === 'session') return !!A.SESSION;
    return false;
  }
  /* 整页缺数据时的落法：用一句说明 + 命令行，不要丢一个 class="empty" 的空框。
     空框在 smoke 里会被判成"空态"，整套门禁就会说这一页坏了；而"这一页本来就没有
     对应数据"和"渲染失败"是两件事，页面上也要说清楚是哪一件。 */
  function noneCard(title, msg, howto) {
    return card(title, '这一页需要额外的数据文件',
      note(msg || 'data/ 里没有这份数据，本页暂不显示内容。', 'warn')
      + (howto ? note('补齐方式：' + howto, 'info') : '')
      + note('这一页不显示，不影响其它页面，也不影响交付。', 'info'));
  }

  /* ============================================================== 总览仪表板 */
  BASE.dash = function (papers) {
    const ps = PS(papers);
    const total = ps.length;
    const byStage = groupCount(ps, p => (p.stages || [])[0] || '未归入');
    const byTopic = groupCount(ps, p => p.topic || '未分类');
    const bands = (A.BANDS || []).map(b => {
      const hit = ps.filter(p => bandOf(p) === b.name).length;
      return { k: b.name, v: hit, c: b.color };
    }).filter(x => x.v > 0);
    const readN = ps.filter(p => ['已初读', '已精读'].indexOf(A.statusOf(p.id)) >= 0).length;
    const deepN = ps.filter(p => A.statusOf(p.id) === '已精读').length;
    const rel = num(avg(ps.map(p => num(p.relevance))));
    const learn = num(avg(ps.map(p => num(p.learning))));

    const kpis = grid(4,
      kpi('文献篇数', fmt(total), '当前筛选后', 'var(--accent)', 100)
      + kpi('一级主题', fmt(Object.keys(byTopic).length), '来自 config.topics', '#2f6feb',
        Object.keys(byTopic).length / Math.max(1, (CFG().topics || []).length) * 100)
      + kpi('技术环节', fmt((CFG().stages || []).length), 'S 编号对照在图谱页', '#0e9c9c',
        Object.keys(byStage).length / Math.max(1, (CFG().stages || []).length) * 100)
      + kpi('已读 / 已精读', readN + ' / ' + deepN, '读完 ' + total + ' 篇算一轮',
        '#6b4bbd', total ? readN / total * 100 : 0)
    );

    const donut = bands.length
      ? chartBox(chartDonut(bands.map(b => ({ label: b.k, v: b.v, c: b.c })), { total: total }))
      : emptyBox('没有可统计的档位');

    const topics = sortByCount(byTopic);
    const hbars = topics.length
      ? chartBox(chartHBars(topics.map(t => ({
        k: topicName(t.k), v: t.v, code: t.k,
      })), { labelW: 130 }))
      : emptyBox('没有主题数据');

    const top = (A.sortPapers ? A.sortPapers(ps, 'priority') : ps).slice(0, 8);
    const topTable = table(
      ['编号', { t: '标题', w: 320 }, '年份', '主题', { t: '耦合度', align: 'right' }, { t: '学习价值', align: 'right' }],
      top.map(p => [
        openBtn(p.id, p.id),
        '<span class="ttl">' + esc(String(p.title || '').slice(0, 60)) + '</span>',
        esc(String(p.year || '—')),
        topicTag(p.topic),
        scoreBar(num(p.relevance)),
        scoreBar(num(p.learning)),
      ])
    );

    const stageBars = (CFG().stages || []).map(s => {
      const n = byStage[s.id] || 0;
      return progRowDot(s.id + ' ' + s.name, 'var(--accent)', total ? n / total * 100 : 0, n + ' 篇');
    }).join('');

    return kpis
      + grid(2, card('档位构成', '按耦合度落档', donut) + card('主题分布', '篇数', hbars))
      + grid(2,
        card('最该先读的几篇', '按优先级排序，前 8 篇', topTable)
        + card('技术环节覆盖', '每个环节有几篇', stageBars || emptyBox('config.stages 为空')))
      + (A.EXT && A.EXT.length
        ? cardWide('外部文献概览', '数据来自 data/external.json',
          kvList([
            ['已纳入', fmt(A.EXT.length) + ' 篇'],
            ['开放获取', fmt(A.EXT.filter(e => e.isOa || e.oaStatus === 'open').length) + ' 篇'],
            ['与本库重复', fmt(A.EXT.filter(e => e.alreadyInLocalLibrary).length) + ' 篇'],
          ], 3))
        : '');
  };

  /* ================================================================ 研究现状 */
  BASE.landscape = function () {
    const L = A.LAND;
    if (!L || !(L.answers || []).length) {
      return noneCard('研究现状', '先跑 python scripts/landscape.py <项目目录> 生成 data/landscape.json。');
    }
    const sc = L.scope || {};
    const head = kvList([
      ['分母', fmt(sc.paperCount) + ' 篇'],
      ['年份跨度', (sc.yearFrom || '—') + '—' + (sc.yearTo || '—')],
      ['主题数', fmt(sc.topicCount)],
      ['技术环节', fmt(sc.stageCount)],
      ['来源数', fmt(sc.venueCount)],
      ['单位数', fmt(sc.unitCount)],
    ], 3);

    const answers = (L.answers || []).slice().sort((a, b) => num(a.no) - num(b.no)).map(a => {
      const rows = (a.rows || []).slice(0, 12).map(r => [
        esc(r.name || r.k || '—'),
        fmt(r.v),
        r.share == null ? '—' : fmt(r.share) + '%',
        scoreBar(num(r.share)),
      ]);
      const tbl = rows.length
        ? table(['项', { t: '篇数', align: 'right' }, { t: '占比', align: 'right' }, '占比条'], rows)
        : '';
      const facts = (a.facts || []).map(f => tag(f)).join(' ');
      const caveat = a.caveat ? note('口径：' + esc(a.caveat), 'info') : '';
      return card('Q' + num(a.no) + '　' + (a.title || ''), a.kind || '',
        '<div class="q">' + esc(a.question || '') + '</div>'
        + '<div class="hl">' + esc(a.headline || '') + '</div>'
        + tbl + (facts ? '<div style="margin-top:8px">' + facts + '</div>' : '') + caveat);
    }).join('');

    const bd = (L.boundary || []).length
      ? cardWide('口径边界', '这几条跟着报告一起读',
        (L.boundary || []).map((b, i) => note('B' + (i + 1) + '　' + esc(b), 'warn')).join(''))
      : '';

    return cardWide('本批文献的规模', '研究现状的计算口径', head) + answers + bd;
  };

  /* ================================================================ 技术图谱 */
  BASE.map = function (papers) {
    const ps = PS(papers);
    const stages = CFG().stages || [];
    const byStage = {};
    ps.forEach(p => (p.stages || []).forEach(s => { byStage[s] = (byStage[s] || 0) + 1; }));

    const legend = stages.length >= 2
      ? sidLegend(stages.map(s => ({ id: s.id, name: s.name })), { key: 'map' })
      : '';

    const cards = stages.map(s => {
      const n = byStage[s.id] || 0;
      const hit = ps.filter(p => (p.stages || []).indexOf(s.id) >= 0).slice(0, 6);
      const list = hit.length
        ? '<ul class="mini">' + hit.map(p =>
          '<li>' + openBtn(p.id, p.id) + ' ' + esc(String(p.title || '').slice(0, 46))
          + ' ' + topicTag(p.topic) + '</li>').join('') + '</ul>'
        : emptyBox('本批文献没有落在这个环节的');
      return card(s.id + '　' + s.name, n + ' 篇',
        (s.desc ? '<div class="tiny muted" style="margin-bottom:6px">' + esc(s.desc) + '</div>' : '')
        + progRow(s.name, 'var(--accent)', ps.length ? n / ps.length * 100 : 0, n + ' 篇')
        + list);
    }).join('');

    const matrix = stages.length
      ? cardWide('环节 × 主题', '每格是篇数',
        table(
          [{ t: '环节 \\ 主题', w: 190 }].concat((CFG().topics || []).map(t => ({ t: t.id, w: 60 }))),
          stages.map(s => ['<b>' + esc(s.id) + '</b> ' + esc(s.name)].concat(
            (CFG().topics || []).map(t => {
              const n = ps.filter(p => (p.stages || []).indexOf(s.id) >= 0 && p.topic === t.id).length;
              return n ? '<b>' + n + '</b>' : '<span class="muted">·</span>';
            })))))
      : '';

    return (legend ? '<div style="margin-bottom:10px">' + legend + '</div>' : '')
      + (stages.length ? grid(2, cards) : noneCard('技术图谱', 'config.json 里还没有 stages。'))
      + matrix;
  };

  /* ================================================================ 方向探索 */
  BASE.explore = function () {
    const dirs = A.DIRS || [];
    if (!dirs.length) return noneCard('方向探索', '先跑 python scripts/link.py <项目目录> 生成 data/directions.json。');
    const roots = A.rootsOf ? A.rootsOf() : dirs.filter(d => !d.parentId || d.level === 1);
    const sel = (A.S && A.S.dirSel) || '';
    const cmp = (A.S && A.S.dirCmp) || [];

    const list = roots.map(d => {
      const sup = (d.localPaperIds || []).length;
      const nov = num(d.novelty), mat = num(d.maturity);
      return card(d.name, (d.status || '') + ' · 本库 ' + sup + ' 篇',
        (d.oneLine ? '<div class="hl">' + esc(d.oneLine) + '</div>' : '')
        + kvList([
          ['新颖度', dots(Math.round(nov)) + ' ' + nov],
          ['成熟度', dots(Math.round(mat)) + ' ' + mat],
          ['本库支撑', sup + ' 篇'],
          ['风险', esc(String(d.risk || '—').slice(0, 60))],
        ])
        + '<div style="margin-top:8px">'
        + '<button class="lnk" data-act="state" data-k="dirSel" data-val="' + esc(d.id) + '">展开这一条</button>'
        + ' <button class="lnk" data-act="state" data-k="dirCmp" data-val="' + esc(d.id)
        + '" data-toggle="1">加入对比</button>'
        + '</div>');
    }).join('');

    let detail = '';
    if (sel) {
      const d = (A.DIR_BY && A.DIR_BY[sel]) || dirs.filter(x => x.id === sel)[0];
      if (d) {
        const paperIds = d.localPaperIds || [];
        const rows = paperIds.map(id => (A.BY && A.BY[id]) || null).filter(Boolean).map(p => [
          openBtn(p.id, p.id), esc(String(p.title || '').slice(0, 60)), esc(String(p.year || '—')),
          scoreBar(num(p.relevance)),
        ]);
        detail = cardWide('方向详情：' + d.name, d.id,
          kvList([
            ['问题', esc(d.problem || '—')],
            ['为什么是机会', esc(d.whyOpportunity || '—')],
            ['技术路线', esc(d.techRoute || '—')],
            ['最小实验', esc(d.minExperiment || '—')],
            ['预期产出', esc(d.expectedOutput || '—')],
          ])
          + (rows.length
            ? subTitle('本库支撑的文献') + table(['编号', { t: '标题', w: 300 }, '年份', '耦合度'], rows)
            : emptyBox('这个方向还没有挂上本库文献'))
          + '<div style="margin-top:8px"><button class="lnk" data-act="state" data-k="dirSel" data-clear="1">收起</button></div>');
      }
    }

    let cmpBox = '';
    if (cmp.length >= 2) {
      const ds = cmp.map(id => dirs.filter(d => d.id === id)[0]).filter(Boolean);
      cmpBox = cardWide('方向对比', '共 ' + ds.length + ' 条',
        table(
          [{ t: '维度', w: 110 }].concat(ds.map(d => ({ t: d.id }))),
          [
            ['名称'].concat(ds.map(d => esc(d.name))),
            ['新颖度'].concat(ds.map(d => dots(Math.round(num(d.novelty))) + ' ' + num(d.novelty))),
            ['成熟度'].concat(ds.map(d => dots(Math.round(num(d.maturity))) + ' ' + num(d.maturity))),
            ['本库支撑'].concat(ds.map(d => fmt((d.localPaperIds || []).length) + ' 篇')),
            ['风险'].concat(ds.map(d => esc(String(d.risk || '—').slice(0, 40)))),
          ])
        + '<div style="margin-top:8px"><button class="lnk" data-act="state" data-k="dirCmp" data-clear="1">清空对比</button></div>');
    }

    return (detail ? detail : '')
      + cardWide('方向清单', '共 ' + roots.length + ' 条一级方向', list)
      + cmpBox;
  };

  /* ================================================================ 外部文献 */
  BASE.external = function () {
    const ext = A.EXT || [];
    if (!ext.length) return noneCard('外部文献', '先跑 python scripts/discover.py <项目目录> 生成 data/external.json。');
    const oa = ext.filter(e => e.isOa || e.oaStatus === 'open').length;
    const unread = ext.filter(e => !e.alreadyInLocalLibrary).length;
    const kpis = grid(3,
      kpi('推荐条数', fmt(ext.length), '经筛选后', 'var(--accent)', 100)
      + kpi('开放获取', fmt(oa), '可直接下 PDF', '#0e9c9c', ext.length ? oa / ext.length * 100 : 0)
      + kpi('本库未收录', fmt(unread), '值得补进来', '#d97706', ext.length ? unread / ext.length * 100 : 0));

    const rows = ext.slice().sort((a, b) => num(b.score) - num(a.score)).map(e => [
      esc(String(e.title || '').slice(0, 70)),
      esc(String(e.year || '—')),
      esc(String(e.venue || '—').slice(0, 24)),
      scoreBar(num(e.score)),
      e.isOa || e.oaStatus === 'open' ? tag('开放获取') : tag(e.accessStatus || e.oaStatus || '—'),
      (e.doiUrl || e.paperUrl)
        ? '<a href="' + esc(e.doiUrl || e.paperUrl) + '" target="_blank" rel="noopener">链接</a>'
        : '<span class="muted">—</span>',
    ]);

    return kpis + cardWide('推荐清单', '按综合分从高到低，共 ' + rows.length + ' 条',
      table(['标题', { t: '年份', w: 64 }, { t: '发表处', w: 150 }, { t: '综合分', w: 110 }, { t: '获取', w: 90 }, { t: '地址', w: 60 }], rows));
  };

  /* ============================================================== 文献数据库 */
  BASE.db = function (papers) {
    const ps = A.sortPapers ? A.sortPapers(PS(papers), (A.S && A.S.sort) || 'priority') : PS(papers);
    const cmpSel = (A.S && A.S.cmp) || [];
    /* 主题快捷筛选：用 .chip 构件（bind 里 data-act="topic" 会 toggle 到 filters.topic）。
       通用版没有独立的筛选栏，这是唯一能一进页面就按主题收窄的地方。 */
    const byTopic = groupCount(ps, p => p.topic || '未分类');
    const chips = (CFG().topics || []).map(t =>
      '<button class="chip" data-act="topic" data-val="' + esc(t.id) + '">'
      + esc(t.name) + ' ' + (byTopic[t.id] || 0) + '</button>').join('');
    const chipBar = chips
      ? '<div class="card"><div class="card-b" style="display:flex;flex-wrap:wrap;gap:6px">'
      + chips + '</div></div>'
      : '';
    const rows = ps.map(p => [
      openBtn(p.id, p.id),
      esc(String(p.title || '').slice(0, 54)),
      esc(String(p.year || '—')),
      esc(String(p.venue || '—').slice(0, 20)),
      topicTag(p.topic),
      esc(String(p.dl || '—').slice(0, 12)),
      scoreBar(num(p.relevance)),
      scoreBar(num(p.learning)),
      '<span class="tiny' + (A.statusOf(p.id) === '已精读' ? ' b' : ' muted') + '">' + esc(A.statusOf(p.id)) + '</span>',
      cmpSel.indexOf(p.id) >= 0
        ? '<button class="lnk" data-act="state" data-k="cmp" data-val="' + esc(p.id) + '" data-toggle="1">移出</button>'
        : '<button class="lnk" data-act="state" data-k="cmp" data-val="' + esc(p.id) + '" data-toggle="1">对比</button>',
    ]);
    return chipBar + cardWide('全部文献', '共 ' + ps.length + ' 篇 · 点编号打开详情',
      table(['编号', { t: '标题', w: 300 }, { t: '年份', w: 58 }, { t: '发表处', w: 120 },
        { t: '主题', w: 130 }, { t: '方法', w: 84 }, { t: '耦合度', w: 96 }, { t: '学习价值', w: 96 },
        { t: '状态', w: 72 }, { t: '对比', w: 60 }], rows));
  };

  /* ================================================================ 文献对比 */
  BASE.cmp = function () {
    const sel = ((A.S && A.S.cmp) || []).map(id => (A.BY && A.BY[id]) || null).filter(Boolean);
    if (sel.length < 2) {
      return noneCard('文献对比', '还没选够两篇（当前 ' + sel.length + ' 篇）。',
        '在「文献数据库」里点两篇的「对比」，它们会并排出现在这里。');
    }
    const head = [{ t: '维度', w: 120 }].concat(sel.map(p => ({ t: p.id })));
    const rows = [
      ['标题'].concat(sel.map(p => esc(String(p.title || '')))),
      ['年份'].concat(sel.map(p => esc(String(p.year || '—')))),
      ['发表处'].concat(sel.map(p => esc(String(p.venue || '—')))),
      ['主题'].concat(sel.map(p => topicTag(p.topic))),
      ['方法类型'].concat(sel.map(p => esc(String(p.dl || '—')))),
      ['耦合度'].concat(sel.map(p => scoreBar(num(p.relevance)))),
      ['学习价值'].concat(sel.map(p => scoreBar(num(p.learning)))),
      ['阅读难度'].concat(sel.map(p => scoreBar(num(p.difficulty)))),
      ['是否有代码'].concat(sel.map(p => p.hasCode ? tag('有') : tag('未报告'))),
      ['数据集'].concat(sel.map(p => esc((p.datasets || []).length ? p.datasets.join('、') : '未报告'))),
    ];
    const deep = sel.map(p => card(p.id, '',
      (p.overview ? rich(p.overview) : emptyBox('没有 overview'))
      + (p.conclusion ? subTitle('结论与局限') + rich(p.conclusion) : '')));
    return cardWide('并排对比', '共 ' + sel.length + ' 篇', table(head, rows))
      + grid(sel.length >= 2 ? 2 : 1, deep.join(''));
  };

  /* ============================================================ 学习决策中心 */
  BASE.decide = function (papers) {
    const ps = PS(papers);
    const w = (A.S && A.S.weights) || CFG().weights || {};
    const labels = CFG().scoreLabels || {};
    const presets = CFG().presets || [];
    const top = (A.sortPapers ? A.sortPapers(ps, 'priority') : ps).slice(0, 12);

    const presetBox = presets.length
      ? card('筛法预设', '点一下套用',
        '<div style="display:flex;flex-wrap:wrap;gap:6px">'
        + presets.map(x => '<button class="lnk" data-preset="' + esc(x.id) + '">' + esc(x.label) + '</button>').join('')
        + '</div>'
        + '<div style="margin-top:8px">' + presets.map(x =>
          note('<b>' + esc(x.label) + '</b>　' + esc(x.desc || ''), 'info')).join('') + '</div>')
      : '';

    const weightBox = card('评分权重', '改 config.weights 才会变',
      kvList([
        [labels.relevance || 'relevance', String(w.relevance == null ? '—' : w.relevance)],
        [labels.learning || 'learning', String(w.learning == null ? '—' : w.learning)],
        [labels.difficulty || 'difficulty', String(w.difficulty == null ? '—' : w.difficulty)],
      ]));

    const rows = top.map(p => [
      openBtn(p.id, p.id),
      esc(String(p.title || '').slice(0, 50)),
      esc(String(p.year || '—')),
      scoreBar(num(p.relevance)),
      scoreBar(num(p.learning)),
      scoreBar(num(p.difficulty) * 20),
      esc(A.statusOf(p.id)),
    ]);

    const extra = Object.keys(groupCount(ps, p => p.dl || '未判定')).length
      ? progRowDot('方法类型数', '#0e9c9c',
        Object.keys(groupCount(ps, p => p.dl || '未判定')).length / Math.max(1, (CFG().dlCategories || []).length) * 100,
        Object.keys(groupCount(ps, p => p.dl || '未判定')).length + ' 类')
      : '';

    return (presetBox || weightBox ? grid(2, presetBox + weightBox) : '')
      + cardWide('建议阅读顺序', '按优先级算出来的前 12 篇',
        table(['编号', { t: '标题', w: 280 }, { t: '年份', w: 58 }, { t: '耦合度', w: 100 },
          { t: '学习价值', w: 100 }, { t: '难度', w: 100 }, { t: '状态', w: 72 }], rows)
        + (extra ? '<div style="margin-top:10px">' + extra + '</div>' : ''));
  };

  /* ================================================================ 阅读进度 */
  BASE.prog = function (papers) {
    const ps = PS(papers);
    const statusList = (A.STATUS || CFG().statuses || []).slice();
    const cnt = groupCount(ps, p => A.statusOf(p.id));
    const total = ps.length || 1;
    const bars = statusList.map(s =>
      progRow(s, s === '已精读' ? 'var(--ok)' : s === '暂时跳过' ? 'var(--muted)' : 'var(--accent)',
        (cnt[s] || 0) / total * 100, (cnt[s] || 0) + ' 篇')).join('');

    const todo = ps.filter(p => ['未阅读', '待阅读'].indexOf(A.statusOf(p.id)) >= 0 && num(p.relevance) >= 45)
      .slice(0, 10);
    const todoTable = todo.length
      ? table(['编号', { t: '标题', w: 300 }, { t: '耦合度', w: 100 }, { t: '状态', w: 80 }],
        todo.map(p => [openBtn(p.id, p.id), esc(String(p.title || '').slice(0, 60)),
          scoreBar(num(p.relevance)), esc(A.statusOf(p.id))]))
      : emptyBox('没有「高相关但还没读」的');

    const done = ps.filter(p => A.statusOf(p.id) === '已精读');
    return grid(2,
      card('状态分布', '共 ' + ps.length + ' 篇', bars || emptyBox('没有状态数据'))
      + card('高相关待读', '耦合度 ≥ 45 且未开始读', todoTable))
      + cardWide('已精读的文献', '共 ' + done.length + ' 篇',
        done.length
          ? table(['编号', { t: '标题', w: 360 }, '年份', '主题'],
            done.map(p => [openBtn(p.id, p.id), esc(String(p.title || '').slice(0, 70)),
              esc(String(p.year || '—')), topicTag(p.topic)]))
          : emptyBox('还没有标为「已精读」的文献'));
  };

  /* ================================================================ 检索记录 */
  BASE.session = function () {
    const S = A.SESSION;
    if (!S) return noneCard('检索记录', '先跑 python scripts/discover.py <项目目录> 生成 data/search_session.json。');
    const kv = kvList([
      ['检索式', esc(S.researchQuery || '—')],
      ['日期', esc(S.searchDate || '—')],
      ['来源', (S.sourcesSucceeded || []).join('、') || '—'],
      ['原始命中', fmt(num(S.rawHitCount))],
      ['去重后', fmt(num(S.uniqueHitCount))],
      ['过筛', fmt(num(S.passedScreeningCount))],
      ['最终推荐', fmt(num(S.recommendedCount))],
      ['本库已有', fmt(num(S.localLibraryCount))],
    ], 2);

    const terms = (list, name) => (list || []).length
      ? '<div style="margin:6px 0"><span class="tiny muted">' + esc(name) + '</span> '
      + list.map(t => tag(t)).join(' ') + '</div>'
      : '';

    const limits = (S.coverageLimitations || []).length
      ? (S.coverageLimitations || []).map((x, i) => note('L' + (i + 1) + '　' + esc(x), 'warn')).join('')
      : emptyBox('没有记录覆盖局限');

    const rules = (S.selectionRules || []).length
      ? (S.selectionRules || []).map(x => note(esc(typeof x === 'string' ? x : JSON.stringify(x)), 'info')).join('')
      : '';

    const rejected = (S.rejectedSample || []).length
      ? table(['标题', { t: '原因', w: 260 }],
        (S.rejectedSample || []).slice(0, 12).map(r => [
          esc(String(r.title || r.id || '—')).slice(0, 80),
          esc(String(r.reason || r.why || '—')),
        ]))
      : emptyBox('没有记录被排除的例子');

    return cardWide('这次检索是怎么跑出来的', '数字对不上时先看这一页', kv
      + terms(S.platformTerms, '平台词') + terms(S.objectTerms, '对象词')
      + terms(S.scenarioTerms, '场景词') + terms(S.modalityTerms, '模态词'))
      + grid(2, card('覆盖局限', '检索漏了什么', limits) + card('筛选规则', '写死的规则', rules || emptyBox('没有记录筛选规则')))
      + cardWide('被排除的例子', '抽几条看排除得对不对', rejected);
  };

  window.VIEWS_BASE = BASE;

  /* ============================================================== 通用详情标签
     和视图同理：项目 src/tabs.js 里写过的覆盖它，没写的用这里。
     全部只读 papers.json / external.json 的字段，不写任何项目特有措辞。 */
  const TABS = {};

  TABS.understand = function (p) {
    return (p.overview ? rich(p.overview) : emptyBox('这篇没有 overview'))
      + (p.keywords ? kvList([['关键词', esc(p.keywords)]]) : '');
  };
  TABS.project = function (p) {
    const bd = (p.relevanceBreakdown || []);
    const rel = bd.length
      ? table(['维度', { t: '权重', align: 'right' }, { t: '得分', align: 'right' }, '判定理由'],
        bd.map(x => [esc(x.dim || '—'), fmt(num(x.weight)), fmt(num(x.score)),
          '<span class="tiny">' + esc(String(x.reason || '').slice(0, 120)) + '</span>']))
      : emptyBox('没有 relevanceBreakdown，耦合度是单值');
    return kvList([
      ['耦合度', scoreBar(num(p.relevance))],
      ['主题', topicTag(p.topic)],
      ['技术环节', ((p.stages || []).length ? p.stages.map(s => tag(s + ' ' + stageName(s))).join(' ') : '—')],
      ['失败模式', ((p.failureModes || []).length ? p.failureModes.map(f => tag(f)).join(' ') : '—')],
    ]) + (bd.length ? subTitle('耦合度拆解') + rel : rel);
  };
  TABS.eval = function (p) {
    const extra = p.extraScores && Object.keys(p.extraScores).length
      ? Object.keys(p.extraScores).map(k => [k, scoreBar(num(p.extraScores[k]))])
      : [];
    return kvList([
      ['学习价值', scoreBar(num(p.learning))],
      ['阅读难度', scoreBar(num(p.difficulty) * 20)],
      ['是否有代码', p.hasCode ? tag('有') : tag('未报告')],
      ['数据集', ((p.datasets || []).length ? esc(p.datasets.join('、')) : '未报告')],
      ['指标', ((p.metrics || []).length ? esc(p.metrics.join('、')) : '未报告')],
      ['证据强度', esc(String(p.evidence == null || p.evidence === '' ? '—' : p.evidence))],
    ].concat(extra));
  };
  TABS.guide = function (p) {
    return (p.method ? subTitle('方法拆解') + rich(p.method) : emptyBox('这篇没有 method'))
      + (p.data ? subTitle('数据与实验') + rich(p.data) : '');
  };
  TABS.notes = function (p) {
    const txt = A.noteText ? A.noteText(p) : '';
    return (txt ? rich(txt) : emptyBox('还没有笔记'))
      + '<div style="margin-top:8px"><button class="lnk" data-act="export-note" data-val="'
      + esc(p.id) + '">导出这篇的笔记</button></div>';
  };
  TABS.raw = function (p) {
    return kvList([
      ['标题', esc(p.title || '—')],
      ['英文标题', esc(p.titleEn || '—')],
      ['作者', esc(p.authors || '—')],
      ['单位', esc(p.unit || '—')],
      ['年份 / 发表处', esc(String(p.year || '—')) + ' / ' + esc(p.venue || '—')],
      ['原文结论', ''],
    ]) + (p.conclusion ? rich(p.conclusion) : emptyBox('这篇没有 conclusion'));
  };
  TABS.extAbs = function (e) { return e.abstract ? rich(e.abstract) : emptyBox('这条没有摘要'); };
  TABS.extWhere = function (e) {
    return kvList([
      ['出处', esc(e.venue || '—')],
      ['年份', esc(String(e.year || '—'))],
      ['作者', esc(e.authors || '—')],
      ['机构', esc(e.institution || '—')],
      ['DOI', e.doi ? esc(e.doi) : '—'],
      ['来源库', esc(e.source || e.sourceDatabase || '—')],
      ['获取状态', esc(e.accessStatus || e.oaStatus || '—')],
      ['链接', (e.doiUrl || e.paperUrl) ? '<a href="' + esc(e.doiUrl || e.paperUrl)
        + '" target="_blank" rel="noopener">打开</a>' : '—'],
    ]);
  };
  TABS.extDir = function (e) {
    const ids = e.directionIds || [];
    if (!ids.length) return emptyBox('这条没有关联方向');
    const dirs = ids.map(id => (A.DIR_BY && A.DIR_BY[id]) || null).filter(Boolean);
    return dirs.length
      ? table(['方向', '一句话'], dirs.map(d => [esc(d.name), esc(String(d.oneLine || '—')).slice(0, 80)]))
      : ids.map(id => tag(id)).join(' ');
  };

  window.TABS_BASE = TABS;
})();
