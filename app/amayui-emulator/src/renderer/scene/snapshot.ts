/**
 * **确定性快照**：把场景模型导出成可 diff 的结构与对齐文本。
 *
 * 用途：场景执行报告（`npm run report`）与"快照回归" —— 同一脚本跑两次必须逐字节一致，
 * 因此这里的字段顺序/排序/格式都是契约的一部分（改动会让回归 diff 变大）。
 */
import type { Item, MeshObj } from '../drawItem.js';
import { calcDiffuse, itemColor, itemRotationRad, itemScale, itemSrcRect, itemTranslation } from '../drawItem.js';
import { W_COLOR, W_FLIPBOOK, W_ROT, W_SCALE, W_TRANS } from '../drawItem.js';
import type { SceneState } from './state.js';

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