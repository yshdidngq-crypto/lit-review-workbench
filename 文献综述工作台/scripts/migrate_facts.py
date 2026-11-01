# -*- coding: utf-8 -*-
"""把 lab.json 里写死的 projectStage / mode / userKnowledgeLevel 迁成 profile.facts。

这脚本只跑一次，后面由数据自己带标签。"""
import io
import json
import sys

MAP = {
    "projectStage": "现在做到哪",
    "userKnowledgeLevel": "已有基础",
}
MODE_TEXT = {
    "A": "开发前做方案设计",
    "B": "完成后逆向复盘",
}


def migrate(path):
    d = json.load(io.open(path, encoding="utf-8-sig"))
    p = d.get("profile") or {}
    if isinstance(p.get("facts"), list) and p["facts"]:
        print("跳过（已有 facts）：%s" % path)
        return
    facts = []
    for k, label in MAP.items():
        if p.get(k):
            facts.append({"k": label, "v": p[k]})
    if p.get("mode"):
        facts.insert(1, {"k": "工作方式", "v": MODE_TEXT.get(p["mode"], p["mode"])})
    p["facts"] = facts
    for k in list(MAP) + ["mode"]:
        p.pop(k, None)
    d["profile"] = p
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(d, ensure_ascii=False, indent=1) + "\n")
    print("已迁移 %s → %d 条 facts" % (path, len(facts)))


if __name__ == "__main__":
    for a in sys.argv[1:]:
        migrate(a)
