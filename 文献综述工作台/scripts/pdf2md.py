# -*- coding: utf-8 -*-
"""pdf2md.py —— 论文 PDF 批量转 Markdown（零新增依赖）

设计参照 MinerU 的"版面分析优先于文字抽取"：
  1. 先按 bbox 判断单栏/双栏，按人类阅读顺序重排（而不是 PyMuPDF 默认的文本块顺序）
  2. 用"跨页重复短行"剔除页眉/页脚/页码（比按坐标裁切更稳）
  3. 用字号相对正文中位数的比例推断标题层级
  4. 表格走 find_tables() 转 Markdown 表
  5. 每篇输出一个 .md + 一份 manifest（页数/字数/是否需 OCR/耗时）

只依赖 PyMuPDF（AGPL-3.0，本机已装 1.28.2）。不调用任何模型，不联网。

用法：
    python pdf2md.py <PDF目录或单个PDF> [-o 输出目录]

判定为扫描件（字符密度 < 200/页）的文件不强行转，只在 manifest 里标 needs_ocr，
后续可交给 MinerU 或 OCR 处理 —— 这类文件硬抽只会得到空文本。

三道硬门禁（V4.6）：
  1. 正文为空（0 字符）→ 不写 md，默认让整批以退出码 2 停止（--allow-empty 放行）；
  2. 乱码（U+FFFD 占比 > 6%）→ 标 garbled。字符数达标但内容不可读，只按密度判 OCR 会漏；
  3. 分栏错乱（双栏页里跨栏行 > 30%）→ 标 colswap。左右栏被拼成一句时字数完全正常，
     只有人读摘要才发现句子被拦腰打断。
manifest.json 按文件名合并写入，分批跑不会互相覆盖。
"""
import io
import json
import os
import re
import sys
import time
import argparse
from collections import Counter

try:
    import pymupdf
except ImportError:
    try:
        import fitz as pymupdf
    except ImportError:
        print("需要 PyMuPDF：pip install pymupdf", file=sys.stderr)
        sys.exit(1)

# 判定阈値
MIN_CHARS_PER_PAGE = 200      # 低于此值视为扫描件
HEADER_ZONE = 0.085           # 页面上下各 8.5% 视为页眉/页脚带
FOOTER_ZONE = 0.915
TITLE_RATIO = 1.14            # 字号超过正文中位数的 1.14 倍视为标题
MIN_TITLE_LEN = 6
GARBLE_RATIO = 0.06           # 替换字符（U+FFFD）占比超过此值判为乱码
STRADDLE_RATIO = 0.30         # 双栏页里"跨栏行"占比超过此值判为分栏错乱


# ---------------------------------------------------------------- 工具
def med(vals):
    v = sorted(vals)
    return v[len(v) // 2] if v else 0


def clean(s):
    s = s.replace("\u00ad", "")            # 软连字符
    s = re.sub(r"-\n(?=[a-z])", "", s)     # 断词连字符
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


NOISE_WORDS = {"article", "review", "communication", "perspective", "editorial",
               "article open access", "research article", "contents lists available"}


SECTION_RE = re.compile(r"^(\d+(\.\d+)*\.?\s+[A-Z\u4e00-\u9fff]|[IVX]{1,4}\.\s+[A-Z]|[一二三四五六七八九十]+、)")
TOC_LINE = re.compile(r"^.{4,}\.{4,}\s*\d+\s*$")   # "1.1 背景 ........ 5"


def looks_like_formula(t):
    """公式行不应被当成标题：字母/汉字占比过低，或含数学关系符。"""
    if not t:
        return True
    letters = sum(1 for ch in t if ch.isalpha() or "\u4e00" <= ch <= "\u9fff")
    if letters / len(t) < 0.62:
        return True
    if re.search(r"[=<>≤≥≈∑∫√±×÷≠∞]", t):
        return True
    return False


def is_noise(line, page_rect):
    """页码、纯符号行、出版社栏目词、目录行"""
    t = line.strip()
    if not t:
        return True
    if t.lower() in NOISE_WORDS:
        return True
    if TOC_LINE.match(t):
        return True
    if re.fullmatch(r"[\d\s\-–—·•\.]+", t):
        return True
    if re.fullmatch(r"(page\s*)?\d+(\s*(of|/)\s*\d+)?", t, re.I):
        return True
    return False


# ---------------------------------------------------------------- 分栏检测
def column_bands(spans, page_w):
    """用 span 中心点的 x 投影找分栏。返回列区间列表，单栏返回 [整页]。"""
    if not spans:
        return [(0, page_w)]
    # 直方图：把页宽切成 100 格，统计每格被 span 覆盖的次数
    bins = [0] * 100
    for s in spans:
        x0, x1 = s["bbox"][0], s["bbox"][2]
        a = max(0, min(99, int(x0 / page_w * 100)))
        b = max(0, min(99, int(x1 / page_w * 100)))
        for i in range(a, b + 1):
            bins[i] += 1
    total = sum(bins) or 1
    # 找中间区域（35%-65%）里连续的低密度带作为分栏线
    lo, hi = int(page_w and 35), 65
    gap = None
    run = []
    for i in range(30, 71):
        if bins[i] / total < 0.02:
            run.append(i)
        else:
            if len(run) >= 3:
                gap = (run[0], run[-1])
            run = []
    if len(run) >= 3:
        gap = (run[0], run[-1])
    if not gap:
        return [(0, page_w)]
    mid = (gap[0] + gap[1]) / 2 / 100 * page_w
    # 两侧都必须有实质内容，否则不是真双栏
    left = sum(1 for s in spans if (s["bbox"][0] + s["bbox"][2]) / 2 < mid)
    right = len(spans) - left
    if left < len(spans) * 0.25 or right < len(spans) * 0.25:
        return [(0, page_w)]
    return [(0, mid), (mid, page_w)]


def order_spans(spans, bands):
    """按 列 → y → x 排序，得到人类阅读顺序"""
    def key(s):
        cx = (s["bbox"][0] + s["bbox"][2]) / 2
        for ci, (a, b) in enumerate(bands):
            if a <= cx < b:
                return (ci, round(s["bbox"][1], 1), s["bbox"][0])
        return (len(bands), round(s["bbox"][1], 1), s["bbox"][0])
    return sorted(spans, key=key)


# ---------------------------------------------------------------- 单页解析
def page_spans(page):
    out = []
    d = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)
    for blk in d.get("blocks", []):
        if blk.get("type") != 0:
            continue
        for ln in blk.get("lines", []):
            for sp in ln.get("spans", []):
                t = sp.get("text", "")
                if not t.strip():
                    continue
                out.append({
                    "text": t,
                    "bbox": sp["bbox"],
                    "size": round(sp["size"], 1),
                    "bold": bool(sp.get("flags", 0) & 2 ** 4) or ("Bold" in sp.get("font", "")),
                })
    return out


def merge_lines(spans, bands, page_w):
    """聚成行 → 行内按间距断开 → 按 (栏, y) 排序。

    两个必须避开的坑：
      1. 全局按 y 合并会把左右两栏同一高度的内容拼成一句（串行）；
      2. 先按 span 宽度分组又会把跨行大标题拆散。
    正确粒度是先聚成"视觉行"（y 相近），再在行内按 x 间距断开（栏间空白通常 > 4% 页宽），
    最后用行的中心点判定它属于哪一栏。
    """
    if not spans:
        return []
    rows = {}
    for s in spans:
        y = round(s["bbox"][1], 0)
        key = None
        for k in rows:
            if abs(k - y) <= 3:
                key = k
                break
        rows.setdefault(key if key is not None else y, []).append(s)

    groups = []
    for y in sorted(rows):
        parts = sorted(rows[y], key=lambda s: s["bbox"][0])
        cur = [parts[0]]
        for s in parts[1:]:
            if s["bbox"][0] - cur[-1]["bbox"][2] > page_w * 0.04:
                groups.append(cur)
                cur = [s]
            else:
                cur.append(s)
        groups.append(cur)

    lines = []
    for grp in groups:
        x0 = grp[0]["bbox"][0]
        x1 = grp[-1]["bbox"][2]
        cx = (x0 + x1) / 2
        gi = len(bands)
        for i, (a, b) in enumerate(bands):
            if a <= cx < b:
                gi = i
                break
        # 字号按字符数加权取中位数，不能取 max —— 行内混入一个公式片段或上标，
        # 用 max 会把整行正文字号抬到 1.4 倍，进而被误判成标题。
        sizes = []
        for p in grp:
            sizes.extend([p["size"]] * max(1, len(p["text"])))
        bold_n = sum(len(p["text"]) for p in grp if p["bold"])
        tot_n = sum(len(p["text"]) for p in grp)
        lines.append({
            "gi": gi, "y": grp[0]["bbox"][1],
            "text": clean(" ".join(p["text"] for p in grp)),
            "size": med(sizes),
            "bold": bold_n > tot_n * 0.6,
            "x0": x0, "x1": x1,
        })
    lines.sort(key=lambda l: (l["gi"], l["y"], l["x0"]))
    return [l for l in lines if l["text"] and not is_noise(l["text"], None)]


# ---------------------------------------------------------------- 主体
def norm_key(t):
    """归一化：去数字、去标点、压空白、小写。

    页眉页脚每页只有页码/期号不同（"2 of 16" / "4 of 16"），
    精确相等统计会漏掉它们，归一化后才能按"重复出现"识别。
    """
    t = t.lower()
    t = re.sub(r"\d+", "", t)
    t = re.sub(r"[^\w\u4e00-\u9fa5]+", "", t)
    return t


def collect_repeat_lines(doc):
    """跨页重复出现的短行 = 页眉/页脚/期刊名/running head。返回需剔除的归一化集合。"""
    cnt = Counter()
    for page in doc:
        seen = set()
        h = page.rect.height
        for s in page_spans(page):
            y = s["bbox"][1]
            if y < h * HEADER_ZONE or y > h * FOOTER_ZONE:
                k = norm_key(clean(s["text"]))
                if len(k) >= 4 and k not in seen:
                    seen.add(k)
                    cnt[k] += 1
    n = max(1, doc.page_count)
    return {t for t, c in cnt.items() if c >= max(3, n * 0.45)}


def pdf_to_md(path):
    t0 = time.time()
    doc = pymupdf.open(path)
    repeat = collect_repeat_lines(doc)
    pages_txt, chars = [], 0
    body_sizes = []
    straddle_lines = 0      # 横跨两栏的行数（分栏失败的典型症状）
    total_lines = 0
    bad_chars = 0
    for page in doc:
        sp = page_spans(page)
        for s in sp:
            body_sizes.append(s["size"])
    body_med = med(body_sizes) or 10.0

    for pno, page in enumerate(doc, 1):
        spans = page_spans(page)
        # 先剔页眉页脚（按重复文本 + 坐标带）
        keep = []
        for s in spans:
            y = s["bbox"][1]
            t = clean(s["text"])
            k = norm_key(t)
            in_zone = y < page.rect.height * HEADER_ZONE or y > page.rect.height * FOOTER_ZONE
            if k in repeat:
                continue
            # 页眉/页脚带内：页码样式、或很短的非正文行，一并剔除
            if in_zone and (len(t) < 60 or re.fullmatch(r"[\d\s.,;:/\-–—of]+", t, re.I)):
                continue
            keep.append(s)
        bands = column_bands(keep, page.rect.width)

        # 首页右侧边栏（MDPI 的 Citation / Published / Copyright 块）：
        # 它与正文的 y 完全交错，混在一起排会把正文冲散。整块挪到页末。
        side_txt = ""
        if pno == 1 and len(bands) == 1:
            w = page.rect.width
            side = [s for s in keep if s["bbox"][0] > w * 0.62]
            if 6 <= len(side) < len(keep) * 0.5:
                ids = {id(s) for s in side}
                keep = [s for s in keep if id(s) not in ids]
                side_lines = merge_lines(side, [(0, w)], w)
                side_txt = "\n".join(l["text"] for l in side_lines)
                bands = column_bands(keep, w)

        lines = merge_lines(keep, bands, page.rect.width)

        # 分栏失败的检测：判成双栏却仍有大量行横跨两栏，说明左右栏被拼成了一句。
        # 这类文本读起来通顺，只是句子被拦腰打断，肉眼与字数统计都发现不了。
        if len(bands) == 2:
            mid = bands[0][1]
            total_lines += len(lines)
            straddle_lines += sum(1 for ln in lines if ln["x0"] < mid - 2 and ln["x1"] > mid + 2)

        # 表格：单独处理，占位后替换
        tables = []
        try:
            for tb in page.find_tables().tables:
                rows = tb.extract()
                if not rows or len(rows) < 2:
                    continue
                rows = [[clean(c) if c else "" for c in r] for r in rows]
                w = max(len(r) for r in rows)
                rows = [r + [""] * (w - len(r)) for r in rows]
                md = "| " + " | ".join(rows[0]) + " |\n"
                md += "| " + " | ".join(["---"] * w) + " |\n"
                for r in rows[1:]:
                    md += "| " + " | ".join(r) + " |\n"
                # 表格也要带栏号，否则双栏页里会与正文错位
                tcx = (tb.bbox[0] + tb.bbox[2]) / 2
                tgi = 0
                for bi, (ba, bb) in enumerate(bands):
                    if ba <= tcx < bb:
                        tgi = bi
                        break
                tables.append({"y": tb.bbox[1], "gi": tgi, "md": md})
        except Exception:
            pass

        out = []
        items = []
        for ln in lines:
            ratio = ln["size"] / body_med if body_med else 1
            if ratio >= 1.55 or (ratio >= 1.25 and ln["bold"]):
                lvl = 1
            elif ratio >= TITLE_RATIO and len(ln["text"]) >= MIN_TITLE_LEN:
                lvl = 2 if ratio >= 1.30 else 3
            else:
                lvl = 0
            if lvl and (len(ln["text"]) >= 120 or looks_like_formula(ln["text"])):
                lvl = 0
            # 有些期刊的章节标题与正文同字号、仅加粗（IEEE 体例），靠编号模式兜住
            if not lvl and ln["bold"] and len(ln["text"]) < 80 and SECTION_RE.match(ln["text"]):
                lvl = 2
            items.append({"gi": ln["gi"], "y": ln["y"], "text": ln["text"], "lvl": lvl})

        # 合并跨行标题：同栏、同级、上一行未以句末标点收尾 → 视为同一个标题被排版折断
        merged = []
        for it in items:
            p = merged[-1] if merged else None
            if (p and it["lvl"] and p["lvl"] == it["lvl"] and p["gi"] == it["gi"]
                    and not re.search(r"[.!?:;。！？：；]$", p["text"]) and len(p["text"]) < 100):
                if p["text"].endswith("-"):
                    p["text"] = p["text"][:-1] + it["text"]
                else:
                    p["text"] = p["text"] + " " + it["text"]
                p["y"] = min(p["y"], it["y"])
                continue
            merged.append(it)

        # 排序键必须是 (栏号, y)：只按 y 排会按行把左右两栏交错，
        # 右栏 y 略小于左栏某行时就会插到前面，整页阅读顺序被打散。
        for it in merged:
            key = (it["gi"], it["y"])
            if it["lvl"]:
                out.append(("\n" + "#" * it["lvl"] + " " + it["text"] + "\n", key))
            else:
                out.append((it["text"], key))
        for tb in tables:
            out.append(("\n" + tb["md"], (tb.get("gi", 0), tb["y"])))

        out.sort(key=lambda x: x[1])
        txt = "\n".join(o[0] for o in out)
        if side_txt:
            kept = [l for l in side_txt.split("\n")
                    if re.match(r"(citation|published|received|accepted|revised|copyright|licensee|academic editor|doi)", l.strip(), re.I)]
            if kept:
                txt += "\n\n<!-- 出版信息（原页右侧边栏） -->\n" + "\n".join(kept)
        txt = re.sub(r"\n{3,}", "\n\n", txt)
        # 引用标记归一：把孤立的上标数字压成 [n]
        pages_txt.append("<!-- page %d -->\n%s" % (pno, txt))
        chars += len(txt)

    doc.close()
    md = "\n\n".join(pages_txt)
    cpp = chars / max(1, len(pages_txt))
    # 乱码判定：字体编码坏掉的 PDF 会抽出大量 U+FFFD，字符数达标但内容不可读，
    # 只按 chars_per_page 判 OCR 会把这类文件误判为"抽取成功"。
    dense = re.sub(r"\s+", "", md)
    bad_chars = dense.count("\ufffd")
    garble_ratio = bad_chars / max(1, len(dense))
    straddle_ratio = straddle_lines / max(1, total_lines)
    return {
        "md": md,
        "pages": len(pages_txt),
        "chars": chars,
        "chars_per_page": round(cpp),
        "needs_ocr": cpp < MIN_CHARS_PER_PAGE,
        "empty": chars == 0,
        "garbled": garble_ratio > GARBLE_RATIO,
        "garble_ratio": round(garble_ratio, 3),
        "colswap": straddle_ratio > STRADDLE_RATIO,
        "straddle_ratio": round(straddle_ratio, 3),
        "seconds": round(time.time() - t0, 2),
    }


def upsert(manifest, idx, entry):
    """按 file 合并 manifest：同一文件覆盖旧条目，新文件追加。"""
    key = entry.get("file")
    if key in idx:
        manifest[idx[key]] = entry
    else:
        idx[key] = len(manifest)
        manifest.append(entry)
    return manifest, idx


def main():
    global MIN_CHARS_PER_PAGE
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("-o", "--out", default="_extract")
    ap.add_argument("--check-only", action="store_true",
                    help="只判别可抽取性与是否扫描件，不写 md 文件。给数字版 PDF 跑 OCR 之前先跑这个")
    ap.add_argument("--min-chars", type=int, default=MIN_CHARS_PER_PAGE,
                    help="每页最少字符数，低于此值判为扫描件（默认 %d）" % MIN_CHARS_PER_PAGE)
    ap.add_argument("--allow-empty", action="store_true",
                    help="允许正文为空的文件通过（默认阻止，退出码 2）")
    ap.add_argument("--write-anyway", action="store_true",
                    help="即使判为扫描件/空壳也照写 md（会产出空文件，通常不该用）")
    a = ap.parse_args()

    MIN_CHARS_PER_PAGE = a.min_chars

    src = os.path.abspath(a.src)
    if os.path.isdir(src):
        files = sorted(f for f in os.listdir(src) if f.lower().endswith(".pdf"))
        files = [os.path.join(src, f) for f in files]
    else:
        files = [src]
    if not files:
        print("没有找到 PDF", file=sys.stderr)
        sys.exit(1)

    os.makedirs(a.out, exist_ok=True)
    mf = os.path.join(a.out, "manifest.json")
    # manifest 合并而不是覆盖：按年份/按批次分次跑是标准用法，整体覆盖会把
    # 前几批的页数/字数/OCR 统计冲掉，事后无法追溯"这批到底抽得怎么样"。
    manifest, idx = [], {}
    if os.path.isfile(mf):
        try:
            old = json.loads(io.open(mf, encoding="utf-8-sig").read())
            if isinstance(old, list):
                manifest = [m for m in old if isinstance(m, dict)]
                idx = {m.get("file"): i for i, m in enumerate(manifest)}
        except Exception as e:
            print("旧 manifest 无法读取，将重建：%s" % e)

    for i, f in enumerate(files, 1):
        base = os.path.basename(f)
        stem = os.path.splitext(base)[0]
        try:
            r = pdf_to_md(f)
        except Exception as e:
            print("[%d/%d] %s  失败：%s" % (i, len(files), stem[:40], e))
            manifest, idx = upsert(manifest, idx, {"file": base, "stem": stem, "error": str(e)})
            continue
        dst = os.path.join(a.out, stem + ".md")
        # 正文为空 / 判为扫描件：默认不写 md。写出来也只是空文件或纯噪声，
        # 下游会当成"有正文"继续统计 —— 空壳论文混进文献库的主要途径。
        blocked = r["needs_ocr"] or r["empty"]
        wrote = False
        if not a.check_only and (not blocked or a.write_anyway):
            io.open(dst, "w", encoding="utf-8", newline="\n").write(r["md"])
            wrote = True
        if r["empty"]:
            tag = "空壳"
        elif r["garbled"]:
            tag = "乱码"
        elif r["colswap"]:
            tag = "分栏错乱"
        elif r["needs_ocr"]:
            tag = "需OCR"
        else:
            tag = "正常"
        print("[%d/%d] %-42s %3d页 %6d字 %5d字/页 %5.2fs  %s"
              % (i, len(files), stem[:42], r["pages"], r["chars"], r["chars_per_page"], r["seconds"], tag))
        if blocked and not a.check_only:
            print("        未写 md（%s）；确认可用加 --write-anyway"
                  % ("正文为空" if r["empty"] else "需 OCR"))
        manifest, idx = upsert(manifest, idx, {
            "file": base, "stem": stem,
            "md": (os.path.basename(dst) if wrote else None),
            "pages": r["pages"], "chars": r["chars"],
            "chars_per_page": r["chars_per_page"],
            "needs_ocr": r["needs_ocr"], "empty": r["empty"],
            "garbled": r["garbled"], "garble_ratio": r["garble_ratio"],
            "colswap": r["colswap"], "straddle_ratio": r["straddle_ratio"],
            "blocked": blocked, "seconds": r["seconds"],
        })

    empty = [m for m in manifest if m.get("empty")]
    garbled = [m for m in manifest if m.get("garbled") and not m.get("empty")]
    colswap = [m for m in manifest if m.get("colswap") and not m.get("empty")]
    errored = [m for m in manifest if m.get("error")]
    ocr = [m for m in manifest if m.get("needs_ocr") and not m.get("empty")]

    if a.check_only:
        need = [m for m in manifest if m.get("needs_ocr") or m.get("error") or m.get("garbled")]
        print("\n可抽取性判别：%d 篇中 %d 篇可直接抽取，%d 篇需 OCR / 已损坏"
              % (len(manifest), len(manifest) - len(need), len(need)))
        for m in need[:20]:
            print("  - " + m.get("file", "?"))
        return

    io.open(mf, "w", encoding="utf-8", newline="\n").write(json.dumps(manifest, ensure_ascii=False, indent=1))

    print("\n输出：%s（manifest 累计 %d 篇）" % (os.path.abspath(a.out), len(manifest)))
    if empty:
        print("[阻止] %d 篇正文为空（0 字符），未写 md：" % len(empty))
        for m in empty[:10]:
            print("  - " + m.get("file", "?"))
        print("  这类文件多为占位页、只有封面图或加密 PDF，硬抽不出任何内容。")
    if errored:
        print("[阻止] %d 篇解析异常：" % len(errored))
        for m in errored[:10]:
            print("  - %s：%s" % (m.get("file"), m.get("error")))
    if garbled:
        print("[警告] %d 篇疑似乱码（U+FFFD 占比 > %d%%），字符数达标但内容不可读："
              % (len(garbled), int(GARBLE_RATIO * 100)))
        for m in garbled[:10]:
            print("  - %s（%.1f%%）" % (m.get("file"), (m.get("garble_ratio") or 0) * 100))
        print("  建议用 MinerU 重解析，或人工确认是否字体编码问题。")
    if colswap:
        print("[警告] %d 篇疑似分栏错乱（跨栏行 > %d%%），左右栏可能被拼成一句："
              % (len(colswap), int(STRADDLE_RATIO * 100)))
        for m in colswap[:10]:
            print("  - %s（%.1f%%）" % (m.get("file"), (m.get("straddle_ratio") or 0) * 100))
        print("  这类文本字数是达标的，只能靠人读：抽一段摘要看句子是否被拦腰打断。")
    if ocr:
        print("[提醒] %d 篇判为扫描件（< %d 字/页），未写 md。" % (len(ocr), MIN_CHARS_PER_PAGE))

    blocked_n = len(empty) + len(errored)
    if blocked_n and not a.allow_empty:
        print("\n[已阻止] %d 篇无法产出正文，禁止继续。" % blocked_n)
        print("  这些文件若照常入库，会以空壳身份静默计入篇数、主题分布与质量统计，")
        print("  页面上完全看不出来。修正文件后重跑会自动覆盖同一条 manifest；")
        print("  确认要放行，加 --allow-empty。")
        sys.exit(2)


if __name__ == "__main__":
    main()
