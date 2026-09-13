/**
 * 「引擎内部 / 宿主无对应子系统」的 opcode —— 显式记录并跳过（ADR-005 的插桩分支）。
 *
 * ## 只有一类：`op_engine_internal`（纯 no-op）
 * 表里**每一条都不读操作数、不写 VM 可见状态、不改控制流**。
 *
 * 历史上这里分过「纯 no-op」与「专门处理（已按引擎语义读操作数写状态）」两档，但那一档是
 * **结构性空**的：只要 handler 真的写了操作数或引擎字段，它就该注册进 `OPS`（`implemented`）
 * —— 例如消息窗字段读写（0x7F/0x80/0x300/0x301）、三数组排序（0x12F）、引擎开关（0x142）；
 * 剩下的只有"什么都不做"。因此那一档连同 `StepTrace.noop` 标志、控制窗里恒空的
 * 「已插桩·语义已实现」栏一起删除。
 *
 * ★判据（ADR-010 §10.2）：标为可忽略必须**读 handler 体**确认其对 VM 态
 *   （全局/局部 int·float·string·ptr、帧、IP、cur）无读写；每条右侧注释给出依据。
 */
import type { OpHandler } from '../step.js';
import type { OpTable } from './shared.js';

const stubSubsystem: OpHandler = (c) => {
  const name = c.instr.name;
  const args = c.instr.args.map((a) => a.raw);
  switch (c.instr.opcode) {
    case 0xb4:
      c.native.playSound?.(args[0] ?? 0, args[1] ?? 0);
      break;
    case 0xbf:
      c.native.playBgm?.(args[0] ?? 0);
      break;
    case 0xc4:
      c.native.playVoice?.(args[0] ?? 0);
      break;
    case 0x1fb:
      c.native.drawTexture?.(args);
      break;
    case 0x1f9:
      c.native.setTexture?.(args);
      break;
    case 0xcd:
      c.native.getInputType?.();
      break;
    case 0xc8:
      c.native.sleep?.(args[0] ?? 0);
      break;
    default:
      c.native.unhandled?.(c.instr.opcode, name);
  }
};

/**
 * 引擎内部/子系统操作：不读/写 VM 可见态（全局数组、脚本帧、IP、cur）、不影响控制流 —— emulator 插桩跳过。
 * 语义见 `docs-new/03-engine/opcode-table.md`（本表不再重复引擎 handler/偏移等细节，避免与数据层漂移）。
 * 对"到 TITLE 路径"良性；M1 再按需补成精确语义。
 */
const op_engine_internal: OpHandler = () => {
  // 纯 no-op 插桩跳过：不写 VM 状态、不控制流。**不再自打日志**——renderer 的 step trace 已逐条报
  // kind=engine-internal（且带 opcode）；自打 `[engine-internal] ...` 会造成每 op 双行，并在交互脚本
  // （0x20c 每帧一次）下刷屏。需要逐 op 细节看 renderer 的 step trace 即可。
};

export const ENGINE_INTERNAL_OPS: Map<number, OpHandler> = new Map<number, OpHandler>([
  // ============ 声音 子系统 ============
  // ★**已全部转真实现**（2026-09）：`0xB4/0xB5/0xBA/0xB6/0xB7/0xB9/0xBB/0xBC/0xBF/0xC2/0xC4/0xC6/0x1BD/
  //   0x2BF/0x2C0/0x2F4/0x2F5/0x2F6/0x2F7/0x2F8/0x2FF/0x302` 见 `handlers/audio.ts`（`AUDIO_OPS`，落在
  //   `NATIVE_OPS`：经 `NativeBridge.audio(AudioIntent)` 落到宿主音频引擎）。此前只有 0xB5/0x2BF/0x2C0/
  //   0x2F6/0x2F8 在本表当 no-op，其余（如 0xB6/0xBA/0x2FF）**根本不在任何表里 ⇒ 命中即硬报错**。
  // ============ 渲染 / 图形 / 图像 / 纹理（emulator 无界面） ============
  // 说明：能落到 emulator 场景模型（drawItems/meshes/纹理槽）或引擎字段的已升级为真实现 —— 见 OPS：
  //   0x1F4 帧计时 / 0x1F5 帧倒计 / 0x20C 帧刷新 / 0x23C 帧时钟 / 0x23D·0x32B 停靠标志 / 0x248 渲染配置 /
  //   0x1F6 整批清绘制容器 / 0x1F7 删区间 / 0x1F8 建纹理 / 0x1F9 绑定 / 0x1FA 释放 / 0x1FB 画图元 /
  //   0x1FF 图元平移 / 0x202·0x203 颜色 / 0x208 纹理尺寸 getter / 0x217 pivot / 0x219 描画位置 /
  //   0x21E·0x21F·0x220·0x239 四个动画窗 / 0x23B CG 数字条 / 0x2DA CG 记录 / 0x25B 消息态图像 /
  //   0x32F 灯光 / 0x340 渲染状态 / 0x342 Live2D 槽 / 0x344 纹理槽变换 / 0x352 图形子系统。
  // 此处只留**emulator 无对应模型**的 —— `0x346`–`0x34E` 是 `Scene+1096` 的 572 字节
  // 「变换 / Live2D 立绘节点」setter 族（元素 `+4` 指向 Live2D 槽，消费方 `sub_4B0360` 只在
  // 该槽真有模型时才出画）⇒ 无模型时天然无输出，no-op 安全；`0x34E` 读文件失败会抛异常，
  // 这里按"不抛"处理（见 `.tmp/re-misc-gfx.md` §1）。
  [0x346, op_engine_internal], // 复位全部变换为单位阵 → sub_427DD0
  [0x347, op_engine_internal], // 缩放（百分数 /100）→ sub_427E10
  [0x348, op_engine_internal], // 缩放 + 汇总参数 → sub_427EA0
  [0x349, op_engine_internal], // 平移（像素）→ sub_427F30
  [0x34a, op_engine_internal], // 基础平移偏移 +8/+12/+16 → sub_427FB0
  [0x34b, op_engine_internal], // 缩放目标矩阵 + 窗1 → sub_428030（置 pending Scene+46516）
  [0x34c, op_engine_internal], // 旋转目标矩阵 + 轴角 + 窗2 → sub_4280D0（置 pending）
  [0x34d, op_engine_internal], // 平移目标矩阵 + 窗3 → sub_428170（置 pending）
  // ★0x326/0x325 属 **3D 天气/粒子效果管理器**（见本文件 0x324 处的说明）：
  //   `0x326` = Set3DEffect**Snow**（错误串 raw 23942）：惰性建共享 `ID3DXEffect`(资源 202) 后
  //   经 `sub_453330` **重建 Snow 对象**；`0x325` 写的是该管理器的 `[+0x4D8]`/`[+0x4DC]` 两个 int。
  [0x326, op_engine_internal], // 3D 效果·Snow：ID3DXEffect(资源 202) + 重建 Snow（自带 `Scene+46668>=1` 门槛）→ sub_426E10/sub_418340
  [0x325, op_engine_internal], // 3D 效果管理器字段 [+0x4D8]/[+0x4DC] = op1/op2 → sub_426DC0
  // ============ 消息窗 / 消息渲染 / 文本 / 字体 子系统 ============
  // 这里的每条都**确认过 handler 体不写 VM 可见态**（不回写操作数、不改 ip/cur）。
  // 「字段/状态可建模」的都在 `msgwin.ts` 的 `MSGWIN_OPS`（OPS 表，engine-first）：
  //   0x70 几何 / 0x74 消息速度(仅字段) / 0x75 主字号 / 0x79 文字起点 / 0x197 注音字号 /
  //   0x198 窗位置 / 0x1A5 主面名 / 0x1B5 消息速度(字段+注册表) / 0x1C1 换行边界 /
  //   0x260 竖排矩形 / 0x2BD·0x2BE 加粗 / 0x2E8 自动翻页选项 / 0x2FE 注音面名 / 0x303 对齐
  // —— 三张表**必须两两不相交**（`test/registry-tables.test.ts` 守着），否则真实现会被 no-op 掩盖。
  //
  // ★`0x1D2`（sub_420380）—— **「文本项记录表」家族**：**2026-09 成对转真实现**，
  //   见 `handlers/text-items.ts`（`TEXT_ITEM_OPS`）+ 模型 `../textItems.ts`。
  //   写入端 `0x1D2`（42760 处）与语音族 `0xC4`/`0x1BD`/`0x2F4`；读取端 `0x1D3`/`0x1D4`/`0x2F3`
  //   （后三条过去**根本不在任何表里** ⇒ 命中即硬报错）；记账开关 `0x1BB`（SetTB）。
  //   ⇒ 回想/历史（`HISTORY.txt`）与语音重播（`REPLAYVOICE.txt`）的数据源就此打通。
  //
  //   ⚠同族里**仍未实现**的一条：`0x1D0`（sub_42D440 → sub_459860 raw 38099）读的是**另一张表**
  //   （回看页索引表 `Font+3380`，8B/条 `{槽号, 回看下标}`）⇒ 写回 `o1/o2`；它不在本次批次里，**故意不上桩**。
  //   证据：`src/CONFIG.txt:26-38`（CONFIG 屏配置项枚举：`i1d0` 取一段 → `i1d3` 查键 `-1` 的哨兵记录）。
  // ★`0x73`（字格+逐字节拍）与 `0x1CE`（逐字开关）已升为 `MSGWIN_OPS` 真实现 ——
  //   它们写的是窗对象的 `win+60..99` 字格块与 `effect_flags & 0x40000000`，
  //   是逐字显现的**可观测状态**（引擎主循环 raw 20887-20895 每帧消费），不能当 no-op。
  // ★`0x1CB`（GetConfig("message:ReadTextSkip") → 写 op1）**已转真实现**（2026-09）：
  //   见 `handlers/msgwin.ts` 的 `op_get_read_text_skip` —— 它与 `0x1CA`（SetConfig 同一个键）成对，
  //   当 no-op 时脚本读到的是旧槽值（静默逻辑错误）。语料里 30+ 个场景脚本有 `i1cb (global-int 139d)`。
  [0x1c9, op_engine_internal], // 消息窗（触摸/输入注册族，见 0x308）
  // ---- 声音族：已移出本表（2026-09）----
  //   `handlers/audio.ts` 的 `AUDIO_OPS` 是真实现（`NATIVE_OPS` → `NativeBridge.audio`）。
  //   整体机制见 docs-new/03-engine/sound-system.md；此前的 no-op 说明留在第二层台账
  //   `audio-module-topology-and-volume-routing` / `voice-request-deferral-and-adv-gate`。
  // ============ 3D 天气/粒子效果族（2026-09 复核：**不是**影片，也不是"消息/文本刷新"）============
  // 对象：`Engine[93384]`（= 字节 `0x5B320`；因 `Scene = Engine + 322832` 字节，也就是 `Scene+50704`）
  //   —— **3D 天气/粒子效果管理器**（`sub_4530B0` 构造，`operator new(0x4F4)`，在 Scene 初始化
  //   `sub_4A6EE0` 里创建：raw 126541-126545）。三个效果子对象槽：
  //     `[258]` = **Rain**（`sub_453280` → `sub_48E370`，`_this[0] = &Rain___vftable_`）
  //     `[259]` = **Snow**（`sub_453330` → `sub_4B58C0`，`&Snow___vftable_`）
  //     `[260]` = **Leaf**（`sub_453410` → `sub_478CC0`，`&Leaf___vftable_`）
  //   另有 `[261]`（传给各 ctor 的共享 D3D 设备）、三组 16-dword 参数块 `[262]/[278]/[294]`、
  //   `[310]/[311]`（0x325 写）、`[312]`（清空标记）。帧循环每帧调 `sub_4535F0(管理器,-1)` +
  //   `sub_453540(管理器)` 推进（raw 136828-136829）。
  // ★`sub_453530` 在 IDA 清单里是 **thunk**（`; Attributes: thunk` → `jmp sub_453150`，见
  //   `engine/天结_unpacked.exe_utf8.lst` 135090-135093），**不是**外部符号 —— 曾经的"外部弱符号、
  //   无法逐行确证、按影片族排除"是**误判**（2026-09 复核纠正）。
  [0x324, op_engine_internal], // 销毁 3D 效果管理器里的全部效果（Rain/Snow/Leaf）+ 清 [+0x4E0] → sub_41A470 →(thunk sub_453530)→ sub_453150
  // ★同族的 `0x327`（Set3DEffect**Rain**：`sub_426E70` → `sub_453280`）与 `0x328`（Set3DEffect**Leaf**：
  //   `sub_432300` → `sub_4183F0`，错误串 raw 23969）**目前根本没注册** ⇒ 命中即 `NotImplementedOp`。
  //   **故意不上桩**：它们是"该实现"的缺口，登记成 no-op 反而会把缺口藏起来（见 stub-reaudit §1.1 A4）。
  // ============ 图元 / 网格 / 纹理 / 渲染状态（A4，13 条）★已转真实现（2026-09）============
  //   见 `handlers/gfx-state.ts`（`GFX_STATE_OPS`，进 `OPS`）：`0x1FC` `0x1FE` `0x207` `0x20E` `0x224`
  //   `0x229` `0x238` `0x242` `0x256` `0x258` `0x321` `0x32A` `0x32D`。
  //   两条**建模**（`0x238` → `Engine[92338]/[92339]`；`0x258` → `Engine.texSlotFlags`），
  //   其余 11 条是纯渲染侧 ⇒ 走宿主缝（`native.resetPrimTransform`/`setPrimTransform4`/`blitSlotToSlot`/
  //   `commitGraphics`/`clearTransitions`/`setDrawModeBlock`/`setDrawEntryParam`/`setSlotParams`/
  //   `setMeshEntryAttr`/`release3DSlot`/`set3DColor`）。语料用量很大：`0x258` 11356 处、`0x238` 2056 处、
  //   `0x20E` 786 处、`0x229` 716 处 —— 此前一律当无依据的 no-op。
  // ============ 「启动 → Game Start → SN0000 首文案」路径上确认可跳过的 16 条（2026-09）============
  // 判据（逐条读 handler 体，raw 行号见右注）：**既不回写任何脚本操作数、也不改 ip/cur**，
  // 只写引擎里 emulator 无消费者的字段 / 只调渲染或 3D 子系统。因此对 VM 不可观测。
  // 与之相对，同一路径上**会回写操作数**的 9 条已转真实现（0x195 → handlers/config-read.ts；
  // 0x19A/0x1B6/0x1B7/0x1C7/0x1CC → handlers/msgwin.ts；0x215/0x216/0x218/0x21A → handlers/gfx-item.ts）。
  // 采集与逐条评估见 docs-new/03-engine/scene-start-flow.md。
  [0x93, op_engine_internal], // sub_4191D0 raw 24589：显示态切换（`174801&=~0x800000`、toggle `12956/12957`、`sub_403EF0`）—— 渲染侧
  [0x94, op_engine_internal], // sub_419230 raw 24604：置 `12957=1` + `sub_404020(Font+652, 10000)`（窗面清成色 10000）—— 渲染侧
  [0x97, op_engine_internal], // sub_420910 raw 29596：5 操作数 → `sub_403D10(Font+652, rect, mode)` 填矩形（语料里首参为 −1000 ⇒ 屏外空转）—— 渲染侧
  [0xd9, op_engine_internal], // sub_419970 raw 24939：清 `174801 &= ~0x1000`（+ `95779` 同位）—— 该位 emulator 无消费者（ADV 门是 0x8000000/0x40000000/bit31）
  [0x1ad, op_engine_internal], // sub_4196F0 raw 24806：`166963 = cur`（存档序列化用"当前帧"记忆；emulator 不序列化该字段，无读者）
  [0x1b1, op_engine_internal], // sub_41FEA0 raw 29155：`21672 = op1` —— **全工程无读者**（死写，与 21668 MessageSpeed 不是同一槽）
  [0x1bc, op_engine_internal], // sub_4197A0 raw 24845：清消息/声音字段（`85260..85280`、`490004..490040`、3×`sub_4B60C0`）—— 都是清场，无操作数回写
  // ============ 输入 子系统（按键绑定；emulator 无按键表） ============
  [0x10c, op_engine_internal], // SetKeyMulti：_this[_this[op2+1690]+1434]=op1
  [0x30a, op_engine_internal], // 键位注册：op1≤0x1F 且 op2≤7
  // ============ 字符串 / 查表 / 配置 ============
  // 0x2C7（SBSubstr）与 0x2EB（GetConfig("set:GameVersion") → 字符串）**已转真实现**：
  //   见 handlers/strings.ts（0x2C7）与 handlers/config-read.ts（0x2EB）——它们会回写操作数，
  //   当 no-op 会让 TITLE 的版本号永远是占位值、以及所有切片调用读到旧串。
  // ★`0x2C8`（**按字符**取子串 → 写 op1 字符串）与 `0x2C9`（可变数组元素引用 → 写 op1 指针）
  //   也**已转真实现**（2026-09）：见 `handlers/strings.ts` 的 `op_substr_chars`（+ `text/sjis.ts`
  //   的 `sjisSubstrChars`）与 `handlers/memory.ts` 的 `op_array_element_ref`（ADR-011 指针族）。
  //   两条都是"回写操作数"的指令，当 no-op 会让 op1 留旧值 ⇒ 静默逻辑错误。
  // 0x2DD（字体表第 idx 项的名字）**已转真实现**：见 handlers/msgwin.ts 的 op_font_list_name
  //   —— 它回写 op1 字符串，是字体选择器逐行画候选名的数据源；当 no-op ⇒ 列表整片空白。
  // ============ 数据字段 / 版本 / 脚本控制 ============
  [0xad, op_engine_internal], // 数据
  // 0xAE（sub_4192F0）**已转真实现**（2026-09）：见 handlers/frame.ts 的 op_save_version_branch
  //   —— 存档版本分支（读档时把帧 ip 重算到存档记录的位置）。语料 0 处调用，但**会改控制流**，不能当 no-op。
  [0xaf, op_engine_internal], // 数据
  // 0x143（i143）**已转真实现**：见 handlers/control.ts 的 op_dispatch_script_requests
  //   —— 它派发已装载扩展包的 $n$AUTORUN（引擎遍历 FileDB.packs 槽 1..255），当 no-op 会让扩展包永不激活。
  /**
   * `0x1D6`/`0x1D7`/`0x1D8`（`sub_42E7C0` / `sub_42E800` / `sub_42E850`，raw 38732-38771）：
   * **★2026-09 已转真实现**（`handlers/music-table.ts` 的 `MUSIC_TABLE_OPS`）——
   * 它们是**音乐表**指令：作用在 `Engine[698900]`（= Music 模块 `[271]` 的 PCM 对象）的
   * 「曲号 → 文件 id」扁平表（`+1304`）与包内分组表（`+1320`）上，并且**都会回写 op1**。
   * 当时判成 no-op 的理由是"结果写进没人读的 global"（`$3$AUTORUN.txt:67-68`）——但**写全局表本身
   * 就是副作用**：把它当 no-op，全局表的内容就取决于"哪条指令被跳过"，任何后续读它的脚本都会拿到垃圾。
   * 另外这两张表是**活的**：`play-bgm` 的曲号解析（`sub_48DB80`）读的正是它们。
   */
  // ============ 渲染 / 图形 / 图像 / 纹理 ============
  // ============ 数据 / 资源登记 ============
  // ============ 鼠标点击路径安全桩（emulator 暂不渲染/不算，no-op 不崩） ============
  // ============ 声音 ============
  // ★已移出本表：`0x2F8`（语音通道 pan）等全部音频 opcode 见 `handlers/audio.ts`。
  // ---- 「消息渲染」子系统：emulator 无对应子系统 ----
  // 判定依据 = 逐条读 handler 体：体内只出现对 `_this[引擎字段]` 的赋值/文本区写入，
  // **既不回写操作数、也不改 ip/cur**，故对 emulator 不可观测（与其余插桩同一取舍）。
  // 这一条**确实未实现**（引擎还会回写 op2），因此照旧受闸门 B 监督：
  // 脚本若给它传了非平凡实参，会出现在控制窗的「能力缺口」栏。
]);

/** 子系统 opcode → NativeBridge 桩（记录后放行，不阻塞 VM）。语义见 opcode-table.md；此处只记 emulator 路由。 */
export const STUB_NATIVE_OPS: OpTable = [
  // ★`0xB4`（SE 装载）/ `0xBF`（play-bgm）/ `0xC4`（play-voice）已从本表移出：
  //   它们是音频族的真实现（`handlers/audio.ts`），经 `NativeBridge.audio` 落到宿主音频引擎。
  [0x308, stubSubsystem], // 输入触摸注册（图形/子系统副作用，丢弃）
  /**
   * ★`0x14B` / `0x14C` / `0x14D`（**AGERC 模块接口**）**已全部转真实现（2026-09，A6）**：
   * 见 `handlers/agerc.ts`（`AGERC_OPS`，进 `OPS`）+ 模型 `Engine.agerc`。
   *
   * 引擎语义（raw 31056-31135 / 39810-39855）：`0x14B` 读 op1 = **统一文件 id** →
   * `fileDbIdToName_454FA0` 取名 → `LoadLibraryA` 存进 `Engine+490072`；`0x14C` 把
   * `GetProcAddress` 的结果绑到 `Engine+490076` 起的 **100 槽表**（槽越界抛「0から99まで」）；
   * `0x14D` 把 op3 的数组**逐元素 DEC** → 调该槽 → **ENC 回写** → `op2 ← 返回值`。
   *
   * ★**不是通用插件/DLL 加载器**：941 个脚本里**只有 1 处**调用（`src/SAVE.txt:7 i14b 5250`），
   * 0x5250 = 文件 id 21072 = **`AGERC.DLL`**；引擎自己也用硬编码字面量加载同一个 DLL（raw 4927）。
   * ⇒ emulator **只接受 AGERC.DLL**（其余 id 按引擎同文报错），导出表按 PE 实读的 21 个名字建，
   * 其中只有 `_SetNameLenMax@20` 有行为实现（脚本侧唯一用到；消费者 = `Engine.agerc.nameLenMax`）。
   * 详见 `docs-new/03-engine/agerc-module.md` 与 `agerc-internals.md`。
   */
  [0x341, stubSubsystem], // L2D 模型加载（无界面 stub）
  [0x345, stubSubsystem], // 图形模型加载（无界面 stub）
  [0x34e, stubSubsystem], // 图形模型加载（无界面 stub）
  // ★`0x204` draw-string 已升为 `MSGWIN_OPS` 真实现（handler 交出"位置 + 文本 + 全局样式"，
  //   宿主把字直绘进该纹理槽的表面）。漏掉它的症状是"设置界面中间一片纯白"，见 handlers/msgwin.ts。
  // ★`0x205` 数字直绘（GDI 数字文本 → 纹理槽）**已转真实现**（2026-09）：同 `handlers/msgwin.ts`
  //   —— 它按格式标志把数字排成串、**回写 op2（x 前进量）**再交给 `native.drawString`（与 0x204 同一宿主缝）。
  //   语料 313 处 / 35 个脚本（INFOSK / DRAWLINKTIP / INFOIT / ALCHEMY …）。
];

