# -*- coding: utf-8 -*-
"""link.py —— 研究方向与外部文献的双向关联（含结构校验）

用法：
    python link.py <项目目录> [--min-overlap 2]

读：
    <项目目录>/data/directions.json    研究方向树（由 Agent 撰写，本脚本不改写正文）
    <项目目录>/data/external.json      外部推荐文献（discover.py 产出）
    <项目目录>/data/papers.json        本地论文库（用于算方向的本库支撑度）
写：
    <项目目录>/data/directions.json    补 derived 字段（不改 name/problem 等人工内容）
    <项目目录>/data/external.json      补 directionIds / directionMatch

为什么关联要单独一步：
    关联是"方向 ↔ 文献"的双向关系，任何一侧改动都要同步另一侧。如果把匹配算在
    Agent 的脑子里，每次重跑都会得到不一致的两份数据，页面上就会看到"方向说有 5 篇，
    文献页只显示 3 篇"这种自相矛盾。这里用确定性的术语重合算法算一次，两侧写死。

关联算法的边界（必须写在报告里，不能省）：
    * 只做术语重合，不做语义理解。方向名里出现"融合"、论文标题里出现"fusion"才连上；
    * 因此会漏掉同义表述（如 direction 写"辐射一致性"、论文写 radiometric calibration）；
    * 因此会误连泛词（"image""method"这类词已被停用表挡掉）；
    * 匹配结果只用于"建议读哪些"，不构成"该方向已有 N 篇支撑"的学术判断。
"""
import argparse
import io
import json
import os
import re
import sys

# 泛词表：这些词在任何一篇论文里都常见，参与匹配只会制造虚假关联
STOP = set("""a an the of for and or with in on to from by via using based towards toward
study studies method methods approach approaches paper we our this that are is was were
analysis research new novel result results experimental experiments system systems
image images data model models deep learning network networks application applications
review survey detection detection-based framework frameworks""".split())

# 方向侧也要过滤的泛词（中文方向名里的通用词）
STOP_ZH = set("""研究 方法 技术 分析 应用 基于 面向 一种 改进 优化 新 型 及其 相关 问题
系统 框架 模型 算法 数据 图像 检测 识别 处理 实现 设计 的 与 和 及 在 对""".split())

DOI_RE = re.compile(r"^10\.\d{4,9}/[^\s]+$")

REQUIRED_DIR = ["id", "level", "name", "oneLine", "problem", "whyOpportunity",
                "keywords", "techRoute", "minExperiment", "expectedOutput"]
REQUIRED_EXT = ["id", "title", "sourceDatabase", "accessStatus"]


def read_json(p, default=None):
    if not os.path.isfile(p):
        return default
    # utf-8-sig：兼容记事本/PowerShell 存出的带 BOM 文件
    return json.loads(io.open(p, encoding="utf-8-sig").read())


def terms_of(s):
    """英文词干化到前缀 5 字符，容忍复数与派生：registration/register → regis。"""
    out = set()
    for t in re.findall(r"[A-Za-z][A-Za-z\-]{2,}", (s or "").lower()):
        t = t.strip("-")
        if t in STOP or len(t) < 3:
            continue
        out.add(t[:5] if len(t) > 5 else t)
    return out


def zh_terms_of(s):
    """中文按 2-3 字切片。不做分词是为了避免引入词典依赖，代价是会有少量无意义切块，
    这些切块因为两边都命中不了而自然失效，不会产生假关联。"""
    out = set()
    s = re.sub(r"[^\u4e00-\u9fa5]+", " ", s or "")
    for seg in s.split():
        for n in (2, 3):
            for i in range(0, max(0, len(seg) - n + 1)):
                w = seg[i:i + n]
                if w not in STOP_ZH:
                    out.add(w)
    return out


def dir_terms(d):
    """方向的身份只由「名称 + 一句话 + 关键词」决定。

    不能把 problem / whyOpportunity 也算进来：这两段是几百字的论证散文，
    里面必然反复出现 registration、facade、fusion 这类领域词，会让每个方向都
    命中几乎所有文献，父方向一次挂上十几篇，关联就失去了区分度。
    """
    bag = " ".join([d.get("name", ""), d.get("oneLine", ""),
                    " ".join(d.get("keywords") or [])])
    return terms_of(bag) | zh_terms_of(bag)


def ext_terms(e):
    bag = " ".join([e.get("title", ""), e.get("abstract", ""), e.get("venue", "")])
    return terms_of(bag) | zh_terms_of(bag)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("proj")
    ap.add_argument("--min-overlap", type=int, default=3,
                    help="方向与文献的术语重合数下限，低于此值不关联（默认 3）")
    ap.add_argument("--strict", action="store_true", help="校验失败时以非零码退出")
    a = ap.parse_args()

    proj = os.path.abspath(a.proj)
    ddir = os.path.join(proj, "data")
    dirs = read_json(os.path.join(ddir, "directions.json"))
    ext = read_json(os.path.join(ddir, "external.json"), [])
    papers = read_json(os.path.join(ddir, "papers.json"), [])

    if dirs is None:
        print("[失败] 缺少 data/directions.json", file=sys.stderr)
        sys.exit(1)
    if isinstance(dirs, dict):
        dirs = dirs.get("directions") or dirs.get("items") or []

    errors, warns = [], []
    by_dir = {}
    for d in dirs:
        for k in REQUIRED_DIR:
            if k not in d or d[k] in (None, "", []):
                errors.append("方向 %s 缺少字段 %s" % (d.get("id", "?"), k))
        if d.get("id") in by_dir:
            errors.append("方向 id 重复：%s" % d.get("id"))
        by_dir[d.get("id")] = d

    # 父节点必须存在，且层级必须比父节点大 1
    for d in dirs:
        pid = d.get("parentId")
        if pid:
            if pid not in by_dir:
                errors.append("方向 %s 的 parentId=%s 不存在" % (d["id"], pid))
            else:
                if d.get("level") != (by_dir[pid].get("level") or 0) + 1:
                    errors.append("方向 %s 的 level=%s 与父节点 %s 的 level=%s 不匹配"
                                  % (d["id"], d.get("level"), pid, by_dir[pid].get("level")))
        elif d.get("level") != 1:
            errors.append("方向 %s 没有 parentId，但 level=%s（顶层必须是 1）" % (d["id"], d.get("level")))

    n_l1 = sum(1 for d in dirs if d.get("level") == 1)
    if n_l1 < 3:
        warns.append("一级主题只有 %d 个，需求要求 3–6 个" % n_l1)
    if n_l1 > 6:
        warns.append("一级主题 %d 个，超过 6 个，页面会显得零散" % n_l1)

    # ---------------------------------------------------------------- 外部文献校验
    pids = {p.get("id") for p in papers}
    bad_doi, no_score = [], []
    for e in ext:
        for k in REQUIRED_EXT:
            if k not in e or e[k] in (None, ""):
                errors.append("外部文献 %s 缺少字段 %s" % (e.get("id", "?"), k))
        doi = (e.get("doi") or "").strip()
        if doi and not DOI_RE.match(doi):
            bad_doi.append((e.get("id"), doi))
        if "score" not in e or "total" not in (e.get("score") or {}):
            no_score.append(e.get("id"))
    if bad_doi:
        errors.append("有 %d 条 DOI 格式不合法（DOI 只能来自检索结果的原始字段，不允许手写）：%s"
                      % (len(bad_doi), "；".join("%s=%s" % x for x in bad_doi[:5])))
    if no_score:
        warns.append("有 %d 条外部文献缺少六维打分明细，页面上无法解释推荐理由" % len(no_score))

    # ---------------------------------------------------------------- 父子关系
    children = {}
    for d in dirs:
        if d.get("parentId"):
            children.setdefault(d["parentId"], []).append(d["id"])
    is_container = {d["id"] for d in dirs if d.get("level") == 1 and children.get(d["id"])}

    # ---------------------------------------------------------------- 本库支撑度
    rel_of = {p.get("id"): (p.get("relevance") or 0) for p in papers}
    for d in dirs:
        ids = [x for x in (d.get("localPaperIds") or []) if x]
        missing = [x for x in ids if x not in pids]
        if missing:
            errors.append("方向 %s 引用了不存在的论文 id：%s" % (d["id"], "、".join(missing[:5])))
        keep = [x for x in ids if x in pids]
        d["_localIds"] = keep

    # 父方向的支撑度取自己与全部子方向的并集。否则会出现"子方向 3 篇、父方向 2 篇"
    # 这种读者无法理解的口径倒挂。
    for d in dirs:
        if d["id"] in is_container:
            seen = list(d["_localIds"])
            for kid in children.get(d["id"], []):
                for x in by_dir[kid].get("_localIds") or []:
                    if x not in seen:
                        seen.append(x)
            d["_localIds"] = seen
    for d in dirs:
        keep = d.pop("_localIds")
        rel = [rel_of[x] for x in keep]
        d["localSupport"] = {
            "count": len(keep),
            "avgRelevance": round(sum(rel) / len(rel), 1) if rel else 0,
            "paperIds": keep,
        }

    # ---------------------------------------------------------------- 双向关联
    # 两步：先让"可独立成立"的方向（二级方向，以及没有子方向的一级方向）直接匹配；
    # 再让有子方向的一级方向聚合其结果。父方向是容器，不参与词面匹配——否则
    # 一个父方向会把所有含"融合""配准"的论文全揽过来，父子两级的口径必然打架。
    dt = {d["id"]: dir_terms(d) for d in dirs}
    per_paper = []
    for e in ext:
        et = ext_terms(e)
        hits = []
        for d in dirs:
            if d["id"] in is_container:
                continue
            shared = dt[d["id"]] & et
            if len(shared) >= a.min_overlap:
                hits.append((d["id"], len(shared), sorted(shared)[:6]))
        hits.sort(key=lambda x: -x[1])
        # 只保留与最强命中接近的方向：命中数不到最佳的一半就丢掉。
        # 否则一篇综述会被挂到六七个方向上，看起来"处处相关"，实际等于没关联。
        if hits:
            best = hits[0][1]
            hits = [h for h in hits if h[1] * 2 >= best][:3]
        per_paper.append((e, hits))

    for e, hits in per_paper:
        e["directionIds"] = [h[0] for h in hits]
        e["directionMatch"] = [{"directionId": h[0], "overlap": h[1], "sharedTerms": h[2]} for h in hits]

    # 父方向聚合：把子方向的命中并起来，并标记来源，页面上可以解释"这 12 篇来自哪几个子方向"
    for d in dirs:
        if d["id"] not in is_container:
            continue
        kids = children.get(d["id"], [])
        union, from_kid = [], {}
        for e, hits in per_paper:
            hit_kids = [h[0] for h in hits if h[0] in kids]
            if hit_kids:
                union.append((e, max(h[1] for h in hits if h[0] in kids)))
                from_kid[e["id"]] = hit_kids
        union.sort(key=lambda x: -((x[0].get("score") or {}).get("total") or 0))
        d["_aggIds"] = [e["id"] for e, _ in union]
        d["_aggFrom"] = from_kid

    # 方向侧反向写入，保证两份数据自洽（页面才能双向跳转）
    ext_by_id = {e["id"]: e for e in ext}
    for d in dirs:
        agg_from = d.pop("_aggFrom", None) if d["id"] in is_container else None
        agg_ids = d.pop("_aggIds", None) if d["id"] in is_container else None
        if d["id"] in is_container:
            got = [ext_by_id[i] for i in (agg_ids or []) if i in ext_by_id]
            d["externalLinkMode"] = "aggregated"
        else:
            got = [e for e in ext if d["id"] in (e.get("directionIds") or [])]
            d["externalLinkMode"] = "direct"
        got.sort(key=lambda e: -((e.get("score") or {}).get("total") or 0))
        d["externalEvidence"] = {
            "count": len(got),
            "recommendedExternalIds": [e["id"] for e in got],
            "inLocalLibrary": sum(1 for e in got if e.get("alreadyInLocalLibrary")),
        }
        if agg_from:
            d["externalEvidence"]["fromChildren"] = agg_from
        # 机会分：创新潜力为主，外部同类工作越多越拥挤，拥挤度反向扣分。
        # 权重写死在这里，是为了同一份数据每次重算得到同一个数。
        novel = float(d.get("novelty") or 50)
        mature = float(d.get("maturity") or 50)
        crowd = min(1.0, len(got) / 8.0)
        opp = 0.40 * novel + 0.30 * (100 - mature) + 0.30 * (100 * (1 - crowd))
        d["derived"] = {
            "opportunityScore": round(opp, 1),
            "crowdedness": round(crowd * 100),
            "localCount": d["localSupport"]["count"],
            "externalCount": len(got),
        }
        # 风险：两边都没人做过时，风险最高（可能是做不出来，而不是没人想到）
        if d["localSupport"]["count"] == 0 and len(got) == 0:
            d["derived"]["riskNote"] = "本库与外部检索都没有命中，需先确认该方向是否可行，再投入时间"
        elif d["localSupport"]["count"] == 0:
            d["derived"]["riskNote"] = "本库无支撑，但外部已有工作，说明可行；属于补齐型方向"
        elif len(got) == 0:
            d["derived"]["riskNote"] = "本库有支撑但外部未命中，可能是检索词没覆盖，不宜直接判为空白"
        else:
            d["derived"]["riskNote"] = ""

    # ---------------------------------------------------------------- 落盘
    if errors:
        print("\n[校验失败] 共 %d 处：\n" % len(errors))
        for e in errors:
            print("  - " + e)
        if a.strict:
            sys.exit(2)
        print("\n未写回文件。修正后重跑。")
        return

    io.open(os.path.join(ddir, "directions.json"), "w", encoding="utf-8", newline="\n").write(
        json.dumps(dirs, ensure_ascii=False, indent=1))
    if ext:
        io.open(os.path.join(ddir, "external.json"), "w", encoding="utf-8", newline="\n").write(
            json.dumps(ext, ensure_ascii=False, indent=1))

    print("方向树：%d 个（一级 %d 个）" % (len(dirs), n_l1))
    for d in dirs:
        if d.get("level") != 1:
            continue
        kids = [x for x in dirs if x.get("parentId") == d["id"]]
        print("  %s %s（子方向 %d 个）" % (d["id"], d["name"], len(kids)))
    print("\n外部文献 %d 篇，其中 %d 篇关联到至少一个方向"
          % (len(ext), sum(1 for e in ext if e.get("directionIds"))))
    orphan_dir = [d["id"] for d in dirs if d.get("level") > 1 and not (d.get("externalEvidence") or {}).get("count")]
    if orphan_dir:
        print("  无外部文献关联的子方向 %d 个：%s" % (len(orphan_dir), "、".join(orphan_dir)))
    if warns:
        print("\n提示：")
        for w in warns:
            print("  - " + w)
    print("\n已写回 directions.json 与 external.json")


if __name__ == "__main__":
    main()
