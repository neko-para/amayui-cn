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
    case 0x1a5:
      c.native.setFont?.(args);
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
  [0xb5, op_engine_internal], // 声音通道控制（→ sub_4B5020/sub_4B6020）
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
  [0x326, op_engine_internal], // 3D 雪花 ID3DXEffect（自带 `Scene+46668>=1` 门槛）→ sub_426E10
  [0x325, op_engine_internal], // 消息对象字段 +1240/+1244 → sub_426DC0
  // ============ 消息窗 / 消息渲染 / 文本 / 字体 子系统 ============
  // 分组依据：handler 体只读操作数、写 `_this[消息窗族字段]`（0x151fc/0x152xx 区、`_this+21324` 文本子系统），
  // **不回写操作数、不改控制流**。其中「字段可建模」的已升级为真实现（见 OPS 的 ENGINE_FIELD_STORE 一族与
  // op_get_msgwin_alpha/op_set_msgwin_part/op_msgwin_slot_*），此处只留**宿主无对应子系统**的那些。
  [0x74, op_engine_internal], // 消息窗
  [0x75, op_engine_internal], // → sub_4185F0(_this+21324, op1)（文本子系统方法）
  [0x79, op_engine_internal], // 消息项（sub_41F4E0/sub_4563A0）
  [0x7a, op_engine_internal], // 消息窗
  [0x7b, op_engine_internal], // 消息窗
  [0x70, op_engine_internal], // 消息窗布局（op1..op5 → sub_45D660）
  [0x73, op_engine_internal], // 消息窗布局（10 操作数 → sub_453AD0）
  [0x197, op_engine_internal], // 消息/布局（sub_418680）
  [0x198, op_engine_internal], // 消息/布局
  [0x1b5, op_engine_internal], // 消息窗
  [0x1bb, op_engine_internal], // → sub_4034D0/sub_408050（文本格式化助手）
  [0x1c1, op_engine_internal], // 消息/UI（sub_4563D0）
  [0x1c9, op_engine_internal], // 消息窗
  [0x1ca, op_engine_internal], // SetConfig("message:ReadTextSkip", op1)（写配置注册表）
  [0x1cb, op_engine_internal], // 消息窗
  [0x1ce, op_engine_internal], // 消息窗
  [0x212, op_engine_internal], // 消息窗对象（sub_423A30）
  [0x213, op_engine_internal], // 消息窗对象（sub_423A80）
  [0x245, op_engine_internal], // 消息/UI
  [0x246, op_engine_internal], // 消息/UI
  [0x249, op_engine_internal], // 消息/UI
  [0x25a, op_engine_internal], // 消息/UI
  [0x25c, op_engine_internal], // 消息/UI
  [0x25d, op_engine_internal], // 消息列表对象（sub_425EF0/425F50）
  [0x25e, op_engine_internal], // 消息/UI
  [0x25f, op_engine_internal], // 消息/UI
  [0x260, op_engine_internal], // 消息窗配置（_this[80102..80104]）
  [0x2bd, op_engine_internal], // 文本/字体（op1 真值 → 文本子系统 +218516/+1248 = 700）
  [0x2be, op_engine_internal], // 文本/字体
  [0x2bf, op_engine_internal], // 文本/字体
  [0x2c0, op_engine_internal], // 文本/字体
  [0x2e8, op_engine_internal], // 消息/UI
  [0x2fe, op_engine_internal], // 字体（sub_4332D0：读字符串操作数）
  [0x303, op_engine_internal], // 消息/UI 对象（sub_456600）
  [0x324, op_engine_internal], // sub_453530(_this[93384])：计时/文本刷新（无操作数）
  [0x2f6, op_engine_internal], // 清消息回调槽 _this[v2+122505/122508] + _this[122501]（消息文本回调）
  // ============ 输入 子系统（按键绑定；emulator 无按键表） ============
  [0x10c, op_engine_internal], // SetKeyMulti：_this[_this[op2+1690]+1434]=op1
  [0x30a, op_engine_internal], // 键位注册：op1≤0x1F 且 op2≤7
  // ============ 字符串 / 查表 / 配置 ============
  [0x2c7, op_engine_internal], // 字符串处理（sub_433FD0）
  [0x2c8, op_engine_internal], // 字符串
  [0x2c9, op_engine_internal], // 字符串
  [0x2dd, op_engine_internal], // 字符串
  [0x2eb, op_engine_internal], // 配置/字符串：GetConfig("set:GameVersion") → sub_40C210 拼串
  // ============ 数据字段 / 版本 / 脚本控制 ============
  [0xad, op_engine_internal], // 数据
  [0xae, op_engine_internal], // 版本/存档：读 set:SaveVersion1/2 分支续档（sub_4192F0）
  [0xaf, op_engine_internal], // 数据
  [0x143, op_engine_internal], // 脚本控制：扫 256 请求槽 → queueScript → dispatchQueuedScripts（见 docs）
  // ============ 渲染 / 图形 / 图像 / 纹理 ============
  // ============ 数据 / 资源登记 ============
  // ============ 鼠标点击路径安全桩（emulator 暂不渲染/不算，no-op 不崩） ============
  // ============ 声音 ============
  [0x2f8, op_engine_internal], // → sub_4B6940(_this+4666, op1+12, op2)（声音通道/音量）
  // ---- 「消息渲染 / 声音」子系统：emulator 无对应子系统 ----
  // 判定依据 = 逐条读 handler 体：体内只出现对 `_this[引擎字段]` 的赋值/文本区写入，
  // **既不回写操作数、也不改 ip/cur**，故对 emulator 不可观测（与其余插桩同一取舍）。
  // 这两条**确实未实现**（0xC5 引擎还会回写 op2），因此照旧受闸门 B 监督：
  // 脚本若给它们传了非平凡实参，会出现在控制窗的「能力缺口」栏。
  [0x196, op_engine_internal], // display-furigana：写消息文本区（文本渲染未建模）
  [0xc5, op_engine_internal], // 读 op1 选 sound:Volume1..4 → GetConfig → 写 op2（音量显示；无声音子系统）
]);

/** 子系统 opcode → NativeBridge 桩（记录后放行，不阻塞 VM）。语义见 opcode-table.md；此处只记 emulator 路由。 */
export const STUB_NATIVE_OPS: OpTable = [
  [0xb4, stubSubsystem], // → native.playSound
  [0xbf, stubSubsystem], // → native.playBgm
  [0xc4, stubSubsystem], // → native.playVoice
  [0x308, stubSubsystem], // 输入触摸注册（图形/子系统副作用，丢弃）
  /**
   * `0x14B`（sub_4229D0, raw 31056）：**运行时插件/DLL 加载** —— 先 `FreeLibrary(_this+490072)` 释放旧句柄，
   * 用 `sub_454FA0(_this+680092, op1)` 从字符串表取库名，再 `LoadLibraryA(name)` 存入 `_this+490072`；
   * 失败则 `GetLastError` + 抛异常。SAVE.BIN 会走到这条。
   * emulator 不加载原生库 ⇒ 记录式桩（**不抛异常**）；后续对该库的调用若有，会落到各自 opcode 的桩上。
   */
  [0x14b, stubSubsystem], // 运行时 DLL 加载（不加载原生库）
  [0x341, stubSubsystem], // L2D 模型加载（无界面 stub）
  [0x345, stubSubsystem], // 图形模型加载（无界面 stub）
  [0x34e, stubSubsystem], // 图形模型加载（无界面 stub）
  [0x1fc, stubSubsystem], // 纹理/图形子系统方法
  [0x1fe, stubSubsystem], // 纹理变换 op（4 浮点）
  [0x204, stubSubsystem], // draw-string（无界面 stub）
  [0x205, stubSubsystem], // 纹理/文本 op
  [0x207, stubSubsystem], // 纹理 op
  [0x1a5, stubSubsystem], // set-font
  [0x6e, stubSubsystem], // show-text
  [0x6f, stubSubsystem], // end-text-line
  [0x72, stubSubsystem], // wait-for-input
];

