# 引擎分析（docs/engine）· 权威 README

> ⚠️ **已废弃（deprecated）**：本文件是**旧的「引擎分析」权威 README**，其重定型管线（`engine/engine.cpp`、libclang/AST 文本改写）已被**数据驱动方案**取代。
> 现行权威口径见 **`docs-new/03-engine/*`**（`opcode-table.md`/`operands.md`/`vm-opcodes.md`/`runtime-memory.md` 等）+ 数据层 **`analysis/fields.json`**、**`analysis/functions.json`**；原始只读基准 `engine/天结_unpacked.exe_utf8.c`。以下内容仅作历史参考。
>
> **地位**：这是「**游戏引擎分析**」方向的**新版权威 README**，收敛并取代旧散篇
> （`docs/re/engine/*`、`docs/re/README.md` 中属于引擎的部分、`app/amayui-emulator/docs/*`）。
> 旧散篇**保留为详细参考**，本文件用相对链接指向它们；两者口径不一致时，**以本文件 + `docs/re/README.md` 地址表为准**。
> 与本方向相关的落地重写工程见 `app/amayui-emulator/`（结论已被本文件吸收，见 §8）。

## 1. 分析对象与素材

| 素材 | 说明 |
|---|---|
| `raw/AGE.EXE` | 原版引擎（1,007,104 B，ASProtect 加壳） |
| `raw/天结.exe` | 心愿屋汉化壳（同壳 + 18.9MB 加密 overlay；**方案 B 弃用**，见 docs/translation） |
| `raw/天结_unpacked.exe` | **已脱壳干净版**（1,746,944 B）—— 分析主对象 |
| `engine/天结_unpacked.exe_utf8.c` | Hex-Rays 全量反编译 C（**主力**，UTF-8） |
| `engine/天结_unpacked.exe_utf8.lst` | IDA 清单（含数据区） |
| `engine/engine.hpp` | `this` 对象模型：把已确认偏移落成 `struct Engine` C++ 布局（未知区 char 占位） |
| ~~`engine/engine.cpp`~~ | ⚠️ **已废弃**：`scripts/re/retarget.py` 重定型管线产物（libclang/AST 文本改写已放弃） |
| `docs/re/engine/*` | 旧散篇（15 篇 + README + `member_functions.detected.txt`），本方向的详细出处 |

> ⚠️ 原始 `engine/天结_unpacked.exe.c` 为 Shift-JIS、`.lst` 为 Shift-JIS+GBK 混编，`read` 工具读不了；
> 一律改读 `*_utf8.*`。

## 2. 核心结论（三级事实度：✅已确认 / 🟡推测 / ⬜未解）

### 2.1 引擎本体与反汇编管线
- ✅ 引擎是**通用 AGE/System4 解释器**，本身**不含任何「单位/掉落字段」语义**；字段语义全在 src 字节码（业务层，见 docs/data）。
- ✅ 加壳判定：`AGE.EXE`/`天结.exe` 为 ASProtect；`天结_unpacked.exe` 为干净脱壳版（OEP/段落/导入已重建）。
- ⚠️ ~~反汇编→重定型管线~~（**已废弃**）：~~`scripts/re/hexrays_prep.py`（`this`→`_this` 预处理）→ `scripts/re/retarget.py`
  （签名替换 + 字段标记 + 调用点 `this->` + 语义命名，`semantic_names.json`）→ `engine/engine.cpp`~~。
- ✅ 成员函数识别：`scripts/re/detect_members.py`（高偏移定位基准 + 调用图双向传播），清单
  `docs/re/engine/member_functions.detected.txt`（1239 个）。🟡 部分成员识别边界仍需复核。

### 2.2 VM / opcode 分发
- ✅ **opcode 分发 = 一维函数指针表**：`this + 0x0A509C + 4*opcode`，表上限 0x400（opcode 0..0x3FF），默认 handler `sub_418E30`；在 `Command` 构造器 `sub_415640` 初始化。
- ✅ **解释器主循环 = `sub_412290`**（`__noreturn`）：读 opcode → `dispatch_table[opcode](this)` → 按 arity 推进 IP。
- ✅ opcode→handler 全量表：`docs/re/engine/06-opcode到handler映射表.md`（544 条 + 具名助记符 + 回退默认清单）。
- ✅ 已排除：`off_5530E0/5530E8` 是游戏对象/类型方法表，**不是** opcode dispatch。

### 2.3 操作数访问原语（指针=带标记引用）
- ✅ 读 int/float 操作数：`sub_41BF50`（int）/ `sub_41C300`（float）——按 type 分支 + `DEC` 去混淆，含 `0x8003/0x8009` 整型数组批量。
- ✅ 写 int/float：`sub_42B4B0`（int）/ `sub_42BA00`（float，`ENC` 为 `DEC` 逆运算）。
- ✅ 地址/指针原语：`sub_42AEA0`（取操作数内存地址/指针，`operandAddress`）/ `sub_418B90`（写指针型操作数槽）——为 `lea`(0x63)/`memcpy`(0x1B0) 底座。
- ✅ **`DEC`/`ENC`（ADR-011 指针模型配套）**：`DEC(x)=ror32(key ^ rol32(x,11),25)`、`ENC(x)=rol32(key ^ ror32(x,7),21)`；`this+0x5EC8C`（DWORD 索引 `_this[97059]`）= `key`，`_this[97060]=ENC(0)`。
- ✅ **指针=带标记引用**（`Ref={scope,kind,index,stride}`）：读解引用、写写穿；**指针不当数值**（`lea`/`lookup-array`/`memcpy` 的模拟隐患）。详见 `app/amayui-emulator/docs/07-pointer-operand-model.md`。

### 2.4 引擎侧地址（仅限引擎内部，与业务数据解耦）
> ⚠️ **边界**：下面只列**引擎内部**（解释器/`this` 对象/资源加载）的地址。**游戏业务数据**（掉落、技能、物品、地图等）
> 的内存地址属于「**游戏业务数据**」域（`docs/data/README.md`），**与引擎内部无必然联系**；除非有确切证据
> （如经进程内实测读取并与脚本语义互证），**不把引擎与游戏业务字段联系起来**。

| 地址 | 含义 |
|---|---|
| `this+0xA509C` | opcode→handler 函数指针表基址（下标=opcode，上限 0x400） |
| `this+0x5D800` | 全局 variant 数组基址（`global_int_base`） |
| `this+0x5EC8C` | `DEC/ENC` 的 key（DWORD 索引 `_this[97059]`） |
| `this+0x5D880` | `frames[40]` 帧数组基址（帧距 0x78；★曾误记 0x5D894 —— `this+0x5D894` 只是 frame0 的 `str_table` 槽 = 帧+0x14） |
| `this+0x5D880/5D884/5D888` | 调用栈链接字段（`callde/return` 压弹栈） |

> 业务数据地址（如 `0x53e104` 掉落、`0x1d4f4` 技能名、`0x5697a` 随机池等）**不在本文件**，见 [`../data/README.md`](../data/README.md)。

### 2.5 数据读取逻辑（统一文件 id 空间 + 启动链 + 渲染资源）
- ✅ **统一文件 id 空间**：本体 `SYS4INI.BIN`(S4IC, 300B 头) + 5 个 `APPEND01..05.AAI`(S4AC, 268B 头，**包号=头部 @264**)；
  统一 id = `pack#<<24 | idx`。已实测：SO006=`0x5245`、SO005=`0x5246`、SO004=`0x5272`、SO004A=`0x5273`、TITLE.MTN=`0x5274`、TITLE.BIN=`0x5264`。
- ✅ **启动链**：`SYSTEM4(0)` → 数据表 INIT（AMINIT2/WDINIT/ALINIT/EBINIT/ITINIT/SKINIT/CGINIT/BTANINIT2…）→ `INIT` → `TITLE.BIN`(0x5264, 622 指令)。
- ✅ **纹理 slot ↔ AGF 文件**：`set-texture <imgid> <slot>` 是唯一绑定，`[5*slot+466]=imgid`，imgid→`resolveEntry`→文件名；
  与 `draw-texture` 的 **tex 句柄**（图形子系统独立句柄，如 `0x30d40`）是**两个索引空间**，勿混淆。详见 `app/amayui-emulator/docs/10-texture-slot-to-agf-file.md`。
- ✅ **LOGO 场景/标题背景**：标题背景/版权来自 `LOGO.txt`（set-texture SO006/SO005）；LOGO 专用 opcode `0x1F8(create-texture)/0x1FA(release-texture)/0x20F(play-movie)`。
- ✅ **FadeTimer 与 fade opcode**：FadeTimer 步进计时器（7 DWORD+vtable）+ fade 家族 0x20–0x38（SetFade/SetLineFade/SetRandomFade，`sub_41D180…`→`sub_441410(mode)`）；静态「颜色/α」指令 0x202/0x203（`sub_4AD0C0/0x4ACF60`）。详见 `app/amayui-emulator/docs/11-fadetimer-and-fade-opcodes.md`。
- ✅ **绘制模型**：回缓冲分辨率 1280×720（config 默认 640×480 但实际 draw 以 1280×720 为准）；`draw-texture tex layer x y w h p q` → 目标矩形 `(x,y,x+w,y+h)`，`p/q` 转 float（scale/alpha，待渲染层定）；`set-texture` 失败弹「画像ファイル %s の読み込みに失敗しました」。

## 3. 旧散篇导航

| 主题 | 详细出处 |
|---|---|
| 脚本字节码格式与工具链 | [`../re/engine/00-脚本字节码格式与工具链.md`](../re/engine/00-脚本字节码格式与工具链.md) |
| 加壳与拆壳 | [`../re/engine/01-加壳与拆壳.md`](../re/engine/01-加壳与拆壳.md) |
| 引擎架构 / 解释器 | [`../re/engine/02-引擎架构.md`](../re/engine/02-引擎架构.md) · [`03-opcode分发与解释器.md`](../re/engine/03-opcode分发与解释器.md) |
| 运行时数组 | [`../re/engine/04-引擎侧运行时数组.md`](../re/engine/04-引擎侧运行时数组.md) |
| 操作数访问原语 | [`../re/engine/05-操作数访问原语.md`](../re/engine/05-操作数访问原语.md) |
| opcode→handler 全表 | [`../re/engine/06-opcode到handler映射表.md`](../re/engine/06-opcode到handler映射表.md) |
| 定位 this / 提取全局 | [`../re/engine/07-提取全局数据与定位this.md`](../re/engine/07-提取全局数据与定位this.md) |
| 脚本上下文与调用栈 | [`../re/engine/08-脚本上下文与调用栈.md`](../re/engine/08-脚本上下文与调用栈.md) |
| clang 解析 / 成员识别 / 重定型管线 | [`09`](../re/engine/09-clang解析与重定型基座.md) · [`10`](../re/engine/10-成员函数识别.md) · [`11`](../re/engine/11-重定型管线与产物.md) |
| 拆壳可行性 | [`../re/engine/12-拆壳可行性评估.md`](../re/engine/12-拆壳可行性评估.md) |
| 过桩型特征 / 桩实现 | [`13`](../re/engine/13-导入调用机制与过桩型特征.md) · [`14`](../re/engine/14-过桩型桩实现与静态反解.md) |

## 4. 与本方向相关的落地工程

`app/amayui-emulator/`（TS+Electron+PixiJS 重写 AGE VM 解释器）的结论已吸收本文件：
- M0–M3 达成（启动链到 TITLE.BIN、`npm test` 12/12、`tsc` 干净）；`docs/03` 为里程碑。
- 关键 ADR：启动层级、对象模型、`NativeBridge`、未实现 opcode 硬报错、32 位语义、ADR-010 函数级状态追踪、ADR-011 指针=带标记引用。
- Electron 渲染壳：`electron/main.ts`（窗口 1280×720 + IPC 文件流）、`src/renderer/pixiBackend.ts`（PixiJS v8）、标题真实图像已接入。
- 详见 `app/amayui-emulator/README.md` 与 `app/amayui-emulator/docs/*`。

## 5. 冲突与取舍（本轮收敛）

以下为旧散篇间出现过、已收敛的冲突点（采纳结论见右侧）：

| 冲突点 | 采纳结论 |
|---|---|
| opcode 分发是否是表 / 是否被 `off_5530E0` 误判 | 一维函数指针表 `this+0xA509C+4*opcode`；`off_5530E0/5530E8` 是方法表，已排除 |
| 指针操作数是「数值」还是「引用」 | 采纳 ADR-011：指针=带标记引用（读解引用/写写穿），不当数值 |
| 分辨率 640×480 vs 1280×720 | 以 **1280×720** 为准（背景源(0,0,1280,720)铺满；此前「1920×1080」判断来自错误的均匀列 dest 读数，已作废） |
| `key` 位置 | `this+0x5EC8C`（DWORD 索引 `_this[97059]`），与 engine.hpp byte 偏移一致 |
| 纹理 id 与 set-texture slot 是否同一空间 | 是两个索引空间：slot 由 `set-texture <imgid> <slot>` 绑定；tex 为图形子系统句柄 |
| boot→TITLE 是否触发 fade | 不触发（fade opcode 未被调用）；时间性淡入淡出由主循环场景切换驱动 FadeTimer |

## 6. 待确认 / 未解

- 🟡 `draw-texture` 的 `p/q` 参数语义（scale/alpha）未在渲染层最终定。
- ⬜ 视频（TITLE.MTN，步骤 2 播放）文件格式/播放方案未定；Live2D（SO004A）。
- 🟡 角色图层（标题左侧角色立绘）来源未定位（疑 L2D/角色显示子系统）。
- 🟡 数据载入 op（0xAB/0x190/0x19F/0x1A1）在 `opcodes.ts` 有表项但**尚未在 `ops.ts` 实现**（启动→TITLE 路径不触发）。

> 业务数据相关的待确认项（如技能数值字段 `0x6c65a2`）见 [`../data/README.md`](../data/README.md)，不在本文件。
