# 文献综述工作台 · Lit Review Workbench

把一批论文（PDF / 精读结果 / CSV / Zotero 导出）压成**一份单文件、离线、可交互的 HTML 工作台**：
十个视图、可筛选、可对比、可记录你的阅读与决策 —— 而不是一堆截图、表格和读不完的备忘录。

> 给谁用：要写综述、开题、做文献调研的本科生与研究生；一次要面对 20–200 篇文献的人。

> 当前版本：**4.9.1（无工程实验室版）**。这个包里不含「工程实验室」模块（仍在开发中），
> 即使你放了 `data/lab.json`、写了 `features.lab`、或构建时加 `--with-lab`，那一页也不会出现。

---

## 它解决什么问题

读完 30 篇论文以后，人真正的困境不是"没读过"，而是：

- **记不住读过什么** —— 三天后只剩下一个模糊印象；
- **比不了** —— 每篇的方法、数据、指标散落在各自 PDF 里，横向比较要靠重读；
- **说不出空白在哪** —— 想知道"这个方向谁做过、缺什么"，却没有一张能看的图；
- **决策留不下来** —— 为什么选中这条路线、为什么放弃那条，全在脑子里。

这个工作台把上面四件事压进**一个 HTML 文件**：双击打开、不联网、不装环境、不发一行数据出去。

## 十个视图

| 视图 | 里面是什么 |
| --- | --- |
| 总览 | 规模、年份、主题构成、质量标记、薄弱环节 |
| 研究现状 | 八问式现状报告（Q1–Q8），每条答案强制带口径声明与 caveat |
| 技术图谱 | 主题 × 技术环节矩阵、方向树 |
| 方向探索 | 方向的风险/成熟度/机会分、与本库文献的双向关联 |
| 外部文献 | 检索来的候选、开放获取状态、为什么推荐 |
| 文献数据库 | 全字段表格 + 筛选 + 搜索 + 对比篮 |
| 文献对比 | 选定几篇的横向对照 |
| 学习决策中心 | 六维加权评分、优先级、决策题 |
| 阅读进度 | 阅读状态、笔记、导出 |
| 检索记录 | 检索式、命中数、筛选漏斗、被排除的样本 |

## 三个特点

**1. 单文件离线**
产物是 1–2 MB 的 HTML，内联 CSS/JS/图表代码（含 KaTeX）。没有后端、没有 CDN、没有网络请求。
发给同学，他双击就能看。

**2. 视觉锁死**
样式与图表代码只在 `assets/` 里，构建时**只从 skill 自己读**，不读你项目里的同名文件。
效果：换人、换机器，产出是一样的。
（这一点是实测过的：往项目里放一个假的 `base.css` 写着 `--brand:#FF0000`，构建产物里一个字节都不会出现。）

**3. 三道可执行门禁**
文档会漂，脚本不会。每次构建后依次跑：

| 门禁 | 查什么 |
| --- | --- |
| `node scripts/validate.js <dist.html>` | 30 项结构/内容检查（骨架、数据段、字段、编号、文案腔调、AI 味套话…） |
| `node scripts/smoke.js <dist.html>` | 把每个视图与详情标签真跑一遍，查异常、空渲染、`undefined`/`NaN` 泄漏 |
| `node scripts/test_click.js <dist.html>` | 用本机浏览器真点一遍年份条，验交互没坏（没有浏览器时退出码 2 = 没测，不算通过） |

两个细节，是这一版刻意修的：

- **"没数据所以跳过"不再算通过**：缺少对应数据时输出 `○ 未查`，与 `✓ 通过` 分开计数，
  汇总行会写清「X 项通过、Y 项无数据未查，共 N 项」。
- **`undefined` / `NaN` 双层查**：`validate.js` 查静态文本与数据段，`smoke.js` 查运行时拼出来的字符串。

## 快速开始

```bash
cd 文献综述工作台

# 1) 用自带的 24 篇真实论文示例跑一遍
python scripts/build.py demo
node scripts/validate.js "demo/dist/RGBFusion_文献工作台.html"
node scripts/smoke.js   "demo/dist/RGBFusion_文献工作台.html"

# 2) 换成你自己的项目（先复制一份 demo 当模板，别改 demo 本身）
cp -r demo my-review
python scripts/build.py my-review
```

构建成功会打印数据规模、侧栏入口、内容层来源，并提示下一条该跑什么命令。

**依赖**：Python 3.9+ 与 Node.js 18+；`build.py` 只用标准库。
只有 `scripts/pdf2md.py`（把 PDF 抽成 markdown）需要 `python -m pip install pymupdf`。

**不想跑代码？** 直接双击 `文献综述工作台/demo/dist/RGBFusion_文献工作台.html` 看成品。

## 怎么装进 WorkBuddy

```bash
# Windows
xcopy /E /I 文献综述工作台 "%USERPROFILE%\.workbuddy\skills\文献综述工作台"
# macOS / Linux
cp -r 文献综述工作台 ~/.workbuddy/skills/文献综述工作台
```

重启 WorkBuddy（它启动时扫描技能目录），之后说"用文献综述工作台做个 XX 方向的综述"即可。

没有 WorkBuddy 也能用：把 `SKILL.md` 整篇贴给任意一个能读写文件的 AI 助手，当作流程规范。

## 目录结构

```
文献综述工作台/
├── SKILL.md                流程规范（八步、二十条铁律、坑、自检清单）
├── 快速开始.md              给人看的：装、跑、常见故障
├── CHANGELOG.md            每次改动一行，写清"改了什么/为什么"
├── assets/                 ★ 视觉层，锁死，构建时只从 skill 自己读
│   ├── base.css  swiss.css（可选主题，默认不启用）
│   ├── katex.css  katex.min.js  math.js
│   ├── charts.js  ui.js  app.core.js  app.bind.js
│   └── views.base.js       ★ 通用骨架：不写代码也能出全站
├── scripts/
│   ├── build.py            数据 → 单文件 HTML
│   ├── validate.js         30 项检查
│   ├── smoke.js            渲染与交互冒烟
│   ├── test_click.js       真浏览器点击
│   ├── pdf2md.py           PDF → markdown（需要 pymupdf）
│   ├── discover.py         外部检索（OpenAlex / Crossref / arXiv / Semantic Scholar）
│   ├── landscape.py        现状八问
│   ├── link.py             方向 ↔ 文献双向关联
│   ├── doi_check.py        DOI 是否真的在注册中心存在
│   └── check_code.py       开源代码可用性核查
├── demo/                   24 篇真实论文的完整示例（含构建好的 dist）
├── examples/data_only/     只有 config.json + data/，一行代码不写也能出全站
└── references/01–07        数据契约 / 视觉规范 / 配置 / 校验清单 / 抽取 / 检索 / 方向
```

## 从 v4.5 到 v4.9.1 修了什么（挑要紧的）

- **门禁不再把"没查"和"没拦住"算成通过** —— 这是这几个月最重要的一次改动。
- **不再必须写代码**：`assets/views.base.js` 提供十个视图与九个详情标签的通用实现，
  只有 `config.json` + `data/papers.json` 也能出完整工作台。项目自己写 `src/views.js` 时按 id 覆盖即可。
- **`undefined`/`NaN` 双查**、**缺渲染函数直接判失败**（原来只提醒）。
- **DOI 要问注册中心**（Crossref → 不在则问 doi.org，覆盖 arXiv 的 DataCite 注册），
  因为"字段配对成功"不等于"这个 DOI 真的存在"。
- **无障碍**：跳转链接、`:focus-visible` 焦点环、`prefers-reduced-motion`、ARIA 语义，
  并把这些写进了结构基线（缺一项就判失败）。
- **PDF 抽取**：双栏按栏号排序（原来只按 y，会把左右栏交错）、PDF 断行自动接回整句。

## 已知限制（说实话）

- **它不替你读论文**。工作台只负责"把你说出来的东西组织好、把没说的空白显示出来"；
  哪篇好、哪个方向值得做，仍然要你自己判断。
- **PDF 抽取不是万能的**：扫描件没有文字层、公式多的版面、复杂表格都可能抽坏。
  抽不出来时脚本会明说"读不了"，不会编一段给你。
- **数据是你填的**。`papers.json` 里的结论、指标、失败模式如果写错，页面会忠实地把错的画出来 ——
  门禁只能查"有没有漏、格式对不对、有没有编数字"，查不了"学术判断对不对"。
- **示例数据是真实的 24 篇论文**，所以你会看到它的标题里有一处"基于基于"这类原文错误 ——
  那是 demo 的 `meta.json` 里登记过的真实数据质量问题，不是 bug。
- Windows 下 `.html` 的默认打开方式可能还是 IE，双击没反应就右键 → 打开方式 → Edge/Chrome。

## 协议

MIT，见 [LICENSE](LICENSE)。用它、改它、拿去交作业都行，保留署名即可。

如果它帮你省下了一个周末，欢迎点个 ⭐ —— 也欢迎提 issue 告诉我哪里不好用。
