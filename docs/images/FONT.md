# 天結 UI 文字效果总览（FONT）

> 本文档汇总工程内**所有已确认**的 UI 文字渲染效果（含 CSS 参数与 HTML 结构），作为后续 SO 图文字渲染的速查与复现依据。
> 原则：**样式参数因场景而异，新场景必须由用户确认，不得直接套用其它场景默认值**（详见 `amayui-ui-text-render` 技能）。
> 渲染管线：headless Chrome 截图（`--force-device-scale-factor=1 --default-background-color=00000000`）→ `node scripts/agf/cli.js inject` 编译 AGF。

## 0. 通用基础

- **字体**：文泉驿微米黑 `res/fonts/WenQuanYi.ttf`，统一 `@font-face`：
  ```css
  @font-face { font-family: "WenQuanYi"; src: url("../res/fonts/WenQuanYi.ttf"); }
  ```
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

---

## E1 纯文本行（金色/青色）— 设置页文字行

**场景**：SO009A 设置页三行文字、SO009B 三列菜单文字（透明/纯色背景上的单行文字）。

```css
font-family: "WenQuanYi"; font-size: 20px; line-height: 1;
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

**场景**：SO020 上半 11 个纯色底按钮（米白底 #FEF3E5/#F0F0E0、无边框）、SO021/SO025 块 A 面板等。

```css
font-family: "WenQuanYi"; font-size: 20px; line-height: <块高>px;  /* 块高=按钮高度，垂直居中 */
letter-spacing: 1px; color: #000; -webkit-text-stroke: 0.5px #000; text-align: center;
```

```html
<div class="btn" style="left:<x0>px; top:<y0>px; width:<w>px;"><span class="in">中文</span><span class="out">中文</span></div>
<!-- .in/.out 均 .btn 内并列；.in 显式 -webkit-text-stroke:0；.out 无描边（单层黑字时 .out 可为空/省略） -->
```

- 描边 0.5px `#000` 用于增加字重（笔画约 +50% 像素）。
- 清理：纯色底保留左右 15px、中间逐行复制第 16px 列（x0+15）。

## E3 渐变底按钮（黑字 + 半透明白边）

**场景**：SO020 下半 11 个边框+渐变按钮（黑色圆角边框 + 青蓝渐变底）、SO021/SO025 块 B 小按钮。

```css
/* 文字主体同 E2 */
font-family: "WenQuanYi"; font-size: 20px; line-height: <块高>px;
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

**场景**：SO017 兵种名红字（红色描边 + 白心渐变 + 黑阴影），坐标中心定位。

```css
.ln { position: absolute; font-family: "WenQuanYi"; font-size: 22px; line-height: 1;
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

**场景**：SO030 第一轮 16 按钮（103×73）、SO020 8 按钮（103×73）、SO009A 返回按钮 ×2（117×81）。
**这是当前 30px 大按钮的标准效果**（用户确认）。

```css
.btn { position: absolute; width: <w>px; text-align: center; line-height: <块高>px;
       font-family: "WenQuanYi"; font-size: 30px; letter-spacing: 1px; white-space: nowrap;
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

## 附：各效果已应用图（速查）

| 效果 | 图片 | 详情 |
|---|---|---|
| E1 | SO009A（三行）、SO009B（金/青两列） | docs/images/SO009A.md §2–3、SO009B.md |
| E2 | SO020 上半 11 按钮、SO021 块 A、SO025 块 A | docs/images/SO020.md §4、SO021.md、SO025.md |
| E3 | SO020 下半 11 按钮、SO021 块 B、SO025 块 B | docs/images/SO020.md §5、SO021.md、SO025.md |
| E4 | SO017 兵种名 | docs/images/SO017.md |
| E5 | SO030 第一轮 16 按钮、SO020 8 按钮（返回/物品/装备/技能）、SO009A 返回×2 | docs/images/SO030.md §6、SO020.md §8、SO009A.md §7 |
| E6 | SO030 第二轮 4 按钮（防卫开始/决定）、SO020 4 按钮（探索开始/出击） | docs/images/SO030.md §7、SO020.md §7 |

## 附：关键踩坑汇总

1. **`-webkit-text-stroke` 继承**：内层文字必须显式 `-webkit-text-stroke: 0` 或与描边层并列（E4 渐变层、E5/E6 红黑字均中招过）。
2. **阴影层顺序**：WebKit 中 `text-shadow` 绘制于 `text-stroke` 之上，需独立底层（E4 的 `.sh`）。
3. **并列结构**：`.in` 在前、`.out` 在后为兄弟节点（用户确认），z-index 保证红/黑字在描边之上。
4. **关闭插值**：所有 canvas drawImage 前 `imageSmoothingEnabled=false`，放大保持像素锐利。
5. **字号与原文比对**：新字号先对日文原文做逐行方差/投影测量（如 SO020 8 按钮 28→30px 依据：探索開始≈27–28 / 出撃=30 / 戻る=29，戻る 偏矮属字形本身）。
6. **清理列检查**：fill-col 必须避开文字笔画（统计列上深色像素行数，仅顶/底边框行深色才干净）。
