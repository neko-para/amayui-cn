# 04-app · amayui-emulator 重构清单（活文档）

> 目标：**在不改变行为**的前提下，消除重复实现、拆掉堆积文件、给"魔法字段"和缺口一个统一落点。
> 硬约束：每一步之后 `npm run verify`（383 测试 + 3×tsc + 死写棘轮）必须全绿；**不许改变引擎语义**；
> 每条重构都必须能说清"改前/改后行为相同"的判据（测试名或 E3/E4 证据）。
>
> 生成方式：2026-09 架构审计（分层/重复/大文件/魔法索引/测试结构）+ 会话内实测。
> 状态标记：✅ 已做 ｜ 🔜 进行中 ｜ ⬜ 待做 ｜ 🚫 明确不做（有理由）。

## 0. 总原则

1. **真源不搬家**：语义只允许活在 `analysis/*.json`（事实）与 `src/**`（实现）里；文档是叙述/生成物。
2. **一处语义一处实现**：同一引擎语义若在两个宿主（`headlessScene` / `pixiBackend`）各写一遍 ⇒ 必须下沉到 `renderer/scene/ops.ts`。
3. **拆文件只按"职责断了"来拆**：有独立数据 + 独立测试面才拆；纯粹为行数拆会把 import 图搅乱。
4. **注释里的"语料 0 处"不是"语义不重要"的证据**（血泪教训：`i07a` 实际 520 处，曾据"0 处"把
   文本块原点当无关参数 ⇒ 序章文字跑到左上角，见 `handlers/msgwin.ts` §消息窗对象 的注释）。

## 1. 大文件与拆分边界（实测行数）

| 文件 | 行数 | 现状职责 | 建议拆分（按已有分节边界） | 风险 |
|---|---|---|---|---|
| `src/vm/handlers/msgwin.ts` | **1338** | 5 段：文本状态→渲染层(76) / 字格逐字(434) / 未实现族(634) / 窗对象参数(737) / P0 参数面(816) | 拆成 `handlers/msgwin-text.ts`(76-433)、`msgwin-chargrid.ts`(434-633)、`msgwin-obj.ts`(737-815)、`msgwin-style.ts`(816-1338)，`msgwin.ts` 只留注册表 + 转出 | 中（纯移动 + 注册表改 import；测试面已厚） |
| `src/vm/msgwin.ts` | **803** | `MsgWindow` 类 = ADV 状态 + 内容槽 + 逐字显现 + 窗几何/样式视图 + 对象表 | 拆 `msgwin-reveal.ts`（`RevealState`/`beginReveal`/`tickRevealWin`/`revealedOf`，~200 行）与 `msgwin-style.ts`（`WinGeom`/`FontStyle`/`defaultWinStyle`） | 中 |
| `src/renderer/pixiBackend.ts` | **716** | 宿主桥接线（~40 个方法）+ 脏标记 + 纹理/音频/HUD 转发 | 把"纯转发"方法按族拆到 `pixi/bridge-*.ts`（gfx / text / audio / input），`pixiBackend.ts` 留生命周期 + present | 中低 |
| `src/vm/engine.ts` | **624** | 引擎态（`engineValues` + 强类型视图）+ 每帧服务（reveal / ADV / gate） | 把 `serviceTextReveal` / `serviceWinReveal` / `serviceAdv` / `serviceAdvanceWait` 抽到 `engine-frame.ts`（它们已有独立分节注释） | 中 |
| `src/vm/saveData.ts` | **556** | 容器 + 表 + CRC + Crypt + LZSS 调用 | `lzss.ts`/`crc32.ts` 已独立；可再抽 `saveFlags.ts`（FileDB 使用位图块） | 低 |
| `src/vm/handlers/audio.ts` | 399 / `gfx-item.ts` 395 / `control.ts` 374 | 单族 handler | 暂不拆（同族内聚，拆了反而碎） | 🚫 |

## 2. 重复实现 / 漂移风险（同一语义两处）

| 语义 | 位置 1 | 位置 2 | 判据与建议 |
|---|---|---|---|
| 桥方法接线（几何/颜色/纹理/文本/音频） | `src/renderer/headlessScene.ts` | `src/renderer/pixiBackend.ts` | 两者都必须调用 `scene/ops.ts` 的 `sc*`；**差异只允许是"宿主能力"**（纹理/音频/DOM）。建议加一条测试：对同一串指令序列，两个宿主的 `scSnapshot` 除宿主专属字段外**逐字段相等**（现在只靠人工纪律） |
| 日志格式（`h=0x… ${outcome}`） | `headlessScene.ts` 的 `outcome()` | `pixiBackend` 的 `#pushLog` | 文案各自手写 ⇒ 会漂移（同一 op 两边日志字段不同）。建议把"日志载荷"也放进 `sc*` 的返回值 |
| 引擎字段下标字面量 | `engine.ts`（`21668`/`122466`/`80101`/`107704`…） | `handlers/msgwin.ts`、`handlers/engine-fields.ts` | 实测只有 **6 个**数字出现在 `engineValues.set/get` 调用点（其余已走 `ENGINE_FIELD_STORE` 表）⇒ 收益小；**建议只把 MessageSpeed(21668)/竖排(80101)/字格模数(107705) 抽成常量**并加注释，不做大规模改造 |

## 3. 未消费字段 / 死写

- 基线 `dead-writes.baseline.json` = `Item.blend` + `MeshObj.blend`（引擎的**混合模式选择子**，D3D 侧消费者，
  Pixi 侧未接）。**建议接掉**：`Item.blend`(`+0x30`) / `MeshObj.blend`(entry[9]) 的引擎取值分支已在
  `rendering.md` §3.1 与 `sub_49E390`（raw 119370-119399）读清；接上后把两条从基线删除（闸门更严）。
- `MsgObject` 的 `f256/f260/f272/f264/f268`（`0x25E/0x25F` 写的颜色，语料 0 处）与
  `block224`（`0x25C`）—— 有读者但 emulator 未消费；**先保留**（属"对象属性面"，见 §0.4 教训），
  在能力台账里各登记一条（若尚未登记）。

## 4. 测试结构

| 问题 | 位置 | 建议 |
|---|---|---|
| 每个 handler 测试各自复制 `mk()`/`instr()`/`im()/str()` | `test/op-*.test.ts`、`test/char-reveal.test.ts` 等 ~10 个文件 | 抽 `test/helpers/vm.ts`（同一份 ctx 构造 + 指令构造），**只机械替换**，不动断言 |
| 时序相关断言依赖 `performance.now` 语义 | `test/option-font-speed-menu.test.ts`、`test/char-reveal.test.ts` | 已用显式 `nowMs` 参数 ⇒ 保持；新增测试一律显式传时钟，不 sleep |
| 棘轮分散在多个文件 | `registry-tables` / `game-start-chain` / `capability-*` / `script-ledger` / `no-dead-writes` | 保持分散但**在 `docs-new/04-app/emulator.md` §3.3 列表化**（已完成），便于"改完知道该跑哪些" |

## 5. 工具与入口

- `package.json` scripts 与 `src/tools/*` 已对应（`report`/`op:inventory`/`diag:text`/`shot`/`save:dump`/`boot:time`/`check:dead-writes`）。
- `gameStartChain.ts` / `config1Chain.ts` **只有库导出、无 CLI**（被 `op:inventory`/`diag:text` 复用）⇒ 属有意设计，🚫 不新增 CLI。
- `.tmp/*.mts` 探针是临时物（gitignore）⇒ 不进 `src/`，🚫 不迁移。

## 6. 分批执行

| 批 | 内容 | 判据 | 状态 |
|---|---|---|---|
| 批 1（机械、低风险） | ① `test/harness.ts` 抽公共 harness；② 字段下标抽常量；③ 未消费字段/注释订正 | `npm run verify` 全绿 + 无断言改动 | 🔜 部分完成（见 §8） |
| 批 2（中等） | ④ 接掉 `Item.blend`/`MeshObj.blend`（+删基线两条）；⑤ `handlers/msgwin.ts` 拆 4 文件 | `verify` 全绿 + `npm run shot -- --gamestart` 观感不变 | 🔜 部分完成（见 §8） |
| 批 3（结构性） | ⑥ `msgwin.ts` 拆 reveal/style；⑦ `engine.ts` 抽 `engine-frame.ts`；⑧ `pixiBackend.ts` 按族拆桥；⑨ 两宿主快照等价测试 | `verify` 全绿 + 新增 ⑨ 的等价测试 + shot 对照 | ⬜ |

## 8. 审计确认（2026-09 · 只读审计代理的实测结论）

**已在本轮修掉（文档/数据层一致性，非重构）**：
- ✅ **opcode-table.md raw 行号批量重算**：274 条 `sub_X（raw .c N）` 断言里 **60 条不符** ⇒ 已按"函数定义块"机械重算
  （脚本 `.tmp/fixOpcodeRawLines.mjs` 可复现、默认试运行；日志 `.tmp/opcode-rawlines-fix.log`；原始备份 `.tmp/opcode-table.md.orig`）。
  自检：剩余不符 0、表格行 `^\| 0x` 仍 **574**、CRLF 与行数不变、逐行 diff 只变数字。
  有意保留：5 条"调用点/体内引用"（如 `sub_40AAE0 raw 17687` 就是 `sub_40AAE0(...)` 调用行，引用本身正确）
  与 6 条范围断言（端点略越出块，改成定义行会破坏范围语义）。
- ✅ **SN0000 生成物漂移回填**：`SN0000.md` 曾被手改（三条 2026-09 结论）而真源 `analysis/scripts.json` 未更新
  ⇒ 已把三条写回 `analysis/scripts.json` 的 `SN0000.notes` 并重跑 `build-scripts.mjs`（现在生成物 = 真源投影）。
- ✅ **台账自相矛盾**：`engine-capabilities.json` 的 `clock-read-meshentry-color-window` / `vertex-buffer-lock-scale`
  两条 note 仍写"顶点几何未建模/全丢"，与同台账 `mesh-vertex-quad-and-per-vertex-color`（modeled-verified/E3）冲突 ⇒ 已订正并重生成。
- ✅ 过期测试数：`resource-loading.md`(12/12)、`flow-control.md`(24/24)、`app/docs/02`、`app/docs/06`、`docs/engine/README.md`
  ⇒ 统一标注为 380/380（实测）。
- ✅ 语义冲突：`adv-text-rendering.md` 的"逐行显现/逐行 blit"（同文件 §3.3.1 已订正为"一个字"）、
  `:315`/`:368` 的 0x303"行宽"（应为行中心/右缘）；`emulator-copyright-effect.md` 的"全屏黑覆盖层 Sprite"（与代码/E3 冲突）。
- ✅ 代码注释：`tools/opInventory.ts` 的"0x320 顶点几何未建模"、`handlers/frame.ts` 的"脚本队列未建模"
  （实际 `dispatchNextRequest` 已建模，只是 0x1F5 未接线）。

**审计新发现的真问题（待做，按优先级）**：
1. **A2 真循环**：`vm/engine.ts` ⇄ `vm/handlers/msgwin.ts`（成因：`engine.ts` 需要 `styleOfWin`）⇒ 批 2/3 用 `msgwin-state` 下沉解掉。
2. **A1 分层违规**：`arch/nodeFileSource.ts` → `vm/saveData.js`（I/O 层反向依赖 VM）；`electron/ipc/files.ts` 同。
3. **帧循环 5 份实现且实质分歧**（批上限 10000/5000/20000；`run.ts`/`report.ts` 无 0x400/SLEEP 分支；
   `run.ts` 的 text-reveal 判定顺序与其余相反）⇒ 抽 `vm/frameLoop.ts`（**先只合并 headless 三家，快照零 diff**）。
4. **`assertFlags` 只在一侧**：契约"未知 flag 必须中断"仅 Pixi 成立，headless（所有棘轮的运行环境）永不暴露未知位
   ⇒ 下沉 `sc*` 前**先跑探针收集真实 flags**（否则 E2E 立刻红）。
5. **`SceneState.render4`（12 字段）+ `blendWritten` 纯写不读**，且 `state.ts` 自称"报告可断言"但 `scSnapshot` 不导出
   ⇒ 二选一：导出进快照（让声明成真）或删除（与 §7 的"不做"一致：这些是 A4 记录族，信息有价值，倾向**导出**）。
6. **`Item.blend` 其实从未被送达**：`handlers/gfx-item.ts` 的 `0x203` 自述读 `op2=blend`，实际只读 op1/op3/op4
   ⇒ 基线说明"送达但无人读"不准确；应接上 op2（= 能力补齐，批 2/3）。
7. **测试侧手抄 opcode 分类**（`game-start-chain.test.ts`、`engine-config.test.ts` 33 条）与注册表无机械关联 ⇒ 抽 `test/opcode-kinds.ts`。
8. **`stubs.ts`**：`0xaf` 是唯一没有 raw 依据的条目（需回 .c 补依据或改注册）；另有一段悬空注释块与 4 个空分区标题。
9. **跨包边**：`src/opcodes.ts` → 仓根 `scripts/asm/opcodes.json`（`tsc --listFiles` 实证；`rootDir: src` 下是否 TS6059 **待核**）；
   `electron/ipc/files.ts` → 仓根 `scripts/agf/format.js`（已知妥协）。
10. **孤儿/残留**：仓根 `age_map_src.mjs`（无 npm script、import 已废弃的 `dist/script/*`）、`dist/tmp_scan.js`、`dist/tmp_trace.js.map`。
11. **opcode-table.md 的 raw 行号漂移**：274 条断言中 61 条不符（机械重算，已并行交给子代理处理）。

## 9. 变更记录

- 2026-09（第 1 轮）：建立本清单；完成 §8 的 ✅ 条目（数据层回填/计数/语义冲突/代码注释）；
  两个只读审计代理产出分层/重复/大文件/死写/测试结构/路线图六类结论（结论已并入 §1–§8）。
- 2026-09（第 2 轮，重构开始，全部 `npm run verify` 全绿）：
  ① **`effectiveIniText()` 下沉**到 `arch/systemPaths.ts`（原先 `tools/config1Chain` 与 `tools/gameStartChain` 逐字重复）；
  ② **DrawItem getter 三元组下沉**为 `scene/ops.ts` 的 `scGetDrawItemTexSlot/Pivot/Pos`（两个宿主各 1 行转发；原先两侧各写一份、写法都不同）；
  ③ **`engine.#publishReveal` 复用 `emitWin`**（载荷原先两处各写一遍；engine 侧只读样式改用别名 `winStyle`，等样式层下沉后删除）；
  ④ **`render4`（12 字段）+ `blendWritten` 导出进 `SceneSnapshot`**（兑现 `scene/state.ts` "报告/测试可断言"的声明；`snapshotToText` 仅在非空时打一行，避免空快照噪声）；
  ⑤ opcode-table raw 行号批量重算（60 条，见 §8）。
- 2026-09（第 3 轮，`npm run verify` 全绿）：
  ⑥ **抽 `test/harness.ts`**：14 个测试文件里的 `instr()`（11 份逐字相同）与 `im`/`str`（多份逐字相同）已替换为共享实现
     （判据：`npm test` 仍 **380/380**、条数不变、`tsc` 干净 —— 这是最硬的"没改行为"证据）。
     剩余：`mk()` 有 17 个变体（差异维度 = 查表集合 / 帧来源 / 返回形状 / native 默认 / 是否带 InputManager）⇒ 参数化统一列为下一步。
  ⑦ **`assertFlags` 下沉的前置探针（部分）**：`npm run report` 的最终快照里 `flags` 只出现 `0x1` 一种
     ⇒ 单点快照**不足以**证明"全链路从无未知 flag 位"（它只是最后一帧的状态）。要下沉 `assertFlags` 到 `scene/ops.ts`，
     必须先做**跨帧收集**（在 `scConfigureDrawItem`/`scCreateMesh` 里临时记录见过的 flag 位，跑 `npm run shot -- --gamestart`
     与 `npm run report` 各一次），确认无未知位后再下沉 —— 否则 headless E2E 会立刻红。本轮**未**下沉（宁可不做也不做错）。
  待做（按价值）：跨帧 flag 探针 → `vm/frameLoop.ts` 合并 headless 三家（判据：报告快照零 diff）→ `Item.blend` 送达+消费链路 →
  `handlers/msgwin.ts` 拆 4 文件 → `mk()` 统一 → 引擎字段常量表（92 处字面量）→ 消 A1/A2 依赖违规。
- 2026-09（第 4 轮，`npm run verify` 全绿）：
  ⑧ **`Item.blend` 送达链路已修**（审计 D4/3.3，源码已核）：引擎 `0x203` handler（raw 31448-31450）读
     **op1=handle、op2=blend、op3=α、op4=color** 并调 `sub_4ACF60(Scene, handle, blend, color)`，后者写
     `item+48 = blend`、`item+96 = color`（raw 131876-131880）。emulator 原先**只读 op1/op3/op4，op2 被静默丢弃**
     ⇒ `Item.blend` 恒 0。现已贯通：handler 读 op2 → `native.setDrawColorAlpha(handle, from, blend)`（3 参，
     pixi/stub 两个宿主同步）→ `applyDrawColorAlpha(it, from, blend)`。
     同时删掉重复记账的 `SceneState.blendWritten`（它是"是否写过"的影子表，`Item.blend` 才是真值）。
     **语料实测量级**：`set-draw-color-alpha` 共 7637 处，其中 op2 **非 0 的占多数**（`1` 1718 处、`f8025` 1243、`f8026` 796、`f8027` 426…）
     ⇒ 这不是"名义修复"：被丢掉的混合模式数量很大。
     ★**仍未消费**：渲染器还没把 `+0x30` 的取值映射到 Pixi `blendMode`（需先从源码定清引擎的枚举语义，属**行为变更**）⇒
     `Item.blend` 保留在 `dead-writes.baseline.json`，理由已更新为"已送达、渲染器未消费"。
- 2026-09（第 5 轮，`npm run verify` 全绿）：
  ⑨ **`messageSpeedOf` 唯一化**（审计 1.3）：`vm/engine.ts` 两处（`serviceTextReveal:433`、`serviceWinReveal:478`）
     与 `handlers/msgwin.ts` 一处曾各写一遍同样的
     `engineValues.get(21668) ?? cfgInt(config,'message:messagespeed',0)`；现已统一为
     `handlers/msgwin.ts` 导出的 `messageSpeedOf(e)`，engine 两处改为 `messageSpeedOf(this)`。
     ★语义上它就是**一个引擎字段**（`Font+1376` = `Engine[21668]`），三份回退中任何一份漏改都会让"显示速度"只在部分路径生效。
- 2026-09（第 6 轮，`npm run verify` 全绿）：
  ⑩ **`handlers/stubs.ts` 清理 + 0xAF 补依据**（审计 1.12 / D4）：该文件原有 **4 个空分区标题**
     （渲染/图形/图像/纹理、数据/资源登记、鼠标点击路径安全桩、声音）与一段**无指代对象**的悬空注释
     （"这一条确实未实现…"后面已经没有数组项了）。已删除并写明本表纪律："每条 `engine-internal` 都必须带 raw 依据"。
     `0xAF` 原先只写 `// 数据` ⇒ 本轮回 `.c` 读到**唯一一条"体内什么都不做"的指令**：
     `sub_419690`（raw 24775-24783）体内 = `result=_this[95776]; _this[30*result+95805]=1; return result;`
     —— 只置派发器的 arity 槽、不写字段/不回写操作数/不改 ip ⇒ 归 `engine-internal` **有依据**（注释已改为逐字引体）。
- 2026-09（第 7 轮，`npm run verify` 全绿）：
  ⑪ **建立引擎字段命名的落脚点** `src/vm/engineFieldIds.ts`（审计 D3 / 2.9 的第一步）：先收 8 个**跨文件共用、语义已由源码坐实**的下标
     （`FIELD_MESSAGE_SPEED=21668`、`FIELD_MSG_DEFAULT_WIN=21631`、`FIELD_VERTICAL=80101`、`FIELD_CHAR_CURSOR=107704`、
     `FIELD_CHAR_MODULUS=107705`、`FIELD_WIN_REVEAL_GATE=122466`(+win)、`FIELD_WIN_REVEAL_DELAY=122476`(+win)、`FIELD_WIN_REVEAL_DONE=122486`(+win)），
     每条都写明"语义 / 写入端 / 读取端"，并把 `vm/engine.ts`（游标 + 闸门 3 处）与 `tools/config1Chain.ts`（诊断直读 2 处）的字面量换成常量。
     ★范围说明：本轮**只做已坐实的共用字段**；审计点名的 92 处内联里，多数是**单文件内部**的临时字段
     （`handlers/frame.ts` 26 处、`engine-fields.ts` 19 处等），它们要么随拆分一起归位、要么等对应子系统建模后再命名 ——
     一次性全改会把"命名"变成"猜语义"，违反本工程"每条都要有源码依据"的纪律。
- 2026-09（第 8 轮，`npm run verify` 全绿 + 两条 E2E 复核通过）：
  ⑫ **`assertFlags` 下沉到共享层**（审计 2.3 / B 表"严格 flag 校验只在一侧"）——这是一条**真设计缺陷**：
     `native.ts` 的契约是"配置了不认识的 flag **必须立即中断**"，但原先只有 `PixiBackend` 调 `assertFlags`，
     而**所有 E2E 棘轮**（`game-start-chain`/`char-reveal`/`config1-chain`…）都跑 headless
     ⇒ 等于"报告/测试永远不会暴露未知 flag 位"。现在改在 `scene/ops.ts` 的两处建项点校验
     （`scConfigureDrawItem` 置 bit0 后、`scCreateMesh` 置 bit0 后），两宿主共用同一道闸；Pixi 侧原有调用保留（纵深防御）。
     判据（比单测更强）：① `npm test` **380/380**（这些用例就是 headless 路径，若任何地方出现未知位会立即抛
     `UnknownFlagError`）；② `npm run report`（CONFIG1 链路）正常出快照；
     ③ `npm run op:inventory -- --path start` ⇒ **到达 SN0000 = true、首文案 ip=901、路径上未实现 opcode = 0**。
     ⇒ 结论：全链路（TITLE→CONFIG→GAMESTART→SN0000）**确实不存在未知 flag 位**，"严格校验"现在对两条渲染路径都成立。
- 2026-09（第 9 轮 = 用户复测后的**修复收尾轮**，`npm run verify` 全绿 + E4 实跑复核；本轮属"修复"，
  已按用户约定**只把修复类改动放进暂存区**，重构类改动留在工作区）：
  ⑬ **进 SN0000 时背景闪一下 → 根因是 mesh 的"可见色"取错端点**：`calcDiffuse` 在"无动画窗"时
  （`!(flags & 2) || !anim`）返回 `state1`，而引擎的可见色是**顶点缓冲里那份**——
  `0x322`（`sub_426C20` → `sub_4AE2C0` raw 132816-132823）写 `entry[13]=state0` 后**立刻**
  `sub_4A2050(entry, 0.0)`（比例 0 = 纯 state0）刷进 VB；`0x323`（`sub_426CF0` → `sub_4AE330`
  raw 132834-132843）只置 bit1/delay/dur 与 `entry[14]=state1`、**不碰 VB**；窗末（raw 133531-133538）
  `state0 ← state1` 后再以比例 0 刷 VB ⇒ **state1 永远只是"目标"**。改成返回 `state0` 后，
  进场黑幕（state0=0xFF000000、state1=0）在"设色 → 开窗"之间保持**不透明黑**，与留帧中屏上那帧黑
  完全相同 ⇒ 无缝；随后 `setVertexColorAlpha` 的 3.6s 淡出照旧。守卫：`test/mesh-vertex-quad.test.ts`
  新增一条（未开窗/延迟期/窗末/窗末之后四个时刻）+ `[frame-hold]` 日志（`.tmp/amayui-emulator.log`）。
  ⑭ **文字在逐字出现前整页先亮一次 → 根因是"无显现状态 = 全部"被多处各自解释**：字格门（`0x73` 写的
  `win+88`）开着但 `0x72` 还没武装时，引擎**一个字都不贴**（`sub_45A940` 只在
  `effect_flags & 0x40000000` 分支里被主循环调用，raw 20887-20894）。而 `0x6E`/`0x6F`/`0x73` 都会
  `emitWin`，其中 `0x6F end-text-line` 是**纯转发**（不判门）⇒ 上一轮只在 `0x6E` 里发 `revealed: 0`
  的做法被它立刻覆盖成 −1。现把判决收敛到 `MsgWindow.revealedOf` **一处**：`0x300` 逐行泵与 `0x73`
  字格门并列成同一个"未武装/未推进 ⇒ 0 字"例外，`0x6E` 恢复为普通 `emitWin`。守卫：
  `test/char-reveal.test.ts` 新增一条（字格门 + `0x72` 武装 + 8 格节拍）。
  ⑮ **留帧解除判据与留帧上限**（emulator 侧策略，非引擎语义）：`createMesh` 原先无条件解除留帧，
  而"建几何（`0x320`）"与"设色（`0x322`）"是两条指令 ⇒ 批边界落在中间就会呈现一帧透明幕
  = 背景闪现。现改为 `#releaseFrameHoldIfVisible`（判据 = `calcDiffuse` 出的**当前**颜色 alpha > 0，
  与渲染同源），`0x1F6 clearDrawContainer` 不再解除（改为续期），上限 8 → 60 帧。
  实跑日志：`满屏幕布 0x30d40 被撤 → createMesh 0x19258 颜色仍透明 → setVertexColor 0x19258 → 新内容可见，解除留帧`。
  ⑯ **登记知识的落点**（本轮同步）：`analysis/engine-capabilities.json` 的
  `clock-read-meshentry-color-window`（partial/E1 → **modeled-verified/E3**，state0/state1 归属定案）、
  `mesh-vertex-quad-and-per-vertex-color`（z 序近似作废：presenter 已做三路归并）、
  `msgwin-char-reveal-grid`（补"武装前 0 字"）；`analysis/scripts.json` 的 `SN0000.notes` 补第 ④⑤ 条；
  `docs-new/03-engine/rendering.md` §4（"图在下、mesh 覆盖层在上"作废 + 留帧两处收紧）、
  `adv-text-rendering.md` §3.3（新增"武装之前屏幕上一个字都没有"两行）。
  **暂存边界**：修复类 6 文件进暂存区（`drawitem/eval.ts`、`vm/msgwin.ts`、`pixiBackend.ts` 6/9 hunk、
  `handlers/msgwin.ts` 1/5 hunk、两条测试各 1 hunk），重构类 hunk（`scGetDrawItem*` 下沉、
  `setDrawColorAlpha` 三参、`harness.ts` 迁移…）留在工作区；**用 `git stash push --keep-index` 单独
  验证过"暂存区快照"**：typecheck + **382/382** + 死写 ratchet 全绿 ⇒ 暂存区可独立提交。


## 10. 已登记的后继工作（本轮到 8/8 为止**未做**，按价值排序）

> 本清单是本轮治理的**交付物之一**：下面每一条都已定位到文件/函数与判据，不存在"知道了但没写下来"的项。
> 之所以不做：要么需要**行为变更**（必须先定清引擎语义）、要么规模超出"每步都能用三闸门验收"的安全粒度。

| # | 项 | 位置 | 为什么现在不做 | 建议判据 |
|---|---|---|---|---|
| 1 | 抽 `vm/frameLoop.ts`，先合并 headless 三家 | `src/report.ts:147-190`、`tools/config1Chain.ts:349-385`、`tools/gameStartChain.ts:386-424`（三份批上限/门策略各异；`run.ts`/`report.ts` 甚至没有 0x400/SLEEP 分支） | 五份实现行为有**实质分歧**，一次改五处无法用"快照零 diff"证明无回归 | 先合并 headless 三家：`scene-report.test.ts` 的快照文本逐字节不变；再单独一轮迁 `session.ts`（需 `npm run shot -- --gamestart` 目视） |
| 2 | draw-item 混合模式消费（`+0x30` → Pixi `blendMode`） | 消费者：`sub_4AEEA0`/`sub_4A2D50`（D3D 混合路径）；值已送达 `Item.blend` | **行为变更**：引擎的 `+0x30` 枚举语义（0/1/2…）尚未从源码逐值定清，猜映射 = 制造新缺陷 | 先读 `sub_4AEEA0` 的 SetRenderState 分支定枚举 → 映射 → `npm run shot` 对照淡出/叠加场景 → 从死写基线删 `Item.blend` |
| 3 | 拆 `handlers/msgwin.ts`（1338 行）→ style/number/query/chargrid 四文件 | 分节边界：76 / 434 / 634 / 737 / 816 | 纯搬移但量大，`MSGWIN_OPS` 与两个测试的手抄分类要同步 | `registry-tables.test.ts`（两两不相交）+ `adv-msgwin`/`op-a2-a3` 全绿、条数不变 |
| 4 | `mk()` 17 变体参数化统一 | 17 个 `test/*.test.ts`（差异维度：查表集合/帧来源/返回形状/native 默认/是否带 InputManager） | 差异是**真实需求**，需先设计参数面，否则会把不同语义抹平 | 先在一份 `test/harness.ts` 里给出 `makeHarness({tables,frame,native,input})`，逐个文件迁移，`npm test` 条数不变 |
| 5 | 消 A1 分层违规（`arch → vm`） | `src/arch/nodeFileSource.ts:20`、`electron/ipc/files.ts:18` 反向依赖 `vm/saveData.js` | 需把存档**纯格式层**移出 `vm/`（涉及目录决策） | `save-data`/`overlay` 全绿 + 3 个 tsconfig 干净 |
| 6 | 消 A2 真循环（`vm/engine.ts ⇄ vm/handlers/msgwin.ts`） | `engine.ts` 需要 `styleOfWin`（本轮用别名 `winStyle` 标注了意图） | 需先把 `styleOfWin`/`WinGeom` 下沉到 `vm/msgwin-style.ts`（与 #3 同一批做最省事） | `tsc` + `char-reveal`/`adv-msgwin` 全绿；顺带删掉 `winStyle` 别名 |
| 7 | `engineValues` 内联字面量收尾（60 处+） | `handlers/frame.ts`(26)、`handlers/engine-fields.ts`(19)、`handlers/msgwin.ts`(17)、`handlers/audio.ts`(12)… | 多数是**单文件内部**的临时字段，命名前需先确认语义（否则是猜） | 按子系统推进（先 frame、再 audio），每批 `npm test` + 快照零 diff |
| 8 | 跨包边（A4/A5）：`src/opcodes.ts` → 仓根 `scripts/asm/opcodes.json`；`electron/ipc/files.ts` → `scripts/agf/format.js` | `tsconfig.json` 的 `rootDir: src` 与跨出 rootDir 的编译输入 | 需先确认 `npm run build` 是否触发 TS6059（**待核**），再决定"生成物同步进 `src/generated/`" | `npm run build` 通过 + 3 配置 typecheck |
| 9 | 孤儿文件：仓根 `age_map_src.mjs`、`dist/tmp_scan.js`、`dist/tmp_trace.js.map` | 仓根 / `dist/`（gitignored） | 无自动闸门；删之前要确认无人手动跑它 | 手工 `Test-Path` + grep 引用 |
| 10 | 留帧的**续期语义**：`0x1F6 clearDrawContainer` 现在把预算**重置**成 `HOLD_MAX_FRAMES=60`（`Math.max`），而不是"沿用剩余" | `src/renderer/pixiBackend.ts` 的 `clearDrawContainer` / `#holdFrameAfterCurtainDrop` | 第 9 轮把它从"解除"改成"续期"就已修掉可见缺陷；改成"沿用剩余"是**策略微调**，需要实跑对比才敢动 | `npm run shot -- --gamestart` 逐帧日志里"撤幕 → 清容器 → 建新幕"链上 `跳过本次 present` 的次数不增加；`.tmp` 截图无闪烁 |
| 11 | mesh 的 alpha 混合选择子消费（`entry[9]` = `0x322` 的 op2 → Pixi `blendMode`） | 消费者：`sub_49E390`（raw 119370-119399 的 SetRenderState 19/20/171 分支）；值已落 `MeshObj.blend` | 与 #2 同族：**行为变更**，枚举语义未逐值定清；语料该参数恒 0（默认）⇒ 画面零差异 | 同 #2；完成后从死写基线删 `MeshObj.blend` |


- 🚫 把 `docs/**`、`app/amayui-emulator/docs/**` 的旧文档搬进 `docs-new/`：权威声明已宣布它们作废；
  只允许"在旧文顶部加作废提示 + 指向 `docs-new/`"（本 README 的快速导航已加）。
- 🚫 为行数而拆 `handlers/{audio,gfx-item,control}.ts`：同族内聚，拆散后跨文件跳转变多、收益为负。
- 🚫 让 `vm/` 直接引用 `renderer/audio` 的实现：桥接口是唯一通道（分层铁律，见架构总览 §3.1）。
