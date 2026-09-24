/**
 * **存档槽链路**（`tickets/T-0018`）：读档 / 存档 / 读头 / 删槽 / 复制槽 / `.STH`。
 *
 * 语义与格式见 `src/save/saveSlot.ts` 的文件头（引擎 raw 依据、头部契约 E4、本工程槽布局都在那里）。
 * 本模块只做三件事：
 *  1. 读操作数（槽号等）；
 *  2. 经 `Engine.fileSource` 做**异步**文件 I/O（`OpHandler` 允许返回 Promise，`stepOnce` 会 `await`）；
 *  3. 按引擎写回操作数（`op1` 结果码 + `0x1A0` 的 6×u16 + 游玩秒数）。
 *
 * ★为什么 handler 可以 async（而纹理帧屏障走的是"驱动钩子"）：`stepOnce` 是
 * `await handler(ctx)`（`interpreter.ts`），所以 handler 自己 await 文件 I/O 是安全的；
 * 屏障那条走钩子是因为它要等的是**宿主 IPC**、且必须发生在"本指令之后、下一条之前"（见 `frame/loop.ts`）。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { readIntOperand, writeIntOperand } from '../operand.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import type { OpTable } from './shared.js';
import { parseSlotFile, parseSlotHeader, buildSlotFile, buildSlotThumb, type SlotFrameState, type SlotStateBlock } from '../../save/saveSlot.js';
import { decodeEngineSlot, resolveSlotRetStack, type EngineSlotPayload } from '../engineSlot.js';
import { decodeEngineDrawItem } from '../engineDrawItem.js';
import { restoreAdvState, snapshotAdvState } from '../advState.js';
import { bgmReplayIntent } from './audio.js';
import { decodeBmp, encodeBmp } from '../bmp.js';
import { enc } from '../bits.js';
import type { Engine } from '../engine.js';
import { parseScriptBytes } from '../../script/bin.js';
import { loadScriptIntoFrame } from '../scriptFrame.js';
import { ENGINE_FIELD } from '../engineFieldIds.js';
import { l2dResetHost } from '../../live2d/runtime.js';

/**
 * 取本族的**操作数计划视图**（`tickets/T-0082` 批次：存档槽族（save-slot；`0x1a1` 按策略排除：引擎不消费 op1），6 条）；缺计划 = 编程错误。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：存档槽族走操作数计划层，但没有声明计划（0x1a1 按策略排除：引擎不消费 op1）`);
  return p;
}


/**
 * **读档 = 一次控制转移，不是一次普通函数调用**（`tickets/T-0056`）。
 *
 * 引擎 `sub_410160` 在**全量档**（`a6=1`，即 `0x1A1`/`0x190`）里做了这些事（raw 19464-19476）：
 * ```
 * qmemcpy(Engine+84088, Engine+497416, 0x28);   // 把存档里的字体/消息窗状态拷回
 * sub_4B5090(Engine+82876);                     // 文本/窗口子系统复位
 * sub_403EF0(Engine+51904); sub_403EF0(Engine+21976);   // 两张面板复位（路由表清空）
 * v20 = sub_455000(FileDB, String2);            // ★解析**存档里记录的脚本名**
 * Engine[383120] = 1;                           // 「正在读档」门（`0xAE` 读它）
 * Engine[383104] = 0;                           // ★cur = 0（回到根帧）
 * if (v20 < 0) { sub_40F750(Engine, 1, 10); return 0; }   // 解析不出 ⇒ 另走装载
 * ... 装载 v20 到帧 0（LABEL_136）
 * ```
 * ⇒ **调用方脚本被放弃**：SAVE.BIN 那类界面脚本不会在 `0x1A1` 之后继续跑。
 *
 * ★这不是"实现细节"，而是**必须**的：不转移的话，调用方脚本会带着"上一个子脚本（如 SBUNKI，
 * id 54）留下的鼠标回调身份"继续跑它的 `get-input-type` 主循环 ⇒ 命中 `0xCD` 的
 * `Depth が不正です` 守卫并**硬报错**（实测症状：存档界面点一个槽 → 确认"要读取吗" → 报错）。
 * 脚本作者自己也清楚这一点：**存档**路径（`SAVE.txt:1153 mov (local-int e) 4`）会显式让主循环
 * **重新登记**回调，而**读档**路径（`label_000039cc` → `ret`）没有 —— 它依赖的就是这里的控制转移。
 *
 * emulator 的边界（见 `SLOT_GAPS`）：本工程**不解析存档里记录的那个脚本名**（真槽的状态主体布局未分析）
 * ⇒ 退回"重载根脚本 0、由启动链接管"（与 `exit-script` 同口径）。可续档的本工程格式（带状态块）
 * 不走这里 —— 那条路能直接按 `scriptId/ip` 续上，见 `loadSlotIntoEngine`。
 */
async function transferToRootAfterLoad(e: Engine): Promise<void> {
  // 面板 + 文本/窗口复位（raw 19466-19468）。panelB（`Engine+21976`）在 emulator 未建模。
  // ★注：`sub_4B5090` 在台账里是「设备重建后重装 SE」（`se_reload_all_4B5090`）⇒ 下面这两行**不是**它的等价物，
  //   而是"把屏上那份文本/窗口状态清掉"的**观测等价物**（引擎另用镜像里那 40 B 窗口态 + 面板复位做到同一件事，
  //   见 `docs-new/03-engine/save-data.md` §7.3）。
  e.routes.reset(); // = sub_403EF0(panelA)：面板命中区/路由表复位
  e.msgwin.reset(); // 文本窗口对象复位（清屏上残留的文本）
  e.native.msgWinClearAll?.(); // 宿主侧文本图层同清（与 exit-script 同口径）
  // 「正在读档」门：`0xAE`（存档版本分支）读的就是它。语料里 `0xAE` 出现 0 次 ⇒ 这里只如实置位。
  e.engineValues.set(LOAD_IN_PROGRESS_FLAG, 1);
  e.cur = 0; // ★引擎 `Engine[383104] = 0`
  // 引擎在这里装载**存档记录的脚本**；本工程解析不了那一块 ⇒ 重载根脚本、让启动链重新接管。
  const boot = await e.fileSource?.readScript?.(0);
  if (!boot) {
    // 根脚本都读不到：保持 `cur = 0`（帧 0 原样），不假装装载成功。
    e.native.log('[slot-load] 读档后读不到根脚本 0 ⇒ 只切回帧 0（缺口见 SLOT_GAPS）');
    return;
  }
  loadScriptIntoFrame(e.frames[0]!, parseScriptBytes(boot.data), boot.name, 0);
  e.native.log('[slot-load] 控制转移：cur=0 + 重载根脚本（引擎此处装载存档记录的脚本；见 SLOT_GAPS）');
}

/** 「正在读档」门：`Engine+383120`（元素 95780）。`0xAE`（`handlers/frame.ts`）读它。 */
export const LOAD_IN_PROGRESS_FLAG = ENGINE_FIELD.loadInProgress;

/**
 * **读档时要装回的「画面」**（`tickets/T-0063` 的 `present` + 纹理槽记录）。
 *
 * ★为什么要单独成对象（`tickets/T-0069` 的第二次变更）：读档后的续跑是"帧 0 从入口重跑 → 入口 `i0ae` 落 ip"
 * —— 这一路上**场景入口的初始化会重跑**（`create-mesh` 重建遮罩、`set-vertex-color-alpha` 重新拉一遍淡入）。
 * 画面快照本来已经把"存档当时的成片"装好了，于是玩家看到的是：
 * **先出现带遮罩的背景（快照）→ 又重新播一遍"刚进场景"的无遮罩 → 遮罩淡入**。
 * 引擎那边不会这样：它的后备缓冲**从不清**，旧像素一直在，重跑的那些一次性绘制被旧像素盖着。
 * ⇒ emulator 的等价物是**在走栈期间把这份快照反复装回**（`Engine.loadHold`，由 `0xAE` 每个走栈步执行），
 * 收尾那一刻才松手（此后脚本自己的绘制照常可见）。
 */
export interface SlotPresentation {
  /** 呈现态快照（`SlotStateBlock.present`）。 */
  present?: unknown;
  /** 纹理槽记录（`SlotStateBlock.texSlots`）。 */
  texSlots?: [number, number][];
}

/** 把一份画面装回宿主（读档装载点与走栈期间**共用同一份实现**，避免两处漂移）。 */
export function applySlotPresentation(e: Engine, hold: SlotPresentation): void {
  if (hold.texSlots) {
    e.texSlots = new Map(hold.texSlots);
    for (const [slot, imgid] of hold.texSlots) if (imgid >= 0) e.native.bindTexture?.(imgid, slot);
  }
  if (hold.present) e.native.restorePresent?.(hold.present);
}

/**
 * **读档后把 BGM 放回去**（引擎 `CALLBACK_LOAD.BIN:20` 的 `i0b7 0` 的等价物，`tickets/T-0064`）。
 *
 * 引擎的链条（证据：raw 17469-17471 / 19911 / 106352-106372、`src/CALLBACK_LOAD.txt:20`）：
 * ```
 * 存档：镜像[2] = Music[259]（当前曲 id）        读档：Engine[174713] = 镜像[2]（raw 19911）
 *      帧 0 ← CALLBACK_LOAD.BIN ⇒ `i0b7 0` ⇒ sub_489F80(Music, 0, 1) ⇒ 曲 id 非 0 ⇒ 重新起播（循环）
 * ```
 * ★为什么非有不可：读档落点是"存档当时那句话"（`0xAE` 用 `0x71` 表下标），而场景的 `play-bgm` 在
 * **进消息循环之前**（实测 `SN0000.BIN`：`i0ae` = 指令 737、`play-bgm d` = 752、落点 = 794）⇒ 续跑那一遍
 * 会跳过它；同时 `SAVE.txt:934 i0b8`（玩家确认读档时）已经 `sub_489B50` 停掉并清掉了当前曲 id
 * ⇒ **不补这一跳，读档后整场没有 BGM**（2026-09 用户实测，直到下一处 BGM 变更）。
 *
 * emulator 此前整跳 `CALLBACK_LOAD` 都不做（`SLOT_GAPS ⑥`）⇒ 这里只补它对本工程有观测意义的那一步。
 * 曲 id 取自 `engineValues[musicField]`：真槽由 `restoreEngineSlot` 从镜像 `[2]` 装回，
 * 本工程槽由状态块的 `adv.fields` 装回 —— 两条路都在恢复之后调用本函数。
 */
function replaySavedBgm(e: Engine): void {
  const id = e.engineValues.get(ENGINE_FIELD.musicField) ?? 0;
  if (id <= 0) return; // 引擎：`Music[259] == 0` ⇒ `sub_489B50`（本就没在播，不必发意图）
  e.native.audio?.(bgmReplayIntent(e, id));
  e.native.log(`[slot-load] BGM 还原：重播存档里的当前曲 #${id}（引擎 CALLBACK_LOAD.BIN:20 的 i0b7 0）`);
}

/** `loadSlotIntoEngine` 的结果：状态码 + 是否发生了控制转移（`transferredTo = null` = 没有转移）。 */
export interface SlotLoadOutcome {
  /** 0 成功 / 1 打不开 / 2 解析失败（与引擎 `sub_410160` 的返回同尺度）。 */
  code: number;
  /** 转移后应当落到的 ip（引擎 `cur = 0` ⇒ 根脚本的 ip）；`null` = 不转移，调用方继续跑。 */
  transferredTo: number | null;
}

/**
 * **真游戏槽（引擎格式 3）的续跑装载**（`tickets/T-0059`）—— 逐条对齐 `sub_410160` 的 a4=3 段。
 *
 * 引擎那份 `sub_410160` 做的事（raw 19703-19927）与本函数的对应关系：
 *
 * | 引擎 | 这里 |
 * |---|---|
 * | `memcpy(Engine+604840, Src, 1044*n+22296)`（帧镜像） | `decodeEngineSlot` 解析出帧记录（不建镜像） |
 * | 池块 → `Engine+382976/382984/382992`（int/float/string 池） | `e.globals.int/float/str`（**文件里就是明文**） |
 * | 100 个解码图槽 + 1000 条 20 B 记录（`sub_4559C0` 按 id 重载图像） | 记「已使用文件」（`markFileUsed`）；**图像本身不重载**（见 `SLOT_GAPS`） |
 * | `Engine[698852] = 镜像[2]` | `engineValues.musicField`（`_this[174713]`） |
 * | 面板/文本复位（`sub_4B5090`/`sub_403EF0`×2） | `routes.reset()`/`msgwin.reset()`（与 `transferToRootAfterLoad` 同口径） |
 * | `Engine[383120] = 1`（读档门）、`Engine[383104] = 0`（cur） | `loadInProgress = 1`、`e.cur = 0` |
 * | 帧 0 ← `CALLBACK_LOAD.BIN`；它 `exit` 时 `frames[0][95795] == -11` ⇒ `sub_40F750(3)` 再装 **记录 0 的脚本** | 直接装记录 0 的脚本（**省掉回调那一跳**，见 `SLOT_GAPS` 的偏离说明） |
 * | 各帧脚本/ip/返回栈由脚本侧 `0xAE` 走栈恢复 | `e.saveResume` + `handlers/frame.ts` 的 `0xAE`（忠实实现） |
 *
 * 返回 `true` = 续跑已就绪（调用方只需把控制交给帧 0 的入口）。
 */
async function restoreEngineSlot(
  e: Engine,
  bytes: Uint8Array,
  sv1: number,
  sv2: number,
  callerFrame: number,
): Promise<boolean> {
  const dec = decodeEngineSlot(bytes);
  if (!dec.ok) {
    e.native.log(`[slot-load] 真槽状态主体未解析（${dec.reason}）⇒ 退回"重载根脚本"（见 SLOT_GAPS）`);
    return false;
  }
  const p: EngineSlotPayload = dec.payload;
  const frame0 = p.frames[0];
  const fs = e.fileSource;
  if (!frame0 || !fs?.readScript) return false;
  const boot = await fs.readScript(frame0.scriptId);
  if (!boot) {
    e.native.log(`[slot-load] 记录 0 的脚本 0x${frame0.scriptId.toString(16)} 读不到 ⇒ 退回"重载根脚本"`);
    return false;
  }
  const script = parseScriptBytes(boot.data);

  // ① 三个池（**文件里是明文**：引擎的 ENC/DEC 只发生在内存侧，见 `analysis/fields.json` 的 DEC/ENC 口径）。
  //    ★int 池必须 **ENC** 后再进 `Engine.globals.int` —— 引擎在 `0x1A1` 里读完池后正是**整体 ENC 一遍**
  //    （raw 38433-38438：`pool[i] = ENC(key, pool[i])`，`key = _this[97059]`），而操作数读取侧一律
  //    `DEC(key, ...)`（`operand.ts` 的 `readIntOperand`）⇒ 存明文会让续跑后的**所有全局量读成垃圾**。
  //    float/string 池没有这层（引擎直接读 `*(float*)(pool+4*i)` / 字符串指针）。
  //    int 池是**定长稀疏数组**（本机 81 个真槽全是 1,015,792 项 = 4 MB）⇒ 只装非零项（读侧缺省即 0）。
  //    ★★**只覆盖池内下标，不得清掉池外下标**（`tickets/T-0071`）：引擎的还原是
  //    `memset(pool, 0, 4*count + 4)` + `memcpy(pool, fileInts, 4*count)`（raw 19705/19747）——
  //    它只动 `0..count` 这一段，**`count` 以上的下标原样保留进程里的旧值**。
  //    这不是细节：ADV 场景大量使用**池外**的引擎全局（实测 `SN0000`/`NOVEL` 用 `global 708ada`
  //    = 7,375,578、`global f8c48` = 1,018,952，而池长只有 1,015,792）—— 读档时它们必须是"当时那份
  //    进程状态"，用 `clear()` 全清会让续跑读到 0（背景/网格参数全丢）。
  const poolCount = p.ints.length;
  for (const k of [...e.globals.int.keys()]) if (k <= poolCount) e.globals.int.delete(k);
  for (let i = 0; i < poolCount; i++) {
    const v = p.ints[i]!;
    if (v !== 0) e.globals.int.set(i, enc(e.key, v));
  }
  e.globals.float.clear();
  for (let i = 0; i < p.floats.length; i++) if (p.floats[i] !== 0) e.globals.float.set(i, p.floats[i]!);
  e.globals.str.clear();
  for (let i = 0; i < p.strings.length; i++) if (p.strings[i] !== '') e.globals.str.set(i, p.strings[i]!);

  // ② 这一批图像/记录是存档当时"按统一 id 打开过"的文件 ⇒ 引擎的 FileDB「已使用」表里会有它们
  //    （`0x19D` 的鉴赏/解锁判据读的就是那张表）。槽本身不存标志表（那份在 `SAVE.DAT`）⇒ 这里只补记。
  for (const s of p.images) if (s.id >= 0) e.markFileUsed(s.id);
  for (const r of p.records) if (r.id >= 0) e.markFileUsed(r.id);

  // ②b ★**把「槽 → 图像」登记装回去，并重新解码引擎标了"要重载"的那些**（`tickets/T-0071`）。
  //     引擎 `sub_410160`（raw 19843-19910）在装载末尾干的就是这件事，两段：
  //       ① 100 个**纹理槽**（镜像 +52，12 B/条 {id, flag@+4, param}）：
  //          循环 0..99，`flag == 1 && id >= 0` 时 `sub_40BF20(Engine+7912, 槽, id, 数据, 名)`
  //          —— 把该 AGF 重新解码进纹理槽。★实证：本机 81 个真槽该表**全零**（flag 从不置 1），
  //          所以这一段在本作里等价于空操作；仍然照实现（非空时如实重绑 + 记日志）。
  //       ② 1000 个**图像槽**（镜像 +1252，20 B/条 {id, param, flag@+8, ?, ?}）：
  //          循环 0..999，`flag == 1 && id >= 0` 时
  //          `sub_4559C0`（解析 id）→ `sub_455560`（取字节）→ `sub_4A3800(Engine+322832, id, 数据, 槽, param, 0)`
  //          —— 该条同时把 id/param 写回槽表（`[5*slot+466/467]`），也就是 `0x1F9`（`set-texture`）写的那张表。
  //     ★为什么非做不可：读档续跑落点**跳过了场景的 init**（`i0ae` 落在主循环里），而 init 里那些
  //       `set-texture <背景大图> <槽>` 就再也不会执行 ⇒ 不装回去的话，续跑路上任何
  //       `draw-texture … <槽> …` 都指向空槽（实测槽 79 = `BG050ABL.AGF`(2871) 该在槽 4 上，
  //       而修复前 `texSlots` 里根本没有 4）。
  const rebind: { slot: number; id: number }[] = [];
  for (let slot = 0; slot < p.records.length; slot++) {
    const r = p.records[slot]!;
    if (r.id >= 0) e.texSlots.set(slot, r.id); // 槽登记（= 引擎的 `[5*slot+466]`）
    if (r.flag === 1 && r.id >= 0) rebind.push({ slot, id: r.id });
  }
  const texRebind: { slot: number; id: number }[] = [];
  for (let slot = 0; slot < p.images.length; slot++) {
    const s = p.images[slot]!;
    if (s.flag === 1 && s.id >= 0) texRebind.push({ slot, id: s.id });
  }
  // ②c ★**装载点不整批清绘制项** —— ★★2026-09 以体订正：(B) 步的**前提被推翻**，真机制是"清 + 还原"。
  //
  //     `sub_410160` raw 19806-19832 在图像清单之后**行内**干了这件事（此前整段被漏读）：
  //       ① `v64 = *(a1+323868)+4` 起 delete-walk（`sub_40BB60` 释放 + `operator delete`）⇒ 清空
  //          `Engine+323864` = **`Scene+1032`** = 那张 740 B 绘制项 map；
  //          随后复位哨兵（`head->next = head`/`head->prev = head`/`head->last = head`）+ `size(Engine+323872) = 0`；
  //       ② 对 body 里那份清单逐条：`handle = *(u32*)p` → `sub_49A300(Scene, scratch)`（740 B 默认构造）
  //          → `memcpy(scratch, p, 740)` → `sub_40C910`（find-or-create）+ `sub_40C310`（赋值）
  //       ⇒ **上一屏的绘制项一个不留，画面 = 存档当时的场景**。清单的步长是 `4 + 4*740 = 2964` B/条
  //       （引擎 `v97 = &v67[4 * hFile]`，`hFile` = 740 = 记录**字节数**）—— 真槽 79 实证 69 条，
  //       第 1 条就是 SN0000 的背景：handle `0x18A88`、slot 4、src (0,0,2048,1152)、dst (−768,−272)。
  //
  //     所以"装载点不清绘制项"是**错的**：清的是**绘制项 map**（`Scene+1032`），
  //     而 raw 19913-19915 的两次 `sub_403EF0` 复位的是**两个 仮想ディスプレイ**（`Engine+0x55D8`/`0xCAC0`）
  //     —— 那两份对象的体（raw 9958-9971）是**点击热点/路由表 + 鼠标游标**（`[258]` = 热点条目数），
  //     **与绘制项无关**（第一层早已有条目）。旧注释把这两件事混成一条，才推出"靠保留上一屏的项还原画面"。
  //
  //     ★真槽 79 的错乱就是这么来的：清单没被消费（只读了 handle、步长还算错），上一屏（TITLE）的项留在
  //     `scene.drawItems` 里，而 ②b 按存档把槽 4 重绑到 `BG050ABL`(2048×1152) ⇒ TITLE 那些项（全用槽 4）
  //     按**标题屏的源矩形**采这张背景 = 「天空碎片阶梯」（handle 0x12C/0x12E/0x130/0x132/0x134，
  //     156×156，dst (1102,294)/(992,402)/(869,485)/(729,543)/(1107,554)）+ 采样越界（`0x64` 的
  //     src y=1161 > 图像高 1152）那块灰板。用户实测「背景渲染完全混乱、很多图元缩放错误」。
  //
  //     ★**只清绘制项、不动网格**：引擎的清场只走 `Scene+1032` 那棵树，`Scene+1064` 的网格容器
  //     一个结点都不动 ⇒ 这里**不**调 `native.clearDrawContainer`（emulator 那个缝把网格一起清，
  //     与体不符），而走新缝 `native.restoreDrawItems`（先清后装，只碰绘制项）。
  //
  //     ★**fallback 仍在**：本工程槽（`format = 0`）与旧布局（`sv1 = 1/2`）的 body 里没有这份清单，
  //     清单也可能解析失败（`drawItems === null`）⇒ 那时退回 (B) 步的 `ownerFrame` 近似
  //     （只丢**被放弃的那条调用链**画的项；`Item.ownerFrame` = emulator 记账，引擎没有这一格）。
  //     宁可留着上一屏，也不要因为一条读不出来的清单把画面清空。
  if (p.drawItems) {
    const restored = p.drawItems.map((d) => decodeEngineDrawItem(d.handle, d.record));
    const installed = e.native.restoreDrawItems?.(restored) ?? 0;
    const shown = restored.slice(0, 8).map((it) => `0x${it.handle.toString(16)}`);
    e.native.log(
      `[slot-load] 按存档还原绘制项 ${installed}/${restored.length} 项（引擎 sub_410160 raw 19810-19832：清 Scene+1032 后逐条插回；` +
        `handle ${shown.join(',')}${restored.length > shown.length ? ',…' : ''}）⇒ 上一屏的项全部作废`,
    );
  } else {
    // (B) 丢哪一层 = **被放弃的那条调用链**：caller 帧 + 它调用出来的帧（`caller` 链里含 caller 的帧）。
    //     ★祖先帧**不碰**：读档前正在演的那场戏就是祖先（它的绘制项必须留下 —— (C) 守卫的 A/B 正是这条）。
    //     实证（2026-09，`npm run shot -- --load 79`，帧链 `0=SYSTEM4 1=TITLE 2=SAVE 3=SBUNKI 4=SBUNKIMOVE`）：
    //     只丢 caller（2）时，列表的文字/行框仍在 —— 它们是 3/4 那两个被 SAVE 调出来的帧画的。
    //     （旧实证：不丢这一层时读档后**存档列表整屏留在画面上**，handle 0x1d4c0.. ≈ 131 项，正是
    //     SAVE.txt 自己声明的 UI 区间 `detach-texture 1d4c0 bb8`；而 CALLBACK_LOAD 的
    //     `detach-texture 1adb0 7d0`（`src/CALLBACK_LOAD.txt:16`）落在 [0x1adb0, 0x1b580) —— 那是
    //     **立绘层**，删不掉列表，日志实测 `drawItems=0`。）
    const droppedFrames = new Set<number>([callerFrame]);
    for (let i = 0; i < e.frames.length; i++) {
      let up = e.frames[i]?.caller ?? -1;
      for (let guard = 0; up >= 0 && guard < 64; guard++) {
        if (up === callerFrame) {
          droppedFrames.add(i);
          break;
        }
        up = e.frames[up]?.caller ?? -1;
      }
    }
    let droppedUi = 0;
    for (const f of [...droppedFrames].sort((a, b) => a - b)) droppedUi += e.native.dropFrameItems?.(f) ?? 0;
    if (droppedUi > 0) {
      e.native.log(
        `[slot-load] 存档 body 没有可解析的绘制项清单 ⇒ 退回 (B) 近似：丢掉被放弃的调用链（帧 ${[...droppedFrames].sort((a, b) => a - b).join(',')}）画的 UI 绘制项 ${droppedUi} 个（见 tickets/T-0083）`,
      );
    }
  }
  // ★**L2D 运行态必须一起清**（`tickets/T-0090`）：存档的 body 布局里没有任何 L2D 字段
  //   （`vm/engineSlot.ts` 的帧镜像/三个池/三张 ip 表/图像清单都没有模型或立绘节点表）
  //   ⇒ 装载后进程里的 L2D 状态**必然属于上一个执行链**。
  //   ★**引擎依据（2026-09-24 按体订正，`tickets/T-0144` ⑥）**：清 572B 节点表 + 10 个实例槽的是
  //     读档装载内核 **`sub_410160` raw 19385-19388**（`sub_40BFE0(Scene+1064)` +
  //     `sub_4A9D10(Scene+1096)` + `for j<10 sub_4A1A60(Scene, j)`）。
  //     旧注释引的 raw 19913-19915 两次 `sub_403EF0` **不是**这条依据 —— 那两次复位的是两张
  //     「仮想ディスプレイ」（点击热点/路由表 + 游标），`src/vm/native.ts:527-529` 早已按体订正过。
  //   ★实测（槽 79）：不清的话读档后仍挂着 **TITLE 的 node 0x14 + 模型 + 60 批**
  //   （`TITLE.txt:590` 的 `i344 14 0`），而 SN0000 一条 L2D 指令都没有 ⇒ 上一个画面的立绘/天空件
  //   继续画在 SN0000 上（用户实测「背景渲染完全混乱、很多图元缩放错误」）。
  //   ★这条对"存档时场景本来就有立绘"的槽意味着立绘也会没 —— 但引擎同样救不回来（L2D 不在存档里），
  //   属 `SLOT_GAPS` 的既有缺口，不是本条引入的。
  //   ★★注意与 `0x1F6`/`0x1F7` 的分工（`tickets/T-0144` 的 D1）：**拆场**只擦 572B 节点表、
  //     **不动实例槽**（引擎 `sub_4AB7A0` 的两张 map）；"连实例槽一起清"只发生在**读档装载点**
  //     （本函数这一刀）与脚本的 `0x342`。
  const l2dCleared = l2dResetHost(e);
  if (l2dCleared.slots > 0 || l2dCleared.nodes > 0) {
    e.native.log(
      `[slot-load] 清掉上一个执行链的 L2D 运行态：实例槽 ${l2dCleared.slots} 个 / 立绘节点 ${l2dCleared.nodes} 个（L2D 不在存档 body 里；见 tickets/T-0090）`,
    );
  }
  // ★诊断（读档画面残留定位用）：装载时进程里的帧链（残留属于哪一层要对着名字看）。
  e.native.log(
    `[slot-load] 装载时的帧链：${e.frames
      .map((f, i) => (f.script ? `${i}=${f.name}(caller=${f.caller})` : null))
      .filter((s): s is string => s !== null)
      .join(' ')}`,
  );
  // ★(A) 步（`tickets/T-0083`）：装载点**释放留帧** —— 引擎装载路径复位显示态（`sub_403EF0` raw 19913-19915），
  //   没有"保留旧像素"的概念（渲染目标每帧清后从模型重组）⇒ 读档瞬间屏上应是**当前模型**（= 上面保留下来的
  //   绘制项 + 重建后的槽），不能让上一屏（TITLE/菜单）的旧像素继续压在画面上。
  //   实测（2026-09 用户日志）：没有这一步时 `clearDrawContainer` 会把留帧重新拉到 60 帧，
  //   于是"旧像素一直压着"+ 期间又建了满屏幕布 ⇒ 玩家看到的就是「TITLE 背景 + ADV 遮罩」。
  e.native.releaseFrameHold?.();
  for (const { slot, id } of [...rebind, ...texRebind]) e.native.bindTexture?.(id, slot);
  if (rebind.length || texRebind.length) {
    e.native.log(
      `[slot-load] 重建存档里的图像槽 ${rebind.length} 个 + 纹理槽 ${texRebind.length} 个：` +
        `${[...rebind, ...texRebind].map((r) => `槽${r.slot}←0x${r.id.toString(16)}`).join(' ')}`,
    );
  }

  // ③ 面板 / 文本复位（引擎 raw 19913-19915；与 `transferToRootAfterLoad` 同一口径）。
  //   ★绘制项**已经在 ②c 处理完了**（有清单 ⇒ 按存档整批替换；没有 ⇒ 退回 (B) 近似），
  //     这里不再碰绘制项（`tickets/T-0063`/`T-0083`）。
  //   ★续跑重跑到哪里（实测）：每帧从**入口**跑到它自己的 `i0ae` —— SN0000 的 `i0ae` 是指令 737、
  //     存档落点是指令 794 ⇒ 入口到 737 之间的那段 init **会重跑**（`i259`、`play-bgm` 之类），
  //     但 **738..793 被跳过**。★订正（以体为准）：那一带正是它**场景起始的背景设置** ——
  //     指令 756/757/758 = `mov (global-int f801d) 0` / `mov (global-int f8006) b37` /
  //     `call label_0000e24c`（背景画在 handle `f8023[f801d]`，`INIT2.txt:6-17` 给的是
  //     `0x18A88…0x19258`，远高于 TITLE 的 0x135）⇒ **靠"init 重跑"根本没有把背景画出来**：
  //     引擎是拿存档 body 里那份**绘制项清单**把画面补回来的（②c），`play-bgm` 那类副作用另有补丁
  //     （见 `handlers/audio.ts`）。主循环之后的绘制不会重放。
  e.routes.reset();
  e.msgwin.reset();
  e.native.msgWinClearAll?.();

  // ④ 帧 0 的装载 —— 引擎的**两条路**（raw 19916-19927，`tickets/T-0072`）：
  //    引擎先把帧 0 交给 **`CALLBACK_LOAD.BIN`**（返回帧 = **-11** 哨兵）；它 `exit` 时 `sub_41A820`
  //    见到 -11 ⇒ `_this[95777] = -1` 后 `sub_40F750(sv1, sv2)` 才把**记录 0 的脚本**装进帧 0。
  //    那一跳是"上一个画面的收尾"：`i19b`（ADV 退出）、`i20d -1`（渲染目标回后台缓冲）、
  //    `detach-texture 1adb0 7d0`（= 释放 [0x1adb0, 0x1adb0+0x7d0) 这 2000 个句柄）、`i324`、`i2fa 0`、`i2f6 0..2`、`i0b6 0..9`、
  //    `i0b7 0`（BGM 重播）、3f51..3f53 的跳过记账（`src/CALLBACK_LOAD.txt` 逐条）。
  //    能按名解析到它 ⇒ 照引擎走；解析不到（宿主没给按名读的通道）⇒ 退回"直接装记录 0"（`SLOT_GAPS ⑥`）。
  const frame = e.frames[0]!;
  let pendingRecord0 = false;
  const callback = await e.fileSource?.readScriptByName?.('CALLBACK_LOAD.BIN');
  if (callback) {
    loadScriptIntoFrame(frame, parseScriptBytes(callback.data), callback.name, callback.index);
    frame.retStack = [];
    frame.caller = -11; // ★引擎哨兵：-11 = "装载回调跑完 ⇒ 装记录 0 的脚本"（sub_41A820 raw 25649-25658）
    pendingRecord0 = true;
    e.native.log(
      `[slot-load] 真槽装载：帧 0 ← ${callback.name}（引擎 sub_410160 raw 19916 的 CALLBACK_LOAD 那一跳；` +
        `它 exit 后再装记录 0 = ${boot.name}），savedCur=${p.savedCur}、帧记录 ${p.frames.length} 条`,
    );
  } else {
    loadScriptIntoFrame(frame, script, boot.name, frame0.scriptId);
    const ret = resolveSlotRetStack(script, frame0);
    frame.retStack = ret.retStack;
    frame.caller = frame0.returnFrame;
    e.native.log('[slot-load] 按名读不到 CALLBACK_LOAD.BIN ⇒ 直接装记录 0 的脚本（引擎那一跳未复现，见 T-0072）');
    e.native.log(
      `[slot-load] 真槽续跑就绪：帧 0 = ${boot.name}(id=0x${frame0.scriptId.toString(16)})、savedCur=${p.savedCur}、` +
        `池 int=${p.ints.length}/float=${p.floats.length}/str=${p.strings.length}、帧记录 ${p.frames.length} 条` +
        `${ret.dropped ? `（返回栈丢 ${ret.dropped} 项）` : ''}`,
    );
  }
  e.cur = 0;

  // ⑤ 读档门 + 续跑记录（`0xAE` 消费）。
  e.engineValues.set(ENGINE_FIELD.musicField, p.pre8); // 引擎 `Engine[698852] = 镜像[2]`
  e.engineValues.set(LOAD_IN_PROGRESS_FLAG, 1);
  // ★`sv1/sv2` = **这份槽自己声明的存档版本**（容器头 +284/+288）：`0xAE` 按它选帧记录的槽位组，
  //   而玩家 INI 可能整个缺 `[set]` 段（`tickets/T-0065`）⇒ 以文件为准（引擎那份是启动时从 SAVE.DAT 头读进
  //   字段 21968/21972 再供 `GetConfig` 用的，同源）。
  e.saveResume = { savedCur: p.savedCur, savedRet: p.savedRet, frames: p.frames, sv1, sv2, pendingRecord0 };
  // ⑥ 引擎在这一步之后还会把帧 0 交给 `CALLBACK_LOAD.BIN`，它开头就 `i0b7 0`（重播刚装回的当前曲）
  //    —— 见 `replaySavedBgm`。本工程直接装记录 0 的脚本，所以要显式补这一下。
  replaySavedBgm(e);
  return true;
}

/** 从槽文件里恢复状态（`0x1A1` / `0x19F`）。返回状态码 + 是否控制转移（见 `transferToRootAfterLoad`）。 */
export async function loadSlotIntoEngine(
  e: Engine,
  slot: number,
  opts: { full?: boolean } = {},
): Promise<SlotLoadOutcome> {
  const full = opts.full ?? true; // `0x1A1`/`0x190` 是 a6=1（全量）；`0x19F` 是 a6=0（不转移）
  const fs = e.fileSource;
  if (!fs?.readSaveSlot) return { code: 1, transferredTo: null };
  const bytes = await fs.readSaveSlot(slot);
  if (!bytes) return { code: 1, transferredTo: null };
  const parsed = parseSlotFile(bytes);
  if (!parsed.ok) return { code: 2, transferredTo: null };
  const { tables, usage, state, engineFormat } = parsed.data;

  // ① 两张表（`load-int`/`load-string` 的数据源）与「已使用文件」标志 —— 引擎 `sub_410160` 的还原内容之一。
  //   ★**只有真读出来才写**：引擎格式（真游戏）槽的这两块未解析（`SLOT_GAPS`）⇒ `tables`/`usedFileIds`
  //   都是空的；拿空数据覆盖会把当前的 SAVE.DAT 表（含 `global 5`「已初始化」标志）与「已使用文件」标志
  //   （回想/CG/BGM 解锁的依据）**洗掉**。修前就是这样（读一次真槽 ⇒ 已初始化标志归零 ⇒ 下次启动重走
  //   INITCONFIG、鉴赏列表全空）。
  if (!engineFormat) {
    e.applySaveDataTables(tables);
    e.setUsedFileIds(usage.usedFileIds);
  }

  // ② 引擎格式（真游戏槽，`format >= 1`）：解**状态主体**（帧记录 + 三个池）→ 交 `0xAE` 走栈续跑。
  //    ★这是 `tickets/T-0059` 的落地：能解出来就**真的续到存档当时的脚本与消息**（不再退回根脚本）。
  //    解不出来（旧布局 1/2、坏档、脚本资源缺失）⇒ 如实退回"重载根脚本"，见 ④。
  if (engineFormat) {
    e.playSeconds = parsed.data.header.playSeconds; // 头 +280（引擎装载时也会带上）
    // ★把**文件自己声明的存档版本**交给续跑（头 +284 = `set:SaveVersion1`、+288 = `set:SaveVersion2`）：
    //   `0xAE` 按它选帧记录的槽位组；玩家 INI 缺 `[set]` 段时这是唯一可靠的来源（`tickets/T-0065`）。
    // ★`callerFrame` = **执行这条读档指令的那一帧**（= 将要被放弃的调用方，通常是 SAVE/LOAD 菜单帧）：
    //   装载点用它丢掉"调用方那一层 UI"（见 `restoreEngineSlot` 的 ②c）。
    const callerFrame = e.cur;
    if (await restoreEngineSlot(e, bytes, parsed.data.header.format, parsed.data.header.aux, callerFrame)) {
      // 帧 0 = 记录 0 的脚本，从**它的入口**继续跑（引擎 `sub_40F750(3)` 装载后的位置就是入口）；
      // 入口那条 `i0ae` 会把 ip 落到存档位置并逐帧走栈。
      return { code: 0, transferredTo: 0 };
    }
    if (full) {
      await transferToRootAfterLoad(e);
      return { code: 0, transferredTo: e.curScript().ip };
    }
    return { code: 0, transferredTo: null };
  }

  // ③ 本工程状态块（**只有我们自己写的槽才有**：真游戏槽、以及早期没写尾块的槽都是 null，见 `SLOT_GAPS`）。
  if (state) {
    e.key = state.key >>> 0;
    e.globals.int = new Map(state.globals.int);
    e.globals.float = new Map(state.globals.float);
    e.globals.str = new Map(state.globals.str);
    // 面板 / 文本复位（引擎 `sub_410160` 装载段：`sub_403EF0`×2 面板复位 + 镜像里那 40 B 窗口态）。
    e.routes.reset();
    e.msgwin.reset();
    e.native.msgWinClearAll?.();
    const legacy = state.frames.some((f) => f.index === undefined || f.caller === undefined);
    if (legacy) {
      e.native.log(
        '[slot-load] 这个槽是修 T-0061 之前写的（没有帧号/返回帧链）⇒ 只能按数组序归位、返回帧按当前实例；' +
          '若续档落点不对（例如停在存档菜单上），请用新版本**重新存一次**',
      );
    }
    // ★**与引擎同一条续跑路**（`tickets/T-0063`）：每个存档帧都按 scriptId **装到入口（ip = 0）**，
    //   然后把"该帧要落的指令"放进 `saveResume`，由脚本入口那条 `i0ae`（`0xAE`）自己落 ip、逐帧走栈，
    //   走到 `savedCur` 收尾 —— 而不是直接把 `cur`/`ip` 摆到存档位置。
    //   为什么必须这样：引擎的 `0xAE`（`sub_4192F0` raw 24634-24770）就是这条链式走栈
    //   （`cur != savedCur` ⇒ `sub_40F750(3)` 装记录[cur+1] 的脚本；`cur == savedCur` ⇒ 收尾写 `95777`）。
    //   ★订正（以体为准，`tickets/T-0083`）：**"场景脚本从入口重跑会把背景重画"是错的** ——
    //   SN0000 的 `i0ae` = 指令 737、落点 = 794 ⇒ 738..793 被跳过，而那一带正是它的场景起始背景设置
    //   （指令 756/757/758）。引擎读档后的画面来自存档 body 里的**绘制项清单**（引擎真槽：②c 的
    //   `restoreDrawItems`）；本工程槽没有那份清单 ⇒ 靠 `applySlotPresentation`/`loadHold` 把
    //   存档当时的呈现态装回来（`scene/present.ts`），`i259` 只负责落掉上一场的**槽记录**。
    //   直接落 ip 会跳过 init ⇒ 界面残留 + 背景不重画（2026-09 用户实测：存档界面压在 ADV 上）。
    const resumeFrames: import('../engineSlot.js').EngineSlotFrame[] = [];
    let seq = 0;
    let loadedAny = false;
    for (const f of state.frames) {
      const i = f.index ?? seq++;
      const frame = e.frames[i];
      if (!frame) continue;
      if (f.scriptId >= 0) {
        const sb = await fs.readScript?.(f.scriptId);
        if (sb) {
          loadScriptIntoFrame(frame, parseScriptBytes(sb.data), sb.name || f.name, f.scriptId);
          loadedAny = true;
        } else {
          e.native.log(`[slot-load] 帧 ${i} 的脚本 0x${f.scriptId.toString(16)} 读不到 ⇒ 续跑会跳过这一帧`);
        }
      }
      frame.retStack = [...f.retStack];
      if (f.caller !== undefined) frame.caller = f.caller;
      // 落点 = 存档时那条指令本身（本工程槽存的是**指令下标**，不是引擎的表下标 ⇒ `instr` 直落）。
      // ★**末帧**（`i === state.cur`）优先落在"存档当时那句话"（`lastMsgIp`）⇒ 重放它，屏幕上立刻有文字
      //   （引擎同语义：帧记录里那一格就是 `0x71` 表下标）。更早的帧按原 ip 继续（它们停在调用点之后）。
      const landing = i === state.cur && (f.lastMsgIp ?? -1) >= 0 ? f.lastMsgIp! : f.ip;
      resumeFrames[i] = {
        returnFrame: f.caller ?? -1,
        scriptId: f.scriptId,
        retIdx: [],
        messageIdx: -1,
        callIdx: -1,
        instr: landing,
        retStack: [...f.retStack],
      };
    }
    // 数组下标 = 帧号（稀疏处留空；`0xAE` 走栈时跳过没有 `instr` 的格子）
    resumeFrames.length = Math.max(resumeFrames.length, state.cur + 1);
    e.playSeconds = state.playSeconds;
    // ★**把画面也装回去**（`tickets/T-0063`）：纹理槽记录 → `texSlots` + 宿主 `bindTexture`（按 id 取图），
    //   呈现态快照 → 宿主模型。**在续跑脚本继续跑之前**做：脚本若重画同一个 handle 会覆盖（模型以 handle 为键），
    //   所以"先还原、再让脚本继续"不会叠加。
    //   ★同时把它挂成 `e.loadHold`（`tickets/T-0069`）：走栈期间场景入口会重跑（重建遮罩 + 重播淡入），
    //   每个走栈步由 `0xAE` 把这份快照装回，收尾才松手 —— 否则玩家会看到"快照（带遮罩）→ 又播一遍无遮罩→淡入"。
    const hold: SlotPresentation = {
      ...(state.texSlots ? { texSlots: state.texSlots } : {}),
      ...(state.present ? { present: state.present } : {}),
    };
    applySlotPresentation(e, hold);
    e.loadHold = hold.present || hold.texSlots ? hold : null;
    // ★VM 侧状态（热点区/消息窗态/文本项/阶梯动画/引擎字段）—— 放在清空之后、续跑脚本继续之前：
    //   热点区装回去 ⇒ 侧边栏 hover 才有反应；窗口/阶梯动画装回去 ⇒ 遮罩与"会动的东西"才在。
    if (state.adv) restoreAdvState(e, state.adv);
    // ★BGM（`tickets/T-0064`）：`adv.fields` 里那一格（`_this[174713]` = 当前曲 id）刚装回来 ⇒ 重播它
    //   （引擎由 `CALLBACK_LOAD.BIN:20` 的 `i0b7 0` 做同一件事，见 `replaySavedBgm`）。
    replaySavedBgm(e);
    // `0x1AD`（`i1ad`）那格跟进到续档后的帧；续跑完成前先不设，收尾时再设（见 `0xAE`）。
    if (loadedAny && resumeFrames.length > 0) {
      e.cur = 0; // 引擎：`Engine[383104] = 0`，从**帧 0 的入口**开始跑（`sub_40F750(3)` 装载后的位置）
      e.saveResume = { savedCur: state.cur, savedRet: e.engineValues.get(ENGINE_FIELD.callRet) ?? 0, frames: resumeFrames };
      e.engineValues.set(LOAD_IN_PROGRESS_FLAG, 1);
      if (full) {
        e.native.log(
          `[slot-load] 本工程槽续跑就绪：帧 0 = ${e.frames[0]?.name}（从入口跑），savedCur=${state.cur}，` +
            `逐帧落点已入队（脚本入口的 i0ae 会走栈）`,
        );
        return { code: 0, transferredTo: 0 };
      }
      return { code: 0, transferredTo: null }; // `0x19F`（a6=0）：引擎此处不转移（语料 0 处）
    }
    // 一个帧都装不上（资源缺失）⇒ 退回"重载根脚本"（并如实记日志）
    e.native.log('[slot-load] 本工程槽的帧一个都没装上 ⇒ 退回"重载根脚本"（见 SLOT_GAPS）');
    if (full) {
      await transferToRootAfterLoad(e);
      return { code: 0, transferredTo: e.curScript().ip };
    }
    return { code: 0, transferredTo: null };
  }
  // ④ 本工程格式但**没有状态块**的槽（早期写的 / 只存了两张表）：状态主体缺失 ⇒ 续不上，只能靠头里的
  // **游玩秒数**（`+280`）接上：引擎装载时把 `+280` 存进容器 `[260]`、再把 `[259] = [260]`、`[258] = now`
  // （raw 45085 / 45099），下次存档算的是 `[1036] - [1032] + timeGetTime()/1000`（raw 44812）——
  // 不接的话读真槽再存档会让 +280 从 0 重新开始。
  e.playSeconds = parsed.data.header.playSeconds;
  // ★**续不上就必须控制转移**（见 `transferToRootAfterLoad`）：本工程格式没有状态块时同样续不上。
  //   不转移 ⇒ 调用方脚本继续跑 ⇒ `0xCD` 的脚本身份守卫会因"上一个子脚本留下的鼠标回调身份"硬报错。
  if (full) {
    await transferToRootAfterLoad(e);
    return { code: 0, transferredTo: e.curScript().ip };
  }
  return { code: 0, transferredTo: null }; // `0x19F`（a6=0）：引擎此处**不**转移（语料 0 处）
}

/** 把当前状态写进一个槽（`0x19E`）。返回引擎的结果码（0 成功 / 1 写不了 / 2 失败）。 */
export async function saveSlotFromEngine(e: Engine, slot: number): Promise<number> {
  const fs = e.fileSource;
  if (!fs?.writeSaveSlot) return 1;
  // ★**存档要退到哪一帧由脚本说了算**（`tickets/T-0061`）：引擎的写入内核 `sub_40CD10` 的
  //   case 3 是 `v10 = _this[166963]; if (v10 < 0) v10 = _this[95776];` —— 而 `_this[166963]`
  //   就是 `0x1AD`（`i1ad`，`sub_4196F0` raw 24806：`storedCur = cur`，语料 **1100 处 / 337 个脚本**）。
  //   每个 ADV 脚本都在进主循环前 `i1ad`（例 `src/$1$SC0330.txt:44-46`：`call 场景初始化` → `i1ad` → `jmp 主循环`）
  //   ⇒ 玩家从**存档菜单**里存盘时，`cur` 是菜单帧、而内存里那格仍是 ADV 帧 ⇒ **引擎存的是 ADV 帧**
  //   （= 玩家说的"自动退栈"）。emulator 修前存的是 `e.cur`（菜单帧）⇒ 读档会停在菜单上。
  const storedCur = e.engineValues.get(ENGINE_FIELD.storedCur) ?? -1;
  const resumeCur = storedCur >= 0 && storedCur < e.frames.length ? storedCur : e.cur;
  if (storedCur >= 0 && storedCur !== e.cur) {
    e.native.log(
      `[slot-save] 按 0x1AD 记录的帧退栈：cur=${e.cur} → 存 ${resumeCur}（引擎 sub_40CD10 的 _this[166963]）`,
    );
  }
  const frames: SlotFrameState[] = [];
  for (let i = 0; i <= resumeCur && i < e.frames.length; i++) {
    const f = e.frames[i]!;
    // ★**0..resumeCur 每一帧都写**（哪怕是空帧，`scriptId = -1`）：续跑是"从帧 0 的入口逐帧走栈"，
    //   缺一格就走不下去（引擎的帧镜像同理：记录 `0..savedCur` 连续铺）。
    frames.push({
      index: i,
      scriptId: f.script ? f.scriptId : -1,
      name: f.name,
      ip: f.ip,
      retStack: [...f.retStack],
      caller: f.caller, // ★返回帧链（引擎帧记录的 `[0]`）：不存的话续跑后 `exit` 会退回错帧
      lastMsgIp: f.lastMsgIp, // ★本帧最后一次 0x71（开始消息）的位置：末帧读档时用它重放那句话
    });
  }
  const state: SlotStateBlock = {
    key: e.key >>> 0,
    cur: resumeCur,
    frames,
    globals: {
      int: [...e.globals.int.entries()],
      float: [...e.globals.float.entries()],
      str: [...e.globals.str.entries()],
    },
    playSeconds: Math.floor(e.playSeconds),
    // ★纹理槽记录 + 场景呈现态快照（`tickets/T-0063`）：引擎的存档里也有这两样
    //   （1000×2 组 5 dword 的槽/绘制记录 ⇒ 读档按它重装图像并重放画面）；不存 ⇒ 读档后画面空白。
    texSlots: [...e.texSlots.entries()],
    present: e.native.snapshotPresent?.() ?? null,
    // ★VM 侧那批"读档不会自己回来"的状态（热点区/消息窗标量态/文本项账本/阶梯动画表/引擎字段）
    adv: snapshotAdvState(e),
  };
  const bytes = buildSlotFile({
    tables: e.saveDataTables(),
    usedFileIds: e.usedFileIds,
    state,
    now: new Date(),
  });
  try {
    await fs.writeSaveSlot(slot, bytes);
  } catch {
    return 2;
  }
  return 0;
}

/**
 * `0x1A0`（`sub_42DC70` raw 38365-38404）：**读槽头**（不装载状态）。
 * `op2` = 槽号 → `op1` = 0/1/2、`op3..op8` = 年/月/日/时/分/秒、`op9` = 游玩秒数。
 */
const op_slot_read_header: OpHandler = async (c) => {
  const e = c.e;
  // ★走操作数计划层（`tickets/T-0082`）：op2 是**读**（槽号）、op1 与 op3..op9 是**写**。
  //   读取顺序照引擎：**先读 op2** 再尝试打开文件（读是纯的，"读了几位"与"写了几位"是两件事）。
  const p = operandsFor(c);
  if (!p) throw new Error('0x1a0：读槽头走操作数计划层，但没有声明计划');
  const slot = p.int(2) ?? 0;
  const fs = e.fileSource;
  if (!fs?.readSaveSlot) {
    p.setInt(1, 1); // 打不开（宿主没有该能力 ⇒ 与"文件不存在"同码）
    return;
  }
  const bytes = await fs.readSaveSlot(slot);
  if (!bytes) {
    p.setInt(1, 1);
    return;
  }
  const head = parseSlotHeader(bytes);
  if (!head.ok) {
    p.setInt(1, 2);
    return;
  }
  // ★**写序按引擎**（`sub_42DC70` raw 38390-38397，`tickets/T-0077` 的 B4 项）：成功分支里引擎
  //   先写 `op3..op9`（年/月/日/时/分/秒 + 游玩秒数），**最后**才 `op1 = 0`；失败分支**只写 op1**
  //   （`op1 = 1` 打不开 / `op1 = 2` 解析失败，raw 38387/38401）——两种失败都不碰 op3..op9。
  //   此前 emulator 把 `op1 = 0` 写在了最前面（行为上多数脚本看不出来，但"读到 op1=0 时 op3..op9 是否已就绪"
  //   这种观察是会露的）⇒ 现按体对齐。
  const h = head.header;
  p.setInt(3, h.year);
  p.setInt(4, h.month);
  p.setInt(5, h.day);
  p.setInt(6, h.hour);
  p.setInt(7, h.minute);
  p.setInt(8, h.second);
  p.setInt(9, h.playSeconds);
  p.setInt(1, 0);
};

/**
 * `0x1A1`（`sub_42DDE0` raw 38407-38440）：**读档**（全量：含字体/额外块）。
 *
 * ★**不写任何操作数**：引擎这条只 `CreateFileA` + `sub_410160(...,1,1)` + 把 `pool_int` 重新 ENC
 * （raw 38431-38438），**从不调 `sub_42B4B0`**（= VM 的"写操作数"出口），而调度器
 * `(*(void (**)(int))(_this + 4 * opcode + 675996))(_this)`（raw 21217）**丢弃 C 返回值**
 * ⇒ 引擎里 `0x1A1` 的 `op1` 一个字节都不写；真实脚本给的 `(global-int f7ffd)` 只是占位
 * （对照 `0x19E`：脚本给 `(global-int 1396)`，那是真输出槽）。读档成功与否由脚本先用 `0x1A0` 验头。
 * ★订正：emulator 早先在此写 `op1 = 状态码`，会污染脚本的占位槽 ⇒ 与引擎对齐为不写。
 */
const op_slot_load: OpHandler = async (c) => {
  const e = c.e;
  // ★`tickets/T-0082`：op2 走计划层；**op1 声明为 `unused`**（引擎不读也不写）。
  const plan = planFor(c);
  const slot = plan.int(2) ?? 0;
  // 失败静默（引擎同：`sub_410160` 的返回值被调度器丢弃）。
  const { transferredTo } = await loadSlotIntoEngine(e, slot, { full: true });
  // ★控制转移（引擎 `sub_410160` 的 a6=1 段）：`cur` 已切到根脚本并重载 ⇒ 本帧从它的 ip 继续，
  //   调用方脚本（SAVE.BIN 一类）到此被放弃。**必须 `jump`**：不跳的话 `stepOnce` 会把
  //   `e.curScript()`（= 刚重载的根脚本）的 ip 从 0 自增到 1，吃掉根脚本的第一条指令。
  if (transferredTo !== null) c.jump(transferredTo);
};

/** `0x19F`（`sub_42DB10` raw 38334-38363）：读档（`a6=a7=0`：不还原字体/额外块）。★写 op1（引擎 raw 38362）。 */
const op_slot_load_short: OpHandler = async (c) => {
  const plan = planFor(c);
  const e = c.e;
  const slot = (plan.int(2) ?? 0);
  // a6=0 ⇒ 引擎此处**不转移**（只还原两张表；语料 0 处）。
  const { code } = await loadSlotIntoEngine(e, slot, { full: false });
  plan.setInt(1, code);
};

/**
 * `0x19E`（`sub_42D980` raw 38287-38331）：**存档**（原名"存档到槽位"…★订正：读档是 `0x1A1`）。
 * 引擎先读头（占用且头不合法 ⇒ 弹确认框），再 `CREATE_ALWAYS` 写。
 * ★未建模确认框（见 `SLOT_GAPS`）：宿主无对话框 ⇒ 直接覆盖（等价于玩家点了"是"）。
 */
const op_slot_save: OpHandler = async (c) => {
  const plan = planFor(c);
  const e = c.e;
  const slot = (plan.int(2) ?? 0);
  plan.setInt(1, await saveSlotFromEngine(e, slot));
};

/** `0x1AB`（`sub_42DFC0` raw 38462-38483）：删槽（`.DAT` + `.STH`）。`op1`：0 都成功 / 1 `.DAT` 失败 / 2 `.STH` 失败。 */
const op_slot_delete: OpHandler = async (c) => {
  const plan = planFor(c);
  const e = c.e;
  const slot = (plan.int(2) ?? 0);
  const fs = e.fileSource;
  if (!fs?.deleteSaveSlot) {
    plan.setInt(1, 1);
    return;
  }
  const r = await fs.deleteSaveSlot(slot);
  plan.setInt(1, r.dat ? (r.sth ? 0 : 2) : 1);
};

/** `0x1AC`（`sub_42E0A0` raw 38485-38513）：复制槽（`op2` → `op3`，两个文件都复制）。 */
const op_slot_copy: OpHandler = async (c) => {
  const plan = planFor(c);
  const e = c.e;
  const from = (plan.int(2) ?? 0);
  const to = (plan.int(3) ?? 0);
  const fs = e.fileSource;
  if (!fs?.copySaveSlot) {
    plan.setInt(1, 1);
    return;
  }
  const r = await fs.copySaveSlot(from, to);
  plan.setInt(1, r.dat ? (r.sth ? 0 : 2) : 1);
};

/**
 * `0x1AE`（`sub_42E1F0` raw 38515-38550）：**写 `.STH`（存档缩略图）**。
 *
 * `op2` = 槽号、**`op3` = 纹理槽**（不是"块选择子"；见 `tickets/T-0036`）。引擎把**该纹理槽的位图**写成
 * `.STH`：DrawMode==1（D3D）走 `sub_4A5260(Engine+322832, FileName, op3)`，否则走
 * `sub_43BF20(_this+1978, op3, handle)`——两者产物都是 **BMP**（`sub_43BF20` raw 47838 写的正是
 * `"BM"` + 40 字节 DIB + 24bpp 位；E4：真槽 `.STH` 全是 172,854 B = 54 + 320×180×3）。
 * 真实调用面：`src/$1$SC0330.txt:17590-17595`（先 `create-texture e 140 b4 2` 造 320×180 离屏纹理，
 * 存完槽后 `i1ae (global-int 1396) (global-int f8019) e` 把它写进 `.STH`）。
 *
 * `op1`：0 成功 / 1 打不开（写不了）/ 2 失败（序列化失败）。
 * ★宿主没有画布（headless/无渲染器）时 `getSlotPixels` 拿不到像素 ⇒ 退回"自描述空块"（能往返、无图），
 * 行为与引擎的"该槽是空表面"等价。
 */
const op_slot_thumb_write: OpHandler = async (c) => {
  const plan = planFor(c);
  const e = c.e;
  const slot = (plan.int(2) ?? 0);
  const texSlot = (plan.int(3) ?? 0);
  const fs = e.fileSource;
  if (!fs?.writeSlotThumb) {
    plan.setInt(1, 1);
    return;
  }
  const px = c.native.getSlotPixels?.(texSlot) ?? null;
  const payload = px
    ? encodeBmp({ width: px.w, height: px.h, rgba: px.rgba })
    : buildSlotThumb(new TextEncoder().encode(`AMYTH1\n{"slot":${slot},"tex":${texSlot}}`));
  try {
    await fs.writeSlotThumb(slot, payload);
  } catch {
    plan.setInt(1, 2);
    return;
  }
  plan.setInt(1, 0);
};

/**
 * `0x1AF`（`sub_42E320` raw 38553-38594）：**读 `.STH`（存档缩略图）**。
 *
 * `op2` = 槽号、**`op3` = 纹理槽**（要装进哪个槽）。引擎：`CreateFileA`（失败 ⇒ `op1 = 1`）→
 * `sub_40BF20(Engine+1978, op3, -1, hFile, GetFileSize)`（raw 16072）→ `sub_43E9F0`（raw 49926，
 * 报错串写的就是 ddReadBmp）**按 BMP 读**（校验 `19778` = `"BM"`）⇒ 该纹理槽的 dd 表面就是缩略图，
 * 失败 ⇒ `op1 = 2`。
 *
 * 真实用例 `src/SAVE.txt:2086-2095`（存档列表右侧那张图）：
 * ```
 * 2086  create-texture (local-int 21c6) 140 b4 0          ← 320×180 离屏槽
 * 2088  i1af (local-int 12) (local-int 219) (local-int 21c6)  ← op1=状态 out、op2=槽号、op3=纹理槽
 * 2089  eq (local-int 21c6) (local-int 12) 0              ← 判 op1 == 0
 * 2090  jcc … label_00009cd8                              ← 失败 ⇒ 跳过
 * 2095  draw-texture … 0 0 140 b4 452 …                   ← 把槽画到界面右侧
 * ```
 * ★`tickets/T-0036` 之前的实现只校验 4 字节长度前缀、**忽略 op3 与图像内容** ⇒ 脚本拿到 `op1 = 0`
 * 但那块纹理仍是空的 ⇒ 右侧缩略图永远不显示。
 */
const op_slot_thumb_read: OpHandler = async (c) => {
  const plan = planFor(c);
  const e = c.e;
  const slot = (plan.int(2) ?? 0);
  const texSlot = (plan.int(3) ?? 0);
  const fs = e.fileSource;
  if (!fs?.readSlotThumb) {
    plan.setInt(1, 1);
    return;
  }
  const bytes = await fs.readSlotThumb(slot);
  if (!bytes || bytes.length === 0) {
    plan.setInt(1, 1);
    return;
  }
  const bmp = decodeBmp(bytes);
  if (bmp) {
    c.native.setSlotPixels?.(texSlot, bmp.width, bmp.height, bmp.rgba);
    plan.setInt(1, 0);
    return;
  }
  // 非 BMP：可能是本工程 T-0018 时期写的自描述空块（4 字节长度前缀 + 载荷）⇒ 认得出来就算"读到了"
  // （引擎格式的槽不会走到这里：它们的 .STH 一定是 BMP）。解不出的其它内容 ⇒ 2（引擎同码）。
  const ok = bytes.length >= 4 && 4 + readU32(bytes, 0) <= bytes.length;
  plan.setInt(1, ok ? 0 : 2);
};

/** 小端 u32（`saveSlot.ts` 里同类读取是私有的，这里就地一份，避免为 4 字节开接口）。 */
function readU32(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

/** 存档槽族（读档链路；`tickets/T-0018`）。 */
export const SAVE_SLOT_OPS: OpTable = [
  [0x19e, op_slot_save], // 存档（SAVE）
  [0x19f, op_slot_load_short], // 读档（不还原字体/额外块）
  [0x1a0, op_slot_read_header], // 读槽头
  [0x1a1, op_slot_load], // 读档（LOAD）
  [0x1ab, op_slot_delete], // 删槽
  [0x1ac, op_slot_copy], // 复制槽
  [0x1ae, op_slot_thumb_write], // 写 .STH
  [0x1af, op_slot_thumb_read], // 读 .STH
];


