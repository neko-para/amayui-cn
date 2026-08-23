---
name: amayui-ui-text-render
description: 汉化《天結いキャッスルマイスター》(Amayui Castle Meister) 游戏 UI 图片中的文字：用 scan_blocks/amayui_uimap 定位按钮连通块、clean_fill 清理原日文、HTML+CSS 渲染简体中文、headless Chrome 截图、AGF 注入、res/patch 同步与文档记录。支持纯文本行、纯色底/渐变底按钮、多行面板、同图三列变体等。当用户要求处理 SO00x / AGF / UI 图片中的文字行、按钮/菜单文字、把图片内文本替换为中文时使用。样式参数（尤其文字颜色、描边、阴影、字号、字体）必须逐场景由用户确认，不得套用其它场景默认值；处理前先查 docs/images/README.md 与 FONT.md 效果速查。
---

# Amayui UI 文本渲染

用于《天結いキャッスルマイスター》汉化工程的 UI 图片（AGF/PNG）中文字的中文化。工程根目录：`E:\Games\Eushully\天結`。

> **目标**：让新会话快速重建「编辑图片的环境」——知道去哪里找已有文档、用什么工具定位/清理、走什么流程、往哪里同步产物。**上手前先读「文件结构导航」与「FONT.md 效果速查」。**

---

## 1. 文件结构导航（先读它）

### 1.1 图片源与产物（res/images）

| 路径 | 说明 |
|---|---|
| `res\images\<NAME>-0.png` | 该图**原图**（未处理副本），来源通常是 `install\DATA1-png\<NAME>.png`。 |
| `res\images\<NAME>-N.png` | 按步骤递增的**中间/最终版本**（`-1`、`-2`…）。**版本号最高者生效**；无裸 `<NAME>.png`。 |
| `res\images\<NAME>.AGF` | 该图注入后的 AGF（= `install\<NAME>.AGF`，哈希一致）。 |
| `res\images\fonts\` | UI 文字效果**示例图**（E1/E2/…/E10 截图），供 FONT.md 引用。 |
| `res\fonts\SarasaGothicSC\` | 渲染统一字体（`SarasaGothicSC-Regular.ttf` + `-Bold.ttf`）。 |

### 1.2 AGF 源与安装目标

| 路径 | 说明 |
|---|---|
| `install\DATA1\<NAME>.AGF` | **原始 AGF**（引擎 ALF 内容，未修改，作注入底）。 |
| `install\<NAME>.AGF` | **overlay AGF**（注入产物，引擎读取优先于 ALF）。**这是安装目标**。 |
| `patch\AGF\<NAME>.AGF` | 补丁包同步副本（= install overlay）。 |
| `patch\patch.config.json` | 补丁同步清单（新增文件在此登记，`dst` 用 `AGF/<NAME>.AGF`）。 |

> 还原原始图：从 `install\DATA1\<NAME>.AGF` 复制覆盖 install 根即可。

### 1.3 文档（docs/images）——处理前必查

| 路径 | 说明 |
|---|---|
| `docs\images\README.md` | **总索引**：所有已编辑 UI 图的变更内容表（区域/文案/效果/坐标/当前版本/详情链接），重绘时逐图核对。 |
| `docs\images\FONT.md` | **文字效果总览**：工程内所有**已确认**的文字渲染效果（**E1–E10**，含 CSS 参数与 HTML 结构）。**新场景样式必须经由用户确认，禁止直接套用**，但可参考已确认 preset 的骨架。 |
| `docs\images\<NAME>.md` | 各图独立文档：区域、坐标、清理方案、**用户确认的 CSS**、产物、复现命令。 |
| `docs\images\阴刻文字.md` | SO009B 第一列阴刻 outline 特效研究与方案。 |

> **入口顺序**：`README.md`（选图）→ `<NAME>.md`（该图细节）→ `FONT.md`（效果复现）。

### 1.4 工具（scripts）

| 工具 | 用途 |
|---|---|
| `scripts\uimap\scan_blocks.py` | **工具 A · UI 元素地图**：一次扫描，输出自包含 HTML，浏览器里看图点选定位按钮/面板连通块，导出 `<名>_selected.json`。替代旧的「猜坐标→cc_scan 逐点查询」。 |
| `scripts\uimap\clean_fill.py` | **工具 B · 清理执行器**：列填充 / 行填充 / 置透明 / 跨图贴底图 / 局部恢复（详见其 README）。 |
| `scripts\uimap\README.md` | 两工具详细用法与参数。 |
| `scripts\agf\cli.js` | AGF 注入：`node scripts/agf/cli.js inject <原AGF> <PNG> -o <输出AGF>`（8bpp + ACIF）。 |
| `scripts\sync-patch.js` | `npm run sync-patch`：按 `patch.config.json` 同步补丁包（res → patch）。 |
| `scripts\manifest.js` | `npm run manifest [-- <NAME>.AGF]`：更新 `install-manifest.json`。 |

> 集成工具 `amayui_uimap`（Host 侧，封装 scan_blocks + 清理工作台 + 导出方案）是当前**定位/清理的主入口**；命令行 `scripts/uimap/*.py` 是等价底层工具，可脚本化复用。

---

## 2. 处理流程（总览）

```
定位(scan_blocks/amayui_uimap) → 清理(clean_fill) → 渲染(HTML+headless Chrome)
  → 注入 AGF(agf/cli.js) → 同步 res/patch → manifest → 记录文档
```

每步之前**必须先查 `docs/images/README.md` 与 `<NAME>.md`**——若该图已被处理，直接在其版本上继续；若已有效果 preset，直接复用骨架，**只需用户确认样式色值**。

## 3. 样式确认原则（每场景必做）

- 文字颜色、描边、阴影、字号、字体**因图而异**；`FONT.md` 里已有效果（E1–E10）**只是该场景案例，不是默认值**，禁止直接套用。
- 主色由对原图**采样** + 用户确认；最终 CSS 是**唯一样式来源**，写入 `docs/images/<NAME>.md`。
- 若新场景与某 preset 结构相同（如同一底图三列切换、同字宽缩放），**复用其 CSS 骨架**、仅改色值，仍须用户确认。

## 4. 定位（工具 A）

用 `amayui_uimap` 或命令行：

```bash
python scripts/uimap/scan_blocks.py <png> [--alpha 128] [--min-px 300] [--out <名>_blocks.html]
```

- 输出自包含 HTML → 浏览器打开 → 悬停看编号/坐标、点击选中 → 导出 `<名>_selected.json`。
- `components` 数组即后续清理输入区域：`{ index, x0, y0, x1, y1, w, h, px }`。
- 块颜色按面积分级：橙 ≥100k（大背景面板）、蓝 ≥3k、绿 ≥500、灰更小。
- 实体范围 `alpha≥128`（含黑边框）；完整范围 `alpha≥1`（含羽化）。

## 5. 清理（工具 B）

用 `amayui_uimap` 清理工作台（导出 `.tmp/<名>_clean.json` + `.sh`），或直接 `clean_fill.py`：

```bash
python scripts/uimap/clean_fill.py <png> <out> --x0 X --y0 Y --x1 X --y1 Y [选项]
# 列填充（默认）：保留左右 N、中间逐行复制 fill-col 列（竖向一致的纯色/渐变底）
python scripts/uimap/clean_fill.py res/images/SO020-0.png out.png --x0 1006 --y0 6 --x1 1147 --y1 25 --keep-l 15 --fill-col 1021
# 行填充：背景横向一致（纯色/横向渐变/横向纹理），保留上下、按行抹除
python scripts/uimap/clean_fill.py res/images/SO020-0.png out.png --x0 1006 --y0 6 --x1 1147 --y1 25 --keep-t 5 --keep-b 5 --fill-row 11
# 置透明：python scripts/uimap/clean_fill.py <png> <out> --x0..--y1 --transparent
# 跨图贴底图：--paste-src <src.png> --paste-x0..（从其它干净图贴背景）
# 局部恢复：--restore-x0 --restore-y0 --restore-x1 --restore-y1（复杂拼接后覆盖）
```

**清理规则速查**（详见 `scripts/uimap/README.md`）：

| 底 | 保留 | 填充源 |
|---|---|---|
| 纯色底按钮 | 左/右 15px | 第 16px 列 |
| 渐变底按钮 | 左/右 20px | 第 21px 列（保留每行渐变值） |
| 多行面板 | 左/右 40px | 第 41px 列 |
| 小按钮块 | 左/右 23px | 第 24px 列 |

- **填充前必须检查**该列是否穿过文字笔画（统计列上深色像素行数，仅顶/底边框行深色才干净）；
- 左右 N px 内的黑边框/斜角装饰**原样保留**；
- 复杂场景（渐变不随单列、需保左缘高光、字内半透明等）可改用**拉普拉斯/曲面拟合填补文字区**：仅填文字 box、边界钉死为四周真实渐变、box 外扩 2px 扫掉字形黑晕（见 SO001/SO039 处理）。

## 6. 渲染（HTML + headless Chrome）

1. **字体**：Sarasa Gothic SC。渲染页必须加 @font-face 引用本地文件（防 headless 拉丁 fallback，见 FONT.md 踩坑 7）：
   ```css
   @font-face { font-family:"Sarasa Gothic SC"; src:url("<相对路径>/SarasaGothicSC-Regular.ttf"); font-weight:400; }
   @font-face { font-family:"Sarasa Gothic SC"; src:url("<相对路径>/SarasaGothicSC-Bold.ttf"); font-weight:700; }
   ```
   相对路径：渲染页在 `.tmp` 下 → `../res/fonts/SarasaGothicSC/...`；在 `.tmp/ui-redraw/<图>` 下 → `../../../res/fonts/...`。
2. **画布**：`html,body{ margin:0;padding:0;width:<W>px;height:<H>px;background:transparent;overflow:hidden;}`，垫底 `<img id="bg">` = 清理后整图。
3. **文字**：`.btn/.ln` 定位；按钮模式 `text-align:center; line-height:<块高>px` 居中（或 flex/grid 居中）；多色/渐变压多层兄弟节点（`.in/.out` 或 `.shd/.gout/.gin`，`grid-area:1/1` / `position:absolute` 叠放），每层 `-webkit-text-stroke` 与 `background-clip:text` 分开。**骨架参考 `FONT.md` 对应 preset**；渐变/描边/阴影按用户确认值填入。
4. **截图**（headless Chrome **需提权**，沙箱内会 crashpad/mojo 崩溃——本会话已授 `danger-full-access`）：
   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu --no-first-run `
     --user-data-dir="E:\Games\Eushully\天結\.tmp\chrome_tmp" `
     --screenshot="E:\Games\Eushully\天結\.tmp\<name>_cn.png" `
     --window-size=<W>,<H> --force-device-scale-factor=1 --default-background-color=00000000 `
     "file:///E:/Games/Eushully/天結/.tmp/<name>_render.html"
   ```
   > 输出 PNG 应为不透明（alpha 全 255）——垫底图覆盖整画布；若需给用户看「CSS 效果对比」可保留 HTML 交付，截图仅用于自检。

## 7. 注入 AGF 到 install 根（overlay）

```bash
cd scripts
node agf/cli.js inject "E:\Games\Eushully\天結\install\DATA1\<NAME>.AGF" "E:\Games\Eushully\天結\res\images\<NAME>-N.png" -o "E:\Games\Eushully\天結\install\<NAME>.AGF"
```

- 底用**原版** `install\DATA1\<NAME>.AGF`；产物 `install\<NAME>.AGF` 为 **overlay**，引擎优先于 ALF。
- 8bpp 按原调色板量化，渐变/抗锯齿有损；有头注入为无压缩写入，体积膨胀属正常。

## 8. 同步与记录

1. 复制注入后的 AGF 到 `res\images\<NAME>.AGF` 与 `patch\AGF\<NAME>.AGF`（三份 MD5 必须一致）。
2. **首次新增文件**在 `patch\patch.config.json` 登记：`{ "src": "res/images/<NAME>.AGF", "dst": "AGF/<NAME>.AGF" }`。
3. `cd scripts` → `npm run sync-patch`（同步补丁包）。
4. `npm run manifest -- <NAME>.AGF`（更新 install-manifest.json；本会话 `npm run` 前缀已自动批准）。
5. 记录到 `docs/images/<NAME>.md`：区域/坐标、清理方案、**用户确认的 CSS**、产物、复现命令、状态。
6. 更新 `docs/images/README.md` 总览表（图、尺寸、变更内容、当前版本、详情链接）；若有新效果，同步 `docs/images/FONT.md`（新 preset 编号 + 示例图到 `res/images/fonts/`）。
7. 追加 `patch\CHANGELOG.md`（新版本节最上方、`- [类型][标签]` 单条 bullet）。

## 9. 注意

- **版本命名**：`res\images\<NAME>-0.png` 原图，`-N` 递增，**最高版本号生效**。
- **差异校验**：清理/渲染后，确认改动只落在目标区域（周围 diff=0、无增污）。
- **无阴影 vs 有阴影**：是否带阴影逐场景由用户确认（如 SO001 三列中仅列1 有阴影）。
- **headless 拉丁 fallback**：不加 @font-face 时，headless 对拉丁/罗马数字走系统字体（与浏览器不一致）。
- **宽度测量**：需字体就绪后测（`await document.fonts.load(...); await document.fonts.ready`），否则量到 fallback 宽度。

## 10. 脚本与参考（本 skill 自带）

- `scripts/analyze_text_area.py`：颜色 mask + 投影分段，输出行/列范围与主色（**仅作二维粗定位/主色建议**；块定位请用 `scripts/uimap/scan_blocks.py`）。
- `scripts/clean_text_area.py`：指定区域置透明（旧式，可改用 `clean_fill.py --transparent`）。
- `scripts/cc_scan.py`：连通块扫描/坐标查询（旧式，已被 `scan_blocks.py` 取代）。
- `assets/style_tuner.html`：**逐场景样式调试页模板**（浏览器交互调参，确认后复制 CSS）。注意：当前模板仍引用 WenQuanYi，需按场景改用 Sarasa SC。
- `references/ui-text-styles.md`：调试页用法、渲染模板、AGF 注入、案例参数（部分为 WenQuanYi 旧案例，参数只适用各自图片）。

## 11. 本次会话已确认的关键事实（2026-08）

- 字体统一 **Sarasa Gothic SC**（bold 需显式 @font-face weight 700），默认渲染字号/缩放、阴影有无逐场景定。
- SO001 已处理为**同一底图三列可切换**，入 FONT.md **E10**「同纹三列变体（同图切换）」：列1 米白 黄金渐变字+深棕描边 `2px #3A2709`+黑阴影；列2 纯青 白→青渐变字+深蓝描边 `2px #1438E0`（无阴影）；列3 灰 半透明黑渐变叠灰底+黑描边 `2px rgba(0,0,0,0.6)`（无阴影）。Sarasa bold 22px；字宽 4字 `scaleX(0.6)` / 2·3字 `scaleX(0.8)`；三层 `grid-area:1/1`。**新图若为同构场景，直接复用 E10 骨架、仅换色值并经用户确认。**
- AGF 注入输出体积约等于输入 PNG 的有头体积（SO001 4,588,672 B）。
