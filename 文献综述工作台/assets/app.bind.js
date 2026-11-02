/* ============================================================================
 * app.bind.js —— 事件绑定与初始化（锁死文件，请勿改写）
 * ----------------------------------------------------------------------------
 * 视图层不要自己 addEventListener。所有交互走统一的 data-* 约定，
 * 由本文件一处接管，这样不同人写的视图行为完全一致。
 *
 * 视图层可用的 data-* 约定：
 *   data-act="open"   data-val="论文ID"        打开详情抽屉
 *   data-act="nav"    data-val="视图ID"        切换视图
 *   data-act="topic"  data-val="主题ID"        按一级主题筛选
 *   data-act="stage"  data-val="环节ID"        按技术环节筛选
 *   data-act="year"   data-val="2024"          按年份筛选
 *   data-act="status" data-val="已精读"         按阅读状态筛选
 *   data-act="band"   data-val="核心相关"       按相关档位筛选
 *   data-act="tag"    data-dim="标签维度键" data-val="值"   按额外标签维度筛选
 *   data-act="clear"                          清空全部筛选
 *   data-act="export-note" data-val="论文ID"   把这篇的题录 + 我的笔记导出成一份 txt
 *   data-preset="预设ID"                       应用预设
 *   data-sort="排序键"                         切换排序
 *   data-mode="cards|table"                   切换列表形态
 *   data-dtab="标签ID"                         详情页切换标签（由 core 处理）
 *   data-f="q|relMin|learnMin|diffMin|diffMax|pageSize"   表单字段
 *
 * V3.0 追加：
 *   data-act="dir-open" data-val="方向ID"      选中方向并跳到方向探索页
 *   data-act="state" data-k="状态键" data-val="值"        直接写 S[状态键]
 *       加 data-toggle="1" 时按数组开关（用于多选），加 data-clear="1" 时置空
 *       这是为了避免每加一个筛选维度就往本文件里塞一个 if 分支。
 *
 * V4.0 追加：
 *   data-act="obj-set" data-k="labStat" data-id="M3" data-val="进行中"
 *       写对象里的一个键：S[状态键][id] = 值。加 data-toggle="1" 时该键是数组，
 *       同一值再点一次即移除（用于适用性自检这种多选）。
 *   data-save-store="labNote" data-store-id="M3"   （按钮）
 *       把同 key 的 <textarea data-store="labNote" data-store-id="M3"> 内容写进
 *       S.labNote.M3。故意不整页重渲染——重渲染会让正在输入的光标丢焦点。
 * ========================================================================== */

(function () {
  const A = window.APP;

  /* 详情抽屉重画：改完阅读状态后，当前那个标签页要跟着刷 ——
     否则按钮高亮还停在旧值上，人看到的就是"点了没反应"。
     标签栏在 #drawerHead [data-dtab]，选中的那个带 .on。 */
  function refreshDrawerTab() {
    try {
      const on = document.querySelector('#drawerHead [data-dtab].on');
      if (!on) return;
      const id = on.getAttribute('data-dtab');
      if (id && A && A.showTab) A.showTab(id);
    } catch (e) { /* 抽屉没开或已关：忽略 */ }
  }

  function onClick(e) {
    const el = e.target.closest('[data-act],[data-chip],[data-preset],[data-sort],[data-mode],[data-page],[data-view]');
    if (!el) return;
    const act = el.dataset.act;

    // 导航（侧栏按钮也带 data-view）
    if (el.dataset.view) { A.go(el.dataset.view); return; }

    if (el.dataset.preset) { A.applyPreset(el.dataset.preset); return; }
    if (el.dataset.sort) { A.S.sort = el.dataset.sort; A.S.page = 1; A.saveState(); A.render(); return; }
    if (el.dataset.mode) { A.S.mode = el.dataset.mode; A.S.page = 1; A.saveState(); A.render(); return; }
    if (el.dataset.page) { A.S.page = Number(el.dataset.page) || 1; A.render(); return; }
    if (el.dataset.chip) { A.toggleIn(el.dataset.chip, el.dataset.val); return; }

    if (act === 'open') { A.openDrawer(el.dataset.val); return; }
    if (act === 'nav') { A.go(el.dataset.val); return; }
    if (act === 'clear') { A.S.filters = A.defaultFiltersPublic(); A.S.page = 1; A.render(); return; }
    if (act === 'topic') { A.toggleIn('topic', el.dataset.val); return; }
    if (act === 'stage') { A.toggleIn('stage', el.dataset.val); return; }
    if (act === 'year') { A.toggleIn('year', String(el.dataset.val)); return; }
    if (act === 'status') { A.toggleIn('status', el.dataset.val); return; }
    if (act === 'band') { A.toggleIn('bands', el.dataset.val); return; }
    if (act === 'tag') {
      const dim = el.dataset.dim;
      const cur = (A.S.filters.extra[dim] = A.S.filters.extra[dim] || []);
      const i = cur.indexOf(el.dataset.val);
      if (i >= 0) cur.splice(i, 1); else cur.push(el.dataset.val);
      A.S.page = 1; A.render(); return;
    }
    if (act === 'star') {
      A.S.star[el.dataset.val] = !A.S.star[el.dataset.val]; A.saveState(); A.render(); return;
    }
    if (act === 'status-set') {
      A.S.status[el.dataset.val] = el.dataset.status;
      A.saveState(); A.render(); refreshDrawerTab(); return;
    }
    /* 表格里那一列状态是可以点的：点一下切到下一档。为什么不是下拉框？
       读一篇论文最多点两三下，下拉框要点两次还得对准，反而更慢。 */
    if (act === 'status-next') {
      const list = (A.STATUS && A.STATUS.length) ? A.STATUS : ['未阅读'];
      const cur = A.statusOf(el.dataset.val);
      const i = list.indexOf(cur);
      A.S.status[el.dataset.val] = list[(i + 1) % list.length];
      A.saveState(); A.render(); refreshDrawerTab(); return;
    }
    if (act === 'export-note') { A.exportNote(el.dataset.val); return; }

    /* ---- V3.0 ---- */
    if (act === 'dir-open') { A.openDir(el.dataset.val); return; }
    if (act === 'state') {
      // 通用状态写入。三种语义：
      //   data-clear="1"        → 把该键置为空值（'' 或 {}，取决于原类型）
      //   data-toggle="1"       → 数组/Counter 开关（同一值再点一次即移除）
      //   默认                   → 直接赋值
      const k = el.dataset.k;
      const v = el.dataset.val;
      if (el.dataset.clear === '1') {
        A.S[k] = Array.isArray(A.S[k]) ? [] : '';
      } else if (el.dataset.toggle === '1') {
        if (Array.isArray(A.S[k])) {
          const i = A.S[k].indexOf(v);
          if (i >= 0) A.S[k].splice(i, 1); else A.S[k].push(v);
        } else {
          A.S[k] = A.S[k] === v ? '' : v;
        }
      } else {
        A.S[k] = v;
      }
      A.saveState(); A.render(); return;
    }
    if (act === 'obj-set') {
      const k = el.dataset.k, id = el.dataset.id || '', v = el.dataset.val;
      if (!A.S[k] || typeof A.S[k] !== 'object') A.S[k] = {};
      if (el.dataset.clear === '1') { A.S[k][id] = []; A.saveState(); A.render(); return; }
      if (el.dataset.toggle === '1') {
        const cur = Array.isArray(A.S[k][id]) ? A.S[k][id] : [];
        const i = cur.indexOf(v);
        if (i >= 0) cur.splice(i, 1); else cur.push(v);
        A.S[k][id] = cur;
      } else {
        A.S[k][id] = v;
      }
      A.saveState(); A.render(); return;
    }
    /* 布尔翻转：点一下置 1，再点回 0。用于「确认/取消确认」这类单值开关，
       比 obj-set 的数组 toggle 更省一个 data-val。 */
    if (act === 'obj-flip') {
      const k = el.dataset.k, id = el.dataset.id || '';
      if (!A.S[k] || typeof A.S[k] !== 'object') A.S[k] = {};
      A.S[k][id] = A.S[k][id] ? 0 : 1;
      A.saveState(); A.render(); return;
    }
  }

  function onChange(e) {
    const el = e.target;
    const f = el.dataset.f;
    if (!f) return;
    const v = el.type === 'checkbox' ? el.checked : el.value;
    if (['relMin', 'learnMin', 'diffMin', 'diffMax'].indexOf(f) >= 0) A.S.filters[f] = Number(v);
    else if (f === 'pageSize') A.S.pageSize = Number(v);
    else if (f === 'sort') A.S.sort = v;
    else A.S.filters[f] = v;
    A.S.page = 1;
    A.render();
  }

  function onInput(e) {
    const el = e.target;
    if (el.id === 'globalSearch') {
      A.S.filters.q = el.value;
      A.S.page = 1;
      clearTimeout(onInput._h);
      onInput._h = setTimeout(() => A.render(), 180);
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') { A.closeDrawer(); return; }
    if (e.key === 'Enter' && e.target.id === 'globalSearch') { A.go('db'); }
  }

  function init() {
    // 侧栏注入导航项（若骨架里已写死则跳过）
    const nav = document.getElementById('nav');
    if (nav && !nav.children.length) {
      (A.CFG.views || []).forEach((v, i) => {
        const b = document.createElement('button');
        b.dataset.view = v.id;
        b.type = 'button';
        if (i === 0) { b.className = 'on'; b.setAttribute('aria-current', 'page'); }
        // count:true 的视图在右侧显示一个计数字段，由 updateChrome 填值。
        // 计数容器的 id 统一是 nav-c-<viewId>，不要另起名字。
        b.innerHTML = `<span class="ic">${v.icon || '·'}</span><span class="tx">${v.name}</span>`
          + (v.count ? `<span class="cnt" id="nav-c-${v.id}"></span>` : '');
        nav.appendChild(b);
      });
    }

    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) themeBtn.addEventListener('click', () => A.applyTheme(A.S.theme === 'dark' ? 'light' : 'dark'));

    const reset = document.getElementById('btnReset');
    if (reset) reset.addEventListener('click', () => { A.S.filters = A.defaultFiltersPublic(); A.S.page = 1; A.render(); A.toast('已重置筛选'); });

    const mask = document.getElementById('drawerMask');
    if (mask) mask.addEventListener('click', () => A.closeDrawer());

    document.addEventListener('click', e => {
      if (e.target.id === 'drawerClose') { A.closeDrawer(); return; }
      // 笔记保存（详情页「我的笔记」标签）
      if (e.target.id === 'btnSaveNote') {
        const id = e.target.dataset.noteId;
        const box = document.getElementById('noteBox');
        if (id && box) {
          A.S.notes[id] = box.value;
          A.saveState();
          const h = document.getElementById('noteHint');
          if (h) h.textContent = box.value.trim() ? '已保存 ' + box.value.length + ' 字' : '尚未写笔记';
          A.toast('笔记已保存');
        }
        return;
      }
      /* V4.0：通用文本保存。按钮 + 同 key 的 textarea，不重渲染以免丢焦点。 */
      const sv = e.target.closest('[data-save-store]');
      if (sv) {
        const k = sv.dataset.saveStore, id = sv.dataset.storeId || '';
        const box = document.querySelector('[data-store="' + k + '"][data-store-id="' + id + '"]');
        if (!box) { A.toast('找不到输入框'); return; }
        if (!A.S[k] || typeof A.S[k] !== 'object') A.S[k] = {};
        A.S[k][id] = box.value;            // 空字符串也照存，代表"我清空了"
        A.saveState();
        const hint = document.querySelector('[data-store-hint="' + id + '"]');
        if (hint) {
          const n = String(box.value || '').trim().length;
          hint.textContent = n ? '已保存 ' + n + ' 字' : '已清空';
          hint.style.color = 'var(--ok)';
        }
        A.toast(box.value.trim() ? '已保存到本机浏览器' : '已清空');
        // 需要立刻用这段文字重算结果的地方（如逆向诊断）再刷一次页面。
        if (sv.dataset.thenRender === '1') A.render();
        return;
      }
      const dt = e.target.closest('[data-dtab]');
      if (dt) { A.showTab(dt.dataset.dtab); return; }
      onClick(e);
    });
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);

    A.loadStatePublic();
    A.applyTheme(A.S.theme);
    A.go((A.CFG.views && A.CFG.views[0] && A.CFG.views[0].id) || 'dash');

    // 首次打开：若没有任何本地记录，提示一次用法
    if (!localStorage.getItem((A.CFG.lsKey || 'lit-workbench-v1') + ':seen')) {
      setTimeout(() => A.toast('提示：右侧文献可点击打开详情，笔记与进度会自动保存在本机浏览器'), 700);
      try { localStorage.setItem((A.CFG.lsKey || 'lit-workbench-v1') + ':seen', '1'); } catch (e) {}
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
