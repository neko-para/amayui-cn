/**
 * **纹理表面（CTexture）与槽对象（node）的共享模型** —— 两个宿主的**同一份**判据
 * （`TextureCache`（Pixi 进程）与 `HeadlessScene`（无头）都用它，避免"两宿主各写一份"的漂移）。
 *
 * 这里只放**引擎里有确切体**的纯函数/常量；对象表的持有者是各宿主自己。
 *
 * 引擎体锚点（`engine/天结_unpacked.exe_utf8.c`，行号 = raw）：
 *  - `sub_4A2C10` raw 122837-122893：`0x1F8` create-texture 的内核 ——
 *    `*(_DWORD *)(_this + 20 * a2 + 1864) = -1`（槽记录的 imgid 写 −1）、
 *    `*(_DWORD *)(_this + 4 * (5 * a2 + 470)) = 1`（槽状态 = 1）、
 *    先析构 `_this + 4*a2 + 42456`（该槽旧 CTexture 对象）、
 *    `a5 == 3 ⇒ operator new(0x460)` + `sub_43A5C0`（**DividedTexture**），
 *    否则 `operator new(0x450)` + `sub_48AB20`（**NormalTexture**）；最后 `(*(obj_vt+12))(obj, w, h, mode)` 建表面。
 *  - `sub_43A5C0` raw 46561-46571：DividedTexture 的 ctor = 调 `sub_48AB20` 后换 vtable、
 *    并把 `_this[276]/[277]/[278]`（**字节 1104/1108/1112** = 子纹理 `std::vector` 的 begin/end/cap）清零。
 *  - `sub_43A740` raw 46611-46798：DividedTexture 的"建表面"（vtable+12）——
 *    `v35 = ceil(w / dword_55052C)`、`v11 = ceil(h / dword_55052C)`，**逐格 new 一张 `0x450` 的子表面**
 *    （尺寸 = 满格 `dword_55052C`，**末列/末行按余数截断**，raw 46776-46783），
 *    **行主序** append 进那个 vector；最后写表面记录 `[263..266] = (0, 0, w, h)`。
 *  - `dword_55052C`：`int dword_55052C = 256;`（raw 5663），由 `0x248`（`sub_4252E0` raw 32705）
 *    按 op1 改写 —— 所以分块边长是**脚本可配**的，不是硬编码。
 *  - `sub_4A4C70` raw 124572-124649：`0x20B` FillTexture 的内核 —— 先夹到该表面记录的
 *    `v7[263..266]`（左/上取 max、右/下取 min，raw 124608-124621），夹完为空
 *    （`*v5 >= v5[2]` / `v5[1] >= v5[3]`，raw 124631-124634）就 `return 1` **不画**。
 *    NormalTexture / DividedTexture 的建面路径都把 `[263..266]` 写成 `(0, 0, w, h)`
 *    （raw 107029-107032 / 46686-46689）⇒ 夹取边界就是表面矩形本身。
 */

/** 分块边长（引擎 `dword_55052C`，初始 256；由 `0x248` 改写）。 */
export const DEFAULT_TILE_SIZE = 256;

/** 表面对象的两套类（`sub_4A2C10` 的两个分支）。 */
export type SurfaceClass = 'normal' | 'divided';

/** DividedTexture 的一块子纹理（**行主序**；末行/末列按余数截断）。 */
export interface DividedTile {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * `sub_43A740` 的分块表：`ceil(w / tile)` × `ceil(h / tile)`，行主序，
 * 末列/末行取余数（raw 46675-46689 / 46776-46783）。
 *
 * 边界：尺寸 ≤ 0 ⇒ `[]`（引擎 `v35 <= 0` / `v11 <= 0` 时分块循环根本不进）；
 * `tile <= 0` ⇒ `[]`（引擎那里是整数除零会崩，宿主不跟着崩、按"没有子纹理"处理并留日志）。
 */
export function dividedTiles(w: number, h: number, tile: number = DEFAULT_TILE_SIZE): DividedTile[] {
  const tw = Math.floor(tile);
  if (!Number.isFinite(tw) || tw <= 0) return [];
  const cw = Math.floor(w);
  const ch = Math.floor(h);
  if (!Number.isFinite(cw) || !Number.isFinite(ch) || cw <= 0 || ch <= 0) return [];
  const cols = Math.ceil(cw / tw);
  const rows = Math.ceil(ch / tw);
  const out: DividedTile[] = [];
  for (let y = 0; y < rows; y++) {
    const th = y === rows - 1 ? ch - tw * (rows - 1) : tw;
    for (let x = 0; x < cols; x++) {
      const twCell = x === cols - 1 ? cw - tw * (cols - 1) : tw;
      out.push({ x: x * tw, y: y * tw, w: twCell, h: th });
    }
  }
  return out;
}

/**
 * `sub_4A4C70` 的矩形夹取（raw 124608-124634）：把 `(x, y, x+w, y+h)` 夹到表面矩形
 * `[0, 0, bw, bh]`；夹完为空（左 ≥ 右 或 上 ≥ 下）⇒ `null` = **引擎直接返回、不画**。
 *
 * ★注意口径：脚本给的是**宽/高**（`v9 = op2 + op4`，raw 31583），不是右下角坐标
 * （`test/op-20b-fill-texture.test.ts` 已锁这一点）。
 */
export function clampFillRect(
  bw: number,
  bh: number,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } | null {
  const left = Math.max(x, 0);
  const top = Math.max(y, 0);
  const right = Math.min(x + w, bw);
  const bottom = Math.min(y + h, bh);
  if (left >= right || top >= bottom) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** 槽对象（引擎 `Engine[slot + 94672]`，字节基址 `+378688`）的种类。 */
export type SlotNodeKind = 'movie' | 'node';

/**
 * 一个**槽对象**（`Engine[slot + 94672]` 那一格）。
 *
 * 为什么不是"CTexture 表面"：这是**另一张表** —— `0x23F`/`0x23E`（`sub_4307B0`/`sub_430750`）
 * 读它、尺寸经 `sub_4080B0`（raw 12960-12979）取；`0x208` 读的是 `Scene + 4*slot + 42456`
 * 那张**表面**表（`sub_49ED60` raw 119786-119795）。两张表都不许混（`T-0153` 的 `0x23F` 条目）。
 *
 * 建它的是 `0x20F` play-movie（`sub_4237B0` raw 31627-31644）与 `0x236`（`sub_4246B0`
 * raw 32245-32252）：**惰性创建**（`if (!_this[4*v2 + 378688]) new 0x480 + sub_489040`）；
 * `0x1F8`/`0x1F9`/`0x1FA` 会把它析构并置 0（raw 31211-31221 / 31245-31269）。
 */
export interface SlotNode {
  kind: SlotNodeKind;
  /** 建立它的统一文件 id（`0x20F`/`0x236` 的 op1）。 */
  id: number;
  /** 建立时的 mode（`0x20F` 的 op3；`0x236` 的 op4）。 */
  mode: number;
}

/**
 * `0x23F` 的宿主侧答案（`sub_4307B0` raw 40019-40030 的两条分支）：
 *  - 该槽**没有对象** ⇒ 引擎写 `op1 = -1` ⇒ `present: false`；
 *  - 有对象 ⇒ `op1 = (int)(sub_4080B0(obj) * 1000.0)`；`sub_4080B0` 对**未分派到类型**的对象返回 `0.0`
 *    ⇒ `present: true` 且 `w = h = 0`（**不是** −1）。
 *
 * `surface` = 该槽 `create-texture` 表面的尺寸（引擎那条链要 `obj[+1044]` 的子对象 = 影片的目标表面；
 * 语料里就是同一槽：`src/FIELD.txt:13718-13721` 的 `create-texture 2a 78 78 0` → `i236` → `i23f … 2a`）。
 * 拿不到 ⇒ 0（同上：`sub_4080B0` 返回 0.0）。
 */
export function slotNodeSizeOf(
  node: SlotNode | undefined,
  surface: { w: number; h: number } | undefined,
): { present: boolean; w: number; h: number } {
  if (!node) return { present: false, w: 0, h: 0 };
  if (surface && surface.w > 0 && surface.h > 0) return { present: true, w: surface.w, h: surface.h };
  return { present: true, w: 0, h: 0 };
}
