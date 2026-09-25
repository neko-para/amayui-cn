# T-0163 · 过程文档（changes-c163.md）

> 本文件 = **2026-09-24 轮（T-0163「指令实现缺口修复批：桩 / native」）**的逐条处置 + 可照抄台账片段。
> 同目录 `changes.md` 是上一轮（`0x10c` P1）的记录，**不覆盖**。

## 0. 票面口径的一处**事实订正**（先读）

票面 `ticket.json` 现在是 **19 条（P1 1 / P2 3 / P3 15）**、`status=done`、`tests[]` 4 个文件，
而本轮派单给的清单是 **29 条（P2 7 / P3 22）**。核对结果：

- 29 条 = `app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` 的 `## T-0163` 节，逐行与该文件一致
  （`.tmp/p1-fix/p23-worklist2.mjs` 的 `FILE_TICKET` 把 `handlers/(stubs|agerc).ts` +
  `vm/native.ts` + `vm/nativeTap.ts` + `vm/stubNative.ts` 归给 T-0163）。
- 19 条 = 审计 `findings-final.json` 里 `batch==='stubs-native'` 的那一批（报告 §4.1 的批次号）；
  29 条 = 同一批 **＋ agerc 八条 ＋ 两条 `cap:` 行**（后者锚在 `stubs.ts`/`native.ts`）。
- 上一轮只做了 `0x10c`（P1）就把票置 `done`，`changes.md` 自己写着"其余 18 条不在本次范围，票保持 open"
  ⇒ **`done` 是误置**。本轮按 29 条工作，票改回 `doing`（判据未全部完成）。

## 1. 逐条处置表（29 条）

| # | sev | 对象 | kind | 处置 | 依据/落点 |
|---|---|---|---|---|---|
| 1 | P3 | `0x245` | missing-consumer | **登记（不动手）** | `native.setTextureObjectFloat` 是**声明但无宿主实现**的可选缝（`src/vm/native.ts:273`；三宿主 `PixiBackend`/`HeadlessScene`/`StubNative` 全无实现，实测 grep）；调用点 = `handlers/gfx-texture.ts:133`（`0x245` 真实现）。语料 0 处。**归 B2（native 侧）** |
| 2 | P3 | `0x246` | missing-consumer | **登记（不动手）** | 同上，`setTextureObjectParam`（`native.ts:278`）；★同一缝合 `0x246`（op2÷100 的对象参数）与 `0x1F9`/`0x249`（0xFFRRGGBB 颜色）两种语义（`gfx-texture.ts:115/156/303`）⇒ 任何单一宿主实现都无法同时正确，**需要拆缝**。**归 B2** |
| 3 | P2 | `0x14b` | missing-behavior | **复核后已对（前提部分被推翻）** | 审计原文"旧状态原样留下（loaded 仍 true、旧 exports 仍可绑定）"**读错了 emulator 代码**：`agerc.ts` 的 `if (e.agerc.loaded)` 体先清 `loaded`/`exports`，与引擎 raw 31068-31076（`FreeLibrary` + 句柄槽清 0）**同向**。本轮补**命名守卫**钉住"重载失败后旧导出不可再用"（`test/agerc-module-error-paths.test.ts` ①） |
| 4 | P3 | `0x14b` | approximation | **如实登记（有意差异①）** | 引擎错误串 = `"%sを読み込み出来ません．\r\n\r\nERRORCODE = %d"`（`%s`=FileDB 名、`%d`=`GetLastError()`，raw 31079-31082）；emulator 无**同步** id→名字表（`FileSource` 异步）⇒ `%s` 以 id 代替、`ERRORCODE` 不伪造。重新评估条件 = 加 `sub_454FA0` 等价同步解析器。已写进 `agerc.ts` 文件头 + `0x14B` 注释；守卫同文件测试⑦ |
| 5 | P2 | `0x14c` | missing-operand-io | **本轮修** | 引擎的 op3 只在 `slot > 0x63` 分支读一次（`sub_41B640(_this,3)` raw 31120）当错误串 `%s`；合法槽路径不碰 ⇒ emulator 改为**分支相关读**：有第 3 格用 op3、否则回退导出名（`agerc.ts` `op_agerc_bind_export`）。守卫测试④ |
| 6 | P2 | `0x14d` | approximation | **如实登记（有意差异②）** | 引擎对槽表函数指针**零校验**（`(*v14)(...)` raw 39839/39843 ⇒ 未绑定/越界即跳 NULL 崩溃）；emulator 换明确抛错（比崩溃安全）。已写进 `op_agerc_call_export` 注释；守卫测试⑤ |
| 7 | P3 | `0x14d` | unclear | **登记 + 补守卫** | `len <= 0` 时引擎把 **NULL** 当第 2 实参传给导出（raw 39828-39843）；emulator 传空数组、取 `buf[0] ?? 0`。守卫测试⑥断言 `nameLenMax=0` + op3 不动 |
| 8 | P3 | `0x10c` | missing-branch | **复核后已修（上一轮）** | `handlers/input.ts` 的 `op_set_key_multi` 读满 op1/op2、`unsigned > 0x1F` 抛 `ShowMessageError('SetKeyMultiの引数が不正です．')`（引擎 raw 30626-30631）。本轮只补一条**再钉一次**的断言（`test/stub-engine-internal-gaps.test.ts`）：`OPS.has(0x10c)` + 抛引擎原文 |
| 9 | P3 | `0x137` | missing-branch | **如实登记为做不到（写清为什么）** | 体 raw **30714-30718**：`op1 > 0xA` ⇒ `sub_408050` 写错误缓冲（字面量 raw 4423）+ `sub_4034D0` **上报**，**不碰栈槽**、**不是** `_CxxThrowException`（引擎继续执行）。做不到的三条实测约束：① 忠实实现要读 op1 ⇒ 需在 `src/vm/operandPlan.ts` 声明计划并把条目迁 `OPS`（**他人文件**）；② "上报"需要**非致命**宿主错误缝，`NativeBridge` 现无此面（**native.ts/nativeTap.ts，他人文件**）；③ 引擎那张 int 栈表 emulator 未建模 ⇒ "不碰栈槽"自动成立。已写进 `stubs.ts` 的 `0x137` 注释 + 守卫钉住文本（测试②） |
| 10 | P2 | `0x308` | missing-behavior | **如实登记 = 有据 no-op（T-0111② 路线）** | 体 `sub_426B20`（raw 33808-33815）→ `sub_407B20`（raw 12579-12618）：`LoadLibraryA("USER32.DLL")` + 门 `op1 \|\| (GetConfig("system:LimitTouch") & 1)` ⇒ `UnregisterTouchWindow(hwnd)` / `RegisterTouchWindow(hwnd,2)` + `FreeLibrary`。语料 **31279 处 / 345 文件**（实测 `^i308 `）。emulator 无 HWND（`_this[96981]` 无对应物）、无窗口级触摸注册面 ⇒ **无宿主触点源可复现**；不许造假消费者。改登记进 `ENGINE_INTERNAL_OPS`（**不再打 `unhandled`**），守卫 `test/stub-308-touch-register.test.ts` |
| 11 | P3 | `0x308` | missing-operand-io | **如实登记（不建模）** | `_this[1954] = op1` 三条出边都写（raw 12605/12610/12615），整份反编译 **3 写 0 读**（`grep '1954]'` 3 命中）⇒ 建模即死写（`check:dead-writes` 会拦）。守卫断言 `engineValues.has(1954) === false` |
| 12 | P3 | `0x30a` | missing-branch | **登记（本轮未实现，理由同 #9）** | 体 raw 33818-33836：`op1 > 0x1F \|\| op2 > 7`（raw **33828**）⇒ `_CxxThrowException(ShowMessage「SetGesKeyの引数が不正です．」)`，抛点在 `_this[op2+1969] = op1`（raw 33834）之前。★**豁免理由订正**：不是"emulator 无按键表" —— `_this[1969..1976]` 在整份反编译**只写不读**（`grep '1969]'` 仅 1 命中）⇒ **字段无读者**。实现约束同 #9（需 `operandPlan.ts` 声明 + 迁 `OPS`）。守卫钉文本（测试②） |
| 13 | P3 | `0x326` | approximation | **本轮修（注释）** | 补 `Scene+46668 >= 1` 外层门（raw 23917-23929，不满足时整条 handler 含错误支都不执行） |
| 14 | P3 | `0x326` | missing-branch | **本轮修（注释）** | 补 `op4 == 0` 的「関数：Set3DEffectSnow エラー：…TEXTURE=%d」+ `sub_4034C0` 上报（raw 33940-33955；语料 0 处触发） |
| 15 | P2 | `0x327` | stale-ledger | **本轮修（删陈旧注释）** | 删掉"同族的 0x327/0x328 **尚未登记**⇒ 命中即 NotImplementedOp、故意不上桩"那段（与同文件 `ENGINE_INTERNAL_OPS` 登记直接矛盾；撤表 ⇒ SETWEATHER 剧情重新硬停）。守卫：`test/stub-setweather-noop-comments.test.ts` ①（该字样必须消失 + 两条仍在表里） |
| 16 | P3 | `0x328` | missing-branch | **本轮修（注释）** | 补「逐 id 打 Set3DEffectLeaf エラー：メッシュが作成されていません．MESH=%d + `sub_4034C0` 上报」；并加**装载端/挂接端同表同处置**守卫（测试⑤，读 `analysis/opcode-gaps.json` 的 disposition） |
| 17 | P3 | `0x328` | approximation | **本轮修（注释）** | 订正"emulator 无 3D 网格表"→ **网格槽表已建模为 `scene.meshes`**（`0x32A`/`0x32B` 由它承接），缺的是 Effect3D 的 **Leaf** 对象 |
| 18 | P3 | `0x329` | missing-consumer | **本轮修（注释）** | 写明"唯一装载端当 no-op ⇒ `scene.meshes` **表恒空**；真机 N>0、emulator 恒 0" |
| 19 | P3 | `0x32c` | missing-branch | **本轮修（注释）** | 写明**二段式**：设备 `SetTransform` 无条件、只有"三矩阵转发给管理器"被 `if (管理器 != 0)` 门住 |
| 20 | P2 | `0x32e` | overreach | **本轮修（定性订正）** | 行注释从"3D 图元/效果"改为 **D3D `SetLight`**；并写明 **op1 = 灯光索引**、进 `Scene` 偏移的是 **op2**（`Scene[26*op2+13687]`/`Scene[op2+13677]`）、真正缺的是**灯光表 + `native.setLight` 可开灯**。守卫：行注释含 `SetLight`、不含「图元」（测试②） |
| 21 | P3 | `0x32e` | missing-branch | **本轮修（注释）** | 写明 op9(α) 是**钳位饱和**（`if (v2 > 255) v2 = 255;` raw 34088-34089），非报错 |
| 22 | P2 | `scene-3d-effect-level-writer` | stale-ledger | **前提被推翻（已被 T-0167 修掉）** | 现状：`analysis/engine-capabilities.json` 该条 `emulator.status = "modeled-verified"` + `guard = test/scene-3d-effect-level.test.ts` + note 已重写（`SceneState.effect3DLevel`/`effect3DSlots`、`renderer/scene/effectLevel.ts`）⇒ 审计说的"status=partial 与 note 互相矛盾"不再存在，**无需动作** |
| 23 | P3 | `scene-3d-weather-effects-rain-snow-leaf` | overreach | **仍成立 → 交主 agent 改 `engine.fns`** | 当前 `engine.fns` = `[sub_4A6EE0, sub_4530B0, sub_453280, sub_453330, sub_453410, sub_453150, sub_4535F0, sub_453540]`，**仍缺 `sub_4531B0`**（= `Manager[262..309]` 三组 16-dword 参数块的唯一写入端，`qmemcpy(_this+262/+278/+294, …, 0x40)`，调用点 raw 122049-122056 / 116499 接收者都是 `Scene+50704`）。emulator 侧扩展点已由本轮补进 `stubs.ts` |
| 24 | P3 | `0x14c` | missing-behavior | **本轮修** | 模块未加载时改用引擎同文「`%sのアドレス取得に失敗しました．`」（raw 31111；引擎对 NULL 句柄直接 `GetProcAddress`，raw 31106）。既有测试 `test/op-a4-a6.test.ts:77` 的 `/模块未加载\|アドレス取得/` **仍绿**（未放宽） |
| 25 | P3 | `0x14c` | missing-operand-io | **本轮修（同 #5）** | 越界错误串 `%s` 取 op3（raw 31120） |
| 26 | P3 | `0x14c` | missing-branch | **前提被推翻（校验次序本就与引擎一致）** | 审计原文"emulator 在 slot 非法 + 名字未知时抛的是『槽号非法』"与代码相反：`agerc.ts` 先查名字（抛「アドレス取得に失敗しました」，= 引擎 raw 31106 的失败）再查槽。本轮补**可失败证据**（测试③） |
| 27 | P3 | `0x14d` | approximation | **登记 + 补守卫（同 #7）** | `len<=0` 时 `_SetNameLenMax@20`（`dword_100A9000 = *a2` 无条件解引用，`agerc-internals.md`）会解引用 NULL ⇒ 真机 UB/崩溃，emulator 记 0。守卫测试⑥ |
| 28 | P3 | `0x308` | stale-ledger | **本轮修** | `stubs.ts` 的 0x308 文档现在同时含 `USER32`、`RegisterTouchWindow`、`UnregisterTouchWindow`、`system:LimitTouch`、`_this[1954]`(3 写 0 读)、raw 锚点（12579/12590/12605/33808）与语料计数；守卫测试③（文本棘轮） |
| 29 | P3 | `0x32c` | missing-consumer | **本轮修（注释）** | 写明每次调用**先整块复位 `Scene+41928..41988`**（4×1.0 + 12×0.0，raw 116456-116478）再写入 ⇒ 只建写入端会漏掉复位语义 |

**计数**：本轮修/订正 **15**（#5,#13,#14,#15,#16,#17,#18,#19,#20,#21,#24,#25,#28,#29 + #10/#11 的登记改写），
复核后已对/前提被推翻 **5**（#3,#8,#22,#26 + #10 的"宿主副作用"部分如实登记），
如实登记为做不到或有意差异 **9**（#1,#2,#4,#6,#7,#9,#12,#27 + #23 的台账侧交接）。

## 2. T-0111 判据② 专节（`0x308` 触摸注册）

**处置 = 有据 no-op 登记**（票面写死的路线），本轮已执行：

- `src/vm/handlers/stubs.ts`：`[0x308, op_stub_unhandled]` **移出** `STUB_NATIVE_OPS` ⇒
  改登记 `[0x308, op_engine_internal]`（带 why + raw 锚点）；`op_stub_unhandled` handler 与其
  `unhandled` 日志点**删除**（`STUB_NATIVE_OPS` 现为空数组，导出保留）。
- 不再打 `unhandled` 日志（守卫用 spy 断言 `native.unhandled` 零调用）。
- 守卫：`app/amayui-emulator/test/stub-308-touch-register.test.ts`（3 例）。
- 锚点棘轮：T-0111 的 `evidence[2]` 原锚点 `[0x308, op_stub_unhandled]` 随本次改写消失 ⇒
  已 **retarget** 到 `[0x308, op_engine_internal]`（`stubs.ts` 现第 355 行；`tickets.js --validate` ✅）。
- 语料复核：`^i308 ` = **31279 处 / 345 个文件**（本机实测，与审计一致）。

**判据①/③ 未动**（①剩余 8 条 0 语料 + `0x1D3` 锚点 + 三表全量对账；③已由 T-0157 完成）。

## 3. 台账可照抄片段（主 agent 直接用）

### (a) `analysis/opcode-gaps.json` 新增条目（`0x308`）

```json
{
  "opcode": 776,
  "mnemonic": "",
  "name": "",
  "handler": "sub_426B20",
  "handlerBodyLine": 33807,
  "argc": 1,
  "docStatus": "已核对",
  "source": "engine-internal",
  "disposition": "engine-internal",
  "note": "触摸注册（TOUCH）。体 sub_426B20（raw 33808-33815：arity 槽 3 ⇒ argc 1，读 op1）→ sub_407B20（raw 12579-12618）= LoadLibraryA(\"USER32.DLL\") + 门 `op1 || (GetConfig(\"system:LimitTouch\") & 1)`（raw 12590，只取 bit0；a2 = _this[96981] = HWND 格）⇒ 真取 GetProcAddress(\"UnregisterTouchWindow\") 调 (hwnd)、假取 \"RegisterTouchWindow\" 调 (hwnd,2)，随后 FreeLibrary；三条出边都写 `_this[1954] = op1`（raw 12605/12610/12615）。语料 31279 处 / 345 个文件（^i308 实测）⇒ 非登记不可（不登记即 NotImplementedOp）；emulator 无 HWND 概念、无窗口级触摸注册面（触屏/指针输入由 Electron/DOM 层持有）⇒ 无宿主触点源可复现，登记为有据 no-op。不建模 _this[1954]（全反编译 3 写 0 读 ⇒ 写了是死写，check:dead-writes）。扩展点 = 宿主缝 registerTouchWindow(hwnd, unregister) + 配置读 system:LimitTouch bit0（src/vm/native.ts + nativeTap.ts，不属本票）。守卫 test/stub-308-touch-register.test.ts。",
  "ticket": "T-0111",
  "journal": [
    {
      "at": "2026-09-24",
      "field": "entry",
      "what": "新增：T-0163/T-0111 判据② —— 由 STUB_NATIVE_OPS 的 unhandled 桩改为 ENGINE_INTERNAL_OPS 的有据 no-op 登记（不再打 unhandled 日志）。"
    }
  ]
}
```

> 注：`handlerBodyLine` 按本文件既有约定取 `//----- (00426B20)` 那一行 = **33807**（body 33808-33815）；
> `mnemonic`/`name` 与 `analysis/opcodes.json` 的 0x308 行一致（都为空串）。

### (b) `analysis/opcodes.json` 的 `0x308` 表行

**现状（已存在，无需新增行）**：`entries` 里已有
`{opcode:776, argc:1, handler:"sub_426B20", status:"已核对", semantics:"**输入触摸注册**：读 op1，调全局输入管理器 sub_407B20(_this[96981], op1)（LoadLibrary+GetProcAddress 注册/注销触摸），置 _this[1954]。handler=sub_426B20（raw .c 33808）"}`，
`docs-new/03-engine/opcode-table.md:528` 已渲染该行 ⇒ **票面「opcode-table.md 缺失 0x308 表行」的前提不成立**（早前某轮已补）。

**建议把 `semantics` 换成下面这段**（status 仍写 `已核对`；带 raw 锚点、门、两个导出名、字段写与语料量）：

```
**输入触摸注册**（TOUCH）：体 `sub_426B20`（raw 33808-33815；arity 槽 3 ⇒ argc 1）读 op1 →
`sub_407B20(_this[96981], op1)`（raw 12579-12618）= `LoadLibraryA("USER32.DLL")` + 门
`op1 || (GetConfig("system:LimitTouch") & 1)`（raw 12590，只取 bit0）⇒ 真取
`GetProcAddress("UnregisterTouchWindow")` 调 `(hwnd)`、假取 `GetProcAddress("RegisterTouchWindow")`
调 `(hwnd, 2)`，随后 `FreeLibrary`；三条出边都写 `_this[1954] = op1`（3 写 0 读）。语料 31279 处 /
345 个文件。emulator：`ENGINE_INTERNAL_OPS` 有据 no-op（无 HWND / 无窗口级触摸注册面；
`tickets/T-0111` 判据② + `T-0163`），守卫 `test/stub-308-touch-register.test.ts`。
handler=sub_426B20（raw .c 33807）。
```

#### `0xDD` 的核实结论：**前提被推翻 —— 不该补表行**

- 派发表基址 `_this + 675996`（`0x308`=776 的槽 `676000`…实测 `*(_DWORD *)(_this + 676828) = sub_42E910` 对应
  `0xD0`=208 ⇒ 槽 = `675996 + 4*opcode`）。`0xDD`=221 的槽 = `676880`：**整份反编译里零赋值**
  （`grep 676880` 0 命中；邻槽 676872/676876/676884/676888 同样 0 命中）⇒ 只被
  `memset32((void *)(_this + 675996), (int)sub_418E30, 0x400u)`（raw 22722）填成**默认 handler**。
- `analysis/opcodes.json`：`entries` 无 221、`fallbackDefault.entries` 也无 221
  （`fallbackDefault` 现有 30 条里连 `0xDB..0xDF` 一条都没有 ⇒ 该清单是人工挑选的 other-works 名单）。
- `scripts/asm/opcodes.json`（emulator 侧真源）：无 221；语料 `^idd ` **0 处**。
- ⇒ `0xDD` **不是本作的指令**（dispatch 表未定义），**表行本就不该有**。
  若一定要它在文档里可见，正确动作是把 221 加进 `analysis/opcodes.json` 的 `fallbackDefault.entries`
  （`{opcode:221, argc:?, mnemonic:"", owner:"<其它作品>"}`）—— 但 owner 未知（`0xDB..0xDF` 整段都不在名单里），
  **本票不建议**这么做；`T-0111` 票面这句"`0xDD` 同缺，一并核"应改为"已核：非本作指令"。

### (c) `analysis/engine-capabilities.json`：`0x308` 该不该进？

**建议不进**：该台账的定位是"**跨指令的引擎常态能力**（逐帧流程 / 门控标志 / 惰性创建 / 转场 / 资源生命周期）"，
`0x308` 是**单条脚本指令的宿主副作用**，`analysis/opcodes.json`（语义）+ `analysis/opcode-gaps.json`（处置）
两层已完整覆盖；进能力台账会与"无法靠枚举 opcode 发现"的收录标准冲突。
**若主 agent 仍要一条**，按现有形状给：

```json
{
  "id": "touch-registration-gate-1954",
  "subsystem": "input",
  "name": "窗口级触摸注册开关（USER32 注册/注销 + `_this[1954]` 记账）",
  "trigger": "脚本 `i308`（语料 31279 处 / 345 个文件；几乎每个脚本头部与场景切换）",
  "engine": { "fns": ["sub_426B20", "sub_407B20"], "raw": "33808-33815 / 12579-12618" },
  "reads": ["op1", "GetConfig(\"system:LimitTouch\") bit0", "_this[96981]（HWND）"],
  "whySilent": "缺它不报错：只影响窗口级触屏注册；鼠标/键盘/手把路径都不经它，脚本侧可观测值不变",
  "confidence": "confirmed",
  "emulator": {
    "status": "absent",
    "evidence": "E0",
    "guard": "test/stub-308-touch-register.test.ts",
    "note": "emulator 侧零建模（无 HWND、无窗口级触摸注册面）⇒ 按有据 no-op 登记进 ENGINE_INTERNAL_OPS；`_this[1954]` 3 写 0 读，不建模（死写）。扩展点 = 宿主缝 registerTouchWindow + 配置读 system:LimitTouch（native.ts/nativeTap.ts）。tickets/T-0111 判据②、T-0163。"
  }
}
```

### (d) 能力台账另外两行的片段（T-0163 的 #23 + 一处措辞订正）

**#23 仍成立 —— `scene-3d-weather-effects-rain-snow-leaf` 的 `engine.fns` 补一项**：

```diff
- "fns": ["sub_4A6EE0","sub_4530B0","sub_453280","sub_453330","sub_453410","sub_453150","sub_4535F0","sub_453540"]
+ "fns": ["sub_4A6EE0","sub_4530B0","sub_453280","sub_453330","sub_453410","sub_453150","sub_4531B0","sub_4535F0","sub_453540"]
```

（`sub_4531B0` = `Manager[262..309]` 三组 16-dword 参数块的**唯一写入端**：`qmemcpy(_this + 262, &a2, 0x40u); qmemcpy(_this + 278, &a18, 0x40u); qmemcpy(_this + 294, &a34, 0x40u);`，
调用点 raw 122049-122056 与 116499 的接收者都是 `Scene+50704` ⇒ 它属于本条的 `writes`/`reads` 链上游。）

**★新发现（同一 note 内的一处过强措辞）**：该条 note 写「`0x324`（销毁全部 + 清旗标）、`0x325`（两阈值）
经 `scWeatherDestroyAll`/`scWeatherSetDestroyThresholds` 落地**并有模型消费者**」—— 实测
`src/` 下 `scWeatherDestroyAll` / `scWeatherSetDestroyThresholds` / `scSet3DEffectSnow` /
`scSetEffect3DLevel` **除定义外没有任何产品调用点**（只有 `test/scene-3d-*` 引用；
唯一每帧被调的是 `scEnsureEffect3DSlots`，来自 `renderer/scene/commit.ts:95`）。
建议把"并有模型消费者"改成"模型侧函数已就位；**opcode→模型未接线**（同本条 ★仍缺 ②）"，
以免下一位读者以为 `0x324`/`0x325` 已经接通。（本轮已在 `stubs.ts` 的 `0x325`/`0x326` 注释里如实写明。）

## 4. 上一轮的陈旧说法（本轮已同步，避免新造 stale-ledger）

- `stubs.ts` 顶部"唯一还留在宿主表里的指令 0x308 落到 default / ⚠已知缺口"段 ⇒ 改写为"本表已空 + 移出理由 + 新落点"。
- `stubs.ts` 里 `0x325`/`0x326`/SETWEATHER 族的"emulator **没有 Effect3D 子系统**"⇒ 订正为
  "`Scene` 模型侧自 `T-0167` P1 轮起已有 Effect3D 半边，缺的是 **opcode → 模型**那一半（已披露）"。

## 5. 验证记录（红→绿）

```
# 红（改实现之前，4 个新守卫文件）
node --import tsx --test test/stub-308-touch-register.test.ts test/stub-setweather-noop-comments.test.ts \
  test/stub-engine-internal-gaps.test.ts test/agerc-module-error-paths.test.ts
→ ℹ pass 5 / ℹ fail 14

# 绿（改实现之后，同一命令）
→ ℹ pass 19 / ℹ fail 0

# 既有守卫回归（11 个文件：a4-a6 / opcode-operands / operand-plan / registry-classification /
# registry-tables / op-327-32e-setweather-noop / native-tap / op-0104 / input / keyboard-mask / opcode-gaps）
→ ℹ pass 48 / ℹ fail 0（本次）
   ★其中 test/input.test.ts 的「TITLE: mouse_callback 登记 …」1 例在本轮**之前**就已红：
   报错来自 `src/vm/handlers/live2d.ts:365` 的 L2D MTN 装载（`live2d/*.ts` 正在被别的 agent 改，
   `git status` 显示 5 个 live2d 文件未提交）—— 与本票文件无关。

# 类型
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit   → exit 0
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit → 仅他人文件报错（test/config-t0161*.ts、test/engine-fields-t0161.test.ts；无本票文件）

# 票据
tickets.js --validate → ✅ 172 张（82 条既有行号漂移警告，与本票文件无关）
test/doc-model.test.ts + test/opcode-arity.test.ts + test/ticket-ledger.test.ts → ℹ pass 19 / ℹ fail 0

# 全量 T0 档（`node --import tsx test/run.ts fast`，本票改动后）
→ ℹ tests 1122 / pass 1117 / fail 4 —— **4 条失败全部与本票文件无关**：
  ① `test/harness-convergence.test.ts`「不得新增自造 mk()/ctx 变体」点名
     `config-t0161.test.ts` / `engine-fields-t0161.test.ts`（T-0161 的；★我自己最初也中了这条，
     已把 `function mk()` 改成 `harness.mkEngine` 的 `rig()`，本票文件不再出现在名单里）；
  ② 同文件「基线只许收缩」（同因，基线文件不属本票可写范围）；
  ③ `test/op-10-002-adv-sleep-order.test.ts`（帧循环 ADV/SLEEP 次序，别人在改）；
  ④ `test/organization.test.ts`「R2 档位诚实」（同 ① 的两个 T-0161 文件）。
# 另：`test/input.test.ts` 的「TITLE: mouse_callback 登记 …」一例在 T0 档里也报错
  （`src/vm/handlers/live2d.ts:365` 的 L2D MTN 装载；live2d 五文件未提交、正被别的 agent 改），
  与 stubs.ts/agerc.ts 无关（该文件其余 13 例全绿，含 0x10C 的 4 条）。
```

## 6. 本轮改动的文件

| 文件 | 性质 |
|---|---|
| `app/amayui-emulator/src/vm/handlers/stubs.ts` | 0x308 移表（STUB_NATIVE_OPS → ENGINE_INTERNAL_OPS）+ 删 `op_stub_unhandled`；0x137/0x30a/0x326/0x327/0x328/0x329/0x32c/0x32e 的注释订正/补齐；3D 族"接线状态订正"；顶部与本表说明同步 |
| `app/amayui-emulator/src/vm/handlers/agerc.ts` | 0x14C 未加载文案改引擎同文 + 越界分支 `%s` 取 op3；0x14B/0x14D 的有意差异与引擎原文/raw 锚点写进文件头与 handler 注释 |
| `app/amayui-emulator/test/stub-308-touch-register.test.ts` | 新增（3 例） |
| `app/amayui-emulator/test/stub-setweather-noop-comments.test.ts` | 新增（7 例） |
| `app/amayui-emulator/test/stub-engine-internal-gaps.test.ts` | 新增（2 例） |
| `app/amayui-emulator/test/agerc-module-error-paths.test.ts` | 新增（7 例） |
| `tickets/T-0163/changes-c163.md`、`tickets/T-0111/changes-c163.md` | 新增（本文件 + T-0111 专档） |

## 7. 交给别人的（不在本票文件范围）

1. **`src/vm/native.ts` / `src/vm/nativeTap.ts`（归 B2）**：#1 `0x245`、#2 `0x246` 两条宿主缝
   （声明在案、三宿主无实现）。★额外：`setTextureObjectParam` 同时承载 `0x246`（对象参数）与
   `0x1F9`/`0x249`（颜色）两种语义 ⇒ **要么拆两个方法，要么参数带 kind**。
2. **`src/vm/operandPlan.ts`（不属本票）**：
   - 第 1421 行的注释仍写「`0x308` … 而 emulator 是 `op_stub_unhandled`」⇒ 登记方式已变，**该注释需改指**
     `op_engine_internal`（本票未动该文件）。
   - `0x137` / `0x30a` 的越界诊断要做，需在此声明操作数计划并把两条迁进 `OPS`。
3. **`test/opcode-operands.test.ts:53`** 的白名单文本仍写「STUB_NATIVE_OPS 的 unhandled 桩」⇒ 措辞已过期
   （语义上仍需要该白名单条目：0x308 是 argc=1 但不读操作数的有据豁免）；`0x30a` 的 `engine-internal no-op（emulator 无按键表）`也建议改成"字段无读者"。
4. **`analysis/*.json`（主 agent 串行）**：本文件 §3 的 (a)(b)(c)(d) 片段。
5. **`docs-new/03-engine/opcode-gaps.md`**：等 (a) 进真源后重跑生成器。
