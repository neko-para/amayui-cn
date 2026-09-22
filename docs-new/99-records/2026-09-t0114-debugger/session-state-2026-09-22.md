---
kind: record
state: consumed
superseded_by: tickets/T-0102/evidence/chapter-chain-runtime-trace.md
---

> ★按本工程的文档模型，**历史区一律 `state: consumed`**（结论已落台账/票据，本文件只作"当时的快照"）。
> 因此**要接着干请以这些为准**：白底 → `tickets/T-0102/evidence/chapter-chain-runtime-trace.md`
> （轮 19 的实机取证；本文件里那条"SCJUMP 把 6 盖成 1"的因果**已被它订正**）；
> 调试器 → `tickets/T-0114/notes.md` + `tickets/T-0114/changes.md`；贴边 → `tickets/T-0040/ticket.json` 的 `history`；
> 性能 → `tickets/T-0115/ticket.json`。本文件的价值是**把它们串成一条时间线**（含"当时未证"的部分）。
>
> ★★**2026-09-23 订正（只此一句，正文按"当时的快照"保留）**：本文件 §"T-0102"里的
> 「`SCJUMP` 执行 `mov (global-int 0) 1` 把 6 盖成 1」**因果不成立** —— 轮 19 用 `tools/dbg.cjs`
> 在真运行上实测：跑的是 `src/SCJUMP.txt`（不是 `$1$SCJUMP.txt`），门读 `13d7`/`13d8`
> （不是 `1dd7`/`3318`/`1521`/`2f3c`），而那句 `mov` 是**选中"还没演过的 G0001 节"的正常动作**。
> 见 `tickets/T-0102/evidence/chapter-chain-runtime-trace.md`。

# 会话中间状态记录（2026-09-22）

> 用户要求「记录所有中间状态到文档，暂时不继续研究」⇒ 本文件是**交接件**：把本会话**已证 / 未证 / 待办**
> 三态一次写清，并指明每一项的权威落点。**凡结论都带可复算落点**；凡推断都标「候选/未证」。

---

## 0. 一句话状态

本会话做了**三件事**，其中第 1 件只完成到"根因定位"（**未修**），后两件**已交付并实测**：

| # | 事情 | 状态 |
|---|---|---|
| 1 | `T-0102` ADV 窗口"白底" | **根因已定位到唯一一处写点，未修**；渲染/纹理/`0x259` 三项已排除 |
| 2 | `T-0114` 把控制面板做成调试器 | **第 1、2 步已交付**（查询 + 条件断点 + 事件断点 + lldb 风格命令台 + **adb 式后台守护进程**），**未做 E4 真界面复验** |
| 3 | `T-0040` macOS 窗口贴边 | **已修并实测通过**（32px 判定） |
| 附 | `T-0115` verify 太慢 | **已开票**，未动实现 |

---

## 1. `T-0102`：ADV 窗口"白底"（**未修**，根因已收敛）

### 1.1 权威状态
见 **`tickets/T-0102/evidence/STATUS.md`**（本会话整理的权威件，含 A–I 九节）。
其余两份证据是它的支撑：`texture-slot-identity.md`、`clear-slot-records-root-cause.md`。

### 1.2 当前结论（一句话）
**窗口模式选择子 `global 0` 被覆盖成 1。** `SC0000` 已把它**正确写成 6**（诊断实测
`写 global0 ← 6 @SC0000.BIN ip=972`），随后 `SN0000` 结尾的**章节推进链**
（`ALLMAP` → `SETADVFLAG` → `SCJUMP`）在 `SCJUMP` 里执行了 `mov (global-int 0) 1`，把 6 盖成 1
⇒ 窗口例程 `eq local0, global0, 6` 判假 ⇒ 走"白纸窗"支。

### 1.3 已**彻底排除**的三项（各有实测证据）
| 项 | 判据 |
|---|---|
| 纹理槽配置 | 槽 `0x11` 全程 `0x5260`（`SO001.AGF` 已解码）；全库 564 个 BIN 里 `draw-texture` 引用槽 17 共 2670 次、十进制 11 共 **0** 次 |
| 占位块 | 日志里 `未绑定纹理槽 → 占位块` / `纹理未就位` **各 0 条** |
| `0x259` 清槽记录 | 清的**不是** imgid 而是**标志两位**（引擎逐位复核）；emulator 曾**清反**（多清 imgid、漏清标志）——**已修 + 上锁，但它不是白底的成因** |

### 1.4 未决（下一轮的唯一问题，三选一）
这条链在此时**会不会被真机执行**：
- **(a)** `SCJUMP` 本就不该跑 ⇒ 查触发者：`ALLMAP` 的 `b22a` 门（`src/ALLMAP.txt:35`）、`SN0000:2227` 一带的分支；
- **(b)** 链该跑但四个门量在真机取值不同（`1dd7`/`3318`/`1521`/`2f3c`）⇒ **需要真机 oracle**；
- **(c)** 真机之后还有一步把 6 写回（全语料只有 `SC0000:1292` 写 6，已实测在本链**之前**）。

★关键分叉：`1dd7` 唯一写点 `src/SC2560.txt:1282`、`3318` 唯一写点 `src/GAMESTART.txt`（下标 701）
在 emulator 里**都没执行**；两份真槽（78/79）的池里 `int[0] = 6`。

### 1.5 本会话在 T-0102 上**未做**的事
- **没修**（等 (a)/(b)/(c) 定下来）；
- **没做 E4 真界面复验**；
- 源码里仍留着 **5 处临时诊断**（`arithmetic.ts`/`gfx-texture.ts`/`save-slot.ts`/`control.ts` 的 `[T-0102 诊断]`）
  —— **收尾时必须撤**。

---

## 2. `T-0114`：控制面板 → 调试器（**已交付 1+2 步**）

### 2.1 权威状态
`tickets/T-0114/notes.md`（提案与评估）+ `tickets/T-0114/changes.md`（**7 次变更全文**）。

### 2.2 现在能用的东西（实测过）
```
npm run dbg:srv                      # 起 adb 式后台守护进程（长期活着）
node tools/dbg.cjs --ping            # → pong / game=true
node tools/dbg.cjs global 0          # 只读查询（解码后的值 + 原始编码值）
node tools/dbg.cjs run / frame / local 1 / slot 0x11
node tools/dbg.cjs 'b event global-int-write idx == 3318'   # ★"任何写 global 3318 都停"
node tools/dbg.cjs 'b global 0x11 == 5260'                  # 条件断点
node tools/dbg.cjs bl / c / d 1                             # 列表 / 继续 / 删
node tools/dbg.cjs --quit
```
控制面板侧同样是一套 **lldb 风格命令台**（单输入框：`b` / `b event` / `bl` / `d` / `c` / `?`，其它一律当查询）。

### 2.3 关键设计（都已写进代码注释）
1. **暂停 = `await` 一个 Promise 门**（`#breakResume`）—— ★绝不能同步阻塞 IPC（会冻死渲染进程自己的控制通道）；
2. **「继续」= 放行同一条指令**（`#breakSkipOnce`），否则点继续也不动、像死锁；
3. **条件断点查在 `stepOnce` 之前**；**事件断点落地在 `stepOnce` 之后**（事件发生在同步函数内部，只能"同步记录 + 之后 await"）；
4. **命中/列表用推送**而非 invoke（暂停是持续态）；
5. **事件名按池命名**（`global-int-write`/`global-float-write`/`global-str-write`/`slot-bind`）—— 依据见 §2.5；
6. **面板不复制**渲染窗的命令表（跨编译单元复制合法值清单，守卫**钉不住**——已踩过一次）。

### 2.4 未做 / 待办
- **E4 真界面复验**：整条通路（命令台 → 断点 → 暂停 → 查询 → 继续）**没在真界面上点过**；
- **第 3 步（内存快照/恢复）未开工**；提案 §4 的三个未决项（范围 / 表达式语法 / 快照安全点）用户未裁决；
- 引用池（`ptr`/`floatPtr`/`strPtr`）**不发事件**（"引用变更"≠"值变更"，属后续）。

### 2.5 顺带核定的引擎事实（可复用，别再重推）
| 层 | 模型 | 依据 |
|---|---|---|
| **操作数层** | **扁平 variant**：操作数 = `(type tag, 4B)`，tag 写在指令流 `-4` 处 | `sub_41BF50` 的 `switch(v3)` |
| **运行期存储层** | **按类型分池**：8 个池基址（3 值池 + 3 引用池 + `_alt`） | `analysis/fields.json`：`pool_int 0x5D800` / `pool_float 0x5D808` / `pool_string 0x5D810` / … |

⇒ 「存 int 3318 再读 float 3318」**不冲突**（实测两池独立；写 int 3318 后读 float 3318 = 0）。
你记的 "cast" 发生在**同一 tag 内部**（`readIntOperand` 遇 `TYPE_GLOBAL_FLOAT` ⇒ 读 float 池再 `| 0`），不是跨池。

---

## 3. `T-0040`：macOS 窗口贴边（**已修并实测**）

**根因是时序，不是坐标系**：`main.cjs` 在**窗口还隐藏**时就 `setPosition`（`edgeOptions()` 传 `show:false`），
而 **macOS 会丢弃隐藏窗口上的 `setPosition`** —— Windows 碰巧容忍 ⇒ 表现为"只在 Windows 可用"。

实测（macOS，`workArea 1728x1084@(0,33)`，窗口 1280x752）：

| 动作 | 实际 bounds |
|---|---|
| 隐藏时 `setPosition(224,1085)` + `showInactive()` | `(224, **365**)` ← 没生效（用了居中 y） |
| 显示后 `setPosition(224,1085)` | `(224, **1085**)` ✓（1.2s 后仍是） |

**修法**（`electron/windows.ts` 的 `applyEdge`）：先摆一次 → `showInactive()` → **显示后再摆**（`setImmediate` + 300ms 兜底）。
★**不订阅 `move`**（那会把用户手动挪窗也拽回来）；日志只打最终那次。
**验证**：探针实测 `y=1085 = 期望`，屏幕内可见高度**正好 32px**。

---

## 4. `T-0115`：verify 太慢（**已开票，未实现**）

**实测基线**：`npm test` ~51.5 s（155 文件 / 1059 用例）；`typecheck` 三遍 + `check:dead-writes` 各 1–3 s。

| 文件 | 单跑 |
|---|---|
| `config1-chain.test.ts` | **48.8 s** |
| `keyboard-scenario-menu.test.ts` | **24.5 s** |
| `adv-name-color-chain.test.ts` | **19.6 s** |
| `game-start-chain.test.ts` | **14.4 s** |

四条合计 ~107 s 却只花 51.5 s 墙钟 ⇒ **并行互抢 CPU**。根因：这些 E3 用例各自**从真 BIN 重跑一遍链路**。
三条候选（共享 fixture / 分档 `test:deep` / 合并重复链路）在票里，**不许降低判据强度**。

---

## 5. 本会话产出的文件（可交付物清单）

**新增**
```
app/amayui-emulator/src/vm/debugQuery.ts                 只读查询（纯函数、白名单、不 eval）
app/amayui-emulator/src/vm/debugBreak.ts                 断点引擎 + 命令台解析（纯函数）
app/amayui-emulator/test/debug-query.test.ts             7 例
app/amayui-emulator/test/debug-break.test.ts            10 例
app/amayui-emulator/test/debug-event-break.test.ts       6 例（事件接线）
app/amayui-emulator/tools/debugsrv.cjs                   adb 式后台守护进程（TCP 127.0.0.1:39427）
app/amayui-emulator/tools/dbg.cjs                        外置 CLI（短连接）
app/amayui-emulator/test/clear-slot-records-keeps-bindings.test.ts   0x259 口径守卫（4 例）
tickets/T-0114/                                          调试器票（notes.md + changes.md）
tickets/T-0115/                                          verify 性能票
tickets/T-0102/evidence/STATUS.md                        白底权威状态
tickets/T-0102/evidence/texture-slot-identity.md         槽号身份判决
tickets/T-0102/evidence/clear-slot-records-root-cause.md 0x259 复核 + global0 时间线
```

**改动（主要）**
```
electron/main.ts            导出 windows / sendDebugQuery / sendBreakCommand（单例安全）
electron/ipc/control.ts     抽出可复用发送函数；调试查询/断点通道
electron/windows.ts         ★applyEdge：显示后再摆位（macOS 修复）
electron/preload.ts         +6 条通道（查询/断点/命中/列表）
src/frame/loop.ts           +onBeforeStep / +onAfterStepEvent（两个闸门）
src/renderer/app/session.ts 断点表 + 暂停闸门 + 事件钩子 + 命令台接线
src/renderer/ipcProtocol.ts BreakCommand 类型 + 通道声明
src/vm/engine.ts            debugEvent 钩子（按池命名的事件）
src/vm/operand.ts           写 int/float/string 各发对应池事件
src/vm/bits.ts              +f32（位模式→数值；★必须经 Int32 视图写入）
src/vm/handlers/gfx-texture.ts  两处绑槽发 slot-bind
control/{index.html,dom.ts,control.ts}  命令台（单一输入框 + 转录区 + 状态行）
package.json                +dbg:srv / +dbg
```

---

## 6. 仓库状态（供接手的人对齐）

- 最近提交：`2cdc1400 feat: debug sc0000`（**用户提交**）；其之前是 `765c481e feat: updates`。
- 本会话的改动**部分已暂存、部分在工作区**（`git status` 里 5 `A` / 4 `AM` / 17 `M` / 2 `MM` / 2 `??`）。
  ★**本会话未执行任何 `git add`**（用户明确要求）；暂存区里那批是用户自己操作的。
- `app/amayui-emulator/tools/{dbg,debugsrv}.cjs` 是**未跟踪**（新增件）。

---

## 7. 收尾待办（**留给下一次**，按优先级）

1. **`T-0102`**：定 (a)/(b)/(c) → 修 → E4 复验；**撤掉 5 处 `[T-0102 诊断]` 临时探针**；
2. **`T-0114`**：E4 真界面复验（命令台/断点/守护进程三条通路）；三个未决项裁决后再谈第 3 步（内存快照）；
3. **`T-0115`**：verify 提速（三条候选选一，给改前改后数字）；
4. 台账 `--validate` 现有 **9 条行号漂移警告**（都在本会话改动最多的 `loop.ts`/`session.ts`/`engine.ts`，
   锚点都还在、只是行号过期）——**故意没批量刷**（曾误伤 106 个文件后已撤销）；
5. `T-0004` 那条 `#onAdvanceWait` 在 `session.ts` 有 **3 处命中**、工具无法判断指哪一处 ⇒ 仍是可见警告（不猜）。
