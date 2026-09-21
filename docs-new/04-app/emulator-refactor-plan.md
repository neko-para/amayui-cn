---
kind: narrative
state: live
---
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
   ★**设计已立项**：`emulator-frame-loop-design.md` —— 把这条展开成"1 份帧驱动 + 2 个宿主 + 观察者 + 场景脚本"，
   并给出「headless 与 Electron 完全一致」的**可执行定义**（G1 确定性 / G2 零 diff / G3 回放等价 / G4 观感）
   与 B1–B5 迁移批次。**B1 = 本文这一条**。
4. ~~**`assertFlags` 只在一侧**：契约"未知 flag 必须中断"仅 Pixi 成立，headless（所有棘轮的运行环境）永不暴露未知位
   ⇒ 下沉 `sc*` 前**先跑探针收集真实 flags**（否则 E2E 立刻红）。~~
   ✅**已完成**（第 9 轮 ⑫）：`assertFlags` 已下沉到 `scene/ops.ts:65,188`（`native.ts:34-38` 声明），
   pixi 侧只留纵深防御（`pixiBackend.ts:250,278,824-832`）。**本条为过期登记**（2026-09 帧循环差异清单 §4 复核确认）。
   ⚠️ 但**宿主能力面仍未入桥**：`needsRender`/`sceneAnimationsDone`/`preloadImage` 既不在 `NativeBridge`
   也不在 `withNativeTap` 白名单 ⇒ 这类缺口连闸门 A 都不记（见 `emulator-frame-loop-design.md` D6）。
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

## 10. 已登记的后继工作（本轮到 8/8 为止**未做**，按价值排序）

> 本清单是本轮治理的**交付物之一**：下面每一条都已定位到文件/函数与判据，不存在"知道了但没写下来"的项。
> 之所以不做：要么需要**行为变更**（必须先定清引擎语义）、要么规模超出"每步都能用三闸门验收"的安全粒度。

| # | 项 | 位置 | 为什么现在不做 | 建议判据 |
|---|---|---|---|---|
| 1 | 抽 `vm/frameLoop.ts`，先合并 headless 三家 | `src/report.ts:147-190`、`tools/config1Chain.ts:349-385`、`tools/gameStartChain.ts:386-424`（三份批上限/门策略各异；`run.ts`/`report.ts` 甚至没有 0x400/SLEEP 分支） | 五份实现行为有**实质分歧**，一次改五处无法用"快照零 diff"证明无回归 | 先合并 headless 三家：`scene-report.test.ts` 的快照文本逐字节不变；再单独一轮迁 `session.ts`（需 `npm run shot -- --gamestart` 目视）。★**已立项为 `emulator-frame-loop-design.md` 的 B1**（该文含 5 份循环的差异清单、`FrameHost`/`FrameObserver`/`Scenario`/`FrameDigest` 接口草案、G1–G4 判据与 B1–B5 批次） |
| 2 | draw-item 混合模式消费（`+0x30` → Pixi `blendMode`） | 消费者：`sub_4AEEA0`/`sub_4A2D50`（D3D 混合路径）；值已送达 `Item.blend` | **行为变更**：引擎的 `+0x30` 枚举语义（0/1/2…）尚未从源码逐值定清，猜映射 = 制造新缺陷 | 先读 `sub_4AEEA0` 的 SetRenderState 分支定枚举 → 映射 → `npm run shot` 对照淡出/叠加场景 → 从死写基线删 `Item.blend` |
| 3 | 拆 `handlers/msgwin.ts`（1338 行）→ style/number/query/chargrid 四文件 | 分节边界：76 / 434 / 634 / 737 / 816 | 纯搬移但量大，`MSGWIN_OPS` 与两个测试的手抄分类要同步 | `registry-tables.test.ts`（两两不相交）+ `adv-msgwin`/`op-a2-a3` 全绿、条数不变 |
| 4 | `mk()` 17 变体参数化统一 | 17 个 `test/*.test.ts`（差异维度：查表集合/帧来源/返回形状/native 默认/是否带 InputManager） | 差异是**真实需求**，需先设计参数面，否则会把不同语义抹平 | 先在一份 `test/harness.ts` 里给出 `makeHarness({tables,frame,native,input})`，逐个文件迁移，`npm test` 条数不变 |
| 5 | ✅**已办（`tickets/T-0021`，2026-09-21）** ~~消 A1 分层违规（`arch → vm`）~~ | 原违规点：`src/arch/nodeFileSource.ts:20`、`electron/ipc/files.ts:18` 反向依赖 `vm/saveData.js` | 已按本条建议执行：`vm/saveData.ts`→`src/save/saveData.ts`、`vm/saveSlot.ts`→`src/save/saveSlot.ts`、`vm/crc32.ts`→`src/util/crc32.ts`（`src/save/` 为叶子层）；`SlotStateBlock.adv` 由 `import('./advState.js').AdvStateJson` 改成**不透明** `unknown` | **已兑现**：`src/arch/` 里 `../vm/` 引用 **0** 命中；3 个 tsconfig 干净；`save-data`/`overlay`/`save-slot*` 全绿；新增棘轮 `test/layer-direction.test.ts`（3 条，辨别力已用临时文件机械证明） |
| 6 | 消 A2 真循环（`vm/engine.ts ⇄ vm/handlers/msgwin.ts`） | `engine.ts` 需要 `styleOfWin`（本轮用别名 `winStyle` 标注了意图） | 需先把 `styleOfWin`/`WinGeom` 下沉到 `vm/msgwin-style.ts`（与 #3 同一批做最省事） | `tsc` + `char-reveal`/`adv-msgwin` 全绿；顺带删掉 `winStyle` 别名 |
| 7 | `engineValues` 内联字面量收尾（60 处+） | `handlers/frame.ts`(26)、`handlers/engine-fields.ts`(19)、`handlers/msgwin.ts`(17)、`handlers/audio.ts`(12)… | 多数是**单文件内部**的临时字段，命名前需先确认语义（否则是猜） | 按子系统推进（先 frame、再 audio），每批 `npm test` + 快照零 diff |
| 8 | ✅**已办（`tickets/T-0022`，2026-09-21）** ~~跨包边（A4/A5）~~ | ~~`src/opcodes.ts` → 仓根 `scripts/asm/opcodes.json`；`electron/ipc/files.ts` → `scripts/agf/format.js`~~ | **待核项已核**：`npm run build` **不报** TS6059（`tsc -p tsconfig.json` exit 0；`--listFilesOnly` 里当时只有仓根那一份 JSON）。但那个跨包**输入**会破坏产物布局（旧 `dist/opcodes.json` 逸出 `dist/tsc/`，其说明符从 `dist/tsc/` 出发解析不到）⇒ 按本条建议做包内生成物 | **已兑现**：`scripts/asm/build-opcodes.js` 同一次写出 `scripts/asm/opcodes.json`（真源）**与** `app/amayui-emulator/src/generated/opcodes.json`（包内副本）；`src/opcodes.ts` 改 import 副本；`npx tsc --listFilesOnly` 里只剩包内那一份、fresh build **无逸出文件**；棘轮 `test/opcode-json-sync.test.ts`（2 条）。★A5（`scripts/agf/format.js`）**保留跨包并已登记理由**：`tsconfig.electron.json` 本就为它设 `rootDir: "../.."` + `allowJs`，且它由 esbuild 打包（非 tsc 输入）⇒ 无需副本 |
| 9 | ✅**已办（`tickets/T-0022`，2026-09-21）** ~~孤儿文件：仓根 `age_map_src.mjs`、`dist/tmp_scan.js`、`dist/tmp_trace.js.map`~~ | 仓根 / `dist/`（gitignored） | 无自动闸门；删之前要确认无人手动跑它 | **已兑现**：`age_map_src.mjs` **早已不存在**（陈旧条目）；`dist/tmp_scan.js`、`dist/tmp_trace.js.map`、`dist/tmp_scan.js.map` 三个陈旧 scratch 已删；全仓 `grep tmp_scan|tmp_trace` 零引用 |
| 10 | 留帧的**续期语义**：`0x1F6 clearDrawContainer` 现在把预算**重置**成 `HOLD_MAX_FRAMES=60`（`Math.max`），而不是"沿用剩余" | `src/renderer/pixiBackend.ts` 的 `clearDrawContainer` / `#holdFrameAfterCurtainDrop` | 第 9 轮把它从"解除"改成"续期"就已修掉可见缺陷；改成"沿用剩余"是**策略微调**，需要实跑对比才敢动 | `npm run shot -- --gamestart` 逐帧日志里"撤幕 → 清容器 → 建新幕"链上 `跳过本次 present` 的次数不增加；`.tmp` 截图无闪烁 |
| 11 | mesh 的 alpha 混合选择子消费（`entry[9]` = `0x322` 的 op2 → Pixi `blendMode`） | 消费者：`sub_49E390`（raw 119370-119399 的 SetRenderState 19/20/171 分支）；值已落 `MeshObj.blend` | 与 #2 同族：**行为变更**，枚举语义未逐值定清；语料该参数恒 0（默认）⇒ 画面零差异 | 同 #2；完成后从死写基线删 `MeshObj.blend` |
| 12 | ✅**已修（第 11 轮 ㉑，本行保留作溯源）** ~~SE「先装载后起播」错序~~（用户报「点『ゲーム開始』音效不对」的真因）：`0xB4` 的装载是**异步**（IPC 取字节 + `decodeAudioData`），而 `0xB5` 的起播是**同步**读 `c.clip` ⇒ 通道上还绑着上一次装载的音效时，`i0b5` 会用**旧 clip** 起播，新音效解码完却因 `pending == null` 永不发声 | 修法：`src/audio/audioEngine.ts` 的 `seLoad()` 加 `if (c.clip && c.clip.id !== id) c.clip = null;`（一行，已落）；对照：语音路径 `voicePlay()`（:331-349）早就有 `loading` 保护。引擎侧语义 = **同步**：`sub_420B00`（raw 29678-29687）→ `sub_4B4F60`（raw 137630-137658）→ `sub_4B6570` 先释放旧缓冲（raw 138906-138908）再绑新缓冲（raw 138925）；绑定失败抛 `WAVファイル %s の読み込みに失敗しました`（raw 137649） | **已兑现**：单测 `test/audio-engine.test.ts`「同一通道换装不同 id」（去掉该行即红：`14755 !== 50`）；E4 `.tmp/amayui-emulator.log:1261 [audio] SE ch1 起播 id=20963`（修复前 `id=50`）。剩余偏差登记见 §9 ㉑ 的"未收敛" | 复现脚本 `.tmp/repro-se-race.mts`、分析报告 `.tmp/se-51e3-analysis.md` |


- 🚫 把 `docs/**`、`app/amayui-emulator/docs/**` 的旧文档搬进 `docs-new/`：权威声明已宣布它们作废；
  只允许"在旧文顶部加作废提示 + 指向 `docs-new/`"（本 README 的快速导航已加）。
- 🚫 为行数而拆 `handlers/{audio,gfx-item,control}.ts`：同族内聚，拆散后跨文件跳转变多、收益为负。
- 🚫 让 `vm/` 直接引用 `renderer/audio` 的实现：桥接口是唯一通道（分层铁律，见架构总览 §3.1）。
