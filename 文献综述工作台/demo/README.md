# demo · 参考实现

24 篇真实论文（取自红外与可见光图像融合的精读汇编），**十个视图全部实现**。
**不确定怎么写的时候，抄这里。**

```bash
# 在 Skill 根目录执行（顺序不能乱：landscape/link 要在 build 之前）
python scripts/landscape.py demo
python scripts/link.py      demo
python scripts/build.py     demo
node   scripts/validate.js "demo/dist/RGBFusion_文献工作台.html"
node   scripts/smoke.js    "demo/dist/RGBFusion_文献工作台.html"
```

`data/external.json` / `search_session.json` / `external_candidates.json` 是真实检索结果，
不必重跑 `discover.py`（重跑要联网，且结果会变）。想复现就执行：

```bash
python scripts/discover.py demo --en "uav multimodal image registration thermal visible" \
  --en "facade crack detection unmanned aerial vehicle thermography" \
  --platform "uav drone aerial" --object "building facade concrete crack" \
  --scenario "building facade crack detection" --modality "infrared thermal visible rgb"
```

---

## 为什么 demo 的档位是 60 / 45 / 35 / 28 / 0，而不是 85 / 70 / 50 / 30 / 0

这是本包里最值得学的一个细节。

`references/01_数据契约.md` 和 `SKILL.md` 给的推荐档位是 `85 / 70 / 50 / 30 / 0`，
那套数字适用于**完整批次**（300 篇以上、评分口径拉开）的情况。

但这 24 篇是抽样，它们的 `relevance` 实际分布是：

```
26 26 26 29 29 29 29 35 36 37 39 39 39 39 39 41 46 47 47 60 60 62 64 64
```

最高只有 **64**。如果照抄 85/70：

- 总览页「核心相关」永远显示 **0 篇**
- 「高相关」也永远 **0 篇**
- 「最接近本方向」这个主预设按钮，点下去是**空表**
- 相关档位分布图只剩两档，看不出结构

页面没报错、图表也画出来了，但**看起来像坏了**。这就是"阈值没落在真实分布上"的典型后果。

所以 demo 按分位数重定为 `60 / 45 / 35 / 28 / 0`，五档分别命中 5 / 3 / 9 / 4 / 3 篇，
四个预设分别命中 4 / 8 / 3 / 6 篇。

**你自己做项目时，第一件事就是统计 `relevance` 的分位数，再定 `bands.min`。**
判据：定完之后，最高档不该是空的，最低档也不该是空的，中间三档大致均匀。

---

## 另一个细节：阈值不要写死在 views.js 里

`demo/src/views.js` 的 `dash` 视图是这样取阈值的：

```js
const BANDS = (cfg.bands || []).slice().sort((a, b) => b.min - a.min);
const tCore = (BANDS[0] || { min: 85 }).min;
const tHigh = (BANDS[1] || BANDS[0] || { min: 70 }).min;
```

而不是 `p.relevance >= 85`。这样配置一改，KPI 文案里的「≥85」也跟着变，
不会出现"文案写着 85、实际按 60 判定"的自相矛盾。

同理，档位归属用 `bandNameOf(p.relevance)` 实时算，不要依赖 `papers.json` 里是否预存了 `band` 字段
——数据一旦重评分，预存的 `band` 就过期了。

---

## 文件

```
demo/
├── config.json        6 类主题 / 10 个技术环节 / 5 档评分 / 4 个预设
├── data/
│   ├── papers.json    24 篇，六个必填字段 + 完整长文本
│   └── meta.json      数据质量声明与薄弱环节
├── src/
│   ├── views.js       6 个视图
│   └── tabs.js        6 个详情标签
└── dist/              构建产物（跑 build.py 后生成）
```
