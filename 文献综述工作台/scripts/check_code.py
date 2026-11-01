# -*- coding: utf-8 -*-
"""逐篇核查开源代码（V4.7 增量版）
用法：python scripts/check_code.py <项目目录>
产出：<项目目录>/data/code_check.json

只认出版方明写的 github 地址（摘要或开放获取落地页里出现的），找不到就是找不到，不猜。
增量：已查过的 id 直接跳过，中断后重跑不会重来一遍。
"""
import io, json, os, re, sys, time, urllib.parse, urllib.request

PROXY = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
if PROXY:
    urllib.request.install_opener(urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": PROXY, "https": PROXY})))
UA = "LitWorkbench/4.7 (mailto:local@example.com)"
OPENALEX = "https://api.openalex.org/works"
SELECT = ("id,title,display_name,doi,publication_year,cited_by_count,"
          "abstract_inverted_index,open_access,primary_location,locations,best_oa_location")

def get(url, tries=3):
    last = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read())
        except Exception as e:
            last = e
            time.sleep(2.0 * (k + 1))
    raise last

def abstract_of(w):
    inv = w.get("abstract_inverted_index")
    if not inv: return ""
    pos = {}
    for word, idxs in inv.items():
        for i in idxs: pos[i] = word
    return " ".join(pos[i] for i in sorted(pos))

def norm(s):
    return re.sub(r"[\s\W_]+", "", (s or "").lower())

def search(title, use_search=False):
    t = urllib.parse.quote(title)
    if use_search:
        url = "%s?search=%s&per-page=8&select=%s" % (OPENALEX, t, SELECT)
    else:
        url = "%s?filter=title.search:%s&per-page=8&select=%s" % (OPENALEX, t, SELECT)
    d = get(url)
    res = d.get("results") or []
    if not res: return None
    n = norm(title)
    best, score = None, 0
    for w in res:
        bt = norm(w.get("title") or w.get("display_name"))
        if not bt or not n: continue
        if bt == n: s = 1.0
        elif n in bt or bt in n: s = 0.9
        else: continue
        if s > score: best, score = w, s
    return best

if len(sys.argv) < 2:
    print("用法：python scripts/check_code.py <项目目录>")
    sys.exit(1)
PROJ = os.path.abspath(sys.argv[1])
CP = os.path.join(PROJ, "data", "code_check.json")
P = json.load(io.open(os.path.join(PROJ, "data", "papers.json"), encoding="utf-8-sig"))

done = {}
if os.path.isfile(CP):
    try:
        for r in json.loads(io.open(CP, encoding="utf-8").read()):
            done[r["id"]] = r
    except Exception:
        done = {}

def _need(r):
    st = (r or {}).get("status") or ""
    # 报错的要重查：网络问题导致的失败不等于"查过且确实没有"
    return st == "" or st.startswith("ERR") or st == "未匹配"
todo = [p for p in P if p["id"] not in done or _need(done[p["id"]])]
print("共 %d 篇，已查 %d 篇，本次待查 %d 篇" % (len(P), len(done), len(todo)))

for i, p in enumerate(todo):
    rec = {"id": p["id"], "title": p.get("title"), "en": p.get("titleEn")}
    w = None
    for t in [x for x in (p.get("titleEn"), p.get("title")) if x]:
        for mode in (False, True):
            try:
                w = search(t, use_search=mode)
            except Exception as e:
                rec["err"] = type(e).__name__
            if w: break
            time.sleep(0.8)
        if w: break
        time.sleep(1.0)
    if w is None:
        rec["status"] = rec.get("err") or "未匹配"
    else:
        ab = abstract_of(w)
        gh = sorted(set(re.findall(r"https?://github\.com/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+", ab, re.I)))
        pl = w.get("primary_location") or {}
        rec.update({
            "status": "已匹配",
            "doi": w.get("doi"),
            "year": w.get("publication_year"),
            "venue": ((pl.get("source") or {}).get("display_name")),
            "oa": (w.get("open_access") or {}).get("is_oa"),
            "cited": w.get("cited_by_count"),
            "github": gh,
            "code_word": bool(re.search(r"\b(code|source code)\b[^.]{0,60}\b(available|released|at)\b", ab, re.I)),
            "abs_snip": re.sub(r"\s+", " ", ab)[:160],
        })
        for loc in (w.get("locations") or []) + ([w.get("best_oa_location")] if w.get("best_oa_location") else []):
            u = (loc or {}).get("landing_page_url") or ""
            if "github.com" in u.lower() and not gh:
                rec["github"] = [u.rstrip("/")]
    done[p["id"]] = rec
    io.open(CP, "w", encoding="utf-8", newline="\n").write(
        json.dumps([done[x["id"]] for x in P if x["id"] in done], ensure_ascii=False, indent=1))
    if (i + 1) % 15 == 0:
        print("  已查 %d/%d（本次）" % (i + 1, len(todo)), flush=True)

import collections
allr = [done[x["id"]] for x in P if x["id"] in done]
print("\n状态:", dict(collections.Counter(r["status"] for r in allr)))
hit = [r for r in allr if r.get("github")]
print("有 github 地址:", len(hit))
for r in hit:
    print("  ", r["id"], r["github"], "|", (r.get("venue") or "")[:24], "|", (r["title"] or "")[:32])
cw = [r for r in allr if r.get("code_word")]
print("摘要提到 code 但没给地址:", len(cw))
for r in cw:
    print("   ?", r["id"], (r.get("abs_snip") or "")[:120])
