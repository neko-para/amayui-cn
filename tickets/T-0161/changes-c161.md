# T-0161 过程文档：指令实现缺口修复批（引擎字段 / 配置读写）

> 只读真源 `engine/天结_unpacked.exe_utf8.c`（下称 raw）+ `engine/…lst`。本文所有结论都标 raw 区间。
> 可写路径：`src/vm/handlers/engine-fields.ts`、`src/vm/handlers/config-read.ts`、`src/configRegistry.ts`、
> `src/engineConfig.ts`、`src/vm/engineFieldIds.ts` + 新增 `test/config-*.test.ts` / `test/engine-fields-*.test.ts`。
> **本文的台账片段是给主 agent 照抄的**（六份真源不归本票写）。

---

## 0. 一句话结论

18 行清单里 **10 行修了实现**（含全部 P2 里能在可写路径内落地的 4 条）、**3 行复核后已修**（消费端由别的票落地）、
**3 行前提被推翻**（引 raw 已改判）、**2 行如实登记为做不到**（要改 `engine.ts` / 宿主媒体子系统）。
守卫：`test/config-t0161.test.ts`（13 例）+ `test/engine-fields-t0161.test.ts`（7 例），红→绿已留痕。

---

## 1. 逐条处置（18 行）

| # | sev | 对象 | kind | 处置 | 依据 / 落点 |
|---|---|---|---|---|---|
| 1 | P3 | `0xc5` | missing-branch | **修** | 越界（`op1 != 0` 且 ∉1..4）时引擎走 raw 38657-38661 的 `sprintf_s(_this+8,0x400,aGetvolume); sub_4034D0`；`aGetvolume="GetVolumeの引数が不正です．\r\n"`（raw 4442）。链路 `sub_4034D0`(9433-9435)→`sub_4976A0`(114428-114457)→`sub_497620`(114402-114416)→`sub_438CC0`(45660-45667)=**WriteFile 到 remote-debug 句柄**（不弹窗/不中断/不写操作数）⇒ emulator 的等价物 = 一行诊断。`CfgReadSpec.errText` + `op_cfg_read` 越界分支 `c.log`。守卫：config-t0161 的 `★0xC5`。 |
| 2 | P3 | `0x2eb` | approximation | **修（口径钉死）+ 文档订正** | 两层口径：INI 非空值优先。守卫用**与缺省不同**的值 `9.99.9999`（旧守卫用的 `1.07.0019` 与缺省同值 ⇒ 区分不出两层）。`config-read.ts` 的 0x2EB 文档块整段重写（见 §3.3）。 |
| 3 | **P2** | `0x2eb` | missing-branch | **修** | 空串 ⇒ 回落 `DEFAULT_GAME_VERSION`。**读体订正了审计的前提**：引擎的第 2 层不是 INI `[set]` 节 —— 见 §4.1。 |
| 4 | **P2** | `0xd9` | missing-branch | **复核后已修 + 补一刀** | ①「门恒假」被 T-0157 推翻（`control.ts:340 setDispatching` 写 `engineValues[124350]` = raw 18149/18980/25176/25187/25667）；②**真正剩下的洞**：`_this[95779]` 在 emulator 有**两份表示** —— 活槽 `Engine.dispatchSavedFlags`（`control.ts:382/373`）与 `engineValues[95779]`（只有 0xD9 读写，`op-a5.test.ts:176-189` 钉住）。修前只清后者 ⇒ 引擎真会清的那一位没清。现在**两份都清**（既有断言一字未动）。 |
| 5 | P3 | `0x131` | missing-behavior | **修** | 缺键/无 INI ⇒ 回退改取 `registryDefault(CFG.messageMesWinAlpha)` = **8**（raw 111471-111472 `v13 = 8; sub_434D00(v2, aMessageMeswina, &v13)`）。 |
| 6 | P3 | `0x141` | missing-behavior | **修（并订正可见性）** | 日志里带上引擎那句 `GetMesWinAの引数が不正です．\r\n`（raw 4427）。★审计原文「把该串当消息派发（= 玩家可见的错误提示）」**过强**：同一条 `sub_4034D0` 链路只写 remote-debug 文件（raw 45660-45667）⇒ 它是诊断、不是消息窗。 |
| 7 | P3 | `0x142` | missing-consumer | **如实登记（做不到）** | `_this[699248]` 全库 4 处引用：写 raw 31026、构造 raw 22591、复位 raw 17961、**导出查询** `sub_4765C0(){ return *(_DWORD *)(dword_55E1BC+699248)!=0; }`（raw 91057-91061，工程内零调用）。emulator 没有"导出给脚本/宿主的查询"这一层，也**没有对应的 opcode** ⇒ 不编消费者。 |
| 8 | P3 | `0x148` | missing-consumer | **如实登记（做不到）** | 该槽读者是窗口过程 `sub_4B9240`（raw 141038-141043：`timeGetTime() - dword_55E1D8 > *(dword_55E1BC + 388232)` 才继续走弹系统对话框那一支）⇒ 需要宿主「点击去抖 / 系统对话框」子系统，emulator 没有。 |
| 9 | **P2** | `0x201` | missing-behavior | **修** | `set:DrawMode` 进 `CONFIG_FIELD_BINDINGS`（field 166964）。引擎写点：构造 raw 23572-23574、主循环/复位后 raw 35271-35273、清零 raw 17979、脚本端 0x200 raw 31372（带 `set:CreateObject` 位门）。守卫：`★0x201` + 绑定用例。 |
| 10 | P3 | `0x25a` | missing-consumer | **如实登记（做不到）** | `sub_4A5470(Scene, id)` 的两条下发门（raw 33198-33199 模式镜像 92377、raw 33200-33201 非 `display:ScreenMode`）需要宿主媒体/影片子系统；且门输入 `92377` 在 emulator **没有任何维护者**。同族 `0x25b` 的加载分支同一缺口。 |
| 11 | P3 | `0x25b` | missing-operand-io | **修** | 补 `_this[92379] = 2`（raw 33211）。`FieldStoreSpec` 新增 `constWrites`（与操作数无关的常量格），`map` 的键是操作数序号、表达不了这种体。 |
| 12 | **P2** | `0x25b` | missing-behavior | **如实登记（做不到）** | `if (!_this[167990]) { v3 = sub_41BF50(_this,1); return sub_408440(_this, v3); }`（raw 33215-33219）；`sub_408440` 失败时 `_CxxThrowException(Command_ShowMessage_Exception)` ⇒ **影响控制流**。emulator 无"图解码进 Scene 固定帧纹理"的宿主缝（`native.playMovie` 是影片、语义不同）⇒ 需要新缝 + 抛异常口径，不在本票可写路径内。 |
| 13 | **P2** | `0x2e9` | missing-consumer | **复核后已修** | 消费端已在 emulator：`handlers/msgwin.ts` 的 `armCoexistAutoMessage`（raw 28556-28586）与 `vm/engine.ts` 的 `#autoMessageInterval`（raw 20384-20399）= T-0151 落地 ⇒ 本字段**不再是只写不读**。新增"生产读者棘轮"（`test/engine-fields-t0161.test.ts`，读者被删即红）。 |
| 14 | **P2** | `msgwin-cancel-key-state` | stale-ledger | **修代码侧守卫 + 台账片段（§3.4）** | 键名 = `set:CancelMesSkipOnClick`（raw 4346 `aSetCancelmessk[25]`），在权威键表（`def: 0`）也在证据 INI ⇒ 休眠是**值**。守卫断言常量 == 权威键名 + 各键在表里。★同一条 finding 的 P3 `overreach`（trigger 极性）要改 `src/vm/engine.ts`，不是本票。 |
| 15 | **P2** | `msgwin-line-fade-window` | missing-behavior | **部分（配置侧订正）+ 台账片段（§3.4）** | 时长 `MessageSpeed × MessageFade / 100`、门 `Font+1376 > 0 && Font+235128 > 0`（raw 72336-72348，`sub_4ACF60` 设色 + `sub_4AD0C0` 起窗）**逐字读到**；但接线要改 `handlers/msgwin.ts`/`renderer/**` ⇒ 本票把 `engineConfig.ts` 的绑定 note 改成准确缺口描述，并把可照抄的 capability 片段写进 §3.4。 |
| 16 | **P2** | `0x2e9` | missing-consumer | **修（文档订正，engineFieldIds.ts）** | 旧注释的键名是**不存在的** `message:AutoMessageSpeed` / `AutoMessageMinTime`；真键是 `AutoMessagePitch0/1` + `AutoMessageTime0/1`（raw 4309-4313）⇒ 已订正，并写明**第二个计算点** raw 20416-20426（被 `122501` 门控、**不减 1**）仍未建模。 |
| 17 | P3 | `0xd9` | missing-consumer | **前提被推翻** | `sub_419970` 的返回值 `-4097` 被派发器**丢弃**：唯一调用点 raw 20161-20165 `((void (__thiscall *)(int *))_this[v7 + 168999])(_this);`（强转成返回 `void`）；`.lst` 里该函数只有 `DATA XREF: sub_415640+1164`（装表），无直接调用点。emulator 的 `OpHandler` 类型本来就是 `void \| Promise<void>`（`vm/step.ts:6`）⇒ 无处可建模，**不是缺口**。 |
| 18 | P3 | `0x142` | missing-behavior | **如实登记（做不到）** | 初值/复位值 **1**：raw 22591（构造 `sub_415640`）与 raw 17961（复位 `sub_40DF10`）`*(_DWORD *)(_this + 699248) = 1;`。要落在 `Engine` 构造/复位 ⇒ `src/vm/engine.ts`，不在本票可写路径内。 |

### 1.1 读体时发现的**新条目**（清单外）

| sev | 对象 | 说明 |
|---|---|---|
| **P3** | `0xc7` 的越界诊断 | 与 `0xc5` 同形：raw 38715-38716 `aGetsoundmode = "GetSoundModeの引数が不正です．\r\n"`（raw 4443）。**且 `op1 == 0` 也走报错支**（四支都是 `== 1/2/3/4`），与 `0xc5` 的 `if (op1) else Volume0` **不对称** ⇒ 已补 `errText` + 守卫 `★0xC5 与 0xC7 的 selector=0 不对称`。 |
| **P3** | `0x1b8` / `0x2e6` 的越界诊断 | 同形：`aGetautomessp`（raw 4408）/ `aGetautomespi`（raw 4435）⇒ 已补 `errText`。 |
| **P2** | `configRegistry` 的 `set:GameVersion` `def` 偏差 | 键表把内建默认记成 `''`，而引擎构造注入的是 **`"1.00"`**（raw 111627-111629，`char a100[5]="1.00"`，raw 5017）。`formatIni` 是"键表全量导出"⇒ **emulator 自己**每跑一次就写出 `GameVersion=`（本机 `.tmp/instances/*/overlay/SYS4REG.INI` 实测），这条空值再经 0x2EB 变成 TITLE 的 "0.00.0000"。★**本票不改 `def`**（理由：`def` 直接决定 overlay INI 的字节，改成 `'1.00'` 就得再让 0x2EB 把 `'1.00'` 映射回 `DEFAULT_GAME_VERSION`，否则 E3 的 TITLE 断言 `1.07.0019` 会红 ⇒ 属于产品口径决策，交主 agent）。**建议**：要么保持 `def: ''` + 本票的"空串⇒缺省"（已做），要么 `def: '1.00'` + 0x2EB 把内建常量也映射成缺省（需同时改 `test/config-version-substr.test.ts` 的口径说明）。 |
| **P3** | 载体/工具函数缺失台账 | `analysis/functions.json` 里**没有**：`sub_494220`（配置对象 vtable 第 3 项 = 注册表数据块应用器，`.data:00529808`）、`sub_4034D0`/`sub_4976A0`/`sub_497620`/`sub_438CC0`（remote-debug 诊断链）、`sub_4765C0`（导出查询）、`sub_426620`（**0x2E9 的 handler 本体**，opcodes.json 有、functions.json 无）、`sub_408440`（消息态图像加载 + 抛异常）、`sub_4A5470`（媒体下发）、`sub_408050`（安全 sprintf）。片段见 §3.5。 |

---

## 2. 改了哪些文件（本票实现）

| 文件 | 改动 |
|---|---|
| `src/vm/handlers/config-read.ts` | ① `CfgReadSpec.errText` + 4 条常量串 + 越界 `c.log`（0xC5/0xC7/0x1B8/0x2E6）；② 0x2EB 空串⇒缺省；③ 0x2EB 文档块整段重写（三层结构的订正版） |
| `src/vm/handlers/engine-fields.ts` | ① 0x131 缺省取 `registryDefault`；② 0x141 诊断串 + 可见性订正；③ 0xD9 清活槽 `Engine.dispatchSavedFlags`；④ `FieldStoreSpec.constWrites` + 0x25B `mediaMode=2`；⑤ 0x2E9/0x142/0x148 的缺口注释 |
| `src/configRegistry.ts` | 未改代码（只在本票 §3.4 给出能力条目的替换 note）；键名守卫落在新增测试里 |
| `src/engineConfig.ts` | ① 新增 `set:DrawMode ⇒ 166964` 绑定；② `message:MessageFade` 的 note 改成准确的缺口描述 |
| `src/vm/engineFieldIds.ts` | 5 处注释订正（`dispatchSavedFlags` 两份表示 / `scriptEngineFlag` 初值 1 与导出读者 / `drawMode` 写者 / `mediaMode`+`msgMediaImageId` / `autoMessageBaseline` 键名与两个消费点） |
| `test/config-t0161.test.ts` | **新建**（13 例） |
| `test/engine-fields-t0161.test.ts` | **新建**（7 例） |

★未改任何既有测试文件（`op-a5.test.ts:176-189` 对 `engineValues[95779]` 的三段断言**一字未动**，新行为是叠加的）。

---

## 3. 台账片段（主 agent 可照抄）

### 3.1 `analysis/opcode-gaps.json`

`0x201`（`i201`）的 `missing[]` **整条删除**（已修；`disposition` 保持 `partial` 还是升 `implemented` 由主 agent 按 T-0149 的口径定 —— 该条 `note` 里"B1 已实现"的部分仍成立）：

```json
// DELETE from analysis/opcode-gaps.json → entries[opcode==201].missing[]
{ "what": "0x201 读的 _this[166964]（DrawMode）在 emulator 里无写入者：set:DrawMode 未进 CONFIG_FIELD_BINDINGS、ENGINE_FIELD.drawMode 全仓只有 engine-fields.ts:58 的读点 ⇒ getter 恒回 0", "ticket": "T-0161", "raw": "39858-39864" }
```

`0x2e9`（`i2e9`）的 `missing[]`：**第 2 条删除**（消费端已由 T-0151 落地，且键名是错的），**第 1 条保留但改写**：

```json
// REPLACE entries[opcode==745 /* 0x2e9 */].missing[0]
{
  "what": "自动翻页的**第二个计算点**（等待泵 sub_411BC0 的另一支，raw 20416-20426）：`if ((GetConfig(\"message:AutoMessageOption\") & 1) == 0) { if (!_this[490004 /* 下标 122501 */]) { v20 = sub_407F20(Font, _this[489484]) - _this[489856]; … sub_453A60(…) } return; }` —— 与 raw 28569/28579 的公式**不同**：这里用 `(该窗行数 − 基准)`（**不减 1**），且整段被 `122501`（语音忙碌）门控。emulator 的 `#serviceAutoMessage`（vm/engine.ts）复刻了总门与 LABEL_58 的 `if (122501) return`，但**这一支的 Pitch0/Time0 武装没有落点**（122501 在 emulator 恒 0 ⇒ 当前不可达）。guard：`test/engine-fields-t0161.test.ts` 的"生产读者棘轮"只钉住第一个计算点。",
  "ticket": "T-0161",
  "raw": "20416-20425"
}
```

`0x2e9` 的 `note` 里那句（旧文本）也要订正键名：`message:AutoMessageSpeed` / `message:AutoMessageMinTime` **不存在** ⇒ 改为 `message:AutoMessagePitch{0,1}` / `message:AutoMessageTime{0,1}`。

**新增** `missing[]`（我做不到的，逐条都要有 raw）：

```json
// ADD to entries[opcode==0x25a /* i25a */].missing[]
{ "what": "两条媒体下发门整段未建模：`if (v3 /* _this[92377] == 0，上一次模式镜像 */) sub_4A5470(Scene+80708, id);`（raw 33198-33199）与 `if (!_this[167990] /* display:ScreenMode */) sub_4A5470(Scene+80708, _this[92380]);`（raw 33200-33201）。emulator 只写 mediaMode/mediaId 两个字段，**两个门的输入之一（92377 模式镜像）没有任何维护者**，且没有宿主媒体层。重开条件：接入"消息态媒体层"（图/影片叠加）时。", "ticket": "T-0161", "raw": "33198-33201" }

// ADD to entries[opcode==0x25b /* i25b */].missing[]
{ "what": "图像加载分支 `if (!_this[167990]) { v3 = sub_41BF50(_this, 1); return sub_408440((int)_this, v3); }`（raw 33215-33219）整段未建模：sub_408440（raw 13147-13155）真解码资源、渲进 Scene 的固定帧纹理，失败时 `_CxxThrowException(Command_ShowMessage_Exception)` ⇒ **影响控制流**（脚本侧会弹消息窗并中断）。emulator 无对应宿主缝（`native.playMovie` 是影片、语义不同）。★字段侧已修（92379=2 + 92381=op1）。", "ticket": "T-0161", "raw": "33215-33219" }

// ADD to entries[opcode==0x142 /* i142 */].missing[]
{ "what": "初值/复位值 = 1 未建模：构造 sub_415640（raw 22591）与整体复位 sub_40DF10（raw 17961）都写 `*(_DWORD *)(_this + 699248) = 1;`，emulator 的 `Engine` 构造/复位都不种这一格 ⇒ `i142 1`（CONFIG.txt:354）之前读到 0。落点 = `src/vm/engine.ts`（构造与 reset 路径各一行）；守卫形态 = 构造后断言 `engineValues.get(ENGINE_FIELD.scriptEngineFlag) === 1`。", "ticket": "T-0161", "raw": "22591,17961" }

// ADD to entries[opcode==0x148 /* i148 */].missing[]
{ "what": "该槽的读者是宿主窗口过程，emulator 无该子系统：sub_4B9240 用 `timeGetTime() - dword_55E1D8 > *(_DWORD *)(dword_55E1BC + 388232)`（即 _this[97058]）决定是否继续走"光标贴屏幕顶 / 松开 Alt ⇒ 弹系统对话框"那一支（raw 141038-141043）。0x148/0x149 的读写往返本身已实现（test/engine-fields-t0161.test.ts），缺的是消费端（点击去抖 + 系统对话框）。", "ticket": "T-0161", "raw": "141038-141043" }
```

`0xd9` 的 `missing-consumer`（返回值 `-4097`）**不要登记为缺口** —— 见 §4.2（前提被推翻）。

### 3.2 `analysis/opcodes.json`：两条 `semantics` 订正

```jsonc
// entries[opcode==0x2e9].semantics —— 键名订正（旧文本里的 AutoMessageSpeed / AutoMessageMinTime 不存在）
"**ADV 自动翻页的「行基准」**（`tickets/T-0076`）：`_this[122464] = op1`（raw 33584-33586；写侧无门无变换）。★该字段**不是死写**：引擎有两个消费点 —— ① raw 28556-28586（0x72 尾段）/ raw 20384-20399（等待泵）：`ms = (该窗文本行数 − 1 − 基准) × message:AutoMessagePitch{0,1} + message:AutoMessageTime{0,1}`，`if (ms <= 100) ms = 100` 交 `sub_453A60`/`sub_453BD0`；② raw 20416-20426（等待泵另一支，被 `122501` 门控）：`(行数 − 基准)`（**不减 1**）。复位路径 raw 17987 清 0。★4 个 AutoMessage* 键的引擎字符串见 raw 4309-4313；**没有** `message:AutoMessageSpeed` / `message:AutoMessageMinTime`。emulator：写侧 + 消费点①已实现（`armCoexistAutoMessage` / `#autoMessageInterval`，T-0151），消费点②仍是缺口（见 T-0161）。语料 **480 处 / 330 脚本**。"

// entries[opcode==0x2eb].semantics —— 第 2 层的来源订正
"**读配置字符串 `set:GameVersion` → op1**：走配置对象 vtable+8 的查询（raw 42583）→ `sub_40C210(v3,v2,strlen(v2))` 拷串（**对空串无兜底**）→ `sub_433310(this,1,串)` 写 op1（raw 42589）。键值三层：① 构造注入内建 `\"1.00\"`（raw 111627-111629，`a100`；raw 5017）；② **大写键 `GAMEVERSION`** 的注册表数据块应用器 `sub_494220`（raw 112426-112433，配置对象 vtable 第 3 项 `.data:00529808`）——★**不是** `SYS4REG.INI` 的 `[set]` 节：INI 装载器 `sub_492CB0`（raw 111846-112310）逐条读了 60 余个键、**没有这个键**；③ `set:VerRegPos` 非空时用注册表 `DisplayVersion` 覆盖（`sub_490010` raw 110485-110502，查不到退 `\"1.00.0000\"`；写回 raw 112835-112851）。emulator 取舍：不做注册表（跨平台/免安装），取值 = 生效 INI 的 `[set] GameVersion`，**空串与缺键一律回落 `DEFAULT_GAME_VERSION`**（= 被模拟 exe 的 FileVersion `1.07.0019`，≠ 引擎内建 `1.00`）。语料：`TITLE.txt:583-592` 画成 \"Version 1.07.0019\"。"
```

### 3.3 `analysis/engine-capabilities.json`：两条 `emulator` 块替换

`msgwin-cancel-key-state`（stale-ledger，P2）—— `emulator` 块整块替换：

```json
"emulator": {
  "status": "partial",
  "evidence": "E2",
  "guard": "test/adv-msgwin.test.ts#set:CancelMesSkipOnClick 下按住 ⇒ 三态机进 stage2 · test/config-t0161.test.ts#门控键名 == 权威键名",
  "note": "三态机本体已实现（`Engine.serviceAdvanceWait` 内，掩码 bit4 = 鼠标左键驱动 122370: 0→1→2，到 2 时清 ADV + 复位 ReadTextSkip）。★门控键**订正**（T-0161 读体）：是 `set:CancelMesSkipOnClick`（raw 4346 `aSetCancelmessk[25]`；门 = raw 20115 `!(GetConfig(...))` ⇒ **非 0 即开**，`== 2` 只是门内的一条额外收尾分支 raw 20133），**不是** `set:CancelMessageKey`（该串在 raw 里 0 次）。它既在权威键表（`configRegistry.ts:77`，`kind:int, def:0`）也在工程证据 INI 里 ⇒ 三态机休眠是因为**取值 0**，不是"随包 INI 没有该键"（旧 note 的两条事实都反了）。遗留（另票）：`src/vm/engine.ts:793` 的行内注释仍写旧键名（值是读对的）；三态机的**极性**见本条 overreach finding —— 0→1 发生在该位为 **0** 的那一帧（else 分支），按下只驱动 1→2。"
}
```

`msgwin-line-fade-window`（missing-behavior，P2）—— `emulator` 块整块替换：

```json
"emulator": {
  "status": "partial",
  "evidence": "E2",
  "guard": "test/draw-item-anim-window.test.ts（动画窗机制）· 缺：消息窗行接线（T-0161 登记）",
  "note": "**已建模**：DrawItem 颜色动画窗本体（整数截断插值、共享起点、窗末收尾）。**未建模（T-0161 读体确证）**：消息窗每行的淡入色窗从未被建立 —— 引擎在排版落点（`sub_45BE20` 为每行建 DrawItem 之后）raw 72336-72348：`if (*(int*)(_this+1376) > 0 && *(int*)(_this+235128) > 0) { sub_4ACF60(drawContainer, item, 0, 0xFFFFFF); sub_4AD0C0(drawContainer, item, 0, *(int*)(_this+1376) * *(int*)(_this+235128) / 100, -1); }`（`_this` = Font 基址 ⇒ +1376 = `message:MessageSpeed`、+235128 = `message:MessageFade`；时长是**整数除法**，两字段都必须 > 0）。emulator 侧 `engineConfig.ts` 的绑定只把值灌进字段、无任何消费者 ⇒ 正文"瞬现"；`MessageFade = 0`（随包默认）时与引擎**完全一致**，故回归集看不见。落点 = `src/vm/handlers/msgwin.ts` 的排版路径 + `renderer/drawitem/animWindow.ts`；守卫应断言 `dur === MessageSpeed * MessageFade / 100` 且 `MessageFade = 0 ⇒ 不建窗`。"
}
```

### 3.4 `analysis/functions.json`：候选**新增**条目（本票读体时定位到的载体/落地函数）

```jsonc
{ "addr": "0x494220", "raw_name": "sub_494220", "semantic_name": "config_applyRegistryBlob_494220", "op": null, "status": "ANALYZED",
  "purpose": "配置对象的**注册表数据块应用器**（vtable 第 3 项，`.data:00529808`，同表 = sub_492CB0/load / sub_490590/save / sub_491060）。吃一个 `key\\0value\\0…` 序列化块，用**大写**键名逐个 `_stricmp` 后写进配置注册表（字符串族 `sub_434E00`、int 族 `sub_434D00`）。",
  "evidence": "raw 112319-112853；键名常量 `String1=\"REGROOTPATH\"`(raw 5107)、`aVerregpos=\"VERREGPOS\"`(5105)、`aGameversion=\"GAMEVERSION\"`(5104)；`GAMEVERSION` 支 raw 112426-112433、`VERREGPOS` 支 raw 112410-112424、`REGROOTPATH` 支 raw 112378-112392；`set:VerRegPos` 非空后的注册表覆盖 raw 112835-112851（调 sub_490010）",
  "notes": "★`0x2EB` 的第 2 层来源 —— 与 `SYS4REG.INI` 的 `[set]` 节**无关**（INI 装载器 `sub_492CB0` 不读 `set:GameVersion`）。这条是本轮 T-0161 订正审计前提的关键证据。" }
{ "addr": "0x4034D0", "raw_name": "sub_4034D0", "semantic_name": "engine_reportDiagnostic_4034D0", "op": null, "status": "ANALYZED",
  "purpose": "**引擎的诊断/错误串出口**：`sub_4034D0(this, str)` → `sub_4976A0(this[1], str)`。",
  "evidence": "raw 9433-9435",
  "notes": "★不是消息窗：全链 `sub_4976A0`(raw 114428-114457，栈帧在时前缀 `(%s：%d行目) `) → `sub_497620`(114402-114416) → `sub_438CC0`(45660-45667 = `WriteFile` 到 remote-debug 句柄) ⇒ **只写日志**：不弹窗、不中断、不写操作数。0xC5/0xC7/0x141/0x1B8/0x2E6 的越界支共用它。" }
{ "addr": "0x4976A0", "raw_name": "sub_4976A0", "semantic_name": "remoteDebug_writeWithLocation_4976A0", "op": null, "status": "ANALYZED",
  "purpose": "给诊断串加 `(文件：行目) ` 前缀（脚本栈帧存在时）后交 `sub_497620`。",
  "evidence": "raw 114428-114457（`sprintf_s(v4, v5+1024, \"(%s：%d行目) %s\", sub_454FA0(...), v8, lpBuffer)`）" }
{ "addr": "0x497620", "raw_name": "sub_497620", "semantic_name": "remoteDebug_write_497620", "op": null, "status": "ANALYZED",
  "purpose": "remote-debug 通道写出（先试回调、失败则 `sub_438CC0` 直接 WriteFile）。",
  "evidence": "raw 114402-114416" }
{ "addr": "0x438CC0", "raw_name": "sub_438CC0", "semantic_name": "logFile_write_438CC0", "op": null, "status": "ANALYZED",
  "purpose": "日志文件 `WriteFile`（句柄 = `this[1]`，为 -1 时什么都不做）。",
  "evidence": "raw 45660-45667" }
{ "addr": "0x4765C0", "raw_name": "sub_4765C0", "semantic_name": "queryEngineRunFlag_4765C0", "op": null, "status": "ANALYZED",
  "purpose": "**导出给脚本/宿主的布尔查询**：`return *(_DWORD *)(dword_55E1BC + 699248) != 0;`（= `_this[174812]`，0x142 写的那个运行开关）。",
  "evidence": "raw 91057-91061；字段全库 4 处引用 = raw 22591/17961（构造/复位置 1）、31026（0x142 写）、91060（本函数读）",
  "notes": "工程内**零调用**（导出 API）⇒ emulator 无对应 opcode ⇒ 该字段的消费者在 emulator 侧缺席（T-0161 登记，不编消费者）。同族邻居 sub_4765E0(effect_flags bit26)/sub_476600(effect_flags < 0)。" }
{ "addr": "0x426620", "raw_name": "sub_426620", "semantic_name": "op_set_auto_message_baseline_426620", "op": "0x2E9", "status": "ANALYZED",
  "purpose": "`_this[122464] = readIntOperand(1)`（ADV 自动翻页的行基准）。",
  "evidence": "raw 33579-33589（`arity 槽 = 1` → `result = sub_41BF50(_this, 1); _this[122464] = result; return result;`）",
  "notes": "★opcodes.json 早就有这一条，functions.json 缺 —— 两个消费点见 entries[0x2e9].semantics（raw 20384-20399 / 28556-28586 / 20416-20426）。" }
{ "addr": "0x408440", "raw_name": "sub_408440", "semantic_name": "showMessageImage_load_408440", "op": null, "status": "ANALYZED",
  "purpose": "消息态图像加载：解码资源并渲进 Scene 的固定帧纹理；`sub_4A7210(...) != 1` 时 `_CxxThrowException(&_TI1_AVCommand_ShowMessage_Exception__)`。",
  "evidence": "被 0x25B 调（raw 33219）；body raw 13147-13155",
  "notes": "★失败**抛异常** ⇒ 影响控制流（脚本侧弹消息窗并中断）。emulator 未建模（T-0161 登记）。" }
{ "addr": "0x4A5470", "raw_name": "sub_4A5470", "semantic_name": "scene_mediaDispatch_4A5470", "op": null, "status": "ANALYZED",
  "purpose": "Scene 侧媒体/影片下发（0x25A 的两条门各调一次）。",
  "evidence": "raw 33198-33199（模式镜像 `_this[92377]==0`）、raw 33200-33201（`!_this[167990]`）",
  "notes": "宿主媒体子系统；emulator 未建模，且门的输入 `92377` 在 emulator 无维护者（T-0161 登记）。" }
{ "addr": "0x408050", "raw_name": "sub_408050", "semantic_name": "safeSprintf_408050", "op": null, "status": "ANALYZED",
  "purpose": "格式化进固定缓冲（越界诊断串的统一构造点，等价 `sprintf_s`）。",
  "evidence": "被 0xC5(38659)/0xC7(38715)/0x141(31008)/0x1B8(38060)/0x2E6(40368) 调用" }
```

### 3.5 `analysis/fields.json`：候选新增字段

```jsonc
{ "offset": "0xA30D0", "type": "uint32_t", "name": "draw_mode", "scope": "Engine",
  "meaning": "DrawMode（_this[166964]=byte 667856）：==1 ⇒ D3D 路径（0x32 StretchTexture、0x1AE/0x1AF 的 .STH 分支都按它分岔）。0x201(sub_4302B0) 读回。写点：构造 raw 23572-23574 `*(a1+667856) = GetConfig(set:DrawMode)`、主循环/复位后 raw 35271-35273（同形、无条件）、清零 raw 17979、脚本端 0x200/sub_423170 raw 31372（带 set:CreateObject 位门，不满足报 `aComsetdrawmode` 且不写）。",
  "evidence": "raw 23572-23574、35271-35273、17979、31372、39859-39863；667856 = 166964*4 = 0xA30D0（紧邻的 0xA30D4 = 166965 = 既有条目 engine_bool_flag）",
  "status": "confirmed" }
{ "offset": "0x77980", "type": "uint32_t", "name": "auto_message_baseline", "scope": "Engine",
  "meaning": "ADV 自动翻页的「行基准」（_this[122464]=byte 489856）：0x2E9(sub_426620 raw 33584-33586) 原样写。消费点两个：① raw 28556-28586 / 20384-20399：`(该窗文本行数 − 1 − 本字段) × message:AutoMessagePitch{0,1} + message:AutoMessageTime{0,1}`，夹 `<=100 ⇒ 100`；② raw 20416-20426（被 _this[122501] 门控）：`(行数 − 本字段)`（不减 1）。复位 raw 17987 清 0。",
  "evidence": "raw 33584-33586(写)、28568-28585、20384-20399、20416-20426、17987(复位)；489856 = 122464*4 = 0x77980",
  "status": "confirmed" }
{ "offset": "0x5D88C", "type": "uint32_t", "name": "dispatch_saved_flags", "scope": "Engine",
  "meaning": "派发前保存的 effect_flags（_this[95779]=byte 383836）：control.ts 的 dispatchNextRequest 存（sub_40FB60 raw 18980 一带）/ exit 的 -10 哨兵还原（raw 25661-25673）；0xD9(sub_419970 raw 24946-24947) 在 _this[124350] 非 0 时清其 0x1000 位。",
  "evidence": "raw 24946-24947、25661-25673、18980；383116 = 95779*4 = 0x5D88C",
  "status": "confirmed" }
{ "offset": "0x5A36C", "type": "uint32_t", "name": "msg_media_mode", "scope": "Engine",
  "meaning": "消息态显示模式（_this[92379]=byte 369516）：0x25A 写 1（影片，raw 33193）、0x25B 写 2（图像，raw 33211）；同族 _this[92380]=影片 id（0x25A）、_this[92381]=图像 id（0x25B）。emulator 无消费者（sub_4A5470 宿主媒体层未建模）。",
  "evidence": "raw 33193、33211-33212、33198-33201；369516 = 92379*4 = 0x5A36C",
  "status": "confirmed" }
```

### 3.6 `analysis/scripts.json`

本票**无脚本级结论变更**：涉及的语料只有 `CONFIG1.txt:1627 i0c7` / `CONFIG1.txt:2276 i0c5`（选择器是运行期算出的
`local-int 57c3`，恒 0..4）、`TITLE.txt:583-592 i2eb`、以及 `i2e9` 480 处 —— 它们的语义/结构记录不变。

---

## 4. 被本票**推翻**的审计前提（逐条引 raw）

### 4.1 `0x2eb` 的第 2 层不是 INI `[set]` 节

审计（与 `opcodes.json`/`config-read.ts` 旧注释）写「INI `[set] GameVersion` 覆盖（raw 112426-112433）」。
**读体**：raw 112426-112433 在 **`sub_494220`**（raw 112319 起）体内 —— 它吃 `a2` 的 `key\0value\0…` 序列化块，
匹配的是**大写**键名 `GAMEVERSION`（`aGameversion`，raw 5104）；该函数只出现在配置对象 vtable 第 3 项
（`.data:00529808`）。而 `SYS4REG.INI` 的装载器 **`sub_492CB0`**（raw 111846-112310）逐条 `sub_4957F0`/`sub_495950`
读了 60 余个键，**列表里没有 `set:GameVersion`**（同函数内出现的字符串键只有 SaveBMPPath/Font/FunclstPath/
DebugComputerName 四个 + 全部 int 键）。
⇒ 第 2 层是**注册表数据块**路径。emulator 的"INI → 缺省"两层本身是替代物；由此**空串在引擎侧不可达**
（第 1 层恒注入 `"1.00"`），本票据此把空串当"未指定"。

### 4.2 `0xd9` 的返回值无人接收

审计写「若 VM 步进器把 handler 返回值当作跳转/终止码…（引擎里这个返回值确实被上层接收）」。
**读体**：派发器唯一调用点 raw 20161-20165
```c
v7 = *(_DWORD *)_this[30 * _this[95776] + 95782];
if ( v7 > 0x3FF ) sub_418E30(_this);
((void (__thiscall *)(int *))_this[v7 + 168999])(_this);   // ★强转成返回 void ⇒ result 被丢弃
```
且 `.lst` 里 `sub_419970` 只有 `DATA XREF: sub_415640+1164`（装表）——**没有**第二个调用点。
⇒ `-4097` 是死值；emulator 的 `OpHandler` 类型（`void | Promise<void>`）与之一致。**不是缺口**。

### 4.3 `0x141` 的越界串不是"玩家可见的提示"

同 §4.1 的链路证据：`sub_4034D0`(raw 9433-9435) → `sub_4976A0`(114428-114457) → `sub_497620`(114402-114416)
→ `sub_438CC0`(45660-45667) = `WriteFile`。⇒ 与 `0xC5` 一样只是诊断。本票的处置 = 让日志**带上引擎那句常量**，
而不是新造消息窗/异常（新造会与真机相反：真机不中断脚本）。

### 4.4 `0x2e9` 的公式键名不存在

审计原文写 `message:AutoMessageSpeed` + `message:AutoMessageMinTime`；两处消费点实际用的是
`message:AutoMessagePitch{0,1}` + `message:AutoMessageTime{0,1}`（引擎字符串 raw 4309-4313）。已订正注释与守卫。

### 4.5 `0x201` 的"唯一脚本写入端是 0x200"

引擎对 `_this[166964]` 有 4~5 个写点（见 §1 第 9 行）；且脚本端 `0x200` 的写是**带门**的
（`1<<op1` 必须在 `set:CreateObject` 位图里，否则报 `aComsetdrawmode` 且不写，raw 31372-31380）。
另外 `engine.ts` 早已用 `cfgInt(config, setDrawMode) === 1` 做 wait-gate 分叉 ⇒ 配置**被消费过**但没落到字段上。

---

## 5. 别人该接的（明确文件 + 判据）

| # | 归属 | 文件 | 内容 |
|---|---|---|---|
| 1 | `engine.ts` 所有者 | `src/vm/engine.ts` | ① 构造与整体复位把 `engineValues[scriptEngineFlag] = 1`（raw 22591/17961）；② `engine.ts:793` 的注释键名 `set:CancelMessageKey` → `set:CancelMesSkipOnClick`（**值是读对的**，line 794 用的就是 `CFG.setCancelMesSkipOnClick`）；③ 三态机极性：0→1 发生在该位为 **0** 的那一帧（raw 20119-20126 的 else 分支），按下只驱动 1→2（audit `msgwin-cancel-key-state overreach`，建议守卫 = 四拍序列：空闲帧⇒1、按住⇒2、松开⇒0 且 ReadTextSkip 写 0、ADV 清）。 |
| 2 | `msgwin.ts` / renderer 所有者 | `src/vm/handlers/msgwin.ts` + `src/renderer/drawitem/animWindow.ts` | 消息窗**行淡入色窗**接线：排版落点为每行建 DrawItem 后，`MessageSpeed>0 && MessageFade>0` ⇒ 设色 `0xFFFFFF` + 起窗 `dur = MessageSpeed*MessageFade/100`（整数除法）；`MessageFade=0` ⇒ 不建窗。raw 72336-72348。 |
| 3 | 宿主媒体缝所有者 | `src/vm/native.ts` + `src/vm/nativeTap.ts` + renderer | `0x25B` 的图像加载分支（`sub_408440`，失败抛 `Command_ShowMessage_Exception`）与 `0x25A`/`0x25B` 的 `sub_4A5470(Scene,id)` 下发；门的输入 `_this[92377]`（模式镜像）在 emulator **无维护者**，要一起建。 |
| 4 | 主 agent（串行结算） | 六份真源 | §3.1~§3.5 的片段；另：`analysis/opcode-gaps.json` 里 `0x2e9` 的 note 键名订正；`0xd9` 的返回值条目**不要**登记为缺口。 |
| 5 | 主 agent | `tickets/T-0111` | `--validate` 报 `T-0111 evidence 锚点已消失：[0x308, op_stub_unhandled]` —— 该票**自己**把 `0x308` 改名成 `op_engine_internal`（`stubs.ts` 工作区已改）但没改指 evidence；不是 T-0161 的范围。 |
| 6 | 主 agent（可选刷新） | `tickets/T-0110 evidence[3]` | `app/amayui-emulator/src/vm/engineFieldIds.ts` 的 anchor `engineBool: 166965` 行号已从 117 漂到 166（本票 + 另一 agent 都在该文件插入注释）⇒ `--validate` 出一条"行号已漂移"**警告**（不是失败）。因为该文件仍在被并行编辑，刷了会再次漂。 |
| 7 | `test/` 注释漂移 | `test/engine-field-store.test.ts:112-113` | 注释仍写「消费端（自动翻页时长）emulator 尚未实现 ⇒ 见 T-0076」——T-0151 已落地，应改成"消费端见 `armCoexistAutoMessage`/`#autoMessageInterval`"。 |
| 8 | `test/op-a5.test.ts` | 同 | 若日后要撤 `Engine.dispatchSavedFlags`（让 `engineValues[95779]` 成为唯一存储），需同时重定向 `:182-188` 的三段断言。本票**没动**它。 |
| 9 | ★**已修（本票动手，经主 agent 批准）** | `src/configRegistry.ts` + `test/config-keys.test.ts` | **真缺陷（不在最初 18 行内，读体时发现）**：`set:DependMovieSound` 曾在 `CONFIG_REGISTRY_KEYS` 里出现**两次**（sound 段新增 `kind:'int', def: 0` + 原条目 `def: 1`）。**为什么静默**：两个消费点方向**相反** —— ① `CONFIG_REGISTRY_DEFAULTS = new Map(...)` ⇒ **后写者胜**（`registryDefault()` 回 **1**）；② `engineConfig.ts` 的 `formatIni()` 用 `seen` 去重 ⇒ 缺值时写进 INI 的是**先出现那条**（`def: 0`）；③ 表头声明「顺序 = `sub_491880` 构造顺序」也被破坏。⇒ 同一份表对"内建默认值"给出两个答案。**raw 判据**：raw 111728-111739 的注入顺序 TexHeight(2048)→CreateObject(1)→DrawMode(0)→**DependMovieSound(1)**（raw 111734-111735）→WheelKeyUp(3)→WheelKeyDown(1) ⇒ 只保留原条目 `def: 1`。**处置**：删掉 sound 段那条重复 + 在 `test/config-keys.test.ts` 补"权威键表不得有重复 key"守卫（同时断言 `CONFIG_REGISTRY_DEFAULTS.size === CONFIG_REGISTRY_KEYS.length`，抓"Map 静默去重"形态）。红→绿：`fail 1 / pass 3`（报 `set:dependmoviesound ×2`）⇒ `fail 0 / pass 4`。 |
| 10 | 顺带确认（本票用到的 raw） | — | `set:DrawMode` 的内建默认 = **0**（raw 111732-111733 `v13 = 0; sub_434D00(v2, aSetDrawmode, &v13);`）⇒ 与 `configRegistry.ts` 的 `def: 0` 一致，本票的 0x201 绑定不会因此偏。 |
| 11 | ★**已修（本票动手）** | `src/vm/operandPlan.ts:1421` | `0x308` 的排除说明原写"emulator 是 `op_stub_unhandled` 桩"⇒ 已改指为：handler `sub_426B20`（raw 33808-33815，arity 3 ⇒ argc 1）调 `sub_407B20(Engine, _this[96981], op1)`（raw 12579-12618 = `LoadLibraryA` + `GetProcAddress("UnregisterTouch…"/ProcName)` 的**触摸 DLL 转交**，体内只额外写 `_this[1954]`）⇒ emulator 无该宿主触点，`0x308` 已按「有据 no-op」移入 `ENGINE_INTERNAL_OPS`（`handlers/stubs.ts` 的 `[0x308, op_engine_internal]`，T-0111/T-0163），**仍属 C 类**（引擎读了、实现无消费端）。 |
| 12 | 主 agent 改（**不归本票**） | `test/opcode-operands.test.ts:53` | 白名单**文本**措辞过期（**条目本身仍需要**）。`old` = `'0x308': 'STUB_NATIVE_OPS 的 unhandled 桩（op1/Engine[1954] 未建模；见 stubs.ts 注释）',`；`new` = `'0x308': '有据 no-op（已从 STUB_NATIVE_OPS 移入 ENGINE_INTERNAL_OPS；体 = sub_426B20 raw 33808-33815 → sub_407B20 raw 12579-12618 的 LoadLibraryA/GetProcAddress 触摸 DLL 转交，emulator 无该宿主触点；只会额外写 Engine[1954]。见 stubs.ts 的 [0x308, op_engine_internal] 与 tickets/T-0111）',` |
| 13 | 结论（与主 agent 一致） | — | **`0xDD`（221）不是本作指令**：派发表基址 = `_this + 675996`（= dword 168999，raw 20164 的 `_this[v7 + 168999]`），初始化是 raw 22722 `memset32(_this + 675996, (int)sub_418E30, 0x400u)` + 逐槽赋值（例：raw 22723 槽 1 = `sub_418E60`、raw 22969 槽 217 = `sub_419970`）。**槽 221 的字节地址 676880 在全篇零出现** ⇒ 保持 memset 默认 = `sub_418E30`（raw 24407-24415：`_CxxThrowException` 抛 `Command_ShowMessage`，消息串 `asc_51FB60` = "このコマンドはサポートされていません．"，raw 4395）⇒ 真机执行 `0xDD` 只会得到"不支持该命令"，**不是缺表行**。`analysis/opcodes.json` / `opcode-gaps.json` 里也都没有 221（邻居 216=0xd8 / 217=0xd9 / 218=0xda 在册）。 |
| 14 | ★**已修（本票动手，响应主 agent）** | `test/config-t0161.test.ts` / `test/engine-fields-t0161.test.ts` | 两个新文件原声明 `@tier T1` 且自造 `mk()` ⇒ 触红 `test/organization.test.ts:41`（T1 无资产证据：`actual: ['config-t0161.test.ts','engine-fields-t0161.test.ts']`）与 `test/harness-convergence.test.ts`（新增 mk 变体）。**处置**：两个文件都改成 **T0**（只用合成 INI 与合成指令，不依赖任何未入库资源）+ 夹具改用 `harness.mkEngine` + `stepOnce`（工厂名 `rig()`，**不再出现** `mk(` 变体）。★未改基线文件（`harness-convergence.baseline.json` 不归本票，且棘轮要求"基线只许收缩"）。红→绿：`organization` 6 项里 1 红 + `harness-convergence` 3 项里 2 红 ⇒ 合并跑 `fail 0 / pass 29`。 |

## 2026-09-24



---

## 6. 进度（留 doing 的理由）

- 判据③ `cd app/amayui-emulator && npm run verify` **本机跑不了**（无 `node_modules/.bin`）⇒ 以
  `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`（exit 0）+ 相关测试文件（99/99 绿）替代；
  运行期还有 9 个 agent 在并行改 `src/**`，`test:all` 的红不全属本票。
- 3 条"如实登记为做不到"要落在**别的可写路径**内（`engine.ts` 构造/复位、宿主媒体缝、msgwin/renderer 接线）
  ⇒ 台账片段见 §3、归属见 §5。
- 真源（六份）不归本票写 ⇒ §3 的片段等主 agent 串行结算后才算闭环。
