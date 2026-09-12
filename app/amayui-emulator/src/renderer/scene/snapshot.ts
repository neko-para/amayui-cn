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

/** 一个消息窗的文本快照（「报告里能看见文字」正是本轮要解决的可见性问题）。 */
export interface SnapshotMsgWin {
  win: number;
  /** 屏幕位置与尺寸（引擎 `win+12/+16/+20/+24`）。 */
  rect: { x: number; y: number; w: number; h: number };
  vertical: boolean;
  align: number;
  mainSize: number;
  rubySize: number;
  /** 主字体填充色 / 描边色（`#rrggbb`，引擎 `Font+1360`/`+1364`）。 */
  mainFill: string;
  mainOutline: string;
  /** 主/注音字体**面名**（已解析到内置字族；对照引擎 `0x1A5`/`0x2FE` 的结果）。 */
  mainFamily: string;
  rubyFamily: string;
  /** 主字体字重（400/700）。 */
  mainWeight: number;
  outlineMode: number;
  outlineDx: number;
  outlineDy: number;
  /** 底色（`null` = 不填）。 */
  background: string | null;
  /**
   * 文本在场景里的层序（= 引擎 `win+104`，op `0x213`；`0` = 未设过 ⇒ 渲染层回退平面号 `20+win`）。
   * ★它决定"文字会不会被 UI 盖住"（CONFIG1 = 180500，普通 2D 图元是 100 量级）。
   */
  itemId: number;
  /** 已排版的行/列。 */
  lines: { text: string; width: number; glyphs: number; ruby: number }[];
  glyphCount: number;
  /** ★本帧实际画出的字形数（逐字显现游标；无显现状态时 = `glyphCount`）。 */
  revealed: number;
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
  /** 消息窗文本（按窗索引排序）。 */
  msgWins: SnapshotMsgWin[];
  /** `0x204` 直绘进纹理槽的文本（按槽号排序；每槽一行汇总）。 */
  slotText: { slot: number; count: number; sample: string }[];
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
    msgWins: [...s.msgWins.values()]
      .sort((a, b) => a.win - b.win)
      .map((f) => ({
        win: f.win,
        rect: { x: f.style.x, y: f.style.y, w: f.style.w, h: f.style.h },
        vertical: f.style.vertical,
        align: f.style.align,
        mainSize: f.style.main.size,
        rubySize: f.style.ruby.size,
        mainFill: f.style.main.fill,
        mainOutline: f.style.main.outline,
        mainFamily: f.style.main.family,
        rubyFamily: f.style.ruby.family,
        mainWeight: f.style.main.weight,
        outlineMode: f.style.outlineMode,
        outlineDx: f.style.outlineDx,
        outlineDy: f.style.outlineDy,
        background: f.style.background,
        itemId: f.style.itemId,
        lines: f.lines.map((l) => ({ text: l.text, width: l.width, glyphs: l.glyphs.length, ruby: l.ruby.length })),
        glyphCount: f.glyphCount,
        revealed: f.revealed,
      })),
    // `0x204` 直绘进纹理槽的文本（每槽一行汇总，便于断言/诊断）
    slotText: [...s.slotText.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([slot, list]) => ({ slot, count: list.length, sample: list[0]?.text ?? '' })),
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
  // 消息窗文本：让「文字」从不可观测变成可 diff（此前报告里完全看不到文本）
  for (const w of snap.msgWins) {
    const dir = w.vertical ? '横排(vFlag=1)' : '横排';
    L.push(
      `text win=${w.win} rect=(${w.rect.x},${w.rect.y},${w.rect.w},${w.rect.h}) ${dir} align=${w.align}` +
        ` layer=${w.itemId || '-'} main=${w.mainSize}px ruby=${w.rubySize}px outline=${w.outlineMode}` +
        ` bg=${w.background ?? '-'} 行=${w.lines.length} 字=${w.glyphCount} 已显示=${w.revealed}`,
    );
    for (const [i, l] of w.lines.entries()) {
      L.push(`  [${i}] w=${l.width} 字=${l.glyphs} 注音=${l.ruby} | ${l.text}`);
    }
  }
  // `0x204` 直绘进纹理槽的文本（CONFIG1 的设置行就是这么做出来的）
  for (const t of snap.slotText) {
    L.push(`slot-text slot=${t.slot} 条数=${t.count} 例=${JSON.stringify(t.sample)}`);
  }
  return L.join('\n') + '\n';
}