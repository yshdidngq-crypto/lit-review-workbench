/* Preview layer: three-pane literature workspace for the existing single-file UI. */
(function () {
  'use strict';
  const A = window.APP;
  const mask = document.querySelector('.zo-mask');
  const main = mask && mask.querySelector('.zo-main');
  if (!A || !main || !A.P.length) return;
  const style = document.createElement('style');
  style.textContent = `
    .zo-mask{background:var(--bg);z-index:9000}
    .zo-panel{inset:0;border-radius:0;box-shadow:none;grid-template-rows:auto minmax(0,1fr);background:var(--panel)}
    .zo-head{padding:18px 28px;background:var(--panel);border-bottom:1px solid var(--line)}
    .zo-head h2{font-size:19px;letter-spacing:-.02em}
    .zo-head p{font-size:12px;line-height:1.5}
    .zo-main{grid-template-columns:216px minmax(360px,1fr) minmax(300px,380px)}
    .zo-side{padding:16px 12px;background:var(--bg)}
    .zo-side button{font-size:13px;margin:2px 0;min-height:36px}
    .zo-content{padding:18px 22px}
    .zo-tools{gap:7px}.zo-tools input{min-width:170px}
    .zo-tools .zo-btn{padding:8px 9px;font-size:12px}
    .zo-table th{top:0}.zo-table td{padding:10px 8px}
    .zo-title{line-height:1.5}.zo-title:focus-visible,.zo-side button:focus-visible,.zo-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .zo-detail{overflow:auto;border-left:1px solid var(--line);padding:24px;background:var(--panel)}
    .zo-detail .eyebrow{font-size:11px;letter-spacing:.09em;font-weight:700;color:var(--accent);margin-bottom:10px}
    .zo-detail h3{font-size:18px;line-height:1.45;letter-spacing:-.02em;margin:0 0 12px}
    .zo-meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px}.zo-meta span{font-size:11px;border:1px solid var(--line);border-radius:5px;padding:3px 7px;color:var(--muted)}
    .zo-detail h4{font-size:12px;margin:22px 0 7px;color:var(--ink)}
    .zo-detail p{font-size:12.5px;line-height:1.75;margin:0;color:var(--ink)}
    .zo-detail .subtle{color:var(--muted);font-size:11px;line-height:1.5;margin-top:5px}
    .zo-detail textarea{box-sizing:border-box;width:100%;min-height:150px;resize:vertical;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:7px;padding:10px;font:12.5px/1.6 inherit}
    .zo-detail textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
    .zo-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:14px}
    .zo-link{display:inline-block;margin:3px 5px 3px 0;padding:5px 8px;border:1px solid var(--line);border-radius:6px;color:var(--accent);background:var(--bg);font:12px inherit;cursor:pointer}
    @media(max-width:1050px){.zo-main{grid-template-columns:185px minmax(330px,1fr)}.zo-detail{position:absolute;right:0;top:67px;bottom:0;width:min(390px,84vw);box-shadow:-12px 0 28px #0002;z-index:2;display:none}.zo-detail.open{display:block}}
    @media(max-width:700px){.zo-main{display:block}.zo-side{display:flex;white-space:nowrap;overflow-x:auto;border-bottom:1px solid var(--line)}.zo-content{height:calc(100vh - 143px)}.zo-detail{top:67px;width:calc(100vw - 42px)}.zo-table th:nth-child(3),.zo-table td:nth-child(3){display:none}}
  `;
  document.head.appendChild(style);
  const detail = document.createElement('aside');
  detail.className = 'zo-detail';
  detail.setAttribute('aria-label', '当前论文详情与笔记');
  main.appendChild(detail);
  let currentId = A.P[0].id;
  function el(tag, cls, content) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (content != null) node.textContent = content;
    return node;
  }
  function dirsFor(id) {
    return (A.DIRS || []).filter(d => ((d.localSupport || {}).paperIds || []).includes(id));
  }
  function renderDetail(id) {
    const p = A.BY[id];
    if (!p) return;
    currentId = id;
    detail.replaceChildren();
    detail.appendChild(el('div','eyebrow','当前论文 · '+id));
    detail.appendChild(el('h3','',p.title || id));
    const meta = el('div','zo-meta');
    [p.year || '年份未录入',p.venue || '出处未录入',p.doi ? 'DOI '+p.doi : 'DOI 待核实'].forEach(v => meta.appendChild(el('span','',String(v))));
    detail.appendChild(meta);
    detail.appendChild(el('h4','','内容摘录'));
    const rawOverview = String(p.abstract || p.overview || '').replace(/【[^】]+】/g,'').replace(/\s+/g,' ').trim();
    const cleaned = window.cleanWorkbenchOverview ? window.cleanWorkbenchOverview(rawOverview) : {text:rawOverview,broken:0};
    detail.appendChild(el('p','',cleaned.text || '尚未收录摘要内容。'));
    if (cleaned.broken) detail.appendChild(el('div','subtle',`原始资料有 ${cleaned.broken} 处无法识别的字符片段，展示时已隐藏；请对照论文原文核实。`));
    if (!p.abstract) detail.appendChild(el('div','subtle','来源：工作台概述字段；未单独保存原文摘要。'));
    detail.appendChild(el('h4','','关联方向'));
    const dirs = dirsFor(id);
    if (!dirs.length) detail.appendChild(el('div','subtle','尚未建立人工核对的方向关联。'));
    dirs.forEach(d => {
      const b=el('button','zo-link',d.name);b.type='button';
      b.addEventListener('click',()=>{mask.querySelector('[data-zo=close]').click();A.openDir(d.id);});
      detail.appendChild(b);
    });
    detail.appendChild(el('h4','','我的阅读笔记'));
    const box=el('textarea','');box.value=A.S.notes[id] || '';box.placeholder='记录证据、局限，以及与你课题的关系';
    box.setAttribute('aria-label','这篇论文的阅读笔记');
    box.addEventListener('input',()=>{A.S.notes[id]=box.value;A.saveState();});
    detail.appendChild(box);
    detail.appendChild(el('div','subtle','自动保存在当前浏览器；换设备前请导出阅读进度备份。'));
    const actions=el('div','zo-actions');
    const compare=el('button','zo-btn','加入文献对比');compare.type='button';
    compare.addEventListener('click',()=>{
      A.S.cmp = Array.isArray(A.S.cmp) ? A.S.cmp : [];
      if (!A.S.cmp.includes(id)) {
        if (A.S.cmp.length>=4) return A.toast('最多对比 4 篇，请先从对比页移除一篇');
        A.S.cmp.push(id);A.saveState();
      }
      mask.querySelector('[data-zo=close]').click();
      A.go('cmp');
      A.toast('已打开文献对比 · 当前 ' + A.S.cmp.length + ' 篇');
    });
    actions.appendChild(compare);
    const open=el('button','zo-btn','打开完整详情');open.type='button';
    open.addEventListener('click',()=>{mask.querySelector('[data-zo=close]').click();A.openDrawer(id);});
    actions.appendChild(open);detail.appendChild(actions);
    detail.classList.add('open');
  }
  mask.addEventListener('click',e=>{
    const title=e.target.closest('button[data-open]');
    if (!title || !mask.contains(title)) return;
    e.stopImmediatePropagation();e.preventDefault();renderDetail(title.dataset.open);
  },true);
  mask.addEventListener('click',e=>{if(e.target.closest('[data-zo=close]'))detail.classList.remove('open');});
  document.querySelector('.zo-launch').addEventListener('click',()=>renderDetail(currentId));
})();
