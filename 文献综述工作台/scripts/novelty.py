#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""novelty.py —— 查新：拿你写的一段方案，去公开库里找最像的已有工作。

解决的问题：工作台是「已经读过的论文 → 页面」，而写论文前真正的问题是反向的 ——
「我打算这么做，别人是不是已经做过了」。这个脚本不判断你有没有创新，它只做三件事：
把方案里的关键词抽出来 → 去 Crossref 与 arXiv 各查一遍 → 按关键词覆盖率排个队。

为什么是这两家：都免密钥、都稳定。OpenAlex 与 Semantic Scholar 在部分网络下会返 429，
所以只当补充源，挂了就记一句"源不可用"，不算失败（只查一家源会把一整类论文漏掉，
DOI 核验那次已经踩过一次）。

用法：
  python scripts/novelty.py <项目目录> --draft 我的方案.md [--terms "uav,facade,rgb-t"]
退出码：0 正常 ／ 1 输入不合格（方案太短、抽不出关键词）／ 2 所有源都不可用
"""
import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

UA = ("lit-review-workbench/4.10 "
      "(+https://github.com/yshdidngq-crypto/lit-review-workbench)")
STOP = set("""
the and for with from that this these those are was were been being have has had
using based method methods approach approaches paper papers study studies result results
show shows proposed propose present presents novel new can may not but also such more most
into their they them our we you your its it is are as at by on in to of or an a be do does
two three four five one first second third high low large small good better best
""".split())


def log(msg=""):
    print(msg)


def reconfigure():
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:
            pass


def http(url, timeout=30, accept="application/json"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def words(text):
    return re.findall(r"[A-Za-z][A-Za-z0-9\-]{2,}", text or "")


def focus_terms(text, limit=12):
    """方案里的英文实词，按出现次数排。中文词抽不出来是有意的：
    下面查的是英文库，硬把中文对上英文只能靠猜，猜错比不猜更糟。"""
    cnt = {}
    for w in words(text):
        lw = w.lower().strip("-")
        if len(lw) < 4 or lw in STOP:
            continue
        cnt[lw] = cnt.get(lw, 0) + 1
    ranked = sorted(cnt.items(), key=lambda kv: (-kv[1], -len(kv[0]), kv[0]))
    return [w for w, _ in ranked[:limit]]


def build_queries(terms):
    qs = []
    if len(terms) >= 3:
        qs.append(" ".join(terms[:4]))
        qs.append(" ".join(terms[:6:2]))
    if len(terms) >= 6:
        qs.append(" ".join(terms[:8]))
    out = []
    for q in qs:
        q = q.strip()
        if q and q not in out:
            out.append(q)
    return out[:3]


def date_window(years=5):
    y = datetime.date.today().year
    return "%d-01-01" % (y - years), y


def crossref(q, rows=25, since="2019-01-01"):
    url = ("https://api.crossref.org/works?query.bibliographic=%s&rows=%d"
           "&filter=from-pub-date:%s&select=DOI,title,issued,container-title,abstract,type"
           % (urllib.parse.quote(q), rows, since))
    data = json.loads(http(url).decode("utf-8", "replace"))
    out = []
    for it in (data.get("message") or {}).get("items") or []:
        title = " ".join((it.get("title") or [""])[0].split())
        if not title:
            continue
        year = None
        parts = (it.get("issued") or {}).get("date-parts") or [[None]]
        if parts and parts[0]:
            year = parts[0][0]
        out.append({
            "source": "Crossref",
            "id": "doi:" + (it.get("DOI") or ""),
            "title": title,
            "year": year,
            "venue": " ".join(((it.get("container-title") or [""])[0] or "").split()),
            "doi": it.get("DOI") or "",
            "url": "https://doi.org/" + (it.get("DOI") or ""),
            "abstract": re.sub(r"<[^>]+>", " ", it.get("abstract") or ""),
        })
    return out


def arxiv(q, rows=25):
    url = ("http://export.arxiv.org/api/query?search_query=all:%s"
           "&start=0&max_results=%d&sortBy=relevance" % (urllib.parse.quote(q), rows))
    raw = http(url, accept="application/atom+xml").decode("utf-8", "replace")
    ns = {"a": "http://www.w3.org/2005/Atom"}
    out = []
    root = ET.fromstring(raw)
    for e in root.findall("a:entry", ns):
        title = " ".join((e.findtext("a:title", "", ns) or "").split())
        if not title:
            continue
        pub = e.findtext("a:published", "", ns) or ""
        link = e.findtext("a:id", "", ns) or ""
        out.append({
            "source": "arXiv",
            "id": "arxiv:" + link.rsplit("/", 1)[-1],
            "title": title,
            "year": int(pub[:4]) if pub[:4].isdigit() else None,
            "venue": "arXiv",
            "doi": "",
            "url": link,
            "abstract": " ".join((e.findtext("a:summary", "", ns) or "").split()),
        })
    return out


def norm_title(t):
    return re.sub(r"[^a-z0-9]+", "", (t or "").lower())


def idf_weights(cands, terms):
    """越少见的词越值钱：如果 100 条结果里有 60 条都含 uav，那 uav 基本不算证据。
    不加这一步，一堆 50 分的并列，排序等于没排。"""
    import math
    n = max(1, len(cands))
    w = {}
    for t in terms:
        df = 0
        for c in cands:
            blob = (c["title"] + " " + c.get("abstract", "")).lower()
            if re.search(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])", blob):
                df += 1
        w[t] = 1.0 / (1.0 + math.log(1.0 + df)) if df else 1.0
    return w


def score_of(cand, terms, weights=None):
    weights = weights or {t: 1.0 for t in terms}
    blob = (cand["title"] + " " + cand.get("abstract", "")).lower()
    title = cand["title"].lower()

    def has(t, s):
        return bool(re.search(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])", s))

    hits = [t for t in terms if has(t, blob)]
    title_hits = [t for t in terms if has(t, title)]
    if not terms:
        return 0, [], []
    total = sum(weights.values()) or 1.0
    # 覆盖率：命中了多少词（按 IDF 加权），标题里出现的再补半个权重
    got = sum(weights[t] for t in hits) + 0.5 * sum(weights[t] for t in title_hits)
    return int(round(100 * min(1.0, got / total))), hits, title_hits


def risk_of(score):
    if score >= 70:
        return "overlap"
    if score >= 45:
        return "partial"
    return "clear"


def main():
    reconfigure()
    ap = argparse.ArgumentParser(description="查新：你的方案 vs 公开库里的已有工作")
    ap.add_argument("proj", help="项目目录（要写 data/novelty.json）")
    ap.add_argument("--draft", default="", help="你自己写的那段方案（.md/.txt）")
    ap.add_argument("--topic", action="append", default=[],
                    help="一句话方向，可重复给多条（不想写长方案时用这个）")
    ap.add_argument("--terms", default="", help="手动指定英文关键词，逗号分隔")
    ap.add_argument("--rows", type=int, default=25, help="每个查询每源取多少条（默认 25）")
    ap.add_argument("--years", type=int, default=5, help="只查最近几年（默认 5）")
    ap.add_argument("--recent", type=int, default=2, help="「近期」算最近几年（默认 2）")
    ap.add_argument("--sleep", type=float, default=0.4, help="每次请求之间等待秒数")
    args = ap.parse_args()

    proj = os.path.abspath(args.proj)
    if not os.path.isdir(proj):
        log("找不到项目目录：%s" % proj)
        return 1
    if not args.draft and not args.topic:
        log("要么给一份方案 --draft 方案.md，要么用 --topic \"一句话方向\"（可重复）。")
        return 1
    if args.draft and not os.path.isfile(args.draft):
        log("找不到方案文件：%s" % args.draft)
        return 1

    if args.draft:
        draft = open(args.draft, encoding="utf-8", errors="replace").read()
        src_name = os.path.basename(args.draft)
    else:
        draft = "；".join(t.strip() for t in args.topic if t.strip())
        src_name = "（命令行 --topic）"
    body = re.sub(r"\s+", " ", draft).strip()
    need = 200 if args.draft else 20
    if len(body) < need:
        if args.draft:
            log("方案只有 %d 字，太短了 —— 至少写清楚：做什么、用什么方法、在什么场景、和谁比。" % len(body))
        else:
            log("方向只有 %d 字，太短了 —— 一句话也得说到「做什么 + 什么场景」。" % len(body))
        return 1

    manual = [t.strip().lower() for t in args.terms.split(",") if t.strip()]
    terms = manual if manual else focus_terms(body)
    if not terms:
        log("从方案里抽不出英文关键词。中文方案查英文库，请用 --terms 指定几个英文词，")
        log("例如：--terms \"uav,facade,defect,rgb-t,registration\"")
        return 1

    queries = build_queries(terms)
    log("方案：%d 字" % len(body))
    log("聚焦词（%d）：%s" % (len(terms), "、".join(terms)))
    log("查询 %d 条：%s" % (len(queries), " ｜ ".join(queries)))
    log()

    since, _ = date_window(args.years)
    cands, sources = [], []
    for name, fn in (("Crossref", crossref), ("arXiv", arxiv)):
        got, ok, err = 0, False, ""
        for q in queries:
            try:
                items = fn(q, rows=args.rows, since=since) if name == "Crossref" else fn(q, rows=args.rows)
                got += len(items)
                cands.extend(items)
                ok = True
            except urllib.error.HTTPError as e:
                err = "HTTP %s" % e.code
            except Exception as e:
                err = str(e)[:80]
            time.sleep(args.sleep)
        sources.append({"name": name, "ok": ok, "hits": got, "error": err})
        log("  %-9s %s  %d 条%s" % (name, "✓" if ok else "✗", got, ("（" + err + "）") if err else ""))

    if not any(s["ok"] for s in sources):
        log("\n两个源都不可用（网络问题？）。这次没有查出任何东西，不能当成「没有同类工作」。")
        return 2

    # 去重：同 DOI / 同题名只留一条
    seen, uniq = set(), []
    for c in cands:
        k = c["doi"].lower() if c.get("doi") else norm_title(c["title"])
        if not k or k in seen:
            continue
        seen.add(k)
        uniq.append(c)

    weights = idf_weights(uniq, terms)
    for c in uniq:
        s, hits, thits = score_of(c, terms, weights)
        c["score"] = s
        c["hitTerms"] = hits
        c["titleHits"] = thits
        c["risk"] = risk_of(s)
        c["abstract"] = (c.get("abstract") or "")[:600]

    # 近期：year 只到年，所以按「今年 - N」粗算，够用了
    now_year = datetime.date.today().year
    near = {"overlap": 0, "partial": 0, "clear": 0}
    for c in uniq:
        c["recent"] = bool(c.get("year") and int(c["year"]) >= now_year - args.recent)
        if c["recent"]:
            near[c["risk"]] += 1

    order = {"overlap": 0, "partial": 1, "clear": 2}
    uniq.sort(key=lambda c: (order.get(c["risk"], 3), -c["score"],
                             -(c.get("year") or 0), c["title"]))
    counts = {"overlap": 0, "partial": 0, "clear": 0}
    for c in uniq:
        counts[c["risk"]] += 1

    payload = {
        "generated": datetime.date.today().isoformat(),
        "draft": {"chars": len(body), "head": body[:160], "file": src_name},
        "focus": terms,
        "queries": queries,
        "window": {"since": since, "years": args.years, "recentYears": args.recent},
        "sources": sources,
        "counts": counts,
        "recent": near,
        "candidates": uniq[:60],
        "coverage": {"rawHits": len(cands), "unique": len(uniq), "kept": len(uniq[:60])},
        "caveat": [
            "只查了 Crossref 与 arXiv 这两个公开库。中文库（知网、万方、维普）不在内 —— 中文写的工作这里查不到。",
            "命中多少取决于你那段方案写得像不像一篇论文的摘要；写得越具体，结果越可用。",
            "风险分是三档机械规则（标题与摘要里的关键词覆盖率），不是判断。它只能把最像的几篇摆到你面前，",
            "要不要算撞车，得你自己读过摘要之后决定。",
            "「暂未找到同类」只等于「这两个库里没有」，不等于「你有创新」。",
        ],
    }

    outp = os.path.join(proj, "data", "novelty.json")
    os.makedirs(os.path.dirname(outp), exist_ok=True)
    with open(outp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    log()
    log("命中：可能撞车 %d ／ 部分重合 %d ／ 关系不大 %d（去重后 %d 条）"
        % (counts["overlap"], counts["partial"], counts["clear"], len(uniq)))
    log("其中最近 %d 年：可能撞车 %d ／ 部分重合 %d ／ 关系不大 %d"
        % (args.recent, near["overlap"], near["partial"], near["clear"]))
    log()
    log("最像的 %d 条：" % min(12, len(uniq)))
    for c in uniq[:12]:
        log("  [%2d] %s %s%s" % (c["score"], c.get("year") or "----",
                                 c["title"][:78],
                                 ("  · " + "、".join(c["hitTerms"][:4])) if c["hitTerms"] else ""))
        if c.get("doi"):
            log("        https://doi.org/%s" % c["doi"])
        elif c.get("url"):
            log("        %s" % c["url"])
    log()
    log("已写入：%s" % outp)
    log("下一步：python scripts/build.py <项目目录> —— 侧栏会多出「查新」这一页。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
