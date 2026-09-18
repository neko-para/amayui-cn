/**
 * **存档槽链路**（`tickets/T-0018`）：读档 / 存档 / 读头 / 删槽 / 复制槽 / `.STH`。
 *
 * 语义与格式见 `src/vm/saveSlot.ts` 的文件头（引擎 raw 依据、头部契约 E4、本工程槽布局都在那里）。
 * 本模块只做三件事：
 *  1. 读操作数（槽号等）；
 *  2. 经 `Engine.fileSource` 做**异步**文件 I/O（`OpHandler` 允许返回 Promise，`stepOnce` 会 `await`）；
 *  3. 按引擎写回操作数（`op1` 结果码 + `0x1A0` 的 6×u16 + 游玩秒数）。
 *
 * ★为什么 handler 可以 async（而纹理帧屏障走的是"驱动钩子"）：`stepOnce` 是
 * `await handler(ctx)`（`interpreter.ts`），所以 handler 自己 await 文件 I/O 是安全的；
 * 屏障那条走钩子是因为它要等的是**宿主 IPC**、且必须发生在"本指令之后、下一条之前"（见 `frame/loop.ts`）。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, writeIntOperand } from '../operand.js';
import type { OpTable } from './shared.js';
import { parseSlotFile, parseSlotHeader, buildSlotFile, buildSlotThumb, type SlotFrameState, type SlotStateBlock } from '../saveSlot.js';
import { decodeEngineSlot, resolveSlotRetStack, type EngineSlotPayload } from '../engineSlot.js';
import { restoreAdvState, snapshotAdvState } from '../advState.js';
import { bgmReplayIntent } from './audio.js';
import { decodeBmp, encodeBmp } from '../bmp.js';
import { enc } from '../bits.js';
import type { Engine } from '../engine.js';
import { parseScriptBytes } from '../../script/bin.js';
import { loadScriptIntoFrame } from '../ops.js';
import { ENGINE_FIELD } from '../engineFieldIds.js';

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
async function restoreEngineSlot(e: Engine, bytes: Uint8Array, sv1: number, sv2: number): Promise<boolean> {
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
  //    int 池是**定长稀疏数组**（本机真槽 1,015,792 项、非零 ~1.2 万）⇒ 只装非零项（读侧缺省即 0）。
  e.globals.int.clear();
  for (let i = 0; i < p.ints.length; i++) {
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

  // ③ 面板 / 文本复位（引擎 raw 19913-19915；与 `transferToRootAfterLoad` 同一口径）。
  //   ★**不**在这里整批清绘制项（`tickets/T-0063`）：ADV 场景的绘制是**一次性**的
  //   （实测 SN0000/SC0330 主循环之后的 17000 行里只有 14~16 处 `draw-texture`、2~3 处 `i20c`），
  //   读档时清掉就再也画不回来。引擎靠的是"**续跑的脚本从入口重跑一遍**"（场景 init 重画背景、
  //   并在 init 里 `i259` 清掉上一场留下的绘制记录）——emulator 现在与本工程槽共用同一条路（见下）。
  e.routes.reset();
  e.msgwin.reset();
  e.native.msgWinClearAll?.();

  // ④ 帧 0 ← 记录 0 的脚本（= 引擎 `sub_40F750(3)`：装脚本 + 恢复返回栈；**ip 不设** ——
  //    目标脚本入口那条 `i0ae` 会按记录把 ip 落到存档位置，见 `handlers/frame.ts`）。
  const frame = e.frames[0]!;
  loadScriptIntoFrame(frame, script, boot.name, frame0.scriptId);
  const ret = resolveSlotRetStack(script, frame0);
  frame.retStack = ret.retStack;
  frame.caller = frame0.returnFrame;
  e.cur = 0;

  // ⑤ 读档门 + 续跑记录（`0xAE` 消费）。
  e.engineValues.set(ENGINE_FIELD.musicField, p.pre8); // 引擎 `Engine[698852] = 镜像[2]`
  e.engineValues.set(LOAD_IN_PROGRESS_FLAG, 1);
  // ★`sv1/sv2` = **这份槽自己声明的存档版本**（容器头 +284/+288）：`0xAE` 按它选帧记录的槽位组，
  //   而玩家 INI 可能整个缺 `[set]` 段（`tickets/T-0065`）⇒ 以文件为准（引擎那份是启动时从 SAVE.DAT 头读进
  //   字段 21968/21972 再供 `GetConfig` 用的，同源）。
  e.saveResume = { savedCur: p.savedCur, savedRet: p.savedRet, frames: p.frames, sv1, sv2 };
  e.native.log(
    `[slot-load] 真槽续跑就绪：帧 0 = ${boot.name}(id=0x${frame0.scriptId.toString(16)})、savedCur=${p.savedCur}、` +
      `池 int=${p.ints.length}/float=${p.floats.length}/str=${p.strings.length}、帧记录 ${p.frames.length} 条` +
      `${ret.dropped ? `（返回栈丢 ${ret.dropped} 项）` : ''}`,
  );
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
    if (await restoreEngineSlot(e, bytes, parsed.data.header.format, parsed.data.header.aux)) {
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
    //   为什么必须这样：ADV 场景的绘制是**一次性**的（实测 SN0000/SC0330 主循环之后的 17000 行里只有
    //   14~16 处 `draw-texture`），引擎读档后靠"**场景脚本从入口重跑**"把背景重画、并在场景 init 里
    //   `i259`（清绘制记录）落掉上一场（这里是存档列表）留下的图形。直接落 ip 会跳过 init ⇒
    //   界面残留 + 背景不重画（2026-09 用户实测：存档界面压在 ADV 上）。
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
  const slot = readIntOperand(e, c.frame, c.instr, 2);
  const fs = e.fileSource;
  if (!fs?.readSaveSlot) {
    writeIntOperand(e, c.frame, c.instr, 1, 1); // 打不开（宿主没有该能力 ⇒ 与"文件不存在"同码）
    return;
  }
  const bytes = await fs.readSaveSlot(slot);
  if (!bytes) {
    writeIntOperand(e, c.frame, c.instr, 1, 1);
    return;
  }
  const head = parseSlotHeader(bytes);
  if (!head.ok) {
    writeIntOperand(e, c.frame, c.instr, 1, 2);
    return;
  }
  writeIntOperand(e, c.frame, c.instr, 1, 0);
  const h = head.header;
  writeIntOperand(e, c.frame, c.instr, 3, h.year);
  writeIntOperand(e, c.frame, c.instr, 4, h.month);
  writeIntOperand(e, c.frame, c.instr, 5, h.day);
  writeIntOperand(e, c.frame, c.instr, 6, h.hour);
  writeIntOperand(e, c.frame, c.instr, 7, h.minute);
  writeIntOperand(e, c.frame, c.instr, 8, h.second);
  writeIntOperand(e, c.frame, c.instr, 9, h.playSeconds);
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
  const slot = readIntOperand(e, c.frame, c.instr, 2);
  // 失败静默（引擎同：`sub_410160` 的返回值被调度器丢弃）。
  const { transferredTo } = await loadSlotIntoEngine(e, slot, { full: true });
  // ★控制转移（引擎 `sub_410160` 的 a6=1 段）：`cur` 已切到根脚本并重载 ⇒ 本帧从它的 ip 继续，
  //   调用方脚本（SAVE.BIN 一类）到此被放弃。**必须 `jump`**：不跳的话 `stepOnce` 会把
  //   `e.curScript()`（= 刚重载的根脚本）的 ip 从 0 自增到 1，吃掉根脚本的第一条指令。
  if (transferredTo !== null) c.jump(transferredTo);
};

/** `0x19F`（`sub_42DB10` raw 38334-38363）：读档（`a6=a7=0`：不还原字体/额外块）。★写 op1（引擎 raw 38362）。 */
const op_slot_load_short: OpHandler = async (c) => {
  const e = c.e;
  const slot = readIntOperand(e, c.frame, c.instr, 2);
  // a6=0 ⇒ 引擎此处**不转移**（只还原两张表；语料 0 处）。
  const { code } = await loadSlotIntoEngine(e, slot, { full: false });
  writeIntOperand(e, c.frame, c.instr, 1, code);
};

/**
 * `0x19E`（`sub_42D980` raw 38287-38331）：**存档**（原名"存档到槽位"…★订正：读档是 `0x1A1`）。
 * 引擎先读头（占用且头不合法 ⇒ 弹确认框），再 `CREATE_ALWAYS` 写。
 * ★未建模确认框（见 `SLOT_GAPS`）：宿主无对话框 ⇒ 直接覆盖（等价于玩家点了"是"）。
 */
const op_slot_save: OpHandler = async (c) => {
  const e = c.e;
  const slot = readIntOperand(e, c.frame, c.instr, 2);
  writeIntOperand(e, c.frame, c.instr, 1, await saveSlotFromEngine(e, slot));
};

/** `0x1AB`（`sub_42DFC0` raw 38462-38483）：删槽（`.DAT` + `.STH`）。`op1`：0 都成功 / 1 `.DAT` 失败 / 2 `.STH` 失败。 */
const op_slot_delete: OpHandler = async (c) => {
  const e = c.e;
  const slot = readIntOperand(e, c.frame, c.instr, 2);
  const fs = e.fileSource;
  if (!fs?.deleteSaveSlot) {
    writeIntOperand(e, c.frame, c.instr, 1, 1);
    return;
  }
  const r = await fs.deleteSaveSlot(slot);
  writeIntOperand(e, c.frame, c.instr, 1, r.dat ? (r.sth ? 0 : 2) : 1);
};

/** `0x1AC`（`sub_42E0A0` raw 38485-38513）：复制槽（`op2` → `op3`，两个文件都复制）。 */
const op_slot_copy: OpHandler = async (c) => {
  const e = c.e;
  const from = readIntOperand(e, c.frame, c.instr, 2);
  const to = readIntOperand(e, c.frame, c.instr, 3);
  const fs = e.fileSource;
  if (!fs?.copySaveSlot) {
    writeIntOperand(e, c.frame, c.instr, 1, 1);
    return;
  }
  const r = await fs.copySaveSlot(from, to);
  writeIntOperand(e, c.frame, c.instr, 1, r.dat ? (r.sth ? 0 : 2) : 1);
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
  const e = c.e;
  const slot = readIntOperand(e, c.frame, c.instr, 2);
  const texSlot = readIntOperand(e, c.frame, c.instr, 3);
  const fs = e.fileSource;
  if (!fs?.writeSlotThumb) {
    writeIntOperand(e, c.frame, c.instr, 1, 1);
    return;
  }
  const px = c.native.getSlotPixels?.(texSlot) ?? null;
  const payload = px
    ? encodeBmp({ width: px.w, height: px.h, rgba: px.rgba })
    : buildSlotThumb(new TextEncoder().encode(`AMYTH1\n{"slot":${slot},"tex":${texSlot}}`));
  try {
    await fs.writeSlotThumb(slot, payload);
  } catch {
    writeIntOperand(e, c.frame, c.instr, 1, 2);
    return;
  }
  writeIntOperand(e, c.frame, c.instr, 1, 0);
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
  const e = c.e;
  const slot = readIntOperand(e, c.frame, c.instr, 2);
  const texSlot = readIntOperand(e, c.frame, c.instr, 3);
  const fs = e.fileSource;
  if (!fs?.readSlotThumb) {
    writeIntOperand(e, c.frame, c.instr, 1, 1);
    return;
  }
  const bytes = await fs.readSlotThumb(slot);
  if (!bytes || bytes.length === 0) {
    writeIntOperand(e, c.frame, c.instr, 1, 1);
    return;
  }
  const bmp = decodeBmp(bytes);
  if (bmp) {
    c.native.setSlotPixels?.(texSlot, bmp.width, bmp.height, bmp.rgba);
    writeIntOperand(e, c.frame, c.instr, 1, 0);
    return;
  }
  // 非 BMP：可能是本工程 T-0018 时期写的自描述空块（4 字节长度前缀 + 载荷）⇒ 认得出来就算"读到了"
  // （引擎格式的槽不会走到这里：它们的 .STH 一定是 BMP）。解不出的其它内容 ⇒ 2（引擎同码）。
  const ok = bytes.length >= 4 && 4 + readU32(bytes, 0) <= bytes.length;
  writeIntOperand(e, c.frame, c.instr, 1, ok ? 0 : 2);
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

