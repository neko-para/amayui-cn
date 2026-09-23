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
