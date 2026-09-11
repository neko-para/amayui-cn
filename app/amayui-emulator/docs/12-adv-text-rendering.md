# 12 ADV／消息窗文本渲染选型（ADR）

> 状态：**评估完成，决定采用「纯排版模型 + Pixi 内 canvas2D 光栅化成纹理」（下方方案 D）**。
> 输入：引擎侧分析见 [`docs-new/03-engine/adv-text-rendering.md`](../../../docs-new/03-engine/adv-text-rendering.md)
> 与 `analysis/engine-capabilities.json` 的 `msgwin-*`/`text-*` 系列条目。
> 本文只做**选型与落地设计**，不重复引擎分析。

---

## 0. 结论

**用 Pixi 渲染，但不用 `pixi.Text` 的排版，而是自己排版 + 用 canvas2D 把「一个窗口的文本」光栅化成一张 Pixi 纹理。**

三层分工：

```
MsgTextView (纯 TS，无 DOM/Pixi)   ← 引擎语义全在这里，可在 Node 里测/快照
        ↓ 已排版字形 + 显现游标
TextRasterizer (canvas2D → Texture) ← fillText/strokeText 逐字画，一行代码没几行
        ↓ Pixi Sprite(层序 = 20+win)
ScenePresenter / drawRoot          ← 与现有 draw-item 同一套合成
```

**不用 DOM 叠加层**。理由的核心不是"麻烦"，而是**它省不掉任何东西**（见 §4.1）：
浏览器给 canvas2D 与 DOM 的是**同一个字体光栅器**，所以"省掉字体渲染困难"是错觉；
而 DOM 会换来「两套合成器 + 报告里看不到文字 + 排版规则与引擎分叉」三项结构性代价。

---

## 1. 需要被替代的到底是什么（能力清单，逐条对应引擎事实）

**优先级口径**（用户确认）：**描边/阴影、颜色、字号必须复刻（直接决定阅读体验）**；
抗锯齿开关、字形度量/hinting、字体缓存等"字体内部配置"只需**知道字段存在**，不追实际效果。

| # | 需求（引擎事实） | 量级 | 优先级 |
|---|---|---|---|
| R1 | **等宽网格**：全角 1em / 半角 0.5em（引擎 `lfWidth = 字高/2`） | 全部文本 | **P0** |
| R2 | **自动换行**：逐字量宽 + 右/下边界硬断；**无禁则、无 `\n`** | 全部文本 | **P0** |
| R3 | **注音（ルビ）**：独立小号字体 + 与本文配对（24B 记录 `+0` 种类 / `+20` 组 ID） | 6341 处 | **P0** |
| R4 | **水平 / 垂直**：`win+235108`；竖排 = 逐字沿 y 推进 | 878 处 `i261 1` | **P0** |
| R5 | **对齐** 左/中/右：`win+288` + `win+292` | 252 处 | P1 |
| R6 | **描边 / 阴影（阅读体验，必须复刻观感）**：填充色 `+1360` + 描边色 `+1364` + 偏移 `(+1384,+1388)`；档位 `+1372` = 0 无 / 1 单向投影 / 2 1-4 强度副本 / 3 多向描边。**默认就是 1**（白字 + 黑投影） | 全部文本 | **P0** |
| R7 | **字体选择**：面名 + 字号 + 加粗(700)；主/注音两套 | 1051/875 处 | **P0** |
| R7b | 字体**内部**配置：抗锯齿开关（`+1352`，随包关闭）、AA 灰度级 `+218500`、字形度量探针（参考字「激」`+201704`）、内存字形缓存（hashtable `+3444`/位图 `+3524`）、`lfWidth`/`lfHeight` 具体取值 | — | **P2（仅记录字段存在，不追效果）** |
| R8 | **额外颜色** 3 个（`+1368/+1380/+1392`） | 878 处 `i08b` | **P0**（脚本显式设置 ⇒ 影响观感） |
| R9 | **逐字/逐行显现**：按行（或按字格）一块块出；节拍 = `message:MessageSpeed` | 全部 ADV | **P0**（阅读体验） |
| R10 | **淡入**：行 alpha 动画窗，时长 `MessageSpeed × MessageFade / 100` ms | 全部 ADV | P1 |
| R11 | **窗口**：10 个独立窗，各带 (x,y,w,h)、文字起点、底色、缩放后 w/h | 全部 | **P0** |
| R12 | **回看（backlog）**：`win+132` 行游标 + 页表 | `0x84` / 滚轮 | P2 |
| R13 | **脚本可观测的一致**：`0x83`(当前行) `0x1C5`/`0x2C2`(读回已显示文本) `0x2F3`(行坐标) `0x7F`(速度) | 少量但**静默错** | P1 |
| R14 | **不需要**（引擎也不具备）：单字旋转/缩放、字距微调、按 alpha 混文字色、字形 atlas、断行禁则 | — | — |

---

## 2. 候选方案

| 方案 | 一句话 | 排版 | 光栅化 | 合成 |
|---|---|---|---|---|
| **A. DOM 叠加层** | 在 canvas 之上叠一个 `position:absolute` 的 div，用 `<ruby>`/`<span>` + CSS | **CSS**（浏览器断行器） | 浏览器 DOM 光栅 | 第二套合成器 |
| **B. `pixi.Text`** | 每行一个 `Text`；内置 `wordWrap`/`align`/`stroke`/`dropShadow` | Pixi（canvas 量宽） | canvas2D → 纹理 | 同一套 |
| **C. `pixi.HTMLText`** | HTML 经 SVG `foreignObject` → 纹理 | CSS | 浏览器（SVG 光栅） | 同一套 |
| **D. 自排版 + canvas2D→纹理** ★ | 纯 TS 排版；canvas2D `fillText`/`strokeText` 画进离屏 canvas → `Texture` → `Sprite` | **自己写** | canvas2D | 同一套 |
| E. 自定义 SDF/WebGL 字形 | 自己造字形图集 + 着色器 | 自己写 | 自己写 | 同一套 |

---

## 3. 逐能力对比

`✔` 原生支持 ／ `△` 需自行补齐（量小） ／ `✘` 做不到或代价不合理

| # | 能力 | A. DOM | B. `pixi.Text` | C. `HTMLText` | **D. ★** |
|---|---|---|---|---|---|
| R1 | 等宽网格 | ✘ CSS 按字体度量断行，与引擎网格不一致 | △ 需要自己算（`wordWrap` 用的是字体度量） | ✘ 同 A | △ 自己算 = 5 行 |
| R2 | 边界硬断、无禁则 | ✘ CSS 会加禁则/`line-break` 行为 | △ 同上 | ✘ | △ 就是 `x > w` 判断 |
| R3 | 注音 | ✔ `<ruby><rt>` | ✘ 不支持，需每段 ruby 再叠一个 `Text` | ✔ `<ruby>` | △ 自己摆（引擎也是自己摆） |
| R4 | 竖排 | ✔ `writing-mode: vertical-rl` | ✘ **不支持**，必须逐字摆 | ✔ | △ 交换 xy（CJK 字形不旋转） |
| R5 | 对齐 | ✔ | ✔ `align` | ✔ | △ 一行算术 |
| R6 | 描边/阴影 | ✔ `-webkit-text-stroke` + `paint-order` + `text-shadow` | ✔ `stroke` + `dropShadow`（**各 1 组**） | ✔ | ✔ `strokeText` + `lineWidth`（**语义上是"真描边"，比引擎 GDI 的 4 次偏移更接近 D3DX 的圆环描边**） |
| R7 | 字体/字号/粗体 | ✔ | ✔ | △ 字体必须内嵌 | ✔ 同 canvas |
| R8 | 多颜色层 | ✔ 多层 span | △ 每层一个 `Text` | ✔ | △ 同 A（分层 draw 即可） |
| R9 | 逐字显现 | ✔ 前缀 span / 逐字 span + CSS | △ 改 `text` 触发重新光栅 | ✘ 每次改动重新序列化 SVG | ✔ 改游标后重新光栅（一张 canvas，便宜） |
| R10 | 淡入 alpha | ✔ `opacity` | ✔ `Sprite.alpha` | ✔ | ✔ `Sprite.alpha` |
| R11 | 多窗 + 层序 | ✘ **只有"最上层"** | ✔ | ✔ | ✔ 层序 = `20+win`（与引擎平面号一致） |
| R12 | 回看光标的可视结果 | △ | △ | △ | △ 都只是"重新算一次显现数量" |
| R13 | 脚本可观测一致 | ✘ 依赖 CSS 断行 ⇒ 行/字数与引擎分叉 | △ | ✘ | ✔ **排版在纯 TS 里，可断言** |
| — | 与 Scene 的层序/转场/滤镜/遮罩 | ✘ 无法参与 | ✔ | ✔ | ✔ |
| — | 无头可测 / `npm run report` 可见 | ✘ DOM 不进 Node | △ 光栅不进 Node，但模型可测 | ✘ | **✔ 排版模型可测，报告里能看到每窗文本+游标** |
| — | 字形清晰度 | ✔ 设备像素 | △ 1× 光栅（可 `resolution: 2`） | △ | △ 同 B（用 `resolution = dpr`） |

---

## 4. 关键判据

### 4.1 方案 A 的"省事"是错觉

引擎的文本不是"一行 CSS 能表达的东西"：
- **断行规则由引擎定**（逐字量宽 + `win+36/+40` 硬断，**没有禁则**）。
  若交给 CSS，`line-break`/`word-break`/`overflow-wrap` 的默认行为会给出**不同的行数**，
  而行数直接决定 `0x83`（当前行号）、`0x1C5`/`0x2C2`（读回已显示文本）、以及逐行显现的**行边界**——
  这些是脚本可观测的 ⇒ **把静默错误从像素层搬到了 VM 层**，与本项目"闸门 A/B/C"的立意相反。
- **"字体渲染的困难"并不存在**：`pixi.Text` 内部就是 canvas2D `fillText`/`strokeText`
  （`lib/scene/text/canvas/CanvasTextGenerator.mjs`），与 DOM 用的是**同一个浏览器字体光栅器与 shaping**。
  两者的差别只剩**排版**，而排版我们必须自己写（理由见上一条）。
- **两套合成器**：引擎把消息窗**合成进 Scene**（D3D 路径逐行 `sub_4ACE50` 建 DrawItem；
  DD 路径 blit 到表面 0）。DOM 叠加层永远是"最上面的一层"，
  等于把引擎的层序语义压成常量；一旦实现转场（wipe 要盖住文字）或 `DisplayObject` 遮罩就必然返工。
- **可测性**：本工程的验收方式是"快照 + 闸门 + `npm run report`"。DOM 层在 `HeadlessScene` 里不存在，
  于是"报告说没有文本、画面却有/没有"这类最难查的漂移会重新出现。

### 4.2 为什么不是 `pixi.Text`（方案 B）

`pixi.Text` 的能力边界（实测 8.20.1 源码）：
`fill`（1 组）+ `stroke`（1 组）+ `dropShadow`（1 次阴影 pass），`letterSpacing`/`lineHeight`/`align`/`wordWrap`；
**没有注音、没有竖排、没有逐字摆位、没有多色层**。
- 注音（6341 处）与竖排（878 处）都是**必须**的；两者都要求逐字/逐段自摆 ⇒ `pixi.Text` 的排版能力用不上，
  只剩"光栅化"这一件事 —— 而那件事用一张 canvas 自己做更直接（还能一次纹理解决 R9/R10）。
- 若按"每字一个 `Text`"实现竖排，一条 60 字消息就是 60 个对象 + 60 张纹理当帧重建，得不偿失。

**但方案 B 有一个保留用途**：**一次性直绘**字符串（`draw-string` 0x204/0x205、`0x89`/`0x8A`、`0x221`）
没有显现过程、不需要注音配对，用 `pixi.Text` 一次成形最省事。这仍是 Pixi 管线，不破坏一致性。

### 4.3 为什么不是 `HTMLText`（方案 C）

它靠 SVG `<foreignObject>` → `<img>` → 纹理。**`<img>` 里的 SVG 不能加载外部资源**，
`@font-face` 不会生效，字体只能 base64 内嵌 —— 而工程内 CJK 字体是 24 MB 级（`res/fonts/SarasaGothicSC/*.ttf`），
不可能内嵌。另外每次文本变化都要重新序列化整棵 HTML → SVG。

### 4.4 为什么不是自定义字形图集（方案 E）

引擎**没有逐字变换、没有字形 atlas**（`docs-new/03-engine/adv-text-rendering.md` §2）：
逐字摆位只是"等宽网格 + 行偏移"。用浏览器 canvas 光栅器 + 1×/dpr 分辨率就够了，
自己做 SDF 只会引入"字形度量与浏览器不一致"的新风险。

---

## 5. 落地设计

### 5.1 分层

```
src/vm/msgwin.ts                     ← 已有：槽/段/注音/状态机（VM 语义）
src/renderer/text/fontSet.ts         ← 新增：引擎字体名 → 内嵌字体族的映射表
src/renderer/text/layout.ts          ← 新增：纯排版模型（无 DOM/Pixi！）
src/renderer/text/raster.ts          ← 新增：canvas2D 光栅化 → Pixi Texture（唯一的浏览器依赖）
src/renderer/pixi/textLayer.ts       ← 新增：把 10 个窗的 Sprite 按层序插进 drawRoot
src/renderer/scene/ops.ts            ← 扩展：msgwin opcode → layout/raster 的触发
```

**`layout.ts` 的接口（纯函数，可快照）**：

```ts
export interface TextStyleSnap {          // 一次 show-text/display-furigana 之后的窗口状态快照
  win: number;                            // 0..9
  rect: { x: number; y: number; w: number; h: number };   // win+12/16/20/24
  origin: { x: number; y: number };       // win+28/32
  vertical: boolean;                      // win+235108 & 1
  align: 0 | 1 | 2;                       // win+288
  alignWidth: number;                     // win+292
  main: FontSnap;                         // 面族/字号/粗体/填充色/描边色/描边偏移/模式
  ruby: FontSnap;
  lines: Array<{ glyphs: Glyph[]; x: number; y: number; width: number }>;
}
export interface Glyph {
  ch: string;                             // 单个字符
  x: number; y: number;                   // 相对窗口原点
  ruby?: { text: string; x: number; y: number; size: number };
}
export function layoutWindow(slots: MsgSlot, snap: TextStyleSnapInput): TextStyleSnap;
export function revealCountOf(snap: TextStyleSnap, cursor: number): number;  // 行/字两级
```

### 5.2 排版算法（直接照引擎）

```text
advance(ch, size)  = (sjisBytes(ch) === 2 ? 1 : 0.5) * size        // R1
换行（水平）        : 逐字累加 adv，若 penX > w ⇒ 断行              // R2（无禁则）
换行（垂直）        : penY += adv，若 penY > h ⇒ 换列（x -= size）  // R4
注音               : 本文词与注音同组 ⇒ 注音左端 = 词左端 + (词宽 − 注音宽)/2  // R3
对齐               : mode 1 ⇒ off = (alignWidth − lineWidth)/2 ; mode 2 ⇒ alignWidth − lineWidth
显现               : 行级（默认）—— `sub_45BE20` 一次一行；字级 —— 仅当 `0x73` 设过字格
```

> ⚠️ 字形度量**不查浏览器**：引擎的 `lfWidth = 字高/2` 已经把它钉成等宽网格，
> 因此 `advance()` 是纯算术 ⇒ 排版完全确定、可在 Node 里断言。
> 这也顺带修掉"CSS/浏览器度量与引擎不一致"这个隐患。

### 5.3 光栅化

```ts
// 每个窗一张离屏 canvas（尺寸 = 窗 w×h × resolution），仅在文本/显现游标变化时重画
function raster(snap: TextStyleSnap, revealed: number, res: number): ICanvas
//  1) ctx.font = `${weight} ${size*res}px "${family}"`;  textBaseline = 'alphabetic'
//  2) 逐字形：命中 revealed 之外 ⇒ 跳过
//  3) 描边 + 填充（顺序 = 先描边后填充，等价 `paint-order: stroke`）        ← R6（P0）
//  4) 注音：小号字体，同样描边 + 填充（引擎也是两套字体）                   ← R3
```

**`Font+1372` 档位 → canvas 实现（R6 = P0，必须复刻观感）**：

| 档 | 引擎行为 | canvas 等价实现 |
|---|---|---|
| 0 | 只画一遍 | `fillText` |
| 1 | 额外一遍 `(x+dx, y+dy)`，用描边色 | 先 `fillText` 在 `(x+dx, y+dy)` 涂描边色，再 `fillText` 居中涂填充色（**投影式**，与引擎同形） |
| 2 | 同位置再叠一遍 1/4 强度的字形副本 | `globalAlpha = 0.25` 再 `fillText` 一遍（软化/加粗观感） |
| 3 | 多向描边（GDI 四对角、D3DX 按 `360/(8r)` 圆环扫描） | `ctx.lineJoin='round'; ctx.lineWidth = 2*max(dx,dy); ctx.strokeText` —— **语义上的真描边**，与 D3DX 圆环扫描等价且更干净 |

> 描边色/填充色/偏移三件套直接来自 `Font+1360`/`+1364`/`+1384`/`+1388`（op `0x76`/`0x77`/`0x1A4`），
> 档位来自 `Font+1372`（op `0x78`）。**默认 = 档 1（白字 + 黑投影）**，是最常见的 ADV 观感。

- 竖排 CJK **不旋转字形**（引擎用 `'@'` 面 + escapement 2700 是 GDI 的权宜；我们只需换轴）。
- 纹理：`Texture.from(canvas)`（或 `renderer.textureGenerator`），`Sprite` 挂在 `drawRoot`，
  层序用 `20 + win`（与引擎平面号一致），`alpha` 接 R10。
- **重画节流**：显现游标只在 `message:MessageSpeed`（默认 5 ms/步）推进时变化 ⇒ 每步一张纹理，
  一页文本最多几十张，与现有 draw-item 纹理量级相同。

### 5.4 字体（必须显式解决）

| 引擎侧 | emulator 映射 |
|---|---|
| `message:Font`（随包 = `Amayui CN`） | 内嵌 `res/fonts/Amayui-CN_cnjp.ttf`（汉化版） |
| `ＭＳ ゴシック` / `MS Gothic` | Sarasa Gothic SC（`res/fonts/SarasaGothicSC/`） |
| `ＭＳ 明朝` / `MS Mincho` | Mincho/Serif CJK（缺则回退 Sarasa Gothic 并**记录一次告警**） |
| `メイリオ` / `Meiryo` | Sarasa Gothic SC |

- 引擎的字体名白名单来自 `EnumFontFamilies`（raw 74146-74171，`Font+201664`），
  `0x1A5`/`0x2FE` 会对不在表内的名字打警告（raw 41385/41613）。emulator 的"表"就是上面的映射表；
  **`0x2DE`（面名→下标）也查这张表**。
- **竖排的 `'@'` 前缀必须剥掉**再交给浏览器（`fontSet.ts` 的责任）。
- `@font-face` 需在渲染窗 boot 时加载完（`document.fonts.load` / `document.fonts.ready`）再画字。
- 抗锯齿：随包 `set:EnableAntiFont` 缺失 ⇒ 引擎**不开 AA**（`Font+1352=0`）。
  emulator **一律开 AA**（现代浏览器无法关）—— 这是**有意的保真取舍**，记入本文 §7。

### 5.5 分阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| **S1 纯模型** | `layout.ts` + `fontSet.ts` 的映射表；`msgwin` 增加 `textStyle` 快照字段 | 单测：等宽推进 / 边界断行 / 注音居中 / 竖排换列 / 对齐 / 显现游标；`npm run report` 的 txt 快照里出现每窗文本与游标 |
| **S2 光栅化 + 上屏** | `raster.ts` + `textLayer.ts`；描边四档（§5.3 表）+ 层序 `20+win` | 目视：CONFIG1 样例窗（窗 9，824×120 @ (324,570)，竖排，字号 30，粗体，白字 + 描边，注音 10px）显示正确 |
| **S3 参数面（P0：观感）** | `0x70/0x75/0x76/0x77/0x78/0x79/0x80/0x8B/0x1A4/0x197/0x198/0x1A5/0x1C1/0x261/0x2BD/0x2FE` —— **其中描边/颜色/字号是阅读体验，必须逐档可配** | 每个 opcode 一条 E2 断言 + 一条 CONFIG1/真实脚本的 E3 场景断言；描边四档各一张截图对照 |
| **S4 显现与淡入** | `0x1CE/0x20A` + 行级显现 + `MessageSpeed` 节拍 + 行 alpha 动画窗（复用现有 draw-item 色窗） | 状态机测试：`0x71`→逐行→`0x72` 挂起→点击推进；时长 = `Speed*Fade/100` |
| **S5 回写与布局参数** | `0x7F/0x83/0x1C5/0x2C2/0x2F3/0x2DE`（**不得当 no-op**）+ `0x303` 对齐 | 每条断言"操作数被写入且值来自模型" |
| **S6 低优先级** | 回看页表（`0x84`/滚轮）、字体内部配置（R7b）| 按需；字段已在数据层登记 |

### 5.6 顺带修掉的既有错误（本次分析发现，**已修**）

1. ✅ `message:MesWinAlpha` 被误绑到字段 `21668`，而 `21668 = Font+1376 = message:MessageSpeed`
   —— 两个键写同一字段（随包 INI 的 `MesWinAlpha=8` 会把 `MessageSpeed=5` 顶掉）。
   已从绑定表移除，并补 `0x141`（直写配置）；`0x131`/`0x141` 走配置注册表。
2. ✅ `0x7F` 的注释与实现说明写成"消息窗 α"，实际是 **`message:MessageSpeed`**（`i07f` 全工程 210 处）。
3. ✅ `0x74` 的语义写成"放大百分比"，实际是 **`SetMessageSpeed`**。
4. ✅ **绑定表的键空间混乱**：`CONFIG_FIELD_BINDINGS` 里混用了 raw 的**字节偏移**与 handler 的 **dword 下标**，
   导致 `message:MessageFade`（写 `320424`，而 `0x2EE` 读 `80106`）与 `message:MessageSpeed`
   （写 `86672`，而 `0x7F` 读 `21668`）**写入的字段没人读**。已统一为 dword 下标并在函数头写明约定。
   （`sound:*` 三行已按 raw 换算；`sound:Music` 与 `0xC0` 的字段分歧属音频范围，已标 ⚠ 待专项复核。）

---

## 6. 成本估算（方案 D）

| 项 | 规模 |
|---|---|
| `layout.ts`（网格 / 断行 / 注音 / 竖排 / 对齐 / 显现游标） | **~250-350 行**（纯函数） |
| `raster.ts`（canvas2D 描边+填充+注音） | ~150-200 行 |
| `textLayer.ts` + `scene/ops.ts` 接线 | ~100-150 行 |
| `fontSet.ts` + 字体加载 | ~60 行 |
| 测试（S1 单测 + S2/S3 场景断言） | ~250 行 |
| P0/P1 opcode（约 24 条） | 多数 5-15 行/条 |

对照：方案 A 若要达到同等**可测性 + 层序正确**，需要额外解决 §4.1 的三项，成本不会更低。

---

## 7. 明确不做 / 已知取舍

| 项 | 决定 | 理由 |
|---|---|---|
| CSS/HTML 排版 | **不做** | §4.1（会与引擎的断行/行号分叉，污染脚本可观测面） |
| 逐字**旋转/缩放** | 不做 | 引擎没有（`docs-new/03-engine/adv-text-rendering.md` §4） |
| 断行禁则（行首/行尾） | 不做 | 引擎没有；做了反而与引擎不一致 |
| `\n` 显式换行 | 不做 | 引擎只认 `end-text-line`(0x6F) |
| **描边机制**（GDI 四次偏移重画 / D3DX 圆环扫描） | **不复刻机制，只复刻观感** | 四档行为逐档等价实现（见 §5.3 表）；这是**阅读体验**需求，属 P0 |
| **字体内部配置**（抗锯齿开关 `+1352`、AA 灰度级 `+218500`、字形度量探针 `+201704`、内存字形缓存 `+3444`/`+3524`、`lfWidth`/`lfHeight` 取值、hinting） | **只记录字段存在，不追效果** | 用户口径：这些不影响阅读。字段已在 `analysis/fields.json`（scope `Font`）中登记 |
| 抗锯齿 | **恒开** | 随包 `set:EnableAntiFont` 缺失 ⇒ 引擎实为关闭；浏览器无法关。属上一条的**低优先级有意偏差**，不写进台账当缺口 |
| `DrawMode` 双路径 | **只实现一条** | 随包 `set:DrawMode` 缺失 ⇒ 引擎实际走 GDI 路径；我们实现"等价观感"的单一路径，不模拟 GDI/D3DX 的实现差异 |
| 字形 atlas / SDF | 不做 | §4.4 |
| `pixi.HTMLText` | 不做 | §4.3（CJK 字体无法内嵌进 SVG） |

**保留的可能**：一次性直绘（`0x204/0x205/0x89/0x8A/0x221`）允许直接用 `pixi.Text`（仍在同一管线内）。

---

## 8. 验收（守卫）

- **E2（合成指令单测）**：`test/text-layout.test.ts` —— 等宽推进 / 半角 / 边界断行 / 注音居中 / 竖排换列 / 对齐 / 显现游标。
- **E3（真实脚本场景断言）**：扩展现有 `test/config1-chain.test.ts` —— CONFIG1 样例窗的**排版结果**
  （行数、每行字符数、注音位置、竖排）成为快照断言，而不只是"文本内容"。
- **`npm run report`**：`.tmp/<name>.txt` 快照里出现 `[win 9] 3 行 × 4 字（竖排）已显现 7/17` 这类行
  ⇒ 文本从"不可观测"变成"可 diff"。
- **台账**：`analysis/engine-capabilities.json` 的 `msgwin-*`/`text-*` 条目在 S2/S3/S4 完成后逐步升级
  `absent/partial → modeled-verified`，并给出真实存在的 `guard`。

---

## 9. 实施进度

| 阶段 | 状态 | 产物 / 守卫 |
|---|---|---|
| **S1 纯模型** | ✅ | `src/text/layout.ts`（等宽网格 / 边界硬断 / 注音配对 / 竖排换列 / 对齐 / 显现游标）、`src/text/fontSet.ts`（面名映射 + 剥 `@` 前缀）<br>`test/text-layout.test.ts`（13 例） |
| **S2 光栅化 + 上屏** | ✅ | `src/renderer/text/raster.ts`（描边四档）、`src/renderer/text/fontLoader.ts`（经 IPC 读 `res/fonts` → `FontFace`）、`src/renderer/pixi/textLayer.ts`（按内容版本号重建纹理、层序 `20+win`）<br>合成器 `present(scene, clock, waitFlags, textSprites)` 把文本与 draw-item **按同一 layer 归并**（"文本永远最上层"是错的） |
| **S3 参数面（P0）** | ✅ | `handlers/msgwin.ts` 新增 `0x70/0x75/0x79/0x80/0x197/0x198/0x1A5/0x1C1/0x260/0x2BD/0x2BE/0x2FE/0x303`；`0x76/0x77/0x78/0x8B/0x1A4/0x261` 由 `ENGINE_FIELD_STORE` 写字段后经 `after` 钩子发布样式 |
| **S4 逐字显现** | ✅ | `MsgWindow.beginReveal/finishReveal/tickReveal/revealedOf`（节拍 = `max(message:MessageSpeed, 一帧)`，**一次调用只推一个字、不跨节拍补齐**）+ `Engine.serviceTextReveal` + `MsgWinInput.revealed` → `TextFrame.revealed` → `TextLayer` 只画前 N 个字形。<br>启动点与引擎一致：`0x71`（呈现）与 `0x72`（LABEL_17：置等待门**同时**启动节拍）。跳读/自动模式与 `MessageSpeed=0` ⇒ 一次显示完。<br>`test/adv-msgwin.test.ts` 锁节拍/门/跳读三种情形（见事故复盘 5） |
| **S4b 行淡入色窗** | ⏳ 待做 | DrawItem 颜色动画窗已建模，但未按 `MessageSpeed×MessageFade/100` 接到文本行上 |
| **S5 回写与布局参数** | ⏳ 待做 | `0x7F`/`0x2DE`/`0x74`/`0x1B5`/`0x1B9`/`0x2E7`/`0x2E8`/`0x2CD` 已实现；`0x83/0x1C5/0x2C2/0x2F3` 仍为 no-op（**不得当 no-op**，属静默错误） |
| **S6 低优先级** | ⏳ 待做 | 回看页表（`0x84`/滚轮）与 **`Font+3364` 记录表读取端**（`0x1D0/0x1D3/0x1D4/0x2F3`，会回写操作数 ⇒ 必须真实现）；字体内部配置（R7b，仅登记字段） |

### 已验证（E3）

`test/config1-chain.test.ts` 在真实脚本 + 模拟点击链路上断言 CONFIG1 样例窗的**排版结果**：

```
text win=9 rect=(324,570,824,120) 竖排 align=0 main=30px ruby=10px outline=3
  [0] w=60 字=2 注音=0 | いキ
  [1] w=60 字=2 注音=0 | ャッ
  …                                     ← 共 9 列（竖排换列）
```

并把同一段文本写进 `npm run report` 的快照 —— **文字从"不可观测"变成"可 diff"**。

### 实施中发现并修掉的新问题

1. **`0x08B`/`0x1A4` 的字段口径**：`0x1A4` 是 `_this[21670]=op1(dx)`、`[21671]=op2(dy)`（raw 29149-29150），
   报告 C 里写的 `+1384=op2` 是笔误；emulator 的 `ENGINE_FIELD_STORE` 与 raw 一致。
2. **`emitAllWins` 只发有文本的窗**：否则只为设了几何的窗（`i070 1..8`）各建一张 800×720 画布。
3. **竖排换列方向** → ★**已推翻**：以为是"竖排换列方向"本身是误判（见 §9 事故复盘 2）。排版恒为横向。
4. **`0x1D2`（全库 42760 处，最常用的未实现 opcode）**：实测用户在 `CONFIG.BIN@0x1a48`
   命中它被**暂停**（`.tmp/amayui-emulator.log:2215`），只能手工"作为桩函数跳过"。
   引擎体（`sub_420380` raw 29373-29385）只往 `Font+3364` 的 72B/条记录向量 push 一条
   `{键=op1(+24), 值=op2(+20)}`，**不回写操作数** ⇒ 已登记进 `ENGINE_INTERNAL_OPS`（宿主无该表消费者）。
   ⚠️ 同族**读取端** `0x1D0/0x1D3/0x1D4/0x2F3`（`sub_459860`/`sub_457960`/`sub_457A20`）**会回写操作数**，
   故意保持"命中即硬报错"；实现这张表时写入端与读取端必须一起搬进 `OPS`（见 S6）。
   证据与字段布局已落进数据层（`analysis/functions.json` 的 `0x420380/0x457960/0x457A20/0x45E7E0` 等，
   `analysis/fields.json` 的 `Font/0x15A54/0x15A58/0x15A5C/0x15A74`）。

### 事故复盘：「跑起来完全没有文字」（S2/S3 首轮）

**症状**：模拟器进 CONFIG 页正常，**文字一个都看不见**；无异常、无控制台错误。

**排查顺序（先量化、再猜）** —— 四个层次，每层都有可观测证据：

| 层 | 证据来源 | 本次观测结果 |
|---|---|---|
| ① VM 是否发布 | `.tmp/amayui-emulator.log` 的 `[msgwin] …` | ✅ `[msgwin] win=9 9 行 17 字 竖排 30px` |
| ② 字体是否注册 | 同日志的 `[font] …` | ✅ `[font] 内置字族就绪 4/4` |
| ③ 是否光栅化成纹理 | 同日志的 `[text] …` | ✅ `[text] win=9 9 行 17 字 → 纹理 824×120` |
| ④ **层序是否被盖住** | 快照里各图元的 `layer` + 文本框相交判断 | ❌ `[present] … layer=121600..121608`（CONFIG UI）**全都画在文本之上** |

**根因**：`TextLayer` 用固定层序 **`20 + win` = 29**，而普通 2D 图元的 key 是
**100 / 120000 量级**（CONFIG UI 实测 121600-123000，`detachTexture … [0x1d4c0, 0x1e078)` 是同一个区间）
⇒ 文字被**整屏 UI 完全盖住**。引擎的做法是：正文行的 DrawItem id 起点取 **`win+104`**
（opcode `0x213` 写，`id = 行号 + 该值`；CONFIG.txt:39 `i213 9 2c114 1f4` ⇒ **180500**），
而 `win+20` 只是**平面号**（精灵/纹理），不是层序 —— 我把两者当成了同一个东西。

**修复**：`MsgWinStyle.itemId` = `win+104`（`0x213`），`TextLayer` 用它作层序；
未设过时才回退到平面号 `20+win`（并在 ADR §5.2 注明这是"会被盖住"的回退值）。

**回归闸**（`test/config1-chain.test.ts`）：断言 `itemId === 0x2c114`，且
**"层序更高且与文本框相交的可绘制项必须为空"**（`coveredBy`）。这条不变量直接锁住
"文字被盖住"这一类静默缺陷。

### 事故复盘 5：「文字出得太快」（把引擎的"帧节拍"当成了"跨帧补齐"）

**症状**：消息文本几乎"闪"出来 —— 一页 19 字在 ~95ms 内显示完，逐字过程看不清。

**根因**：`tickReveal` 写成了"**按跨过的 tick 数一次补齐**"
（`ticks = floor((now - nextAt) / speed) + 1`，`nextAt += ticks * speed`）。
这个写法假设引擎是"阻塞式节拍、时间到了就该补上落下的步数"，但引擎不是：

| 事实（raw） | 结论 |
|---|---|
| `sub_45BE20` 每次调用把显现游标 `+1`（raw 72366-72368） | 一次只走**一步** |
| `sub_409400` 的窗口循环**每帧每窗只调一次** `sub_45BE20`（raw 13860）；尾部路径 `Sleep(MessageSpeed)` 之后同样只调一次（13956-13962） | 一步 / 帧 |
| 定时器 `sub_453B60`（raw 66188）只回答"这一帧该不该走"（`period*steps - elapsed >= 0` ⇒ `-1` ⇒ 调用方**整帧提前返回**） | **不返回"该补几步"、也不补偿** |

⇒ 有效节拍 = `max(MessageSpeed, 一帧)`；`MessageSpeed=5` 时上限就是帧率。
补齐写法把它变成 `MessageSpeed` ms/字（5ms ⇒ 200 字/秒），是它的 **约 3.3 倍**。

**修法**（`src/vm/msgwin.ts`）：
- 一次调用**最多推一个字**，`nextAt = now + max(speed, REVEAL_FRAME_MS)`；
- `REVEAL_FRAME_MS = 1000/60` 必须显式写出来 —— 会话循环里的 `present()` 是同步调用
  （不等 vsync），一帧之内会空转很多轮 `serviceTextReveal`，没有这个下限就等于无限速；
- 守卫：`test/adv-msgwin.test.ts` 断言"跨 10 帧也只推 1 个字"与"`MessageSpeed=100` 时 100ms 才是节拍"。

**★与引擎的有意偏离（必须写明）**：引擎的 `sub_45BE20` 推的是**一行**（24B 行矩形 ⇒ 一次贴一行，
3 行的一页 ≈ 3 帧 ≈ 50ms，视觉上是"整页瞬间出现"）；真正的逐字只有网格模式那条路
（`effect_flags & 0x40000000` + `sub_453AF0(Engine+430600)` + `sub_45A940`，节拍来自 `0x73` op10，
且脚本侧仅 `i073` 27 处会开）。宿主把整窗光栅化、按"前 N 个字形"渲染，所以这里刻意把
"一帧一步"映射成"一帧一个字"，以便逐字可见（见 `src/vm/msgwin.ts` 的 `REVEAL_FRAME_MS` 注释）。

### 事故复盘 6：「回到主界面后文字又画在主界面之上」

**症状**：从 CONFIG 返回主界面/TITLE 后，上一页的消息文字**叠在新画面之上**（层序 180500 高于菜单的 10~400）。

**根因**：`0x1F6`（`sub_41A130` → `sub_4AB7A0`，清整张绘制容器）在 emulator 里只清了
`drawItems` + `meshes`，**没清文本窗**。而引擎 D3D 路径下正文行**就是** DrawItem
（id = `行号 + win+104`）⇒ `sub_4AB7A0` 清表时它们一起消失。
用户日志里正是这样一幕：`clearDrawContainer: 释放 drawItems=51 meshes=1` 之后
**再没有** `[msgwin]` 发布（`.tmp/amayui-emulator.log:2262`），但旧精灵仍留在 `TextLayer` 里。

**修法**：`scClearDrawContainer` 末尾调 `scMsgWinClearAll(s)`（清 `msgWins` ⇒ `TextLayer.sync`
下一帧 `#dispose` 掉旧精灵）；`pixiBackend` 的日志改成 `文本窗=N→0`（此前打印的是清完之后的 0）。
守卫：`test/adv-msgwin.test.ts`「0x1F6 清绘制容器：文本窗必须一起清」。

### 事故复盘 4：「接完逐字显现后文字直接不显示」（约定不一致）

`MsgWindow.revealedOf(win)` 对"没有显现状态"的窗返回 **-1**（= 全部显示），
而 `layoutWindow` 当时写的是 `rev <= 0 ? 0 : ...` —— 把 **-1 当成了"一个字都不画"**
⇒ 所有普通窗口光栅化出**空纹理**：模型完全正确、快照里文本齐全、只是画面空白。
最典型的**静默缺陷**（没有任何异常，只有"没字"）。

修法：`rev < 0 ? glyphCount : ...`，并把约定写进注释。
**守卫（这次补上，正是之前缺的）**：
- `test/text-layout.test.ts`：`-1 ⇒ 全部`、`0 ⇒ 不画`、越界截断；
- `test/config1-chain.test.ts`：样例窗 `revealed === glyphCount`（"无显现状态必须全显示"）；
- `SnapshotMsgWin.revealed` 写进报告/快照 ⇒ **"该画几个字"也变成可 diff 的量**。

### 事故复盘 3：「首帧渲染很大且偏移」与「字重过重/纯白」

**① 首帧很大 + 偏移（DPR 分辨率陷阱）**：`rasterFrame` 把 canvas 建成**物理像素**（`w×res`，
`res = devicePixelRatio`），但建 `CanvasSource` 时**没告诉 Pixi 这个分辨率**
⇒ Pixi 按 1 逻辑像素 = 1 texture 像素显示 ⇒ 在 DPR=2 的屏上文字**放大一倍**，
视觉上同时表现为"位置偏移"（内容从窗口左上角向外长出去）。
启动首帧 DPR 未稳定时更明显，之后重画才"看起来正常"；控制面板重启（reload）后 DPR 已稳定 ⇒ 直接正常。

修法：`new CanvasSource({ resource: canvas, resolution: res })`，并把 `res` 记进每个窗的缓存项
—— **DPR 变化即自动重画**（不再依赖"碰巧重画一次"）。

**② 字重过重 / 纯白**：三项实测值（`npm run diag:text` 现在会打印）：

```
字号/字重     : main=30px weight=700 ruby=10px
字族          : main="Sarasa Gothic SC" ruby="Sarasa Gothic SC"
颜色          : 填充 #ffffff / 描边 #000000
描边档位/偏移 : mode=3 dx=1 dy=1
```

- `weight=700` 来自脚本 `i2bd 1`（`Font+218516 = lfWeight = 700`，raw 33393）；
- `mode=3 dx=dy=1` 来自 `f8079=3 / f807a=1`（CONFIG1.txt:3218-3219 的 `a9de` 分支）；
- `fill=#ffffff / outline=#000000` 来自 `f807b=0xffffff / f807c=0`（CONFIG1.txt:3197-3198）。

⇒ **数值都是脚本给的**，不是实现拍的。观感偏重主要来自**字族映射**：
引擎侧主字体是 `set-font bbb` = `"メイリオ"`（`$1$INITCONFIG0.txt:18`），我们把它映射到
**Sarasa Gothic SC**，其 Bold 明显比 メイリオ 粗。

同时把描边**改成引擎的机制**（原来是 canvas `strokeText`）：
`strokeText` 的描边沿轮廓**居中**（内外各半）⇒ 视觉更粗、还把字面吃掉一半；
引擎是"用描边色把同一串再画若干遍"（档 1 偏移一遍、档 3 四次对角偏移）。
改后逐档与 `sub_455ED0` 一致（见 `raster.ts` 顶部对照表）。

### 事故复盘 2：「方向不对 + 汉字丢失」（同一次排查的后续）

用户观察到画面上是两行错位的片假名（`ＥＰＡースマスゃい` / `ＬＭＳタイルッキ`），
**恰好是我那份排版输出的逐字符转写** ⇒ 问题不在光栅化，而在**排版模型的两次误判**：

| # | 误判 | 反证（raw） | 修法 |
|---|---|---|---|
| 1 | 以为 `0x261`（`Font+235108`）是"竖排开关"，据此**交换了排版轴**（列自右向左） | `grep 235108` 的 **16 个读点全在绘制函数里**；排版例程 `sub_46BE30`（raw 83363-83997）**一次都没读它**。换行判据恒为 `penX > win+36`（`sub_475CF0` raw 90427） | 排版**恒为横向**；`vertical` 只记录、不消费（它只改绘制期的**源矩形**，配 `'@'` 面 + escapement 2700，重写侧没有源矩形这一步） |
| 2 | `display-furigana` 只记注音、**不把 op2 的本文词当文本** | 引擎 `sub_46BE30(obj, part, **op2**, **op3**, flag)`：op2 是**要铺排的串**、op3 是它的注音。真实剧本 6341 处都是"用它把一个词从句子中间切开"：<br>`show-text "…はぐれちゃったら"` / `display-furigana 0 "寂" "さび"` / `show-text "しいよねー…"`（SC0330.txt:2501-2503） | `addRuby()` 同时 `text += base` |

修正后 CONFIG1 样例窗的正确结果是**一行 19 字**：

```
text win=9 rect=(324,570,824,120) 横排(vFlag=1) layer=180500 main=30px ruby=10px outline=3
  [0] w=570 字=19 注音=3 | 天結いキャッスルマイスターＳＡＭＰＬＥ
```

（`天結` 来自 `display-furigana` 的本文词，`あまゆ` 在它上方 10px 处；19×30 = 570px 收在 824 宽的窗里。）

**回归闸**：`test/text-layout.test.ts` 增加"`vertical` 标志不改变排版流向与字形坐标"的断言
（同样的文本在 `vertical=0/1` 下必须排出**逐字形相同**的结果）。

**顺带修掉的两个**：
1. 字体字节原本用 `Array.from(buf)` 经 IPC 传输 ⇒ 24 MB 变成数千万个 JS number（structured clone 极慢、吃内存）。
   改为直接传 `Uint8Array`，并把"启动全量预载 4 个字族（≈48 MB）"改成**按需加载 + 加载完成 bump 版本号触发重画**。
2. `TextLayer` 用 `Texture.from(canvas)` 会走全局缓存（按 canvas 缓存），与"每次新建 canvas + 销毁旧纹理"
   的生命周期冲突 ⇒ 改为显式 `new Texture({ source: new CanvasSource({ resource: canvas }) })`。

**排查工具**：`npm run diag:text` —— 在 Node 里跑同一份真实链路（与 E3 回归共用
`src/tools/config1Chain.ts`），一次打出上面 ①–④ 层的证据，并明确指出"问题在 VM 层还是渲染层"。
