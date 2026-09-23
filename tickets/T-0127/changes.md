# T-0127 · 变更记录

## 第 1 次变更（2026-09-23）：命令词汇表单一真源 + 事件面扩展 + 控制台能力面 + Z3 零覆盖闭合

### 1. 命令表：3 份拷贝 → **1 份**（`src/vm/debugCommand.ts`）

原来有 **3 份**：`src/vm/debugBreak.ts` 的 `parseDebugCommand`（被测试守着，但**零生产调用者**）、
`control/control.ts` 的 if 链（真发货、无测试）、`tools/debugsrv.cjs` 的分流白名单（真发货、无测试）。
**后果已经发生**：面板的用户可见帮助写着**非法**事件名 `global-write`，而守卫测的是渲染窗那份 ⇒ 钉不住。

现在：

| 物 | 角色 |
|---|---|
| `src/vm/debugCommand.ts` | **纯词汇表**：`parseDebugCommand` / `EVENT_KINDS` / `DEBUG_COMMAND_HELP` / `DebugAction`。★**只 import 类型**，零引擎/渲染/DOM 依赖 ⇒ 两个编译单元都能安全引它（这是"不拖依赖"与"只有一份"能同时成立的关键） |
| `src/vm/debugBreak.ts` | 改为**导入 + 再导出**（既有 import 面不变） |
| `control/control.ts` | 删掉手抄 if 链，改用 `parseDebugCommand` + `DEBUG_COMMAND_HELP` |
| `tools/debugsrv.cjs` | **删掉分流白名单**：整行原样转发给渲染窗 |
| `src/renderer/app/session.ts` | 查询通道成为**唯一命令收口点**：先 `parseDebugCommand`，命令就地派发（`#applyDebugAction`），否则当查询 |

★顺带修好的用户可见缺陷：面板帮助里那个非法 `global-write` **消失了**（现在渲染共享常量）。
`tickets/T-0124` 与 `T-0127` 里"锚在这个非法串上"的证据点因此消失 ⇒ 按纪律 **retarget** 到共享真源上的同义串。

### 2. 守卫（`test/debug-break.test.ts` 重写那条源码棘轮）

原来只查**带引号**的 `'global-write'` ⇒ 真正漂移的那行（不带引号的帮助文本）**恰好漏掉**。现在：

- **单一真源棘轮**：`parseDebugCommand` 必须被 ≥3 处生产代码引用（提取+收口点+面板）；
- **面板**：剥注释后不得出现"同一行 ≥2 个事件类型"的手抄清单；必须引用 `DEBUG_COMMAND_HELP` 与 `parseDebugCommand`；
- **守护进程**：不得再维护命令白名单；
- **反向控制**：共享帮助文本必须列出全部合法类型，且**不得出现**笼统的 `global-write`。

### 3. 事件面扩展（`tickets/T-0124` §4.2 说的"能力面限制"）

| 新事件 | 落地方式 | 为什么这样做 |
|---|---|---|
| `engine-field-write` | `engineValues` 换成 `EngineFieldMap extends Map`，`set`/`delete` 即发事件（`removed` 区分删除） | 写点散在 handler / 配置灌入 / 读档恢复**十几处**，逐处加 `emitDebugEvent` 等于把"谁负责发事件"变成纪律；包一层 Map 则**任何**写入路径（含将来新增）都被覆盖，且 `Map` API 一字不改 |
| `local-int-write` | `writeIntOperand`（本帧 local int 的**唯一写门面**）里发 | 与脚本可见的 local 写一一对应 |

`matchEvent` 的事件参数映射同步扩了两类（`engine-field-write` ⇒ `idx`/`val`/`removed`）。
**测试**：3 条（写字段/删除各发一条且构造初值不算写、写 local int 的 `val` 是解码后的值、两类都能被事件断点条件命中）。
**证伪**：把 `EngineFieldMap` 的钩子改成 `null` ⇒ 对应用例红。

★踩坑记录（值得留给后来人）：`Map` 子类**不能** `super(entries)` —— 构造函数会逐条调 `this.set`，而 JS 私有字段
在 `super()` 之后才初始化 ⇒ `TypeError: Cannot read private member #onWrite`。改成先 `super()`、装钩子、再用
`super.set` 填初值（构造期不发事件，恰好也是想要的语义）。

### 4. 控制台能力面（宿主侧可观测）

`debugQuery.runQuery` 增**可选**第三参 `host: DebugQueryHost`（不传 ⇒ 行为与本票之前完全一致）：

- `slot <n>` 现在**两侧分开报**：VM 台账（`texSlots`/`texSizes`）+ **宿主侧**（`getSlotPixels` ⇒ "已就位 W×H"）；
  没注入时**明说**"本次未注入宿主查询"，不假装"没有"；
- 新增 `l2d <槽>`：报 Live2D 槽的模型 id / 纹理组数 / 当前动作（宿主侧 `l2dHost.l2dSlots`）。

渲染窗（`session.ts`）已注入这两个回调（`#pixi.getSlotPixels` / `#pixi.digestState().l2dHost`）。
★**诚实边界**：`runQuery` 侧有单测（1 条，含"不注入要明说"）；**`session.ts` 的注入本身没有测试**
（本工程没有 session 级 harness）⇒ 靠 typecheck + 该单测覆盖。这条缺口如实记在票里。

### 5. Z3 零覆盖闭合：`control/` 层的最小测试

审计的变异实测证明「删掉 `opHex` 的前导零 ⇒ 全量 1086 例无一红」。本票把 `opHex` 从
`control/control.ts`（模块加载即摸 DOM）挪到**不依赖 DOM/IPC** 的 `control/format.ts`，并补
`test/control-format.test.ts`：断言三位补零 + **反面控制**（`0xb5` / `0x5b` 不许通过）。
**证伪**：去掉 `padStart` ⇒ 该用例红。

⇒ 变异 `M13_ophex_padstart_removed` 从 `knownGap` **翻牌**成 `expectCatch`。**闸门 E 现在 14/14 全抓、0 登记缺口。**

### 6. 数字

| 口径 | 前 | 后 |
|---|---|---|
| 全量用例 | 1084 | **1088**（+3 事件面、+1 控制台） |
| 全量失败 / skip | 0 / 2 | **0 / 2** |
| `npm run verify` | 35.0 s | 40.5 s |
| 闸门 E | 13 抓 + 1 登记缺口 | **14 抓 + 0 缺口** |
| `control/` 层测试覆盖 | **0** | `test/control-format.test.ts`（1 例 + 反面控制） |
