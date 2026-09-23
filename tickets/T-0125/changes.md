# T-0125 · 变更记录

## 第 1 次变更（2026-09-23）：删/改已确证的恒真断言 + 修错 oracle + 补两处变异实测零覆盖

范围：`tickets/T-0124` 审计里**主 agent 亲自复核过**的那些条目（不是全部 ~90 处；镜像实现 / 判据钉错地方 /
其余重复覆盖仍在剩余范围内）。**纪律：每处都给了反例实验，且改完都实跑过。**

### 1. 恒真断言（永久不会红）—— 删或改成有判别力的判据

| 位置 | 原形态 | 处置 | 反例实验（改什么会让它红） |
|---|---|---|---|
| `test/op-2ed-and-bit-index.test.ts` | `assert.equal(instr(op,args).argc, args.length)` —— `harness.ts:33` 的 `instr()` 定义就是 `argc: args.length` | **删除整条**（并写明它的两位替身：`opcode-arity`（对照反编译 arity 槽）与 `operand-plan`（对照 `analysis/opcodes.json`）） | 换成任意 opcode/任意参数个数 ⇒ 原断言永远绿 |
| `test/operand-plan.test.ts` | `covered + A + B + C === checked.length`（`:514` 起的 if/else 保证恒等） | **删除**，保留两条真棘轮；并**修掉两处失效提示串**（`棘轮 ≥319`→`≥347`、`> 250`→`> 3`） | 改任意一条 status ⇒ 四桶之和仍 ≡ checked.length |
| `test/op-d0-wallclock.test.ts` | 「另一个引擎」的 `enc`→`dec` 往返被当成"其它槽不受影响"（那引擎从未跑过 `0xD0`） | **重写**：在**真正执行的那台引擎**上预置邻槽 0x51 → 真执行 → 断言邻槽原值（顺带发现并写清一个坑：预置必须在 `loadScriptIntoFrame` **之后**，否则 `locals.clear()` 会清掉） | 让 `op_wall_clock_ms` 同时写 0x51 ⇒ 必红 |
| `test/op-205-blank-extent.test.ts` | `assert.equal(f(x), f(x), '自反（防 NaN）')` —— ★实测 Node 24 的 `assert.equal(NaN,NaN)` **不抛**，连"防 NaN"都做不到 | **改成** `Number.isFinite(a1) && a1 > 0` | 返回 NaN/Infinity ⇒ 必红 |
| `test/music-table.test.ts` | `assert.equal(0x1000001 & 0xffffff, 1)`（纯字面量，不碰被测物） | **删除**（上一行已独立钉住完整编码 `0x1000001`） | handler 整个改坏仍绿 |
| `test/save-data.test.ts` | `assert.equal(crc32MsbFirst(v), msb)`（同进程同函数自证） | **改成外部 golden** `0xfc891918`（实测值：`crc32MsbFirst("123456789")`） | 把 `crc32.ts` 的 `i<<25` 改 `i<<24` ⇒ 原断言绿、新断言红 |

### 2. 错 oracle（会**挡住正确修复**）—— `test/engine-config.test.ts`

原期望 `assert.equal(get(21293), 2, 'sound:Voice=2…')`，而引擎 raw 23693-23695 是
`*(_DWORD *)(a1 + 85172) = v37 != 0;`（布尔化 ⇒ 存 1）。`engineConfig.ts` 的 note 写着"布尔化"却**没有 map**。

- **修**：给 `soundSE`(20980) / `soundVoice`(21293) 补 `map: (v) => (v !== 0 ? 1 : 0)`；
  并给 `messageRMouseEvent`(1384) 补上 raw 23722-23735 那段**带门的映射**（`v<=1 ⇒ v+1`、`v==2 ⇒ 31`、**其它不写**）——
  为此把 `ConfigFieldBinding.map` 的返回类型放宽成 `number | null`（`null` = 引擎在该取值下**不写**该字段）。
- **证伪（关键）**：先只改 `src/` 不改期望 ⇒ `npx tsx --test test/engine-config.test.ts` 给出
  `✗ AssertionError … sound:Voice=2（下标 21293 = raw 字节 85172）` —— 这正是审计说的"**测试挡着修复**"的机械证明。
- 顺带补 `get(1384)` 断言与"map 返回 null 时不得写"的一致性分支。

### 3. 变异实测查出的零覆盖 —— 补两条真守卫

| 零覆盖点 | 处置 | 证伪 |
|---|---|---|
| **Z1 绘制项 z 序** | 新增 `test/render-draw-order.test.ts`（2 例：正序 + 反向自检），用 `ScenePresenter` + 屏幕 x 坐标当"身份标签"读 `root.children` 的**次序** | 反转权威排序 `presenter.ts:365` 的 `entries.sort` ⇒ **2/2 红**；而旧的 `draw-item-*`/`blend-mode`/`layer-direction`/`transition-render-wiring` 47 条**仍全绿** |
| **Z2 快照 `drawable`** | `scene-report.test.ts` 在恒等式旁补**独立下限**（`drawableItems >= 20`、`drawableItems > placeholderItems`；实测 32/24/8） | 注入 `drawable = []` ⇒ **红**（原来绿） |

★**同时订正了审计自己的一条无效变异**：首测的 `M7` 打的是 `presenter.ts:179` 的**预排序**，而那处只影响等键稳定性
（权威排序在 `:365`）⇒ 那次是**语义等价**，"全绿"是假象。详见 `tickets/T-0124/evidence/mutation-campaign.md` §6.1。

### 3.1 判据钉错地方 → 换成真行为断言（`missing-texture-skips-item.test.ts`）

原版是**对 emulator 源码文本**的正则棘轮：认 `#placeholder(it: Item)` 这个**签名**、查日志文案、
还**要求分支注释里含 `raw 122952`**（删注释即红、改名即假红）。

**改成行为断言**：用 `ScenePresenter` + `TextureCache` 在 Node 里直接断 `itemSprite(...) === null`
（引擎 raw 122952-122963 的 `return 0` 的对应物），**并自带反面控制** —— 把同一个槽绑上图之后必须画得出来
（否则"返回 null"可能是别的原因，这条守卫就没有判别力）。

**证伪（一次跑出两条结论）**：注入"缺纹理 ⇒ 画 1×1 白占位块"（= T-0102 白底的形状）：

| 用例 | 结果 |
|---|---|
| 旧的**源码正则**棘轮 | **仍然 ✔** —— 它只认那个签名，占位块换个写法/换个名字就漏 |
| 新的**行为**断言 | **✖ 红** |

⇒ 这条既是"换成行为断言"的完成，也是**"源码正则守卫比行为守卫弱"的机械证据**。
该变异已收进闸门 E：`M14_missing_texture_placeholder`。

### 4. 结果

- `npm run verify` 全绿（1086 例 / 0 fail / 12 skip）；`npm run test:org` 0 问题；四份台账自检绿。
- 闸门 D（test/ 类型债）在本次改动中**当场抓到我自己写出的一条新类型错误**（`op-d0` 里复制夹具缺 `ipTables`）
  ⇒ 已改为复用 `run()` 夹具，基线回到 131 条。**这是基线棘轮有判别力的现场证据。**

### 仍未做（本票剩余范围）

1. **镜像实现 ~15 处**（`OPS.has(op)`、`长度 === 21` 之类）：合并成一张 `{op, class, ticket}` 数据表，而不是逐处删。
2. **判据钉错地方 ~10 处**（源码正则 / 注释 / 日志文案 / 台账 prose）：换成公开缝上的行为断言
   —— 优先 `missing-texture-skips-item.test.ts`（改成 `presenter.itemSprite(...) === null`）与
   `transition-render-wiring.test.ts:100-103`（断言注释含 `类别 1`）。
3. **其余重复覆盖**：见 `T-0129`。
4. **Z3（`control/` 层零覆盖）**：见 `T-0127`。

---

## 第 2 次变更（2026-09-23，同会话续）：再清一处"断言注释"的判据

`test/transition-render-wiring.test.ts:100-103` 原来要求 `pixiBackend.ts` 的**注释**里同时含
`类别 1` 与 `U2` 两个字面串 —— 改注释就红、行为改坏却可能不红（"判据钉错地方"的典型）。
**删除**该行并留注说明：同一件事由紧邻的**代码形状**判据（`cat !== 0 && cat !== 2 && cat !== 3` + `continue`）
与本文件的 `renderItemSubset` 真宿主用例（`:183` 起）覆盖。用例数不变（6/6 绿）。

### 本票剩余（精确清单，供后续按需取用）

| # | 项 | 说明 |
|---|---|---|
| 1 | **镜像实现 ~15 处** | `OPS.has(op)` / `长度 === 21` 之类。★注册表分类那 8~9 处已在 `T-0129` 收成一张表（`test/registry-classification.test.ts`），其余按需合并 |
| 2 | 其余**源码正则 / 日志文案**判据 | 已做 `missing-texture-skips-item`（→ 行为断言）与本轮 `transition-render-wiring`；**还剩**：`op-22a-22f-scene-xform.test.ts:206-209/253-263`（台账 prose）、`op-1b2-text-buffer.test.ts:45-48` 与 `draw-string.test.ts:207-210`（日志文案）、`op-02-exit-minus11.test.ts:118-120,151-152`（分支判据匹配自己的日志）、`msg-text-range.test.ts:59-73`、`anim-window-done.test.ts:156-204`、`tool-paths.test.ts:98/110-113`、`audit-report-completeness.test.ts:66-90` |
| 3 | 重复覆盖 | 见 `T-0129`（已做注册表表化 + adv-msgwin 三条；剩存档族与 option-font-speed-menu） |
| 4 | Z3（`control/` 零覆盖） | ✅ 已在 `T-0127` 闭合（`test/control-format.test.ts`），变异 `M13` 已翻牌 |

---

## 第 3 次变更（2026-09-23，同会话续）：把"钉在文案/源码上"的判据换成行为断言（本票剩余②收尾）

清单来自 §「本票剩余」第 2 行。逐条处置如下，**每条都给了反例实验或"为什么只能这么钉"的理由**。

| # | 位置 | 处置 | 现在的判据 / 理由 |
|---|---|---|---|
| 1 | `op-02-exit-minus11.test.ts`（分支表 + `assert.match(logs, c.branch)`） | **改行为** | 原判据是"引擎自己那行日志里出现了哪句话"。现在：`pendingRecord0` + 假 `FileSource` ⇒ 分派进装载支的唯一可观测后果 = **帧 0 换成记录脚本**（`curScript().name === 'SYSTEM4.BIN'`）且标志被消费；`'none'` 支则脚本不变、标志不消费。三分类本身从日志文案改为**纯函数真值表**（新增导出 `sub40F750Branch`，9 格逐格断言） |
| 2 | `draw-string.test.ts:213-216`（`logs.some(l => l.includes('没有 create-texture'))`） | **改语义** | Node 里没有 `document` ⇒ `create()` 根本不建画布（`textureCache.ts:346`）⇒"有没有画上去"在这个宿主**没有像素面**可观测。改成三件可观测的语义：① `doesNotThrow`（去掉 `if (!cs) return;` 那道门 ⇒ 这里会 TypeError）；② `size(196)` 仍为 0×0（**不得凭空建面**）；③ 忽略必须**留痕**（日志条数增加，但**不管文案怎么写**） |
| 3 | `op-1b2-text-buffer.test.ts:47-50` | **放宽** | 0x1B4 体内不写任何操作数 ⇒ 观测面 = 日志 + 缓冲复位（`strings.ts` 头注）。缓冲复位已断言；剩下的"取出的内容被报出来"是**记录义务**，保留"日志里必须出现被取出的文本"，删掉对固定前缀 `'0x1B4: 取出文本缓冲'` 的要求 |
| 4 | `msg-text-range.test.ts:61-76`（源码正则） | **改行为** | 原版对 `presenter.ts` 源码文本做正则（认 `imgid === undefined && inMsgTextRange(...)` 这个字面表达式）。现在真调 `presenter.itemSprite`：正文区间内 + 无纹理槽 ⇒ `null`；**同一槽状态**、handle 移出区间 ⇒ 必须画出 sprite（互为对照） |
| 5 | `op-22a-22f-scene-xform.test.ts:252-267`（note prose 正则） | **删** | 那四个"订正点"**全部**已由同文件开头的**体账**用例直接钉在反编译器上（0x22A 无 `sub_41BF50`、0x22F 是 `j_D3DXMatrixTranslation`、0x1C4 语音总线 + `Engine+84128`、0x23A 两张表）⇒ prose 正则只是重复，且失败模式相反（改措辞假红、改坏引擎不红） |
| 6 | 同文件 `:202-213`（`note.length >= 80` + `/扩展点\|消费者/`） | **改内容** | 换成"`note` 必须至少引用一处 raw 地址（4~6 位）"= 台账的**可追溯性**义务；`在册 + 带票` 保留。字数与措辞不再是判据 |
| 7 | `tool-paths.test.ts:110-113`（`assert.match(src, /--name 只是文件名/)`） | **改行为** | 真跑 CLI：`node tools/shot.cjs --name a/b\|a\\b\|..\|x/../../y` ⇒ `exit(2)` 且输出里**不得**出现 Electron 的痕迹；再加 `record.cjs --out ../../x` 的越界用例与"合法 `--name` 不走这条 exit(2)"的反面控制 |

★**为此动了两处源码（都是"让判据能落在公开缝上"，不是改语义）**：

1. `src/vm/handlers/control.ts`：导出纯函数 `sub40F750Branch`（引擎分派表的事实），并在头注写明为什么导出。
2. `tools/shot.cjs` / `tools/record.cjs`：**参数校验从"早于 `require(main.cjs)`"提到"早于 `require('electron')` 本身"**。
   原先参数错仍会先把 Electron 模块拉起来（`record.cjs` 的事故正是"应用还没起来就崩"），提到最前之后
   ①报错更早、②`node tools/shot.cjs --name a/b` 就能复现 ⇒ 守卫不必再对源码文案做正则。

### 反例实验（本轮的判别力证据）

| 改动 | 期望 | 实测 |
|---|---|---|
| 禁用 `presenter` 的正文区间判据（`if (false && inMsgTextRange(...))`） | `msg-text-range` 红 | **fail 1**（pass 798/799） |
| 禁用 `shot.cjs` 的 `--name` 校验（`if (false)`） | `tool-paths` 红 | **fail 1**（pass 797/798） |
| 两处分别还原（逐字节比对） | 绿 | ✅ |

### 保留为棘轮的三类（**不是漏做，是判据本身就是"代码形状"或"交付物完整性"**）

| 位置 | 为什么行为断言表达不了 |
|---|---|
| `anim-window-done.test.ts`（T-0008 不得再有 `waitFlags` 镜像字段 / T-0014 `Engine` 不得再挂测试专用门面） | 命题是**"某形态不得存在"**——没有运行期可观测物；且文件已**剥注释**再查，所以"改注释"不会假红。反方向（改名绕过）是这类判据的已知上限，已在文件头写明 |
| `op-22a-22f` 的**体账**用例（对 `engine/…_utf8.c` 做配平取体 + 断言体内算子） | 判据是**外部真源（反编译器）**，不是我们自己的文案 —— 这是"防照筛体旧说法抄一遍"的唯一机器办法 |
| `audit-report-completeness.test.ts`（报告 §6 必须列全批次/票号；归档 JSON 的 kept/dropped/unclear 计数） | 判据是**审计交付物本身的完整性**（T-0075 的产出就是那份报告与三份归档 JSON）；"行为"在这里没有对应物 |

⇒ §「本票剩余」第 2 行（6 个文件里的源码正则/日志文案判据）**到此清空**：5 处改行为、1 处删（由更强的体账覆盖）、
1 处放宽、1 处改内容、1 处保留并写明理由。第 1 行（镜像实现 ~15 处）与第 3 行（重复覆盖）见 `T-0129`。
