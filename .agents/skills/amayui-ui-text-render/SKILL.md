---
name: amayui-ui-text-render
description: 汉化《天結いキャッスルマイスター》(Amayui Castle Meister) 游戏 UI 图片中的文字：定位文字区域/按钮连通块、清理原日文、用 HTML+CSS 渲染简体中文、headless Chrome 截图、注入 AGF、同步 res/patch。支持纯文本行、纯色底按钮、纵向渐变底按钮与多行面板（连通块定位 + 列填充清理 + 居中渲染）。当用户要求处理 SO00x / AGF / UI 图片中的文字行、按钮/菜单文字、把图片内文本替换为中文时使用。样式参数（尤其文字颜色、描边、阴影）必须逐场景由用户确认，不得套用其它场景的默认值。
---

# Amayui UI 文本渲染

用于《天結いキャッスルマイスター》汉化工程的 UI 图片（AGF/PNG）中文字的中文化。工程根目录：`E:\Games\Eushully\天結`。

## 适用与限制

- **支持**：
  - 透明背景或纯色背景上的纯文本行（例如 SO009A/SO009B 的金色文字菜单项）；
  - 纯色底按钮（米白底 + 深色文字，无边框）；
  - 纵向渐变底按钮/面板（黑色圆角边框 + 青蓝渐变）。
- **限制**：艺术字 / 非上述两类的复杂 UI 元素先与用户确认范围；样式参数（尤其文字颜色、描边、阴影）必须逐场景确认。
- 有头 AGF 注入为无压缩写入，产物体积明显膨胀（正常）。
- 8bpp AGF 注入时按原调色板量化，渐变/抗锯齿会有损失。

## 工作流

### 1. 分析原图

用 `scripts/analyze_text_area.py` 定位文字区域（脚本位于 `.agents/skills/amayui-ui-text-render/scripts/`，在工程根目录执行）：

```bash
python .agents/skills/amayui-ui-text-render/scripts/analyze_text_area.py "install/DATA1-png/SO009A.png" --x0 974 --y0 687 --x1 1130 --y1 763 --color gold
```

输出行分段（y 范围）、每行 x 范围、主色。关键推断：

- 行高（字形高）≈ 18-22px 时字号取 20px（WenQuanYi 全角字形约 20×18）。
- 文字行左对齐起点即渲染时 `left` 基准。
- 脚本输出的主色 top3 是**初始取样建议**，最终颜色以用户确认为准。

### 2. 清理文字区域

```bash
python .agents/skills/amayui-ui-text-render/scripts/clean_text_area.py "install/DATA1-png/SO009A.png" .tmp/so009a_cleaned.png --x0 974 --y0 687 --x1 1130 --y1 763 --expand 5
```

清理前检查扩边区域是否碰到无关 UI 像素（用 Pillow 统计扩边带内不透明像素），必要时收窄。

### 3. 构造调试页面，用户确认样式（每场景必做）

样式参数（文字颜色、描边、阴影、字号、字体）因图而异，**禁止直接沿用其它场景的数值**（如 SO009B 的金色 `#ffd6a4` 只是该图的案例）。

1. 复制 `assets/style_tuner.html` 到 `.tmp/<name>_style_tuner.html`，按场景修改页面顶部 `CONFIG`：
   - `stageW/stageH`：原图宽高；
   - `image`：步骤 2 的清理图（与页面同目录）；
   - `lines`：每行 `{ left, top, text }`，left/top 用步骤 1 的分析结果；
   - 将 `tools/SExtractor/tools/Font/WenQuanYi.ttf` 复制到 `.tmp/`（与页面同目录）。
2. 在浏览器中打开该页（需提权启动浏览器），用户在原图垫底上直接调参：先取样文字主体色，再调描边、阴影偏移/模糊/颜色/不透明度、字号与字体，直到与原图文字风格一致。
3. 用户确认后，从页面复制生成的 CSS 块；**以用户确认的 CSS 为唯一样式来源**，并写入 `docs/images/<NAME>.md` 备查。

### 4. 渲染 HTML（使用用户确认后的 CSS）

用确认后的 CSS 替换模板中的样式（详见 `references/ui-text-styles.md`）：

```html
<style>
  @font-face { font-family: "WenQuanYi"; src: url("wenquanyi.ttf"); }
  html, body { margin:0; padding:0; width:<W>px; height:<H>px; background:transparent; overflow:hidden; }
  .ln { position:absolute; left:<x>px; top:<y>px; /* 以下为用户确认的样式 */
        font-family:"<字体>"; font-size:<字号>px; line-height:1;
        color:<文字色>; -webkit-text-stroke:<描边>px <文字色>;
        text-shadow:<阴影>; white-space:nowrap; }
</style>
<body><img id="bg" src="<cleaned.png>"><div class="ln" style="...">译文</div></body>
```

中文文本放 `<div>` 内，逐行定位。

### 5. headless Chrome 截图（需提权，沙箱内会崩溃）

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu --no-first-run `
  --user-data-dir="E:\Games\Eushully\天結\.tmp\chrome_tmp" `
  --screenshot="E:\Games\Eushully\天結\.tmp\<name>_cn.png" `
  --window-size=<W>,<H> --force-device-scale-factor=1 --default-background-color=00000000 `
  "file:///E:/Games/Eushully/天結/.tmp/<name>_render.html"
```

### 6. 注入 AGF 到 install 根目录

```bash
cd scripts
node agf/cli.js inject "E:\Games\Eushully\天結\install\DATA1\<NAME>.AGF" "E:\Games\Eushully\天結\.tmp\<name>_cn.png" -o "E:\Games\Eushully\天結\install\<NAME>.AGF"
```

install 根目录 AGF 为 overlay，引擎读取优先于 ALF。

### 7. 同步与记录

1. 复制产物到 `res\`：修改后 PNG + 注入后的 AGF。
2. `patch\patch.config.json` 添加条目，`dst` 用 `AGF/` 子目录：
   `{ "src": "res/<NAME>.AGF", "dst": "AGF/<NAME>.AGF" }`
3. 运行 `npm run sync-patch`（在 `scripts` 目录）。
4. 运行 `npm run manifest` 更新 install-manifest.json（在 `scripts` 目录；只更新单个文件可用 `npm run manifest -- <NAME>.AGF`）。
5. 记录到 `docs/images/<NAME>.md`：文字区域、行位置、**用户确认的 CSS**、布局参数、清理范围、复现命令、待办状态。

### 8. 按钮/面板模式（连通块定位 + 列填充清理 + 居中渲染）

用于纯色底/纵向渐变底按钮与多行面板（SO020/SO021/SO025 已用流程）。

1. **定位**：用 `scripts/cc_scan.py` 识别按钮/面板：
   - 列表模式：`--x0 --y0 --x1 --y1 --alpha 128 --min-px 500` 输出范围内所有连通块；
   - 查询模式：`--query-x --query-y` 输出指定坐标所属连通块的矩形；
   - 实体范围取 alpha≥128（含黑色边框），完整范围取 alpha≥1（含羽化）。
2. **清理（列填充法）**：按钮背景纵向一致（纯色底）或纵向渐变（渐变底），保留左右 N px、中间逐行复制第 N+1 列抹除文字：
   - 纯色底按钮 N=15（第 16px 列）、渐变底按钮 N=20（第 21px 列）、多行面板 N=40、小按钮块 N=23；
   - **填充前必须检查**该列是否穿过文字笔画：统计列上深色像素行数，若仅有顶/底边框行深色则干净；
   - 渐变按钮逐行复制单列可保留每行渐变值；左右 N px 内的黑色边框/斜角装饰原样保留。
3. **渲染**：`line-height` = 块高、`text-align:center` 实现水平垂直居中；top 可按需 ±1px 微调。两种已确认效果（上半按钮/下半按钮）见 `references/ui-text-styles.md`。
4. **校验**：渲染后统计块内深色像素 bbox，中心应与块中心一致（≤1px）；对已确认区域做逐像素 diff，应无差异。
5. **安装**：同第 5-7 步（截图 → 注入 → res/patch 同步 → 记录文档）。

## 脚本与参考

- `scripts/analyze_text_area.py`：颜色 mask + 投影分段，输出行/列范围与主色（仅作初始建议）。
- `scripts/clean_text_area.py`：指定区域像素置透明（可扩边）。
- `scripts/cc_scan.py`：连通块扫描/坐标查询（alpha 阈值、范围裁剪、4/8 邻接、`--json` 输出）。
- `assets/style_tuner.html`：逐场景样式调试页模板（浏览器打开，用户确认颜色/描边/阴影后复制 CSS）。
- `references/ui-text-styles.md`：调试页用法、渲染模板、AGF 注入命令、纯文本行与按钮模式案例参数（仅作案例，非默认值）。
