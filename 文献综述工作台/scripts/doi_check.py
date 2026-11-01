#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DOI 注册核验（V4.8.3）。

为什么要这一步：`link.py` 只做「文献侧与方向侧的字段配对」，它不问一句
「这个 DOI 在 DOI 注册中心里到底存在吗」。于是一个手抄错的 DOI、或者
从别处顺手套过来的 DOI，会在页面上安静地挂着，点开是 404 —— 而整页
看起来毫无异常。

这个脚本只做一件事：拿 DOI 去问 Crossref。
  · 200 + 题名接近  → 已注册，题名一致
  · 200 + 题名差很多 → 已注册，但题名对不上（多半是套错了 DOI）
  · 404              → 查无此 DOI
  · 网络失败         → 未核验（不算通过，也不算失败；下次再跑）

用法：
  python scripts/doi_check.py demo
  python scripts/doi_check.py demo --limit 20 --json doi_report.json
  python scripts/doi_check.py demo --offline     # 只统计有多少条没 DOI
"""

from __future__ import annotations

import argparse
import difflib
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

UA = "lit-review-workbench/4.8 doi-check (https://example.invalid; mailto:check@example.invalid)"
CROSSREF = "https://api.crossref.org/works/"
DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+")
TITLE_OK = 0.62          # 题名相似度阈值（归一化后的字符级比值）


def warn(msg: str) -> None:
    print("  ! " + msg)


def die(msg: str, code: int = 1):
    print("✗ " + msg, file=sys.stderr)
    sys.exit(code)


def read_json(p: str, default=None):
    if not os.path.exists(p):
        return default
    with io.open(p, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def norm_title(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^0-9a-z\u3400-\u9fff]+", " ", s)
    return " ".join(s.split())


def similar(a: str, b: str) -> float:
    a, b = norm_title(a), norm_title(b)
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def pick_doi(obj) -> str:
    """从一条记录里掏出 DOI：优先 doi 字段，其次从 doiUrl / paperUrl 里抠。"""
    if not isinstance(obj, dict):
        return ""
    for k in ("doi", "DOI", "Doi"):
        v = obj.get(k)
        if isinstance(v, str) and v.strip():
            m = DOI_RE.search(v)
            return (m.group(0) if m else v.strip()).rstrip(".,;)]}")
    for k in ("doiUrl", "paperUrl", "url", "link"):
        v = obj.get(k)
        if isinstance(v, str):
            m = DOI_RE.search(v.strip())
            if m:
                return m.group(0).rstrip(".,;)]}")
    return ""


def collect(proj: str) -> list:
    """返回 [{src, file, idx, title, doi}]"""
    out = []
    for name, key in (("papers.json", "papers"), ("external.json", "external")):
        p = os.path.join(proj, "data", name)
        data = read_json(p)
        if data is None:
            continue
        rows = data.get(key) if isinstance(data, dict) else data
        if not isinstance(rows, list):
            continue
        for i, r in enumerate(rows):
            if not isinstance(r, dict):
                continue
            out.append({
                "src": name,
                "idx": i,
                "id": str(r.get("id") or ""),
                "title": str(r.get("title") or ""),
                "doi": pick_doi(r),
            })
    return out


def ask_doi_org(doi: str, timeout: float = 20.0) -> tuple:
    """Crossref 查不到时的第二道网：直接问 DOI 解析服务。

    为什么必须有这一步：arXiv 的 DOI（10.48550/arXiv.xxxx）注册在 DataCite，
    Crossref 一律 404。只看 Crossref 就会把一批真论文误判成"查无此 DOI"。
    """
    url = "https://doi.org/" + urllib.parse.quote(doi, safe="/()")
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.citationstyles.csl+json", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
        try:
            j = json.loads(raw)
            title = (j.get("title") or "").strip() if isinstance(j, dict) else ""
        except Exception:
            title = ""
        return ("ok", title, "DOI 解析服务")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return ("notfound", "", "")
        return ("error", "HTTP %s" % e.code, "")
    except Exception as e:
        return ("error", type(e).__name__, "")


def ask_crossref(doi: str, timeout: float = 20.0) -> tuple:
    """返回 (状态, 题名, 来源)。状态 ∈ ok / notfound / ratelimit / error / skipped"""
    url = CROSSREF + urllib.parse.quote(doi, safe="/()")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8", "replace"))
        msg = (body or {}).get("message") or {}
        titles = msg.get("title") or []
        title = titles[0] if titles else ""
        return ("ok", title, "Crossref")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            # 交给 doi.org 再判一次（DataCite / mEDRA / 各注册机构都在这条链上）
            return ask_doi_org(doi, timeout)
        if e.code == 429:
            return ("ratelimit", "", "")
        return ("error", "HTTP %s" % e.code, "")
    except Exception as e:  # 网络断了、DNS、超时
        return ("error", type(e).__name__, "")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="拿 DOI 去 Crossref 问一句：这个 DOI 到底存在吗？",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="例：python scripts/doi_check.py demo --limit 30")
    ap.add_argument("project", help="项目目录（含 data/papers.json、data/external.json）")
    ap.add_argument("--limit", type=int, default=60, help="最多查多少个（默认 60）")
    ap.add_argument("--sleep", type=float, default=0.25, help="每次请求间隔秒数，别把人家打疼")
    ap.add_argument("--json", default="", help="把结果写成 json")
    ap.add_argument("--offline", action="store_true", help="不联网，只统计有多少条缺 DOI")
    a = ap.parse_args(argv)

    proj = os.path.abspath(a.project)
    if not os.path.isdir(proj):
        die("项目目录不存在：%s" % proj, 2)
    rows = collect(proj)
    if not rows:
        die("没读到 papers.json / external.json（或里面是空的）", 2)

    with_doi = [r for r in rows if r["doi"]]
    no_doi = [r for r in rows if not r["doi"]]
    print("共 %d 条记录：有 DOI %d 条，没 DOI %d 条" % (len(rows), len(with_doi), len(no_doi)))
    if a.offline:
        for r in no_doi[:20]:
            warn("%s #%d 没有 DOI：%s" % (r["src"], r["idx"], r["title"][:48] or "（无标题）"))
        print("离线模式：只统计，不联网。")
        return 0
    if not with_doi:
        print("一条 DOI 都没有 —— 这一步没得查。")
        return 0

    todo = with_doi[: max(0, a.limit)]
    if len(with_doi) > len(todo):
        print("（本次只查前 %d 条，剩下的加 --limit）" % len(todo))
    stat = {"ok": 0, "mismatch": 0, "notfound": 0, "error": 0, "ratelimit": 0}
    bad = []
    for n, r in enumerate(todo, 1):
        st, title, via = ask_crossref(r["doi"])
        if st == "ok":
            sim = similar(r["title"], title)
            if sim >= TITLE_OK or not title:
                stat["ok"] += 1
                print("  ✓ [%d/%d] %s%s" % (
                    n, len(todo), r["doi"], "" if via == "Crossref" else "（%s 注册）" % via))
            else:
                stat["mismatch"] += 1
                print("  ! [%d/%d] 题名对不上（相似度 %.2f）" % (n, len(todo), sim))
                print("      DOI 侧：%s" % (title[:70] or "（注册项没有题名）"))
                print("      数据侧：%s" % (r["title"][:70] or "（没写标题）"))
                bad.append({"k": "mismatch", "doi": r["doi"], "local": r["title"],
                            "registered": title, "similarity": round(sim, 3), "src": r["src"]})
        elif st == "notfound":
            stat["notfound"] += 1
            print("  ✗ [%d/%d] 查无此 DOI：%s" % (n, len(todo), r["doi"]))
            bad.append({"k": "notfound", "doi": r["doi"], "local": r["title"], "src": r["src"]})
        elif st == "ratelimit":
            stat["ratelimit"] += 1
            warn("[%d/%d] Crossref 限流了，先停。过几分钟再跑。" % (n, len(todo)))
            break
        else:
            stat["error"] += 1
            print("  ? [%d/%d] 没核验成（%s）：%s" % (n, len(todo), title, r["doi"]))
        time.sleep(max(0.0, a.sleep))

    print("")
    print("结果：已注册 %d，题名对不上 %d，查无此 DOI %d，未核验 %d" % (
        stat["ok"], stat["mismatch"], stat["notfound"], stat["error"]))
    if no_doi:
        print("  另有 %d 条没有 DOI（不算错，但审稿人会问「这篇从哪来的」）" % len(no_doi))
    if stat["mismatch"] or stat["notfound"]:
        print("  → 上面带 ✗/! 的，要么改 DOI，要么把这行删掉。别留着。")
    if a.json:
        with io.open(a.json, "w", encoding="utf-8", newline="\n") as f:
            json.dump({"total": len(rows), "with_doi": len(with_doi),
                       "no_doi": len(no_doi), "checked": len(todo),
                       "stat": stat, "problems": bad}, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print("  → 明细：%s" % a.json)
    if stat["ratelimit"]:
        return 2
    return 1 if (stat["mismatch"] or stat["notfound"] or stat["error"]) else 0


if __name__ == "__main__":
    sys.exit(main())
