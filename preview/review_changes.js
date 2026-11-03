/* Review build: searchable comparison, honest abstracts, and responsive ranking. */
(function () {
  'use strict';
  const A = window.APP;
  if (!A) return;
  let query = '';
  let topic = '';
  let mode = 'all';
  function cleanOverview(value) {
    const raw = String(value || '').trim();
    const broken = raw.match(/[\uE000-\uF8FF\uFFFD]+/g) || [];
    return {
      text: raw.replace(/[\uE000-\uF8FF\uFFFD]+/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim(),
      broken: broken.length,
    };
  }
  window.cleanWorkbenchOverview = cleanOverview;
  function appendSourceWarning(node, count) {
    if (!count) return;
    const note = document.createElement('div');
    note.className = 'tiny muted';
    note.textContent = `原始资料有 ${count} 处无法识别的字符片段，展示时已隐藏；涉及的字词请对照论文原文核实。`;
    node.appendChild(note);
  }
  const style = document.createElement('style');
  style.textContent = `
    #nav button[data-view="map"]{display:none!important}
    .cmp-workspace{display:grid;gap:10px}
    .cmp-workspace input,.cmp-workspace select{box-sizing:border-box;min-height:38px;padding:7px 10px;border:1px solid var(--line);border-radius:7px;background:var(--panel2);color:var(--ink);font:inherit}
    .cmp-workspace input{width:100%}.cmp-workspace select{min-width:0;width:100%}
    .cmp-workspace .cmp-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center}
    .cmp-workspace .cmp-filter{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
    .cmp-workspace .cmp-filter button{white-space:nowrap}
    .cmp-overview{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.75;min-width:260px}
    .cmp-vertical{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}
    .cmp-vertical article{border:1px solid var(--line);border-radius:8px;padding:14px;background:var(--panel2)}
    .cmp-vertical h4{margin:0 0 6px;line-height:1.5}
    .cmp-vertical p{white-space:pre-wrap;line-height:1.7;overflow-wrap:anywhere}
    @media(max-width:650px){.cmp-workspace .cmp-row{grid-template-columns:1fr auto}.cmp-workspace .cmp-row select{grid-column:1/-1}}
  `;
  document.head.appendChild(style);
  const nav = document.querySelector('#nav button[data-view="map"]');
  if (nav) nav.remove();
  if (A.S.view === 'map') A.go('dash');

  // The original picker displayed only the first 120 records. Keep every paper available.
  function match(p) {
    const anchor = (A.S.cmp || []).map(id => A.BY[id]).find(Boolean);
    if (topic && p.topic !== topic) return false;
    if (anchor && mode === 'same' && p.topic !== anchor.topic) return false;
    if (anchor && mode === 'cross' && p.topic === anchor.topic) return false;
    const q = query.trim().toLowerCase();
    const tags = [String(p.year || ''), ...Object.values(p.tags || {}).flat()];
    const hay = [p.id,p.title,p.titleEn,p.titleZh,p.authors,p.keywords,p.venue,...tags].join(' ').toLowerCase();
    return !q || hay.includes(q);
  }
  function addOption(select, value, label) {
    const opt = document.createElement('option'); opt.value = value; opt.textContent = label; select.appendChild(opt);
  }
  function renderComparison() {
    const host = document.getElementById('view');
    if (!host) return;
    const picker = host.querySelector('.card');
    if (!picker) return;
    picker.innerHTML = '<div class="card-h"><h3>选择文献</h3><span class="hint">题名、作者、年份或标签均可搜索 · 2–4 篇</span></div><div class="card-b cmp-workspace"><input id="cmpQuery" type="search" aria-label="搜索全部论文" placeholder="输入 2026、作者、题名或标签"><div class="cmp-filter" id="cmpTopics"></div><div class="cmp-filter" id="cmpModes"></div><div class="cmp-row"><select id="cmpPaper" aria-label="选择论文"></select><button class="btn primary sm" id="cmpChoose">加入</button><button class="btn sm" id="cmpReset">清空</button></div><div class="tiny muted" id="cmpCount"></div><div class="cmp-filter" id="cmpPicked"></div></div>';
    const input = picker.querySelector('#cmpQuery'); input.value = query;
    input.addEventListener('input', () => { query = input.value; populate(); });
    const topics = picker.querySelector('#cmpTopics');
    const topicChoices = [{id:'',name:'全部主题'},...(A.CFG.topics || [])];
    topicChoices.forEach(t => { const b = document.createElement('button'); b.type='button'; b.className='chip'+(topic===t.id?' on':''); b.textContent=t.name; b.addEventListener('click',()=>{topic=t.id;A.render();}); topics.appendChild(b); });
    const modes = picker.querySelector('#cmpModes');
    [['all','不限范围'],['same','与首篇同领域'],['cross','与首篇跨领域']].forEach(([v,label]) => { const b=document.createElement('button');b.type='button';b.className='chip'+(mode===v?' on':'');b.textContent=label;b.addEventListener('click',()=>{mode=v;A.render();});modes.appendChild(b); });
    const chosen = picker.querySelector('#cmpPicked');
    (A.S.cmp || []).forEach(id => {const p=A.BY[id];if(!p)return;const b=document.createElement('button');b.type='button';b.className='chip on';b.textContent=`${id} · ${p.title} ×`;b.title='点击移出对比';b.addEventListener('click',()=>{A.S.cmp=A.S.cmp.filter(x=>x!==id);A.saveState();A.render();});chosen.appendChild(b);});
    const select=picker.querySelector('#cmpPaper');
    function populate() {
      select.replaceChildren();
      const found=A.P.filter(match);
      addOption(select,'','— 选择一篇论文 —');
      found.forEach(p=>addOption(select,p.id,`#${p.year || '年份未知'} · ${p.id} · ${p.title}`));
      picker.querySelector('#cmpCount').textContent=`命中 ${found.length} / ${A.P.length} 篇；已选 ${(A.S.cmp||[]).length} / 4 篇。年份标签由论文年份自动生成。`;
    }
    populate();
    picker.querySelector('#cmpChoose').onclick=()=>{const id=select.value;if(!id)return A.toast('请先选择论文');A.S.cmp=Array.isArray(A.S.cmp)?A.S.cmp:[];if(A.S.cmp.includes(id))return A.toast('这篇已在对比中');if(A.S.cmp.length>=4)return A.toast('最多对比 4 篇');A.S.cmp.push(id);A.saveState();query='';A.render();};
    picker.querySelector('#cmpReset').onclick=()=>{A.S.cmp=[];A.saveState();A.render();};

    const selected=(A.S.cmp||[]).map(id=>A.BY[id]).filter(Boolean);
    const table=host.querySelector('table.db');
    if (table && selected.length>=2) {
      const rows=[...table.querySelectorAll('tbody tr')];
      const row=rows.find(tr=>/原文摘要|概述摘录/.test(tr.querySelector('th')?.textContent||''));
      if(row){row.querySelector('th').textContent='原文摘要 / 概述全文';[...row.querySelectorAll('td')].forEach((cell,i)=>{const p=selected[i];const cleaned=cleanOverview(p.abstract||p.abstractRaw||p.overview);cell.replaceChildren();const content=document.createElement('div');content.className='cmp-overview';content.textContent=cleaned.text||'未收录摘要或概述';cell.appendChild(content);appendSourceWarning(cell,cleaned.broken);if(!p.abstract&&!p.abstractRaw){const note=document.createElement('div');note.className='tiny muted';note.textContent='来源：工作台概述字段；源数据未单独保存原文摘要。';cell.appendChild(note);}});}
    }
    if(selected.length>=2){
      const card=document.createElement('section');card.className='card';card.style.marginTop='14px';
      const head=document.createElement('div');head.className='card-h';const title=document.createElement('h3');title.textContent='纵向对比';head.appendChild(title);const hint=document.createElement('span');hint.className='hint';hint.textContent='逐篇阅读完整概述；当前组合包含 '+new Set(selected.map(p=>p.topic)).size+' 个主题';head.appendChild(hint);card.appendChild(head);
      const body=document.createElement('div');body.className='card-b cmp-vertical';
      selected.forEach(p=>{const article=document.createElement('article');const h=document.createElement('h4');h.textContent=`${p.id} · ${p.title}`;article.appendChild(h);const meta=document.createElement('div');meta.className='tiny muted';meta.textContent=`#${p.year||'年份未知'} · ${(A.CFG.topics||[]).find(t=>t.id===p.topic)?.name||'主题未分类'} · ${A.statusOf(p.id)}`;article.appendChild(meta);const sub=document.createElement('h4');sub.style.marginTop='14px';sub.textContent=p.abstract||p.abstractRaw?'原文摘要':'概述全文';article.appendChild(sub);const cleaned=cleanOverview(p.abstract||p.abstractRaw||p.overview);const text=document.createElement('p');text.textContent=cleaned.text||'未收录摘要或概述';article.appendChild(text);appendSourceWarning(article,cleaned.broken);body.appendChild(article);});
      card.appendChild(body);host.appendChild(card);
    }
  }
  (window.AFTER_RENDER=window.AFTER_RENDER||[]).push(function () {
    if(A.S.view==='cmp')renderComparison();
    if(A.S.view==='decide'){
      [...document.querySelectorAll('#view .card')].forEach(card=>{if(card.querySelector('h3')?.textContent.trim()==='最缺文献支撑的环节')card.remove();});
    }
  });
  // Capture fires before the original slider handler, so the re-render sorts by current weights.
  document.addEventListener('change',e=>{if(e.target.matches?.('[data-extw]'))A.S.extSort='total';},true);
  if(['cmp','decide'].includes(A.S.view))A.render();
})();
