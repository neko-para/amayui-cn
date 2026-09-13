/**
 * **场景操作语义**（两个宿主共用的唯一一份）。
 *
 * 这些函数把「opcode 想要做什么」翻译成对 `SceneState` 的改动，与具体渲染后端无关：
 * `pixiBackend` 与 `headlessScene` 都必须经这里改模型 —— 否则"报告里的模型"与
 * "画面上的模型"就会漂移（历史上出过一次：0x1FF 在 Pixi 侧绕过了本层）。
 *
 * 约定：
 *  - **建项**：setter 走"缺失即建"（引擎 `sub_4AAA50`/`sub_4AAB80` 的等价物），
 *    建出来的项 `flags = 0` ⇒ 尚不可绘制；
 *  - **门控**：部分 setter 在 `flags & 1 == 0` 时**不写**（引擎里对应"项还没被 draw-texture 建立"），
 *    返回值 `SetterOutcome` 把这个区别显式化，便于诊断。
 */
import type { DrawItemConfig, Item, MeshObj, MeshVertex } from '../drawItem.js';
import { assertFlags } from '../../vm/native.js';
import {
  W_COLOR,
  applyDrawColor,
  applyDrawColorAlpha,
  applyDrawPivot,
  applyDrawPos,
  applyDrawScale,
  applyDrawTranslation,
  applyFlipbook,
  applyMeshVertexColor,
  applyMeshVertexColorAlpha,
  applyRotationAnim,
  applyScaleAnim,
  applyTranslationAnim,
  cgDigitItems,
  cloneItem,
  cloneMesh,
  makeDefaultItem,
  makeItem,
  makeMesh,
  advanceWindows,
  itemAnimationsPending,
  meshWindowDone,
  windowDone,
} from '../drawItem.js';
import type { SceneState } from './state.js';
import { layoutWindow, type MsgWinInput, type TextFrame } from '../../text/layout.js';

/**
 * `0x1FB` draw-texture：建/覆盖一个 DrawItem（等价引擎 `sub_4ACE50`），并置 bit0（可绘制）。
 *
 * 引擎 `sub_4ACE50` 写的是 `flags|=1`、`+4` 纹理槽、`+8..+0x14` 源矩形、`+36/+40/+44` 描画位置。
 * ⇒ **每次 draw-texture 都会覆盖描画位置**（op7/op8），不消费任何"之前 setter 留下的值"；
 * 顺序由脚本决定（先 0x219 后 draw-texture ⇒ draw-texture 赢；反之 0x219 赢）。
 * 早前 emulator 用 `posOverride` 暂存并在建项时套用，与引擎不符，已移除。
 */
export function scConfigureDrawItem(s: SceneState, cfg: DrawItemConfig): Item {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
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
  // ★严格 flag 校验放在**共享层**（原先只在 PixiBackend）：契约是"配置了不认识的 flag 必须立即中断"，
  //   而所有 E2E 棘轮（`game-start-chain`/`char-reveal`/`config1-chain`…）都跑 headless ⇒
  //   只在 Pixi 侧校验等于"报告/测试永远不会暴露未知位"。两宿主共用同一份模型，就该共用同一道闸。
  assertFlags('drawitem', it.handle, it.flags);
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
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const existing = s.drawItems.get(handle);
  if (existing) return { item: existing, created: false };
  const it = makeDefaultItem(handle);
  s.drawItems.set(handle, it);
  return { item: it, created: true };
}

/**
 * `0x1F7` detach-texture：`count<=1` 删单项；`count>1` 删 `[handle, handle+count)` 的 DrawItem 与 Mesh。
 *
 * ★2026-09 修（用户实测："切换背景时（转场）ADV 文字应该消失，但被保留了"）：
 * 引擎里**屏幕上的字就是 Scene 的 DrawItem**（正文行 id = 行号 + `win+104`，注音/另一组在 `win+276`；
 * 区间由 `0x213`/`0x25D` 登记 —— `SYSTEM4.txt:58/69` 给 win1/win8 登记 `i213 1|8 19a28 1f4`
 * = `[105000,105500)`，`SYSTEM4.txt:57` 给 win1 登记 `i25d 1 1976c 3` = `[104300,104303)`）。
 * 脚本清 ADV 文字的手段**就是按区间删项**：`$1$SC0330.txt` 整个文件 0 次 `i071`/`i301`，
 * 换场只做 `detach-texture 19a28 1f4` + `detach-texture 1a9c8 64`（`$1$SC0330.txt:18117-18119`
 * 的 `label_000406e8`，被 44 处 `call label_000407c0` 调起）；`SN0000.txt:3799/3814` 同理。
 *
 * emulator 的文本另有载体（`msgWins`，见 `scene/state.ts` 的说明）⇒ 只删 DrawItem 不会让字消失，
 * 于是文字会残留到下一次 `0x71`/`0x301`。这里与 `scClearDrawContainer` 的 `scMsgWinClearAll`
 * 走同一条思路：**删掉的区间与某窗登记的区间相交 ⇒ 该窗的字也没了**。
 */
export function scDetachTexture(
  s: SceneState,
  handle: number,
  count: number,
): { drawItems: number; meshes: number; clearedWins: number[] } {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const hi = count <= 1 ? handle + 1 : handle + count;
  let drawItems = 0;
  let meshes = 0;
  if (count <= 1) {
    if (s.drawItems.delete(handle)) drawItems++;
    if (s.meshes.delete(handle)) meshes++;
  } else {
    for (const k of [...s.drawItems.keys()]) if (k >= handle && k < hi) { s.drawItems.delete(k); drawItems++; }
    for (const k of [...s.meshes.keys()]) if (k >= handle && k < hi) { s.meshes.delete(k); meshes++; }
  }
  // 窗的正文/注音图元区间被删光 ⇒ 该窗在画面上不该再有字
  const clearedWins: number[] = [];
  for (const [win, ranges] of s.msgRanges) {
    if (!ranges.some((r) => r.count > 0 && r.base < hi && r.base + r.count > handle)) continue;
    if (!s.msgWins.has(win)) continue;
    scMsgWinClear(s, win);
    clearedWins.push(win);
  }
  return { drawItems, meshes, clearedWins };
}

/**
 * **`0x21D` CopyScene**（引擎 `sub_4AC0D0` raw 131146-131265，错误串「関数：CopyScene エラー」）：
 * 把源绘图项（+ 网格）整份复制到目标 handle。
 *
 * 引擎逐字：三张 map（drawItems=Scene+1032 / meshes=+1064 / +1096）各自
 * `find(src)` → 命中则 `ensure(dst)` + `qmemcpy(dst, src+4, 0x2E4|0x3C|0x23C)`（浅拷贝整块）
 * ⇒ **同一份数据被挂在两个 handle 上**，此后对 dst 的 setter 只改 dst 这一份。
 * 三张 map 全都没命中 ⇒ 打错误串「コピー元のシーンが存在しません．%d」并返回 0（不静默）。
 *
 * 语料用途：脚本把引擎预置的「全屏过渡幕布」（handle 0）复制成一个临时 handle
 * （`ROOM.txt:83/391` → `i21d 0 1f4`、`MMODE.txt:71/763` → `i21d 0 7d0`），随后用
 * `set-draw-color`/`set-draw-color-alpha` 只动那一份来做淡入淡出；ADV 里也用它把 CG 图元
 * 复制成缩放绘制用的临时项（`$1$SC0330.txt:17564` → `i21d 18a9c 30d40`）。
 */
export function scCopyItem(s: SceneState, srcHandle: number, dstHandle: number): { copied: boolean; drawItem: boolean; mesh: boolean } {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const srcItem = s.drawItems.get(srcHandle);
  const srcMesh = s.meshes.get(srcHandle);
  if (!srcItem && !srcMesh) return { copied: false, drawItem: false, mesh: false };
  if (srcItem) s.drawItems.set(dstHandle, cloneItem(srcItem, dstHandle));
  if (srcMesh) s.meshes.set(dstHandle, cloneMesh(srcMesh, dstHandle));
  return { copied: true, drawItem: !!srcItem, mesh: !!srcMesh };
}

/** `0x1F6` clearDrawContainer：整批释放绘制项 + 网格（**保留纹理槽**）。 */export function scClearDrawContainer(s: SceneState): { drawItems: number; meshes: number } {
  const drawItems = s.drawItems.size;
  const meshes = s.meshes.size;
  s.drawItems.clear();
  s.meshes.clear();
  // ★文本窗也要清：引擎 D3D 路径下正文行**就是** Scene 的 DrawItem（id = 行号 + win+104），
  //   `sub_4AB7A0` 清整张 DrawItem 表时它们一起没；GDI 路径下会被重画的画面盖掉。
  //   漏掉这一步的症状：**回到标题/主界面后，上一页的消息文字又画在主界面之上**（2026 实测）。
  scMsgWinClearAll(s);
  return { drawItems, meshes };
}

/** `0x320` create-mesh 的载荷（`handlers/gfx-item.ts` 从操作数数组读好后送进来）。 */
export interface MeshSpec {
  handle: number;
  layer: number;
  vcount: number;
  verts: MeshVertex[];
  /** 逐顶点基础色（ARGB，已 DEC 解码）。 */
  baseColors: number[];
}

/**
 * `0x320` create-mesh（引擎 `sub_432150` → `sub_4ADFE0`）。
 *
 * 引擎只重建**顶点缓冲 + 逐顶点色数组**（旧的先析构），`entry[5]=vcount`、`entry[6]=layer`，
 * 并置 bit0；**state0/state1/动画窗保持不变**。`vcount <= 0` 走「頂点数%dは不正です．」错误分支，
 * 不建几何（bit0 不置 ⇒ 不画）。
 */
export function scCreateMesh(s: SceneState, spec: MeshSpec): MeshObj {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const m = s.meshes.get(spec.handle) ?? makeMesh(spec.handle, spec.layer);
  m.layer = spec.layer;
  if (spec.vcount > 0 && spec.verts.length >= 3) {
    m.verts = spec.verts.map((v) => ({ ...v }));
    m.baseColors = [...spec.baseColors];
    m.flags |= 1;
    assertFlags('mesh', m.handle, m.flags); // 严格 flag 校验放共享层（见 scConfigureDrawItem 处说明）
  }
  s.meshes.set(spec.handle, m);
  return m;
}

/**
 * `sub_4AAB80`（`0x322`/`0x323` 的"缺失即建项"）：只建空条目（`flags = 0` ⇒ 无几何 ⇒ 不画）。
 * ★必须与 `scCreateMesh` 分开：早前两者共用建项路径，导致"只设颜色的 mesh"被当成
 * 满屏黑覆盖层画出来（SN0000 黑屏成因之一）。
 */
export function scEnsureMesh(s: SceneState, handle: number): { mesh: MeshObj; created: boolean } {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const found = s.meshes.get(handle);
  if (found) return { mesh: found, created: false };
  const m = makeMesh(handle, handle);
  s.meshes.set(handle, m);
  return { mesh: m, created: true };
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
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { item, created } = scEnsureItem(s, handle);
  applyDrawPos(item, x, y, z);
  return created ? 'created-applied' : 'applied';
}

/** `0x217` pivot（`sub_4ACF20`：建项 → **无门控**写入 `+24/+28/+32`）。 */
export function scSetDrawPivot(s: SceneState, handle: number, x: number, y: number, z: number): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { item, created } = scEnsureItem(s, handle);
  applyDrawPivot(item, x, y, z);
  return created ? 'created-applied' : 'applied';
}

/** `0x1FF` 像素平移（`sub_4AC750`：建项 → 无门控 → `+0x68=1` + 平移 work 矩阵）。 */
export function scSetDrawTranslation(s: SceneState, handle: number, x: number, y: number, z: number): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { item, created } = scEnsureItem(s, handle);
  applyDrawTranslation(item, x, y, z);
  return created ? 'created-applied' : 'applied';
}

/**
 * `0x1FD` 立即缩放（`sub_4AC5F0`：建项 → **无门控** → `+0x68=1` + 缩放 **work** 矩阵）。
 * ★缺了它不会报错，只会让"靠缩放撑开的中段贴片"退回源尺寸（1px ⇒ 看不见）：
 *   CONFIG1 右侧滚动条拇指 = 上盖(27×23) + **中段(27×1，靠本条放大到 y=209)** + 下盖(27×24)。
 */
export function scSetScale(s: SceneState, handle: number, sx: number, sy: number, sz: number): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { item, created } = scEnsureItem(s, handle);
  applyDrawScale(item, sx, sy, sz);
  return created ? 'created-applied' : 'applied';
}

/**
 * `0x202` set-draw-color（`sub_4AD0C0`）：`sub_4AAA50` 建项 → **门控 `flags & 1`**
 * （元素必须已由 draw-texture 创建）→ `|=2`/`+0x34=0`/`+0x38`/`+0x4C`/`+0x64`。
 * ★项不存在时引擎**只建项、不配窗**（构造器 `flags=0`，门控必失败）。
 */
export function scSetDrawColor(s: SceneState, handle: number, delay: number, dur: number, to: number): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
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
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { item, created } = scEnsureItem(s, handle);
  applyDrawColorAlpha(item, from, blend);
  return created ? 'created-applied' : 'applied';
}

/** `0x21E` 缩放窗（`sub_4AD170`：建项 → 门控 `flags & 1`）。 */
export function scSetScaleAnim(s: SceneState, handle: number, delay: number, dur: number, sx: number, sy: number, sz: number): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { item, created } = scEnsureItem(s, handle);
  if ((item.flags & 1) === 0) return 'created-gated';
  applyScaleAnim(item, delay, dur, sx, sy, sz);
  return 'applied';
}

/** `0x21F` 旋转窗（`sub_4AD250`：建项 → 门控 `flags & 1`）。 */
export function scSetRotationAnim(s: SceneState, handle: number, delay: number, dur: number, ax: number, ay: number, az: number, deg: number): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { item, created } = scEnsureItem(s, handle);
  if ((item.flags & 1) === 0) return 'created-gated';
  applyRotationAnim(item, delay, dur, ax, ay, az, deg);
  return 'applied';
}

/** `0x220` 平移窗（`sub_4AD3C0`：建项 → 门控 `flags & 1`）。 */
export function scSetTranslationAnim(s: SceneState, handle: number, delay: number, dur: number, x: number, y: number, z: number): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { item, created } = scEnsureItem(s, handle);
  if ((item.flags & 1) === 0) return 'created-gated';
  applyTranslationAnim(item, delay, dur, x, y, z);
  return 'applied';
}

/** `0x239` flipbook 窗（`sub_4AD4A0`：建项 → 门控 `flags & 1`）。 */
export function scSetFlipbook(s: SceneState, handle: number, delay: number, dur: number, frames: number, cols: number, flags: number): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { item, created } = scEnsureItem(s, handle);
  if ((item.flags & 1) === 0) return 'created-gated';
  applyFlipbook(item, delay, dur, frames, cols, flags);
  return 'applied';
}

// ---------------------------------------------------------------------------
// DrawItem 的**查询**族（getter；两个宿主共用一份语义 ⇒ 见 `headlessScene`/`pixiBackend` 的转发）
//
// ★为什么必须共享：这三条都是**会回写操作数**的 getter（`0x215`/`0x218`/`0x21A`），
//   返回值直接进脚本的算术；两侧各写一份一旦漂移（例如漏掉 `flags & 1` 门），
//   症状是"报告里对、画面上错"或反之 —— 这正是共享场景模型要消灭的那类缺陷。
// ---------------------------------------------------------------------------

/** `0x215`（`sub_4ADC20`）：绘制项 → 纹理槽号；项不存在或未创建（`flags & 1 == 0`）⇒ **−1**（引擎原样）。 */
export function scGetDrawItemTexSlot(s: SceneState, handle: number): number {
  const it = s.drawItems.get(handle);
  return !it || (it.flags & 1) === 0 ? -1 : it.tex;
}

/** `0x218`（`sub_4ADCF0`）：绘制项 pivot 三元组；项不存在 ⇒ 全 0（引擎原样）。 */
export function scGetDrawItemPivot(s: SceneState, handle: number): { x: number; y: number; z: number } {
  const it = s.drawItems.get(handle);
  return it ? { x: it.pivotX, y: it.pivotY, z: it.pivotZ } : { x: 0, y: 0, z: 0 };
}

/** `0x21A`（`sub_4ADC80`）：绘制项描画位置三元组；项不存在 ⇒ 全 0（引擎原样）。 */
export function scGetDrawItemPos(s: SceneState, handle: number): { x: number; y: number; z: number } {
  const it = s.drawItems.get(handle);
  return it ? { x: it.posX, y: it.posY, z: it.posZ } : { x: 0, y: 0, z: 0 };
}

/**
 * `0x322` set-vertex-color（引擎 `sub_426C20` raw 33852-33885，argc=4）：
 * 读 op1=handle、op2=**entry[9]（alpha 混合模式选择子，D3D 侧消费者 `sub_49E390`；emulator 未接）**、
 * op3=alpha、op4=rgb。
 *
 * ★两个"回退"分支必须实现（早前漏掉 ⇒ 目标色完全错）：
 *  - `op3 > 255` ⇒ alpha=255；`op3 < 0` ⇒ alpha 取**当前 state0 的 alpha**；
 *  - `op4 < 0`   ⇒ rgb 取**当前 state0 的 rgb**。
 * SN0000 正是靠它把"渐显目标色"写成"当前色"：`set-vertex-color 19640 0 0 (local0)`
 * 的 `local0 = -2` ⇒ 目标 = 当前 50% 黑；若按 raw 位模式读就变成 `0x00FFFFFE`（近白），
 * 配合"全屏黑覆盖层"渲染 ⇒ 整屏黑。
 */
export function scSetVertexColor(s: SceneState, handle: number, index: number, alpha: number, rgb: number): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { mesh, created } = scEnsureMesh(s, handle);
  applyMeshVertexColor(mesh, index, vertexColorArg(mesh.state0, alpha, rgb));
  return created ? 'created-applied' : 'applied';
}
/**
 * `0x323` set-vertex-color-alpha（引擎 `sub_426CF0` raw 33888-33921，argc=5）：
 * op1=handle、op2=entry[11] 起点、op3=entry[12] 时长、op4=alpha、op5=rgb（同样有回退）。
 */
export function scSetVertexColorAlpha(
  s: SceneState,
  handle: number,
  delay: number,
  dur: number,
  alpha: number,
  rgb: number,
): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { mesh, created } = scEnsureMesh(s, handle);
  applyMeshVertexColorAlpha(mesh, delay, dur, vertexColorArg(mesh.state0, alpha, rgb));
  return created ? 'created-applied' : 'applied';
}

/**
 * `0x322`/`0x323` 的颜色实参规整（引擎 raw 33865-33884 / 33901-33921 的 clamp + 回退）。
 * 负值 = "用当前 state0 的对应通道"，>255 的 alpha 夹到 255。
 */
export function vertexColorArg(cur: number, alpha: number, rgb: number): number {
  const a = alpha > 255 ? 255 : alpha < 0 ? (cur >>> 24) & 0xff : alpha;
  const c = rgb < 0 ? cur & 0xffffff : rgb & 0xffffff;
  return (((a & 0xff) << 24) | (c & 0xffffff)) >>> 0;
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
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
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

/**
 * 逐帧驱动：推进所有 DrawItem 的 5 个窗（窗末 `work ← target`；全窗结束清动画位）。
 * ★只有**真的推进了窗**（窗末收尾 / 动画位清零）才置脏：否则每帧推进都会把 `dirty` 一直点亮，
 * 脏位就失去意义（`tickets/T-0003`）。注意窗"跑完"的那一帧要置脏 —— 求值器在 `after` 相位返回目标值，
 * 与上一帧的插值结果不同，必须再合成一次才能看到终态。
 */
export function scAdvance(s: SceneState, clock: number): void {
  for (const it of s.drawItems.values()) if (advanceWindows(it, clock)) s.dirty = true;
}

/**
 * **合成判据**：场景里是否还有动画窗在跑（mesh 全窗 + draw item **5 个窗**）。
 *
 * 为什么要问这个：引擎每 present 都把每个对象的动画求值一次，所以"还有窗在跑"就必须继续合成，
 * 否则窗口的中间帧根本不会上屏（`advanceWindows` 只在 present 里被调）。
 * 判据与推进侧共用同一份窗实现（`itemAnimationsPending` → `windowDone`）。
 *
 * ★它**不是** `0x400` 门的判据 —— 门判据见 `scGateAnimationsDone`（差别的实证见那里的注释）。
 */
export function scAnimationsPending(s: SceneState, clock: number): boolean {
  for (const m of s.meshes.values()) if (m.flags & 2 && !meshWindowDone(m, clock)) return true;
  // 极性：`itemAnimationsPending` = "**还有**窗没走完"（不需要取反）
  for (const it of s.drawItems.values()) if (it.flags & 2 && itemAnimationsPending(it, clock)) return true;
  return false;
}

/**
 * **`0x400` 等待门的放行判据**：mesh 全窗 + draw item 的**颜色窗（窗 0）**。
 *
 * ★为什么不把 draw item 的 5 个窗都算进**门**里（2026-09 实测，`tickets/T-0024` 立案）：
 *  - 序章 `src/SN0000.txt:1043` 在 `wait`(`:1048`) 的前一条给背景装了 `i220 (global-int f8023) 0 13880 0 1 0`
 *    = delay 0 / dur **0x13880 = 80 000 ms** 的**平移**窗（`0x220` = 平移动画窗，op3 就是毫秒 dur）；
 *  - 把窗 3 也算进门 ⇒ 门驻留 80 s。A/B 实测（同一份 `emulator.config.json`）：门连续 20 s 不放行、
 *    `[present …] meshes={0x19258:255/#000000…} wait=0x400` 三帧数字完全不动、日志停在进 SN0000 前；
 *    旧判据（窗 0）同一位置 5 s 内就完成淡出并进入正文（meshes 出现 17/53/124/…/255 的渐变序列）。
 *  - 引擎的真值也不是"扫所有窗"：`sub_407E20`(raw 12762-12786，主循环 raw 21111 每帧轮询) 返回的是
 *    **池挂起位 `_this[11629]`（= 字节 369348 / `46516`）** 与 **等待计时器**（`_this[11630]`=起点 369352、
 *    `_this[11631]`=时长 369356）。那个计时器由 **`0x238` 装载**（`sub_4248C0` raw 32303-32312：
 *    `Engine[92338]=0; Engine[92339]=op1` —— 正好是起点/时长两格；语料里 `i238` 的取值全是
 *    0xC8/0x1F4/0x3E8/0x7D0… 这样的整毫秒数，见 `tickets/T-0024`）。
 *    即引擎的"等几秒"主要来自 `i238 N` + `wait`，而不是"等所有动画窗"。
 *  ⇒ 完整的计时器语义（含 `sub_407EA0` 的强制冻结位 `46512`）是**已知缺口**，实现见 `tickets/T-0024`；
 *    在它落地前，这里保守保持**用户已验证**的旧口径（窗 0）——只加注释，不静默改行为。
 */
export function scGateAnimationsDone(s: SceneState, clock: number): boolean {
  for (const m of s.meshes.values()) if (m.flags & 2 && !meshWindowDone(m, clock)) return false;
  for (const it of s.drawItems.values()) if (it.flags & 2 && !windowDone(it, W_COLOR, clock)) return false;
  return true;
}

/**
 * **"这一帧该不该合成"** —— 引擎式 present 条件：`场景脏 || 仍有动画在播`。
 *
 * 为什么做成共享函数（`tickets/T-0008` 的 D3）：这条判据原先只活在 `PixiBackend.needsRender()` 里，
 * 而它**读了宿主自己的 `waitFlags` 镜像**（只置不清 ⇒ 永久为真）⇒ 既测不到（pixi 需要 WebGL/DOM），
 * 也无法被 headless 复用。现在判据在共享层：两个宿主同一份，且能在 Node 里断言。
 *
 * ★这里**没有**"命中 `0x400` 等待门"这一项：门状态的真源是 `Engine.waitFlags`，
 * 而"门等待期间持续合成"是**帧驱动**的职责（产品路径在门分支里无条件 present）。
 */
export function sceneNeedsRender(s: SceneState, clock: number, dirty: boolean): boolean {
  return dirty || scAnimationsPending(s, clock);
}
// ---------------------------------------------------------------------------
// 消息窗文本（引擎「每窗一张离屏表面 + 逐行显现」的等价物）
// ---------------------------------------------------------------------------

/**
 * **同步一个消息窗的文本内容**（引擎 `0x6E`/`0x6F`/`0x71`/`0x196` + 各属性指令的最后一步）。
 *
 * 排版在这里做（而不是宿主里）：排版规则是**引擎语义**（等宽网格 / 边界硬断 / 注音配对 /
 * 竖排 / 对齐），必须两个宿主完全一致，否则又会出现"报告说 3 行、画面画 2 行"的漂移。
 * 光栅化才是宿主的事（`pixi` 画进纹理，`headless` 只留数据进快照）。
 *
 * 返回排版结果，便于调用方诊断/断言。
 */
export function scMsgWinSync(s: SceneState, win: number, input: MsgWinInput): TextFrame {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const frame = layoutWindow(win, input);
  // 该窗的 DrawItem 区间（`0x213`/`0x25D` 登记）：`scDetachTexture` 靠它判"字该跟着消失"
  if (input.itemRanges) s.msgRanges.set(win, input.itemRanges.map((r) => ({ base: r.base, count: r.count })));
  // 字格图标（▼）：只在武装期间有（`Engine.serviceCharGrid` 每 tick 换一格后重新发布）
  if (input.cell) frame.cell = { ...input.cell };
  s.msgWins.set(win, frame);
  s.msgRev.set(win, (s.msgRev.get(win) ?? 0) + 1);
  return frame;
}

/** 清空一个消息窗（引擎 `0x85` 清行队列 / `0x301` 删绘制项区间 / `0x71` 开始新一段）。 */
export function scMsgWinClear(s: SceneState, win: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.msgWins.delete(win);
  s.msgRev.set(win, (s.msgRev.get(win) ?? 0) + 1);
}

/**
 * `0x204` draw-string：把一串文本**追加**到某个纹理槽的直绘文本表（引擎 `sub_456710` 的 GDI 直绘）。
 *
 * 语义要点：
 *  - **不清底**：引擎是往该槽**已有表面**上叠字（`create-texture` 建出来的空表面 → 叠几行字）；
 *  - **不去重**：同一个槽每帧被脚本重画时，若无 `create-texture` 先重建，字会越叠越多 ——
 *    这正是引擎的行为（`CONFIG1` 每帧先 `create-texture` 再画，所以不会叠）。
 */
export function scDrawString(s: SceneState, slot: number, x: number, y: number, text: string, fill = '#ffffff'): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const list = s.slotText.get(slot);
  if (list) list.push({ x, y, text, fill });
  else s.slotText.set(slot, [{ x, y, text, fill }]);
}

/** `0x1F8` create-texture：新建/重建该槽 ⇒ 槽上的直绘文本随之清空（引擎是新表面）。 */
export function scCreateTextureReset(s: SceneState, slot: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.slotText.delete(slot);
}

/** 全部清空（引擎 `op_exit_script` 的 `msgwin.reset()` 语义）。 */
export function scMsgWinClearAll(s: SceneState): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  for (const win of [...s.msgWins.keys()]) scMsgWinClear(s, win);
}

// ---------------------------------------------------------------------------
// A4 族（图元/网格/纹理/渲染状态，2026-09）：引擎写 Scene 字段/DrawItem 属性，
// emulator 记录进 `SceneState.render4`（渲染器可选消费，见该字段的说明）。
// ---------------------------------------------------------------------------

/** `0x1FC` 复位图元变换（`sub_4AC470`）：清该 DrawItem 的缩放/旋转/平移字段。 */
export function scResetPrimTransform(s: SceneState, handle: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.primReset = handle;
  s.render4.primTransform.delete(handle);
}

/** `0x1FE` 图元变换 4 浮点（`sub_4AC660`；**不除 100**，与 0x1FD 的缩放不同）。 */
export function scSetPrimTransform4(s: SceneState, handle: number, a: number, b: number, c: number, d: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.primTransform.set(handle, [a, b, c, d]);
}

/** `0x207` 槽→槽 StretchRect（`sub_4A3980`）：源/目标同尺寸矩形。 */
export function scBlitSlotToSlot(
  s: SceneState,
  srcSlot: number,
  dstSlot: number,
  srcRect: number[],
  dstRect: number[],
): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.blits.push({ srcSlot, dstSlot, srcRect: [...srcRect], dstRect: [...dstRect] });
  if (s.render4.blits.length > 16) s.render4.blits.shift();
}

/** `0x20E` 图形提交（`sub_41A200`）：状态 38 包裹 + 设备 `Clear(0,0,3,0,1.0,0)`。 */
export function scCommitGraphics(s: SceneState): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.commits++;
}

/** `0x224` 清转场表（`sub_41A290` → `sub_4AA180`）。 */
export function scClearTransitions(s: SceneState): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.transitionClears++;
}

/** `0x229` 绘制模式 5 元组（`sub_423FE0`：`sub_49A690` 复位 + `49A6C0`(2 int) + `49A6F0`(3 float)）。 */
export function scSetDrawModeBlock(s: SceneState, a: number, b: number, x: number, y: number, z: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.drawMode = [a, b, x, y, z];
}

/** `0x242` 写 DrawItem `+720`（`sub_4AD9A0`；同时写相邻对象的 `+504`）。 */
export function scSetDrawEntryParam(s: SceneState, entry: number, value: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.entryParams.set(entry, value);
}

/** `0x256` 按 id 找 DrawItem 并写 2 int + 3 float（`sub_4ACD10`）。 */
export function scSetSlotParams(s: SceneState, slot: number, a: number, x: number, y: number, z: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.slotParams.set(slot, [a, x, y, z]);
}

/** `0x321` MeshEntry 属性（`sub_4AE280`：`entry[op2 + 7] = op3`）。 */
export function scSetMeshEntryAttr(s: SceneState, mesh: number, index: number, value: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  let m = s.render4.meshAttrs.get(mesh);
  if (!m) {
    m = new Map<number, number>();
    s.render4.meshAttrs.set(mesh, m);
  }
  m.set(index, value);
}

/** `0x32A` 释放 3D 模型槽（`sub_4A0750`：析构 + delete + 置 0）。 */
export function scRelease3DSlot(s: SceneState, slot: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.released3D.push(slot);
  s.meshes.delete(slot);
}

/** `0x32D` 3D 颜色（`sub_499DF0`：四分量各 ÷255 后下发）。 */
export function scSet3DColor(s: SceneState, r: number, g: number, b: number, a: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.color3D = [r, g, b, a];
}
