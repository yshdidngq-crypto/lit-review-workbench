# -*- coding: utf-8 -*-
"""landscape.py —— 由论文库算出研究现状报告（8 问）

用法：
    python landscape.py <项目目录>

读：
    <项目目录>/data/papers.json
    <项目目录>/config.json
写：
    <项目目录>/data/landscape.json

设计原则（与 SKILL.md 的铁律一致）：
  1. 每个结论都必须能回溯到具体计数。本脚本只在 Python 里做计数与占比，
     headline 里出现的每个数字都来自当前数据，不写死、不估算。
  2. 只描述本批文献。文献库里没有某主题，只能说明"这批样本里没有"，
     不能写成"该方向无人研究"——每一条答案都强制带 caveat 字段。
  3. 算不出来的就写算不出来。数据字段缺失率高时给出 n/a，而不是用 0 填充，
     因为 0 与"未报告"在结论上是两件事。
"""
import collections
import io
import json
import os
import re
import sys

# 结论里反复出现的口径声明。视图层会把它渲染在页面顶部，避免读者误读。
BOUNDARY = [
    "本报告的所有比例，分母都是本批文献总数，不代表学科总量",
    "某主题在本批样本里篇数少，只说明检索与筛选没覆盖到，不能当作学术空白",
    "未报告 ≠ 没有：字段为空表示原文没有给出，不代表该方法不使用该数据集或指标",
    "被引数、影响因子等外部指标不参与本报告的任何判断",
]


def read_json(p, default=None):
    if not os.path.isfile(p):
        return default
    # utf-8-sig：兼容记事本/PowerShell 存出的带 BOM 文件
    return json.loads(io.open(p, encoding="utf-8-sig").read())


def year_of(p):
    """年份容错：接受 2024 / "2024" / "2024 年" / "2024-05"，读不出返回 None。

    原来直接把 p["year"] 丢进 min()/max() 和 `y >= y1 - 2`：
    只要有一篇把年份写成字符串，Q3 就 TypeError 整份报告出不来。
    """
    y = p.get("year")
    if isinstance(y, bool):
        return None
    if isinstance(y, int):
        return y if 1900 <= y <= 2200 else None
    m = re.search(r"(?:19|20)\d{2}", str(y or ""))
    return int(m.group(0)) if m else None


def as_list(v):
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    s = str(v).strip()
    if not s:
        return []
    return [x.strip() for x in re.split(r"[、,，;；/]", s) if x.strip()]


def short_venue(v):
    """期刊名归一：'Information Fusion（Elsevier, Vol. 121…）' → 'Information Fusion'。

    不做归一会把同一刊的不同卷期算成不同来源，来源集中度会严重低估。
    """
    s = (v or "").strip()
    if not s:
        return ""
    s = re.split(r"[（(]", s)[0]
    s = re.split(r"\s+\d", s)[0]
    s = re.split(r"[,，;；]", s)[0]
    return s.strip()[:48]


def short_unit(v):
    s = (v or "").strip()
    if not s:
        return ""
    s = re.split(r"[（(，,;；]", s)[0]
    return s.strip()[:40]


def top(counter, n=None):
    """按 (次数降序, 名称升序) 排序，保证同分时输出顺序稳定可复现。"""
    items = sorted(counter.items(), key=lambda kv: (-kv[1], str(kv[0])))
    return items[:n] if n else items


def share(v, total):
    return round(v * 100.0 / total, 1) if total else 0.0


def hhi(counter, total):
    """赫芬达尔指数（0-1）。用于判断来源/机构是分散还是高度集中。
    集中度高意味着本批文献可能被少数团队或刊物主导，结论外推要更谨慎。"""
    if not total:
        return 0.0
    return round(sum((v / total) ** 2 for v in counter.values()), 3)


def concentration_word(h, n):
    """把 HHI 与「完全均匀」基准 1/n 相比再定性。

    直接拿 HHI 的绝对值下结论会自相矛盾：17 个来源、前 5 个占一半时 HHI 只有 0.076，
    单看数值像"高度分散"，但相对均匀分布（1/17≈0.059）其实已经偏高。归一化后才可比。
    """
    if not n:
        return "无法判断"
    r = h * n          # 1.0 = 完全均匀；数值越大越集中
    if r <= 1.3:
        return "接近均匀"
    if r <= 2.0:
        return "中度分散"
    if r <= 4.0:
        return "较为集中"
    return "高度集中"


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    proj = os.path.abspath(sys.argv[1])
    ddir = os.path.join(proj, "data")
    papers = read_json(os.path.join(ddir, "papers.json"))
    cfg = read_json(os.path.join(proj, "config.json"))
    if not papers:
        print("[失败] data/papers.json 不存在或为空", file=sys.stderr)
        sys.exit(1)
    cfg = cfg or {}

    N = len(papers)
    topic_name = {t["id"]: t["name"] for t in cfg.get("topics", [])}
    topic_color = {t["id"]: t.get("color", "") for t in cfg.get("topics", [])}
    # 主题没配色时按顺序兜底色板 —— 否则 Q1 环形图整张同色，分类维度全丢
    FALLBACK_COLORS = ["#2f6feb", "#0e9c9c", "#c0392b", "#d97706", "#6b4bbd", "#8d9db2",
                       "#1f7a5a", "#b3261e", "#3f3f8f", "#7a4a1f"]
    stage_name = {s["id"]: s["name"] for s in cfg.get("stages", [])}
    stages = cfg.get("stages", [])
    dl_list = cfg.get("dlCategories", [])

    years = [y for y in (year_of(p) for p in papers) if y]
    y0, y1 = (min(years), max(years)) if years else (None, None)

    answers = []

    # ---------------------------------------------------------------- Q1 主题构成
    tc = collections.Counter(p.get("topic") for p in papers if p.get("topic"))
    rows = []
    for i, (tid, v) in enumerate(top(tc)):
        rows.append({"k": tid, "name": topic_name.get(tid, tid), "v": v, "share": share(v, N),
                     "color": topic_color.get(tid, "") or FALLBACK_COLORS[i % len(FALLBACK_COLORS)]})
    lead = rows[0] if rows else None
    answers.append({
        "id": "q1", "no": 1, "kind": "分布",
        "title": "这批文献在研究什么",
        "question": "本批文献的主题构成是怎样的？主要精力压在哪个方向？",
        "headline": ("%d 篇文献分布在 %d 个一级主题上，其中「%s」%d 篇（%.1f%%）为最大类。"
                     % (N, len(rows), lead["name"], lead["v"], lead["share"])) if lead else "本批文献没有标注主题",
        "rows": rows,
        "facts": [
            "主题数 %d 个，平均每主题 %.1f 篇" % (len(rows), N / len(rows)) if rows else "无主题数据",
            "前两类合计占 %.1f%%" % (rows[0]["share"] + rows[1]["share"] if len(rows) > 1 else (rows[0]["share"] if rows else 0)),
            "篇数最少的主题：「%s」%d 篇" % (rows[-1]["name"], rows[-1]["v"]) if rows else "",
        ],
        "chart": "donut",
        "caveat": "主题由整理者按研究问题划分，同一篇若跨两类只计一次，因此分类边界会影响占比。",
    })

    # ---------------------------------------------------------------- Q2 环节覆盖
    sc = collections.Counter()
    for p in papers:
        for s in p.get("stages") or []:
            sc[s] += 1
    srows = []
    for s in stages:
        v = sc.get(s["id"], 0)
        srows.append({"k": s["id"], "name": s["name"], "desc": s.get("desc", ""), "v": v,
                      "share": share(v, N), "thin": v <= max(2, N * 0.08)})
    srows_sorted = sorted(srows, key=lambda r: r["v"])
    thin = [r for r in srows_sorted if r["thin"]]
    dense = [r for r in reversed(srows_sorted) if not r["thin"]][:3]
    answers.append({
        "id": "q2", "no": 2, "kind": "分布",
        "title": "研究集中在哪些技术环节",
        "question": "整条技术链路上，哪一步方法最多、哪一步几乎没人做？",
        "headline": ("方法最密集的是「%s」（%d 篇）；有 %d 个环节在本批中不超过 %d 篇。"
                     % (dense[0]["name"], dense[0]["v"], len(thin), max(2, int(N * 0.08))) if dense
                     else "技术环节字段缺失，无法判断"),
        "rows": srows,
        "facts": ["环节总数 %d 个" % len(stages),
                  "覆盖最多的三个环节：%s" % ("、".join("%s(%d)" % (r["name"], r["v"]) for r in dense) or "无"),
                  "覆盖最少的三个环节：%s" % ("、".join("%s(%d)" % (r["name"], r["v"]) for r in srows_sorted[:3]) or "无")],
        "chart": "hbars",
        "caveat": ("环节篇数少只说明本批文献在这段链路上样本薄，不能推断该环节在学界无人研究。"
                   "若要判断真伪空白，必须做外部检索验证（见「外部文献」页）。"),
    })

    # ---------------------------------------------------------------- Q3 时间趋势
    yc = collections.Counter(years)
    yrows = [{"k": str(y), "v": yc[y], "share": share(yc[y], N)} for y in sorted(yc)]
    recent = sum(v for y, v in yc.items() if y1 and y >= y1 - 2)
    answers.append({
        "id": "q3", "no": 3, "kind": "趋势",
        "title": "时间上的变化",
        "question": "这批文献的时间跨度如何？近年是否在加速？",
        "headline": ("跨度 %s—%s 年，近三年（%d—%d）共 %d 篇，占 %.1f%%。"
                     % (y0, y1, (y1 - 2), y1, recent, share(recent, N))) if y0 else "年份字段缺失",
        "rows": yrows,
        "facts": ["最早 %s 年，最晚 %s 年" % (y0, y1) if y0 else "无年份",
                  "年度最多：%s" % ("、".join("%s 年 %d 篇" % (y, v) for y, v in top(yc, 2)) or "无"),
                  "有 %d 篇缺少年份" % (N - len(years))],
        "chart": "timeline",
        "caveat": "本批文献由检索与筛选产生，时间分布既有领域趋势的成分，也有选文偏好的成分，两者不可分离。",
    })

    # ---------------------------------------------------------------- Q4 方法派别
    dc = collections.Counter(p.get("dl") for p in papers if p.get("dl"))
    undecided = dc.get("无法确定", 0)
    drows = [{"k": k, "v": v, "share": share(v, N)} for k, v in top(dc)]
    cross = []
    for tid, _ in top(tc):
        row = {"k": tid, "name": topic_name.get(tid, tid), "cells": []}
        for dl in dl_list:
            row["cells"].append({"k": dl, "v": sum(1 for p in papers if p.get("topic") == tid and p.get("dl") == dl)})
        cross.append(row)
    # 头条句不能写死「传统方法 %d 篇」：占最多的一类本身可能就是传统方法，
    # 那样会印出「传统方法 5 篇；传统方法 5 篇」。改为按实际第一名分两支。
    trad = dc.get("传统方法", 0)
    if not drows:
        q4_head = "方法类型字段缺失"
    elif drows[0]["k"] == "传统方法":
        q4_head = ("传统方法 %d 篇（%.1f%%），是本批篇数最多的一类；其余派别合计 %d 篇；"
                   "另有 %d 篇无法从原文判定方法类型。"
                   % (trad, share(trad, N), max(0, N - trad - undecided), undecided))
    else:
        q4_head = ("%s占 %d 篇（%.1f%%）；传统方法 %d 篇；另有 %d 篇无法从原文判定方法类型。"
                   % (drows[0]["k"], drows[0]["v"], drows[0]["share"], trad, undecided))
    answers.append({
        "id": "q4", "no": 4, "kind": "结构",
        "title": "方法派别的分布",
        "question": "深度学习与传统方法各占多少？派别是否与主题绑定？",
        "headline": q4_head,
        "rows": drows,
        "cross": cross,
        "dlCols": dl_list,
        "facts": ["方法类型共 %d 类" % len(drows),
                  "深度学习类合计 %d 篇" % sum(v for k, v in dc.items() if "深度" in str(k)),
                  "「无法确定」%d 篇，占 %.1f%%（这部分不能计入任何一派的份额）" % (undecided, share(undecided, N))],
        "chart": "matrix",
        "caveat": ("「无法确定」不是缺失，而是原文没有给出足以判定的信息；把它按深度学习或传统方法硬分，"
                   "会系统性地夸大某一派的比例。"),
    })

    # ---------------------------------------------------------------- Q5 数据基础
    dst = collections.Counter()
    ds_ids = collections.defaultdict(list)   # 数据集 -> 用到它的论文 id，供页面直接列"哪几篇"
    for p in papers:
        for d in as_list(p.get("datasets")):
            dst[d] += 1
            ds_ids[d].append(p.get("id"))
    no_ds = sum(1 for p in papers if not as_list(p.get("datasets")))
    code = sum(1 for p in papers if p.get("hasCode"))
    code_ids = [p.get("id") for p in papers if p.get("hasCode")]
    no_ds_ids = [p.get("id") for p in papers if not as_list(p.get("datasets"))]
    # 哪些数据集是公开可获取的，由项目作者在 config.json 的 publicDatasets 里声明。
    # 脚本不猜：名字看起来像公开数据集，不等于它真的可以下载。
    public_ds = set(cfg.get("publicDatasets") or [])
    drow = [{"k": k, "v": v, "share": share(v, N), "ids": ds_ids[k],
             "public": (k in public_ds) if public_ds else None}
            for k, v in top(dst, 10)]
    answers.append({
        "id": "q5", "no": 5, "kind": "基础",
        "title": "数据集可视化分析",
        "question": "主流数据集是哪些？有没有公认基准？开源比例如何？",
        "headline": ("共出现 %d 个数据集，出现最多的是「%s」（%d 篇）；%d 篇本次未抽到数据集"
                     "（原文未报告或只读了摘要）；%d 篇有开源代码（%.1f%%）。"
                     % (len(dst), (drow[0]["k"] if drow else "无"), (drow[0]["v"] if drow else 0),
                        no_ds, code, share(code, N))),
        "rows": drow,
        # 三个清单直接在页面上列出来，读者不用再去数据库里搜
        "codeIds": code_ids,
        "codeCount": code,
        "noDsIds": no_ds_ids,
        "noDsCount": no_ds,
        "facts": ["数据集去重后 %d 个" % len(dst),
                  "只被 1 篇使用的数据集 %d 个（自建或小规模采集居多）" % sum(1 for v in dst.values() if v == 1),
                  "本次未抽到数据集 %d 篇，占 %.1f%%（含原文未报告与本次只读摘要两种情况）" % (no_ds, share(no_ds, N)),
                  "有开源代码 %d 篇，占 %.1f%%" % (code, share(code, N))],
        "chart": "hbars",
        "caveat": ("数据集名称按原文写法统计，同一数据集的不同子集或不同年份版本可能被计为两个名字。"
                   "「本次未抽到」既可能是原文没报告，也可能是本次只读了摘要 —— "
                   "当这一项占比很高时，它反映的是抽取深度，不能读成「该领域不用公开数据集」。"),
    })

    # ---------------------------------------------------------------- Q6 评价指标
    mc = collections.Counter()
    for p in papers:
        for m in as_list(p.get("metrics")):
            mc[m.upper()] += 1
    no_metric = sum(1 for p in papers if not as_list(p.get("metrics")))
    # 原来的 Q6「怎么证明有效」已删除：指标口径分散这件事，读者看 Q10 的分类饼图即可，
    # 单独一页条形图对"该读哪篇"没有决策价值。统计量保留给 Q10 用。

    # ---------------------------------------------------------------- Q7 发表阵地
    vc = collections.Counter(short_venue(p.get("venue")) for p in papers if short_venue(p.get("venue")))
    hv = hhi(vc, sum(vc.values()))
    top5 = top(vc, 5)
    answers.append({
        "id": "q6", "no": 6, "kind": "集中度",
        "title": "论文发表分布",
        "question": "发表阵地是集中还是分散？本批文献是否被少数刊物主导？",
        "headline": ("涉及 %d 个刊物/会议，前 5 个占 %.1f%%，集中度指数 %.3f（%s）。"
                     % (len(vc), share(sum(v for _, v in top5), sum(vc.values())), hv, concentration_word(hv, len(vc))))
        if vc else "出处字段缺失",
        "rows": [{"k": k, "v": v, "share": share(v, sum(vc.values()))} for k, v in top(vc, 10)],
        "facts": ["去重后来源 %d 个" % len(vc),
                  "只出现 1 篇的来源 %d 个" % sum(1 for v in vc.values() if v == 1),
                  "集中度指数按赫芬达尔法计算，1 表示全部来自同一来源"],
        "chart": "hbars",
        "caveat": "来源集中度高时，本批文献的方法与结论可能共享同一批作者的偏好，外推时要打折。",
    })

    # ---------------------------------------------------------------- Q8 研究力量
    uc = collections.Counter(short_unit(p.get("unit")) for p in papers if short_unit(p.get("unit")))
    hu = hhi(uc, sum(uc.values()))
    answers.append({
        "id": "q7", "no": 7, "kind": "集中度",
        "title": "集中发表单位",
        "question": "研究力量是分散还是聚集在少数团队？",
        "headline": ("涉及 %d 个单位，前 5 个占 %.1f%%，集中度指数 %.3f（%s）。"
                     % (len(uc), share(sum(v for _, v in top(uc, 5)), sum(uc.values())), hu, concentration_word(hu, len(uc))))
        if uc else "单位字段缺失",
        "rows": [{"k": k, "v": v, "share": share(v, sum(uc.values()))} for k, v in top(uc, 10)],
        "facts": ["去重后单位 %d 个" % len(uc),
                  "只出现 1 篇的单位 %d 个" % sum(1 for v in uc.values() if v == 1),
                  "首作者单位按原文首个机构统计，合作论文只计入第一单位"],
        "chart": "hbars",
        "caveat": "单位名未做归一（同一学校的不同学院会算作不同单位），因此实际集中度不低于此处数值。",
    })

    # ---------------------------------------------------------------- Q10 论文质量标记
    # 原来的 Q9「已经形成的共识」已删除：它回答的是"哪组数据集+指标被反复采用"，
    # 但 Q5 已经把数据集讲清楚，指标又不是这批文献的决策依据，单独一页没人会用来做决定。
    #
    # 一篇论文可能同时有多种问题，而饼图要求互斥，所以只按「最重的一类」归入。
    # 顺序即严重度：数据异常 > 置信度低 > 未报告数据集 > 未报告指标 > 无开源代码。
    # 这样各类之和恰好等于总篇数，百分比可以直接读，不会出现加不到 100% 的情况。
    Q_ORDER = [
        ("数据异常", "var(--bad)"),
        ("置信度低", "var(--warn)"),
        ("未抽到数据集", "var(--violet)"),
        ("未抽到指标", "var(--accent2)"),
        ("无开源代码", "var(--accent)"),
        ("无标记", "var(--ok)"),
    ]

    def worst_flag(p):
        if any((p.get("flags") or {}).values()):
            return "数据异常"
        if p.get("evidence") == "低":
            return "置信度低"
        if not as_list(p.get("datasets")):
            return "未抽到数据集"
        if not as_list(p.get("metrics")):
            return "未抽到指标"
        if not p.get("hasCode"):
            return "无开源代码"
        return "无标记"

    qc = collections.Counter(worst_flag(p) for p in papers)
    qrows = [{"k": name, "v": qc[name], "share": share(qc[name], N), "color": col}
             for name, col in Q_ORDER if qc.get(name)]
    # 颜色按严重度定，但扇区按篇数从大到小排 —— 否则"占比最高"会指向 2 篇那一类
    qrows.sort(key=lambda r: -r["v"])
    q_top = qrows[0] if qrows else {"k": "无", "v": 0}
    answers.append({
        "id": "q8", "no": 8, "kind": "风险",
        "title": "论文质量标记分布",
        "question": "哪些条目的可靠性需要打问号？",
        "headline": ("%d 篇文献中，占比最高的是「%s」%d 篇（%.1f%%）；共出现 %d 类标记。"
                     % (N, q_top["k"], q_top["v"], share(q_top["v"], N), len(qrows))),
        "rows": qrows,
        "facts": ["按最重的一类归类，每篇只计一次，合计等于 %d 篇" % N,
                  "数据异常 %d 篇，逐条说明见「待审核数据」" % qc.get("数据异常", 0),
                  "无开源代码合计 %d 篇（含已被归入其他类别的）" % (N - code)],
        "chart": "donut",
        "caveat": ("这是本批文献的元数据完整度，不是对论文水平的评价。"
                   "「未抽到」只表示本次没有从原文取到该字段，既可能原文没写，也可能只读了摘要 —— "
                   "它衡量的是抽取结果，不是文献质量；一篇同时有多项问题时只计入最重的一类。"),
    })

    out = {
        "generated": __import__("datetime").date.today().isoformat(),
        "scope": {
            "paperCount": N,
            "yearFrom": y0, "yearTo": y1,
            "topicCount": len(tc), "stageCount": len(stages),
            "venueCount": len(vc), "unitCount": len(uc),
        },
        "boundary": BOUNDARY,
        "answers": answers,
    }
    io.open(os.path.join(ddir, "landscape.json"), "w", encoding="utf-8", newline="\n").write(
        json.dumps(out, ensure_ascii=False, indent=1))

    print("研究现状报告：%d 问 / %d 篇文献 / %s—%s 年" % (len(answers), N, y0, y1))
    for a in answers:
        print("  Q%-2d %-16s %s" % (a["no"], a["title"], a["headline"][:74]))
    print("\n输出：" + os.path.join(ddir, "landscape.json"))

    # 档位阈值是按本批分数手工定的，改过分数最容易忘记重定；这里直接给建议值。
    rels = sorted(x for x in (p.get("relevance") for p in papers) if isinstance(x, (int, float)))
    if rels:
        def q(frac):
            return round(rels[min(len(rels) - 1, int(len(rels) * frac))])
        print("\n档位建议（按本批 relevance 分位数重定 config.bands[].min）：")
        print("  核心≥%d ｜ 高度≥%d ｜ 中度≥%d ｜ 间接≥%d ｜ 外围<%d"
              % (q(0.90), q(0.70), q(0.45), q(0.20), q(0.20)))
        cur = " / ".join("%s≥%s" % (b.get("name"), b.get("min")) for b in (cfg.get("bands") or []))
        if cur:
            print("  当前：%s" % cur)


if __name__ == "__main__":
    main()
