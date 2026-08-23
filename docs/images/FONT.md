# 天結 UI 文字效果总览（FONT）

> 本文档汇总工程内**所有已确认**的 UI 文字渲染效果（含 CSS 参数与 HTML 结构），作为后续 SO 图文字渲染的速查与复现依据。
> 原则：**样式参数因场景而异，新场景必须由用户确认，不得直接套用其它场景默认值**（详见 `amayui-ui-text-render` 技能）。
> 渲染管线：headless Chrome 截图（`--force-device-scale-factor=1 --default-background-color=00000000`）→ `node scripts/agf/cli.js inject` 编译 AGF。

## 0. 通用基础

- **字体**：**Sarasa Gothic SC**（更纱黑体 SC，`res/fonts/SarasaGothicSC/SarasaGothicSC-Regular.ttf` + `-Bold.ttf`）。
  **渲染页必须加 @font-face 引用本地文件**（防 headless 拉丁 fallback，见附录踩坑 7），路径相对渲染页位置调整：
  ```css
  @font-face { font-family: "Sarasa Gothic SC"; src: url("<相对路径>/SarasaGothicSC-Regular.ttf"); font-weight: 400; }
  @font-face { font-family: "Sarasa Gothic SC"; src: url("<相对路径>/SarasaGothicSC-Bold.ttf"); font-weight: 700; }
  ```
  > 历史（2026-08 前）：文泉驿微米黑 `res/fonts/WenQuanYi.ttf`，`font-family:"WenQuanYi"`；全量重绘起由 Sarasa 替换。
- **画布**：`html, body { margin:0; padding:0; width:<W>px; height:<H>px; background:transparent; overflow:hidden; }`，垫底 `<img id="bg">` 为清理后整图。
- **文字定位**：`.btn`（或 `.ln`）`position:absolute`；按钮模式 `text-align:center` + `line-height:<块高>px` 实现水平垂直居中；纯文本行模式 `line-height:1` 直接给 left/top。
- **并列结构约定**（按钮模式通用，用户确认）：`.in`（文字层）与 `.out`（描边层）为**兄弟节点并列**，均 `position:absolute; left:0; right:0; top:0`，`z-index` 分层（`.in` z=2 上、`.out` z=1 下）：
  ```html
  <div class="btn ..."><span class="in">中文</span><span class="out">中文</span></div>
  ```
  > 踩坑：`-webkit-text-stroke` 会**继承**——`.in` 必须显式 `-webkit-text-stroke: 0`，或与 `.out` 并列放置，否则红/黑字会被父层白描边盖成纯白/纯描边色。

## 1. 效果目录

| # | 效果名 | 适用 | 字号 | 文字色 | 描边 | 阴影 | 引用 |
|---|---|---|---|---|---|---|---|
| E1 | 纯文本行（金色/青色） | 设置页文字行（SO009A/B） | 20px | `#ffd6a4` / `#08F4F4` | 0.5px 同色 | `2px 2px 1px #000` | docs/images/SO009A.md §3、SO009B.md |
| E2 | 纯色底按钮（黑字） | 米白底按钮（SO020 上半等） | 20px | `#000` | 0.5px `#000` | 无 | docs/images/SO020.md §4、SO021.md §3 |
| E3 | 渐变底按钮（黑字+半透明白边） | 青蓝渐变底按钮（SO020 下半等） | 20px | `#000` | 内 0.5px `#000`；外 2px `rgba(255,255,255,.5)` | 无 | docs/images/SO020.md §5、SO021.md §3 |
| E4 | 红描边渐变字 | 兵种名红字（SO017） | 22px | 纵向渐变 `#FEFE13→#FEFEFD→#FEFE13` | 外 2px `#C90000`（露出 1px） | `2px 2px 2px #000` 独立层 | docs/images/SO017.md |
| E5 | 30px 规则（黑字+白描边） | 103×73 / 117×81 等按钮（SO030 第一轮、SO020-2、SO009A-1） | 30px | `#000` + 0.5px `#000` | 4px `rgba(255,255,255,1/0.5)` | 上半 `0 4px 4px #000` 于描边层 | docs/images/SO030.md §6、SO020.md §8、SO009A.md §7 |
| E6 | 红字+白描边（SO030 第二轮上半） | 红字按钮（SO030-2 上半、SO020-1） | 28/30px | `#FD480A`（无黑描边） | 4px `rgba(255,255,255,1)` | `0 4px 4px #000` 于描边层 | docs/images/SO030.md §7、SO020.md §7 |
| E7 | 阴刻 outline（棕褐环+半透明灰内部） | 设置页顶部标题（SO009B 第一列） | 28px bold | 内部 `#26201E` 50% | 棕褐外环 `#b4887c`（region filter） | 外阴影 `#25201d` 50% | 本文件 E7 节、docs/images/SO009B.md §9 |
| E8 | 两段式渐变字（上白下浅绿）+深绿描边+黑阴影 | SO039 第三列（同组列1=E5 上半、列2=E5 下半） | 24px | 上 `#FFFFFF`／下 `#CDFDCD`（0%/50% 硬切） | 深绿 3px `#015514` | `0 4px 4px rgba(0,0,0,1)` 独立层 `.shd` | docs/images/SO039.md §3.2 |
| E9 | 黑红混排按钮字（E5 上半 + E6） | 同一行黑字+红字并存（SO021「去城砦」） | 20px（黑部件 18px） | 黑 `#000` / 红 `#FD480A` | 黑 0.5px `#000`；红无；白描边 4px 100% | `0 4px 4px rgba(0,0,0,1)` 于描边层 | docs/images/SO021.md §8.3 |
| E10 | 同纹三列变体（同图切换） | SO001 5 行按钮（列1 米白 / 列2 纯青 / 列3 灰） | 22px bold | 渐变字（见各列） | 列1 深棕 `2px #3A2709`；列2 深蓝 `2px #1438E0`；列3 黑 `2px rgba(0,0,0,.6)` | 仅列1 `2px 2px 1px rgba(0,0,0,1)`（列2/3 无） | 本文件 E10 节、docs/images/SO001.md |

---

## E1 纯文本行（金色/青色）— 设置页文字行

![E1 示例：金色描边纯文本行（返回／初始化本页／初始化全部）](../../res/images/fonts/E1_gold_text.png)

> 裁自 `res\images\fonts\E1_gold_text.png`（原图 `res\images\SO009A-2.png`(968,682)-(1136,768)）；对应场景 SO009A 三行、SO009B 金/青两列

**场景**：SO009A 设置页三行文字、SO009B 三列菜单文字（透明/纯色背景上的单行文字）。

```css
font-family: "Sarasa Gothic SC"; font-size: 20px; line-height: 1;
color: #ffd6a4;                          /* 金色；青色变体 #08F4F4 */
-webkit-text-stroke: 0.5px #ffd6a4;      /* 描边色 = 文字色 */
text-shadow: 2px 2px 1px rgba(0,0,0,1);  /* 右下偏移 2px，模糊 1px，纯黑 */
```

```html
<div class="ln" style="left:975px; top:687px;">返回</div>
```

- 布局：`left` 为文字起点，`top` 为行顶；行高 22px（y 间距 27px 行距）。
- 主色由 `scripts/analyze_text_area.py` 取样 + 用户确认；黑色像素为阴影（非背景）。

## E2 纯色底按钮（黑字）

![E2 示例：纯色底按钮黑字「菜单」](../../res/images/fonts/E2_solid_button.png)

> 裁自 `res\images\fonts\E2_solid_button.png`（原图 `res\images\SO021-1.png`(656,742)-(822,803)）；对应场景 SO020 上半、SO021/SO025 块 A

**场景**：SO020 上半 11 个纯色底按钮（米白底 #FEF3E5/#F0F0E0、无边框）、SO021/SO025 块 A 面板等。

```css
font-family: "Sarasa Gothic SC"; font-size: 20px; line-height: <块高>px;  /* 块高=按钮高度，垂直居中 */
letter-spacing: 1px; color: #000; -webkit-text-stroke: 0.5px #000; text-align: center;
```

```html
<div class="btn" style="left:<x0>px; top:<y0>px; width:<w>px;"><span class="in">中文</span><span class="out">中文</span></div>
<!-- .in/.out 均 .btn 内并列；.in 显式 -webkit-text-stroke:0；.out 无描边（单层黑字时 .out 可为空/省略） -->
```

- 描边 0.5px `#000` 用于增加字重（笔画约 +50% 像素）。
- 清理：纯色底保留左右 15px、中间逐行复制第 16px 列（x0+15）。

## E3 渐变底按钮（黑字 + 半透明白边）

![E3 示例：渐变底按钮黑字+半透明白边「菜单」](../../res/images/fonts/E3_grad_button.png)

> 裁自 `res\images\fonts\E3_grad_button.png`（原图 `res\images\SO021-1.png`(650,789)-(798,841)）；对应场景 SO020 下半、SO021/SO025 块 B

**场景**：SO020 下半 11 个边框+渐变按钮（黑色圆角边框 + 青蓝渐变底）、SO021/SO025 块 B 小按钮。

```css
/* 文字主体同 E2 */
font-family: "Sarasa Gothic SC"; font-size: 20px; line-height: <块高>px;
letter-spacing: 1px; color: #000; -webkit-text-stroke: 0.5px #000; text-align: center;
```

```html
<span class="in">中文</span><span class="out">中文</span>
```

```css
.out { position: absolute; left:0; right:0; top:0; z-index:1;
       -webkit-text-stroke: 2px rgba(255,255,255,0.5); color: rgba(255,255,255,0.5); }
.in  { position: absolute; left:0; right:0; top:0; z-index:2;
       -webkit-text-stroke: 0.5px #000; color: #000; }
```

- 双层效果：外层 2px 半透明白描边（约 1px 可见外框），内层黑字 0.5px 黑描边。
- 历史调整：白色阴影 0.5px→1px→2px→改描边方案→100%→50%（最终确认 50%）。
- 清理：渐变底保留左右 20px、中间逐行复制第 21px 列（x0+20，保留每行渐变值）。

## E4 红描边渐变字（SO017 兵种名）

![E4 示例：红描边渐变字（人类杀手／幻兽杀手）](../../res/images/fonts/E4_red_grad.png)

> 裁自 `res\images\fonts\E4_red_grad.png`（原图 `res\images\SO017-2.png`(15,0)-(175,68)）；对应场景 SO017 全量兵种名

**场景**：SO017 兵种名红字（红色描边 + 白心渐变 + 黑阴影），坐标中心定位。

```css
.ln { position: absolute; font-family: "Sarasa Gothic SC"; font-size: 22px; line-height: 1;
      white-space: nowrap; transform: translate(-50%,-50%); }   /* left/top = 中心坐标 */
/* ① 阴影层（最底）：描边字型独立成层（WebKit 中 text-shadow 绘制于 text-stroke 之上） */
.sh { position: absolute; left:0; top:0; color: transparent;
      -webkit-text-stroke: 2px #C90000; text-shadow: 2px 2px 2px rgba(0,0,0,1); }
/* ② 描边层：2px 红，内层覆盖内侧 → 露出外侧 1px */
.out { position: relative; display: inline-block; color: transparent;
       -webkit-text-stroke: 2px #C90000; }
/* ③ 渐变文字层：纯纵向渐变；必须清零描边防止继承 */
.in { position: absolute; left:0; top:0;
      -webkit-text-stroke: 0; -webkit-text-stroke-width: 0;
      background: linear-gradient(to bottom, #FEFE13 0%, #FEFEFD 38%, #FEFEFD 62%, #FEFE13 100%);
      -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
```

```html
<div class="ln" style="left:CX; top:CY;">
  <span class="sh">中文</span>
  <span class="out">中文<span class="in">中文</span></span>
</div>
```

- 渐变：纵向 `#FEFE13 → #FEFEFD(中心白段 38%–62%) → #FEFE13`，横向颜色一致。
- 内层必须显式 `-webkit-text-stroke: 0; -webkit-text-stroke-width: 0`（继承坑）。
- 阴影偏移历史：3px 3px 2px → 2px 2px 2px（用户确认）。

## E5 30px 规则（黑字 + 白描边 4px）— 标准大按钮

![E5 示例：30px 黑字+白描边（归还，上半）](../../res/images/fonts/E5_30px_rule.png)

> 裁自 `res\images\fonts\E5_30px_rule.png`（原图 `res\images\SO030-3.png`(663,550)-(790,648)）；对应场景 SO030 第一轮、SO020 8 按钮、SO009A 返回×2

**场景**：SO030 第一轮 16 按钮（103×73）、SO020 8 按钮（103×73）、SO009A 返回按钮 ×2（117×81）。
**这是当前 30px 大按钮的标准效果**（用户确认）。

```css
.btn { position: absolute; width: <w>px; text-align: center; line-height: <块高>px;
       font-family: "Sarasa Gothic SC"; font-size: 30px; letter-spacing: 1px; white-space: nowrap;
       transform: translateY(-0.5px); }          /* 整体偏移 (0,-0.5)，用户确认 */
.out { position: absolute; left:0; right:0; top:0; z-index:1; }
.in  { position: absolute; left:0; right:0; top:0; z-index:2;
       color: #000; -webkit-text-stroke: 0.5px #000; }
/* 上半按钮：白描边 100% + 阴影于白描边层 */
.up .out { -webkit-text-stroke: 4px rgba(255,255,255,1); color: rgba(255,255,255,1);
           text-shadow: 0 4px 4px rgba(0,0,0,1); }
/* 下半按钮：白描边 50%（无阴影） */
.down .out { -webkit-text-stroke: 4px rgba(255,255,255,0.5); color: rgba(255,255,255,0.5); }
```

```html
<div class="btn up"   style="left:<x0>px; top:<y0-1>px;"><span class="in">中文</span><span class="out">中文</span></div>
<div class="btn down" style="left:<x0>px; top:<y0-1>px;"><span class="in">中文</span><span class="out">中文</span></div>
```

- 定位：`top = y0 - 1`（居中上移 1px）；行高 = 块高（73px / 81px …）垂直居中；水平居中。
- **上/下半语义**：同一列上下相邻两两一对（组），上按钮=上半效果（白 100%+阴影），下按钮=下半效果（白 50%）。
- 清理（SO030 第一轮模板，103×73）：上半 keep 17/18/17/17、下半 keep 17/18/13/12，fill-col = x0+19；
  SO009A（117×81）keep 20/20/17/17，fill-col 逐块微调避免穿字。

## E6 红字 + 白描边（SO030 第二轮「上半」效果）

![E6 示例：红字+白描边（防卫开始，上半 `#FD480A`）](../../res/images/fonts/E6_red_white.png)

> 裁自 `res\images\fonts\E6_red_white.png`（原图 `res\images\SO030-3.png`(1000,1140)-(1250,1240)）；对应场景 SO030 第二轮上半、SO020 探索开始/出击

**场景**：SO030 第二轮 4 按钮上半（#147/#167，213×73）、SO020-1 4 按钮（探索开始/出击，213×73，**全部用上半效果**）。

```css
/* 与 E5 同骨架；唯一差异在 .in 文字层 */
.in { position: absolute; left:0; right:0; top:0; z-index:2;
      color: #FD480A; -webkit-text-stroke: 0; }   /* 红字、无 0.5px 黑描边 */
.out { -webkit-text-stroke: 4px rgba(255,255,255,1); color: rgba(255,255,255,1);
       text-shadow: 0 4px 4px rgba(0,0,0,1); }     /* 白描边 100% + 阴影（上半效果） */
```

- 字号变体：SO030-2 = 30px；SO020-1 中 **#1/#3（探索开始）= 28px、#2/#4（出击）= 30px**（用户指定）。
- 用户确认：SO020-1 的 4 按钮全部使用「上半」效果（红字+白描边 100%+阴影），均含 `translateY(-0.5px)`。

---

## E7 阴刻 outline（棕褐外环 + 半透明灰内部）— SO009B 第一列

![E7 示例：阴刻 outline 六行（系统设定／游戏设定／ADV设定／声音设定／角色设定／操作设定）](../../res/images/fonts/E7_outline.png)

> 裁自 `res\images\fonts\E7_outline.png`（原图 `res\images\SO009B-4.png`(0,0)-(240,228)）；对应场景 SO009B 第一列（当前生效三列版）

**场景**：SO009B 第一列（设置页顶部标题，outline 阴刻样式；游戏内不明显但已实现），712×256 全图。
**已应用产物**：`res\images\SO009B-4.png`（三列最终版，当前生效）；完整渲染页 `.tmp\ui-redraw\SO009B\col1\render_final.html`。

### 核心思路（勿再重蹈覆辙）

1. **SVG `<text stroke>` 与 CSS `-webkit-text-stroke` 都按"每个笔画轮廓"描边**（对多笔画汉字笔画内部重叠杂乱）——**不可用于汉字描边**；
2. 正确做法：把文字 alpha 当**整体 region**，用 SVG filter 形态学操作：
   - **外环 = `feMorphology dilate(region, r) − region`**（只沿整体外轮廓+内部空洞边缘，笔画内部不产生线条）；
   - 内部 fill、内阴影棱、外阴影各自独立 filter/层，**不与环混合**（混合会导致内部 fill 被破坏）；
3. **渲染页必须 @font-face 引用本地字体文件**（headless 对系统字体的拉丁会 fallback，见附录踩坑 7）；
4. **宽度测量必须异步**（`await document.fonts.load` + `document.fonts.ready` 后 canvas measureText；同步 `getBoundingClientRect` 会在 @font-face 未就绪时返回 fallback 宽度，见附录踩坑 8）。

### 完整 HTML/CSS（SO009B 三列最终版核心）

```html
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<style>
  /* @font-face 必须（防 headless 拉丁 fallback） */
  @font-face { font-family: "Sarasa Gothic SC"; src: url("../../../../res/fonts/SarasaGothicSC/SarasaGothicSC-Regular.ttf"); font-weight: 400; }
  @font-face { font-family: "Sarasa Gothic SC"; src: url("../../../../res/fonts/SarasaGothicSC/SarasaGothicSC-Bold.ttf"); font-weight: 700; }
  html, body { margin:0; padding:0; width:712px; height:256px; background:transparent; overflow:hidden; }
  /* 第二三列（E1：20px 金/青） */
  .ln { position:absolute; font-family:"Sarasa Gothic SC"; font-size:20px; line-height:1;
        color:#ffd6a4; -webkit-text-stroke:0.5px #ffd6a4;
        text-shadow:2px 2px 1px rgba(0,0,0,1); white-space:nowrap; }
  .ln.cy { color:#08F4F4; -webkit-text-stroke:0.5px #08F4F4; }
  /* 第一列（outline：28px bold 三层） */
  text.txt { font-family:"Sarasa Gothic SC"; font-size:28px; font-weight:bold; }
  .fill  { fill:#26201E; fill-opacity:0.5; }        /* 内部半透明灰 */
  .inset { filter:url(#inset1); }                    /* 内阴影棱 */
  .ring  { filter:url(#ring1); }                     /* 棕褐外环 */
</style>
</head>
<body>
<svg width="712" height="256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- 每行独立 filter id（Chrome 同一 id 多处引用会缓存出错）：
         inset1-6 / ring1-6 六个同构副本，此处仅列行1 -->
    <filter id="inset1" x="-30%" y="-30%" width="160%" height="160%">
      <feOffset dx="1" dy="1" result="off"/>
      <feComposite in="SourceAlpha" in2="off" operator="out" result="diff"/>
      <feGaussianBlur in="diff" stdDeviation="0.2" result="blur"/>
      <feComposite in="blur" in2="SourceAlpha" operator="in" result="clip"/>
      <feFlood flood-color="#000000" flood-opacity="0.5" result="color"/>
      <feComposite in="color" in2="clip" operator="in"/>
    </filter>
    <filter id="ring1" x="-30%" y="-30%" width="160%" height="160%">
      <feMorphology operator="dilate" radius="1" in="SourceAlpha" result="d"/>
      <feComposite in="d" in2="SourceAlpha" operator="out" result="ring"/>
      <feFlood flood-color="#b4887c" result="c"/>
      <feComposite in="c" in2="ring" operator="in"/>
    </filter>
  </defs>
  <!-- 第一列六行（每行三层 text 叠加，坐标 x=4 / top=3,40,77,114,151,188） -->
  <text class="txt fill"  x="4" y="3"  dominant-baseline="text-before-edge">系统设定</text>
  <text class="txt inset" x="4" y="3"  dominant-baseline="text-before-edge">系统设定</text>
  <text class="txt ring"  x="4" y="3"  dominant-baseline="text-before-edge">系统设定</text>
  <!-- …其余五行同构；ADV 行（top=77）写法： -->
  <text class="txt fill"  x="4" y="77" dominant-baseline="text-before-edge"><tspan letter-spacing="-1.6">ADV</tspan><tspan>设定</tspan></text>
  <text class="txt inset" x="4" y="77" dominant-baseline="text-before-edge"><tspan letter-spacing="-1.6">ADV</tspan><tspan>设定</tspan></text>
  <text class="txt ring"  x="4" y="77" dominant-baseline="text-before-edge"><tspan letter-spacing="-1.6">ADV</tspan><tspan>设定</tspan></text>
</svg>
<!-- 第二列（金，left=387）/ 第三列（青，left=578），top=4,31,58,85,112,139 -->
<div class="ln" style="left:387px; top:4px;">系统设定</div>
<!-- …第二三列各六行；ADV 行：<span style="letter-spacing:-0.4px">ADV</span>设定 -->
</body>
</html>
```

### 参数与公式

| 项 | 值 |
|---|---|
| 第一列字号/字重 | 28px bold（`@font-face` Bold 700） |
| 内部 fill | `fill:#26201E; fill-opacity:0.5`（半透明灰，独立 alpha） |
| 内阴影棱 | `feOffset(1,1)` → `SourceAlpha − off` → `blur 0.2` → 与 SourceAlpha 相与 → `#000` 50%（左/上缘暗棱，凹陷朝右下） |
| 棕褐外环 | `dilate(SourceAlpha, 1) − SourceAlpha` → `#b4887c`（整体外环，含内部空洞边缘） |
| 外阴影（可选层 `.shd`） | 偏移 (+2,+3) 的 `rgba(37,32,29,0.5)` 文字层 |
| **ADV 行宽公式** | ADV设定 默认超宽 **X** px（28px bold：X=4.93；20px：X=1.36）→ ADV 配 `letter-spacing:-X/3`（向下取整 0.1）→ 第一列 **-1.6**、第二三列 **-0.4**；ADV-设定 间不加额外间距 |

### 复现命令（截图 → 注入）

```powershell
# 截图（712×256 透明背景，独立 user-data-dir，--virtual-time-budget=10000）
$ud = "E:\Games\Eushully\天結\.tmp\chrome_tmp"
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList @(
  "--headless=new","--disable-gpu","--no-first-run","--no-sandbox","--disable-crash-reporter",
  "--user-data-dir=$ud","--screenshot=E:\Games\Eushully\天結\res\images\SO009B-4.png",
  "--window-size=712,256","--force-device-scale-factor=1","--default-background-color=00000000",
  "--virtual-time-budget=10000","file:///E:/Games/Eushully/天結/.tmp/ui-redraw/SO009B/col1/render_final.html")
# 注入
cd E:\Games\Eushully\天結\scripts
node agf/cli.js inject "E:\Games\Eushully\天結\install\DATA1\SO009B.AGF" "E:\Games\Eushully\天結\res\images\SO009B-4.png" -o "E:\Games\Eushully\天結\install\SO009B.AGF"
```

---

## E8 两段式渐变字（上白下浅绿）+ 深绿描边 + 黑阴影 — SO039 第三列

**场景**：SO039「锁定/释放」2×3 按钮组的**第三列**（绿边按钮）。同组**列1=E5 上半、列2=E5 下半**；本效果为列 3 的「上白/下浅绿两段式 + 原图深绿描边 + 黑色下阴影」样式，后续其它按钮可复用。
**排版**：24px **Sarasa Gothic SC**，字距 1px，`text-align:center` + `line-height:<块高>px` 居中，**`top = y0`（无上移——用户要求取消 E5 的 `top=y0-1` + `translateY(-0.5px)`）**。

- **两段式平铺**（非渐变）：上 0%–50% 纯白 `#FFFFFF`、下 50%–100% 浅绿 `#CDFDCD`（`#CDFDCD` 取原图字形下端，`#FFFFFF` 取上端近白——原图经用户确认是**上半白/下半浅绿的两段**，不是渐变）；
- **深绿描边**：3px `#015514`（原图字形 `(1,85,20)`）；
- **黑色下阴影**：`0 4px 4px rgba(0,0,0,1)`，置于**独立底层 `.shd`**（避免落在 `background-clip:text` 的渐变层上失效；与 E5 上半同款阴影）。

```css
.btn { position:absolute; text-align:center; font-family:"Sarasa Gothic SC"; font-size:24px;
       letter-spacing:1px; white-space:nowrap; }   /* left/width 定位 + line-height=<块高> 居中 */
/* 三层兄弟节点并列（.shd=0 < .gout=1 < .gin=2） */
.shd  { position:absolute; left:0; right:0; top:0; z-index:0; color:#fff;
        -webkit-text-stroke:3px #fff;              /* 字形剪影（含描边范围），供阴影使用 */
        text-shadow:0 4px 4px rgba(0,0,0,1); }
.gout { position:absolute; left:0; right:0; top:0; z-index:1;
        color:transparent; -webkit-text-stroke:3px #015514; }
.gin  { position:absolute; left:0; right:0; top:0; z-index:2; -webkit-text-stroke:0;
        background:linear-gradient(to bottom, #FFFFFF 0%, #FFFFFF 50%, #CDFDCD 50%, #CDFDCD 100%);
        -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
```

```html
<div class="btn" style="left:<x0>px; top:<y0>px; width:<w>px; line-height:<块高>px;">
  <span class="shd">中文</span><span class="gout">中文</span><span class="gin">中文</span>
</div>
```

- 踩坑：`.gin` 必须显式 `-webkit-text-stroke:0`（承接自父层/兄弟描边会盖住渐变）；`.shd` 用 `#fff` 加 3px 白描边构成字形剪影，其本身被 `.gout`/`.gin` 覆盖，仅影出下方阴影。
- 应用图：`res\images\SO039-1.png`（SO039 第三列）；对比页 `.tmp\so039_compare.html`（live CSS，可 DevTools 调 `.shd/.gout/.gin`）。

---

## E9 黑红混排按钮字（E5 上半 + E6 同框）— SO021「去城砦」

**场景**：同一行内「黑字（E5 上半）」与「红字（E6）」并存（如 SO021「去城砦」：**去=黑（E5 上半）、城砦=红（E6）**）。两者共用白描边 4px 100% + 阴影 `0 4px 4px`（`.out` 层对整串描边），文字填充按字分色（`.in` 层）。**字号可按部件独立设置**（黑部件 `.s18` 18px / 红部件默认 20px，可按需改）。

```css
.btn { position:absolute; text-align:center; font-family:"Sarasa Gothic SC"; font-size:20px;
       letter-spacing:1px; white-space:nowrap; }   /* 基准 20px；部件用 .s18 等覆盖字号 */
/* 白描边 100% + 阴影（整串，`.out` 层）；`<span class="s18">` 用于字号不同的部件，须与 `.in` 同拆分 */
.out { position:absolute; left:0; right:0; top:0; z-index:1;
       -webkit-text-stroke:4px rgba(255,255,255,1); color:rgba(255,255,255,1); text-shadow:0 4px 4px rgba(0,0,0,1); }
.in  { position:absolute; left:0; right:0; top:0; z-index:2; }
.s18 { font-size:18px; }                                     /* 黑色部件字号 */
.in .e5 { color:#000; -webkit-text-stroke:0.5px #000; }      /* 黑（E5 上半） */
.in .e6 { color:#FD480A; -webkit-text-stroke:0; }            /* 红（E6） */
```

```html
<div class="btn" style="left:<x0>px; top:<y0-1>px; width:<w>px; line-height:<块高>px;">
  <span class="out"><span class="s18">去</span>城砦</span>
  <span class="in"><span class="s18 e5">去</span><span class="e6">城砦</span></span>
</div>
```

- `.out` 与 `.in` 必须按**同样的部件/字号拆分**（保证白描边与填色逐字对齐）；共用一行基线，行高 = 块高垂直居中。
- 定位：`top = y0 - 1`（**向上偏移 1px**，用户指定）。
- 应用图：`res\images\SO021-3.png`（SO021「去城砦」黑 18px / 红 20px）。

---

## E10 同纹三列变体（同图切换）— SO001 按钮

![E10 示例：同纹三列变体（列1 米白 / 列2 纯青 / 列3 灰）](../../res/images/fonts/E10_so001_3col.png)

> 裁自 `res\images\fonts\E10_so001_3col.png`（三块并排，各 77×78 放大 3x）；对应场景 SO001 5 行 × 3 列按钮（设定变更/初始化/全解除/閉じる/戻る → 变更设置/初始化/全部移除/关闭/返回）

**场景**：同一按钮图形存在三列可互相切换的变体（**同一底图几何、同一文字；仅配色/填色换肤**），且三列周围花纹（边框/角纹/内圈）逐像素一致。三列分别为：

| 列 | 底 | 文字填充 | 描边 | 阴影 |
|---|---|---|---|---|
| 列1 米白 | 米白/暖棕渐变 | 黄金渐变字（白→金） | `2px #3A2709`（深棕） | `2px 2px 1px rgba(0,0,0,1)` |
| 列2 纯青 | 纯浅青 `(1,254,255)` | **白→青**渐变字（底部 = 背景纯青） | `2px #1438E0`（深蓝） | 无 |
| 列3 灰 | 灰白渐变（= 列1 去饱和度） | **透明→50%黑**渐变（叠灰底 = 与背景混合） | `2px rgba(0,0,0,.6)`（黑） | 无 |

> 备注：列2 字内下半部分 = 外部背景纯青（字在青底上是"白→青"渐变）；列3 的半透明黑字叠于灰底，视觉与背景混合（非 PNG 透明）。

**通用**：Sarasa Gothic SC **bold**、22px、letter-spacing 1px、字宽缩放（2/3 字 `scaleX(0.8)`、4 字 `scaleX(0.6)`）；三层 `grid-area:1/1` 重叠（需描边则 `.out` + 填充 `.gin`，列1 另加阴影层 `.shd`）。

```css
.tbox { display:grid; place-items:center; font-family:"Sarasa Gothic SC"; font-weight:700;
        font-size:22px; letter-spacing:1px; line-height:22px; white-space:nowrap; transform:scaleX(0.8); }
.ly { grid-area:1/1; }

/* 列1 米白：白→金渐变 + 深棕描边 + 黑阴影 */
.w-shd { color:transparent; -webkit-text-stroke:0; text-shadow:2px 2px 1px rgba(0,0,0,1); }
.w-out { color:transparent; -webkit-text-stroke:2px #3A2709; }
.w-gin { color:transparent; -webkit-text-fill-color:transparent;
         background:linear-gradient(to bottom,#FFFFFF 0%,#FDD896 30%,#FBC568 62%,#FDAB0A 100%);
         -webkit-background-clip:text; background-clip:text; }

/* 列2 纯青：白→青渐变（底部=背景青）+ 深蓝描边，无阴影 */
.c-out { color:transparent; -webkit-text-stroke:2px #1438E0; }
.c-gin { color:transparent; -webkit-text-fill-color:transparent;
         background:linear-gradient(to bottom,#FFFFFF 0%,#C8ECFF 30%,#4FD4FF 70%,#01FEFF 100%);
         -webkit-background-clip:text; background-clip:text; }

/* 列3 灰：透明→50%黑渐变（叠灰底=与背景混合）+ 黑描边，无阴影 */
.g-out { color:transparent; -webkit-text-stroke:2px rgba(0,0,0,0.6); }
.g-gin { -webkit-text-stroke:0;
         background:linear-gradient(to bottom,rgba(0,0,0,0) 0%,rgba(0,0,0,0.22) 45%,rgba(0,0,0,0.45) 100%);
         -webkit-background-clip:text; background-clip:text;
         -webkit-text-fill-color:transparent; color:transparent; }
```

```html
<!-- 列1（含阴影层）；列2/列3 去掉 .w-shd 层即无阴影 -->
<div class="tbox"><span class="ly w-shd">返回</span><span class="ly w-out">返回</span><span class="ly w-gin">返回</span></div>
```

- 三列文字渐变边界一致（同字形、同位置、同字号、`background-clip:text` 落字内），保证同图切换时边界不跳。
- 应用图：`res\images\SO001-1.png`；清理流程见 `docs/images/SO001.md`。

---

## 附：各效果已应用图（速查）

| 效果 | 图片 | 详情 |
|---|---|---|
| E1 | SO009A（三行）、SO009B（金/青两列） | docs/images/SO009A.md §2–3、SO009B.md |
| E2 | SO020 上半 11 按钮、SO021 块 A、SO025 块 A | docs/images/SO020.md §4、SO021.md、SO025.md |
| E3 | SO020 下半 11 按钮、SO021 块 B、SO025 块 B | docs/images/SO020.md §5、SO021.md、SO025.md |
| E4 | SO017 兵种名 | docs/images/SO017.md |
| E5 | SO030 第一轮 16 按钮、SO020 8 按钮（返回/物品/装备/技能）、SO009A 返回×2 | docs/images/SO030.md §6、SO020.md §8、SO009A.md §7 |
| E6 | SO030 第二轮 4 按钮（防卫开始/决定）、SO020 4 按钮（探索开始/出击） | docs/images/SO030.md §7、SO020.md §7 |
| E7 | SO009B 第一列（outline 阴刻，三列最终版 SO009B-4） | 本文件 E7 节、docs/images/SO009B.md §9 |
| E8 | SO039 第三列（上白下浅绿两段式 + 深绿描边 + 黑阴影，SO039-1） | 本文件 E8 节、docs/images/SO039.md §3.2 |
| E9 | SO021「去城砦」（黑=E5 上半 18px + 红=E6 20px，SO021-3） | 本文件 E9 节、docs/images/SO021.md §8.3 |
| E10 | SO001 同纹三列变体（列1 米白 / 列2 纯青 / 列3 灰，SO001-1） | 本文件 E10 节、docs/images/SO001.md |

## 附：关键踩坑汇总

1. **`-webkit-text-stroke` 继承**：内层文字必须显式 `-webkit-text-stroke: 0` 或与描边层并列（E4 渐变层、E5/E6 红黑字均中招过）。
2. **阴影层顺序**：WebKit 中 `text-shadow` 绘制于 `text-stroke` 之上，需独立底层（E4 的 `.sh`）。
3. **并列结构**：`.in` 在前、`.out` 在后为兄弟节点（用户确认），z-index 保证红/黑字在描边之上。
4. **关闭插值**：所有 canvas drawImage 前 `imageSmoothingEnabled=false`，放大保持像素锐利。
5. **字号与原文比对**：新字号先对日文原文做逐行方差/投影测量（如 SO020 8 按钮 28→30px 依据：探索開始≈27–28 / 出撃=30 / 戻る=29，戻る 偏矮属字形本身）。
6. **清理列检查**：fill-col 必须避开文字笔画（统计列上深色像素行数，仅顶/底边框行深色才干净）。
7. **headless 拉丁 fallback**：渲染页若不加 @font-face 引用本地字体，headless Chrome 对系统字体「Sarasa Gothic SC」的拉丁/罗马数字会 fallback（汉字正常、ADV/ⅠⅡⅢ 委托系统西文字体，与浏览器不一致；SVG `<text>` 与 HTML 均受影响）。修复：CSS 顶部加 `@font-face`（Regular 400 / Bold 700，相对路径 `../../../res/fonts/SarasaGothicSC/...`）——加后 headless 与浏览器宽度一致。
8. **同步测量 fallback 假象**：@font-face 字体异步加载，**同步** `getBoundingClientRect`/`measureText` 可能在字体未就绪时返回 fallback 宽度（曾误判 ADV 窄 1.2/2.86px）。宽度测量必须 **`await document.fonts.load(...)` + `await document.fonts.ready` 后**用 canvas `measureText`（E7 的 X 计算即此方法：28px bold X=4.93、20px X=1.36）。
9. **SVG text stroke 逐笔画**：SVG `<text stroke>` 与 CSS `-webkit-text-stroke` 对多笔画汉字按每个笔画轮廓描边（内部重叠杂乱），汉字描边须用 region filter 环（E7）。
