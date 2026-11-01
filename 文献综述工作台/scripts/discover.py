# -*- coding: utf-8 -*-
"""discover.py —— 外部学术文献发现与补充推荐

设计上有意把职责切开：
  * 检索词生成（语义理解）由 Agent 完成，通过 --en / --zh 传入；
  * 本脚本只做确定性的事：检索、归一化、去重、打分、落盘。
这样同一组检索词重跑一次结果可复现，不会出现"两次跑出不同清单"的问题。

数据源（都无需付费、无需 API key）：
  Crossref       主源，DOI 权威、覆盖全学科
  OpenAlex       补被引数、机构、开放获取状态（免费额度有限，失败不阻塞）
  arXiv          补预印本与最新工作（只覆盖物理/CS/数学等，覆盖率天然偏低）
  Semantic Scholar  可选，未申请 key 时经常 429，失败即跳过

产出（写入 <项目>/data/）：
  external_candidates.json   第一层：至多 50 篇唯一候选
  external.json              第二层：默认至多 30 篇正式推荐（含打分明细）
  search_session.json        检索过程记录（数据源、查询词、去重与未入选原因）

用法：
  python discover.py <项目目录> --en "uav multimodal facade defect detection" \
                     --zh "无人机 建筑立面 病害 识别" \
                     --platform "uav drone aerial" \
                     --object "building facade concrete structure" \
                     --scenario "crack defect inspection" \
                     --modality "infrared thermal visible rgb" [--limit 30]

  --platform / --object 由 Agent 按研究主题生成，不是从 --en 自动切分：
  平台词缺失只软降权（手持红外的论文方法仍可借鉴），对象词完全未命中的
  直接硬性排除（葡萄病害、车辆检测的研究结论不能迁移到建筑立面）。
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date

UA = "LitReviewWorkbench/1.0 (academic literature discovery; contact: local user)"
TIMEOUT = 25

CROSSREF = "https://api.crossref.org/works"
OPENALEX = "https://api.openalex.org/works"
ARXIV = "https://export.arxiv.org/api/query"

# 出版社通知类记录。它们有正常 DOI 与标题，只有标题前缀能识别。
BAD_TITLE = re.compile(
    r"^\s*(retract(?:ed|ion)\b|withdraw(?:al|n)\b|expression\s+of\s+concern|"
    r"corrigendum|erratum|correction\s+to|editor(?:ial)?\s+(?:expression|note))", re.I)


# ---------------------------------------------------------------- 网络
def fetch(url, accept="application/json"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read()
    return raw.decode("utf-8", "replace")


def fetch_json(url):
    return json.loads(fetch(url))


# ---------------------------------------------------------------- 归一化
def norm_title(t):
    """标题归一：去标点、去空白、小写。用于跨源去重。"""
    t = (t or "").lower()
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"[^\w\u4e00-\u9fa5]+", "", t)
    return t


def norm_doi(d):
    if not d:
        return ""
    d = d.strip().lower()
    d = re.sub(r"^https?://(dx\.)?doi\.org/", "", d)
    d = re.sub(r"^doi:\s*", "", d)
    return d


def clean(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def decode_abstract(inv):
    """OpenAlex 的摘要以倒排索引给出：{词: [位置…]}，需按位置还原成句子。

    不还原的后果很实际 —— 整批 OpenAlex 记录摘要为空，六维评分里
    "证据质量"恒为 0.35、"研究对象"只能在标题上判定，误排除率明显升高。
    """
    if not inv or not isinstance(inv, dict):
        return ""
    pos = {}
    for w, idxs in inv.items():
        for i in (idxs or []):
            pos[i] = w
    if not pos:
        return ""
    return " ".join(pos[i] for i in sorted(pos))


def make_id(doi, title):
    base = norm_doi(doi) or norm_title(title)
    return "X" + hashlib.sha1(base.encode("utf-8")).hexdigest()[:8]


# ---------------------------------------------------------------- 检索：Crossref
def search_crossref(q, rows=20):
    url = "%s?query=%s&rows=%d&select=DOI,title,author,issued,container-title,abstract,type,is-referenced-by-count,URL" % (
        CROSSREF, urllib.parse.quote(q), rows)
    d = fetch_json(url)
    out = []
    for it in d.get("message", {}).get("items", []):
        doi = norm_doi(it.get("DOI"))
        title = clean((it.get("title") or [""])[0])
        if not title:
            continue
        dp = (it.get("issued") or {}).get("date-parts") or [[None]]
        year = dp[0][0] if dp and dp[0] else None
        auth = []
        for a in (it.get("author") or [])[:8]:
            n = " ".join(x for x in [a.get("given"), a.get("family")] if x).strip()
            if n:
                auth.append(n)
        out.append({
            "source": "Crossref",
            "doi": doi,
            "title": title,
            "year": year,
            "venue": clean((it.get("container-title") or [""])[0]),
            "authors": auth,
            "abstract": clean(it.get("abstract") or ""),
            "citationCount": it.get("is-referenced-by-count"),
            "citationSource": "Crossref",
            "paperUrl": it.get("URL") or ("https://doi.org/" + doi if doi else ""),
            "type": it.get("type") or "",
        })
    return out


# ---------------------------------------------------------------- 检索：OpenAlex
def search_openalex(q, per_page=25, since=None):
    url = "%s?search=%s&per_page=%d" % (OPENALEX, urllib.parse.quote(q), per_page)
    if since:
        url += "&filter=from_publication_date:" + since
    d = fetch_json(url)
    out = []
    for it in d.get("results", []):
        title = clean(it.get("title") or it.get("display_name") or "")
        if not title:
            continue
        oa = it.get("open_access") or {}
        best = it.get("best_oa_location") or {}
        inst = ""
        for a in (it.get("authorships") or []):
            if a.get("institutions"):
                inst = a["institutions"][0].get("display_name", "")
                break
        auth = [a.get("author", {}).get("display_name", "") for a in (it.get("authorships") or [])][:8]
        out.append({
            "source": "OpenAlex",
            "doi": norm_doi(it.get("doi")),
            "title": title,
            "year": it.get("publication_year"),
            "venue": clean(((it.get("primary_location") or {}).get("source") or {}).get("display_name", "")),
            "authors": [a for a in auth if a],
            "institution": inst,
            "abstract": clean(decode_abstract(it.get("abstract_inverted_index"))),
            "citationCount": it.get("cited_by_count"),
            "citationSource": "OpenAlex",
            "paperUrl": it.get("doi") or (best.get("landing_page_url") or ""),
            "oaStatus": oa.get("oa_status") or "",
            "isOa": bool(oa.get("is_oa")),
            "oaPdfUrl": best.get("pdf_url") or "",
            "type": it.get("type") or "",
            "isRetracted": bool(it.get("is_retracted")),
        })
    return out


# ---------------------------------------------------------------- 检索：arXiv
def search_arxiv(q, max_results=10):
    """arXiv 的 search_query 用空格会被解析成 OR，必须显式连接。

    全词 AND 太严（4-6 个术语同现几乎无结果），所以分两级：先取前 4 词 AND，
    无结果退化到全词 OR 并按相关度排序。两级都空才算 0 条。
    """
    terms = [t for t in re.split(r"\s+", q.strip()) if t]

    def run(expr, n):
        url = "%s?search_query=%s&max_results=%d&sortBy=relevance" % (ARXIV, expr, n)
        return fetch(url, "application/atom+xml")

    xml = run("+AND+".join("all:" + urllib.parse.quote(t) for t in terms[:4]), max_results)
    if "<entry>" not in xml and len(terms) > 2:
        xml = run("+OR+".join("all:" + urllib.parse.quote(t) for t in terms[:6]), max_results)

    out = []
    for ent in re.findall(r"<entry>(.*?)</entry>", xml, re.S):
        title = clean(re.search(r"<title>(.*?)</title>", ent, re.S).group(1)) if "<title>" in ent else ""
        if not title:
            continue
        aid = re.search(r"<id>(.*?)</id>", ent)
        pub = re.search(r"<published>(\d{4})", ent)
        summ = re.search(r"<summary>(.*?)</summary>", ent, re.S)
        auth = re.findall(r"<name>(.*?)</name>", ent)
        doi = re.search(r'<arxiv:doi[^>]*>(.*?)</arxiv:doi>', ent)
        out.append({
            "source": "arXiv",
            "doi": norm_doi(doi.group(1)) if doi else "",
            "arxivId": (aid.group(1).rsplit("/", 1)[-1] if aid else ""),
            "title": title,
            "year": int(pub.group(1)) if pub else None,
            "venue": "arXiv preprint",
            "authors": auth[:8],
            "abstract": clean(summ.group(1)) if summ else "",
            "citationCount": None,
            "citationSource": "",
            "paperUrl": aid.group(1) if aid else "",
            "isOa": True,
            "oaPdfUrl": (aid.group(1).replace("/abs/", "/pdf/") if aid else ""),
            "type": "preprint",
        })
    return out


# ---------------------------------------------------------------- 去重
def dedupe(records, local_dois, local_titles):
    """DOI 优先；无 DOI 时按 标题归一 + 年份 ±1 判重。

    同时标记 alreadyInLocalLibrary —— 已在本地库的仍保留（用于佐证研究现状），
    但不占用新增推荐的 30 篇名额。
    """
    seen_doi, seen_title = {}, {}
    uniq, dup = [], []
    for r in records:
        d = norm_doi(r.get("doi"))
        nt = norm_title(r.get("title"))
        hit = None
        if d and d in seen_doi:
            hit = seen_doi[d]
        elif nt and nt in seen_title:
            cand = seen_title[nt]
            if abs((cand.get("year") or 0) - (r.get("year") or 0)) <= 1:
                hit = cand
        if hit is not None:
            # 合并：补齐缺失字段，保留更完整的一条
            for k, v in r.items():
                if v and not hit.get(k):
                    hit[k] = v
            if r.get("abstract") and not hit.get("abstract"):
                hit["abstract"] = r["abstract"]
            dup.append({"title": r.get("title"), "source": r.get("source"), "keptAs": hit.get("id")})
            continue
        r["id"] = make_id(d, r.get("title"))
        r["alreadyInLocalLibrary"] = bool((d and d in local_dois) or (nt and nt in local_titles))
        uniq.append(r)
        if d:
            seen_doi[d] = r
        if nt:
            seen_title[nt] = r
    return uniq, dup


# ---------------------------------------------------------------- 打分
STOP = set("""a an the of for and or with in on to from by via using based towards toward
study studies method methods approach approaches paper we our this that are is was were
analysis research new novel result results experimental experiments""".split())


def toks(s):
    return [t for t in re.findall(r"[a-z0-9\-]+", (s or "").lower()) if len(t) > 2 and t not in STOP]


def coverage(terms, text):
    """query 词项在文本中的覆盖率（0-1）。不做词形还原，靠词干前缀兜底。"""
    if not terms:
        return 0.0
    text = (text or "").lower()
    hit = 0
    for t in terms:
        if t in text:
            hit += 1
        elif len(t) > 4 and t[:5] in text:
            hit += 1
    return hit / len(terms)


def score(r, qterms, scen_terms, moda_terms, plat_terms, obj_terms, cur_year):
    """六维打分 + 分档降权。每一维都返回明细，便于在页面上解释。

    为什么要降权：词袋法会把"crack defect detection"这种通用任务词算成高相关。
    一篇 2013 年的陶瓷超声检测论文，或一篇葡萄病害的 UAV 多光谱论文，都可能命中
    四五个通用词而拿到 50+ 分相关度。这类条目靠两道闸门处理：
      * 平台词（uav / drone / aerial）缺失 —— 软降权，因为手持红外的论文方法仍可借鉴；
      * 对象词（building / facade / concrete）缺失 —— 在校验环节直接硬性排除，
        因为应用对象换了，结论不能迁移。
    """
    blob = " ".join([r.get("title") or "", r.get("abstract") or "", r.get("venue") or ""])
    rel = coverage(qterms, blob)                       # 相关性
    scen = coverage(scen_terms, blob)                  # 场景/任务匹配
    moda = coverage(moda_terms, blob)                  # 数据模态匹配
    plat = coverage(plat_terms, blob) if plat_terms else 1.0
    obj = coverage(obj_terms, blob) if obj_terms else 1.0
    has_abs = 1.0 if (r.get("abstract") or "").strip() else 0.35
    has_doi = 1.0 if r.get("doi") else 0.5
    evid = 0.6 * has_abs + 0.4 * has_doi               # 可核验证据质量
    y = r.get("year") or 0
    age = cur_year - y if y else 99
    time_s = 1.0 if age <= 2 else 0.8 if age <= 5 else 0.55 if age <= 10 else 0.35
    learn = 0.5 * rel + 0.5 * (1.0 if r.get("type") in ("article", "preprint", "journal-article") else 0.7)

    total = (30 * rel + 20 * max(rel, scen) + 15 * moda + 15 * learn + 10 * evid + 10 * time_s)
    penalties = []
    if plat_terms and plat == 0:
        total *= 0.45
        penalties.append("平台词完全未命中，疑为场景迁移（降权至 45%）")
    elif plat_terms and plat < 0.5:
        total *= 0.80
        penalties.append("平台词仅部分命中（降权至 80%）")
    if obj_terms and obj == 0:
        total *= 0.30
        penalties.append("研究对象词完全未命中（降权至 30%）")
    if scen_terms and scen < 0.15:
        total *= 0.85
        penalties.append("应用场景词命中偏低（降权至 85%）")

    return {
        "relevance": round(rel * 100),
        "platformCoverage": round(plat * 100),
        "objectCoverage": round(obj * 100),
        "subdirectionMatch": round(max(rel, scen) * 100),
        "dataScenarioFit": round(moda * 100),
        "learningValue": round(learn * 100),
        "evidenceQuality": round(evid * 100),
        "recency": round(time_s * 100),
        "total": round(total, 1),
        "penalties": penalties,
        "breakdown": {
            "相关性30%": round(30 * rel, 1),
            "子方向匹配20%": round(20 * max(rel, scen), 1),
            "数据场景15%": round(15 * moda, 1),
            "学习价值15%": round(15 * learn, 1),
            "证据质量10%": round(10 * evid, 1),
            "时效10%": round(10 * time_s, 1),
        },
    }


def enrich_open_access(records):
    """对推荐清单按 DOI 批量回查 OpenAlex，补开放获取状态。

    Crossref 不带 OA 信息，单靠它会让大部分条目停留在 unknown。
    OpenAlex 支持 filter=doi:a|b|c 批量查询，一批 40 个 DOI 一次请求即可。
    注意：即便拿到 pdf_url 也不能直接认定可下载 —— 见 access_of() 的门槛。
    """
    dois = [norm_doi(r["doi"]) for r in records if r.get("doi")]
    if not dois:
        return 0
    filled = 0
    for i in range(0, len(dois), 40):
        chunk = dois[i:i + 40]
        url = "%s?filter=doi:%s&per_page=50&select=doi,open_access,best_oa_location" % (
            OPENALEX, "|".join(urllib.parse.quote(d) for d in chunk))
        try:
            d = fetch_json(url)
        except Exception:
            continue
        idx = {norm_doi(r.get("doi")): r for r in records if r.get("doi")}
        for w in d.get("results", []):
            k = norm_doi(w.get("doi"))
            r = idx.get(k)
            if not r:
                continue
            oa = w.get("open_access") or {}
            best = w.get("best_oa_location") or {}
            r["oaStatus"] = oa.get("oa_status") or ""
            r["isOa"] = bool(oa.get("is_oa"))
            r["oaPdfUrl"] = best.get("pdf_url") or ""
            r["accessStatus"], r["openAccessPdfUrl"] = access_of(r)
            filled += 1
        time.sleep(0.3)
    return filled


def access_of(r):
    """访问状态。注意：OpenAlex 的 best_oa_location 可能指向出版社付费页，
    所以只有 oa_status 属于可信开放获取类型时才标 OA。"""
    st = (r.get("oaStatus") or "").lower()
    if r.get("oaPdfUrl") and st in ("gold", "hybrid", "green", "diamond", "bronze"):
        return "open_access", r["oaPdfUrl"]
    if r.get("arxivId"):
        return "open_access", r.get("oaPdfUrl") or ("https://arxiv.org/pdf/" + r["arxivId"])
    if st in ("closed", "none"):
        return "paywalled", ""
    return "unknown", ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("proj")
    ap.add_argument("--en", action="append", required=True, metavar="QUERY",
                    help="英文检索词，空格分隔。可重复传入多组（建议按子方向各给一条，3-6 组）")
    ap.add_argument("--zh", action="append", default=[], metavar="QUERY",
                    help="中文检索词，可选，同样可重复")
    ap.add_argument("--scenario", default="", help="场景/任务补充词")
    ap.add_argument("--modality", default="", help="数据模态补充词")
    ap.add_argument("--platform", "--core", dest="platform", default="",
                    help="平台/载体词（如 uav drone aerial）。缺失只软降权，因为手持设备的方法仍可借鉴")
    ap.add_argument("--object", default="",
                    help="研究对象词（如 building facade concrete bridge）。完全未命中的条目"
                         "在校验环节硬性排除：应用对象换了，结论不可迁移")
    ap.add_argument("--limit", type=int, default=30, help="正式推荐上限，默认 30")
    ap.add_argument("--candidates", type=int, default=50, help="候选池上限，默认 50")
    ap.add_argument("--since", default="", help="只取该日期之后的论文，如 2019-01-01")
    a = ap.parse_args()

    proj = os.path.abspath(a.proj)
    data_dir = os.path.join(proj, "data")
    os.makedirs(data_dir, exist_ok=True)

    # --- 本地库（用于去重与 alreadyInLocalLibrary）
    local_dois, local_titles = set(), set()
    lp = os.path.join(data_dir, "papers.json")
    if os.path.isfile(lp):
        # utf-8-sig：兼容记事本/PowerShell 存出的带 BOM 文件
        for p in json.loads(io.open(lp, encoding="utf-8-sig").read()):
            if p.get("doi"):
                local_dois.add(norm_doi(p["doi"]))
            if p.get("title"):
                local_titles.add(norm_title(p["title"]))

    # 相关性词项取所有英文检索词的并集去重：多组检索词各自命中不同子方向，
    # 用并集才不会让"只在第三组词里出现"的好论文显得不相关。
    qterms = toks(" ".join(a.en))
    scen_terms = toks(a.scenario) or qterms
    moda_terms = toks(a.modality) or qterms
    plat_terms = toks(a.platform)
    obj_terms = toks(a.object)
    cur_year = date.today().year

    print("检索词 %d 组" % len(a.en))
    if plat_terms:
        print("平台词 %d 个：%s" % (len(plat_terms), " ".join(plat_terms)))
    if obj_terms:
        print("对象词 %d 个：%s（完全未命中者将被硬性排除）" % (len(obj_terms), " ".join(obj_terms)))

    queries = list(a.en) + list(a.zh or [])

    attempted, succeeded, failed = [], [], []
    raw = []
    for q in queries:
        # Crossref
        try:
            got = search_crossref(q, rows=40)
            raw += got
            succeeded.append("Crossref")
            print("  Crossref  %-46s %3d 条" % (q[:46], len(got)))
        except Exception as e:
            failed.append({"source": "Crossref", "query": q, "error": str(e)[:120]})
            print("  Crossref  %-46s 失败：%s" % (q[:46], str(e)[:60]))
        attempted.append({"source": "Crossref", "query": q})
        time.sleep(0.4)
        # OpenAlex
        try:
            got = search_openalex(q, per_page=40, since=a.since or None)
            raw += got
            succeeded.append("OpenAlex")
            print("  OpenAlex  %-46s %3d 条" % (q[:46], len(got)))
        except Exception as e:
            failed.append({"source": "OpenAlex", "query": q, "error": str(e)[:120]})
            print("  OpenAlex  %-46s 失败：%s" % (q[:46], str(e)[:60]))
        attempted.append({"source": "OpenAlex", "query": q})
        time.sleep(0.4)
        # arXiv 只跑英文
        if re.search(r"[a-zA-Z]", q):
            try:
                got = search_arxiv(q, max_results=15)
                raw += got
                succeeded.append("arXiv")
                print("  arXiv     %-46s %3d 条" % (q[:46], len(got)))
            except Exception as e:
                failed.append({"source": "arXiv", "query": q, "error": str(e)[:120]})
                print("  arXiv     %-46s 失败：%s" % (q[:46], str(e)[:60]))
            attempted.append({"source": "arXiv", "query": q})
            time.sleep(0.4)

    if not raw:
        print("\n[失败] 所有数据源均未返回结果。网络可能受限，或接口变更。", file=sys.stderr)
        print("建议：改用模式 A（仅本地分析），或稍后重试。", file=sys.stderr)
        sys.exit(2)

    uniq, dups = dedupe(raw, local_dois, local_titles)
    print("\n原始命中 %d 条 → 跨源去重后 %d 条（合并 %d 条）" % (len(raw), len(uniq), len(dups)))

    for r in uniq:
        r["score"] = score(r, qterms, scen_terms, moda_terms, plat_terms, obj_terms, cur_year)
        r["accessStatus"], r["openAccessPdfUrl"] = access_of(r)
        r["retrievedAt"] = date.today().isoformat()
        r["doiUrl"] = ("https://doi.org/" + norm_doi(r["doi"])) if r.get("doi") else ""
        r["sourceDatabase"] = r.get("source", "")

    # --- 硬性排除。这几类都必须挡在推荐清单之外，理由是它们不该出现在
    #     "该补读什么" 的建议里：
    #       * 撤稿/关注声明/勘误 —— 不可作为研究依据。注意 "Retraction Note:" 这类
    #         出版社通知标题也带 DOI，只判 is_retracted 会漏（OpenAlex 尚未同步）。
    #       * 跨年（online-first 排版年）—— 会让"近两年"统计失真。
    #       * 相关度过低 —— 只是靠时效与证据分凑够了总分。
    #       * 研究对象不符 —— 葡萄病害、车辆检测、反无人机 LiDAR 等，平台或任务词
    #         命中却换了应用对象，结论不可迁移到建筑病害。
    excluded = []
    keep = []
    for r in uniq:
        t = r.get("title") or ""
        if BAD_TITLE.match(t) or r.get("isRetracted"):
            excluded.append({"title": t, "reason": "撤稿/关注声明/勘误类记录，不可作为研究依据"})
            continue
        y = r.get("year")
        if y and y > cur_year:
            excluded.append({"title": t, "reason": "年份 %d 晚于当前年，疑为 online-first 排版年" % y})
            continue
        if r["score"]["relevance"] < 25:
            excluded.append({"title": t,
                             "reason": "相关度 %d 低于门槛 25（总分靠时效与证据分撑起，不代表内容相关）" % r["score"]["relevance"]})
            continue
        if obj_terms and r["score"]["objectCoverage"] == 0:
            # V4.6：不再硬删。研究对象未命中只说明"可能是跨领域迁移"，
            # 直接删掉等于替用户决定"这篇不值得看"；改为排在后面、不进正式推荐，
            # 但仍留在候选清单里，需要时能自己翻到（报告里可据此解释覆盖局限）。
            r["objectMismatch"] = True
        keep.append(r)
    uniq = keep
    n_kept = len(uniq)

    # 研究对象命中的排在前面；未命中的沉到候选清单尾部，不参与推荐
    uniq.sort(key=lambda r: (1 if r.get("objectMismatch") else 0, -r["score"]["total"]))
    candidates = uniq[:a.candidates]

    # 正式推荐：排除已在本地库的；保持来源与年份多样性
    pool = [r for r in candidates if not r.get("alreadyInLocalLibrary")]
    rec, by_year, by_src = [], {}, {}
    for r in pool:
        if len(rec) >= a.limit:
            break
        y = r.get("year") or 0
        if r.get("objectMismatch"):
            continue
        s = r.get("sourceDatabase") or ""
        # 同一来源最多 70%，同一年最多 40%，避免清单被单一渠道垄断
        if by_src.get(s, 0) >= max(3, a.limit * 0.7):
            continue
        if by_year.get(y, 0) >= max(2, a.limit * 0.4):
            continue
        rec.append(r)
        by_year[y] = by_year.get(y, 0) + 1
        by_src[s] = by_src.get(s, 0) + 1

    for r in rec:
        r["recommendationReason"] = build_reason(r, qterms)

    # 对最终清单回查 OA 状态（Crossref 不带该信息）
    n_oa = enrich_open_access(rec)
    print("开放获取状态回查补全 %d 条" % n_oa)

    rejected = [{"id": r["id"], "title": r["title"],
                 "reason": ("已在本地库" if r.get("alreadyInLocalLibrary")
                            else "研究对象未命中检索对象词，进候选但不推荐" if r.get("objectMismatch")
                            else "多样性上限或排序靠后")}
                for r in candidates if r not in rec]

    io.open(os.path.join(data_dir, "external_candidates.json"), "w", encoding="utf-8", newline="\n").write(
        json.dumps(candidates, ensure_ascii=False, indent=1))
    io.open(os.path.join(data_dir, "external.json"), "w", encoding="utf-8", newline="\n").write(
        json.dumps(rec, ensure_ascii=False, indent=1))

    session = {
        "researchQuery": " | ".join(a.en),
        "searchDate": date.today().isoformat(),
        "sourcesAttempted": sorted({x["source"] for x in attempted}),
        "sourcesSucceeded": sorted(set(succeeded)),
        "sourcesFailed": failed,
        "searchQueries": queries,
        "rawHitCount": len(raw),
        "uniqueHitCount": len(uniq) + len(excluded),
        "passedScreeningCount": n_kept,
        "candidateCount": len(candidates),
        "duplicateCount": len(dups),
        "validatedCandidateCount": len(pool),
        "recommendedCount": len(rec),
        "localLibraryCount": len(local_dois),
        "platformTerms": plat_terms,
        "objectTerms": obj_terms,
        "scenarioTerms": scen_terms,
        "modalityTerms": moda_terms,
        "selectionRules": [
            "六维加权：相关性30/子方向20/数据场景15/学习价值15/证据质量10/时效10",
            "与本地库 DOI 或标题+年份去重；已在本地库的不占新增推荐名额",
            "单一来源不超过 70%，单一年份不超过 40%",
            "候选不足时不补位，宁缺不造",
        ] + ([
            "平台词（%s）完全未命中的条目降权至 45%%，仅部分命中降权至 80%%" % " ".join(plat_terms),
            "研究对象词（%s）完全未命中的条目硬性排除，单条理由记录在排除样例里" % " ".join(obj_terms),
        ] if plat_terms or obj_terms else []),
        "coverageLimitations": coverage_note(succeeded, failed),
        "rejectedSample": rejected[:20],
        "excludedCount": len(excluded),
        "excludedSample": excluded[:15],
    }
    io.open(os.path.join(data_dir, "search_session.json"), "w", encoding="utf-8", newline="\n").write(
        json.dumps(session, ensure_ascii=False, indent=1))

    print("候选池 %d 篇 → 正式推荐 %d 篇（本地库命中 %d 篇已排除）"
          % (len(candidates), len(rec), len(candidates) - len(pool)))
    print("硬性排除 %d 篇：%s" % (len(excluded), reason_tally(excluded)))
    n_obj = sum(1 for r in candidates if r.get("objectMismatch"))
    if n_obj:
        print("研究对象未命中 %d 篇：留在候选清单、不进正式推荐（删掉等于替用户否决）" % n_obj)
    print("开放获取：%d 篇；需订阅：%d 篇；状态未知：%d 篇" % (
        sum(1 for r in rec if r["accessStatus"] == "open_access"),
        sum(1 for r in rec if r["accessStatus"] == "paywalled"),
        sum(1 for r in rec if r["accessStatus"] == "unknown")))
    print("\n输出：")
    print("  " + os.path.join(data_dir, "external_candidates.json"))
    print("  " + os.path.join(data_dir, "external.json"))
    print("  " + os.path.join(data_dir, "search_session.json"))
    if len(rec) < a.limit:
        print("\n注意：正式推荐只有 %d 篇（目标 %d）。可核验合格文献不足时不补位。" % (len(rec), a.limit))


def reason_tally(excluded):
    """把排除理由归类计数，打印成一行，便于判断是哪道闸门在起作用。"""
    buckets = [
        ("撤稿类", "撤稿"), ("跨年", "晚于当前年"), ("相关度低", "低于门槛"),
    ]
    out = []
    for name, key in buckets:
        n = sum(1 for e in excluded if key in e["reason"])
        if n:
            out.append("%s %d" % (name, n))
    return "、".join(out) or "无"


def build_reason(r, qterms):
    s = r["score"]
    parts = []
    if s["relevance"] >= 55:
        parts.append("标题与摘要覆盖本研究方向的核心术语")
    elif s["relevance"] >= 30:
        parts.append("部分覆盖研究方向术语，可作为外围参考")
    y = r.get("year")
    if y and date.today().year - y <= 2:
        parts.append("近两年发表，可反映当前方法状态")
    if r.get("accessStatus") == "open_access":
        parts.append("开放获取，可直接核验全文")
    if (r.get("citationSource") or "") and r.get("citationCount") is not None:
        parts.append("被引 %d（%s，注意跨年份不可直接比较）" % (r["citationCount"], r["citationSource"]))
    return "；".join(parts) or "检索命中，相关度中等"


def coverage_note(ok, bad):
    ok = sorted(set(ok))
    n = []
    n.append("实际检索到的数据库：%s" % ("、".join(ok) if ok else "无"))
    n.append("arXiv 仅覆盖物理、计算机、数学等预印本，非本领域全覆盖")
    n.append("Semantic Scholar 未纳入（无密钥时限流），如需更全覆盖应申请 key")
    if bad:
        n.append("有 %d 次请求失败，可能造成样本偏差" % len(bad))
    n.append("统计数据仅反映本次检索范围内的情况，不能代表整个领域")
    return n


if __name__ == "__main__":
    main()
