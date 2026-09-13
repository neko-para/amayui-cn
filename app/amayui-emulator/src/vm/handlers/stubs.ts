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
  [0x321, op_engine_internal], // MeshEntry 属性块 `+28+4·op2` → sub_426BD0（原样写入，无 clamp/回退）
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
  // ★`0x1D2`（sub_420380）—— **「文本项属性记录表」家族的写入端**，本表里唯一"引擎其实做了事"的一条：
  //   引擎体：`if (!Engine[97055]) sub_45EFA0(Font, 0, op1, op2)` ⇒ 往 **`Font+3364` 的 72B/条
  //   记录向量**里 push 一条 `{win = 默认窗, +20 = op2, +24 = op1, +28 = 0, +32 = 0, flags = 0x20000000
  //   (| 1 = 组首)}`（push 实现 sub_45E7E0 raw 73986：传入指针落在向量内则**按索引插入**，否则尾插）。
  //   它**不回写操作数、不改 ip/cur**，从 VM 视角不可观测 ⇒ 归 engine-internal（宿主没有这张表的消费者）。
  //
  //   ⚠**同一家族的读取端仍未实现，故意保持"命中即硬报错"**（它们**会回写操作数**，绝不能当 no-op）：
  //     · `0x1D3 <o1> <o2> <o3> <o4> <o5>`（sub_42D4A0 → sub_457960 raw 69329）：从下标 `o4` 起扫
  //       `flags & 0x20000000 && +24 == o5` 的记录，取 `+20` ⇒ 写回 `o1 = 找到?1:0`、`o2 = 值`，
  //       遇到"下一条是组首（bit0）"即停。
  //     · `0x1D4 <o1> <o2> <o3> <o4>`（sub_42D510 → sub_457A20 raw 69367）：扫 `flags & 0x40000000
  //       && +32 == 0`，取 `+20/+24/+28`（缺省 -1/-1/0）⇒ 写回 `o1/o2`。
  //     · `0x1D0 <o1> <o2> <o3>`（sub_42D440 → sub_459860 raw 38099）：读**回看页索引表**
  //       （`Font+3380`，8B/条 `{槽号, 回看下标}`）⇒ 写回 `o1/o2`。
  //     · `0x2F3 <o1> <o2> <o3> <o4> <o5> <o6>`（sub_431A10 → sub_457A20 raw 40724）：扫
  //       `flags & 0x40000000 && +32 == o6`，取 `+20/+24/+28` ⇒ 写回 `o1/o2/o3`（`o5` = 起始下标）。
  //       ★订正：早前把这条的语义记在 `0xAA` 上；`0xAA`（sub_42D580 raw 38148）其实是**写文件/保存族**
  //       （`CreateFileA` + `sub_40CD10`，读 op2、写 op1），与记录表无关。
  //   证据：`src/CONFIG.txt:26-38`（CONFIG 屏的配置项枚举循环：`i1d0` 取一段 → `i1d3` 查键 `-1` 的哨兵
  //   记录 → 递减下标回环）、`src/CONFIG.txt:357`（`i1d2 (-1) 0` 压哨兵）——2026 实测用户在 CONFIG.BIN
  //   命中 `0x1D2` 被暂停（`.tmp/amayui-emulator.log:2215`）。
  //   ⇒ **实现这张表时必须把 0x1D2 一起搬进 OPS**（写入端与读取端同进同出，否则表的语义仍然缺一半）。
  [0x1d2, op_engine_internal], // 文本项属性记录表：push（宿主无消费者；读取端见上方说明）
  [0x7a, op_engine_internal], // 消息窗
  [0x7b, op_engine_internal], // 消息窗
  // ★`0x73`（字格+逐字节拍）与 `0x1CE`（逐字开关）已升为 `MSGWIN_OPS` 真实现 ——
  //   它们写的是窗对象的 `win+60..99` 字格块与 `effect_flags & 0x40000000`，
  //   是逐字显现的**可观测状态**（引擎主循环 raw 20887-20895 每帧消费），不能当 no-op。
  [0x1bb, op_engine_internal], // → sub_4034D0/sub_408050（文本格式化助手）
  // ★`0x1CB`（GetConfig("message:ReadTextSkip") → 写 op1）**已转真实现**（2026-09）：
  //   见 `handlers/msgwin.ts` 的 `op_get_read_text_skip` —— 它与 `0x1CA`（SetConfig 同一个键）成对，
  //   当 no-op 时脚本读到的是旧槽值（静默逻辑错误）。语料里 30+ 个场景脚本有 `i1cb (global-int 139d)`。
  [0x1c9, op_engine_internal], // 消息窗（触摸/输入注册族，见 0x308）
  [0x245, op_engine_internal], // 消息/UI
  [0x246, op_engine_internal], // 消息/UI
  [0x249, op_engine_internal], // 消息/UI
  [0x25a, op_engine_internal], // 消息/UI
  [0x25c, op_engine_internal], // 消息/UI
  [0x25e, op_engine_internal], // 消息/UI
  [0x25f, op_engine_internal], // 消息/UI
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
  [0x20e, op_engine_internal], // sub_41A200 raw 25277：图形提交（`sub_4A50C0(Scene,0x26)` + `sub_498B60`）—— 宿主每帧自行 present
  [0x224, op_engine_internal], // sub_41A290 raw 25301 → sub_4AA180 → `sub_4A9BE0(Scene+262)`：清 Scene 转场表（emulator 无转场表）
  [0x229, op_engine_internal], // sub_423FE0 raw 31984：绘制模式配置（`sub_49A690/4AC0/4AF0` + 3 个 float）—— 渲染侧
  [0x238, op_engine_internal], // sub_4248C0 raw 32303：`92338=0; 92339=op1` —— **两个槽全工程只写不读**（死写）
  [0x242, op_engine_internal], // sub_4251A0 raw 32649 → sub_4AD9A0：写 `DrawItem+720` 与转场项 `+504`—— 渲染侧
  [0x256, op_engine_internal], // sub_425C30 raw 33120 → sub_4ACD10：绘制项 3 个 float 设置 —— 渲染侧
  [0x258, op_engine_internal], // sub_425D20 raw 33156：按 op2 的 bit0/bit1 置纹理槽标志（`5*slot+468/+469`、`+5468/+5469`）—— 渲染侧
  [0x32a, op_engine_internal], // sub_426F80 raw 34003 → sub_4A0750：释放 3D 模型槽（`Scene[op1+12677]` 析构 + delete）—— 3D 槽，emulator 无模型
  [0x32d, op_engine_internal], // sub_427040 raw 34033 → sub_499DF0：3D 颜色（op1=α 上限 255、op2=RGB）→ 4 个 float —— 3D 渲染侧
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
  [0xae, op_engine_internal], // 版本/存档：读 set:SaveVersion1/2 分支续档（sub_4192F0）
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
   * `0x14B`（sub_4229D0, raw 31056）：**加载 AGERC 模块（脚本侧）** —— 先 `FreeLibrary(_this+490072)` 释放旧句柄并清 0，
   * 读 op1 = **统一文件 id** → `fileDbIdToName_454FA0` 取名字 → `LoadLibraryA(name)` 存回 `Engine+490072`；
   * 失败 ⇒ `GetLastError` + 抛 ShowMessage 异常。
   *
   * ★**不是通用插件/DLL 加载器**（2026-09 订正）：941 个脚本里**只有 1 处**调用（`src/SAVE.txt:7 i14b 5250`），
   * 0x5250 = 文件 id 21072 = **`AGERC.DLL`**；引擎自己也用**硬编码字面量** `tstrFilename[] = "AGERC.DLL"`
   * （raw 4927）在 WinMain 里加载同一个 DLL（`initAgercInterface_48E730`）。配套的 `0x14C`（绑定导出到
   * `Engine+490076` 起的 **100 槽表**）与 `0x14D`（调用该槽）**当前未注册** ⇒ 一进「Load Data（ロード）」
   * 就在 `SAVE.BIN` 第 2 条指令上抛 `NotImplementedOp`（实测探针：`.tmp/loadDataProbe.mts`）。
   * ⇒ 这三条可以**整体模型化实现**（不需要真加载原生库），见 `docs-new/03-engine/agerc-module.md`。
   */
  [0x14b, stubSubsystem], // 加载 AGERC 模块（不加载原生库；纯记录）
  [0x341, stubSubsystem], // L2D 模型加载（无界面 stub）
  [0x345, stubSubsystem], // 图形模型加载（无界面 stub）
  [0x34e, stubSubsystem], // 图形模型加载（无界面 stub）
  [0x1fc, stubSubsystem], // 纹理/图形子系统方法
  [0x1fe, stubSubsystem], // 纹理变换 op（4 浮点）
  // ★`0x204` draw-string 已升为 `MSGWIN_OPS` 真实现（handler 交出"位置 + 文本 + 全局样式"，
  //   宿主把字直绘进该纹理槽的表面）。漏掉它的症状是"设置界面中间一片纯白"，见 handlers/msgwin.ts。
  [0x205, stubSubsystem], // 纹理/文本 op
  [0x207, stubSubsystem], // 纹理 op
];

