# UI 文字样式与命令参考

> 本文件给出**渲染机制/命令模板**。**已确认的效果参数（色值/描边/阴影/字号/缩放）以 `docs/images/FONT.md`（E1–E10）与各图 `docs/images/<NAME>.md` 为准**，此处案例仅为方法演示，禁止直接套用。

## 样式确认原则（每场景必做）

- 文字颜色、描边、阴影、字号、字体**因图而异**；`FONT.md` 的 E1–E10 只是各场景案例值，**不是默认值**。
- 主色由对原图采样 + 用户确认；最终 CSS 是**唯一样式来源**，写入 `docs/images/<NAME>.md`。
- 若新场景与某 preset 同构（如同一底图三列切换、同字宽缩放），复用其 CSS 骨架、仅改色值，仍须用户确认。

## 定位与清理（当前工具）

- **定位（块/面板）**：`scripts/uimap/scan_blocks.py`（输出自包含 HTML，浏览器点选导出 `selected.json`）或集成工具 `amayui_uimap`。旧的 `scripts/cc_scan.py` 已过时。
- **清理**：`scripts/uimap/clean_fill.py`（列填充/行填充/置透明/跨图贴底图/局部恢复）。旧的 `clean_text_area.py` 可被 `--transparent` 替代。
- 详细参数见 `scripts/uimap/README.md`。

## 渲染 HTML 模板（Sarasa Gothic SC）

字体统一 **Sarasa Gothic SC**；渲染页必须加 @font-face（防 headless 拉丁 fallback）：

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face { font-family:"Sarasa Gothic SC"; src:url("<相对路径>/SarasaGothicSC-Regular.ttf"); font-weight:400; }
  @font-face { font-family:"Sarasa Gothic SC"; src:url("<相对路径>/SarasaGothicSC-Bold.ttf");  font-weight:700; }
  html, body { margin:0; padding:0; width:<W>px; height:<H>px; background:transparent; overflow:hidden; }
  #bg { position:absolute; left:0; top:0; }
  .ln { position:absolute; left:<x>px; top:<y>px;
        font-family:"Sarasa Gothic SC"; font-size:<字号>px; line-height:1;
        color:<文字色>; -webkit-text-stroke:<描边>px <文字色>;
        text-shadow:<阴影>; white-space:nowrap; }
</style>
</head>
<body>
  <img id="bg" src="<cleaned>.png">
  <div class="ln" style="left:<x>px;top:<y>px">译文</div>
</body>
</html>
```

- 相对路径：渲染页在 `.tmp` 下 → `../res/fonts/SarasaGothicSC/...`；在 `.tmp/ui-redraw/<图>` 下 → `../../../res/fonts/...`。

## 按钮/面板模式（多层叠放）

纯文本行用 `.ln` 单层；多色/渐变/描边按钮用**多层兄弟节点**叠放（`.in/.out` 或 `.shd/.gout/.gin`），每层 `-webkit-text-stroke` 与 `background-clip:text` 分开，`grid-area:1/1` 或 `position:absolute` 重叠，`z-index` 分层：

```html
<div class="btn"><span class="out">中文</span><span class="in">中文</span></div>
```

```css
.out { -webkit-text-stroke:<外描边>px <色>; }  /* 外描边层 */
.in  { -webkit-text-stroke:0; background:linear-gradient(...); -webkit-background-clip:text; }  /* 填色/渐变层 */
```

具体各效果的完整 CSS 见 `docs/images/FONT.md` 对应 preset。

## headless Chrome 截图（需提权）

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu --no-first-run `
  --user-data-dir="E:\Games\Eushully\天結\.tmp\chrome_tmp" `
  --screenshot="E:\Games\Eushully\天結\.tmp\<name>_cn.png" `
  --window-size=<W>,<H> --force-device-scale-factor=1 --default-background-color=00000000 `
  "file:///E:/Games/Eushully/天結/.tmp/<name>_render.html"
```

注意：沙箱内 Chrome/Edge 会因 crashpad/mojo 权限问题崩溃（拒绝访问 0x5），必须在沙箱外运行（本会话已授 `danger-full-access`）。

## AGF 注入

```powershell
cd E:\Games\Eushully\天結\scripts
node agf/cli.js inject "E:\Games\Eushully\天結\install\DATA1\<NAME>.AGF" `
  "E:\Games\Eushully\天結\res\images\<NAME>-N.png" -o "E:\Games\Eushully\天結\install\<NAME>.AGF"
```

注入为有头注入（保留 ACGF 头/ACIF），8bpp 按原调色板量化，无压缩写入、体积膨胀属正常。install 根 AGF 为 overlay，引擎优先于 ALF。

## 案例（历史，仅该图适用；当前效果以 FONT.md 为准）

以下为早期 WenQuanYi 时代的案例参数，**仅作方法参考**。现工程已全部改用 Sarasa Gothic SC，且各图效果已沉淀到 `docs/images/FONT.md`（E1–E10）。

- `analyze_text_area.py` 输出的主色 top3 仅作初始取样建议（块定位请用 `scan_blocks.py`）。
- 早期 SO009A/B、SO020 等按钮参数详见各自图文档（`docs/images/SO009A.md` 等）。

## 工程约定

- 修改后 PNG/AGF 放 `res\images\`（`-0` 原图 + `-N` 版本，最高版生效）；patch 配置 `dst` 用 `AGF/` 子目录。
- 每次处理记录到 `docs/images/<NAME>.md`（区域、CSS、布局、清理、复现、待办）。
- 同步：`npm run sync-patch` + `npm run manifest -- <NAME>.AGF`（scripts 目录）。
- 还原：从 `install\DATA1\<NAME>.AGF` 复制覆盖 install 根。
- 入口：先查 `docs/images/README.md`（索引）→ `<NAME>.md`（细节）→ `FONT.md`（效果）。
