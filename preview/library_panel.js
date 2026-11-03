(function () {
  'use strict';
  const A = window.APP;
  if (!A || !Array.isArray(A.P) || !document.head || !document.body) return;
  const key = (A.CFG.lsKey || 'lit-workbench-v1') + ':library-organizer-v1';
  const defaultData = () => ({ collections: {}, tags: {} });
  let data;
  try { data = Object.assign(defaultData(), JSON.parse(localStorage.getItem(key) || '{}')); }
  catch (_) { data = defaultData(); }
  if (!data.collections || typeof data.collections !== 'object') data.collections = {};
  if (!data.tags || typeof data.tags !== 'object') data.tags = {};
  let scope = 'all', query = '', selected = new Set();
  const papers = A.P;
  const byId = new Map(papers.map(p => [p.id, p]));
  const css = document.createElement('style');
  css.textContent = `
    .zo-launch{width:100%;margin:10px 0 4px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);font:inherit;text-align:left;cursor:pointer}
    .zo-launch:hover,.zo-btn:hover{border-color:var(--accent)}
    .zo-mask{position:fixed;inset:0;background:#0008;z-index:9000;display:none}
    .zo-mask.open{display:block}
    .zo-panel{position:absolute;inset:4vh 4vw;background:var(--panel);color:var(--ink);border-radius:12px;display:grid;grid-template-rows:auto 1fr;box-shadow:0 20px 60px #0004;overflow:hidden}
    .zo-head{display:flex;align-items:center;gap:12px;padding:16px 22px;border-bottom:1px solid var(--line)}
    .zo-head h2{font-size:20px;margin:0}.zo-head p{margin:2px 0 0;color:var(--muted);font-size:12px}.zo-spacer{flex:1}
    .zo-main{display:grid;grid-template-columns:210px minmax(0,1fr);min-height:0}
    .zo-side{overflow:auto;border-right:1px solid var(--line);padding:16px}.zo-side h3{font-size:12px;color:var(--muted);margin:14px 0 6px;text-transform:uppercase}
    .zo-side-hint{font-size:11px;line-height:1.5;color:var(--muted);padding:4px 10px}
    .zo-side button{display:block;width:100%;text-align:left;border:0;background:transparent;color:var(--ink);padding:8px 10px;border-radius:6px;cursor:pointer;font:inherit}
    .zo-side button[aria-current=true]{background:var(--bg);font-weight:700}
    .zo-content{min-width:0;overflow:auto;padding:16px 22px}.zo-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
    .zo-tools input{min-width:220px;flex:1;padding:9px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--ink)}
    .zo-btn{border:1px solid var(--line);border-radius:7px;padding:8px 10px;background:var(--bg);color:var(--ink);font:inherit;cursor:pointer}
    .zo-count{color:var(--muted);font-size:12px;margin:8px 0}.zo-table{width:100%;border-collapse:collapse;font-size:13px}.zo-table th,.zo-table td{padding:9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.zo-table th{position:sticky;top:0;background:var(--panel)}
    .zo-title{background:none;border:0;padding:0;color:var(--accent);text-align:left;cursor:pointer;font:inherit;font-weight:600}.zo-tags{color:var(--muted);font-size:11px}
    @media(max-width:700px){.zo-panel{inset:0;border-radius:0}.zo-main{grid-template-columns:1fr;grid-template-rows:auto 1fr}.zo-side{display:flex;gap:4px;overflow-x:auto;padding:8px;border-right:0;border-bottom:1px solid var(--line)}.zo-side h3{display:none}.zo-side button{white-space:nowrap;width:auto}.zo-table th:nth-child(4),.zo-table td:nth-child(4){display:none}}
  `;
  document.head.appendChild(css);
  const mask = document.createElement('div'); mask.className = 'zo-mask';
  mask.innerHTML = '<div class="zo-panel" role="dialog" aria-modal="true" aria-label="论文库整理"><div class="zo-head"><div><h2>论文库整理</h2><p>文件夹、标签与动态清单保存在当前浏览器</p></div><span class="zo-spacer"></span><button class="zo-btn" data-zo="close" aria-label="关闭">关闭</button></div><div class="zo-main"><nav class="zo-side" aria-label="论文库分类"></nav><div class="zo-content"><div class="zo-tools"><input type="search" aria-label="搜索论文库" placeholder="搜索题名、作者、关键词"><button class="zo-btn" data-zo="new">新建文件夹</button><button class="zo-btn" data-zo="add">加入文件夹</button><button class="zo-btn" data-zo="tag">添加标签</button><button class="zo-btn" data-zo="remove">从当前分类移除</button><button class="zo-btn" data-zo="backup">导出整理数据</button></div><div class="zo-count"></div><div class="zo-list"></div></div></div></div>';
  document.body.appendChild(mask);
  const side = mask.querySelector('.zo-side'), list = mask.querySelector('.zo-list'), count = mask.querySelector('.zo-count');
  const search = mask.querySelector('input[type=search]');
  function save(){ try { localStorage.setItem(key, JSON.stringify(data)); } catch (_) { A.toast('浏览器存储失败，请导出整理数据'); } }
  function button(label, id){ const b=document.createElement('button');b.textContent=label;b.dataset.scope=id;b.setAttribute('aria-current',String(scope===id));side.appendChild(b); }
  function matches(p){
    if(scope==='unread' && A.statusOf(p.id)!=='未阅读')return false;
    if(scope==='read' && !['已初读','已精读'].includes(A.statusOf(p.id)))return false;
    if(scope==='star' && !A.S.star[p.id])return false;
    if(scope==='notes' && !(A.S.notes[p.id]||'').trim())return false;
    if(scope==='doi' && (p.doi||'').trim())return false;
    if(scope.startsWith('c:') && !(data.collections[scope.slice(2)]||[]).includes(p.id))return false;
    if(scope.startsWith('t:') && !(data.tags[p.id]||[]).includes(scope.slice(2)))return false;
    if(scope.startsWith('y:') && String(p.year)!==scope.slice(2))return false;
    if(scope.startsWith('p:') && p.topic!==scope.slice(2))return false;
    const hay=[p.title,p.titleEn,p.titleZh,p.authors,p.keywords,p.year].join(' ').toLowerCase();
    return hay.includes(query);
  }
  function render(){
    side.replaceChildren();button('全部论文 · '+papers.length,'all');
    side.appendChild(Object.assign(document.createElement('h3'),{textContent:'动态清单'}));
    [['未阅读','unread'],['已阅读','read'],['已收藏','star'],['有笔记','notes'],['待补 DOI','doi']].forEach(x=>button(x[0],x[1]));
    side.appendChild(Object.assign(document.createElement('h3'),{textContent:'文件夹'}));
    side.appendChild(Object.assign(document.createElement('div'),{className:'zo-side-hint',textContent:'自建文件夹：勾选论文后点击“新建文件夹”或“加入文件夹”。'}));
    Object.keys(data.collections).sort().forEach(x=>button(x+' · '+data.collections[x].length,'c:'+x));
    side.appendChild(Object.assign(document.createElement('h3'),{textContent:'按主题浏览'}));
    (A.CFG.topics||[]).forEach(x=>button(x.name+' · '+papers.filter(p=>p.topic===x.id).length,'p:'+x.id));
    side.appendChild(Object.assign(document.createElement('h3'),{textContent:'按年份浏览'}));
    [...new Set(papers.map(p=>String(p.year)).filter(Boolean))].sort().reverse().forEach(x=>button('# '+x+' · '+papers.filter(p=>String(p.year)===x).length,'y:'+x));
    side.appendChild(Object.assign(document.createElement('h3'),{textContent:'标签'}));
    side.appendChild(Object.assign(document.createElement('div'),{className:'zo-side-hint',textContent:'自定义标签：勾选论文后点击“添加标签”。'}));
    [...new Set(Object.values(data.tags).flat())].sort().forEach(x=>button('# '+x,'t:'+x));
    const rows=papers.filter(matches);count.textContent=`显示 ${rows.length} / ${papers.length} 篇 · 已选 ${selected.size} 篇`;
    list.replaceChildren();const table=document.createElement('table');table.className='zo-table';
    table.innerHTML='<thead><tr><th><input type="checkbox" aria-label="选择当前结果"></th><th>题名</th><th>年份</th><th>作者 / 标签</th><th>阅读状态</th></tr></thead>';
    const body=document.createElement('tbody');
    rows.forEach(p=>{const tr=document.createElement('tr');const c=document.createElement('input');c.type='checkbox';c.checked=selected.has(p.id);c.dataset.id=p.id;c.setAttribute('aria-label','选择 '+p.title);const td0=document.createElement('td');td0.appendChild(c);tr.appendChild(td0);
      const title=document.createElement('button');title.className='zo-title';title.textContent=p.title||p.id;title.dataset.open=p.id;const td1=document.createElement('td');td1.appendChild(title);tr.appendChild(td1);
      const td2=document.createElement('td');td2.textContent=p.year||'—';tr.appendChild(td2);
      const td3=document.createElement('td');td3.textContent=String(p.authors||'').slice(0,70);const tags=document.createElement('div');tags.className='zo-tags';tags.textContent=['#'+p.year,...(data.tags[p.id]||[]).map(x=>'#'+x)].join(' ');td3.appendChild(tags);tr.appendChild(td3);
      const td4=document.createElement('td');td4.textContent=A.statusOf(p.id);tr.appendChild(td4);body.appendChild(tr);});
    table.appendChild(body);list.appendChild(table);
  }
  function open(){mask.classList.add('open');render();search.focus();}
  function close(){mask.classList.remove('open');}
  const launch=document.createElement('button');launch.type='button';launch.className='zo-launch';launch.textContent='▦ 论文库整理';launch.addEventListener('click',open);
  document.querySelector('.side-foot').prepend(launch);
  mask.addEventListener('click',e=>{if(e.target===mask)close();const z=e.target.dataset.zo;if(z==='close')close();
    if(e.target.dataset.scope){scope=e.target.dataset.scope;render();}
    if(e.target.dataset.open){close();A.openDrawer(e.target.dataset.open);}
    if(e.target.matches('input[data-id]')){e.target.checked?selected.add(e.target.dataset.id):selected.delete(e.target.dataset.id);count.textContent=count.textContent.replace(/已选 \d+ 篇/,'已选 '+selected.size+' 篇');}
    if(e.target.matches('thead input')){list.querySelectorAll('tbody input[data-id]').forEach(x=>{x.checked=e.target.checked;e.target.checked?selected.add(x.dataset.id):selected.delete(x.dataset.id);});render();}
    if(z==='new'){const name=(prompt('新文件夹名称')||'').trim();if(name){if(!data.collections[name])data.collections[name]=[];save();scope='c:'+name;render();}}
    if(z==='add'){if(!selected.size)return A.toast('先选择论文');const names=Object.keys(data.collections);if(!names.length)return A.toast('先新建文件夹');const name=(prompt('加入哪个文件夹？\n'+names.join('、'),names[0])||'').trim();if(!data.collections[name])return A.toast('文件夹不存在');data.collections[name]=[...new Set([...data.collections[name],...selected])];save();render();}
    if(z==='tag'){if(!selected.size)return A.toast('先选择论文');const tag=(prompt('标签名称')||'').trim();if(tag){selected.forEach(id=>data.tags[id]=[...new Set([...(data.tags[id]||[]),tag])]);save();render();}}
    if(z==='remove'){
      if(!selected.size)return A.toast('先选择论文');
      if(scope.startsWith('c:')){const name=scope.slice(2);data.collections[name]=(data.collections[name]||[]).filter(id=>!selected.has(id));save();selected.clear();render();}
      else if(scope.startsWith('t:')){const tag=scope.slice(2);selected.forEach(id=>data.tags[id]=(data.tags[id]||[]).filter(x=>x!==tag));save();selected.clear();render();}
      else A.toast('请先打开文件夹或标签分类');
    }
    if(z==='backup'){const blob=new Blob([JSON.stringify({version:1,collections:data.collections,tags:data.tags},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='文献工作台_论文库整理备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  });
  search.addEventListener('input',()=>{query=search.value.trim().toLowerCase();render();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mask.classList.contains('open'))close();});
})();
