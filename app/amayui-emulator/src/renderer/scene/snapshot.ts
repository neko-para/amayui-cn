/**
 * **确定性快照**：把场景模型导出成可 diff 的结构与对齐文本。
 *
 * 用途：场景执行报告（`npm run report`）与"快照回归" —— 同一脚本跑两次必须逐字节一致，
 * 因此这里的字段顺序/排序/格式都是契约的一部分（改动会让回归 diff 变大）。
 */
import type { Item, MeshObj } from '../drawItem.js';
import { calcDiffuse, itemColor, itemRotationRad, itemScale, itemSrcRect, itemTranslation, meshColor } from '../drawItem.js';
import { W_COLOR, W_FLIPBOOK, W_ROT, W_SCALE, W_TRANS } from '../drawItem.js';
import type { SceneState } from './state.js';
import { SCENE_LAYER_HI, SCENE_LAYER_LO, applySceneXformToPlacement, sceneLayerAffected } from './ops.js';
import { l2dBatches, type L2dMeshBatch } from '../../live2d/render.js';
import type { L2dInstance, L2dNode } from '../../live2d/runtime.js';
import { VIEW_H, VIEW_W } from '../viewport.js';

/**
 * mesh 顶点几何的外接矩形（屏幕像素）。`null` = 没有几何（引擎 `sub_4AF1C0` 的 `flags & 1` 门不画）。
 * 语料里所有 `0x320` 站点都是满屏四边形 ⇒ 矩形 = `(0,0,1280,720)`。
 */
function meshRect(m: MeshObj): { x: number; y: number; w: number; h: number } | null {
  if (m.verts.length < 3) return null;
  const xs = m.verts.map((v) => v.x);
  const ys = m.verts.map((v) => v.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
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
  /** 求值后的 diffuse 态色（`#AARRGGBB`）。 */
  diffuse: string;
  /** 逐顶点基础色 × 态色后的**代表色**（实际画出来的颜色，`#AARRGGBB`）。 */
  color: string;
  flags: number;
  pending: boolean;
  /** 顶点几何（屏幕像素外接矩形；空 = 无几何 ⇒ 引擎不画）。 */
  verts: number;
  rect: { x: number; y: number; w: number; h: number } | null;
  /** 逐顶点基础色（`0x320` 的 op5/op6 数组；诊断用）。 */
  baseColors: string[];
  /** `0x322` 的 op2（引擎 entry[9] = alpha 混合模式选择子，D3D 侧消费者未接）。 */
  blend: number;
  /**
   * **动画窗相位**（起点/延迟/时长；`0x323` 写的窗，起点由绘制期锁存 = `animWindow.winPhase`）。
   *
   * ★只进 JSON（**不打印进快照文本** —— 文本要保持逐字节稳定），但它是"两宿主可比"的关键量：
   * 起点差一帧就会让插值色差 1/255（G3 实测），只报 `color` 时那种差异看起来像"浮点噪声"。
   */
  anim: { start: number; delay: number; dur: number } | null;
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
  /**
   * **Live2D 的 572B 立绘节点 + 10 个实例槽**（引擎 `Scene+1096` / `Scene+55812`）。
   *
   * ★导出的意义（T-0054）：`l2dNodeDrawable` 的判据是"节点指向的槽**真有模型**"（引擎 raw 134320），
   * 而"有没有模型"本身**不可从画面断言**（槽空 ⇒ 整块不出画，无日志无错误）⇒ 必须落进快照，
   * 才能区分"没建节点" / "建了节点但槽是空的" / "有模型但没出画"这三种**症状相同**的故障。
   *
   * `null` = 宿主没提供 Live2D 运行态（`scSnapshot` 的第三参缺省）。
   */
  l2d: {
    /** 非空实例槽（按槽号排序；`hasModel` 恒真，列出的是"活的"那些）。 */
    slots: { slot: number; modelId: number | null; textures: [number, number][]; motion: string | null; loop: boolean; elapsedMs: number }[];
    /** 572B 立绘节点（按 key 排序）。 */
    nodes: {
      key: number;
      /** `+4`：L2D 实例槽号。 */
      slot: number;
      /** ★出画门控（引擎 raw 134320）：`flags & 1` 且槽里有模型。 */
      drawable: boolean;
      /** 本帧算出的**三角批次数**（按纹理号分组；`已判定可画` 且槽有模型时才算，否则 0）。 */
      batches: number;
      /** 本帧算出的三角形总数。 */
      triangles: number;
      /** 变形后顶点的外接矩形（画布坐标；`null` = 没求值）。 */
      rect: { x: number; y: number; w: number; h: number } | null;
      /**
       * 逐批次的纹理来源（★"几何算出来了但一块都画不出"的唯一可诊断信号：
       * `fileId === null` = `0x345` 没绑上，非 null 但宿主里没就绪 = 还在载入/解码失败）。
       */
      tex: { no: number; fileId: number | null; vertices: number; triangles: number; alpha: number }[];
    }[];
  } | null;
  /**
   * **A4 族的渲染状态记录**（`0x1FC/0x1FE/0x207/0x20E/0x224/0x229/0x242/0x256/0x321/0x32A/0x32D/0x97`
   * ＋`0x24F/0x250/0x251` 转场记录）。
   * 渲染器尚未逐条消费（见 `analysis/engine-capabilities.json`），但**导出到快照**才能断言
   * "脚本确实下发了这个状态"，也才能在未来接线时对照。
   */
  render4: {
    primReset: number | null;
    primTransform: [number, number[]][];
    blits: { srcSlot: number; dstSlot: number; srcRect: number[]; dstRect: number[] }[];
    commits: number;
    transitionClears: number;
    /** `0x24F`/`0x250`/`0x251` 的转场记录（引擎 `Scene+1048`；`id → 24 格`）。 */
    transitions: [number, number[]][];
    drawMode: number[];
    entryParams: [number, number][];
    slotParams: [number, number[]][];
    meshAttrs: [number, number, number][];
    released3D: number[];
    color3D: number[];
    /** `0x20D` 当前渲染目标槽（-1 = 后台缓冲）。 */
    renderTargetSlot: number;
    /** `0x1F8` op4：每个纹理槽的创建模式。 */
    slotModes: [number, number][];
    /** `0x33F` op1：场景默认混合选择子。 */
    sceneBlend: number;
  };
  /**
   * ★**Scene 世界矩阵（`0x22A`/`0x22C`/`0x22D`/`0x22F`）**：它**只作用于层号 ∈ [20,30) 的项**
   * （引擎 RenderScene raw 133403-133438；见 `scene/state.ts` 的 `sceneXform`）。
   *
   * 导出成快照的意义：这四条指令的**写端在 VM、消费端在合成**，中间隔着"层号判据"这一层 ——
   * 只断言 `SceneState.sceneXform` 有值（写端）无法证明它真的作用到了哪一项上。
   * 所以这里额外导出**每条受影响的绘制项的最终屏幕位置/缩放**（`items[]`），让"作用范围"可被断言。
   * `null` = 四条指令一条都没下发过（此时该级等同于不存在，画面与接线前逐字节相同）。
   */
  sceneXform: {
    kind: 'scale' | 'translate' | 'axis-scale';
    scale: { x: number; y: number; z: number };
    translate: { x: number; y: number; z: number };
    axisScale: { x: number; y: number; z: number };
    axisTranslate: { x: number; y: number; z: number };
    maskA: number | null;
    maskB: number | null;
    /** 作用层号区间（引擎 raw 133405 的 `(层号 − 20) > 9` 取反）。 */
    layers: [number, number];
    /**
     * 受影响的绘制项（层号 ∈ [20,30)**且** `flags & 1` 可绘制）：
     * `before` = 不吃 Scene 变换的位置，`after` = 吃了之后的位置（两者相同 = 该项没被推动）。
     */
    items: { handle: number; layer: number; before: { x: number; y: number }; after: { x: number; y: number } }[];
  } | null;
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

/**
 * `scSnapshot` 需要的 Live2D 侧信息（结构化类型：`Engine` 直接满足，无需 import VM 层）。
 *
 * 只声明"读得到什么"，不声明"谁提供" —— 这样共享场景层不必依赖 `vm/engine.ts`（依赖方向保持
 * `vm → renderer`，不反向）。
 */
export interface L2dSnapshotHost {
  readonly l2dSlots: Map<number, L2dInstance>;
  readonly l2dNodes: Map<number, L2dNode>;
}

/** 变形后顶点的外接矩形（画布坐标）。 */

/**
 * 导出 Live2D 运行态（槽 + 节点 + **每个可画节点这一帧的三角批次**）。
 *
 * ★这里用 `l2dBatches`（`live2d/render.ts`）而不是自己求值一遍：那条路径**就是 Pixi 合成用的
 * 同一条**（含画布居中平移、按纹理号分组、`VISIBLE:` 覆盖）⇒ "报告里的立绘"与"屏幕上的立绘"
 * 不可能漂移。求值只在 `l2dNodeDrawable` 为真时做（槽空 ⇒ 不算，与引擎同一条门控 raw 134320）。
 *
 * ★摆放用**固定显示尺寸** `VIEW_W/VIEW_H`（不用宿主实际画布）：快照要跨宿主逐字节可比
 * （两宿主 digest 的口径），而引擎里这个尺寸来自渲染目标、同一场景下是常量。
 */
function l2dSnapshot(host: L2dSnapshotHost | null | undefined): SceneSnapshot['l2d'] {
  if (!host) return null;
  const slots = [...host.l2dSlots.values()]
    .filter((i) => !!i.model)
    .sort((a, b) => a.slot - b.slot)
    .map((i) => ({
      slot: i.slot,
      modelId: i.modelId,
      textures: [...i.textures.entries()].filter(([no]) => no >= 0).sort((a, b) => a[0] - b[0]),
      motion: i.current?.motion.name ?? null,
      loop: i.current?.loop ?? false,
      elapsedMs: Math.round(i.current?.elapsedMs ?? 0),
    }));
  const batches = l2dBatches(host, VIEW_W, VIEW_H);
  const byKey = new Map<number, L2dMeshBatch[]>();
  for (const b of batches) {
    const list = byKey.get(b.key);
    if (list) list.push(b);
    else byKey.set(b.key, [b]);
  }
  const nodes = [...host.l2dNodes.values()]
    .sort((a, b) => a.key - b.key)
    .map((n) => {
      const drawable = (n.flags & 1) !== 0 && !!host.l2dSlots.get(n.slot)?.model;
      const list = byKey.get(n.key) ?? [];
      let triangles = 0;
      let rect: { x: number; y: number; w: number; h: number } | null = null;
      for (const b of list) {
        triangles += b.triangleCount;
        rect = rect ? unionRect(rect, b.rect) : { ...b.rect };
      }
      return {
        key: n.key,
        slot: n.slot,
        drawable,
        batches: list.length,
        triangles,
        rect,
        tex: list.map((b) => ({
          no: b.textureNo,
          fileId: b.textureFileId,
          vertices: b.vertexCount,
          triangles: b.triangleCount,
          alpha: b.opacity,
        })),
      };
    });
  return { slots, nodes };
}

/** 两个外接矩形的并（快照里"这个节点这一帧占多大"）。 */
function unionRect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** 生成确定性快照（按 handle 排序；不依赖遍历顺序）。 */
export function scSnapshot(s: SceneState, clock: number, l2d?: L2dSnapshotHost | null): SceneSnapshot {
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
      // ★`state0/state1` 必须在求值（`calcDiffuse`，窗末有 `state0 ← state1` 的收尾）**之前**读出来。
      state0: hex8(m.state0),
      state1: hex8(m.state1),
      // ★窗相位也要在求值前读（`winPhase`/锁存会写 `anim.start`）。
      anim: m.anim ? { start: m.anim.start, delay: m.anim.delay, dur: m.anim.dur } : null,
      diffuse: hex8(calcDiffuse(m, clock)),
      color: hex8(meshColor(m, calcDiffuse(m, clock))),
      flags: m.flags,
      pending: (m.flags & 2) !== 0,
      verts: m.verts.length,
      rect: meshRect(m),
      baseColors: m.baseColors.map((c) => hex8(c)),
      blend: m.blend,
    }));
  const drawable = drawItems.filter((d) => d.drawable);
  return {
    clock,
    l2d: l2dSnapshot(l2d),
    counts: {
      drawItems: drawItems.length,
      drawableItems: drawable.length,
      visibleItems: drawable.filter((d) => parseInt(d.color.slice(1, 3), 16) > 0).length,
      placeholderItems: drawItems.length - drawable.length,
      meshes: meshes.length,
      pendingItems: drawItems.filter((d) => d.pending).length,
    },
    // ★A4 记录族（`SceneState.render4`）+ `0x203` 的混合模式：**只记录、渲染器暂不消费**。
    //   导出到快照是 `scene/state.ts` 声明的兑现（"报告/测试可以断言脚本确实下发了这个状态"）——
    //   否则这些字段就是"写了没人读"（审计 2026-09 实测：全工程只有写入点 + 声明）。
    render4: {
      primReset: s.render4.primReset,
      primTransform: [...s.render4.primTransform.entries()].map(([k, v]) => [k, [...v]] as [number, number[]]),
      blits: s.render4.blits.map((b) => ({ srcSlot: b.srcSlot, dstSlot: b.dstSlot, srcRect: [...b.srcRect], dstRect: [...b.dstRect] })),
      commits: s.render4.commits,
      transitionClears: s.render4.transitionClears,
      transitions: [...s.render4.transitions.entries()].map(([k, v]) => [k, [...v]] as [number, number[]]),
      drawMode: [...s.render4.drawMode],
      entryParams: [...s.render4.entryParams.entries()].map(([k, v]) => [k, v] as [number, number]),
      slotParams: [...s.render4.slotParams.entries()].map(([k, v]) => [k, [...v]] as [number, number[]]),
      meshAttrs: [...s.render4.meshAttrs.entries()].flatMap(([mesh, m]) =>
        [...m.entries()].map(([idx, v]) => [mesh, idx, v] as [number, number, number]),
      ),
      released3D: [...s.render4.released3D],
      color3D: [...s.render4.color3D],
      // ★`tickets/T-0017`：这三条**渲染器真的消费**（`pixi/presenter.ts` 的混合状态机）——
      //   值 2 的门控就靠"当前渲染目标槽 + 该槽的创建模式"判定（引擎 raw 123110-123115）。
      renderTargetSlot: s.render4.renderTargetSlot,
      slotModes: [...s.render4.slotModes.entries()].map(([k, v]) => [k, v] as [number, number]),
      sceneBlend: s.render4.sceneBlend,
    },
    // ★Scene 世界矩阵（`0x22A`/`0x22C`/`0x22D`/`0x22F`）：导出锚 + **它在哪些项上真的生效**
    //   （`before`/`after` 逐项给，这样"只作用于层号 ∈ [20,30)"这句话可被断言，而不是只看写入点）。
    sceneXform: s.sceneXform
      ? {
          kind: s.sceneXform.kind,
          scale: { ...s.sceneXform.scale },
          translate: { ...s.sceneXform.translate },
          axisScale: { ...s.sceneXform.axisScale },
          axisTranslate: { ...s.sceneXform.axisTranslate },
          maskA: s.sceneXform.maskA,
          maskB: s.sceneXform.maskB,
          layers: [SCENE_LAYER_LO, SCENE_LAYER_HI] as [number, number],
          items: [...s.drawItems.values()]
            .filter((it) => (it.flags & 1) !== 0 && sceneLayerAffected(it.layer))
            .sort((a, b) => a.handle - b.handle)
            .map((it) => {
              const before = { x: it.posX, y: it.posY };
              const after = applySceneXformToPlacement(s, it.layer, {
                position: before,
                scale: { x: 1, y: 1 },
              }).position;
              return { handle: it.handle, layer: it.layer, before, after };
            }),
        }
      : null,
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
    const r = m.rect ? `(${m.rect.x},${m.rect.y},${m.rect.w},${m.rect.h})` : '无几何';
    L.push(
      `mesh 0x${m.handle.toString(16)} layer=${m.layer} state0=${m.state0} state1=${m.state1} diffuse=${m.diffuse}` +
        ` color=${m.color} v=${m.verts} rect=${r} base0=${m.baseColors[0] ?? '-'} blend=${m.blend}` +
        ` flags=0x${m.flags.toString(16)}${m.pending ? ' P' : ''}`,
    );
  }
  // A4 记录族：**只在有内容时打一行**（避免空快照变化）。
  // ★其中 `renderTargetSlot`/`slotModes`/`sceneBlend` 三条**已被渲染器消费**（`tickets/T-0017` 的
  //   混合状态机：值 2 的门控 + 场景默认档），其余仍是"只记录"（缺口账本）。
  {
    const r4 = snap.render4;
    const parts: string[] = [];
    if (r4.primReset !== null) parts.push(`primReset=0x${r4.primReset.toString(16)}`);
    if (r4.primTransform.length) parts.push(`primTransform=${JSON.stringify(r4.primTransform)}`);
    if (r4.blits.length) parts.push(`blits=${r4.blits.length}`);
    if (r4.commits) parts.push(`commits=${r4.commits}`);
    if (r4.transitionClears) parts.push(`transitionClears=${r4.transitionClears}`);
    if (r4.transitions.length) parts.push(`transitions=${JSON.stringify(r4.transitions)}`);
    if (r4.drawMode.length) parts.push(`drawMode=${JSON.stringify(r4.drawMode)}`);
    if (r4.entryParams.length) parts.push(`entryParams=${JSON.stringify(r4.entryParams)}`);
    if (r4.slotParams.length) parts.push(`slotParams=${JSON.stringify(r4.slotParams)}`);
    if (r4.meshAttrs.length) parts.push(`meshAttrs=${JSON.stringify(r4.meshAttrs)}`);
    if (r4.released3D.length) parts.push(`released3D=${JSON.stringify(r4.released3D)}`);
    if (r4.color3D.length) parts.push(`color3D=${JSON.stringify(r4.color3D)}`);
    // ★这三条是**混合状态机**的输入（渲染器真的读它们，`tickets/T-0017`）
    if (r4.renderTargetSlot >= 0) parts.push(`renderTargetSlot=${r4.renderTargetSlot}`);
    if (r4.slotModes.length) parts.push(`slotModes=${JSON.stringify(r4.slotModes)}`);
    if (r4.sceneBlend) parts.push(`sceneBlend=${r4.sceneBlend}`);
    if (parts.length) L.push(`render4（A4 记录族；renderTargetSlot/slotModes/sceneBlend 已被混合状态机消费） ${parts.join(' ')}`);
  }
  // ★Scene 世界矩阵（`0x22A`/`0x22C`/`0x22D`/`0x22F`）：只在四条指令真的下发过时打（保持空快照不变）。
  //   ★它是**本轮唯一"写端在 VM、消费端在合成"**的一族 ⇒ 行里必须同时给出"作用到哪些层/哪些项"，
  //   否则只看这一行无法区分"写进去了"与"真的动了画面"。
  if (snap.sceneXform) {
    const x = snap.sceneXform;
    const mv = x.items
      .map((it) => `0x${it.handle.toString(16)}:(${it.before.x},${it.before.y})→(${it.after.x},${it.after.y})`)
      .join(' ');
    L.push(
      `scene-xform（只作用于层号 ∈ [${x.layers[0]},${x.layers[1]})） kind=${x.kind}` +
        ` scale=(${x.scale.x},${x.scale.y},${x.scale.z}) translate=(${x.translate.x},${x.translate.y},${x.translate.z})` +
        ` axisScale=(${x.axisScale.x},${x.axisScale.y},${x.axisScale.z})` +
        ` axisTranslate=(${x.axisTranslate.x},${x.axisTranslate.y},${x.axisTranslate.z})` +
        ` maskA=${x.maskA ?? '-'} maskB=${x.maskB ?? '-'} 受影响项=${x.items.length}${mv ? ` ${mv}` : ''}`,
    );
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
  // ── Live2D（`tickets/T-0054`）：只在有内容时打 ──────────────────────────────
  // ★为什么要进快照：`l2dNodeDrawable` 的判据（槽里真有模型）**不可从画面断言** ——
  //   槽空/节点没建/有模型但没画，三种故障在截图上都是"什么都没有、也没有报错"。
  if (snap.l2d) {
    for (const s of snap.l2d.slots) {
      const tex = s.textures.map(([no, id]) => `${no}→0x${id.toString(16)}`).join(',') || '-';
      L.push(
        `l2d-slot ${s.slot} model=0x${(s.modelId ?? 0).toString(16)} 纹理=[${tex}]` +
          ` motion=${s.motion ?? '-'} loop=${s.loop ? 1 : 0} t=${s.elapsedMs}ms`,
      );
    }
    for (const n of snap.l2d.nodes) {
      const r = n.rect ? `(${Math.round(n.rect.x)},${Math.round(n.rect.y)},${Math.round(n.rect.w)},${Math.round(n.rect.h)})` : '无几何';
      // ★批次行是"算出来了但画不出"的唯一可诊断信号：`tex=` 里的 `fileId=null` = `0x345` 没绑上，
      //   非 null = 该文件 id 的纹理（宿主侧）还没就绪或解码失败（`pixi/l2dTextures.ts`）。
      const tex = n.tex.map((t) => `${t.no}:${t.fileId === null ? 'null' : '0x' + t.fileId.toString(16)}/${t.triangles}△`).join(',') || '-';
      L.push(
        `l2d-node key=0x${n.key.toString(16)} slot=${n.slot} 可绘制=${n.drawable ? 1 : 0}` +
          ` 批次=${n.batches} 三角=${n.triangles} rect=${r} tex=[${tex}]`,
      );
    }
  }
  return L.join('\n') + '\n';
}