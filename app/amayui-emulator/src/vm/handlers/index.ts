/**
 * **opcode handler 注册表** —— 把各子系统模块声明的 `*_OPS` 表拼成三张 Map。
 *
 * 三张表的语义差异（ADR-005 的"分类插桩"分支，见 interpreter.resolveHandler 的查找顺序）：
 *  - `OPS`                 = `implemented`：VM 核心，已精确实现 → 执行；
 *  - `NATIVE_OPS`          = `native`：经 `NativeBridge` 落到宿主子系统（渲染/音频/输入/配置）；
 *  - `ENGINE_INTERNAL_OPS` = `engine-internal`：引擎内部状态/无对应子系统 → 记录并跳过。
 *
 * 三者都查不到 ⇒ `NotImplementedOp` 硬报错（绝不静默）。
 *
 * 拆分原则：**一个模块 = 一个引擎子系统**，模块自己声明它负责的 opcode 与注释；
 * 本文件只做拼装，因此"某 opcode 归哪个子系统"永远只有一个地方可查。
 */
import type { OpHandler } from '../step.js';
import type { OpTable } from './shared.js';

import { ARITHMETIC_OPS } from './arithmetic.js';
import { MEMORY_OPS } from './memory.js';
import { STRING_OPS, STRING_NATIVE_OPS } from './strings.js';
import { ENGINE_FIELD_OPS, ENGINE_FIELD_NATIVE_OPS } from './engine-fields.js';
import { CONFIG_READ_OPS } from './config-read.js';
import { CONTROL_OPS } from './control.js';
import { MSGWIN_OPS } from './msgwin.js';
import { TEXT_ITEM_OPS } from './text-items.js';
import { GFX_STATE_OPS } from './gfx-state.js';
import { AGERC_OPS } from './agerc.js';
import { PANEL_OPS } from './panel.js';
import { FRAME_OPS, FRAME_NATIVE_OPS } from './frame.js';
import { GFX_CG_OPS } from './gfx-cg.js';
import { GFX_TEXTURE_OPS, GFX_TEXTURE_NATIVE_OPS } from './gfx-texture.js';
import { GFX_ITEM_OPS, GFX_ITEM_NATIVE_OPS } from './gfx-item.js';
import { GFX_MISC_OPS, GFX_MISC_NATIVE_OPS } from './gfx-misc.js';
import { LIVE2D_OPS, LIVE2D_NATIVE_OPS } from './live2d.js';
import { MENU_OPS } from './menu.js';
import { INPUT_OPS } from './input.js';
import { AUDIO_OPS } from './audio.js';
import { MUSIC_TABLE_OPS } from './music-table.js';
import { RESOURCE_USAGE_OPS } from './resource-usage.js';
import { SAVE_SLOT_OPS } from './save-slot.js';
import { STAGE_OPS } from './stage.js';
import { STUB_NATIVE_OPS } from './stubs.js';

/** 已实现的最小 VM 指令表（`implemented`）。 */
export const OPS: Map<number, OpHandler> = new Map<number, OpHandler>([
  ...ARITHMETIC_OPS,
  ...MEMORY_OPS,
  ...STRING_OPS,
  ...ENGINE_FIELD_OPS,
  ...CONFIG_READ_OPS,
  ...CONTROL_OPS,
  ...MSGWIN_OPS,
  ...TEXT_ITEM_OPS, // 0x1BB/0x1D2/0x1D3/0x1D4/0x2F3：文本项记录表（回想/历史 + 语音重播的账本）
  ...GFX_STATE_OPS, // A4：图元/网格/纹理/渲染状态 13 条（2 条建模 + 11 条宿主缝）
  ...AGERC_OPS, // A6：AGERC 模块接口 0x14B/0x14C/0x14D（模型化，不加载原生库）
  ...PANEL_OPS, // A5：消息面/面板表面 0x93/0x94/0x97
  ...FRAME_OPS,
  ...GFX_CG_OPS,
  ...GFX_TEXTURE_OPS,
  ...GFX_ITEM_OPS,
  ...GFX_MISC_OPS,
  ...LIVE2D_OPS, // 0x342/0x344/0x346–0x352：Live2D 实例槽 + 572B 立绘节点（纯 VM 状态）
  ...MENU_OPS,
  ...INPUT_OPS,
  ...MUSIC_TABLE_OPS, // 0x1D6/0x1D7/0x1D8：音乐表（写 op1，纯 VM 状态）
  ...RESOURCE_USAGE_OPS, // 0x19D：已使用文件查询（回想/CG/BGM 鉴赏的解锁判定，写 op1）
  ...SAVE_SLOT_OPS, // 0x19E/0x19F/0x1A0/0x1A1/0x1AB/0x1AC/0x1AE/0x1AF：存档槽链路（存档/读档/读头/删/复制/.STH）
  ...STAGE_OPS, // 0xD3/0xD4/0xD5：阶梯动画调度器（时间表 + 0x40 门；消费者是 frame/loop.ts 的 stage 分支）
]);

/** 子系统 opcode → NativeBridge（`native`）。 */
export const NATIVE_OPS: Map<number, OpHandler> = new Map<number, OpHandler>([
  ...STRING_NATIVE_OPS,
  ...ENGINE_FIELD_NATIVE_OPS,
  ...FRAME_NATIVE_OPS,
  ...GFX_TEXTURE_NATIVE_OPS,
  ...GFX_ITEM_NATIVE_OPS,
  ...GFX_MISC_NATIVE_OPS,
  ...LIVE2D_NATIVE_OPS, // 0x341/0x345/0x34E：装 .MOC / 纹理 / .MTN（宿主读文件后回调共享层）
  ...AUDIO_OPS,
  ...STUB_NATIVE_OPS,
]);

export { ENGINE_INTERNAL_OPS } from './stubs.js';
export { ExitScript, loadScriptIntoFrame } from './control.js';

/** 便于测试/工具遍历：三张表的名字（与 handlerKind 一致）。 */
export const REGISTRY_NAMES = ['OPS', 'NATIVE_OPS', 'ENGINE_INTERNAL_OPS'] as const;

/** 表类型再导出，方便按需新增子系统模块。 */
export type { OpTable };
