/** @tier T0 @kind core @subsystem vm */

/**
 * **操作数计划层守卫**（`tickets/T-0082` RF-A 的第三步）—— 把 `src/vm/operandPlan.ts` 的**声明**
 * 与三处真源焊在一起，任何一处漂移即红：
 *
 *  ① **计划 argc ⟷ 文档 argc**（`scripts/asm/opcodes.json`，= `opcode-table.md` 的 argc 列）；
 *  ② **模型操作数记数槽 ⟷ 反编译体里的 N**：`operandCountSlotValue(op, argc)` 必须逐条等于
 *     `engine/天结_unpacked.exe_utf8.c` 里 handler 体写的 `_this[30*cur+95805] = N`
 *     （反之亦然：体里写 0 的**只能**是 `ZERO_LENGTH_OPS` 那三条）；
 *  ③ **计划方向/类型 ⟷ handler 实际碰的位**：对每个有计划、也已迁到计划层的 handler，
 *     用满 argc 的合成指令跑一遍 ⇒ handler 碰过的位必须**恰好覆盖**计划声明为 `r`/`rw` 的位，
 *     且不得越界（越界/漏读的机械判据在 `test/opcode-operands.test.ts`，这里补的是"计划说了什么、实现做了什么"）。
 *
 * 另外两条：计划表的**自洽**（kinds/io 长度、evidence 非空、无重复声明 —— `declarePlan` 会抛）
 * 与**运行期**（派发器写完 `frame.operandCount` 后，`StepTrace.operandCount` 报出来的值与模型一致；
 * `exit` 那类控制流为 0）。
 *
 * ★命名：§「arity 槽」是 `tickets/T-0082` 与审计的**口语名**；数据层（`analysis/fields.json`）里它的正式名是
 * `ScriptContext/0x74 operand_count`（引擎里叫 `arity` 的是 `+0x60`，装载时清零、没有读者）⇒ 代码与
 * trace 字段一律叫 `operandCount`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { StubNative } from '../src/vm/native.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { ZERO_LENGTH_OPS, operandCountSlotValue, operandsFor, planOf, plannedOps } from '../src/vm/operandPlan.js';
import { fieldStorePlanOps } from '../src/vm/handlers/engine-fields.js';
import { cfgReadPlanOps } from '../src/vm/handlers/config-read.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { im, instr, scriptDerived, trackArgs } from './harness.js';
import { ROOT, scanArity } from './arityScan.js';

/** 迁到计划层的 handler：op → 「为什么它算已迁移」（留着当迁移台账，别删）。 */
const MIGRATED: Record<string, string> = {
  '0x347': 'live2d 节点缩放：int key + 三分量 float（审计 op-9-op840）',
  '0x348': 'live2d 节点旋转（轴角）：int key + 4 float（审计 op-9-op840-348-is-rotation-not-scale）',
  '0x349': 'live2d 节点平移：int key + 三分量 float',
  '0x34a': 'live2d 基础偏移：int key + 三分量 float',
  '0x34b': 'live2d 缩放窗：int key/delay/dur + 三分量 float ÷100（审计 op-6-01）',
  '0x34c': 'live2d 旋转窗：int key/delay/dur + 轴 float + 角 float',
  '0x34d': 'live2d 平移窗：int key/delay/dur + 三分量 float',
  '0x32': '槽→槽缩放转送：10 个 int（存档缩略图的缩屏步）',
  '0x1f9': 'set-texture：图像 id / 槽 / 颜色（审计 P2 的"丢掉第 3 操作数"）',
  '0x20f': 'play-movie：影片 id / 槽 / 音量模式（审计 P3）',
  '0x202': 'set-draw-color：图元 / delay / dur / α / 颜色',
  '0x203': 'set-draw-color-alpha：handle / blend / α / 颜色（审计 op-4-06）',
  '0x82': 'GDI 带色重画某窗的文本记录：窗 / 起始记录下标 / 模式 / 填充色 / 描边色（T-0104）',
  // ---- 批次：引擎字段写入族（共用 handler `op_engine_field_store`，14 条；形状 = 读 op_n(int) → 写字段）----
  '0x76': '填充色 → Font+1360（+ bgrToRgb）',
  '0x77': '描边色 → Font+1364（+ bgrToRgb）',
  '0x78': '描边档位 outlineMode',
  '0x8b': '行间距 Font+1380',
  '0x10f': '帧字段 122369',
  '0x1a4': '描边偏移 dx/dy（唯一两位的一条）',
  '0x1cf': '消息跳读态 122504（sub_4213C0）',
  '0x21b': '引擎布尔寄存器（写成 0/1）',
  '0x24e': '消息字段 92340',
  '0x252': '消息系统配置 92323',
  '0x25b': '消息态图像 92381',
  '0x261': '竖排标志 Font+235108',
  '0x2db': '文本属性 fontMetricsMode 71744',
  '0x2e9': 'ADV 自动翻页行基准 122464（审计 op-2-01）',
  // ---- 批次：配置读取族（7 条，`config-read.ts` 的 `op_cfg_read`；方向首次出现 `w`）----
  '0xc5': 'sound:Volume0..4 → op2（op1 = 选择器；越界不写）',
  '0xc7': 'sound:Music/SE/Voice/Movie → op2（bool）',
  '0x1b8': 'message:AutoMessageTime0/1 → op2',
  '0x2cc': 'message:AdvanceMesOnWheel → op1',
  '0x2e6': 'message:AutoMessagePitch0/1 → op2',
  '0x2ea': 'message:AutoMessageOption → op1',
  '0x2ed': 'message:MessageFade → op1（T-0098）',
  // ---- 批次：字符串 → 回写族（6 条；首次出现 `str` 类型位）----
  '0x2c5': 'op1 = strlen(op2) 字节数（SJIS）',
  '0x2c6': 'op1 = _mbstrlen(op2) 字符数',
  '0x1a6': 'op1 = strlen(op2) >> 1（halve-strlen）',
  '0x194': 'op1 = (op2 == op3)（两字符串）',
  '0x195': 'op1 = (op2 != op3)（两字符串）',
  '0x2eb': 'op1（字符串）= set:GameVersion（配置串读）',
  // ---- 批次：字符串核心族 + 字符串表族（13 条，`strings.ts`）----
  '0x192': 'set-string：op1（串）= op2（串）',
  '0x193': 'concat：op1 = op2 + op3（三个串位）',
  '0x1c8': 'to-string：op1（串）= "%d"(op2)',
  '0x2c7': 'SBSubstr（字节语义）：op1 = substr(串op2, op3 起, op4 长)',
  '0x2c8': 'substr（字符语义）：同 0x2c7 的形状',
  '0x2ec': 'atoi：op1 = atoi(串op2)',
  '0x1b2': '文本缓冲追加 op1 串（只读操作数）',
  '0x1b3': '文本缓冲追加 CRLF（argc 0）',
  '0x1b4': '文本缓冲取出整段（argc 0）',
  '0x1a2': 'save-int：读 op1 的值 + **槽号**（`index(1)`）登记表',
  '0x1a3': 'load-int：按 op1 **槽号**查表 → 写回 op1（`rw`）',
  '0x1a9': 'save-string：读 op1 串 + 字符串索引登记表',
  '0x1aa': 'load-string：按索引查表 → 写回 op1 串（`rw`）',
  // ---- 批次：审计点名的操作数条（7 条；两处点名清单到此全部计划化）----
  '0x100': '按键跳读派发（argc 0，键位全在掩码里）',
  '0x305': '文本块结束（argc 0）',
  '0x1ce': '逐字/字格显现开关：只读 op1',
  '0x1a0': '读槽头：op2 读（槽号）、op1+op3..op9 写（结果码 + 年月日时分秒/游玩秒）',
  '0x1b9': 'message:AutoMessageTime{idx} <ms>：idx 严格 0/1（两格只读）',
  '0x2e7': 'message:AutoMessagePitch{idx} <ms>：与 0x1b9 同形同门',
  '0x2fc': '读触摸触点：五位**全写**（无触点路径只写 op1，op2..op5 不动）',
  // ---- 批次：共用 handler 的两族（12 条）----
  '0x106': '配置 getter：op1 = Engine[550]（**写操作数**，与字段写入族正相反）',
  '0x130': 'LOGO/版权页开关 getter：op1 = _this[96983]',
  '0x131': 'GetMesWinAlpha：op1 = GetConfig("message:MesWinAlpha")',
  '0x201': '配置 getter：op1 = Engine[166964]（DrawMode）',
  '0xb5': 'SE 通道起播（播一次）：只读 op1',
  '0xba': 'SE 通道起播（循环）：同 0xB5',
  '0xb7': 'BGM 当前槽起播（循环=1）：op1 = 曲 id（0 = 重播当前曲）',
  '0xb9': 'BGM 当前槽起播（循环=0）：同 0xB7',
  '0xc4': 'play-voice（通道 0，播一次）：只读 op1',
  '0x1bd': 'play-voice（循环位=1）：同 0xC4',
  '0x2c0': '语音排队到通道 0（带延迟）：op1..op3 全读',
  '0x2f5': '语音排队到指定通道：op1..op4 全读',
  // ---- 批次：VM 纯计算族（28 条，`arithmetic.ts`；两个工厂覆盖 20 条）----
  '0x50': 'add：op1 = op2 + op3', '0x51': 'sub', '0x52': 'mul', '0x53': 'div', '0x54': 'mod（C 截断）',
  '0x55': 'mov：op1 = op2（argc 2）', '0x56': 'and', '0x57': 'or', '0x58': 'sar', '0x59': 'shl',
  '0x5a': 'eq', '0x5b': 'ne', '0x5c': 'lt', '0x5d': 'lte', '0x5e': 'gr', '0x5f': 'gre',
  '0x60': 'random：op1 = rand() % op2（模 0 抛错）',
  '0x135': 'SetBit：op1 |= 1<<op2（**op1 是 rw**；位号 >0x1F 无符号越界不写）',
  '0x136': 'RemBit：op1 &= ~(1<<op2)（**op1 是 rw**）',
  '0x13f': 'GetBit：op1 = bit(op2, op3)（**位号是 op3**）',
  '0x191': 'fabs：op1 = |op2|（浮点）',
  '0x2d0': 'fadd', '0x2d1': 'fsub', '0x2d2': 'fmul', '0x2d3': 'fdiv', '0x2d4': 'fmod',
  '0x2d5': 'float mov（argc 2，读写都 float）',
  '0x2d6': 'int→float：写 float op1、读 int op2（计划表唯一"写 float 读 int"）',
  // ---- 批次：音频族整表（20 条，`audio.ts`；除三条 argc 0 外全只读）----
  '0xb4': 'SE 装载：id / 通道 0..9', '0xb6': 'SE 通道停止/释放：通道', '0xb8': '停 BGM（argc 0）',
  '0xbb': 'SE 总开关：开关值', '0xbc': 'BGM 开关/模式：模式值', '0xbf': 'play-bgm：音乐 id',
  '0xc1': 'BGM 暂停/继续翻转（argc 0）', '0xc2': 'BGM 淡变：目标值 / 步长',
  '0xc3': '写运行态当前曲 id（只登记不起播）', '0xc6': '设音量：类别 / 值',
  '0x1ba': 'SetSoundMode：类别（1/2/3/4）/ 开关值', '0x1bc': '清消息声音字段（argc 0）',
  '0x1c9': '音频设备/驱动初始化：id / 数据 / 大小（语料 0 处）',
  '0x2bf': '延迟播 SE：通道 / 循环标志 / 延迟毫秒',
  '0x2f4': '播语音（id / 附带值 / 通道）+ 登记文本项记录',
  '0x2f6': '复位语音通道：通道', '0x2f7': '置语音通道状态位：通道',
  '0x2f8': '设语音通道 pan：通道 / pan', '0x2ff': '语音通道音量因子预备：通道 / 值',
  '0x302': '语音通道音量因子应用：通道 / 因子',
  // ---- 批次：绘制项/场景变换族（31 条，`gfx-item.ts`）----
  '0x1f6': '清空绘制容器四表（argc 0）',
  '0x1fd': '绘制项立即缩放：handle + 三分量（÷100）',
  '0x1ff': 'DrawItem 像素平移：handle + xyz',
  '0x214': '交换两条绘图项记录：两个 handle',
  '0x215': 'getter：op1 = 绘制项→纹理槽号（**写 op1**）',
  '0x216': 'getter：op1 = 槽→imgid（**写 op1**）',
  '0x217': '绘制项 pivot：handle + 3 float',
  '0x218': 'getter：op2/3/4 = pivot（**写 float 位**）',
  '0x219': '绘制项描画位置：handle + 3 float',
  '0x21a': 'getter：op2/3/4 = 描画位置（**写 float 位**）',
  '0x21d': 'CopyScene：源/目标 handle',
  '0x21e': '缩放动画窗（窗1）', '0x21f': '旋转动画窗（窗2）', '0x220': '平移动画窗（窗3）',
  '0x223': '转场记录类别 0：无条件读满 op1..op8',
  '0x228': 'getter：op1 + op3/4/5（失败分支不写 op3..5）',
  '0x22a': 'Scene 立即缩放：3 float（÷100）', '0x22c': 'Scene 立即平移：3 float',
  '0x22d': 'Scene 立即带轴缩放：2 int + 三分量', '0x22f': 'Scene 立即旋转轴/角：2 int + 轴角',
  '0x230': 'B 层：停全部循环通道：handle', '0x231': 'B 层：贴图换格循环',
  '0x232': 'B 层：颜色往复', '0x233': 'B 层：缩放往复', '0x234': 'B 层：匀速旋转', '0x235': 'B 层：平移往复',
  '0x239': 'flipbook 动画窗（窗4）', '0x244': '批量清 A 层动画窗起点（argc 0）',
  '0x320': '顶点网格配置：handle + **7 个指针位** + 顶点数 + 层',
  '0x322': 'set-vertex-color：网格 id / 索引 / α / rgb',
  '0x323': 'set-vertex-color-alpha：5 个 int',
  // ---- 批次：引擎字段/getter 杂项族（20 条，`engine-fields.ts`）----
  '0xad': '秒计时器推进（argc 0）', '0xc0': 'getter：op1 = 当前曲 id（**写 op1**）',
  '0xd0': 'getter：op1 = 墙钟毫秒（**写 op1**）', '0xd9': '清 flag 0x1000（argc 0）',
  '0xfe': 'SetKeyTotal：越界抛 ShowMessage', '0x107': 'SetKey：键下标 / 值',
  '0x10b': 'SetKey（另一表）：值 / 键下标', '0x141': 'SetMesWinAlpha：越界走错误串分支',
  '0x142': '写引擎运行开关 174812', '0x148': 'getter：op1 = 全局时间阈值槽（**写 op1**）',
  '0x149': '写全局时间阈值槽', '0x1ad': 'Engine[166963] = cur（argc 0）',
  '0x1b1': 'Engine[21672] = op1', '0x1bf': '跳读态置（argc 0）',
  '0x247': 'getter：op1 = 引擎布尔（**写 op1**）', '0x25a': '消息态影片（模式 1）',
  '0x2ce': 'getter：op1 = 显示模式（**写 op1**）', '0x2ee': '写 message:MessageFade（字段 + 配置双写）',
  '0x306': 'getter：op1 = system:EffectSkipOnClick（**写 op1**）',
  '0x307': 'SetConfig(system:EffectSkipOnClick)',
  // ---- 批次：帧控制族（10 条，`frame.ts`）----
  '0x7b': '设本帧重显示回退游标：op1 主 / op2 备用（只读）',
  '0xc8': '睡眠/帧让步：op1 = 毫秒（ADV 激活时引擎不读）',
  '0x7c': '重显示返回端（argc 0）', '0xae': '存档版本分支（argc 0）',
  '0x199': '重显示文本（argc 0）', '0x1f4': '进停靠锁（argc 0）', '0x1f5': '退停靠锁（argc 0）',
  '0x20c': '绘图帧控制（argc 0）', '0x21c': '置 0x400 动画等待位（argc 0）', '0x23c': '帧毫秒时钟（argc 0）',
  // ---- 批次：取址/数组/批量搬运族（9 条，`memory.ts`）----
  '0x61': 'lookup-array：op1 **写指针** = &op2[op3]',
  '0x63': 'lea：op1 **写指针** = &op2',
  '0x64': 'copy-local-array：op1 目标(ptr 读) + 字面数组',
  '0x6c': 'copy-to-global = 置零：op1 起始(ptr) + 个数',
  '0x12c': 'lookup-array-2d：op1 **写指针** + 基址/行/列宽/列',
  '0x12f': '索引插入排序：三个数组基址(ptr) + 个数',
  '0x1b0': 'memcpy：两个基址(ptr) + 个数',
  '0x2c9': '可变数组元素引用：op1 **写指针** + 基址 + 下标（<0 抛错）',
  '0x2d8': 'bulk 填充：op1 目标(ptr) + 值 + 个数',
  // ---- 批次：控制流 + 队列族（15 条，`control.ts`；`0x1a7` 按策略排除：体是 nop 且 handler 零参数）----
  '0x1': 'abort（argc 0）', '0x2': 'exit（argc 0）', '0x3': 'call-script：目标脚本索引',
  '0x5': 'ret（argc 0）', '0x6': 'load-frame：脚本索引 + 帧号', '0x8': 'call-frame：帧号',
  '0x9': 'exit-script（argc 0）', '0x8c': 'jmp：label（-1 = 落下句）',
  '0x8f': 'call：label（-1 = 弹回）', '0xa0': 'jcc：条件 + 真/假分支 label',
  '0x132': 'Queue_int 队·重建：队下标', '0x133': 'Queue_int 队·压入：队下标 + 值',
  '0x134': 'Queue_int 队·弹出：队下标 + **写 op2/op3**（成功位/值）',
  '0x143': '派发扩展包 AUTORUN（argc 0）', '0x1a8': '写指令步长槽（argc 0）',
  // ---- 批次：消息窗族整表（51 条，`msgwin.ts`）----
  '0x6e': 'show-text：窗 + 字符串', '0x6f': 'end-text-line：窗', '0x70': '窗口几何：win/w/h/x/y',
  '0x71': '开始新消息：窗', '0x72': '等待输入（逐字门）：窗', '0x73': '字格设置：op1..op10 全读',
  '0x74': '消息速度字段', '0x75': '主字号', '0x79': '文本块原点：win/x/y', '0x7a': '窗对象 +48/+52',
  '0x7f': '**getter**：op1 = 消息速度', '0x80': '默认窗设置', '0x88': '消息模式',
  '0x90': '点击热点表 push：x/y/w/h + 三个 label', '0xfa': '轮询消息推进（argc 0）',
  '0x196': '注音：窗 + 本文词 + 注音', '0x197': '注音字号', '0x198': '窗口位置：win/x/y',
  '0x19a': '**getter**：op1 = 跳读模式', '0x19b': '退出 ADV（argc 0）', '0x19c': '进入 ADV（argc 0）',
  '0x1a5': '主字体名（字符串）', '0x1b5': '设置消息速度', '0x1b6': '**getter**：op1 = 共存态',
  '0x1b7': '设置共存态', '0x1c1': '换行设置：win/x/y', '0x1c7': '**getter**：op1 = ADV 激活位',
  '0x1ca': '设置跳读文本态', '0x1cb': '**getter**：op1 = 跳读文本态', '0x1cc': '**getter**：op1 = 是否有消息',
  '0x204': 'draw-string：槽/x/y + 字符串', '0x205': 'draw-number-string：**op2 读后写回**',
  '0x20a': '窗重排：窗', '0x212': '窗对象 +100', '0x213': '窗对象区间（+104/+108）',
  '0x25c': '窗对象文本块 +224：op1..op8 全读', '0x25d': '窗对象区间 2（+276/+280）',
  '0x25e': '窗对象颜色对 5 位', '0x25f': '窗对象颜色对 4 位', '0x260': '竖排矩形内边距',
  '0x2bd': '主字体加粗', '0x2be': '注音加粗', '0x2cd': '滚轮推进消息开关',
  '0x2dc': '**getter**：op1 = 字体表项数', '0x2dd': '**getter**：op1（字符串）= 第 op2 项字体名',
  '0x2de': '**getter**：op1 = 字体名→下标（op2 字符串）', '0x2e8': 'AutoMessageOption 写入端',
  '0x2fe': '注音字体名（字符串）', '0x300': '窗槽标志：win/a/b', '0x301': '窗槽清场：窗',
  '0x303': '对齐设置：win/mode/width',
  // ---- 批次：场景/图元状态族（18 条，`gfx-state.ts`；`0x33f` 按策略排除：引擎三读、实现无消费端）----
  '0x1fc': '复位图元变换：handle', '0x1fe': '图元变换 4 浮点：handle + 4 float',
  '0x207': '槽→槽 StretchRect：8 位全读', '0x20d': '设置渲染目标：槽',
  '0x20e': '图形提交（argc 0）', '0x224': '清转场表（argc 0）',
  '0x229': '绘制模式 5 元组：2 int + 3 float', '0x238': '装载等待门时长',
  '0x242': '写 DrawItem +720：handle + 值', '0x243': '复位等待门计时器（argc 0）',
  '0x24f': 'SetBlindWipe 转场记录：op1..op10', '0x250': '转场记录类别 3：op1..op10',
  '0x251': '转场记录类别 3：op1..op12', '0x256': 'DrawItem 参数：2 int + 3 float',
  '0x258': '纹理槽标志对（语料 11356 处）', '0x321': 'MeshEntry 属性：handle/a/b',
  '0x32a': '释放 3D 模型槽', '0x32d': '3D 颜色：alpha/rgb',
  // ---- 批次：输入族（11 条，`input.ts`）----
  '0xcc': '注册鼠标跳转：节流槽 + **label**', '0xcd': '点击推进门（argc 0）',
  '0xfb': '注册手柄跳转：掩码位 + **label**', '0xff': '复位输入（argc 0）', '0x101': '刷输入掩码（argc 0）',
  '0x108': '**getter**：op1 = 鼠标按钮', '0x109': '**getter**：op1 = X、op2 = Y',
  '0x10a': '移动光标：X/Y', '0x10d': '**getter**：op1 = 滚轮增量',
  '0x12e': '悬停命中：op1（**rw**）+ **4 个指针位** + 3 int',
  '0x2e5': '**getter**：op1 = 水平滚轮增量',
  // ---- 批次：纹理/杂项/文本项/面板/存档槽（34 条；`0x1a1` 按策略排除：引擎不消费 op1）----
  '0x1f7': '解绑纹理：handle + count', '0x1f8': 'create-texture：槽/宽/高/标志',
  '0x1fa': 'release-texture：槽', '0x1fb': 'draw-texture：8 位全读',
  '0x208': '**getter**：op1 = 槽、**op2/op3 = 宽/高（写）**', '0x20b': 'FillTexture：槽 + 矩形 + 颜色',
  '0x23f': '**getter**：op1 = 尺寸×1000；op2 = 节点', '0x245': '纹理对象浮点参数',
  '0x246': '纹理对象子对象 vtable+56', '0x249': '按 id 载纹理进槽（带颜色）',
  '0x23d': '销毁 movie 槽 42..999（argc 0）', '0x248': '模块静态配置：op1',
  '0x259': '清槽记录表（argc 0）', '0x32b': '清网格槽表（argc 0）',
  '0x32f': '灯光开关：索引 0..9', '0x340': '渲染状态下发：op1',
  '0x85': '清文本项两张表（argc 0）', '0x1bb': 'SetTB：op1',
  '0x1d0': '回看页索引表：**只读 op3**、写 op1/op2',
  '0x1d2': '文本项 push：key + value', '0x1d3': '文本项查询：**读 op4/op5**、写 op1/op2',
  '0x1d4': '文本项查询（通道 0）：**读 op4**、写 op1/op2',
  '0x2f3': '文本项查询：**读 op5/op6**、写 op1..op3',
  '0x91': '消息面显示态开：op1', '0x92': '显示态开（带回退 label）：op1/op2',
  '0x93': '消息面显示态关（argc 0）', '0x94': '消息面显示态开（argc 0）',
  '0x97': '掩码位绑热点：矩形 + 掩码位（5 位）',
  '0x19e': '存档：op2 = 槽号、**op1 = 结果码（写）**', '0x19f': '读档（短版）：op1 = 结果码',
  '0x1ab': '删槽：op2 = 槽号、op1 = 结果码', '0x1ac': '复制槽：op2 → op3、op1 = 结果码',
  '0x1a1': '读档（全量）：op2 = 槽号；**op1 = `unused`**（引擎不读不写）',
  '0x1ae': '写 .STH：op2 = 槽号、op3 = 缩略图槽、op1 = 结果码',
  '0x1af': '读 .STH：op2 = 槽号、op3 = 缩略图槽、op1 = 结果码',
  // ---- 收尾批（27 条；`0x14d`/`0x308`/`0x33f` 为 C 类策略排除：引擎读、实现无消费端）----
  '0xa1': '菜单派发表复位（argc 0）', '0xa2': '登记菜单项 key→label', '0xa3': '按 key 查表派发',
  '0xd3': '阶梯动画时间表清空（argc 0）', '0xd4': '阶梯动画时间表追加条目',
  '0xd5': '阶梯动画时间表起表：输入打断 label',
  '0x147': '多边形命中测试：op1 写结果 + **op4/op5 指针位**',
  '0x2f2': '椭圆命中测试：op1 写结果 + **op4 指针位**',
  '0x14b': '加载 AGERC 模块：op1', '0x14c': 'set-agerc-export：槽 + **导出名（字符串）**',
  '0x19d': '已使用文件查询：**op1 ← 是否打开过**',
  '0x1d6': '音乐表·追加扁平表：**op1 ← 结果**', '0x1d7': '音乐表·确保组数：**op1 ← 结果**',
  '0x1d8': '音乐表·组内登记：**op1 ← 结果** + 组号 + 值',
  '0x23b': 'CG 数字条画数值：7 位全读',
  '0x2da': 'CG 数字条记录登记：op1 + **op2..op8 循环读**',
  '0x1a7': 'comment：**op1 = unused**（体是 nop）',
  '0x341': 'Live2D 模型加载：id + 实例槽', '0x342': '销毁实例槽',
  '0x344': '建/绑立绘节点：key + 实例槽', '0x345': 'Live2D 纹理装载：id + 槽 + 纹理号',
  '0x346': '节点复位：key', '0x34e': '装 .MTN 动作：文件 id + 3 位',
  '0x34f': '纹理乘色：实例槽 + 颜色', '0x350': '复位动作队列：实例槽',
  '0x351': '命名参数：实例槽 + **参数名串** + 值', '0x352': '槽参数设置：槽号 + which + value',
};

const OPCODES: { opcode: number; argc: number }[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts/asm/opcodes.json'), 'utf8'),
);
const ARGC_OF = new Map(OPCODES.map((o) => [o.opcode, o.argc]));

test('★计划表自洽：每个计划的 argc ⟷ 文档 argc；kinds/io 长度相等；evidence 非空', () => {
  const ops = plannedOps();
  assert.ok(ops.length >= 347, `迁移进度异常：只声明了 ${ops.length} 条计划（棘轮：≥319）`);
  const bad: string[] = [];
  for (const op of ops) {
    const plan = planOf(op)!;
    const key = `0x${op.toString(16)}`;
    const doc = ARGC_OF.get(op);
    if (doc === undefined) bad.push(`${key} 不在 opcodes.json 里`);
    else if (doc !== plan.argc) bad.push(`${key} 计划 argc=${plan.argc} 与文档 argc=${doc} 不符`);
    if (plan.kinds.length !== plan.argc) bad.push(`${key} kinds=${plan.kinds.length} ≠ argc=${plan.argc}`);
    if (plan.io && plan.io.length !== plan.argc) bad.push(`${key} io=${plan.io.length} ≠ argc=${plan.argc}`);
    if (!plan.evidence.trim()) bad.push(`${key} 缺 evidence`);
    if (plan.kinds.some((k) => !['int', 'float', 'str', 'ptr', 'any'].includes(k)))
      bad.push(`${key} kinds 里有未知类型：${plan.kinds.join(',')}`);
  }
  assert.deepEqual(bad, [], `计划表与文档不一致（改计划前先核体）：\n  ${bad.join('\n  ')}`);
});

test('★操作数记数槽模型 ⟷ 反编译体：`operandCountSlotValue(op, argc)` 逐条等于体里写的 N（含"谁写 0"）', () => {
  const { rows } = scanArity();
  const mismatch: string[] = [];
  const zeroByEngine = new Set<number>();
  for (const r of rows) {
    if (r.step === 0) zeroByEngine.add(r.op);
    const model = operandCountSlotValue(r.op, r.argc);
    if (model !== r.step) {
      mismatch.push(`0x${r.op.toString(16)}(${r.handler}) 体写 ${r.step}，模型给 ${model}（argc=${r.argc}）`);
    }
  }
  assert.deepEqual(mismatch, [], `操作数记数槽模型与引擎体不一致：\n  ${mismatch.join('\n  ')}`);
  assert.deepEqual(
    [...zeroByEngine].sort((a, b) => a - b),
    [...ZERO_LENGTH_OPS].sort((a, b) => a - b),
    '★"体里写 0（自己定 ip）"的指令集合必须与模型 `ZERO_LENGTH_OPS` 完全一致（多一条少一条都红）',
  );
  // 计划里的每一条也要能被模型覆盖（防止声明了却不参与核验）
  for (const op of plannedOps()) {
    const plan = planOf(op)!;
    assert.equal(operandCountSlotValue(op, plan.argc), ZERO_LENGTH_OPS.has(op) ? 0 : 2 * plan.argc + 1, `0x${op.toString(16)}`);
  }
});

test('★计划 ⟷ 实现：已迁移的 handler 碰过的位必须覆盖计划声明为 r/rw 的位，且不越界', () => {
  const bad: string[] = [];
  for (const [key, why] of Object.entries(MIGRATED)) {
    const op = Number(key);
    const plan = planOf(op);
    if (!plan) {
      bad.push(`${key} 在 MIGRATED 里但没有计划（${why}）`);
      continue;
    }
    if (!OPS.has(op) && !NATIVE_OPS.has(op) && !ENGINE_INTERNAL_OPS.has(op)) {
      bad.push(`${key} 未注册 handler`);
      continue;
    }
    const e = new Engine(new StubNative(() => {}), new InputManager());
    const f = e.curScript();
    const realArgs: BinArg[] = [];
    // ★按**计划声明的类型**造实参（不是一律 int 槽）：
    //   - `int`/`float`：本帧 int 槽（type 0x9）—— 可读可写，float 读 int 槽 = int→float 转换；
    //   - `str`：字符串操作数（type 0x2，`str` 字段直给）；★写目标位也必须是**字符串型**
    //     否则 `writeStringOperand` 会抛（这正是本批新增 `0x2eb`/`0x194` 这类计划后才需要的口径）；
    //   - `ptr`/`any`：本帧指针槽（type 0xC）。
    for (let i = 0; i < plan.argc; i++) {
      const k = plan.kinds[i];
      if (k === 'str') realArgs.push({ type: 0x2, raw: 0, str: `s${i}` } as unknown as BinArg);
      else if (k === 'ptr') {
        // ★指针位要**初始化**：`refFromOperand` 对空引用槽会抛（`空/未初始化引用被取址`），
        //   而空引用在合成指令里是常态（真实语料总会先 `lea`）⇒ 这里塞一个合法 Ref，
        //   否则 handler 会停在第一个指针位、后面的位全被判成"漏读"（本批 `0x320` 就是这样被抓出来的）。
        const raw = 0x40 + i;
        f.locals.ptr.set(raw, { scope: 'global', kind: 'int', index: 0, stride: 4 });
        realArgs.push({ type: 0xc, raw } as unknown as BinArg);
      } else realArgs.push({ type: 0x9, raw: 0x40 + i } as unknown as BinArg);
    }
    // ★用 Proxy 观测 handler **真的碰了**哪几格（与 `test/opcode-operands.test.ts` 同一手法）——
    //   不能拿 `operandsFor()` 自己返回的 view 的 `touched`：那是**守卫这边**新建的视图，
    //   handler 内部还会再建一个（两者不是同一个 Set），观测不到它的行为。
    // ★触碰观测 = 共享的 `harness.trackArgs`（`tickets/T-0129` 上收）
    const { args, hits } = trackArgs(realArgs);
    const one: BinInstruction = {
      opcode: op,
      name: `i${op.toString(16)}`,
      argc: plan.argc,
      args,
      byteOffset: 0,
      index: 0,
    } as unknown as BinInstruction;
    const sc = {
      ...scriptDerived(),
      signature: 'SYS4450 ',
      isVer5: false,
      headerLen: 0x3c,
      localVars: [0, 0, 0, 0, 0, 0],
      subHeaderLength: 0,
      tables: [
        { length: 0, offset: 1 },
        { length: 0, offset: 1 },
        { length: 0, offset: 1 },
      ],
      instructions: [one],
      labelTargets: new Set<number>(),
      raw: new Uint8Array(0),
    } as unknown as ScriptBinary;
    (f as unknown as { script: ScriptBinary }).script = sc;
    assert.ok(operandsFor({ e, frame: f, instr: one }), `${key} 有计划但 operandsFor 没认出来`);
    const h = OPS.get(op) ?? NATIVE_OPS.get(op) ?? ENGINE_INTERNAL_OPS.get(op);
    // ★**两遍合成执行**（seed = 0 / 1），并集"碰过的位"：有的指令**按值分支读**（`0xa0` jcc 条件为假时
    //   只读 op3、为真时只读 op2；`0xc7` 一族的选择器 0 非法 / 1 合法）—— 单遍合成输入必然漏一支。
    //   两遍把两支都走到，判据仍然"声明的读位都必须被碰"（不放松）。指针槽两遍都塞合法 Ref。
    for (const seed of [0, 1]) {
      for (let i = 0; i < plan.argc; i++) {
        if (plan.kinds[i] !== 'str') f.locals.int.set(0x40 + i, seed);
      }
      // ★合成输入可能让 handler **抛**（`0x53/0x54` 除数为 0、`0x60` 模数为 0、非法选择器…）——
      //   这不是失败：本用例只核"它碰过哪几格"。抛之前碰过的位照样算数（Proxy 已经记下）。
      //   反之，如果 handler 在**读到位之前**就抛，`missing` 仍会把它抓出来。
      // ★★但**计划层自己抛的违规**不许吞：`deny`/`denyIo`（"不能按 … 访问"/"不能写"）与
      //   "…走操作数计划层，但没有声明计划"都是**计划与实现不一致**的直接证据 —— round 13 加的
      //   try/catch 曾把它们一起吞掉 ⇒「声明 r 却在写」这类方向错误**不会被发现**（变异实验当场暴露）。
      try {
        const ret = h!(makeCtx(e, f, one, new StubNative(() => {}), () => {})) as unknown as Promise<unknown> | undefined;
        if (ret && typeof (ret as { then?: unknown }).then === 'function') void ret.catch(() => {});
      } catch (err) {
        const msg = String((err as { message?: unknown })?.message ?? err);
        if (/操作数计划|不能按|不能写/.test(msg)) {
          bad.push(`${key} 计划层违规：${msg}`);
          break;
        }
        /* 其它（合成输入导致的业务抛错）：忽略（见上） */
      }
    }
    const hit = hits();
    // ★`unused` 位（指令里带一格但引擎/实现都不消费）与 `w` 一样**不要求被碰** —— 见 `OperandIo` 说明。
    const want = plan.kinds.map((_k, i) => i + 1).filter((n) => {
      const io = plan.io?.[n - 1] ?? 'r';
      return io !== 'w' && io !== 'unused';
    });
    const missing = want.filter((n) => !hit.includes(n));
    const beyond = hit.filter((n) => n < 1 || n > plan.argc);
    if (missing.length) bad.push(`${key} 计划声明要读的位 ${missing.join(',')} 没被碰（${why}）`);
    if (beyond.length) bad.push(`${key} 碰了越界位 ${beyond.join(',')}`);
  }
  assert.deepEqual(bad, [], `计划与实现不一致：\n  ${bad.join('\n  ')}`);
});

/**
 * ★**派生守卫**（本批新增）：引擎字段写入族（`ENGINE_FIELD_STORE` 的 14 条）**必须各有计划**，
 * 且计划的 `argc`/类型必须与该族自己的表（spec map 的最大位号）一致。
 *
 * 为什么要有它（而不是靠人工维护 MIGRATED 名单）：这族共用一个 handler，
 * 「op → 读第几位 → 写哪个字段」的真源是 `ENGINE_FIELD_STORE`。守卫**从同一张表推导**应有计划
 * ⇒ 以后新增一条 spec 却忘了在 `operandPlan.ts` 声明计划，这里立刻红（handler 那边则直接抛）。
 */
test('★字段写入族：`ENGINE_FIELD_STORE` 推导出的每条都必须有计划，且 argc/类型一致', () => {
  const rows = fieldStorePlanOps();
  assert.ok(rows.length >= 14, `该族至少 14 条（实得 ${rows.length}）—— 少了说明表被改动`);
  const bad: string[] = [];
  for (const { op, argc } of rows) {
    const key = `0x${op.toString(16)}`;
    const plan = planOf(op);
    if (!plan) {
      bad.push(`${key} 在 ENGINE_FIELD_STORE 里但没声明操作数计划（argc 应为 ${argc}）`);
      continue;
    }
    if (plan.argc !== argc) bad.push(`${key} 计划 argc=${plan.argc} ≠ 表里最大位号 ${argc}`);
    if (plan.kinds.some((k) => k !== 'int')) bad.push(`${key} 该族全部 int，计划却写了 ${plan.kinds.join(',')}`);
    if (plan.io && plan.io.some((d) => d !== 'r')) bad.push(`${key} 该族只读操作数，计划却写了 ${plan.io.join(',')}`);
  }
  assert.deepEqual(bad, [], `字段写入族的计划与表不一致：\n  ${bad.join('\n  ')}`);
});

/**
 * ★**派生守卫（配置读取族）**：`CFG_READ` + `0x194/0x195/0x2eb` 推导出的每条都必须有计划，
 * 且方向必须"结果位 `w`、选择器位 `r`"。与字段写入族那条同源思路：应有名单**从表推导**，
 * 不靠人工维护 ⇒ 以后往 `CFG_READ` 加一条却忘了声明计划，CI 立即红（handler 侧会直接抛）。
 */
test('★配置读取族：推导出的每条都必须有计划，且结果位 = w、选择器位 = r', () => {
  const rows = cfgReadPlanOps();
  assert.ok(rows.length >= 10, `该族至少 10 条（实得 ${rows.length}）`);
  const bad: string[] = [];
  for (const { op, argc, operand, reads } of rows) {
    const key = `0x${op.toString(16)}`;
    const plan = planOf(op);
    if (!plan) {
      bad.push(`${key} 在配置读取族里但没声明操作数计划（argc 应为 ${argc}）`);
      continue;
    }
    if (plan.argc !== argc) bad.push(`${key} 计划 argc=${plan.argc} ≠ 表里推得的 ${argc}`);
    const io = plan.io;
    if (!io) bad.push(`${key} 该族方向不是全 r，计划必须显式写 io`);
    else {
      if (io[operand - 1] !== 'w') bad.push(`${key} 结果位 ${operand} 应为 w，实为 ${io[operand - 1]}`);
      for (const n of reads)
        if (io[n - 1] !== 'r') bad.push(`${key} 读取位 ${n} 应为 r，实为 ${io[n - 1]}`);
    }
  }
  assert.deepEqual(bad, [], `配置读取族的计划与表不一致：\n  ${bad.join('\n  ')}`);
});

/**
 * ★**计划覆盖账（分区 + 棘轮）**：判据 1 的原话是"至少覆盖审计列出的 13 条与**所有已核对行**"——
 * 本用例把这个"所有"变成一个**可辩护的分母**，三类全部从既有真源推导（不手写名单）：
 *
 *  - **A 引擎不消费操作数**（注册在 `ENGINE_INTERNAL_OPS`）：计划层的语义是"声明这条指令真读/真写的位"，
 *    对"有据跳过"的 engine-internal/no-op **不适用**（强行声明只会得到假声明）⇒ **按策略排除**。
 *  - **B 未注册**（`OPS`/`NATIVE_OPS`/`ENGINE_INTERNAL_OPS` 三张表都没有）：属**缺口台账**那条线
 *    （`analysis/opcode-gaps.json`；"语料用到就必须登记"这条不变式由 `test/opcode-gaps.test.ts` 管）。
 *  - **C 真 handler**：计划层该覆盖的**真实分母**，随迁移单调下降（棘轮只减不增）。
 *
 * ⇒ `已核对行 = 已计划 + A + B + C` 必须恒成立；任何一类漂移（例如把 engine-internal 的 op 挪进 `OPS`、
 *   或漏注册一个新 op）都会让等式不成立或让 C 变大 ⇒ 红。
 */
test('★计划覆盖账：已核对行 = 已计划 + A 引擎内部 + B 未注册 + C 待迁移（C 只减不增）', () => {
  const planned = new Set(plannedOps());
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis/opcodes.json'), 'utf8')) as {
    entries: { opcode: number; status: string }[];
  };
  const checked = data.entries.filter((e) => e.status.startsWith('已核对'));
  const A: number[] = [];
  const B: number[] = [];
  const C: number[] = [];
  let covered = 0;
  for (const e of checked) {
    if (planned.has(e.opcode)) {
      covered++;
      continue;
    }
    if (ENGINE_INTERNAL_OPS.has(e.opcode)) A.push(e.opcode);
    else if (OPS.has(e.opcode) || NATIVE_OPS.has(e.opcode)) C.push(e.opcode);
    else B.push(e.opcode);
  }
  // ★2026-09-23 删除一条**恒真断言**（`tickets/T-0125`）：上面 `:514` 起的 `if / else if / else`
  //   保证每个 `checked` 元素必进且只进一个桶 ⇒ `covered + A + B + C ≡ checked.length` **永远成立**，
  //   "等式不成立 ⇒ 分区有洞"这句注释描述的洞在这段代码里不可能出现。反例实验：把任意一条
  //   `analysis/opcodes.json` 的 status 改成别的 ⇒ 该条进循环 ⇒ 四个桶之和仍 ≡ checked.length。
  //   真正有判别力的是下面两条棘轮（它们能红）：
  assert.ok(covered >= 347, `计划覆盖数下滑：${covered}（棘轮 ≥347）`);
  assert.ok(
    C.length <= 3,
    `待迁移的"真 handler"变多了（${C.length} > 3）—— 要么新注册了 op 没声明计划，要么分类口径变了`,
  );
  console.log(
    `[plan] 已核对 ${checked.length} = 已计划 ${covered} + A 引擎内部 ${A.length} + B 未注册 ${B.length} + C 待迁移 ${C.length}`,
  );
});

test('★运行期：派发器把模型值写进 `frame.operandCount`，`StepTrace.operandCount` 报出来（控制流三条为 0）', async () => {
  const native = new StubNative(() => {});
  const e = new Engine(native, new InputManager());
  const script: ScriptBinary = {
    ...scriptDerived(),
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: 0x3c,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 0 },
      { length: 0, offset: 0 },
      { length: 0, offset: 0 },
    ],
    instructions: [
      instr(0x32, [im(2), im(0xe), im(0), im(0), im(0x500), im(0x2d0), im(0), im(0), im(0x140), im(0xb4)]),
      instr(0x2, []), // exit：操作数记数槽写 0（自己定 ip）
    ],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(0),
  };
  loadScriptIntoFrame(e.curScript(), script, 'FAKE.BIN');

  const t1 = await stepOnce(e);
  assert.equal(t1.operandCount, 2 * 10 + 1, '0x32（argc 10）⇒ 操作数记数槽 = 21');
  assert.equal(e.curScript().operandCount, t1.operandCount, '帧字段与 trace 同源');
  assert.equal(t1.operandCount, operandCountSlotValue(0x32, 10));

  // `0x2` exit：**操作数记数槽为 0**（引擎派发器因此不前进，由 handler 自己定 ip）。handler 会抛"script exit"
  // ⇒ 断言那一步之前写进帧里的值（派发器在 handler 之前写该槽，这正是引擎的次序）。
  await assert.rejects(() => stepOnce(e), /script exit/);
  assert.equal(e.curScript().operandCount, 0, '★0x2 exit 的操作数记数槽为 0');
  assert.equal(ZERO_LENGTH_OPS.has(0x2), true);
});
