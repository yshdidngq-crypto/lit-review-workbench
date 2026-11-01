# -*- coding: utf-8 -*-
"""把 KaTeX 的 CSS 与字体做成可内联的离线资产（一次性脚本，产物已入库）。

做法：
  1. 只保留 woff2（Edge/Chrome/Firefox 都支持），丢掉 woff/ttf 回退，体积省 2/3；
  2. 每个 @font-face 的 src 替换成 base64 data URI —— 单文件 HTML 断网也能排版；
  3. 输出 assets/katex.css。
"""
import base64
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
OUT = os.path.join(SKILL, "assets", "katex.css")

css_path, font_dir = sys.argv[1], sys.argv[2]
css = io.open(css_path, encoding="utf-8").read()

cache = {}


def data_uri(name):
    if name not in cache:
        p = os.path.join(font_dir, name)
        b = io.open(p, "rb").read()
        cache[name] = "data:font/woff2;base64," + base64.b64encode(b).decode("ascii")
    return cache[name]


def fix_face(m):
    block = m.group(0)
    w = re.search(r"url\(fonts/([^)]+\.woff2)\)", block)
    if not w:
        return block
    uri = data_uri(w.group(1))
    # 把整段 src: ... ; 换成一个 woff2
    return re.sub(r"src:[^;}]+", "src:url(%s) format('woff2')" % uri, block, count=1)


css2 = re.sub(r"@font-face\{[^}]*\}", fix_face, css)
left = re.findall(r"url\(fonts/[^)]+\)", css2)
if left:
    raise SystemExit("还有未内联的字体引用：%s" % left[:3])
io.open(OUT, "w", encoding="utf-8", newline="\n").write(css2)
print("写出 %s（%.0f KB）" % (OUT, os.path.getsize(OUT) / 1024))
