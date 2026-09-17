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

## 9. 变更记录

- 2026-09（`tickets/T-0057`，**emulator 实现审计与治理**：`npm run verify` 全绿 **603 pass / 0 fail**（612 条，含新增 8 条守卫））：
  跨层只读审计（VM 核心 / opcode handler / 渲染宿主 / 入口与工具 / 支撑子系统）把问题归成**四类同型病**并逐条落进
  本票的 `notes.md`（A 多处真源、B 魔法下标、C 临时补丁、D 重复实现、E 死码/假注释，共 80+ 条，含未实施的后继项）。
  本轮实施的是"能被守卫机械拦住"的那一半：
  - ★**R3（真 bug）**：`0x1F5` 把 raw 的**字节**偏移 `429756/429752` 当 `engineValues` 键，而 `0x1F4` 用的是
    dword 下标 `107439/107438`（同一对格）⇒ 帧计数只增不减、停靠锁永不释放、引擎时钟字段**冻在第一帧**。
    改为 dword 下标常量；守卫 `test/engine-field-ids.test.ts`（i1f4×2 → count=1、i1f5 递减到 0 释放锁、此后 i1f4 恢复刷时钟）。
  - ★**R2（单一真源）**：`engineFieldIds.ts` 升格为 `ENGINE_FIELD` 常量表（60+ 字段，逐条带语义/写者/读者），
    `src/vm/**` 的 **68 处裸字面量键清零**；新增 ratchet 守卫（再出现裸数字键即红）。
    顺带删掉 `ENGINE_FIELD_STORE` 里的死 spec（`0x107` 的 `map:{2:-1}`）、`field < 0` 分支与无人使用的 `after` 钩子。
  - ★**R1（配置键单一真源）**：`configRegistry.ts` 新增 `CFG` 键常量 + 动态键白名单 + 加载期自检；
    修掉三个**幽灵键**（raw 里 0 次）：`set:keepmusicvoice`→`set:KeepMusicVolume`（判据 `== 1`，raw 29769）、
    `set:cancelmessagekey`→`set:CancelMesSkipOnClick`、`set:controldisibiecursor`→`set:ControlDisibleCursor`；
    新增 `cfgBool/cfgEquals` 到 `engineConfig.ts` 并删掉 handler 里两份私有 INI 取值副本；
    守卫 `test/config-keys.test.ts`（静态扫 `section:key` 字面量，**先剥注释**）。
  - **R4（静默错值）**：`0x106/0x201` 从"恒写 0"改为读 `Engine[550]` / `Engine[166964]`（DrawMode），
    表 `ENGINE_FIELD_GET`；`0x53/0x54` 改回 **C 截断语义**（`-5 % 3 = -2`）且除零统一抛错（原来 div 静默 0、mod 静默 NaN、random 抛）。
  - **R5（临时物/死码）**：删 `src/tools/t0042c-colors.ts`（T-0042 的一次性探针）；LZSS 两份实现合一到 `src/util/lzss.ts`；
    删 `ScriptReset`（`new` 0 处的死信号）及其驱动/4 个测试分支与 `StopReason='reset'`；`stubs.ts` 的 7 个死 switch 分支；
    一批零引用导出（`FACE_MAP`/`DEFAULT_FAMILY`/`defaultFamilyOf`/`SAVE_SUBDIR`/`affineLerp`/`idClassOf`/
    `PANEL_FIELD`/`AUDIO_VOLUME_MAX`/`ENGINE_MSG_HWND_FIELD`）、悬空注释与 `void` 假引用；
    `gameStartChain` 的 `pumpFrames` 接回 `GameStartResult.hoverLeaveFrames`。
  - **R6**：修掉预红项（`T-0054`/`T-0056` 的 evidence 指向 `.tmp/` ⇒ 临时目录一清测试就红）——证据改锚仓内文件
    （`tickets/<ID>/notes.md`），并按棘轮刷新 `T-0031`/`T-0057` 的漂移锚点。
  - **R7**：`analysis/fields.json` 补 `frame_tick_lock`/`frame_count`（字节 429752/429756）；`opcode-table.md` 的
    `0x54/0x1F4/0x1F5/0x201` 行加订正注；看板重建。
  - **未实施（已定位，见 `T-0057/notes.md`）**：最高杠杆是 **6 份 headless boot 装配收敛**（两份 chain 不装 SAVE.DAT ⇒
    E3 走的支与产品不同）与 **脏位/present 单一真源**（A1–A4：Pixi 私有 `sceneDirty` 与共享 `SceneState.dirty`
    各一份、`drawCgNumber` 等 7 个 op 漏标脏、presenter 二次推进动画窗、headless 脏位永不被消费）。

- 2026-09（`tickets/T-0046`，`0x100` 的「默认键」分支 —— 用户报「CHARMEDIT 右键无反应」）：
  - 症状：`CHARMEDIT`（ADV 右侧菜单打开的编辑界面）真机可右键关闭，emulator 下右键无反应、只能点底部「閉じる」。
  - 根因（脚本侧读通了才定位到 VM）：脚本**收到了**右键（`local a` 的 bit1 被置上、抬起时确实走到关闭路径
    `label_00001820`），但关闭被 `jcc (local b)` 挡回。`local b` 是"有键按住"标志，只由 `joy-callback c` 清 0；
    而槽 `c` 不是物理键 —— `src/SYSTEM4.txt:86` 的 `i0fe c` 把 `Engine[517]`（SetKeyTotal）设为 12，`0x100`
    在**输入掩码为 0** 时要拿 `Engine[517]` **当下标**查 `joy-callback` 表、跑「默认键」处理器
    （raw 25050-25062）。emulator 把这条分支写成了"无输入就落回" ⇒ 默认键处理器永不运行 ⇒ `b` 恒 1。
  - 修复（`src/vm/handlers/input.ts` 的 `op_input_dispatch`）：① 掩码为空 ⇒ 用 `Engine[517]` 当下标派发；
    ② 掩码非空的扫描上界收到 `[517]`（raw 25029-25037）；③ **两条分支都压返回点**（raw 25039-25040 / 25052）
    —— 此前非空分支也没压，handler 末尾的 `ret` 会落进 handler 的下一句。`Engine[517]` 初值 7 按 Input 构造
    （`sub_477DD0` raw 92385）建模。
  - 守卫 `test/input.test.ts`：合成用例（空掩码 ⇒ 跳 `joyJump[SetKeyTotal]`、bit≥上界不派发、压返回点）
    + CHARMEDIT 端到端（SetKeyTotal=12 ⇒ 右键关闭并离开 `CHARMEDIT.BIN`；=7 ⇒ 被 `jcc (local b)` 挡回）。
    真启动链实测 `Engine[517]=12`。`npm run verify` 全绿（563 测试）。
  - 同轮发现、当时**不改**：`0xCD` 的节流间隔 `Engine[429812]` 其实由 `mouse-callback`(0xCC) 的 op1 写入
    （`sub_453A60` raw 66101-66113，旧注"全工程无写入"漏了它）⇒ 真机 `mouse-callback 10`（**十六进制** = 0x10）= **16ms**、
    `32`（= 0x32）= **50ms**。当时 emulator 的 `advanceThrottle` 恒 0 ⇒ 已单独开单 **`T-0047`**（见下一条记录）。

- 2026-09（`tickets/T-0047`，`0xCD` 的节流间隔落地：真机 16ms / 50ms 两档）：
  - 修复：`op_mouse_callback` 把 op1 写进 `InputManager.advanceThrottle`（`slot > 0 ? slot : 1`，对齐
    `sub_453A60` 的 `a2 ? a2 : 1`）。★操作数是**十六进制**：全语料 50 个登记 `mouse-callback` 的脚本分两档 ——
    `10`（= 0x10 = **16ms** ≈ 一帧）29 个（TITLE/CHARMEDIT/SAVE/CONFIG1/ALLMAP/HISTORY…）、
    `32`（= 0x32 = **50ms** ≈ 20fps）22 个（GAMESTART/ROOM/MMODE/FIELD/SHOP…）⇒ 两类的输入轮询率本来就不同。
    `advActive`(`0x8000000`) 的 OR 短路只让 ADV 路径旁路节流（这一点也把 0xCD 的旧注一并订正了）。
  - 守卫侧的连带修正（**不改断言**，只让虚拟时钟真的走）：`test/title-exit.test.ts` 的 `run()` 现在把
    `sleep n` 也计入虚拟时间（引擎 `sleep n`(n<10) = `Sleep(n)` ms，raw 30288）；`test/route-dispatch.test.ts`
    判据⑦b 在直接调 0xCD 前把 `nowMs` 推过窗口，并断言 `0xCC → advanceThrottle === 0x10`；
    `test/input.test.ts` 的 CHARMEDIT 用例同样按 1ms/指令推进时钟，并断言节流值。实测：打开节流后失败的
    正是这几处（外加 **T-0035 的一条证据锚点悬空** —— 旧 `docs/font-build.md` 已被 6cf11a79 的旧 `docs/` 清理删掉，
    锚点改指 `tickets/T-0035/notes.md` 的同段内容）。
  - 文档：opcode-table 0xCC/0xCD、input-system §6a/§7b、capability `adv-input-pump-perframe` 都从"已知偏差"改成"已建模"，
    并写明 headless 守卫"冻结时钟 ⇒ 派发消失"这个坑。

- 2026-09（第 12 轮，四张 P2 收口 + 两条新票）：
  - ★**`T-0010` report 的门档**：`reportLoopOptions()` 抽成可导出纯函数；`anim`/`sleep` 由 `'ignore'` 改为
    `'wait'`（引擎语义）**并给门分支记帧**（`0x400`/`sleep` 分支本帧不派发、只有时钟前进，raw 21109-21152）
    —— 漏记即"永远到不了 `sleepUntil`"（实测挂死）。守卫 `test/scene-report.test.ts`（含"阈值陷阱"：
    report 自己的帧边界阈值 4096 ≠ 驱动的 `maxStepsPerFrame` 1）。script 0 的 `frames/clockMs` 修前后**逐项一致**。
  - ★**`T-0012` CLI 守卫**：`run.ts` 加"仅直接执行才跑 `main()`"守卫并把驱动口径抽成 `runLoopOptions()`
    ——修前它无条件跑 `main()`，**测试连 import 都会把 CLI 跑起来**（这就是守卫一直没补的真实卡点）。
    守卫 `test/run-cli-loop.test.ts`（6 条：C1 时钟/C3 顺序/C4 服务与 ADV/`STEPS` 逐条/与 `PRODUCT_FRAME_POLICY`
    的棘轮/子进程冒烟）。`STEPS=300` 输出逐字不变。
  - **`T-0014` 死代码**：①–③（`interpreter.run()` / `HeadlessScene.waitFlags` / `PixiBackend` 镜像）已在
    B1/`T-0008` 落地；本次删掉 `Engine.pickHoverLabel()`（门面挪到 `test/harness.ts` 的 `pickHoverLabel(e)`，
    44 条断言一条不丢）+ 源码棘轮（`test/anim-window-done.test.ts`）。
  - ★★**`T-0017` 混合选择子**：`DrawItem+0x30` / `MeshEntry[9]` / 场景默认（`Scene+1260`）**同一套 4 值枚举**
    （`1` 加算 / `2` 门控覆盖 / `3` REVSUBTRACT / `0` 默认），值 2 的门控 = "当前渲染目标槽的纹理创建模式 == 1"。
    **补齐两条此前完全没实现的指令**：`0x20D set-render-target`（语料 841 处）、`0x33F set-scene-blend`；
    `0x1F8` 的 op4（`CTexture+1048`）也进模型。宿主侧 `pixiBackend.installD3DBlendModes()` 注册
    `d3d-opaque=[ONE,ZERO]`、`d3d-rev-subtract=[…FUNC_REVERSE_SUBTRACT]`（★Pixi 内建 `'none'` 是 `[0,0]` =
    **画黑**，实测踩过）。闸门 C 基线清空。守卫 `test/blend-mode.test.ts`（10 条含"指令→模型→混合档"端到端）。
    ★实施中发现"引擎 blend state 会泄漏"这条读法与真机可见行为**矛盾**（照做会把 TITLE 的 logo 透明区写成黑）
    ⇒ 默认按真机可见行为，泄漏档完整保留在 `BlendWalkOptions.leakStateAcrossEntries`（默认 false），
    另开 `T-0041` 追踪"合并段入口由谁重设 blend 状态"。
  - **`T-0039`（新，tooling）**：闸门 C 的 `countAccess` **不剥注释** ⇒ 一句文档注释就能让棘轮静默失效
    （研究 `T-0017` 时实测踩到并复现；已加复现输出）。
  - **`T-0040`（新，tooling，done）**：测试期窗口**贴屏幕下缘**打开（只留标题栏）+ `skipTaskbar` +
    `showInactive()` 不抢焦点（`AMAYUI_WINDOW_EDGE` 档位；`shot`/`record` 默认开启，`--centered` 可关）；
    纯几何在 `src/arch/windowPlacement.ts`，守卫 `test/window-edge.test.ts`（5 条）。

- 2026-09（`tickets/T-0037` + `T-0038`，逐字显现的两处引擎语义落地）：
  ① **注音随本文词末字显现**：引擎把注音记录 push 在本文词**最后一个字**的 24B 记录之后、并给该记录标
     `[+0]=1`，显现 `do { 贴 } while (上一记录[+0])` ⇒ 一步 = 本文末字 + 它的注音
     （raw 83988-83997 / 72427-72435）。模型侧新增 `TextLine.ruby[].from`（= 末字在本行里的序号）与
     `visibleRubyInLine`；`renderer/text/raster.ts` 用它替换旧的「该行有 ≥1 字就把整行注音画出来」
     （用户实测的"逐字期间注音提前出现"）。
  ② **行距参与换行步进**：换行 = 字号 + `Font+1380`（`sub_46AF90` raw 82674-82690；初值 6、`i08b`/0x8B 写，
     ADV 标准前导 `i08b 10` = 16 ⇒ 46px）。新增 `MsgWinStyle.lineSpacing`（`globalTextStyle` 读
     `engineValues[21669]`）⇒ 注音不再压上一行（用户实测）。顺带订正语义错：`Font+1380` 曾被记成
     「第四色 `color_extra2`」、opcode 表的 `0x8B` 只写「消息窗字段」（`fields.json` 改名 `line_spacing`、
     `functions.json` 补 `0x8B`/`0x46AF90` 两条、`adv-text-rendering.md` 与 `engine-capabilities.json` 的
     `text-line-pitch-font-1380` 同步）。守卫：`test/text-layout.test.ts`（行距 46/36 + 「注音顶 ≥ 上一行底部」
     不变量 + 注音随末字可见）、`test/engine-field-store.test.ts`（`0x8B` → `globalTextStyle().lineSpacing`）。
     注音 y 同时按引擎补了非 D3D 路径的 `+1`（`sub_465A20`）。
- 2026-09（`tickets/T-0024`，`npm run verify` 全绿 498/498）：**`0x400` 等待门的真值落地**
  （`sub_407E20` = 池挂起位 + `0x238` 装载的等待计时器）—— `Engine.gatePending/serviceWaitGate/skipWaitGate`
  + `gateWaitStart/gateWaitMs/scenePending/sceneFreeze`；`0x238` handler 改名 `op_load_wait_timer`（旧名
  "画布尺寸"无依据）；`FrameHost.animationsDone?(nowMs)` → **`poolPending?()`**（宿主只报池挂起位），
  `scGateAnimationsDone`（只看窗 0）**删除**，改为 `scPoolPending`（5 窗，**排除 `DrawItem+720` bit0**：
  `sub_49AA30` raw 117843-117844）；`0x242` 现在真的写 `+720`。E3（真实语料逐门驻留）：装了 `i238` 的门
  waited == 脚本值（SN0000 的 5500/100/2000/200 ms）；序章 `SN0000.txt:1048` 那道门驻留 100 ms，旁边就是
  80 000 ms 慢推 + `i242 f8023 1`（这才是它不钉住门的原因）；版权页 5 s 是 mesh 颜色窗而非计时器。
  残余缺口（46516 的立即变换/3D 槽 setter 来源、门等待期输入跳过、冻结的绘制期收尾）见 `T-0024/notes.md` §6.3。
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

- 2026-09（第 10 轮 = 用户第二批 4 条反馈的**修复轮**，npm run verify 全绿 **387/387** + E4 实跑复核；
  本轮**未动暂存区**——工作区里既有本轮修复、也有第 2–8 轮遗留的重构 hunk，按"重构不进暂存区"的约定
  宁可整体不暂存，避免把重构混进暂存）：
  ⑰ **"逐字像几个字一起蹦出来" → 文字节拍不该补拍**：旧实现用"整段预算追赶"（budgetMs + carry，
  一帧把欠的字全补出来 ⇒ 首次加载字体那种长帧一次冒十几个字）。引擎是"推一个字 → Sleep(MessageSpeed)"
  （GDI raw 13954 / D3D raw 13958）⇒ **一次一个字、卡帧不补**。已把 RevealState 收敛成
  intervalMs = max(message:MessageSpeed, 一帧) + nextAt，删掉 budgetMs/carry/lastAt 与两条分支
  （vm/msgwin.ts 的 beginReveal/tickRevealWin）。守卫：test/option-font-speed-menu.test.ts 的
  "每字节拍定律"三条 + char-reveal 的"不补拍"用例。
  ⑱ **转场后 ADV 文字残留 → 0x1F7 detach-texture 也要清窗**：引擎里屏幕上的字**就是** Scene 的
  DrawItem（正文行 id = 行号 + win+104，0x213 登记；注音/另一组在 win+276，0x25D 登记），
  脚本清字的手段就是按区间删项（$1$SC0330.txt 整个文件 **0 次** i071/i301，换场只做
  detach-texture 19a28 1f4 + 1a9c8 64 —— $1$SC0330.txt:18117-18119，44 处 call label_000407c0 调起）。
  emulator 的文本另有载体（msgWins）⇒ 已给 MsgWinInput 加 itemRanges（emitWin 从窗对象的
  +104/+108、+276/+280 取）、SceneState.msgRanges、scDetachTexture 里"区间相交 ⇒ scMsgWinClear"
  （与 scClearDrawContainer 的 scMsgWinClearAll 同一条思路）。守卫：test/adv-msgwin.test.ts 的
  "0x1F7 删正文区间 ⇒ 字消失"（含"不相交区间不得误清"的反例）。
  ⑲ **0x73 的语义订正（本轮最大发现）＝ ▼「点击继续」图标精灵表**：它不是"文字逐字的单位"。
  ADV = SO000.AGF(0x5191、350×35、10 帧 35×35) 经 SYSTEM4.txt:40 装进槽 12、SYSTEM4.txt:41 配网格；
  序章/NOVEL = SO026.AGF(0x5190、448×112)。主循环 raw 20887-20895 每 op10 ms
  sub_45A940(Font, 当前窗, k, 0) 贴第 k 格、k = (k+1) % op9 ⇒ 视觉上的"闪烁 ▼"；
  目标 = (op2 + 窗框 x, op3 + 窗框 y)（ADV win1 实测 (890+190, 110+557) = (1080,667)）。
  已实现：Engine.serviceCharGrid（每 tick 换格 + 重新发布）+ MsgCellFrame 走 msgWinSync 到宿主 +
  pixiBackend.#cellSprites（取槽贴图、按格裁剪、画在最上层 CELL_LAYER=1e7）。
  ★连带修正：文字逐字不再受 0x73 影响（0x72 的 beginReveal 不再传字格参数）；revealedOf 的字格例外
  保留但**改写注释**（引擎那侧的门来自 sub_45BE20 泵，不是字格门 —— 不许再扩大它的解释范围）。
  守卫：test/char-reveal.test.ts 的 ▼ 用例。
  ⚠️未收敛（E4 待核）：序章 i073 8 0 -5 c 0 0 38 38 8 64 的源矩形 (0,56,56×56) 是给 **SO026**
  （448×112 两行）写的，而序章进场时槽 12 里可能是 SYSTEM4 绑的 **SO000**（350×35 单行）⇒ 越界
  （引擎 ddCpySpriteSurfaceFast raw 48997-49014 会裁空）⇒ **序章可能本来就没有 ▼**；普通 ADV 场景
  （win1 槽 12 = SO000、格 35×35）才会在 (1080,667) 出现。需要真机截图对照。
  ⑳ **ADV 右侧侧边栏"无条件展开" → 悬停派发从未实现**：引擎 sub_403E70（raw 9918-9955）是
  **按游标变化**发 label 的两段式状态机（先发旧项的 [359+i]=离开、下一帧发新项的 [259+i]=进入），
  调用点在等待泵 sub_411BC0 raw 20322-20337。SN0000 的侧边栏就是靠它：SN0000.txt:63（侧边栏条
  x=1180..1280）labelA = 展开、SN0000.txt:66（全屏热点）labelA = 收起。
  已实现：RouteTable.nextHoverLabel（含 hoverLatch/pendingEnter）+ Engine.pickHoverLabel +
  session 的 #runHoverLabel（保存 {ip, retStack, awaitingAdvance} → 越界哨兵跑完 label → 还原，
  ⇒ 悬停**不推进页、不重播**）。E4 实测：光标移到侧边栏条 ⇒ 展开（hover-label 0x30e）；
  移回文本区 ⇒ 收起（hover-label 0x38e，截图 .tmp/gsFix13-9/10）。守卫：test/adv-msgwin.test.ts
  的"两段式"与"悬停不得推进页面"两条。
  ⚠️登记：SN0000 的悬停 label 会 call label_00000320 **重新登记热点** ⇒ 表在悬停中增长（14→33→40）。
  引擎也是同一张 100 上限的表，但"该由谁复位"尚未从源码定清；未到上限前无可见差异，登记为后继核查项。
- 2026-09（第 11 轮，`npm run verify` 全绿 **404/404**：原 402 + 新增 2 条 SE 换装用例）：
  ㉑ ★**SE「先装载后起播」错序已修**（§10 #12；用户报「点『ゲーム開始』音效不对」的真因）：
  `0xB4`→`seLoad` 是**异步**装载（IPC 取字节 + `decodeAudioData`），紧随的 `0xB5`→`sePlay` 是**同步**
  读 `c.clip` ⇒ 通道上仍绑着**上一次**装载的音效时，`i0b5` 播的是旧音效，而新音效解码完因 `pending`
  已被忽略而永不发声。修法**一行**：`seLoad()` 里 `c.loadedId = id;` 之后加
  `if (c.clip && c.clip.id !== id) c.clip = null;`（同 id 重复装载仍命中缓存、不引入延迟；换装不同 id
  改为"解码完再响"）。引擎语义依据（源码已核）：`0xB4` handler `sub_420B00`（raw 29678-29687）→
  `sub_4B4F60`（raw 137630-137658）→ `sub_4B6570` **先释放该通道旧缓冲**（raw 138906-138908）
  **再绑新缓冲**（raw 138925）⇒ `0xB5` 执行时通道上必定已是新音效（无缓冲则 `sub_4B6020` 报
  `dsPlay(%d)` 返回 0，raw 138605-138612）。**取证与判据**：
  - 单测 `test/audio-engine.test.ts`「同一通道换装不同 id」——**已验证"去掉该行即红"**（实测
    `14755 !== 50`，正是用户听到的症状）；另加一条"同 id 重复装载仍同步起播"防过度修正；
  - E4（`npm run shot -- --gamestart --name seFix`，`.tmp/amayui-emulator.log`）：点 TITLE 的
    Game Start `:870 (1180,372)` → `:884 -> GAMESTART.BIN` → **`:897 [audio] SE ch1 起播 id=50`**
    （修复前是 `id=14755`）；点「ゲーム開始」`:1242 (811,605)` → `:1256 createMesh h=0x30d40`
    （= `GAMESTART.txt:1317`，证明确在 `label_000050b8`）→ **`:1261 [audio] SE ch1 起播 id=20963`**
    （修复前是 `id=50`）→ `:1272 -> INITGAME.BIN`（= `GAMESTART.txt:1338`）。ch2 的悬停音
    `id=14755` 保持正确。
  ★**「路由走到错误分支」的旧判断被推翻**：`0xB4` 的**意图**（op1 = `0x51e3`）从头到尾都是对的
  （`test/game-start-chain.test.ts` 判据⑥ 断言的就是意图，一直通过）—— 错的只有**起播用的 clip**。
  连带订正两处注释错误：`src/tools/gameStartChain.ts:112` 与 `test/game-start-chain.test.ts:291`
  把 `0x51e3` 写成 `SE004.WAV`（实为 **SE009.WAV** = id 20963；`SE004` = `0x2e` = 46）。
  **量级（下限）**：全库 941 脚本里「装载→紧随同通道起播」1936 对，其中 **799 对换装不同 id**
  （涉 **379** 脚本）⇒ 修复前 UI 确认音会系统性播成"上一个装到该通道的音效"。
  **未收敛**：① SE009 的**听感**是否就是玩家记得的那个只能人耳确认（本次只证明"脚本要 20963、
  修复前实际播 50"）；② `AMAYUI_RESOURCE_DIR=raw` 未复核（id 表来自 `SYS4INI.BIN`，汉化补丁不动它，
  风险低）；③ 「装载失败 ⇒ 不响」的严格 1:1（引擎抛 `WAVファイル %s の読み込みに失敗しました`
  raw 137649 vs 这里降级为静音 + `pending` 兜底）仍是**刻意的偏差**；④ `seLoad` 成功不写日志 ⇒
  "日志里对不上装载 id / 起播 id"要另配脚本，未加日志行。
  分析报告：`.tmp/se-51e3-analysis.md`（只读分析代理产出，含资源解析/解码/路由/时序四类假设的排除凭据）；
  台账同步：`analysis/scripts.json` 的 `GAMESTART` 补 SE 通道与统一 id 事实、"点击路径自身不发 SE"不变量、
  "SE 通道跨脚本常驻"坑，并回链 `docs-new/03-engine/sound-system.md`。
- 2026-09（第 12 轮，`npm run verify` 全绿 **415/415**）：
  ㉒ ★**新增外置选项文件 `emulator.config.json`**（用户要求：跑回归/截图时省掉 LOGO 版权页的无意义等待）：
  目前**只有一个开关** `boot.showLogo`（boolean，默认 `true` = 真游戏行为）。`false` ⇒ 启动时预设
  `_this[96983] = 0`（`load-show-logo` 0x130 的字段，`sub_42F7A0` raw 39346 读；`src/SYSTEM4.txt:144-146`
  据此 `jcc` 直接落到 `:149 INIT` / `:150 TITLE`）。**这不是自造旁路**：LOGO 自身的 `exit`（`exit-script`
  `sub_428A60` raw 35207 置 0）与 GAMEOVER 回标题走的**就是**这条路径。实现：纯解析/套用在
  `src/emulatorOptions.ts`（**刻意不 import `node:fs`** —— 渲染进程按 esbuild `platform:'browser'` 打包），
  node 侧读取在 `src/emulatorOptionsFile.ts`（`AMAYUI_EMULATOR_CONFIG` 可换路径），Electron 走
  IPC `read-emulator-options`（主进程只读文本、渲染侧解析）。接入点：`run.ts`、Electron `boot.ts`
  （`loadEngineOptionsFile`，必须在 `loadScriptData` 之前）、`report.ts` / `gameStartChain` / `config1Chain`
  的 **CLI 入口**。★**库调用一律 `opt.emulatorOptions ?? DEFAULT_EMULATOR_OPTIONS`**：测试结果绝不能
  取决于开发机上的一个 JSON（守卫：`test/emulator-options.test.ts` 的"库入口不得 import node-only 读取模块"
  + `test/game-start-chain.test.ts` 断言默认仍经过 LOGO）。**实测收益**（`.tmp/measure-logo.ps1`，
  两次 `npm run shot -- --gamestart` 对比）：TITLE 之后第一帧的 renderer 时钟 **6333ms → 922ms**
  （省 ≈5.4s），wall **41.5s → 37.0s**；日志里 `-> LOGO.BIN` 消失、GAMESTART/SN0000 照常到达。
  ⚠️ 刻意的近似：真机播 LOGO 时 `SYSTEM4` 的 `ip0..143` 会跑两遍（LOGO 的 `exit` 重载根脚本再跑一遍），
  预设 0 时只跑一遍；实测链路完整（E3 断言仍到达 SN0000 首文案 ip=901）。
  ㉓ ★**修 #1「切界面后按钮停在 hover 态」**（根因是 `0xFB joy-callback` 的**索引偏移**）：
  旧实现把 op1 当**按钮序号**存到 `4 + op1`，而引擎存的是 `_this[33*cur + 107725 + op1]`（`sub_421B80`
  raw 30417）、读的是 `_this[33*cur + 107725 + 掩码位]`（`sub_419AF0` raw 25042）—— **中间没有 ±4**。
  后果：**鼠标左键 = 掩码位 4**（`sub_477150`；`sub_477280` raw 91661 的 `1 << (btn+4)` 是手柄）被派发到
  `joy-callback 0` 的 handler；TITLE/GAMESTART 的 `joy-callback 0` 是**行确认**（`label_00000c58` →
  `3f7 = 3f8` → `call label_000049d0`），于是每次点击进入一个界面就把该界面**第 0 项**的**高亮贴图**
  画上屏（GAMESTART 的 handle `0x44c`，正常态是 `3e8/3e9/3ea`）⇒ 用户看到的"按钮处于 hover 态"，
  来回切换 ⇒ 两个界面的第 0 项都亮。**取证**（TEMP-DIAG 仪器化一次 Electron 跑，已撤）：日志里
  `detachTexture h=0x44c` + `configureDrawItem h=0x44c layer=1100 (523,75,209x73)` 出现在
  **整个 GAMESTART 期间唯一一次 `0x12E`（x/y=(811,605)）之前** ⇒ 高亮**不是**命中测试画的；
  且 `0x12E` 全程只跑过一次。修法一行：`joyJump[op1] = target`。守卫：`test/op-a5.test.ts` 的
  "掩码 bit4（鼠标左）⇒ `joyJump[4]`" 用例（旧实现会跳到 `joyJump[0]`）。E4：`joyFix-6-gamestart.png`
  三个按钮**全部为正常态**（修复前 `ゲーム開始` 是青色高亮态）。
  ㉔ ★**修 #2「ADV ▼ 图标被提前显示」**：`serviceCharGrid` 的 `isRevealing()` 门只挡住了"换格/起算节拍"，
  而 ▼ 的**存在与否**由 `emitWin` 载荷里的 `cell: cellFrameOf(...)` 决定 —— 逐字期间
  `serviceTextReveal → #publishReveal → emitWin` 同样会带 `cell` ⇒ 宿主立刻把 ▼ 画上屏（E4 日志
  `[reveal] win=8 1/52` 紧跟着 `[cell]`）。引擎侧依据：文字泵 `sub_45BE20` 在等待泵里**自旋到整页显完**
  （raw 13847/13863/13907/13920 的 `while (!sub_45BE20(...))`），主循环的图标分支 raw 20887-20895
  永远是"泵已返回 true"之后才轮到。修法：把门加在 `cellFrameOf`（**唯一判决点**）：
  `if (e.msgwin.isRevealing()) return undefined;`。守卫：`test/char-reveal.test.ts` 的
  "显到一半 ⇒ 载荷里仍不得有 cell"（已验证去掉该行即红）。
- 2026-09（第 7 轮：**帧循环统一 B1–B5**，`npm run verify` 全绿 476/476）：
  设计 = `emulator-frame-loop-design.md`（§6.1 有五批的落地结果表）；**逐批证据在 `tickets/T-0001`..`T-0005` 的
  `changes.md`**（本文件不重复）。要点与它对本清单的影响：
  ① **B1** 抽 `src/frame/{host,loop}.ts` 唯一帧驱动，headless 三家先接上（零行为变更，G2 = report 全文 sha256 不变）；
  ② **B2** 14 条漂移工单逐条落定（门统一、模型推进成宿主契约、`waitFlags` 粘滞拆除、`scAnimationsDone` 拆分…）；
  ③ **B3** headless 补齐能力面：音频帧泵归驱动（`T-0006`）、`needsRender` 脏位进共享模型、输入源 ⇒ 悬停真的跑（`T-0007`）、
     **`FrameDigest`**（逐帧对外表现的量具）；
  ④ **B4** Electron 迁到驱动：`session.ts` 从"第 5 份帧循环"缩成 **装配 + 观察者 + `yield`**（`#present` 三拆）；
     **G3 通过**（Electron 录 3047 帧 → headless 逐帧 engine 段相等）、**G4 关键行不变**；
  ⑤ **B5** 一份 `ScenarioSpec` 两宿主共用 + `npm run record/replay` 一键 G3；`emulator.md` §7.1 新增**闸门清单**。
  ★**G3 顺带修掉三处"不报错、只表现不对"的真分叉**（细节见 `T-0004/changes.md`）：
  mesh 的窗末收尾原本只在 pixi 的 `present` 里（⇒ 移进共享 `scAdvance`）、
  `FrameDigest.nowMs` 的舍入污染了回放时钟（⇒ 不舍入）、
  pixi 的**帧保持**判据用过期 `clockMs` 调 `calcDiffuse` ⇒ 给共享模型的动画窗锁了早一帧的起点（⇒ 改成无时钟判据）。
  **本清单 §10 的 #1（帧循环）到此收口**；§2 的"同一语义两处"里与帧序/门/推进相关的条目也随之关闭。


## 10. 已登记的后继工作（本轮到 8/8 为止**未做**，按价值排序）

> 本清单是本轮治理的**交付物之一**：下面每一条都已定位到文件/函数与判据，不存在"知道了但没写下来"的项。
> 之所以不做：要么需要**行为变更**（必须先定清引擎语义）、要么规模超出"每步都能用三闸门验收"的安全粒度。

| # | 项 | 位置 | 为什么现在不做 | 建议判据 |
|---|---|---|---|---|
| 1 | 抽 `vm/frameLoop.ts`，先合并 headless 三家 | `src/report.ts:147-190`、`tools/config1Chain.ts:349-385`、`tools/gameStartChain.ts:386-424`（三份批上限/门策略各异；`run.ts`/`report.ts` 甚至没有 0x400/SLEEP 分支） | 五份实现行为有**实质分歧**，一次改五处无法用"快照零 diff"证明无回归 | 先合并 headless 三家：`scene-report.test.ts` 的快照文本逐字节不变；再单独一轮迁 `session.ts`（需 `npm run shot -- --gamestart` 目视）。★**已立项为 `emulator-frame-loop-design.md` 的 B1**（该文含 5 份循环的差异清单、`FrameHost`/`FrameObserver`/`Scenario`/`FrameDigest` 接口草案、G1–G4 判据与 B1–B5 批次） |
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
| 12 | ✅**已修（第 11 轮 ㉑，本行保留作溯源）** ~~SE「先装载后起播」错序~~（用户报「点『ゲーム開始』音效不对」的真因）：`0xB4` 的装载是**异步**（IPC 取字节 + `decodeAudioData`），而 `0xB5` 的起播是**同步**读 `c.clip` ⇒ 通道上还绑着上一次装载的音效时，`i0b5` 会用**旧 clip** 起播，新音效解码完却因 `pending == null` 永不发声 | 修法：`src/audio/audioEngine.ts` 的 `seLoad()` 加 `if (c.clip && c.clip.id !== id) c.clip = null;`（一行，已落）；对照：语音路径 `voicePlay()`（:331-349）早就有 `loading` 保护。引擎侧语义 = **同步**：`sub_420B00`（raw 29678-29687）→ `sub_4B4F60`（raw 137630-137658）→ `sub_4B6570` 先释放旧缓冲（raw 138906-138908）再绑新缓冲（raw 138925）；绑定失败抛 `WAVファイル %s の読み込みに失敗しました`（raw 137649） | **已兑现**：单测 `test/audio-engine.test.ts`「同一通道换装不同 id」（去掉该行即红：`14755 !== 50`）；E4 `.tmp/amayui-emulator.log:1261 [audio] SE ch1 起播 id=20963`（修复前 `id=50`）。剩余偏差登记见 §9 ㉑ 的"未收敛" | 复现脚本 `.tmp/repro-se-race.mts`、分析报告 `.tmp/se-51e3-analysis.md` |


- 🚫 把 `docs/**`、`app/amayui-emulator/docs/**` 的旧文档搬进 `docs-new/`：权威声明已宣布它们作废；
  只允许"在旧文顶部加作废提示 + 指向 `docs-new/`"（本 README 的快速导航已加）。
- 🚫 为行数而拆 `handlers/{audio,gfx-item,control}.ts`：同族内聚，拆散后跨文件跳转变多、收益为负。
- 🚫 让 `vm/` 直接引用 `renderer/audio` 的实现：桥接口是唯一通道（分层铁律，见架构总览 §3.1）。
