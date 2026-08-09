# UI 文字样式与命令参考

## 样式确认原则（每场景必做）

- 文字颜色、描边、阴影、字号等视觉参数**因图而异**；SO009B 的「金色 `#ffd6a4` / 青色 `#08F4F4`」只是该图的案例值，**不是默认值**，禁止直接套用。
- `analyze_text_area.py` 输出的主色 top3 仅作为初始取样建议；最终参数必须由用户通过调试页面确认。
- 确认后的 CSS 写入 `docs/images/<NAME>.md`，作为该场景的复现依据。

## 调试页面（样式确认）

模板：`assets/style_tuner.html`。复制到 `.tmp/<name>_style_tuner.html` 后修改页面顶部 `CONFIG`：

| 字段 | 说明 |
|---|---|
| `stageW` / `stageH` | 原图宽高（与最终渲染/截图尺寸一致） |
| `image` | 垫底图（清理后的 PNG，与页面同目录） |
| `lines` | 每行 `{ left, top, text }`，left/top 为最终渲染坐标 |
| `scale` | 预览放大倍率（建议 1.5-2） |

浏览器打开后（需提权）：先按原图像素确认文字主体色（参考 analyze 输出），再调描边宽度、阴影偏移/模糊/颜色/不透明度、字号与字体，直到与原图文字风格一致。页面右侧实时生成 CSS；用户确认后复制，用于最终渲染页并记录。

## SO009B 案例参数（已验证，仅该图适用）

```css
font-family: "WenQuanYi";          /* 文泉驿微米黑：tools\SExtractor\tools\Font\WenQuanYi.ttf */
font-size: 20px;
line-height: 1;
color: #ffd6a4;                    /* 金色；青色变体用 #08F4F4 */
-webkit-text-stroke: 0.5px <color>; /* 描边色 = 文字色 */
text-shadow: 2px 2px 1px rgba(0,0,0,1); /* 纯黑阴影，右下偏移 2px，模糊 1px */
```

该图原样分析结论（仅作方法参考，参数本身随场景变化）：

- 字号：原文字块约 20×22px（含描边）→ 字号 20px（WenQuanYi 全角字形 20×18）。
- 笔画目标约 3px：WenQuanYi 20px 原生笔画 1px，`-webkit-text-stroke: 1.5px` 时笔画 3px；0.5px 时约 2px。
- 阴影：原图为纯黑、alpha≈252，向右下延伸 (2,3)px。
- 文字中心为纯色（无渐变）；之前观察到的明暗变化是阴影造成的假象。
- 文字主体 alpha≈252（导出统一缩放），视觉纯色。

## 渲染 HTML 模板

（`<...>` 均替换为用户确认后的值）

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face { font-family: "WenQuanYi"; src: url("wenquanyi.ttf"); }
  html, body { margin:0; padding:0; width:<W>px; height:<H>px;
               background:transparent; overflow:hidden; }
  #bg { position:absolute; left:0; top:0; }
  .ln { position:absolute; left:<x>px; top:<y>px;
        font-family:"<字体>"; font-size:<字号>px; line-height:1;
        color:<文字色>; -webkit-text-stroke:<描边>px <文字色>;
        text-shadow:<阴影>; white-space:nowrap; }
</style>
</head>
<body>
  <img id="bg" src="<cleaned>.png">
  <div class="ln" style="top:<y>px">译文</div>
</body>
</html>
```

## headless Chrome 截图（需提权）

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu --no-first-run `
  --user-data-dir="E:\Games\Eushully\天結\.tmp\chrome_tmp" `
  --screenshot="E:\Games\Eushully\天結\.tmp\<name>_cn.png" `
  --window-size=<W>,<H> --force-device-scale-factor=1 --default-background-color=00000000 `
  "file:///E:/Games/Eushully/天結/.tmp/<name>_render.html"
```

注意：沙箱内 Chrome/Edge 会因 crashpad/mojo 权限问题崩溃（拒绝访问 0x5），必须在沙箱外运行。

## AGF 注入

```powershell
cd E:\Games\Eushully\天結\scripts
node agf/cli.js inject "E:\Games\Eushully\天結\install\DATA1\<NAME>.AGF" `
  "E:\Games\Eushully\天結\.tmp\<name>_cn.png" -o "E:\Games\Eushully\天結\install\<NAME>.AGF"
```

注入为有头注入（保留 ACGF 头/ACIF），8bpp 按原调色板量化，无压缩写入、体积膨胀属正常。

## 案例参数

> 以下均为已处理图片的记录，参数只对各自图片有效；新场景按「调试页面」流程重新确认。

### SO009B（712×256，三列 × 六行）

- 列：第一列 x 3-229（outline 样式，每页设置顶部标题，暂不处理）；第二列 x 355-517（金色）；第三列 x 546-708（青色）。
- 行 y：3-25 / 30-52 / 57-79 / 84-106 / 111-133 / 138-160（行高 22px）。
- 译文：系统设定 / 游戏设定 / ADV设定 / 声音设定 / 角色设定 / 操作设定。
- 布局：第二列 left=387、第三列 left=578（列起点 +32px）；行 top=4/31/58/85/112/139。
- ADV设定 需在 ADV 与 设定 间插入 3px 间隔使行宽与其他行一致（ADV 37px + 设定 40px = 77px，其余 80px）。
- 清理范围（扩 5px）：第二列 x 350-522、第三列 x 541-712，y 全高。

### SO009A（1280×1152，设置页按钮文字）

- 文字区域：左上 (974,687)，右下约 (1130,763)。
- 行：y 687-706（戻る→返回）、714-733（ページの初期化→页面初始化）、740-760（全体の初期化→整体初始化）。
- 第一行 left=975；第二、三行 left=999（+24px 偏移）。
- 清理范围：x 969-1136、y 683-765（避开 y=682 的无关白色像素）。
- 待办：第一行未找到实际显示内容（已处理）；「初期化」「戻る」两个大按钮未处理（含义可猜，暂缓）。

## 工程约定

- 修改后 PNG/AGF 放 `res\`；patch 配置 `dst` 用 `AGF/` 子目录（`{ "src": "res/<NAME>.AGF", "dst": "AGF/<NAME>.AGF" }`）。
- 每次处理记录到 `docs/images/<NAME>.md`（区域、CSS、布局、清理范围、复现命令、待办）。
- install 根目录 AGF 为 overlay；还原时从 `install\DATA1\<NAME>.AGF` 复制覆盖。
