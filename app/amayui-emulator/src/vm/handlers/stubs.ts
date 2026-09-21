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

/**
 * **唯一还留在「宿主无对应子系统」表里的指令**：记录后放行、不阻塞 VM。
 *
 * ★T-0057 R5：这里原有一个 `switch (opcode)` 覆盖 0xB4/0xBF/0xC4/0x1FB/0x1F9/0xCD/0xC8 —— 那 7 条
 * **早已各自转真实现**（音频 → `AUDIO_OPS`、图形 → `GFX_*_NATIVE_OPS`、输入 → `INPUT_OPS`、
 * sleep → `FRAME_NATIVE_OPS`），所以每个 `case` 都是死码；唯一活的 0x308 恰好落到 `default`。
 * 现在只剩这一条路径。
 *
 * ⚠已知缺口（不在本轮）：`0x308` 的引擎体是「读 op1 → `sub_407B20` → 写 `_this[1954]`」
 * （opcode-table.md:518），emulator 只发一句 `unhandled`，**没有读 op1、也没有写 1954**。
 * 要补它得先读 raw `sub_407B20` 的语义（见 T-0057 notes 的 C2）。
 */
const op_stub_unhandled: OpHandler = (c) => {
  c.native.unhandled?.(c.instr.opcode, c.instr.name);
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
  /**
   * `0x2FA`（`sub_426910` raw 33722-33725）：`_this[1951] = op1`（= `Engine+0x1E7C`）。
   *
   * ★为什么是 no-op 而不是建模那个字段：该字段在**整份反编译里没有任何读取点**（`grep 1951` 只有这一处写），
   *   所以"写进 `engineValues`"只会变成一条没人读的死写（`npm run check:dead-writes` 会拦）。
   *
   * ★为什么非有不可（`tickets/T-0073`）：全库只出现 **1 次**（`src/CALLBACK_LOAD.txt:18` 的 `i2fa 0`），
   *   而 `CALLBACK_LOAD.BIN` 正是**读档时"上一个画面收尾"那一跳**（ADV 退出 `i19b` / 渲染目标 `i20d -1` /
   *   `detach-texture 110000 2000` / SE 与语音通道复位…）。这条不在三张表里 ⇒ 命中即 `NotImplementedOp`
   *   ⇒ 在"跳过未知指令"策略下**每帧死循环重试同一条**（ip 不前进），CALLBACK_LOAD 永远跑不完
   *   ⇒ 引擎那一跳接不上（实测：40 帧后轨迹只有 `CALLBACK_LOAD.BIN`、`drawItems=0`）。
   */
  [0x2fa, op_engine_internal], // Engine[1951] 写（无人读）→ sub_426910
  /**
   * `0x137`（`sub_4222B0` raw 30711-30729）：**ResetStack(n)**（n = op1，0..10）——
   * 把 `Engine+388292[n]`（= `_this[97073+n]`）上那个 **int 栈对象**删掉、再 `operator new(0x14)` +
   * `sub_407BD0` 建一个新的空栈（`{vftable, cap=256, step=256, buf=new[](0x400), top=-1}`）。
   *
   * ★为什么本作可以当 no-op：整个 int 栈家族（`0x137` 复位 / `0x138` push → `sub_409D40` /
   *   `0x13B`–`0x13D` 家族）在 941 个脚本里**只有 `i137` 出现 1 次**（`src/CALLBACK_LOAD.txt:18` 的 `i137 0`），
   *   `i138`/`i13b`/`i13c`/`i13d` **全为 0 处** ⇒ 没有任何脚本往这 11 个栈里压过值，
   *   "删掉一个空栈再建一个空栈"与"什么都不做"观测等价。
   * ★但它**非有不可**：不登记 ⇒ 命中即 `NotImplementedOp` ⇒ 产品在 CALLBACK_LOAD 里停下报
   *   "停在未知指令 0x137 (i137)"（2026-09 用户实测），读档收尾那一跳走不完（`tickets/T-0072`）。
   */
  [0x137, op_engine_internal], // ResetStack(n)：删+建空栈（本作无人压栈）→ sub_4222B0
  /**
   * `0x244`（`sub_41A370` raw 25349-25355，**argc 0**）：`sub_4AD9F0(Engine+322832, 2)` ——
   * 遍历 Scene 的三张绘制项链表（`+1036`/`+1084`/`+1100`），对 **`flags & 2`** 的项把
   * `anim_start`（`+52`，`sub_4AAD40` 路径）或 `+24`（`sub_4AAEC0` 路径）**清 0**
   * —— 即"**把所有带 bit1 的绘制项的动画窗起点清掉**（= 让它们重新计时）"。
   *
   * ★**2026-09（B3）已从本表移出 ⇒ 真实现**（原先当 no-op 的理由"语义不完全同构"已不成立：
   *   `Item.animStart` 就是引擎 `+52`，`scClearDrawItemAnimStarts` 逐字清它）。
   *   见 `handlers/gfx-item.ts` 的 `op_clear_draw_item_anim_starts`（`GFX_ITEM_OPS`）。
   *   缺口台账 `analysis/opcode-gaps.json` 的 `0x244` 也由 `engine-internal-unjustified`
   *   改为 `implemented`。两张 572B 表（`Scene+1084/+1100`）的 `node+24` 仍未建模（如实记缺口）。
   */
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
  //   0x32F 灯光 / 0x340 渲染状态。
  // ★`0x342` / `0x344` / `0x346`–`0x352`（**Live2D 全族**）**已从本表移出**（2026-09，T-0054）：
  //   它们是 `handlers/live2d.ts` 的 `LIVE2D_OPS` / `LIVE2D_NATIVE_OPS` 真实现，运行态落在
  //   `Engine.l2dSlots` / `Engine.l2dNodes`（= `Scene+55812` 的 10 槽与 `Scene+1096` 的 572B 节点）。
  //   ★当时的理由"无模型时天然无输出 ⇒ no-op 安全"**只对画面成立、对模型不成立**：
  //   `0x346`–`0x34D` 是**节点字段的写入**（`0x344` 更是"建节点 + 绑槽"），跳过 ⇒ 节点表永远是空的，
  //   后来真有模型时（M1 之后）也没有任何节点可画 —— 正是"脚本在跑、画面什么都没有"的第二个成因。
  //   同一批还包含 `0x341`/`0x345`/`0x34E`（原先在 `STUB_NATIVE_OPS`）。
  // ★0x326/0x325 属 **3D 天气/粒子效果管理器**（见本文件 0x324 处的说明）：
  //   `0x326` = Set3DEffect**Snow**（错误串 raw 23942）：惰性建共享 `ID3DXEffect`(资源 202) 后
  //   经 `sub_453330` **重建 Snow 对象**；`0x325` 写的是该管理器的 `[+0x4D8]`/`[+0x4DC]` 两个 int。
  [0x326, op_engine_internal], // 3D 效果·Snow：ID3DXEffect(资源 202) + 重建 Snow（自带 `Scene+46668>=1` 门槛）→ sub_426E10/sub_418340
  /**
   * `0x325`（`sub_426DC0` raw 33924-33938，argc=2）：**Effect3D 管理器（`Engine[93384]` = 字节 `0x5B320`
   * = `Scene+50704`）的 `[+0x4D8] = op1`、`[+0x4DC] = op2`**（汇编清单 61806-61820：
   * `mov [esi+4D8h],eax` / `mov [esi+4DCh],edi`）；此外只置 arity 槽 `frames[cur]+0x74 = 5`。
   *
   * ★**体里真实效果**（已确证，2026-09）：这两格是**效果销毁判据** —— Effect3D 帧推进
   *   `sub_4535F0`（raw 65890-65908）里 `a2 >= *(this+0x4D8)` 命中就经 vtable+12/+20 释放
   *   `+1032`（= `[258]` Rain）；`a2 >= *(this+0x4DC)` 命中就释放 `+1036`/`+1040`（= `[259]` Snow /
   *   `[260]` Leaf）并置旗标 `+0x4E0` 的 bit0/bit1。★旧台账注「raw 34000-34012」是邻居函数，已订正。
   *
   * ★**为什么不建模**（`analysis/opcode-gaps.json` 的 0x325 = `engine-internal`，有据 no-op）：
   *   emulator **没有 Effect3D 子系统** —— 无管理器对象、无 Rain/Snow/Leaf（同族 0x326 同一口径），
   *   也没有 `sub_4535F0` 帧推进 ⇒ 写这两个阈值在 emulator 里没有任何消费者（对 VM 也不可观测：
   *   不写操作数、不改 ip/cur）。**不**为了"看起来对"造一个假的效果管理器。
   *   扩展点 = 先建管理器（`sub_4530B0`，`operator new(0x4F4)`；在 Scene 初始化 `sub_4A6EE0`
   *   raw 126541-126545 创建）+ 三个效果槽 + `sub_4535F0` 帧推进，再建模 `+0x4D8`/`+0x4DC`/`+0x4E0`。
   */
  [0x325, op_engine_internal], // Effect3D 管理器 [+0x4D8]/[0x4DC] = op1/op2（帧推进 sub_4535F0 读作销毁判据）→ sub_426DC0
  /**
   * ★**SETWEATHER 族 5 条**（`tickets/T-0093`，2026-09 轮 6）：`0x327` / `0x328` / `0x329` / `0x32C` / `0x32E`。
   *
   * **为什么必须登记（而不是留在 `deferred` / 硬停）**：`SETWEATHER` 是**被剧情脚本调用**的
   * （`call-script 47 // SETWEATHER`：`src/SC0500.txt:26212`、`SC0070:29136`、`SC2060:28374,30048`、
   * `SC4000:4359`、`SC4160:5752`、`SC5450:3573`、`SC5530:4181`、`src/$1$SC4330.txt:4993` …），
   * 而这 5 条此前**不在任何表里** ⇒ 每次走到 SETWEATHER 就 `NotImplementedOp` 硬停（整段剧情走不完）。
   *
   * **凭据（逐条读体 + 机械扫描，不是"看起来安全"）**：
   *   - `0x327`（`sub_426E70` raw 33956-33964，argc 1）：读 op1 → `sub_453280(Engine[93384], op1)` =
   *     **释放 Effect3D 管理器旧对象并重建**（同 0x324/0x325/0x326 那个管理器）。
   *   - `0x328`（`sub_432300` raw 41080-41113，argc 3）：读 op1=handle、op2=网格 id **数组基址**、op3=数量
   *     → 逐个 `DEC` 到临时数组 → `sub_4183F0(Scene, op1, 数组, op3)`（3D 网格）。
   *   - `0x329`（`sub_426EB0` raw 33966-34000，argc 2）：读 op1=统一资源 id、op2=槽 → FileDB 解析 +
   *     `sub_455560` 取字节 → `sub_4A0640(Engine+322832, …)` **装载 mesh**；失败抛
   *     「メッシュファイル %s の読み込みに失敗しました」（与 `0x326` 同款错误串处理）。
   *   - `0x32C`（`sub_426FC0` raw 34012-34030，argc 6）：读 **6 个 float** → `sub_499CE0(Scene, …)` =
   *     3D 相机/天气参数面（`Scene+41960..41984` + `D3DXMatrixLookAtLH` + 设备 `SetTransform`）。
   *   - `0x32E`（`sub_427110` raw 34057-34113，argc 11）：op9=α（夹 255）、op10=RGB（逐通道 × `dbl_51FA60`
   *     归一化）、op1/op2 + op3..op8 六个 float + op11 → `sub_49A080(Scene, …)`（3D 图元/效果）。
   *
   * **为什么不建模**：这 5 条**全部落在 emulator 没有的 3D 子系统**（Effect3D 管理器 / 3D 网格 /
   * 3D 相机与天气参数）⇒ 实现它们就要先造假的管理器/设备（纪律禁止）。**且它们对 VM 不可观测**：
   * 逐条机械扫描确认体内**没有** `sub_42B4B0`/`sub_42BA00`/`sub_418B90`/`sub_418CC0`（不回写操作数）、
   * 不改 ip/cur（只写长度槽）⇒ 跳过与"读了再丢"对脚本可观测行为一致；后者还会引入**死读**
   * （与 `0x1D3`/`0x1D4`/`0x2F3` 同一条纪律）。
   * ★扩展点 = 先建 3D 子系统（Effect3D 管理器 `sub_4530B0` + 三效果槽 + `sub_4535F0` 帧推进；
   * 3D 层/网格表 `Scene+80708` 的 `sub_4AAA50`/`sub_4AAEC0`），再逐条接线。
   * 台账：`analysis/opcode-gaps.json` 的 5 条由 `deferred` 改为 `engine-internal`。
   */
  [0x327, op_engine_internal], // Effect3D：释放+重建管理器（sub_453280）→ sub_426E70
  [0x328, op_engine_internal], // 3D 网格：DEC 数组 → sub_4183F0(Scene, handle, ids, n) → sub_432300
  [0x329, op_engine_internal], // mesh 装载（FileDB + sub_4A0640；失败抛 メッシュファイル 错误串）→ sub_426EB0
  [0x32c, op_engine_internal], // 3D 相机/天气：6 个 float → sub_499CE0(Scene, …) → sub_426FC0
  [0x32e, op_engine_internal], // 3D 图元/效果：α/RGB 归一化 + 6 float → sub_49A080(Scene, …) → sub_427110
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
  //   ★`0x1D0`（sub_42D440 → sub_459860 raw 70629-70724）读的是同族的**另一张表**
  //   （回看页索引表 `Font+3380`，8B/条 `{窗号, 起始记录下标}`）⇒ 写回 `o1/o2`。
  //   **2026-09（`T-0095`）已转真实现**：`handlers/text-items.ts` 的 `[0x1d0, op_backlog_page_at]`
  //   + `0x85` 清两表；页表的两个写端在 `handlers/msgwin.ts`（`0x70` raw 73186 无门 / `0x71` raw 74271 有门）。
  //   语料 5 处：`src/CONFIG.txt:22`、`HISTORY.txt:31/761/1130`、`REPLAYVOICE.txt:13`。
  // ★`0x73`（字格+逐字节拍）与 `0x1CE`（逐字开关）已升为 `MSGWIN_OPS` 真实现 ——
  //   它们写的是窗对象的 `win+60..99` 字格块与 `effect_flags & 0x40000000`，
  //   是逐字显现的**可观测状态**（引擎主循环 raw 20887-20895 每帧消费），不能当 no-op。
  // ★`0x1CB`（GetConfig("message:ReadTextSkip") → 写 op1）**已转真实现**（2026-09）：
  //   见 `handlers/msgwin.ts` 的 `op_get_read_text_skip` —— 它与 `0x1CA`（SetConfig 同一个键）成对，
  //   当 no-op 时脚本读到的是旧槽值（静默逻辑错误）。语料里 30+ 个场景脚本有 `i1cb (global-int 139d)`。
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
  // ★**`0x324` 的体**（raw 25402-25407）= 只置 arity 槽 `frames[cur]+0x74 = 1` 再**尾调**
  //   `sub_453530(Engine[93384])` ⇒ 真身 `sub_453150`（raw 65367-65393）：把 `[258]`/`[259]`/`[260]`
  //   三个效果对象各自 `(**v)(v,1)` 虚析构后置 0，并把旗标 `[312]`（= `+0x4E0`）清 0
  //   （`mov dword ptr [esi+4E0h], 0`，清单 135108）。对象就是 **Effect3D**：析构 `sub_4537A0`
  //   （raw 65918-65923）先写 `*_this = &Effect3D___vftable_` 再调同一个 `sub_453150`。
  // ★**为什么当 no-op 是有据的**（`analysis/opcode-gaps.json` 的 `0x324` = `engine-internal`）：
  //   emulator 没有 Effect3D 子系统（无管理器、无 Rain/Snow/Leaf、无 `sub_4535F0` 帧推进）⇒
  //   "释放三个效果 + 清旗标"对 VM（不写操作数、不改 ip/cur）与画面都不可观测。
  //   扩展点 = 若将来做 Effect3D，先建 `Scene+50704` 管理器与三效果槽，再把本指令接到 `sub_453150`。
  [0x324, op_engine_internal], // 销毁 Effect3D 的全部效果（Rain/Snow/Leaf）+ 清 [+0x4E0] → sub_41A470 →(thunk sub_453530)→ sub_453150
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
  // ============ A5（单行字段 / 计时 / 音频设备）★已转真实现（2026-09）============
  //   `0x93`/`0x94`/`0x97`（消息面/面板表面）→ `handlers/panel.ts`（`PANEL_OPS`）；
  //   `0xD9`/`0xAD`/`0x1AD`/`0x1B1`（清位/秒计时器/字段写）→ `handlers/engine-fields.ts`；
  //   `0x1BC`/`0x1C9`（清消息·声音字段 / 音频设备初始化）→ `handlers/audio.ts`。
  //   语料用量：`0x1AD` 1100 处 / 337 个脚本、`0x1BC` 213 处 / 184 个脚本；其余 0-2 处。
  // ============ 「启动 → Game Start → SN0000 首文案」路径上确认可跳过的 16 条（2026-09）============
  // 判据（逐条读 handler 体，raw 行号见右注）：**既不回写任何脚本操作数、也不改 ip/cur**，
  // 只写引擎里 emulator 无消费者的字段 / 只调渲染或 3D 子系统。因此对 VM 不可观测。
  // 与之相对，同一路径上**会回写操作数**的 9 条已转真实现（0x195 → handlers/config-read.ts；
  // 0x19A/0x1B6/0x1B7/0x1C7/0x1CC → handlers/msgwin.ts；0x215/0x216/0x218/0x21A → handlers/gfx-item.ts）。
  // 采集与逐条评估见 docs-new/03-engine/scene-start-flow.md。
  // ============ 输入 子系统（按键绑定；emulator 无按键表） ============
  /**
   * `0x10C`（`sub_4220B0` raw 30616-30634，argc=2，**SetKeyMulti**）：
   * `arity 槽 = 5` → `op1` = 掩码位（`>0x1F` 抛 ShowMessage「SetKeyMultiの引数が不正です．」）、
   * `op2` = **键码** → 写 `Engine[1434+Engine[1690+op2]] = op1`（汇编清单 53610-53659：
   * `mov edx,[esi+edi*4+1A68h]` / `mov [esi+edx*4+1668h],eax`）。
   * 因 `Input` 是 Engine 的内嵌对象（`Input = Engine+1032` 字节，`Engine[258]` 即其 vftable，
   * raw 92374-92380），等价于 `Input[1176 + Input[1432+op2]] = op1`：
   *   - `Input[1176+VK]` = **VK→掩码位表**（引擎每帧 `sub_4770A0` raw 91551-91570 扫 0..255 个 VK，
   *     `mask |= 1 << _this[1176+VK]`，落 `Engine[174802]` → `0x100`/`0x101`/ADV 派发）；
   *   - `Input[1432+键码]` = **键码表**（`Input[1476] = 90` ⇒ 键码 `0x2c`='Z'、`Input[1460] = 13`
   *     ⇒ 键码 `0x1c`=RETURN；默认值由 `sub_476AA0` raw 91325-91423 填，
   *     `src/SYSTEM4.txt:87-97` 的 `i10c 4 1c` / `i10c 4 2c` 正对上）。
   *
   * ★**台账处置 = `engine-internal`（有据跳过；T-0077 验收 2 的两种处置之一）**，理由：体确有真实效果，
   *   但 emulator **没有这条链路** —— 无键码表、无 `Input[1176+VK]`、宿主键盘也不进掩码
   *   （`InputManager.keyEdge` 只登记，`flushHeld`/`flushPending` 不并 0..6）⇒ 本指令的写入在 emulator
   *   里**一个消费者都没有**（同族 `0x30a`「键位注册」同一口径），对 VM 不可观测。
   *   ★但引擎侧**确有**消费者（每帧 `sub_4770A0` ⇒ 输入掩码 ⇒ `0x100`/`joy-callback`）⇒
   *   **一旦 `tickets/T-0052`（键盘掩码位 0..6）落地，本指令必须从 `ENGINE_INTERNAL_OPS` 移进 `OPS`**。
   *   扩展点 = `handlers/input.ts` 的 `op_set_key_multi`（先落 `Input[1176+VK]` 默认 7 键→位 0..6
   *   与 `Input[1432+键码]` 默认表）。
   */
  [0x10c, op_engine_internal], // SetKeyMulti：Input[1176+VK] = op1（VK = 键码表[op2]）→ sub_4220B0；有据跳过，见上
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
  // 0xAE（sub_4192F0）**已转真实现**（2026-09）：见 handlers/frame.ts 的 op_save_version_branch
  //   —— 存档版本分支（读档时把帧 ip 重算到存档记录的位置）。语料 0 处调用，但**会改控制流**，不能当 no-op。
  /**
   * `0xAF`（注册项 raw 22898：`_this + 676696 = 675996 + 4*0xAF` → `sub_419690`）。
   *
   * ★**订正（审计 `op-6-05`）**：此前这里写「**唯一一条"体内什么都不做"的指令**」是**错的**。
   * `sub_419690` 的体（raw 24775-24783）＝
   * `result = _this[95776]; _this[30*result + 95805] = 1; return result;`
   * —— **写当前帧的指令步长槽**（`95805`；唯一读者 = 主循环 raw 20165 `ip += 4 * 该槽`）
   * ⇒ 指令占 1 个 dword、ip 前进 4 字节；**与 `0x1A8` 的体逐字相同**
   * （`0x1A8` 的 handler 同样是 `sub_419690`，见 control.ts 的 `op_dev_ukn`）。
   *
   * 对 emulator 仍不可观测（该槽未建模：ip 推进由 `interpreter.stepOnce` 直接 `+1`），故仍归
   * `engine-internal`；但依据必须写成"体内只写派发器的步长槽"，**不是**"体内什么都不做"
   * （对照本文件顶部声明的判据）。
   */
  [0xaf, op_engine_internal],
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
  // ★2026-09 清理：这里原有 4 个**空分区标题**（渲染/图形/图像/纹理、数据/资源登记、
  //   鼠标点击路径安全桩、声音）与一段**无指代对象**的悬空注释 —— 它们的条目早已转真实现或移出本表
  //   （音频见 `handlers/audio.ts`、消息见 `handlers/msgwin.ts`、图形见 `gfx-*.ts`）。
  //   本表的纪律：**每条 `engine-internal` 都必须带 raw 依据**；没有依据的条目应当去读体，
  //   读完要么转真实现、要么在此写明"体内只做 X，对 emulator 不可观测"。
]);

/** 子系统 opcode → NativeBridge 桩（记录后放行，不阻塞 VM）。语义见 opcode-table.md；此处只记 emulator 路由。 */
export const STUB_NATIVE_OPS: OpTable = [
  // ★`0xB4`（SE 装载）/ `0xBF`（play-bgm）/ `0xC4`（play-voice）已从本表移出：
  //   它们是音频族的真实现（`handlers/audio.ts`），经 `NativeBridge.audio` 落到宿主音频引擎。
  [0x308, op_stub_unhandled], // 输入触摸注册（⚠op1/`_this[1954]` 未建模，见 handler 注释）
  // ★`0x82`（`sub_41F720` → `sub_466000`，argc 5）**已从本表移出（2026-09，`tickets/T-0104`）**：
  //   体已读完（raw 79319-80311）⇒ 语义 = **用给定颜色把某窗的文本记录重画一遍**
  //   （`op1` = 窗索引、`op2` = 起始记录下标（越界 ⇒ 什么都不做）、`op3 & 2` ⇒ 用 `op4`/`op5`
  //   覆盖全局填充/描边色，与 `0x76`/`0x77` 同一字段）。现在注册进 `MSGWIN_OPS`
  //   （`handlers/msgwin.ts` 的 `op_gdi_repaint_window`：设色 + `emitWin(op1)` 重发布该窗；
  //   近似与缺口逐条写在该 handler 的注释里）。语料 1 处：`src/CONFIG.txt:269`。
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
  // ★`0x341` / `0x345` / `0x34E`（Live2D 装载族）**已从本表移出**（2026-09）：它们是
  //   `handlers/live2d.ts` 的 `LIVE2D_NATIVE_OPS` 真实现（宿主读 `.MOC`/PNG/`.MTN` + 共享层建槽）。
  //   当 stub 时的后果正是 T-0054 的现象：三处界面的立绘**永不出现且不报错**。
  // ★`0x204` draw-string 已升为 `MSGWIN_OPS` 真实现（handler 交出"位置 + 文本 + 全局样式"，
  //   宿主把字直绘进该纹理槽的表面）。漏掉它的症状是"设置界面中间一片纯白"，见 handlers/msgwin.ts。
  // ★`0x205` 数字直绘（GDI 数字文本 → 纹理槽）**已转真实现**（2026-09）：同 `handlers/msgwin.ts`
  //   —— 它按格式标志把数字排成串、**回写 op2（x 前进量）**再交给 `native.drawString`（与 0x204 同一宿主缝）。
  //   语料 313 处 / 35 个脚本（INFOSK / DRAWLINKTIP / INFOIT / ALCHEMY …）。
];

