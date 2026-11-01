# -*- coding: utf-8 -*-
"""
build.py —— 把「配置 + 论文数据 + 视图」打成单文件离线 HTML

用法：
    python build.py <项目目录>

项目目录结构（标准）：
    <项目目录>/
      config.json            项目配置：主题体系、技术环节、评分档位、预设、模块列表
      data/papers.json       论文数组（字段契约见 reference/01_数据契约.md）
      data/meta.json         可选：统计声明、薄弱环节、生成时间
      src/views.js           可选：视图层（定义 window.VIEWS），不写就用通用骨架
      src/tabs.js            可选：详情页标签（定义 window.TABS），不写就用通用标签
      dist/                  输出目录（自动创建）

本脚本只负责拼装，不做任何业务判断。资产文件（css/charts/ui/core/bind）从
本 Skill 的 assets/ 目录读取，不会被项目内同名文件覆盖 —— 这是视觉一致性的保证。
"""
import io
import json
import os
import re
import sys
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
ASSETS = os.path.join(SKILL, "assets")

def read(p):
    # utf-8-sig：Windows 上记事本 / PowerShell 存出的 JSON 常带 BOM，
    # 用纯 utf-8 读会直接抛 JSONDecodeError，对新手等于"莫名其妙坏了"。
    return io.open(p, encoding="utf-8-sig").read()


def fail(msg):
    print("\n[构建失败] " + msg, file=sys.stderr)
    sys.exit(1)


def jd(v):
    """把数据塞进 <script> 前先转义 "</"。

    JSON 字符串里若出现 "</script>"，浏览器会提前闭合脚本块，整页数据截断；
    "<\\/" 在 JSON 里与 "</" 等价，解析后内容不变。
    """
    return json.dumps(v, ensure_ascii=False).replace("</", "<\\/")


def esc_html(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


# ---------------------------------------------------------------- 校验配置
REQUIRED_CFG = ["project", "topics", "views"]
REQUIRED_PAPER = ["id", "title", "topic", "relevance", "learning", "difficulty"]


def check(proj):
    cfgp = os.path.join(proj, "config.json")
    pp = os.path.join(proj, "data", "papers.json")
    if not os.path.isfile(cfgp):
        fail("缺少 config.json：" + cfgp)
    if not os.path.isfile(pp):
        fail("缺少 data/papers.json：" + pp)

    cfg = json.loads(read(cfgp))
    for k in REQUIRED_CFG:
        if k not in cfg:
            fail("config.json 缺少必填字段：%s" % k)

    papers = json.loads(read(pp))
    if not isinstance(papers, list) or not papers:
        fail("papers.json 必须是非空数组")

    ids = set()
    bad = []
    for i, p in enumerate(papers):
        for k in REQUIRED_PAPER:
            if k not in p or p[k] in (None, ""):
                bad.append("第 %d 条（%s）缺少字段 %s" % (i + 1, p.get("id", "?"), k))
        if p.get("id") in ids:
            bad.append("重复的 id：%s" % p.get("id"))
        ids.add(p.get("id"))
        if p.get("topic") and p["topic"] not in [t["id"] for t in cfg["topics"]]:
            bad.append("%s 的 topic=「%s」不在 config.topics 中" % (p.get("id"), p.get("topic")))
    if bad:
        print("\n[数据校验发现问题] 共 %d 处：\n" % len(bad))
        for b in bad[:40]:
            print("  - " + b)
        if len(bad) > 40:
            print("  … 另有 %d 处" % (len(bad) - 40))
        fail("请先修正数据，再重新构建")

    # 视图文件（V4.8 起可选）
    # 以前缺 src/views.js 直接失败。可这一层的绝大部分是跨项目一模一样的拼装代码，
    # 逼每个项目重写一遍既费额度又长 bug。现在两者都可以不写：
    # 缺了就注入空声明，由 assets/views.base.js 的通用骨架补上。
    # 但"写了却没导出"仍然要拦 —— 那是真写错了，不是选择不写。
    vp = os.path.join(proj, "src", "views.js")
    tp = os.path.join(proj, "src", "tabs.js")
    if os.path.isfile(vp) and 'window.VIEWS' not in read(vp):
        fail("src/views.js 存在，但没有 window.VIEWS，视图不会渲染")
    if os.path.isfile(tp) and 'window.TABS' not in read(tp):
        fail("src/tabs.js 存在，但没有 window.TABS，详情标签不会渲染")
    return cfg, papers


# ---------------------------------------------------------------- 数据质量体检
def quality_report(papers, cfg):
    """构建期顺带体检：只提示、不阻断。

    check() 管的是"能不能构建"，这里管的是"建出来会不会是错的"。
    两者必须分开：字段缺失是硬错误（页面会崩），数据可疑是软提醒
    （页面照常渲染，但结论会错，只能靠人看）。
    """
    today = datetime.date.today().year
    issues = []   # 多半是错的，值得改
    notes = []    # 可能是有意为之，只提示

    def ids(lst, cap=8):
        shown = [str(p.get("id") or p.get("title") or "?") for p in lst[:cap]]
        more = "" if len(lst) <= cap else " 等 %d 篇" % len(lst)
        return "、".join(shown) + more

    # 1) 整条没有正文：只有题名和打分，进来就是凑数的
    thin = [p for p in papers
            if not any((p.get(k) or "").strip() for k in ("overview", "method", "conclusion"))]
    if thin:
        issues.append("%d 篇整条没有正文（overview/method/conclusion 全空）：%s" % (len(thin), ids(thin)))

    # 2) 年份不可信：非整数、或明显越界（1900—明年之外）
    ybad = []
    for p in papers:
        y = p.get("year")
        if y in (None, ""):
            continue
        if isinstance(y, bool) or not re.fullmatch(r"\s*\d{4}\s*", str(y)):
            ybad.append(p)
            continue
        yi = int(str(y).strip())
        if yi < 1900 or yi > today + 1:
            ybad.append(p)
    if ybad:
        issues.append("%d 篇年份可疑（非四位数或越界）：%s" % (len(ybad), ids(ybad)))

    # 3) 档位与 relevance 对不上：bands 阈值是手工定的，改分后最容易忘同步
    bands = [b for b in (cfg.get("bands") or [])
             if isinstance(b, dict) and isinstance(b.get("min"), (int, float))]
    if bands:
        bands = sorted(bands, key=lambda b: -b["min"])
        mis = []
        for p in papers:
            r, b = p.get("relevance"), p.get("band")
            if not isinstance(r, (int, float)) or not b:
                continue
            exp = next((x.get("name") for x in bands if r >= x["min"]), bands[-1].get("name"))
            if b != exp:
                mis.append(p)
        if mis:
            # 这里是**软提示**：band 允许是人工勾的档位（demo 就是如此，24/24 条都不按
            # 分数机械换算）。只有当人是想让它跟着分数走、却忘了重定阈值时才该改。
            notes.append("%d 篇的 band 与 relevance 阈值推算不一致（若档位是人工勾的可忽略；"
                         "若是按分数自动落档，说明改过分数没重定 bands）：%s"
                         % (len(mis), ids(mis)))

    # 4) 题名重复：同一篇被算成两篇，所有占比都会偏
    def norm(t):
        return re.sub(r"[\s\W_]+", "", str(t or "")).lower()

    seen, dup = {}, []
    for p in papers:
        k = norm(p.get("title"))
        if k and k in seen:
            dup.append(p)
        seen.setdefault(k, p)
    if dup:
        issues.append("%d 篇题名与已有条目重复（应合并进 mergedIds）：%s" % (len(dup), ids(dup)))

    # 5) 字段类型：datasets/metrics/stages 必须是数组。
    #    写成字符串时页面不会报错，但"导出笔记"里 p.metrics.join() 会抛异常，
    #    表现成"点了导出没反应" —— 属于最难查的一类问题，必须在构建期点出来。
    typed = []
    for p in papers:
        for k in ("datasets", "metrics", "stages"):
            v = p.get(k)
            if v not in (None, "") and not isinstance(v, list):
                typed.append(p)
                break
        else:
            for k in ("keywords", "authors"):
                v = p.get(k)
                if v is not None and not isinstance(v, str):
                    typed.append(p)
                    break
    if typed:
        issues.append("%d 篇字段类型不符（datasets/metrics/stages 要数组、keywords/authors 要字符串）：%s"
                      " —— 字符串型 metrics 会让「导出笔记」静默失败" % (len(typed), ids(typed)))

    if not issues and not notes:
        return
    if issues:
        print("\n[数据质量] 发现 %d 类可疑数据。构建继续，但这些会直接影响页面结论：" % len(issues))
        for s in issues:
            print("  - " + s)
        print("  交付前请逐条确认；validate.js 的「数据质量」一项也会再查一遍。")
    if notes:
        print("\n[数据质量] 提示（通常可忽略）：")
        for s in notes:
            print("  - " + s)


# ---------------------------------------------------------------- 主流程
def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    proj = os.path.abspath(sys.argv[1])
    if not os.path.isdir(proj):
        fail("项目目录不存在：" + proj)

    cfg, papers = check(proj)
    quality_report(papers, cfg)

    meta = {}
    mp = os.path.join(proj, "data", "meta.json")
    if os.path.isfile(mp):
        meta = json.loads(read(mp))
    meta.setdefault("count", len(papers))
    meta.setdefault("generated", datetime.date.today().isoformat())

    # --- V3.0 可选数据源。缺文件就注入空值，页面自动隐藏对应模块，
    #     而不是构建失败 —— 只有本地文献的项目也应该能用。
    opt = {}
    for key, fn, empty in [
        ("LANDSCAPE", "landscape.json", None),
        ("DIRECTIONS", "directions.json", []),
        ("EXTERNAL", "external.json", []),
        ("SESSION", "search_session.json", None),
        # V4.10 查新：你的方案 vs 公开库里的已有工作。没有这份文件就没有这一页。
        ("NOVELTY", "novelty.json", None),
        ("EXTERNAL_CANDIDATES", "external_candidates.json", []),
        # V4.0 工程思维实验室。没有这份文件的项目照旧能用，只是不显示这一页。
        ("LAB", "lab.json", None),
    ]:
        p = os.path.join(proj, "data", fn)
        opt[key] = json.loads(read(p)) if os.path.isfile(p) else empty

    # --- V4.7 工程实验室改为「用户自选」
    # 以前只要 data/lab.json 存在就自动长出这一页，等于替用户做了决定。
    # 这一页是辅助学习模块（把方向拆成可执行模块、四级解释、失败案例），
    # 仍在开发中、内容生成耗额度较多，对只想要一份文献工作台的人是纯负担。
    # 所以改成显式开关：命令行 --with-lab，或 config.json 里 "features": {"lab": true}。
    # 两者都没给 → 不启用；但要打印一行提示，让人知道"有这个东西、怎么开"。
    # 本包不含工程实验室：lab.js / lab.json 都已移除，三种开关都不再起作用。
    lab_on = False
    if opt["LAB"] and not lab_on:
        print("提示：检测到 data/lab.json，但未启用「工程实验室」。")
        print("      该页是辅助学习模块，仍在开发中、生成耗额度较多，默认不启用。")
        print("      需要它就加命令行参数 --with-lab，或在 config.json 写 "
              "\"features\": {\"lab\": true}。")
    if not lab_on:
        opt["LAB"] = None

    # --- 资产 ---
    # 顺序：基础样式 → KaTeX 样式（含 base64 字体）→ 公式覆盖层。
    # 覆盖层必须放最后，否则 KaTeX 自己的 .katex 字号规则会盖掉它。
    # V4.9：可选主题层。config.layout.theme = "swiss" 时在最后追加 swiss.css（只覆盖变量与形状，
    # 不动任何结构类名），所以换主题不会影响任何视图的正确性。
    theme = ((cfg.get("layout") or {}).get("theme") or "").strip().lower()
    css_parts = [
        read(os.path.join(ASSETS, "base.css")),
        read(os.path.join(ASSETS, "katex.css")),
        read(os.path.join(ASSETS, "math.css")),
    ]
    if theme == "swiss":
        css_parts.append(read(os.path.join(ASSETS, "swiss.css")))
    css = "\n".join(css_parts)
    # 注入顺序有强依赖，不可调换：
    #   katex 先于 math.js（后者要用 window.katex）；
    #   charts/ui 提供绘图与构件 → core 依赖它们 → views/tabs 依赖三者 → bind 依赖 core 的 APP
    seq = [
        ("assets/katex.min.js", os.path.join(ASSETS, "katex.min.js")),
        ("assets/charts.js", os.path.join(ASSETS, "charts.js")),
        ("assets/ui.js", os.path.join(ASSETS, "ui.js")),
        ("assets/app.core.js", os.path.join(ASSETS, "app.core.js")),
        # V4.8 通用骨架：十一个视图 + 九个详情标签的通用实现，锁死。
        # 放在 src/views.js 之前 —— 项目里写过的同名项会覆盖它，没写的直接用通用版；
        # 合并语句由下面的 MERGE 表在 src/views.js 之后插入。
        ("assets/views.base.js", os.path.join(ASSETS, "views.base.js")),
        ("src/views.js", os.path.join(proj, "src", "views.js")),
        # lab.js 放在 views.js 之后：视图层若自己实现了 VIEWS.lab，会被这里接管；
        # 放在 tabs 与 bind 之前：它要在 APP 就绪后才执行（APP 在 app.core.js 末尾导出）。
        # V4.7：工程实验室是可选模块，只有用户明确选了才注入 —— 不选就不占体积。
        ("assets/lab.js", os.path.join(ASSETS, "lab.js")),
        # V4.11 通用标签底座：和视图同理，项目写过的覆盖它，没写的用它。
        ("assets/tabs.base.js", os.path.join(ASSETS, "tabs.base.js")),
        ("src/tabs.js", os.path.join(proj, "src", "tabs.js")),
        ("assets/app.bind.js", os.path.join(ASSETS, "app.bind.js")),
        # math.js 最后：它只定义 afterRender 与 MutationObserver，等 APP 全都就绪再挂
        ("assets/math.js", os.path.join(ASSETS, "math.js")),
    ]
    if not lab_on:
        seq = [(label, path) for label, path in seq if path != os.path.join(ASSETS, "lab.js")]
    # V4.8：内容层从「必须写」改成「可选覆盖」。
    # 以前 src/views.js 缺一行就崩，等于逼着每个项目重写一千多行胶水代码；
    # 现在缺文件注入一段空声明，后面的合并语句会把通用骨架接上。
    STUB = {
        os.path.join(proj, "src", "views.js"):
            "/* 本项目没有写 src/views.js：视图全部使用 assets/views.base.js 的通用版。 */\n"
            "window.VIEWS = window.VIEWS || {};",
        os.path.join(proj, "src", "tabs.js"):
            "/* 本项目没有写 src/tabs.js：详情标签全部使用通用版。 */\n"
            "window.TABS = window.TABS || {};",
    }
    MERGE = {
        os.path.join(proj, "src", "views.js"):
            "/* ==== 合并：项目视图覆盖通用骨架 ==== */\n"
            "window.VIEWS = Object.assign({}, window.VIEWS_BASE || {}, window.VIEWS || {});",
        os.path.join(proj, "src", "tabs.js"):
            "/* ==== 合并：项目标签覆盖通用标签 ==== */\n"
            "window.TABS = Object.assign({}, window.TABS_BASE || {}, window.TABS || {});",
    }
    # V4.11：项目层也包进函数作用域。底座与项目层各自独立，同名顶层变量（topicName、
    # REVIEW_FIELD、clip …）互不干扰；项目层照旧只写 window.VIEWS.xxx = function。
    def _wrap(body):
        return ("/* == IIFE 起点 == */\n(function () {\n'use strict';\n"
                + body.rstrip("\n") + "\n\n})();\n/* == IIFE 终点 == */\n")

    blobs = []
    for label, path in seq:
        if os.path.isfile(path):
            body = read(path)
        elif path in STUB:
            body = STUB[path]
            print("提示：没有 %s —— 这一层使用通用骨架。" % os.path.relpath(path, proj))
        else:
            fail("缺少必需文件：%s" % path)
        if path in (os.path.join(proj, "src", "views.js"), os.path.join(proj, "src", "tabs.js")) \
                and os.path.isfile(path):
            body = _wrap(body)
        blobs.append("/* ==== %s ==== */\n%s" % (label, body))
        if path in MERGE:
            blobs.append(MERGE[path])
    app = "\n\n".join(blobs)

    # --- 侧栏菜单：给数据就长出入口，没数据就摘掉 ---
    # 和上面"缺文件注入空值"是同一条规则的两半：数据缺失不该让构建失败（页面自己
    # 隐藏模块），但也不该在侧栏留一个点进去空白的死入口。反过来，放了数据却没有
    # 入口，用户根本点不进去（视图有、入口无 = 死页）。
    # V4.5 之前只有 lab 享受这条规则，其余四页要用户手改 config.json 才会出现；
    # 照抄骨架 config 的新手因此只看到 6 个菜单，哪怕 data/ 里已经放好了
    # landscape.json —— 从外面看就像"这套 Skill 只做了一半"。现在五页统一。
    # 必须在 json.dumps(cfg) 之前改，否则注入进页面的 LIT_CONFIG 仍是旧的。
    NAV_AUTO = [
        ("landscape", "LANDSCAPE",  "研究现状",   "◎"),
        ("explore",   "DIRECTIONS", "方向探索",   "⑂"),
        ("lab",       "LAB",        "工程实验室", "⚙"),
        ("novelty",   "NOVELTY",    "查新",       "◈"),
        ("external",  "EXTERNAL",   "外部文献",   "⊕"),
        ("session",   "SESSION",    "检索记录",   "⌗"),
    ]
    # 内置视图的标准落位顺序（lab 紧跟方向探索，与 demo 一致）
    NAV_ORDER = ["dash", "landscape", "map", "explore", "novelty", "lab", "external",
                 "db", "cmp", "decide", "prog", "session"]
    nav_added, nav_dropped = [], []
    if isinstance(cfg.get("views"), list):
        cfg = dict(cfg)
        by_id, seq_ids = {}, []
        for v in cfg["views"]:
            if isinstance(v, dict) and v.get("id"):
                by_id.setdefault(v["id"], v)
                seq_ids.append(v["id"])
        for vid, key, name, icon in NAV_AUTO:
            if bool(opt[key]):
                if vid not in by_id:
                    by_id[vid] = {"id": vid, "name": name, "icon": icon, "desc": ""}
                    nav_added.append(name)
            elif vid in by_id:
                by_id.pop(vid)
                nav_dropped.append(name)
        if "lab" in by_id and isinstance(opt["LAB"], dict):
            nav = opt["LAB"].get("nav") or {}
            if nav.get("name"):
                by_id["lab"]["name"] = nav["name"]
            if nav.get("icon"):
                by_id["lab"]["icon"] = nav["icon"]
            # 页面副标题一律留空：五个标签页的名字已经说明了这一页干什么，
            # 再写一句"把研究方向拆成可执行模块…"只是复述。
            by_id["lab"]["desc"] = nav.get("desc") or ""
        if all(i in NAV_ORDER for i in by_id):
            # 全是内置页：按标准顺序落位，新手不必手调。
            ids = [i for i in NAV_ORDER if i in by_id]
        else:
            # 掺了自定义视图：保留用户自己的顺序，只把新增项插到前序内置页之后。
            ids = [i for i in seq_ids if i in by_id]
            for i in NAV_ORDER:
                if i in by_id and i not in ids:
                    at = next((ids.index(j) + 1 for j in NAV_ORDER[:NAV_ORDER.index(i)]
                               if j in ids), len(ids))
                    ids.insert(at, i)
        cfg["views"] = [by_id[i] for i in ids]

    data = ("window.LIT_CONFIG=%s;\nwindow.LIT_PAPERS=%s;\nwindow.LIT_META=%s;\n"
            "window.LIT_LANDSCAPE=%s;\nwindow.LIT_DIRECTIONS=%s;\nwindow.LIT_EXTERNAL=%s;\n"
            "window.LIT_SESSION=%s;\nwindow.LIT_EXTERNAL_CANDIDATES=%s;\nwindow.LIT_LAB=%s;\n"
            "window.LIT_NOVELTY=%s;") % (
        jd(cfg),
        jd(papers),
        jd(meta),
        jd(opt["LANDSCAPE"]),
        jd(opt["DIRECTIONS"]),
        jd(opt["EXTERNAL"]),
        jd(opt["SESSION"]),
        jd(opt["EXTERNAL_CANDIDATES"]),
        jd(opt["LAB"]),
        jd(opt["NOVELTY"]),
    )
    # V4.9：图表配色盘。config.layout.palette 优先；瑞士主题给一套十色印刷盘。
    pal = (cfg.get("layout") or {}).get("palette")
    if not pal and theme == "swiss":
        pal = ["#d93a1f", "#1b4d8f", "#2f6b46", "#8a5a00", "#6b2f6b",
               "#0f6d7a", "#b3261e", "#3f3f8f", "#7a4a1f", "#1f7a5a"]
    if pal:
        data = "window.CHART_PALETTE = %s;\n" % json.dumps(pal, ensure_ascii=False) + data

    # --- 骨架 ---
    tpl = read(os.path.join(ASSETS, "index.tpl.html"))
    if theme == "swiss":
        tpl = tpl.replace('<html lang="zh-CN" data-theme="light">',
                          '<html lang="zh-CN" data-theme="light" class="swiss">')
    pr = cfg["project"]
    # V4.6.1：LOGO_SUB（logo 副标题）与 SIDE_SRC（侧栏底部数据来源行）的占位符
    # 已从骨架删除，config 里的 subtitle / dataSource 不再上页面，这里不再替换。
    tpl = (tpl
           .replace("/*__PAGE_TITLE__*/", esc_html(pr.get("pageTitle") or pr.get("name") or "文献工作台"))
           .replace("/*__LOGO_MARK__*/", esc_html(pr.get("mark") or "LT"))
           .replace("/*__LOGO_T1__*/", esc_html(pr.get("nameLine1") or pr.get("name") or "文献"))
           .replace("/*__LOGO_T2__*/", esc_html(pr.get("nameLine2") or "工作台"))
           .replace("/*__CSS__*/", css)
           .replace("/*__DATA__*/", data)
           .replace("/*__APP__*/", app))

    out_dir = os.path.join(proj, "dist")
    os.makedirs(out_dir, exist_ok=True)
    name = (pr.get("short") or "workbench") + "_文献工作台.html"
    out = os.path.join(out_dir, name)
    io.open(out, "w", encoding="utf-8", newline="\n").write(tpl)

    size = os.path.getsize(out)
    print("论文数量：%d 篇" % len(papers))
    print("主题体系：%d 类 / 技术环节：%d 个" % (len(cfg["topics"]), len(cfg.get("stages", []))))
    if theme == "swiss":
        print("版式主题：瑞士风格（swiss.css，多色图表盘 %d 色）" % len(pal or []))

    # 内容层来源：让作者一眼看出"这一版有几个页面是我自己写的"。
    # 全用通用骨架不是坏事，但必须说清楚 —— 页面里的措辞是通用的，不会替你说项目的话。
    def _ids(text, pat):
        return set(re.findall(pat, text))

    base_v = _ids(read(os.path.join(ASSETS, "views.base.js")), r"VIEWS_BASE\.(\w+)\s*=")
    base_t = _ids(read(os.path.join(ASSETS, "tabs.base.js")), r"TABS_BASE\.(\w+)\s*=")
    # 工程实验室是独立资产：它自己实现 VIEWS.lab，也算"不由项目提供"。
    if lab_on:
        base_v = base_v | _ids(read(os.path.join(ASSETS, "lab.js")), r"VIEWS\.(\w+)\s*=")
    proj_v, proj_t = set(), set()
    pv = os.path.join(proj, "src", "views.js")
    if os.path.isfile(pv):
        s = read(pv)
        proj_v = _ids(s, r"VIEWS\.(\w+)\s*=") | _ids(s, r"VIEWS\[\s*['\"](\w+)['\"]\s*\]\s*=")
    pt = os.path.join(proj, "src", "tabs.js")
    if os.path.isfile(pt):
        s = read(pt)
        proj_t = _ids(s, r"TABS\.(\w+)\s*=") | _ids(s, r"TABS\[\s*['\"](\w+)['\"]\s*\]\s*=")
    want_v = [v.get("id") for v in cfg.get("views", []) if isinstance(v, dict)]
    covered_v = [i for i in want_v if i in proj_v]
    generic_v = [i for i in want_v if i not in proj_v and i in base_v]
    missing_v = [i for i in want_v if i not in proj_v and i not in base_v]
    print("内容层：视图 %d 个 —— 项目自己写 %d 个%s，通用骨架 %d 个%s" % (
        len(want_v), len(covered_v),
        ("（" + "、".join(covered_v) + "）") if covered_v else "",
        len(generic_v),
        ("（" + "、".join(generic_v) + "）") if generic_v else ""))
    if missing_v:
        print("      注意：这些视图既没写也没有通用版，会显示占位提示：" + "、".join(missing_v))
    want_t = [t.get("id") for t in (cfg.get("detailTabs") or []) + (cfg.get("extTabs") or [])
              if isinstance(t, dict)]
    if want_t:
        cov_t = [i for i in want_t if i in proj_t]
        gen_t = [i for i in want_t if i not in proj_t and i in base_t]
        print("内容层：详情标签 %d 个 —— 项目自己写 %d 个，通用骨架 %d 个" % (
            len(want_t), len(cov_t), len(gen_t)))
    if opt["DIRECTIONS"]:
        print("研究方向：%d 个（一级 %d 个）" % (
            len(opt["DIRECTIONS"]), sum(1 for d in opt["DIRECTIONS"] if d.get("level") == 1)))
    if opt["EXTERNAL"]:
        print("外部推荐文献：%d 篇（候选池 %d 篇）" % (len(opt["EXTERNAL"]), len(opt["EXTERNAL_CANDIDATES"])))
    if opt["LAB"]:
        print("工程实验室：%d 个模块 / %d 个算法 / %d 个学习单元 / %d 个失败模式" % (
            len(opt["LAB"].get("modules") or []), len(opt["LAB"].get("algorithms") or []),
            len(opt["LAB"].get("learning") or []), len(opt["LAB"].get("failures") or [])))
    if opt["LANDSCAPE"]:
        print("研究现状报告：%d 问" % len(opt["LANDSCAPE"].get("answers") or []))
    print("侧栏菜单：%d 个 —— %s" % (
        len(cfg["views"]), " / ".join(v.get("name") or v.get("id") for v in cfg["views"])))
    # 实验室是唯一"不会因为放了数据就自动出现"的一页，提示必须和这条规则一致，
    # 否则日志会告诉用户"无需手改 config"，与 V4.7 的实际行为相反。
    if "工程实验室" in nav_added and lab_on:
        nav_added.remove("工程实验室")
        why = "--with-lab" if "--with-lab" in sys.argv else "config.features.lab"
        print("  已启用：工程实验室（%s 显式打开）" % why)
    if nav_added:
        # 说出"为什么多出来"，否则用户会以为 config 被偷偷改了。
        print("  自动加入：%s（data/ 里检测到对应数据，无需手改 config.json）" % "、".join(nav_added))
    if nav_dropped:
        print("  未显示：%s（data/ 里没有对应数据）" % "、".join(nav_dropped))
    print("输出：%s" % out)
    print("大小：%.2f MB" % (size / 1024 / 1024))
    print("\n下一步：node validate.js \"%s\"" % out)


if __name__ == "__main__":
    main()
