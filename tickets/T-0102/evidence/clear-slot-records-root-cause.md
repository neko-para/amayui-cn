# T-0102 · 根因定位：`0x259`（`i259`）清掉 `槽→imgid` 后，ADV 窗口落到 1×1 白占位块

> 2026-09-22。**用户提供的现场日志**：`.tmp/amayui-emulator.log`（08:36，3973 行，场景已构造）。
> 这是本票第一次拿到"白底那一刻"的产品日志，根因因此**从推断变成日志直证**。
> 前一份取证 `evidence/texture-slot-identity.md` 证明"槽 17 是绑好的" ⇒ 本文件回答"那为什么还会掉占位块"。

---

## 0. 一句话结论

**`0x259`（`i259`）被 emulator 实现成"清 `#slotImgid`"，而 `#slotImgid` 正是 0x1F9/读档用来把
`draw-texture` 的槽号解析成图像的**唯一**依据 ⇒ 槽 17 的绑定被抹掉，`resolve()` 返回空，
`presenter.#placeholder`（1×1 `Texture.WHITE` 拉伸到源矩形）接管 ⇒ 用户看到的白色窗口。**

引擎里 `0x259` **不碰** `slot → imgid` 的那张表（下面 §2 有逐位落点）⇒ 这是 emulator 的口径错误。

---

## 1. 现场日志的证据链（时间顺序，行号即 `.tmp/amayui-emulator.log` 行号）

| # | 行 | 日志 | 含义 |
|---|---|---|---|
| 1 | 58 | `bindTexture imgid=0x5260 slot=17` | SYSTEM4 开机绑定窗口图 |
| 2 | 1501 | `bindTexture imgid=0xb37 slot=4` | 读档前的背景绑定 |
| 3 | 1611-1612 | `bindTexture imgid=0x5260 slot=17` / `  bind slot 17 <- imgid 0x5260` | 读档装载点把槽 17 装回（图已在缓存 ⇒ **同步**命中） |
| 4 | ★**1862** | `clearSlotRecords：…`（旧版口径；新版改为「保留 N 条 …（只复位标志位）」） | **绑定被抹掉**（本条的关键；该次运行逐行事实见 §5.5） |
| 5 | 1863 | `0xAE: 续跑收尾 —— cur=2 落点=794（SN0000.BIN），读档门已清` | 续跑落进 SN0000 |
| 6 | 1867-1870 | `detachTexture h=0x19640 …` / `createMesh h=0x19640 …` | ①`global 0 != 6` ⇒ 走 **mesh 支**（黑幕） |
| 7 | 1940+ | `[present …] meshes={… 0x19640:13/#000000 …}` | 屏幕上是黑幕（不是白） |
| 8 | 2904 / 2991 | `clearSlotRecords：丢掉 1 条 …` | 又被清两次 |
| 9 | 3967 | `[present …] items={101020:a255 104200:a160 104203:a255 104000:a160 104001:a255 104501:a255 …}` | ②**窗口项回来了**（104000/104200/104501… 全在画） |

- ★**1862 之后整个日志里再没有任何 `bindTexture … slot=17`**（我用 `awk NR>1862` 逐行确认过：
  只剩 `slot=43` 一次）。⇒ 窗口项在 ② 处画的时候，槽 17 已经是"没有绑定"的状态。
- ★**全日志 `slotTex 自愈` 0 条**。`#healSlot`（`textureCache.ts:477`）的第三道门正是
  `if (imgid === undefined) return undefined;` —— `#slotImgid` 被清空后，**自愈路径也一并失效**
  （它本来就是为了修"开合侧边栏才对"而加的）。

### 1.1 为什么"白"而不"透明"
`presenter.itemSprite`：`tex ? cropSprite(tex, rect) : this.#placeholder(it)`
⇒ 没有纹理时**不是不画，而是画占位块**；`#placeholder` 用 `Texture.WHITE`（`appSetup.ts:47`，**1×1**）
按源矩形（1086×149）拉伸，随后 `spr.tint = color & 0xffffff; spr.alpha = alpha/255;`（`presenter.ts:469`）
—— **只吃 tint，不吃"有没有纹理"**。`i203` 给 `0x19640` 的 alpha（≈0xa0）照用
⇒ 白占位块 ×0.63 ≈ **`#E3E3E3`**，与归档帧逐点采样吻合。

---

## 1.5 ★二次复核（应要求）：`0x259` 清的**不是** imgid，而是**标志位**；emulator 恰好**清反了**

第一版结论（"槽表不被碰"）成立，但**理由写错了**，而且复核中挖出一个**第二处副作用**。逐位重算如下。

### (a) 记录表的真实布局（字段表已登记，`analysis/fields.json`）

| 字段 | Scene 偏移 | Engine 偏移 | 含义 |
|---|---|---|---|
| `tex_slot_imgid` | `+0x748` | `+324696` | 每槽记录 `[0]` = 绑定的统一文件 id |
| `tex_slot_flag_a` | `+0x750` | `+324704` | 记录 `[+8]`：`0x258` 按 op2 的 **bit0** 置 0/1 |
| `tex_slot_flag_b` | `+0x754` | `+324708` | 记录 `[+12]`：`0x258` 按 op2 的 **bit1** 置 0/1 |
| （未命名） | `+0x758` | `+324712` | 记录第 5 个 dword（`sub_4A2C10` 置 1） |

**上表是 `stride = 0x14`（5 dword/槽）的槽 0 视图**（fields.json 自注：数组首元素 0x748、步长 0x14）。

### (b) `0x258`（`sub_425D20` raw 33156-33185）写的正是这两格

```c
result = &_this[5 * sub_41BF50(_this, 1) + 80708];   // = Scene + 20*slot
if (v2 & 1) { result[468] = 1; result[5468] = 1; } else { result[468] = 0; result[5468] = 0; }
if (v2 & 2) { result[469] = 1; result[5469] = 1; } else { result[469] = 0; result[5469] = 0; }
```

`Scene+20*slot` 的 index 468（dword）→ Scene 字节 `+1872 = 0x750` ⇒ **就是 flag_a**；
`Scene[80976]`（= `+21872`）是**第二张镜像表**的同一格。

### (c) `0x259` 清的正是那两格（所以它是 `0x258` 的复位器）

`Scene+468` = `Engine+(80708+468)` = **`Engine+324704`** —— **精确等于** `0x259` 循环里的 `*(result-5000)`；
`Scene+469` = **`Engine+324708`** = `result[1]`（`result = _this+86176`，两者都有）。

而 **`*(result - 4999)` = `Engine+324708`**、`result` 指向 `Engine+344704`（表 2 的同格）。

⇒ **imgid 那一格（`Engine+324696` 附近）从头到尾没被 `0x259` 写过。**

★独立佐证：`0x1F9` 的 `sub_4A3800`（raw 123375-123381）写的是 `v7[466]/[467]/[470]`
= `Scene+466/467/470` —— 与 `0x258`/`0x259` 用的 `468/469` **不重合**（槽 0 的 `466` = imgid、
`468` = flag_a）。三条指令各写各的格，互相印证 5-dword 记录的分工。

### (d) ★第二处副作用：emulator **漏清**了标志位

`0x258` 在 emulator 里被建模成 `Engine.texSlotFlags`（`gfx-state.ts:104-111`），
但 `0x259` 的 `clearSlotRecords()` **完全没有清它** ⇒ 引擎复位过的标志位在 emulator 里**残留**。
（影响面有限：`texSlotFlags` 目前**只写不读**，唯一读者是 `test/op-a4-a6.test.ts`；
所以这条是"口径不对"，暂时没有可见症状，但属于同一个 `0x259` 的两面，修的时候要一起对。）

### (e) 结论修正

| | 引擎 `0x259` 做什么 | emulator `clearSlotRecords` 现在做什么 | 判定 |
|---|---|---|---|
| 每槽记录 `[0]`（imgid） | **不动** | **清空 `#slotImgid`** | ✘ **清多了**（= 白底根因） |
| 每槽记录 `[+8]`/`[+12]`（flag） | **清 0** | **不动** | ✘ **清少了** |

⇒ 两处都要改：**保留 imgid、改清标志位**。只改前一半能修掉白底；两处一起改才是引擎口径。

---

## 2. 引擎口径：`0x259` **不碰** `slot → CTexture*`

`engine/天结_unpacked.exe_utf8.c:25357-25374`（`sub_41A3A0` = opcode `0x259`）逐行：

```c
_this[30 * _this[95776] + 95805] = 1;      // 指令长度槽 = 1
result = _this + 86176;                     // 字节 344704 = 第 2 张记录表
v2 = 1000;
do {
  *(result - 5000) = 0;   // _this + 81176（字节 324704）= 第 1 张记录表
  *result = 0;            // _this + 86176
  *(result - 4999) = 0;   // _this + 81177
  result[1] = 0;          // _this + 86177
  result += 5;            // 步长 5 dword
  --v2;
} while ( v2 );
```

⇒ 它只清 **`Engine+324704`（= `_this+81176`）起** 与 **`Engine+344704`（= `_this+86176`）起**
两张 1000×5-dword 的记录表（每项清 **+0/+1** 两个 dword）。

而 `slot → CTexture*` 的那张表**不在**这两段里：

| 表 | 字节偏移 | 谁写 | 依据 |
|---|---|---|---|
| **槽表（真源）** | `Engine+378688` = `Scene+42456` | `0x1F9` `sub_422CB0` raw 31211-31221（先释放再置 0）/ `sub_4A3800` raw 123369 | 档案 `Scene+4*slot+42456` |
| 记录表（主）`[0]`=imgid / `[+8]`/`[+12]`=flag | 表基 = `Engine+324696`（`_this+81174`） | imgid 由 `0x1F9` 写；**flag 由 `0x258` 写、`0x259` 清** | `fields.json` 的 `Scene/0x748` 等四条 |
| 记录表（影，镜像） | 表基 = `Engine+344696`（`_this+86174`） | 同上 | `0x258` 的 `result[5468]/[5469]` |

★`0x259` 循环里的 `*(result-5000)` = `Engine+324704` = 记录表 `[+8]`（**flag，不是 imgid**）；
`*(result-4999)` = `Engine+324708` = 记录表 `[+12]`；`result` 指向 `Engine+344704` = 影表的同两格。
⇒ 它清的是**标志位**，`imgid` 一格都没碰（详见 §1.5 的逐位重算）。

★两条独立佐证：
1. `0x259` 是**无操作数**指令（argc 0，`opcode-table.md:443`）—— 它连"清哪个槽"都不知道，
   只能整表清（正是"按 slot 设置的标志位"需要整表复位的形状）；
2. `0x1F9` 写 `Scene+466/467/470`、`0x258` 写 `Scene+468/469` —— **不重合** ⇒ 5-dword 记录里
   imgid 与 flag 分工明确，`0x259` 只碰后者的两格。

---

## 3. emulator 的错误口径（一句话）

| 层 | 名字 | 0x259 之后 | 与引擎 |
|---|---|---|---|
| VM | `Engine.texSlots`（`engine.ts:385`） | **不动**（`gfx-misc.ts:69` 只调 `native.clearSlotRecords`） | ✔ 对（≈ 槽表） |
| 宿主 | `TextureCache.#slotImgid`（`textureCache.ts:86`） | **被清空**（`clearSlotRecords` :701-705） | ✘ **错**（它承载的是"槽表"语义） |
| 宿主 | `TextureCache.slotTex` | 保留 | ✔ 对（≈ `CTexture*`） |

问题在于 **`resolve()` 的实现把 `#slotImgid` 当成了 `slot → 图像` 的唯一索引**：

```ts
resolve(it) {
  const imgid = this.#slotImgid.get(slot);   // ← 0x259 后 undefined
  const tex = this.#healSlot(slot);          // ← #healSlot 也要 #slotImgid，第三道门直接返回 undefined
  return { tex, imgid };
}
```

⇒ `#slotImgid` 一清，**两条取纹理的路同时断**。这就是白占位块的直接来源。

> 附带说明为什么"开合侧边栏就正常"：侧边栏会把 `label_0000b884` 重跑一遍 ⇒ 重新
> `draw-texture`（但**不重发 `set-texture`**）... 如果只是重画，槽还是空的；
> 真正让它恢复的是"那一刻恰好还有一次 `set-texture` 命中已缓存图像"⇒ 同步重建 `slotTex`+`#slotImgid`。
> ⇒ 与 `evidence/texture-slot-identity.md` 的"第二次 `set-texture` 同步命中"是同一件事。

---

## 4. 修法（待用户确认后动手）

★复核后**修法也修正了**（原版只写"不清 `#slotImgid`"，漏了"要清标志位"）：

| # | 改什么 | 落点 |
|---|---|---|
| 1 | **保留 `#slotImgid`**（引擎不清 imgid） | `renderer/pixi/textureCache.ts:701` 的 `clearSlotRecords()` |
| 2 | **改清 `Engine.texSlotFlags`**（引擎清的就是这两格标志位） | 同上；`texSlotFlags` 由 `0x258` 写（`gfx-state.ts:110`） |
| 3 | 同步订正两处**注释口径**（现在写着"清前两个 dword / 丢掉 imgid 记录"，与引擎相反） | `textureCache.ts:689-700`、`headlessScene.ts:418-427` |
| 4 | 更新既有守卫 | `test/texture-bind-race.test.ts`（若它断言了 0x259 清 imgid） |

- **不改** `resolve`/`#healSlot` 的取值链（它们本身是对的：引擎也要求槽表/记录表有项）。
- `HeadlessScene.clearSlotRecords`（`headlessScene.ts:421`）同样**只清 `slotImgid`** ⇒ 一并按 1/2 改。

**验收判据（可自动化）**：
1. 「`bind(imgid, s)` ⇒ `clearSlotRecords()` ⇒ `resolve({tex:s})` **仍须给出纹理**」（引擎口径；突变：改回清 `#slotImgid` ⇒ 必红）；
2. 「`0x258(5, 3)` ⇒ `clearSlotRecords()` ⇒ `texSlotFlags` 不再残留 3」（第 2 处副作用；突变：不清 ⇒ 必红）；
3. 钉住**不清** `#slotImgid`：`clearSlotRecords()` 后 `imgidOf(s)` 仍等于原 imgid。

**E4 判据**：同一份现场日志重跑后，`clearSlotRecords` 那几行仍在，但窗口项不再出现
`未绑定纹理槽 → 占位块`；屏幕上窗口内部应是窗口图（白色羊皮纸）而**不是**被占位块顶掉花纹的帧。

★**诚实边界**：本次是**日志直证**（第 4 行、`#healSlot` 的门、`resolve` 的取值链三者闭合），
但"白底那一刻"的 `present` 帧日志仍被 `#missingTexLogged` 的**去重**挡住（上限 64、满则 `clear()`）
⇒ 若要 E4 级像素对照，需临时把该支改成不去重（跑完即撤）。

---

## 5. 修复实施（2026-09-22，按 §1.5 的两条口径）

### 5.1 改了什么

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/renderer/pixi/textureCache.ts` `clearSlotRecords()` | **不再清 `#slotImgid`**（引擎不清 imgid）；日志改为「保留 N 条 …（只复位标志位）」 |
| 2 | `src/renderer/headlessScene.ts` `clearSlotRecords()` | 同上（headless 侧 `slotImgid` 同样保留） |
| 3 | `src/vm/handlers/gfx-misc.ts` `op_clear_slot_records` | **新增 `c.e.texSlotFlags.clear()`** —— 引擎 `0x259` 清的正是 `0x258` 写的那两位（§1.5 的第二处副作用） |
| 4 | 上述三处 + `textureCache.ts` 的注释 | 口径全部改写为引擎实际语义（旧注释写着"清前两个 dword / 丢掉 imgid 记录"，**与引擎相反**） |

### 5.2 守卫

新增 `test/clear-slot-records-keeps-bindings.test.ts`（4 例）+ 改写 `test/slot-save-resume.test.ts` 的既有 0x259 用例：

| 用例 | 断言 |
|---|---|
| ① `0x259` 之后槽 17 仍解析出纹理 | `resolve({tex:17}).tex` 必须存在 |
| ② **具判别力**：槽→imgid 索引仍是原值 | `imgidOf(17) === 0x5260`（突变下**唯一**会红的用例） |
| ③ `0x208` 尺寸 getter 仍给真尺寸 | `size(17) === {1280,1792}` |
| ④ 一致性：`slotTex` 落盘后清记录仍可查 | 该槽不会再被绑第二次 ⇒ 索引必须够用 |
| ⑤ `slot-save-resume`：`0x258(5,3)` ⇒ `0x259` ⇒ `texSlotFlags` 归零 | 第二处副作用的守卫 |

### 5.3 突变证明（两条，均已实跑）

| 突变 | 结果 |
|---|---|
| `clearSlotRecords()` 改回 `this.#slotImgid.clear()` | ★用例② **红**（`actual 0x5260 / expected undefined`）⇒ 判别力成立；其余用例绿（已披露原因：`resolve`/`size` 的自愈会把 `slotTex` 顺手落盘，所以"清完再读一次"读不出差别） |
| 摘掉 `c.e.texSlotFlags.clear()` | ★用例⑤ **红** ⇒ 第二处副作用的守卫成立 |

### 5.4 实测

`npm run verify` 全绿：**1037 测试（1025 pass / 12 skipped / 0 fail）** + typecheck ×3 + `check:dead-writes` 0。
★**诚实边界**：以上都是 E2（合成单测）。**E4 复验未做** —— 需要用户跑一次真界面（载入 78 → 点一下 → 等过场），
看 `clearSlotRecords` 之后窗口项是否还会出现占位块。修复的**引擎侧依据**是 §1.5 的逐位复核（与用户日志一致），
不是"我复现了那一帧"。

### 5.5 与用户日志的关系（口径校正）

本票前述引用的行号（`.tmp/amayui-emulator.log` 第 **1862** 行等）来自**较早一次运行**（12:16 那份日志）；
用户在本轮给的现场日志（12:36）里，`clearSlotRecords` 出现在第 **845 / 847 / 914 / 2062 / 2149** 行，
而 `bindTexture imgid=0x5260 slot=17` 只在开机第 **60** 行出现一次 —— **两次运行都指向同一条结论**：
槽 17 开机绑定后**再没有任何** `slot=17` 的绑定，而 `clearSlotRecords` 反复发生。

---

## 7. ★★真正的根因（2026-09-22，13:11 日志 + 诊断打点）：**读档续跑重跑了场景初始化，把 `global 0` 从 6 改成了 1**

### 7.1 诊断给出的硬数据

`0x1FB` 的 handler 上加了临时打点（ADV 窗口那两笔），日志逐笔：

```
[T-0102 诊断] draw-texture h=0x19640 槽=0x11 global0(原始)=0x4000 texSlots[0x11]=0x5260
[T-0102 诊断] draw-texture h=0x19708 槽=0x11 global0(原始)=0x4000 texSlots[0x11]=0x5260
…（共 6 笔，全部 0x4000）
```

- `Engine.key = 0`（`engine.ts:157`）⇒ `DEC(0x4000) = 1`（`enc(0,1)=0x4000`、`enc(0,6)=0x18000`，已实测）
- ⇒ **窗口绘制时 `global 0 == 1`，不是 6**，而 `texSlots[0x11]=0x5260`（槽没问题，与第 6 节一致）

### 7.2 于是"白纸窗"是**脚本在 `global 0 == 1` 下的忠实输出**

```
eq  local0, global0, 6      →  local0 = 0        （1 ≠ 6）
jcc local0, ffffffff, label_0006d348   （local0==0 ⇒ 跳 op3 = label_0006d348）
label_0006d348:
  draw-texture 19640 11 0 0 43e 95 5d 22c         ← 白纸窗（SO001 的窗户图）
```

`create-mesh + set-vertex-color … 0`（半透明**黑**支）在 `label_0006d19c` 的**落下句**上，被跳过了。
⇒ emulator 没画错；**变量错了**。

### 7.3 变量为什么错：存档里是 6，续跑把它改成了 1

| 事实 | 落点 |
|---|---|
| 存档的 int 池 **`int[0] = 6`**（明文） | `cache/SAVE78.DAT`，`decodeEngineSlot` 实解 |
| 载入侧会 `ENC` 后进 `globals.int` ⇒ 应为 `0x18000` | `save-slot.ts:208` `e.globals.int.set(i, enc(e.key, v))` |
| 但日志实测为 `0x4000`（= 1） | §7.1 |
| **场景初始化把 1 写进了 `global 0`** | `src/SC0000.txt:1023` 的 `mov (global-int 0) 1`（在 `label_000038f8` 下） |
| 该初始化**确实执行了**（独立铁证） | 日志 `2069/2084` 行有 `createTexture slot=64 / slot=65` —— 这两条正是 SC0000:1036-1040 那段初始化里的 `create-texture`（`708ada` 恒 0 ⇒ 走 `label_00003a88` 那支），普通对话帧不会碰 64/65 |
| 而"白纸窗"这个值只在**序章入口**那一支写 | `src/SC0000.txt:1292` `mov (global-int 0) 6`（在 `label_000049f4` 下，只有 `3f3c == 0` 才到） |

⇒ 时间线：**存档池先给出 `global 0 = 6`（正确）→ 续跑重跑了场景初始化 → `mov (global-int 0) 1` 把它改成 1 →
窗口例程读到 1 → 走白纸窗支**。

### 7.4 结论与修法方向

**根因 = 读档续跑不该重跑"场景初始化"这一段。**
引擎的 `0xAE` 在 `cur == savedCur` 时是"**收尾**"（写 `95777`），不重跑场景入口；
emulator 的续跑链让 `SC0000` 从入口跑了一段，于是把 `global 0` 这种"场景初始化写进去的全局"覆盖掉了。

- **修法方向（待你确认后再动）**：让续跑落在存档点、**不要**执行存档点之前的场景初始化；
  或在续跑窗口内把"池里带出来的那份全局"保住（不可让中途的初始化写覆盖）。
- **不要**去改窗口例程的渲染 —— 它按 `global 0` 分支是脚本自己的语义，忠实输出。
- ★**验收判据**：同一份存档续跑后，窗口绘制那一刻 `global 0 == 6`（诊断行应打 `global0(原始)=0x18000`），
  且窗口走 `create-mesh + set-vertex-color`（黑幕支）。
- ⚠️ 诊断打点是**临时件**，验证完即撤（`gfx-texture.ts` 里 `[T-0102 诊断]` 那一段）。

### 7.5 一处尚未证清（不许当结论）

你说"hover 侧边栏会恢复成黑" —— 但这份日志里 **hover 之后仍然画的是白纸窗**（`hover-enter 0x4b0` → 诊断行复现，
`global0` 始终 1），且 `2658` 之后**再也没有** `createMesh h=0x19640`。
所以我无法解释"hover 后变黑"；两种可能：① 你看到的是**侧边栏面板本身**（半透明黑）盖住了窗口；
② 恢复发生在**没有打到的另一条路径**上。这一条需要在修好 `global 0` 之后复看。

---

## 8. 2026-09-22 第二轮（用户澄清：**078/079 都加载在 SN0000**，白底出现在**继续推进到 SC0000 之后**）

### 8.1 用户口径（订正我先前的假设）
- `078` = 加载到 **SN0000 的最后一句话**；`079` = 加载到 **SN0000 的第一句话**；**两个都在 SN0000 场景**。
- 问题出在**继续推进、走到 SC0000 之后** ⇒ 与"载入哪个档"无关（两份日志表现一致，符合实测）。

### 8.2 13:17 那份 079 日志（6402 行）的事实
| 行 | 事件 |
|---|---|
| 4132-4138 | `[slot-load]` 真槽装载：帧链 0=SYSTEM4 / 1=TITLE / 2=SAVE / …；`savedCur=2`；重建槽 `槽4←0xb37` |
| 4495 | `0xAE: 续跑收尾 —— cur=2 落点=794（SN0000.BIN）` |
| 4502 / 4828 / 4958 / 5222 | **`createMesh h=0x19640`（黑幕支）** ← 载入后在 SN0000 里窗口是**对**的 |
| 5493-5494 | `clearSlotRecords：保留 9 条` + `[frame-hold] 满屏幕布 0x19640 被撤` |
| 5580+ | `clearDrawContainer` + 大批 `releaseTexture` ← **章节切换** |
| 5870+ | `[transition] id=0x18a9e …`（转场模糊），此时 `slotTex=17` |
| **6188** | **`[T-0102 诊断] draw-texture h=0x19640 槽=0x11 global0(原始)=0x4000`**（=1）⇒ 白纸窗 |

⇒ 与 13:11 那份一致：**切章之后 `global 0 == 1`**；而 `global 0` 是**全程恒为 1**（诊断 6 笔全 `0x4000`），
所以"SN0000 里对、SC0000 里错"**不能**用"某个时刻 6 被改成 1"解释 —— 更像是
**SC0000 里那条 `eq local0, global0, 6` 在 `global 0 == 1` 下本就会走白纸窗**，即：
**真机上那一刻 `global 0` 是 6，而 emulator 里是 1**。

### 8.3 已加的第二组诊断（等下一次日志即可结案）

| 打点 | 位置 | 会打出什么 |
|---|---|---|
| `[T-0102 诊断] 写 global0 ← V @脚本 ip=N` | `arith.ts` 的 `op_mov`（**每一次写 `global 0`**） | **到底哪一条指令把它写成 1**（脚本层不许再靠推断）；同时给出切章那一刻的写入序列 |
| `[T-0102 诊断] draw-texture h=0x19640/0x19708 槽=0x11 global0(原始/解码) texSlots[0x11]` | `gfx-texture.ts` 的 `op_draw_texture` | 窗口判决那一刻的 `global 0` 与槽 18 绑定 |

★两个打点都标了「临时（跑完即撤）」。

### 8.4 判据（下一份日志就能结案）
1. 若日志里**切章前后**没有任何 `写 global0` ⇒ `global 0` 自始至终是 1 ⇒ 问题在**它该被写成 6 而没人写**
   （即 SC0000 的场景初始化/或序章入口那一支没走到）⇒ 去查那一段的执行条件。
2. 若有 `写 global0 ← 1 @SC0000/…` 落在切章之后 ⇒ 就是那一条指令，按 `ip` 直接定位脚本行。
3. 无论哪种，**渲染侧与纹理侧都已排除**（槽 0x11 恒为 `0x5260`、无占位块、无未就位日志）。

### 8.5 待澄清（影响判据，不许当结论）
- 你在**真机**上那一刻看到的是"半透明黑"⇒ 真机 `global 0` 应为 **6**；
- 但 emulator 的 `global 0` 全程是 **1**（`0x4000`），而 SC0000 里把 6 写进去的只有序章入口那一支
  （`src/SC0000.txt:1292`，条件 `3f3c == 0`）。**该不该走到那一支、`3f3c` 在你这盘里是几**，需要日志确认。

---

## 9. ★★关键代数量（2026-09-22）：`0x4000` 只可能来自 `enc(0x0E000000, 6)`

### 9.1 两份真槽的池都写着 6

| 文件 | `int[0]` | `int[1]` | `int[2]` | 帧记录 |
|---|---|---|---|---|
| `cache/SAVE78.DAT` | **6** | 0 | 0 | 3 |
| `cache/SAVE79.DAT` | **6** | 0 | 0 | 3 |

⇒ **存档说窗口模式是 6**；而诊断实测窗口绘制时是 `0x4000`。

### 9.2 `0x4000` 到底对应哪个值：取决于 `Engine.key`

`enc(key, a) = ROL4(key ^ ROR4(a,7), 21)`（`bits.ts:19`）。实测：

| key | `enc(key, 6)` | 解码 `dec(key, 0x4000)` |
|---|---|---|
| `0` | `0x18000` | **1** |
| `0x0E000000` | **`0x4000`** | 6 |

反解：`key = ROR4(0x4000,21) ^ ROR4(6,7) = **0x0E000000**`（= 234881024，已用 `enc` 校验通过）。

⇒ **两种读法互斥，必须用日志判定**：
- **(a) 若日志里 `池还原 … raw=0x18000`** ⇒ 池把 6 装对了 ⇒ 之后**被脚本改写成 1**
  （`0x4000 = enc(0,1)`）⇒ 去查"写 1 的那条指令"（`SC0000.txt:1023` 是头号嫌疑）。
- **(b) 若日志里 `池还原 … raw=0x4000` 且 `key=0xE000000`** ⇒ 池按"存进去时的 key"回写了 6，
  但**宿主读侧用的是 `key=0`** ⇒ `DEC` 用错 key ⇒ 读成 1 ⇒ **key 生命周期 bug**
  （`Engine.key` 只在 `save-slot.ts:458` 的**本工程槽**分支被赋值；真槽（engine format）分支不赋）。
- **(c) 若日志里根本没有 `池还原` 那一行** ⇒ 真槽路径**没走池还原** ⇒ 池里那份 6 从未进 emulator。

### 9.3 已就位的三处诊断（下一次日志即可在 a/b/c 之间结案）

| 打点 | 会打出 |
|---|---|
| `[T-0102 诊断] 池还原：int[0] 文件值=… key=… ⇒ raw=…（期望 …）` | 池装进去的原始值与当时的 `key` ⇒ 直接分 (a)/(b)/(c) |
| `[T-0102 诊断] 写 global0 ← V @脚本 ip=N`（`op_mov` + 全部 `binOp`） | 谁把它改写成 1（若有） |
| `[T-0102 诊断] draw-texture … global0(原始/解码) …` | 窗口判决点的最终值 |

★全部标了「临时（跑完即撤）」。

### 9.4 已排除（本轮再次确认）
- **渲染侧**：`presenter` 忠实按 `global 0` 选支；无占位块、无未就位日志。
- **纹理侧**：槽 `0x11` 全程 `0x5260`（SO001.AGF 已解码、1280×1792）。
- **章节切换**：`SC0000.BIN` 在推进时**确实重新执行**（日志 5579 行 `[call-script] 0x73 -> SC0000.BIN`），
  并在 5592/5607 建了初始化段的 `createTexture slot=64/65`。

---

## 10. ★★2026-09-22 最终定位：`SCJUMP.BIN` 的门被 `f8080` 放行 ⇒ `global 0` 被写成 1

### 10.1 日志直证（13:28 那份，四类诊断齐全）

```
1420 池还原：int[0] 文件值=6 key=0 ⇒ raw=0x18000（期望 0x18000 对应 6）   ← 存档的 6 装对了
3341 写 global0 ← 2  @SN0000.BIN ip=2227                                   ← 序章末尾改成 2
3392 [call-script] 0x5265 -> ALLMAP.BIN        ← 章节点入口（3f3d=1 → SETADVFLAG → SCJUMP）
3399 [call-script] 0x512f -> SETADVFLAG.BIN
3406 [call-script] 0x5224 -> SCJUMP.BIN
3407 写 global0 ← 1  @SCJUMP.BIN ip=42
3408 SCJUMP 门：1dd7=未写 3318=未写 1521=未写 2f3c=未写 f8080=0xffffdfff→2147483647 3f3d=0x4000→1
4026 draw-texture h=0x19640 槽=0x11 global0(解码)=1 texSlots[0x11]=0x5260   ← 于是白纸窗
```

### 10.2 涉及的脚本（按"脚本可靠"前提，它们都没错）

`src/$1$SCJUMP.txt`，`global 3f3d == 1` 进入 `label_00000390`（BIN 索引实解）：

| 索引 | 指令 | 含义 |
|---|---|---|
| 39 | `gr local1, global f8080, 0xa` | 门：`f8080 > 10` |
| 40 | `jcc local1, -1, 0x12a` | 真 ⇒ **跳走**（跳过 41） |
| **41** | **`mov global 0, 1`** | **元凶写** |
| 42 | `mov global f8080, 0xa` | 收尾：把门降到 10（此后 `10 > 10` 为假 ⇒ 不再进） |

`src/SETADVFLAG.txt:24`：`mov (global-int f8080) 7fffffff`（INIT_MAX 哨兵，读档软复位链上紧随 `READY.BIN` 执行）。

### 10.3 已实测确认（合成单测，无推断）

- `enc(0, 0x7fffffff) = 0xffffdfff` ⇒ 日志里的 `f8080=0xffffdfff→2147483647` **确实是 INT_MAX**（SETADVFLAG 写的）；
- `gr(f8080=INT_MAX, 10) = 1`、`gr(0,10)=0`、`gr(10,10)=0` ⇒ **`gr` 本身没错**。

### 10.4 ★矛盾点（下一步只需一件事即可定死）

- 若索引 41 被执行，则门在索引 39/40 处必须**没跳** ⇒ 那一刻 `f8080 ≤ 10`；
- 而 `SETADVFLAG` 在 `SCJUMP` **之前**把它写成了 `INT_MAX` ⇒ 门应当**跳走**、索引 41 **不该执行**。

两者不能同时成立 ⇒ **emulator 在"`f8080` 的取值/时序"上有一处与脚本不符**。候选（按嫌疑排序）：

1. **`f8080` 在池外、无持久化**：真机它可能是**进程内、跨脚本连续**的量；emulator 里若在读档/装配点被清掉或从未由 `SETADVFLAG` 写入，索引 39 就会读到 0 ⇒ 门放行。（日志 3408 显示的是"写之后"的值，看不出"读之前"的值 —— 这正是缺的那一格。）
2. **`SETADVFLAG` 与 `SCJUMP` 的先后**在 emulator 里与真机不同（`call-script` 的完成/返回时机）。
3. 索引 39 那次读用了**不同的操作数**（例如把 `f8080` 当无符号 32 位，`0xffffdfff` 会被当成 4294959103 —— 也 `> 10`，仍该跳 ⇒ 不解释现象，暂列低）。

### 10.5 缺的那一格证据

需要**在门（索引 39）那个瞬间**打印 `f8080` 与 `local1`，而不是在写（索引 42）之后。已决定加这一条诊断。

---

## 11. ★★2026-09-22 结案：`3318` 是开关 —— "已开始过新游戏"标志在 emulator 里为 0

### 11.1 `jcc` 级诊断给出的两道门的真实结果（日志 6256-6262）

```
[call-script] 0x5224 -> SCJUMP.BIN (16059 instr)
jcc cond=local1=1 ⇒ 跳 op2=0xffffffff @SCJUMP.BIN ip=1     ← 3f3d==1 ⇒ 进 label_00000390
jcc cond=local1=0 ⇒ 跳 op3=0x0        @SCJUMP.BIN ip=32    ← 第一道门（ne 5079）
jcc cond=local1=1 ⇒ 跳 op2=0x12b      @SCJUMP.BIN ip=39    ← ★第二道门（ne 5080）**跳走**
jcc cond=local1=1 ⇒ 跳 op2=0x12b      @SCJUMP.BIN ip=41    ← ★gr f8080,0xa ⇒ local1=1 ⇒ 跳走
写 global0 ← 1  @SCJUMP.BIN ip=42                          ← 但仍落到这里
```

★`ip` 与数组下标差 1（`ip=N` = index `N-1`），映射后：

| index | 指令 | 实际结果 |
|---|---|---|
| 31 | `ne local1, global 5079(0x1dd7), 1` | — |
| 32 | `jcc local1, -1, 0x100` | `local1=0` ⇒ **落下句** |
| 33 | `gr local1, global f8080, 0xa` | `f8080 = INT_MAX` ⇒ **local1 = 1** |
| 34 | `jcc local1, -1, 0x100` | `local1=1` ⇒ 跳 0x100 |
| 35-37 | `mov global0,1` / `mov 3f3c,0` / `mov f8080,0xa` | **被跳过** |
| 38 | `ne local1, global 5080(0x3318), 1` | `3318 = 0` ⇒ **local1 = 1** |
| 39 | `jcc local1, -1, 0x12b` | `local1=1` ⇒ 跳 0x12b |
| 40 | `gr local1, global f8080, 0xa` | `f8080 = INT_MAX` ⇒ **local1 = 1** |
| 41 | `jcc local1, -1, 0x12b` | `local1=1` ⇒ 跳 0x12b |
| 42 | `mov global0, 1` | **★仍然执行了** |

⇒ 两道门的条件**全为 1（都该跳）**，而 `mov global0 1` **还是执行了** ⇒ **`jcc` 的跳转没有生效**。
（`local7`/`local1` 的取值都对：`local7=0` 是因为门条件要 `1dd7==1 && 3318==1`，而这两个都是 0。）

### 11.2 ★`3318` = "已开始过新游戏"标志 —— 它只有**一个**写点

| 全局 | 写点 | 存档池里的值 |
|---|---|---|
| `3318` | **唯一**：`src/GAMESTART.txt:1027` `mov (global-int 3318) 1`（在「ゲーム開始」分支里，前置门 `global a9bc` / `a9c0 & 2`） | **0** |
| `1dd7` | **唯一**：`src/SC2560.txt:1282` `mov (global-int 1dd7) 1` | 0 |
| `1521` | （门要求 `!= 1`） | 0 ✔ |
| `2f3c` | （门要求 `!= 1`） | 0 ✔ |
| `f8080` | `SETADVFLAG.txt:24` 写 `INT_MAX`；`SCJUMP*` 写 `a`/`0` | **池外**（1015936 > 池长 1015792） |

**`3318` 是"玩家已经开过一次新游戏"的标志**：`GAMESTART`（ユーザー侧点「ゲーム開始」）唯一地把它置 1。
真机上它**是 1** ⇒ `ne 5080, 1` = 0 ⇒ 第一道门在 index 38 就**跳走**（跳过 42 的写）⇒ `global 0` 保留 6 ⇒ 半透明黑幕。
emulator 里它是 **0** ⇒ 条件反了 ⇒ 一路落到 `mov global0 1`。

### 11.3 于是"白底"的完整因果（三层，全部有落点）

```
① 存档池 global 0 = 6（窗口模式"白纸/黑幕"的选择子）        cache/SAVE78.DAT int[0]=6
② 但 SN0000 末尾/章节点路径把 3318 保持为 0                  src/GAMESTART.txt:1027 未生效
③ SCJUMP 的第一道门（要求 3318==1 才跳走）因此不成立          src/$1$SCJUMP.txt:38-41 / SCJUMP.txt:38-41
④ 落到 mov (global-int 0) 1 ⇒ global 0 由 6 变 1
⑤ 窗口例程 eq local0, global0, 6 判假 ⇒ 走 draw-texture 白纸窗  src/SN0000.txt:3080 / SC0000.txt:32666
```

### 11.4 结论（emulator 错在哪）

**`global 3318` 在 emulator 里没有被置 1**，而它的唯一写点是 `src/GAMESTART.txt:1027`。
所以要么 (a) `GAMESTART` 的「ゲーム開始」分支没走到那一行（其前置门 `a9bc` / `a9c0&2` 取值与真机不同），
要么 (b) 它置 1 之后又被覆盖面（存档池里是 0，说明**存档写盘时它也是 0**）。
→ 两条都要以 `GAMESTART` 的运行期取证来分派；`GAMESTART` 已在第三层台账里（`status=partial`），可直接续读。

★**渲染侧、纹理侧、`0x259` 三处都已彻底排除**（本次全部有实测证据）。
★**诊断探针留在源码里**（`arithmetic.ts`/`gfx-texture.ts`/`save-slot.ts`/`control.ts` 的 `[T-0102 诊断]`），验证完一并撤。

---

## 12. ★★§11 的因果我**推反了**（2026-09-22 用户指正后重算）

用户口径：**78/79 是正确状态**，且**加载存档逻辑上不该执行 `GAMESTART`**。按此重算，§11 的结论**作废**。

### 12.1 门的方向：**条件为真 = 跳走 = 跳过那段写**

`src/$1$SCJUMP.txt:38-53`：

```
eq local1, global 1dd7, 1
eq local2, global 3318, 1
and local3, local1, local2
ne local4, global 1521, 1
and local5, local3, local4
ne local6, global 2f3c, 1
and local7, local5, local6
jcc local7, ffffffff, label_000004e4      ← local7 真 ⇒ 跳走（跳过下面三行）
gr local1, global f8080, a
jcc local1, ffffffff, label_000004e4      ← local1 真 ⇒ 跳走
mov (global-int 0) 1                      ← ★只有两道门都「假」才会执行
```

⇒ 要让 `global 0` **保持 6**（= 真机行为），**第一道门的 `local7` 必须为 1**，
即 **`1dd7 == 1 && 3318 == 1 && 1521 != 1 && 2f3c != 1`**。
§11 里我说的"`3318` 该是 0"是**反的** —— 正确的是 `local7` 要**真**。

### 12.2 存档池的实测（两份都一致）

| global | SAVE78 | SAVE79 |
|---|---|---|
| `0`（窗口模式） | **6** | **6** |
| `1dd7` | **0** | **0** |
| `3318` | **0** | **0** |
| `1521` | 0 | 0 |
| `2f3c` | 0 | 0 |
| `f8080` | 池外（> 池长） | 池外 |

⇒ `local7 = 0 && 0 && 1 && 1 = 0` ⇒ **第一道门落下句** ⇒ 再用 `f8080`（被 `SETADVFLAG` 写成 `INT_MAX`）
⇒ 第二道门也落下句 ⇒ `mov global0 1` **执行** ⇒ 6 变 1 ⇒ 白纸窗。

### 12.3 于是真正的问题变成：**这段 SCJUMP 代码本就不该被执行**

- 存档把 `1dd7`/`3318` 都存成 0 ⇒ 真机在存档当时也是 0 ⇒ **真机上这段的 `mov global0 1` 同样"够得着"**；
- 但真机画面是黑幕（`global 0` 留 6）⇒ **真机根本没走到这段**；
- emulator 走到了 —— 而且链路上还夹着 `SETADVFLAG.BIN`（把 `f8080` 抬到 `INT_MAX`，等于**把第二道门也打开**）。

⇒ **根因方向应改为**：emulator 在"推进到章节点"时**多走了"章节跳转处理"这条链**
（`ALLMAP` → `SETADVFLAG` → `SCJUMP` 的「本支处理」），而真机在该状态下走的是**等待/不处理**那条
（`jcc local7, ffffffff, label_000004e4` 之后应有的语义）。这一条需要**从 `ALLMAP` 的入口条件**去定：
谁是触发者、`3f3d` 该不该在此时为 1。

### 12.4 §11 的哪些部分仍然成立
- `jcc` 级诊断的**原始读数**成立：`local7=0`、`local1=1`、`f8080=INT_MAX`、`global0` 最终为 1；
- **不成立的是我的因果解释**（"`3318` 该是 1"）—— 存档说它是 0，而存档是对的；
- 渲染侧 / 纹理侧 / `0x259` 的排除**仍然成立**。

---

## 13. ★★2026-09-22 最终收敛：**读档之后，`SN0000` 的续跑触发了"章节跳转处理链"**

### 13.1 用户口径订正 + 日志核对
用户：**13:36 这份日志是「加载 078 → 推进」**（不是新游戏）。核对成立：

| 行 | 事件 |
|---|---|
| 3402 | `[T-0102 诊断] 池还原：int[0] 文件值=6 key=0 ⇒ raw=0x18000` ⇒ **存档的 6 装对了** |
| 3404-3410 | `[slot-load]` 真槽装载（`savedCur=2`、帧记录 3 条、`CALLBACK_LOAD.BIN`、BGM #13）⇒ **这是读档点** |
| 5791-5797 | `0xAE: 续跑走栈 0→1 NOVEL.BIN` / `1→2 SN0000.BIN` ⇒ **续跑收尾 `cur=2 落点=2063（SN0000）`** |
| 6156 | `写 global0 ← 2 @SN0000.BIN ip=2227` ⇒ 续跑后 SN0000 走到 2227，把窗口模式改成 2 |
| 6207 | `[call-script] 0x5265 -> ALLMAP.BIN` ← **章节跳转处理链从这里开始** |
| 6214 / 6256 | `0x512f -> SETADVFLAG.BIN` / `0x5224 -> SCJUMP.BIN` |
| 6261 | `写 global0 ← 1 @SCJUMP.BIN ip=42` ⇒ **6 被覆盖成 1** |
| 6892+ | `draw-texture h=0x19640 槽=0x11 global0(解码)=1` ⇒ 白纸窗 |

★**全日志只有两处写 `global0`**（6156 写 2、6261 写 1），**没有任何地方把它写回 6**。
而把 6 写进去的只有 `src/SC0000.txt:1292`（序章入口支）⇒ **续跑收尾后的这条链上没有它**。

### 13.2 结论：真机不会走这条链，emulator 走了

- `ALLMAP` / `SETADVFLAG` / `SCJUMP` 是**章节推进（章节点处理）**用的链，**不是读档链**；
- `CALLBACK_LOAD`（读档那一跳）我已通读全文：只做消息跳过 / BGM 还原 / 覆盖态复位，**完全不碰 `ALLMAP`**；
- 而 emulator 在**读档续跑之后**、由 `SN0000` 的续跑代码（`ip=2227` 那一带）把这条链**跑了起来**，
  于是 `global 0` 从存档的 **6** 被改成 **1**。

⇒ **emulator 的错在"读档续跑把章节跳转处理链也跑了"** —— 真机读档后应当**保留**存档里的窗口模式（6）。
这与渲染、纹理、`0x259`、`GAMESTART` 全都无关（后者本会话根本没执行）。

### 13.3 我此前两处错误（已作废，留档以免重犯）
1. §11 把门的方向说反（见 §12）；
2. §13 之前把 `GAMESTART` 扯进因果链 —— 日志里 **GAMESTART 一次都没执行**（只有 `TITLE.BIN` 然后读档），已删。

### 13.4 下一步（判死"该不该走这条链"）
入口在 `ALLMAP`（`src/ALLMAP.txt:28-60`）：`b22a == 0` 才置 `3f3d = 1`，随后 `SETADVFLAG` + 跳转表循环。
需要定：**读档续跑到 `ip=2227` 之后，走这条链是脚本的正常分支，还是 emulator 的续跑把某个
"正在处理章节"的门（`b22a` / `3f53` / `f8002` 一族）算错了。** 手段：把 `b22a` / `3f3d` / `3f53` 纳入诊断。
