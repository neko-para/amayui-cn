---
name: amayui-ui-text-render
description: 汉化《天結いキャッスルマイスター》(Amayui Castle Meister) 游戏 UI 图片中的纯文本行：定位文字区域、清理原日文、用 HTML+CSS 渲染简体中文、headless Chrome 截图、注入 AGF、同步 res/patch。当用户要求处理 SO00x / AGF / UI 图片中的文字行、把图片内文本替换为中文时使用。当前仅支持纯文本行（无按钮背景/复杂 UI 元素），按钮模式未支持。样式参数（尤其文字颜色）必须逐场景由用户通过调试页面确认，不得套用其它场景的默认值。
---

# Amayui UI 文本渲染

用于《天結いキャッスルマイスター》汉化工程的 UI 图片（AGF/PNG）中纯文本行的中文化。工程根目录：`E:\Games\Eushully\天結`。

## 适用与限制

- **支持**：透明背景或纯色背景上的纯文本行（例如 SO009A/SO009B 的金色文字菜单项）。
- **不支持**：带按钮背景、复杂 UI 面板、艺术字的按钮模式（后续另行研究）。遇到此类图片先与用户确认范围。
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
4. 记录到 `docs/images/<NAME>.md`：文字区域、行位置、**用户确认的 CSS**、布局参数、清理范围、复现命令、待办状态。

## 脚本与参考

- `scripts/analyze_text_area.py`：颜色 mask + 投影分段，输出行/列范围与主色（仅作初始建议）。
- `scripts/clean_text_area.py`：指定区域像素置透明（可扩边）。
- `assets/style_tuner.html`：逐场景样式调试页模板（浏览器打开，用户确认颜色/描边/阴影后复制 CSS）。
- `references/ui-text-styles.md`：调试页用法、渲染模板、AGF 注入命令、SO009B/SO009A 案例参数（仅作案例，非默认值）。
