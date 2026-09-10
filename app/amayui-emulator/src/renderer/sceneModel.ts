/**
 * **场景模型（共享层）**：`Scene` 里那些"纯数据"的变更操作，**只有一份**，两个宿主共用：
 *
 * | 宿主 | 位置 | 用途 |
 * |---|---|---|
 * | `PixiBackend` | Electron 渲染窗 | 真实画到 Pixi（`present()` 读同一份模型） |
 * | `HeadlessScene` | Node | 场景执行报告 / 快照 / 静默检测（无需 Electron/WebGL） |
 *
 * 这样划分之后：
 *  - **语义**（5 个窗、冻结、flipbook、颜色整数式、CG 数字条几何、区间删除…）只存在于
 *    `drawItem.ts` + 本文件；
 *  - 宿主只负责**副作用**：画到 Pixi、或记进快照。
 *
 * 之前 `PixiBackend` 把 glue 内联在自己身上 ⇒ 一旦要写无渲染版就会产生第二份语义，
 * 两份一旦漂移就会出现"报告说对、画面不对"这类最难查的问题。本文件就是为了消灭这个可能。
 */
import {
  advanceWindows,
  applyDrawColor,
  applyDrawColorAlpha,
  applyDrawPivot,
  applyDrawPos,
  applyDrawTranslation,
  applyFlipbook,
  applyMeshVertexColor,
  applyMeshVertexColorAlpha,
  applyRotationAnim,
  applyScaleAnim,
  applyTranslationAnim,
  calcDiffuse,
  cgDigitItems,
  itemColor,
  itemRotationRad,
  itemScale,
  itemSrcRect,
  itemTranslation,
  makeDefaultItem,
  makeItem,
  makeMesh,
  meshWindowDone,
  windowDone,
  type DrawItemConfig,
  type Item,
  type MeshObj,
  type Vec3,
} from './drawItem.js';

/** 场景模型状态（= `Scene` 在 emulator 侧的可见部分）。 */
export interface SceneState {
  drawItems: Map<number, Item>;
  meshes: Map<number, MeshObj>;
  /** `0x203` 的 op2 混合模式是否曾被写入（用于死写/缺口自检；当前渲染器不消费它）。 */
  blendWritten: Map<number, number>;
}

export function newSceneState(): SceneState {
  return {
    drawItems: new Map<number, Item>(),
    meshes: new Map<number, MeshObj>(),
    blendWritten: new Map<number, number>(),
  };
}

/**
 * `0x1FB` draw-texture：建/覆盖一个 DrawItem（等价引擎 `sub_4ACE50`），并置 bit0（可绘制）。
 *
 * 引擎 `sub_4ACE50` 写的是 `flags|=1`、`+4` 纹理槽、`+8..+0x14` 源矩形、`+36/+40/+44` 描画位置。
 * ⇒ **每次 draw-texture 都会覆盖描画位置**（op7/op8），不消费任何"之前 setter 留下的值"；
 * 顺序由脚本决定（先 0x219 后 draw-texture ⇒ draw-texture 赢；反之 0x219 赢）。
 * 早前 emulator 用 `posOverride` 暂存并在建项时套用，与引擎不符，已移除。
 */
export function scConfigureDrawItem(s: SceneState, cfg: DrawItemConfig): Item {
  const existing = s.drawItems.get(cfg.handle);
  const it = existing ?? makeItem(cfg);
  it.layer = cfg.layer;
  it.tex = cfg.tex; // 纹理槽号（op2）——渲染取纹理用它，不用 layer
  it.srcX = cfg.srcX;
  it.srcY = cfg.srcY;
  it.srcW = cfg.srcW;
  it.srcH = cfg.srcH;
  it.dstX = cfg.dstX;
  it.dstY = cfg.dstY;
  it.flags |= 1; // ★bit0 = 可绘制（引擎 sub_4ACE50 raw 131826 `|= 1u`）
  applyDrawPos(it, cfg.dstX, cfg.dstY, 0); // 引擎同函数写 +36/+40/+44（覆盖）
  s.drawItems.set(cfg.handle, it);
  return it;
}

/**
 * **引擎 `sub_4AAA50` 的等价物（缺失即建项）**：所有 DrawItem setter 在写字段前都会先调它
 * （`0x202`/`0x203`/`0x217`/`0x219`/`0x21F`/`0x220`/`0x239`/`0x1FF`…）。
 * 找不到 key 时用 `sub_49A300` 建一个**全 0**（⇒ `flags = 0`，bit0 未置 ⇒ **尚不可绘制**）的元素再插入 map。
 *
 * ★这不是空操作：引擎里"对不存在的项设色/设位置"会**留下一个元素**，后续 `draw-texture` 或
 * `set-draw-color-alpha` 都可能再落到它上面。早前 emulator 在这种情况下直接丢弃写入 ⇒ 与引擎不符
 * （实测一条 TITLE 路线就有 31+31 次这样的写入被丢掉，见 `.tmp/scene-report-*.json` 的 `createdBySetter`）。
 */
export function scEnsureItem(s: SceneState, handle: number): { item: Item; created: boolean } {
  const existing = s.drawItems.get(handle);
  if (existing) return { item: existing, created: false };
  const it = makeDefaultItem(handle);
  s.drawItems.set(handle, it);
  return { item: it, created: true };
}

/** `0x1F7` detach-texture：`count<=1` 删单项；`count>1` 删 `[handle, handle+count)` 的 DrawItem 与 Mesh。 */
export function scDetachTexture(s: SceneState, handle: number, count: number): { drawItems: number; meshes: number } {
  if (count <= 1) {
    const a = s.drawItems.delete(handle) ? 1 : 0;
    const b = s.meshes.delete(handle) ? 1 : 0;
    return { drawItems: a, meshes: b };
  }
  const hi = handle + count;
  let drawItems = 0;
  let meshes = 0;
  for (const k of [...s.drawItems.keys()]) if (k >= handle && k < hi) { s.drawItems.delete(k); drawItems++; }
  for (const k of [...s.meshes.keys()]) if (k >= handle && k < hi) { s.meshes.delete(k); meshes++; }
  return { drawItems, meshes };
}

/** `0x1F6` clearDrawContainer：整批释放绘制项 + 网格（**保留纹理槽**）。 */
export function scClearDrawContainer(s: SceneState): { drawItems: number; meshes: number } {
  const drawItems = s.drawItems.size;
  const meshes = s.meshes.size;
  s.drawItems.clear();
  s.meshes.clear();
  return { drawItems, meshes };
}

/** `0x320` create-mesh。 */
export function scCreateMesh(s: SceneState, handle: number, layer: number): MeshObj {
  const m = s.meshes.get(handle) ?? makeMesh(handle, layer);
  m.flags |= 1;
  s.meshes.set(handle, m);
  return m;
}

/** setter 的结果分类（诊断用：区分"写了"、"只建了项"、"被 bit0 门控挡住"）。 */
export type SetterOutcome =
  /** 命中已存在且可绘制的项，字段已写入。 */
  | 'applied'
  /** 项不存在 ⇒ 按引擎 `sub_4AAA50` 建了默认项（flags=0），本 op 的字段**未**生效（被 bit0 门控挡住）。 */
  | 'created-gated'
  /** 项不存在 ⇒ 建了默认项，且本 op **无门控**、字段已写入（0x203/0x217/0x219/0x1FF）。 */
  | 'created-applied';

/**
 * `0x219` 描画位置（`sub_4ACEE0`：`sub_4AAA50` 建项 → **无门控**写入 `+36/+40/+44`）。
 * 与早前实现不同：项不存在时**建项并写入**，而不是把值暂存到别处。
 */
export function scSetDrawPos(s: SceneState, handle: number, x: number, y: number, z: number): SetterOutcome {
  const { item, created } = scEnsureItem(s, handle);
  applyDrawPos(item, x, y, z);
  return created ? 'created-applied' : 'applied';
}

/** `0x217` pivot（`sub_4ACF20`：建项 → **无门控**写入 `+24/+28/+32`）。 */
export function scSetDrawPivot(s: SceneState, handle: number, x: number, y: number, z: number): SetterOutcome {
  const { item, created } = scEnsureItem(s, handle);
  applyDrawPivot(item, x, y, z);
  return created ? 'created-applied' : 'applied';
}

/** `0x1FF` 像素平移（`sub_4AC750`：建项 → 无门控 → `+0x68=1` + 平移 work 矩阵）。 */
export function scSetDrawTranslation(s: SceneState, handle: number, x: number, y: number, z: number): SetterOutcome {
  const { item, created } = scEnsureItem(s, handle);
  applyDrawTranslation(item, x, y, z);
  return created ? 'created-applied' : 'applied';
}

/**
 * `0x202` set-draw-color（`sub_4AD0C0`）：`sub_4AAA50` 建项 → **门控 `flags & 1`**
 * （元素必须已由 draw-texture 创建）→ `|=2`/`+0x34=0`/`+0x38`/`+0x4C`/`+0x64`。
 * ★项不存在时引擎**只建项、不配窗**（构造器 `flags=0`，门控必失败）。
 */
export function scSetDrawColor(s: SceneState, handle: number, delay: number, dur: number, to: number): SetterOutcome {
  const { item, created } = scEnsureItem(s, handle);
  if ((item.flags & 1) === 0) return 'created-gated';
  applyDrawColor(item, delay, dur, to);
  return 'applied';
}

/**
 * `0x203` set-draw-color-alpha（`sub_4ACF60`）：`sub_4AAA50` 建项 → **无门控**写 `+0x30`(混合模式)、`+0x60`(FROM)。
 * ★这是"先设色后画"场景能成立的关键：色写在 flags=0 的项上，随后 draw-texture 只是补上 bit0 与纹理，
 *   FROM 保留 ⇒ 画面正确。早前 emulator 丢弃这种写入 ⇒ 该项渲染时用了错误的 FROM。
 */
export function scSetDrawColorAlpha(s: SceneState, handle: number, from: number, blend = 0): SetterOutcome {
  const { item, created } = scEnsureItem(s, handle);
  applyDrawColorAlpha(item, from, blend);
  s.blendWritten.set(handle, blend);
  return created ? 'created-applied' : 'applied';
}

/** `0x21E` 缩放窗（`sub_4AD170`：建项 → 门控 `flags & 1`）。 */
export function scSetScaleAnim(s: SceneState, handle: number, delay: number, dur: number, sx: number, sy: number, sz: number): SetterOutcome {
  const { item, created } = scEnsureItem(s, handle);
  if ((item.flags & 1) === 0) return 'created-gated';
  applyScaleAnim(item, delay, dur, sx, sy, sz);
  return 'applied';
}

/** `0x21F` 旋转窗（`sub_4AD250`：建项 → 门控 `flags & 1`）。 */
export function scSetRotationAnim(s: SceneState, handle: number, delay: number, dur: number, ax: number, ay: number, az: number, deg: number): SetterOutcome {
  const { item, created } = scEnsureItem(s, handle);
  if ((item.flags & 1) === 0) return 'created-gated';
  applyRotationAnim(item, delay, dur, ax, ay, az, deg);
  return 'applied';
}

/** `0x220` 平移窗（`sub_4AD3C0`：建项 → 门控 `flags & 1`）。 */
export function scSetTranslationAnim(s: SceneState, handle: number, delay: number, dur: number, x: number, y: number, z: number): SetterOutcome {
  const { item, created } = scEnsureItem(s, handle);
  if ((item.flags & 1) === 0) return 'created-gated';
  applyTranslationAnim(item, delay, dur, x, y, z);
  return 'applied';
}

/** `0x239` flipbook 窗（`sub_4AD4A0`：建项 → 门控 `flags & 1`）。 */
export function scSetFlipbook(s: SceneState, handle: number, delay: number, dur: number, frames: number, cols: number, flags: number): SetterOutcome {
  const { item, created } = scEnsureItem(s, handle);
  if ((item.flags & 1) === 0) return 'created-gated';
  applyFlipbook(item, delay, dur, frames, cols, flags);
  return 'applied';
}

/** `0x322`/`0x323`：mesh setter 同样"缺失即建项"（引擎 `sub_4AAB80`），且**无门控**。 */
export function scSetVertexColor(s: SceneState, handle: number, state0: number): SetterOutcome {
  const created = !s.meshes.has(handle);
  const m = scCreateMesh(s, handle, handle);
  applyMeshVertexColor(m, state0);
  return created ? 'created-applied' : 'applied';
}

/** `0x323` mesh 顶点色动画窗（建项 → 无门控置 bit1 + 窗 + state1）。 */
export function scSetVertexColorAlpha(s: SceneState, handle: number, delay: number, dur: number, state1: number): SetterOutcome {
  const created = !s.meshes.has(handle);
  const m = scCreateMesh(s, handle, handle);
  applyMeshVertexColorAlpha(m, delay, dur, state1);
  return created ? 'created-applied' : 'applied';
}

/**
 * `0x23B` 按 CG 数字条画数值：先删 `[id, id+digits)` 区间，再按 `cgDigitItems` 逐位建项。
 * 返回本帧新建的项数。
 */
export function scDrawCgNumber(
  s: SceneState,
  id: number,
  rec: readonly number[],
  value: number,
  x: number,
  y: number,
  digits: number,
  flags: number,
): number {
  scDetachTexture(s, id, digits);
  const items = cgDigitItems(id, rec, value, x, y, digits, flags);
  for (const it of items) {
    scConfigureDrawItem(s, {
      handle: it.handle,
      layer: it.handle,
      tex: it.tex,
      srcX: it.srcX,
      srcY: it.srcY,
      srcW: it.srcW,
      srcH: it.srcH,
      dstX: it.dstX,
      dstY: it.dstY,
    });
  }
  return items.length;
}

/** 逐帧驱动：推进所有 DrawItem 的 5 个窗（窗末 `work ← target`；全窗结束清动画位）。 */
export function scAdvance(s: SceneState, clock: number): void {
  for (const it of s.drawItems.values()) advanceWindows(it, clock);
}

/** 场景是否还有动画在跑（供 0x400 卫门判断）。 */
export function scAnimationsDone(s: SceneState, clock: number): boolean {
  for (const m of s.meshes.values()) if (m.flags & 2 && !meshWindowDone(m, clock)) return false;
  for (const it of s.drawItems.values()) if (it.flags & 2 && !windowDone(it, 0, clock)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 快照（确定性、人可读；供场景执行报告与"快照回归"用）
// ---------------------------------------------------------------------------

export interface SnapshotItem {
  handle: number;
  layer: number;
  tex: number;
  /** **是否可绘制**（`flags & 1`）。引擎渲染器以它为门（raw 133361）；`false` = 只被 setter 建出来的空项。 */
  drawable: boolean;
  /** 源矩形（已应用 flipbook 窗）。 */
  src: { x: number; y: number; w: number; h: number };
  /** 描画位置 + 平移窗偏移（引擎里两者是位置字段与平移矩阵，渲染时叠加）。 */
  dst: { x: number; y: number };
  pivot: { x: number; y: number };
  scale: { x: number; y: number };
  rotDeg: number;
  /** 求值后的 diffuse 色，`#AARRGGBB`。 */
  color: string;
  /** 真·混合模式（`+0x30`；当前渲染器不消费 ⇒ 恒为 0 时说明脚本没设过）。 */
  blend: number;
  flags: number;
  /** 是否还有窗没走完。 */
  pending: boolean;
}

export interface SnapshotMesh {
  handle: number;
  layer: number;
  state0: string;
  state1: string;
  /** 求值后的 diffuse 色（`#AARRGGBB`）。 */
  diffuse: string;
  flags: number;
  pending: boolean;
}

export interface SceneSnapshot {
  clock: number;
  counts: {
    drawItems: number;
    /** 可绘制项（`flags & 1`）—— 引擎渲染器真正会画的那些。 */
    drawableItems: number;
    /** 可绘制且 diffuse alpha > 0（真的会显示出来）。 */
    visibleItems: number;
    /** 只被 setter 建出来、bit0 未置的空项（引擎里正常现象，用于核对"缺失即建项"路径）。 */
    placeholderItems: number;
    meshes: number;
    pendingItems: number;
  };
  drawItems: SnapshotItem[];
  meshes: SnapshotMesh[];
}

const hex8 = (v: number): string => '#' + (v >>> 0).toString(16).padStart(8, '0');

/** 生成确定性快照（按 handle 排序；不依赖遍历顺序）。 */
export function scSnapshot(s: SceneState, clock: number): SceneSnapshot {
  const drawItems: SnapshotItem[] = [...s.drawItems.values()]
    .sort((a, b) => a.handle - b.handle)
    .map((it) => {
      const color = itemColor(it, clock);
      const sc = itemScale(it, clock);
      const tr = itemTranslation(it, clock);
      return {
        handle: it.handle,
        layer: it.layer,
        tex: it.tex,
        drawable: (it.flags & 1) !== 0,
        src: itemSrcRect(it, clock),
        dst: { x: it.posX + tr.x, y: it.posY + tr.y },
        pivot: { x: it.pivotX, y: it.pivotY },
        scale: { x: sc.x, y: sc.y },
        rotDeg: (itemRotationRad(it, clock) * 180) / Math.PI,
        color: hex8(color),
        blend: it.blend,
        flags: it.flags,
        pending: (it.flags & 2) !== 0,
      };
    });
  const meshes: SnapshotMesh[] = [...s.meshes.values()]
    .sort((a, b) => a.handle - b.handle)
    .map((m) => ({
      handle: m.handle,
      layer: m.layer,
      state0: hex8(m.state0),
      state1: hex8(m.state1),
      diffuse: hex8(calcDiffuse(m, clock)),
      flags: m.flags,
      pending: (m.flags & 2) !== 0,
    }));
  const drawable = drawItems.filter((d) => d.drawable);
  return {
    clock,
    counts: {
      drawItems: drawItems.length,
      drawableItems: drawable.length,
      visibleItems: drawable.filter((d) => parseInt(d.color.slice(1, 3), 16) > 0).length,
      placeholderItems: drawItems.length - drawable.length,
      meshes: meshes.length,
      pendingItems: drawItems.filter((d) => d.pending).length,
    },
    drawItems,
    meshes,
  };
}

/** 把快照渲染成人可读的对齐文本（快照回归里真正被 diff 的东西）。 */
export function snapshotToText(snap: SceneSnapshot): string {
  const L: string[] = [];
  L.push(
    `# 场景快照 clock=${snap.clock}ms  drawItems=${snap.counts.drawItems}` +
      `（可绘制=${snap.counts.drawableItems} 可见=${snap.counts.visibleItems} 空项=${snap.counts.placeholderItems}）` +
      ` meshes=${snap.counts.meshes} 播放中=${snap.counts.pendingItems}`,
  );
  L.push('# D=可绘制  handle  layer  slot  src(x,y,w,h)            dst(x,y)        pivot      scale        rot°    color      blend flags');
  for (const d of snap.drawItems) {
    L.push(
      [
        d.drawable ? 'D' : '-',
        `0x${d.handle.toString(16).padStart(4, '0')}`.padEnd(7),
        String(d.layer).padEnd(6),
        String(d.tex).padEnd(5),
        `(${d.src.x},${d.src.y},${d.src.w},${d.src.h})`.padEnd(24),
        `(${d.dst.x},${d.dst.y})`.padEnd(15),
        `(${d.pivot.x},${d.pivot.y})`.padEnd(10),
        `(${d.scale.x},${d.scale.y})`.padEnd(12),
        d.rotDeg.toFixed(1).padEnd(6),
        d.color.padEnd(10),
        String(d.blend).padEnd(5),
        `0x${d.flags.toString(16)}${d.pending ? ' P' : ''}`,
      ].join(' '),
    );
  }
  for (const m of snap.meshes) {
    L.push(`mesh 0x${m.handle.toString(16)} layer=${m.layer} state0=${m.state0} state1=${m.state1} diffuse=${m.diffuse} flags=0x${m.flags.toString(16)}${m.pending ? ' P' : ''}`);
  }
  return L.join('\n') + '\n';
}
