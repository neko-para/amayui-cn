# T-0179 第 70 轮（2026-09-25）—— 逐条裁决**收口**：三波并行 + 数据卫生 + 工具修一个真 bug

> 本轮目标（计划 `CONTEXT.md` §3.1/§5.4 的"最大可关单池"）：把 `analysis/opcode-gaps.json` 里 `T-0179` 名下的
> `missing[]` 逐条按三态过滤裁决完毕（① 实现 / ② 判词+重开条件 / ③ 复核后删）。
>
> **起点**：`missing` **104 条 / 80 opcode**（其中 **28 条无任何判词**、76 条已有判词）。
> **终点**：`missing` **95 条 / 72 opcode** —— ★**95/95 全部带「重开条件」（机械核过：0 条缺）**。

## §22.1 三波并行只读裁决（A / B / C）+ 一波跨台账复核（D）

四波**全部只读**（各自只写 `.tmp/opA|opB|opC|opD/`，未碰 `analysis/`·`tickets/`·`docs-new/`·`app/`·`src/`·`scripts/`），
主 agent 串行落库（`ledger.js --plan`，两阶段 + 写盘后回读）。
**波次分工按文件面互斥**：A = 操作数/数组/字符串编码族；B = renderer/scene/gfx 族；C = msgwin/text/font/input/audio/save 族；
D = `T-0148` §5.2 那张机械复核表的剩余面（跨能力台账）。

| 波 | 作业面 | ① 实现 | ② 判词重写 | ③ 删条目 |
|---|---|---|---|---|
| **A** | 6 条新裁决 + 6 条复核 | 0 | **6**（`0x192`×2 / `0x193`×2 / `0x1b2`×2） | 0（★`0x61` 由复核改判为 ③，见下） |
| **B** | 10 条新裁决 + 8 条复核 | 0 | **7**（`0x32`/`0x258`/`0x321`/`0x327`/`0x328`/`0x329`/`0x32e`/`0x20e`/`0x25b` 中去重后 7 个 opcode） | **3**（`0x213`/`0x24f` + 连带 `0x223`） |
| **C** | 12 条新裁决 + 11 条复核 | **1**（`0x208`） | **7**（`0x1ba`/`0x75`(GDI)/`0x205`×2/`0x2f4`/`0x142`/`0x148`） | **4**（`0x8c`/`0x2f5`/`0xcd`/`0x75`(字号 5 格)） |
| **D** | `T-0148` §5.2 的 10 条 `—` 项 | 0 | 0（判词已在） | 0 |

### §22.1.1 本轮**唯一**的 ① 真缺口 = `0x208`（已实现 + 命名守卫）

- **缺口**：`src/renderer/app/textureBarrier.ts:28` 的判据集合是 `[0x1f9, 0x249]`，但**调用点** `src/renderer/app/session.ts:720`
  把它收窄回单条 `if (t.opcode === 0x1f9)` ⇒ **`0x249` 在会话接线上永远等不到屏障**；
  而当时的源棘轮（`test/texture-barrier-observable.test.ts:107`）只钉"旧的 `!== && !==` 内联式已删"，
  **看不见这个收窄** ⇒ 纯函数单测「同族门 `0x249` 也过」在会话接线上是**假绿**。
- **语料证据（可观测差异实证）**：全库「`i249`/`i1f9` 紧邻 `i208`」的现场只有 **2 处、都是 `i249`**
  —— `src/BTL.txt:4174 i249 … → :4175 i208 … → :4182 draw-texture …`（宽高直接进**源矩形** ⇒ 0×0 = 贴图不可见）、
  `src/DRAWCHP.txt:56 → :59 → :62`。
- **改法**：调用点改走 `shouldAwaitTextureBarrier(t.opcode)`（判据的唯一来源），并给源棘轮**补两条断言**
  （`assert.match(/shouldAwaitTextureBarrier\(t\.opcode\)/)` + `assert.doesNotMatch(/t\.opcode === 0x1f9\b/)`）。
- ★**踩到的坑（记下来）**：第一版把"修前是 `if (t.opcode === 0x1f9)`"写进了**代码注释**，
  而 `doesNotMatch` 扫的是**源文本** ⇒ 注释里的字面串让新守卫自己红。**注释里不要复述被判禁的字面串**。

### §22.1.2 ★两条**推翻前轮结论**的复核（都是"误读体"造成的）

1. **`0x61`：从「有意分叉（②）」改判为「③ 零缺口」** —— 第 48/49 轮的判据是「引擎 `sub_418CC0` 按操作数自身
   tag 分派 ⇒ 直接型 op1 写同类型直接槽，emulator 只认 6 种指针型 ⇒ 结构性分叉」。A 波读 `sub_418CC0`
   （raw 24363-24404）全文：`switch (*(v6 - 1))` **只有 case 6/7/8/12/13/14（指针族）**，`default:` 直接
   `_CxxThrowException(…Command_Type_Exception)`（raw 24399-24401）⇒ **引擎对直接型 op1 也抛**，
   与 emulator `src/vm/operand.ts:146-148` 的 `setRefOperand` default 支**逐字同构** ⇒ 不是分叉、**没有缺口**。
   语料复核：`^lookup-array ` **143885 处**的 op1 全是指针族（直接型 0 处）。
   连带**改掉** `test/opcode-operands.test.ts:119-134` 的 `EXPECTED_THROW` 理由（原写"引擎按 tag 分派"）。
2. **`0x2f5`：三处前提全被体推翻** —— ① 它的 handler `sub_4267D0`（raw 33660-33674）**无 ADV 位读**
   （ADV 寄存属 `0x2F4`）；② op2 落 `Voice[277+ch]`，**不是** `Voice[5053+op4]`；③ 起播端第 4 实参 = **op2 & 1 = 循环位**，
   而 `Engine[5053+ch]` 全反编译 **6 处全是读、零写点**。emulator 早已实现且**正面拒绝**「op2→pan」。

### §22.1.3 ★本项目第 4 次「实现了却漏删对应 `missing`」

`0x213` / `0x24f`（B 波）与 `0x223`（主 agent 读 `src/renderer/scene/ops.ts:1490` 的 docstring 连带核出）
三条的缺口都**已由 `T-0154` 的 P2 落地**：
- `0x213` ⇒ `src/vm/handlers/msgwin.ts:1851-1852` 走 `objectAt(idx)` + `if (!o) return;`（`src/vm/msgwin.ts:864-866`
  的 `objectAt` 是**只取不建**，docstring 逐字点名"旧实现走 `object()`"的那条审计缺陷），
  守卫 `test/t0151-msgwin-vm.test.ts:77-101`；语料 10 处 `i213` 的 op1 **全在 0..9 表内** ⇒ 引擎门恒真。
- `0x24f` / `0x223` ⇒ `scEnsureTransitionLayer`（`renderer/scene/ops.ts:1465-1480`，
  由 `scSetTransition` 在 `:1506` 对 **`0x223`/`0x24F`/`0x250`/`0x251` 四个写入端统一接线**），
  守卫 `test/scene-t0154-mesh-transition.test.ts:115-156`（created / noop / recreated / 越界 / 混合门）。
  ★原 `missing` 还带**两处事实错**：比对基准是**槽 36 的 CTexture 对象**（`Scene + 4*36 + 42456`）而**不是**"当前渲染目标 id"；
  「只有 `0x24F` 有这段检查」为假（四条都有）。
- ⇒ `gaps.js --stale` 当时**没命中**它们（`what` 未自述"已实现"）—— 这印证了该工具的定位：**候选清单，不是判决**。

### §22.1.4 数据卫生（本轮新做的机械体检）

| 项 | 做法 | 结果 |
|---|---|---|
| `missing[].what` / `note` 里的 `src/**.ts:NNN` 引用 | 写只读体检脚本（取引用点前的反引号标识符 → 在目标文件里找其真实行） | 16 处漂移，**已全部刷新**（msgwin 家族 11 处、`audioEngine` 2 处、`engineFieldIds`/`engine` 各 1 处…） |
| 渲染字段里的**沿革话术**（`authority.md` A4①：`note`/`missing[].what` 不许出现「订正/旧句/历史判据」） | 全表扫 + 定点改写 19 处 | 三份生成物里的禁词 = **0**（`doc-model.test.ts` 由红转绿） |
| 能力台账的**顶层杂键**（`capabilities.js --validate` 只查 `emulator.note`） | 逐条盘点 | `note`(数组，逗号切碎事故残留)、`capability`/`evidence`(与 `name`/`emulator.evidence` 重复、且 `evidence` 与权威值**矛盾**) ⇒ 全删并把沿革写进 `journal` |
| `analysis/functions.json` 的 `sub_41A6C0` note | A 波顺手发现：写的是 `toFullWidthNumber`（"模块私有、未 export"） | 实为 `toFullWidthAscii`（**已 export**，`T-0175` ⑫ 去重后 msgwin 侧改为 import）⇒ 订正并补披露 |
| `src/vm/handlers/memory.ts:65` 的语料计数 | A 波发现"`^i1b0` 命中 0 处"是**助记符写错** | `0x1B0` 的助记符是 **`memcpy`**（`analysis/opcodes.json` opcode 432），实测 `^memcpy ` = **255 处**（含 58/43 处指针族操作数）⇒ 订正 |

### §22.1.5 ★工具修一个真 bug（`ledger.js` 的 `unset`/`set` 会穿透嵌套）

- **怎么发现的**：给 `text-layout-wrap-ruby` 写「`set emulator.note` + `unset ['note']`（删掉那个 vestigial 顶层 `note`）」的
  计划，**dry-run 被工具自己的"写盘后回读复核"拦下**：`emulator.note` 回读 `undefined`。
- **真因**：`unset` 用 `entryText.indexOf('"' + key + '"')` 找**第一次出现**，完全不管嵌套 —— 而该条目里
  `emulator`（深度 1）**先于**顶层 `note`（也是深度 1）出现，`emulator.note`（深度 2）里也有 `"note"` ⇒
  一个裸键 `note` 的 `unset` **删掉了 `emulator.note`**。`applySet` 的**首段**查找有同一个毛病（裸键 `set` 也会改错字段）。
- **修法**：新增 `findDirectKey(text, key, lo, hi)` —— 按「容器 + **局部深度 1**」定位直接子字段（带字符串/转义/括号深度扫描），
  `applySet` 的每一段与 `unset` 的逐级解析都改走它（`unset` 因此也**支持点路径**了）。
- ★**为什么这个 bug 值得单列**：它是"**数据损坏级**"的（会静默删/改**另一个**字段），而拦住它的正是本工具
  自己那条"写盘后回读复核"纪律 —— **纪律自己挣回了它的成本**。

## §22.2 `T-0148` §5.2 剩余面的收口（D 波 + 主 agent 落库）

`T-0148` §5.2 那张机械化复核表 23 条 `still-present` 里，opcode 栏为 `—` 的 **10 条**逐条裁决完毕：
**7 条可关（③：代码与台账都被后续波次改到位、§5.2 表只是过期快照）、2 条改台账后可关、1 条转 `opcode-gaps`**。

落地的 4 处能力台账改动：

| 能力条目 | 改动 |
|---|---|
| `lazy-movie-texture-slot` | `absent`/`E1`/无守卫 ⇒ **`partial`/`E2` + 守卫 `test/t0164-misc-batch.test.ts#★P3 0x20F：该槽纹理表为空 ⇒ 抛错`**；note 重写（`T-0164` 已把"对象表惰性创建 + 复用 + `0x23D` 清表 + `0x23F` 判据"做进两个宿主；旧 note 的"本票文件范围外 / 没有可绑的对象"被推翻）；`engine.fns` 补 `sub_4237B0`(0x20F)/`sub_4246B0`(0x236)/`sub_488DC0`(装载)/`sub_489230`(起播)/`sub_41A300`(0x23D)，`reads` 补 `Engine+365288` |
| `text-layout-wrap-ruby` | 删掉 **vestigial 顶层 `note`**（数组，逗号切碎事故残留；`journal` 早已记"本次合并成整串"）；`emulator.note` 的例数 `13 → 实测 18` |
| `msgwin-config-gates` | 把只写"见 `T-0166`"的半句补成结论（内建默认 1/3/1、分支可走到、emulator 已实现） |
| `scene-flag-46528-bits` / `scene-3d-weather-effects-rain-snow-leaf` / `bullet-dirty-from-freeze-or-pending` | 三处**裸文件守卫加真实用例锚**（把"文件存在"升级成"字面用例名存在"的棘轮） |
| `scene-freeze-flag` / `live2d-mesh-batches` | 删掉两个 vestigial 顶层键（`capability`+`evidence`；其中 `evidence: "E4"` 与权威 `emulator.evidence: "E3"` **互相矛盾**，且其依据是 `.tmp/` 截图 —— 纪律规定证据不许指 `.tmp/`）⇒ 沿革落 `journal` |

★**D 波的方法论收获**：§5.2 的 `quote-still-there` 只说明"审计当时引的代码还在"，**不说明"缺口还在"** ——
10 条里 9 条是"审计快照过期"（代码/台账已被后续波次改到位），只有 1 条（`lazy-movie-texture-slot`）需要改台账。

## §22.3 收尾实测（2026-09-25）

```
cd app/amayui-emulator && npm run verify    ⇒ **exit 0**（typecheck / typecheck:test / test:all / check:dead-writes 全链）
npm run check:dead-writes（单跑）            ⇒ ★ 无新增死写，exit 0（基线 11 条，只许收缩）
node scripts/build-opcode-gaps.mjs --check   ⇒ ✓
gaps.js / capabilities.js / scripts.js --validate ⇒ 全绿
tickets.js --validate                        ⇒ 177 张（基线 3 条红已随之清零 ⇒ `T-0146` 关单）
fix-evidence-lines.js --any --check          ⇒ 漂移 0 / 失效锚点 0
```

台账位移（本轮）：`missing` **104 → 95**、`implemented` **66 → 74**、`partial` **80 → 72**（entries 182 不变）。
**T-0179 生命周期内的累计**：`missing` **140 → 95**（删 45 条）。

## §22.4 为什么 T-0179 留在 `doing`（而不是 `done`）—— ★需要用户裁决的一点

本票的 `acceptance` ②（140 条逐条三选一、不许留空）**已满足**：95 条存量**全部**带「重开条件」（机械核过 0 条缺），
其余 45 条已按 ①/③ 删除或实现。

**但**本票 `why` 的 §1 写明了它存在的理由：`missing[].ticket` 是**承接票**，指向 `done` 票就等于"登记账失去 live owner"。
现在 **95/95 条 `missing[].ticket` 仍然指着 `T-0179`** ⇒ 若把它置 `done`，会**原样重建**当初开这张票要修的那个结构问题。
⇒ 本轮采取**保守处置**：**留在 `doing`**，把它作为那 95 条 ② 披露项的**常驻 owner**（它们的"重开条件"就是触发条件）。
若用户希望"关单优先"，可置 `done` 并在 `doneWhy` 里写明"长尾的 owner 语义由各条 `what` 的重开条件承担" —— 这是一次**取舍**，故在此明写。
