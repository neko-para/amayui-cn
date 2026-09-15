# T-0017 · 过程文档（notes.md）

## 2026-09-15


## 研究（2026-09，动手前）

### 结论（两条）
1. **映射已经从源码读清**，两个选择子是**同一套枚举**：`0（及其它未列值）= 普通 alpha`、`1 = 加算`、
   `2 = 覆盖/不混合`、`3 = 减算`。可以直接实现，不需要再猜。
2. ★**票面/基线里"语料恒 0 ⇒ 画面零差异"的前提是错的**（那是本票一直被排到 P2 的理由）：
   实测语料有非 0 站点，且变量路径上有 62 处运行期取 1 ⇒ **本票是可见行为缺口**，不是整理项。

### 引擎映射（第一手 raw 依据）
**draw-item（`Item+0x30`）**
- 送达：`sub_4AEEA0` raw 133443 `sub_4A2D50(_this, v26[1], v22, 0, (int *)&v26[9], SLODWORD(v26[12]), v25)`
  ⇒ 第 6 参 = `v26[12]` = 元素 **`+0x30`** = `Item.blend`（`v26` = 740 字节元素的副本）。
- 消费：`sub_4A2D50`（raw 122891-123253）raw 123089-123121，按第 6 参（下称 `a6`）设 D3D 状态
  （vtable+228 = `SetRenderState`；19=`D3DRS_SRCBLEND`、20=`D3DRS_DESTBLEND`、171=`D3DRS_BLENDOP`、15=`D3DRS_ALPHATESTENABLE`）：
  - raw 123096-123097 `a6==1` ⇒ 19=5(`SRCALPHA`)、20=2(`ONE`) = **加算**
  - raw 123110-123114 `a6==2` ⇒ 先看 `Scene+46456` 指向的槽对象 `+1048 == 1`；成立才 19=2(`ONE`)、20=1(`ZERO`) = **覆盖**
  - raw 123104-123107 `a6==3` ⇒ 171=3(`BLENDOP_SUBTRACT`)、19=5、20=2 = **减算**
  - **其余（含 0）⇒ raw 123100-123117 直接跳到 LABEL_42，本函数一个 SRC/DEST 都不设** ⇒ 沿用
    当前 D3D 状态（常态 = 全局/别处设的 5/6 普通 alpha；全库 `27(ALPHABLENDENABLE)=1` 只有 3 处：
    raw 65857 / 119512 / 147560，`sub_4A2D50` 里没有）
  - 每个 item 另设 raw 123093 `15=0`（ALPHATESTENABLE 关）
**mesh（`MeshEntry[9]`）**
- 写入：`0x322` → `sub_4AE2C0` raw 132815 `v5[9] = a3`（a3=op2）✓；`entry[13] = state0`（raw 132818）
- 送达：`sub_4AF1C0` raw 133617 `sub_49E390(_this, _this, v8, v40[1], v8, v22, (int)&v40[7], v40[9])`
  ⇒ **第 8 参 = `v40[9]` = `MeshEntry[9]`** ✓
- 消费：`sub_49E390`（raw 119348-…）raw 119369 先 `27=1`，再按第 8 参（`a8`）分支：
  - raw 119372-119375 `a8==1` ⇒ 19=5、20=2（**加算**；`v19=2` 显式写在 raw 119373）
  - raw 119381-119384 `a8==2` ⇒ 同 draw-item 的槽条件，成立才 19=2、20=1（**覆盖**）
  - raw 119396-119398 `a8==3` ⇒ 171=3、19=5、20=2（**减算**）
  - raw 119387-119394 **其余（含 0）** ⇒ 19=5、20=6(`INVSRCALPHA`) = **普通 alpha**
- ⇒ 两处**同一套枚举**（0/1/2/3 语义一一对应），只是"0"这一档 draw-item 靠继承、mesh 靠显式设置。

### 置信度与未确认
- ★两处 `DESTBLEND` 的值在反编译里**寄存器丢了**（raw 119375 / 123107 被渲染成 `(v10, 20)`，
  raw 123247/123248 还留着 `variable 'v45' is possibly undefined`）⇒ "`2` 的 dest=1(`ZERO`)、
  `3` 的 dest=2(`ONE`)" 是**按 mesh 侧孪生分支的显式实参推断**（raw 119384 写 `,1`、raw 119398 写 `,2`）
  ⇒ **E2**（推断），不是 E3。
- raw 123113 的 `, v45` / raw 123104 的 `, v45` 是反编译给 `SetRenderState` 多补的第 4 参（`v45` 未定义），
  不是真参数。
- **`2` 的槽条件未建模**：`Scene+46456` 是"当前顺序/槽下标"，`Scene+4*idx+42456` 是那张槽表（引擎也有
  100 上限），槽对象 `+1048 == 1` 的含义未查 ⇒ emulator 里 `2` 只能先按"覆盖"近似。
- ★引擎是**全局 state 机且会泄漏**：`a6==0` **不重置** SRC/DEST/BLENDOP ⇒ 一个 `2`/`3` 的 item 之后，
  后续 `0` 的 item 会继承（直到别处重设）。Pixi 是**逐对象** `blendMode` ⇒ 两者语义不同，
  要么在 presenter 里维护"帧内当前混合状态"以忠实复现，要么显式接受偏差（见下"待定"）。

### emulator 侧落点
- 新增**唯一一份**映射（避免两宿主/两族各写一遍）：`src/renderer/drawitem/blend.ts` →
  `blendModeOf(selector: number): BLEND_MODES`（0→`NORMAL`、1→`ADD`、2→`NONE`、3→`SUBTRACT`，其余→`NORMAL`）；
- draw-item：`src/renderer/pixi/presenter.ts:113-114`（`spr.tint`/`spr.alpha` 旁）加 `spr.blendMode = blendModeOf(it.blend)`；
- mesh：`presenter.ts:134` `new Graphics()` 之后加 `g.blendMode = blendModeOf(m.blend)`；
- ★Pixi 语义核对：`ADD` = (SRC_ALPHA, ONE) 与引擎 1 一致；`SUBTRACT` = (SRC_ALPHA, ONE)+SUBTRACT 与引擎 3 一致；
  `NONE` 关混合 ≈ (ONE, ZERO)（源色直接写入、alpha 不参与），与引擎 2 的"覆盖"同义 —— 但
  Pixi 是 premultiplied alpha，`spr.alpha<1` 时 `NONE` 会写出"变暗的不透明色"，而引擎 (ONE,ZERO) 的
  源色 = 纹理 RGB × diffuse RGB（alpha 不乘）⇒ **两者在 alpha<255 时可能不同**，这正是 E4 要对照的点。
- 完成后：从 `dead-writes.baseline.json` 的 `known` 删 `Item.blend`/`MeshObj.blend`（闸门 C 自动变严）。

### ★顺带发现的**台账错记**（同一处元素，建议随本票一起订正）
| 位置 | 现在写的 | raw 事实 |
|---|---|---|
| `src/renderer/drawitem/model.ts` 的 `MeshWin` 注释 | mesh 色窗 "`+36 start / +40 delay / +44 dur`" | **`+40` = start(`entry[10]`)、`+44` = delay(`[11]`)、`+48` = dur(`[12]`)**（raw 133533-133538 读 `v40[10]/[11]/[12]`；raw 132834-132843 写 `[10]=0/[11]=a3/[12]=a4`）⇒ `+36` 是**混合选择子 `entry[9]`** |
| `analysis/engine-capabilities.json`（`clock-read-meshentry-color-window` 的 note） | "色槽偏移（+36/+52/+56）已对上…**+36 = 逐顶点 diffuse 数组**" | `+36` = `entry[9]` = **混合选择子**；逐顶点数组是 `entry[2]/[3]/[4]`（= `+8/+12/+16` 的指针，raw 122304 读 `a2+16`、`a2+20`=vcount） |
| `dead-writes.baseline.json` 的 `reason.MeshObj.blend` / `Item.blend` | "语料实测恒为 0（默认），故画面无差异" | **错**（见下语料统计） |
| `model.ts` 的 `MeshObj.blend` 注释 | "语料里恒为 0" | **错** |

### 语料统计（我实测；用 `src/*.txt` 的助记符解析，`//` 之后不算）
- `set-draw-color-alpha`（`0x203`，op2 = `Item+0x30`）：共 **7637** 处 → `0` × 6844、**`2` × 420**、**`1` × 33**、
  变量 `(global-int 4fd1)` × 334、长字面量（`12c` 等，疑为 5 参/异常写法）× 少量。
  例：`src/SC0070.txt:1349 set-draw-color-alpha (global-int f8026) 2 ff (local-int 0)`、
  `src/ALCHEMY.txt:985 set-draw-color-alpha 11d28 1 ff ffffff`。
- `set-vertex-color`（`0x322`，op2 = `entry[9]`）：共 **3919** 处 → `0` × 2373、变量 `4fd1` × 1518、**`1` × 28**。
  例（运行时确实取 1）：`src/SC0000.txt:16648 set-vertex-color 19258 1 ff ffffff` 前后就是
  `create-mesh` + `mov (global-int 4fd1) 1` + `mov 4fd2/4fd3`（`SC0000.txt:16644-16653` 一带）。
- `4fd1` 的全部写值：`mov (global-int 4fd1) 0` × 1332、**`1` × 28**（无其它值）。
- 按"导入时变量当时值"顺扫站点：`4fd1=0` → 1634 处、**`4fd1=1` → 62 处**、未在本文件赋值 156 处（跨脚本全局）。

### 验收/守卫（建议）
1. 新 `test/blend-mode.test.ts`：`blendModeOf` 的四值表（0/1/2/3 + 未知值兜底）——纯函数，E3；
2. presenter 接线**一条断言**（可用源码棘轮或对 `Item.blend`/`MeshObj.blend` 的消费者计数），
   防止"映射写了但没接上"（这正是闸门 C 抓的形态）；
3. **闸门 C**：从基线删两条后 `npm run check:dead-writes` 必须绿（证明消费者真的存在）；
4. **E4**：`npm run shot`（序章 `SC0000` 的 `1` 站点 + 找一处 `2`）对照"加算/覆盖"是否出现；截图对照，
   ★注意 `NONE`/premultiplied 那条语义差异要在这一步定夺（可能需要为 `2` 改用 `NORMAL_NPM` 之类的替代档）；
5. 完成后把 baseline 的 `reason` 两条改写成"已消费（`blendModeOf`）"或直接移除，并订正上面那张错记表。

### 待定（实现前要拍一次板）
- 引擎的"混合状态泄漏"要不要忠实复现（presenter 维护帧内状态）？
- `2` 的槽条件（`+1048`）不建模是否可接受（会不会把本该"不变"的场合画成"覆盖"）？

## 2026-09-15


## 第 2 轮：独立复核（`.lst` 逐指令）后的订正与升级

★**方法论收获**：`engine/天结_unpacked.exe_utf8.lst`（IDA 清单，与 `.c` 同目录）能解出 Hex-Rays **丢掉的寄存器实参** ——
本票两处 `DESTBLEND` 值就是靠它的 `push` 定死的。凡「`.c` 里实参只剩 `(v10, 20)`」的情形，都应去 `.lst` 取。

### 订正（第一轮写错的一处）
- 值 **3** 的 `BLENDOP(171) = 3` 是 **`D3DBLENDOP_REVSUBTRACT`**（结果 = **dst − src·SRCALPHA**），
  不是第一轮写的 `SUBTRACT`（那是 `src − dst`）。⇒ Pixi 侧对应的是 **`'subtract'`**
  （`SubtractBlend` 的公式 `max(0, back.rgb − front.rgb·front.a)`，正好是 REVSUBTRACT）。

### 升级（第一轮标 E2 的推断 → 反汇编实证）
| 值 | 第一轮 | 复核结论 | 依据 |
|---|---|---|---|
| 2 | dest=1(`ZERO`)（按 mesh 孪生分支推断） | **确认** | `engine/天结_unpacked.exe_utf8.lst:269267` `.text:004A3191 push 1` |
| 3 | dest=2(`ONE`)（同上推断） | **确认** | `.lst:269286` `.text:004A31BB push 2` |
判定方式也定死：全是 `cmp 1 / cmp 2 / cmp 3` 的 if/else 链，**无跳转表**（`.text:004A313B/004A3163/004A3195` 等）。

### 新增事实
1. **值 2 的门控语义已定死**：`Scene+46456` = **当前渲染目标纹理槽**（`sub_4A50C0` = SetRenderTarget，
   raw 124839-124912；`-1` / `>0x3E7` = 后台缓冲）；`CTexture+0x418(1048)` = 纹理创建模式
   （`sub_48AC40` raw 107026；mode 1/2 = `Usage=D3DUSAGE_RENDERTARGET` + `Pool=DEFAULT`）
   ⇒ **值 2 = "正在往 mode-1 的离屏渲染目标上画 ⇒ 用 ONE/ZERO 直接覆盖"**。
   ★**emulator 没有这一层状态** ⇒ 若照抄"2→覆盖"，那 420 处里门控不成立的会画错；若照抄"2→继承"，
   门控成立的会画错。要么给 `0x1F8` 建的离屏纹理打 mode 标记（在"往该纹理画"的帧里把值 2 视为覆盖），
   要么把这条**登记为已知偏差**。二选一必须写进 changes.md。
2. **场景默认混合**：`sub_4535F0`（raw 65841-65916）在渲染循环**之前每场景一次**，按 `Scene+0x4EC(1260)`
   设 1/2/3/else 的混合（写点 = `sub_427A90` raw 34411-34447，即指令 **`0x33F` op1**；语料 1 处：
   `src/SETWEATHER.txt:80 i33f 1 ff ffffff`）
   ⇒ **draw-item 路径的值 0/≥4 = "不改、继承这个场景默认"**（常态 = `(5,6)` 普通 alpha），
   而 **mesh/model 路径的值 0 = 显式设 `(5,6)`**。这条差异在实现"逐对象 blendMode"时要写清楚
   （Pixi 逐对象 ⇒ 值 0 直接用 `NORMAL` 即可，等价于场景默认；但**值 2/3 之后的继承残留**仍是引擎特有行为）。
3. **同族的第三个消费者**：`sub_49E700`（DrawModel，raw 119489-119584，selector=`a3`），枚举与上表右列逐格相同。
4. ★**别混表**：3D 角色路径（`sub_4C1EA0` raw 147754-148087 / `sub_4C3290` / `sub_4C19E0`）是**另一套**枚举，
   还额外用 `206/207/208`（`SEPARATEALPHABLENDENABLE` / `SRCBLENDALPHA` / `DESTBLENDALPHA`）⇒
   `blendModeOf()` **只服务 `Item.blend` 与 `MeshObj.blend`**，不许被 3D 路径复用。
5. `sub_4A2D50` 里 `19(A)(v25,171,3)` / `(v25,19,2,v45)` 的 `v45` 是反编译多补的第 4 参
   （`.c:123248` 自己写着 `variable 'v45' is possibly undefined`）⇒ 不是真参数（与第一轮判断一致）。

### Pixi 落地的坑（实现时必读）
- **`'subtract'` 不是 WebGL 原生混合**：`mapWebGLBlendModesToPixi` 只含
  `normal/add/multiply/screen/none/*-npm/erase/min/max` ⇒ `'subtract'` 走 `BlendModePipe` + `BlendModeFilter`
  （多一次离屏 pass）；**若未引入 `pixi.js` 全量入口，`setBlendMode('subtract')` 会静默回落成 `'normal'`**
  （`GlStateSystem.setBlendMode` 里有 `if (!this.blendModesMap[value]) value = 'normal'`）。
  ⇒ 更稳的做法：往 `blendModesMap` 注入一档自定义
  `[SRC_ALPHA, ONE, ONE, ONE, FUNC_REVERSE_SUBTRACT, FUNC_REVERSE_SUBTRACT]`（值 3 语料 0 处，优先级最低，
  但**绝不能映射成 `'normal'`**）。
- `State.blendModeIds` 未登记自定义名（未知名字的 `_blendModeId = 0` = normal）⇒ 批合并的 hash
  可能把"自定义档"当 normal 合批，**需实测**。

### 仍未确认（继承第一轮，别当成已解决）
1. `DrawItem +0x30` 的**初值**（`0x1FB` 的建项函数 `sub_4ACE50` raw 131817-131840 不写它；新条目由
   `sub_4AAD40` raw 130153-130195 生成，模板来源在 `.c` 里丢了）⇒ "新项 blend=0" 未逐字节确证。
2. **同场景内逐 item 的混合 state 残留**（值 0/≥4 是"继承"）⇒ 渲染循环是否在 `sub_4AEEA0` 之前重置，
   未逐 item 追踪。若要忠实复现"继承"，先补这一步。
3. `src/TITLE.txt:632` 的 `12c`（=300）为何落在 blend 槽（疑为该行 op2 槽被复用作 delay；真机落 else 无害）。
4. `CTexture+1048` 的 mode 1 vs 2 差别（为何门控只认 `==1`）。
