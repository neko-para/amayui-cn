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
import { decodeSlotState, parseSlotFile, parseSlotHeader, buildSlotFile, buildSlotThumb } from '../saveSlot.js';
import { decodeBmp, encodeBmp } from '../bmp.js';
import type { Engine } from '../engine.js';
import { parseScriptBytes } from '../../script/bin.js';
import { loadScriptIntoFrame } from '../ops.js';

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
  e.routes.reset(); // = sub_403EF0(panelA)
  e.msgwin.reset(); // ≈ sub_4B5090（文本/窗口对象复位）
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
export const LOAD_IN_PROGRESS_FLAG = 95780;

/** `loadSlotIntoEngine` 的结果：状态码 + 是否发生了控制转移（`transferredTo = null` = 没有转移）。 */
export interface SlotLoadOutcome {
  /** 0 成功 / 1 打不开 / 2 解析失败（与引擎 `sub_410160` 的返回同尺度）。 */
  code: number;
  /** 转移后应当落到的 ip（引擎 `cur = 0` ⇒ 根脚本的 ip）；`null` = 不转移，调用方继续跑。 */
  transferredTo: number | null;
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

  // ② 本工程状态块（**只有我们自己写的槽才有**：真游戏槽、以及早期没写尾块的槽都是 null，见 `SLOT_GAPS`）。
  if (state) {
    e.key = state.key >>> 0;
    e.globals.int = new Map(state.globals.int);
    e.globals.float = new Map(state.globals.float);
    e.globals.str = new Map(state.globals.str);
    // 帧：按 scriptId 重新读回脚本字节再落 ip/返回栈（引擎的 `0xAE` 会按存档版本重算 ip，
    // 本工程写的是**绝对 ip**，无需重算；`0xAE` 仍在 `handlers/frame.ts` 里独立实现）。
    for (let i = 0; i < state.frames.length && i < e.frames.length; i++) {
      const f = state.frames[i]!;
      const frame = e.frames[i]!;
      if (frame.scriptId !== f.scriptId || !frame.script) {
        // 脚本不在该帧里（跨实例读档的常见情形）⇒ 按 scriptId 重读；
        // 读不到（资源缺失）⇒ 保留现有脚本，只清 ip，避免"读档后跑到别的脚本里"。
        const sb = await fs.readScript?.(f.scriptId);
        if (sb) loadScriptIntoFrame(frame, parseScriptBytes(sb.data), sb.name || f.name, f.scriptId);
        else frame.name = f.name || frame.name;
      }
      frame.ip = f.ip;
      frame.retStack = [...f.retStack];
    }
    e.cur = state.cur;
    e.playSeconds = state.playSeconds;
    return { code: 0, transferredTo: null }; // 能直接续档 ⇒ 不转移（本工程格式的既定口径）
  }
  // ③ 引擎格式的槽（真游戏写的）/ 没有状态块的槽：状态主体未解析（`SLOT_GAPS`），但**游玩秒数在头里**（`+280`）
  // ⇒ 至少把它接上：引擎装载时把 `+280` 存进容器 `[260]`、再把 `[259] = [260]`、`[258] = now`
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
  const state = {
    key: e.key >>> 0,
    cur: e.cur,
    frames: e.frames
      .filter((f) => f.script !== null)
      .map((f) => ({ scriptId: f.scriptId, name: f.name, ip: f.ip, retStack: [...f.retStack] })),
    globals: {
      int: [...e.globals.int.entries()],
      float: [...e.globals.float.entries()],
      str: [...e.globals.str.entries()],
    },
    playSeconds: Math.floor(e.playSeconds),
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

/** 让 `decodeSlotState` 的导入不被摇树掉（诊断/测试会用；`saveSlot.ts` 里已导出）。 */
export { decodeSlotState };
