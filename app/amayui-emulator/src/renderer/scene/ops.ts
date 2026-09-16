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
  calcDiffuse,
  itemAnimationsPending,
  meshWindowDone,
} from '../drawItem.js';
import type { SceneState } from './state.js';
import { layoutWindow, type MsgWinInput, type TextFrame } from '../../text/layout.js';
import { l2dAdvance, l2dNodeDrawable } from '../../live2d/runtime.js';

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

/**
 * `i214`（`0x214`，`sub_423AE0` → `sub_4ABEF0` raw 131084-131143）：**交换两条绘图项记录**。
 *
 * 引擎（"两张都在" 的分支，raw 131135-131139）：
 * ```
 * qmemcpy(record(a2), record(b2), 0x2E4);   // 整块 740 字节互换
 * qmemcpy(record(b2), v15（= 原 a2 的记录）, 0x2E4);
 * obj[11627] = 1;                           // ★置脏位
 * ```
 * ⇒ **键（handle）不动、记录内容整份互换**：纹理槽 `+4`、源矩形 `+8..+20`、描画位置 `+36..+44`、
 * pivot、5 个动画窗、颜色、矩阵、flipbook… 全换。★`draw-texture` 的 `sub_4ACE50`（raw 131817-131840）
 * 写的就是这些格，**没有**把 handle/层序写进记录（层序 = map key，见 `draw-texture` 的 handler 注释）
 * ⇒ 交换后两图的**绘制次序不变**，换的是"长什么样、画在哪"。
 *
 * 缺键的分支（raw 131103-131132）：先 `sub_40C910` 建一条**全 0 记录**（flags 无 bit0 ⇒ 不画）再搬 ⇒
 * 等价于"与一条空记录交换"；**两个键都不存在**时引擎只置脏位、什么都不搬。
 * ★只碰**绘图项表**（Scene+1032 = `_this+258` dwords）；网格表（+1064 = `+266`）不动 ——
 * 这一点与 `0x21D` CopyScene（两张表都拷）不同。
 *
 * 语料 229 处的用法：ADV 脚本的收场块把两套立绘句柄基址（`global f8023..f8028`）里第 i 个
 * **互换**，紧接着把脚本自己的记账表 `3f54` 的两列也换掉（`$1$SC0330.txt:6324-6336`、`SC0000.txt:6885-6895` 等同型）。
 *
 * emulator 实现：**原地交换字段**（保留两个 `Item` 对象的身份）—— 渲染侧按 handle 缓存的资源
 * 不必失效，语义与引擎"记录内存原地互拷"一致；`handle`/`layer`（= map key）不参与交换。
 */
export function scSwapItems(s: SceneState, a: number, b: number): boolean {
  s.dirty = true; // ★引擎两条分支都置 _this[11627] = 1
  if (a === b) return false; // 同一个键：引擎两次 memcpy 互相覆盖，净效果不变
  const ia = s.drawItems.get(a) ?? makeDefaultItem(a); // 引擎缺键 ⇒ 先建全 0 记录（sub_40C910）
  const ib = s.drawItems.get(b) ?? makeDefaultItem(b);
  const had = s.drawItems.has(a) || s.drawItems.has(b);
  s.drawItems.set(a, ia); // 缺键分支也把建出来的记录落进表（引擎 sub_4AAD40 会插入）
  s.drawItems.set(b, ib);
  const snap = { ...ia }; // ia 的字段快照（嵌套对象引用随之转手，两边各自独占）
  const ka = a;
  const kb = b;
  Object.assign(ia, ib, { handle: ka, layer: ka });
  Object.assign(ib, snap, { handle: kb, layer: kb });
  return had;
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
  // ★**mesh 的窗末收尾也在这里**（`tickets/T-0004` 的 G3 实测修）：mesh 没有 `advanceWindows` 那样的
  //   推进器，它的"求值 + 窗末收尾（`state0 ← state1`、清 bit1）"全在 `calcDiffuse` 里
  //   （引擎 raw 133531-133538）。修前只有 **pixi 的 `present`**（`presenter.ts:130/201`）会调它 ⇒
  //   Electron 的幕布在窗末被"烘焙"，headless 的不会 ⇒ 两宿主的 `state0` 从"幕布淡完那一帧"起分叉
  //   （G3 实测：Electron 录到 `state0=#00000000`，回放得到 `#ff000000`）。
  //   现在两宿主都经 `advanceModel` → 同一个 `scAdvance` ⇒ 同一份状态；`present` 只负责画。
  for (const m of s.meshes.values()) {
    if ((m.flags & 2) === 0) continue;
    const before = m.state0;
    calcDiffuse(m, clock); // 求值（并锁存 `w.start`）+ 窗末收尾
    // 窗跑完那一帧必须置脏：`scAnimationsPending` 此刻已为假，不置脏就不会再合成一次终态。
    if (m.state0 !== before || (m.flags & 2) === 0) s.dirty = true;
  }
}

/**
 * **合成判据**：场景里是否还有动画窗在跑（mesh 全窗 + draw item **5 个窗**）。
 *
 * 为什么要问这个：引擎每 present 都把每个对象的动画求值一次，所以"还有窗在跑"就必须继续合成，
 * 否则窗口的中间帧根本不会上屏（`advanceWindows` 只在 present 里被调）。
 * 判据与推进侧共用同一份窗实现（`itemAnimationsPending` → `windowDone`）。
 *
 * ★它**不是** `0x400` 门的判据 —— 门判据见 `scPoolPending`（差别的实证见那里的注释）。
 */
export function scAnimationsPending(s: SceneState, clock: number): boolean {
  for (const m of s.meshes.values()) if (m.flags & 2 && !meshWindowDone(m, clock)) return true;
  // 极性：`itemAnimationsPending` = "**还有**窗没走完"（不需要取反）
  for (const it of s.drawItems.values()) if (it.flags & 2 && itemAnimationsPending(it, clock)) return true;
  return false;
}

/**
 * **池挂起位 `Scene+46516`** —— `0x400` 门的"挂起"半边（`tickets/T-0024`）。
 *
 * 引擎依据（逐行读 `engine/天结_unpacked.exe_utf8.c`）：
 *  - **置位**：绘制期发现"还有元素在动"就置 1
 *    - DrawItem 路径 `sub_49AA30` raw 117843-117844：本项的窗没走完（`v115 != 0`）**且**
 *      `DrawItem+720` 的 **bit0 为 0** ⇒ `Scene[46516] = 1`；
 *    - 转场/网格路径 raw 133528 / 135822 / 136197 / 136691-136701：窗未到 `start + delay + dur` 时置 1；
 *  - **清零**：每遍绘制开头 raw 130427-130428（`46512 = 0; 46516 = 0`）
 *    ⇒ 本位是**逐遍瞬时量**："**上一遍绘制**时还有没有东西在动"，正是主循环 raw 21111 门判据要读的东西；
 *  - **强制冻结** `Scene+46512`（`sub_407EA0` raw 12796 置 1）：为 1 时所有窗立刻算结束
 *    （raw 134941 / 135806 / 136182 的 `… || *(_DWORD *)(_this + 46512) == 1` ⇒ 窗收尾）⇒ 不再置本位。
 *    驱动把这一条折进锁存（`loop.ts`：`e.scenePending = !e.sceneFreeze && host.poolPending()`）。
 *
 * ★★**门不再有自己的一套"扫几个窗"口径**：门 = `0x238` 装载的等待计时器（`Engine.gatePending`）+ 本位。
 *   长时平移窗之所以**不**钉住门，不是"门不看平移窗"，而是脚本用 **`i242 <handle> 1`**（= `+720` bit0）
 *   把它排除出本位 —— `src/SN0000.txt:1043-1048` 就是 `i220 f8023 0 13880 …`（80 000 ms 慢推）
 *   + `i242 f8023 1` + `i238 64` + `wait`。这一格同时让该动画**不被玩家"跳过"截断**（raw 117440-117442）。
 *
 * 与 `scAnimationsPending`（合成判据）的区别：那一条问"要不要继续画"（不看 `+720`，因为慢推本身要出画面），
 * 本位问"引擎要不要卡在等待门"（看 `+720`）。守卫：`test/wait-gate-timer.test.ts`、`test/anim-window-done.test.ts`。
 */
export function scPoolPending(s: SceneState, clock: number): boolean {
  for (const m of s.meshes.values()) if (m.flags & 2 && !meshWindowDone(m, clock)) return true;
  for (const it of s.drawItems.values()) {
    if ((it.flags & 2) === 0) continue;
    if ((it.entryParam & 1) !== 0) continue; // raw 117843-117844：`+720` bit0 ⇒ 本项不置池挂起位
    // 极性：`itemAnimationsPending` = "**还有**窗没走完"（不需要取反）
    if (itemAnimationsPending(it, clock)) return true;
  }
  return false;
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

/**
 * `0x242` 写 DrawItem `+720`（`sub_4251A0` raw 32649-32658 → `sub_4AD9A0` raw 132346-132361）。
 *
 * 引擎：`sub_4AAA50(Scene, op1)`（**缺失即建项**）→ `sub_4AAD40(...)+720 = op2`，
 * 随后还把**另一个对象**（`Scene+1080` 那张表的项）的 `+504` 写成同一个值（本层记为 `render4.entryParam` 台账）。
 *
 * ★`+720` 的 **bit0 = "此项动画不参与等待门"**（`sub_49AA30` raw 117843-117844）——
 * `i242 <handle> 1` 就是序章排除 80 000 ms 慢推的手段，见 `scPoolPending` 与 `tickets/T-0024`。
 */
export function scSetDrawEntryParam(s: SceneState, entry: number, value: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  // 引擎 `sub_4AAA50` 的"缺失即建项"：建出来的项 `flags = 0`（尚不可绘制），字段仍然照写。
  const it = s.drawItems.get(entry) ?? makeDefaultItem(entry);
  s.drawItems.set(entry, it);
  it.entryParam = value; // `+720`：位 0 = 不参与池挂起位 / 豁免强制冻结
  s.render4.entryParams.set(entry, value); // 相邻对象 `+504` 的台账（宿主侧无该对象类型 ⇒ 只记）
}

/**
 * `0x256` **按 id 区间立即平移**（`sub_425C30` → `sub_4ACD10`，raw 33120 / 131733）。
 *
 * 引擎体（逐行核对）：
 * ```
 * v9  = lower_bound(items, op1)            // 区间左端 = 第一个 id ≥ op1 的项
 * v19 = lower_bound(items, op1 + op2)      // ★op2 是 **count**（区间 [op1, op1+op2)），不是"某个参数"
 * for (v = v9; v != v19; v = next(v)) {
 *     it = find(v.id);  *(it + 104) = 1;                        // +0x68「用世界矩阵」
 *     D3DXMatrixTranslation(it + 364, f3, f4, f5);              // +0x16C = 平移 **work** 矩阵（立即）
 *     Scene[11627] = 1;                                         // 置脏
 * }
 * ```
 * ⇒ 语义 = **对区间内已存在的绘制项做一次立即平移**（与 `0x1FF` 单参版同一原语，区别只是区间 + 只碰已存在项）。
 *
 * ★为什么必须真做（`tickets/T-0028`）：这是"收起侧边栏"的**唯一静态摆位手段** ——
 *   `DRAWCHARM.txt:182-186` 在 `global 1399 == 1`（收起）时对 `0x19835` 起 0x15 个槽执行
 *   `i256 <槽> 15 6e 0 0`（+110px 推到屏右外）；只记录不生效 ⇒ 任何一次重绘（进场景/翻页）都会把
 *   侧边栏画回基准位 `x=0x49c`（= 看起来"被 hover 展开"）。LOCK（`global 139a != 0` ⇒ `1399 = 2`）
 *   会跳过这条分支 ⇒「无视 hover 始终展开」。
 */
export function scSetSlotParams(
  s: SceneState,
  handle: number,
  count: number,
  x: number,
  y: number,
  z: number,
): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  // A4 族的"记录"仍然保留（报告/digest 的 `render4.slotParams` 要能看到脚本下发的原值）。
  s.render4.slotParams.set(handle, [count, x, y, z]);
  // ★应用：只碰**已存在**的项（引擎是容器区间遍历 ⇒ 不会凭空建项），逐项写 work+target 平移。
  let applied = 0;
  for (let h = handle; h < handle + Math.max(0, count); h++) {
    const it = s.drawItems.get(h);
    if (!it) continue;
    applyDrawTranslation(it, x, y, z);
    applied++;
  }
  return applied > 0 ? 'applied' : 'created-gated';
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

/**
 * `0x20D` **设置渲染目标**（`sub_423770` raw 31594-31602 → `sub_4A50C0` raw 124819-124912）：
 * `op1` = 纹理槽（引擎里 `-1` = 回到后台缓冲；`sub_4A50C0(…, 0xFFFFFFFF)` 就是这个语义）。
 *
 * ★**不是普通记录**：它决定 `0x203`/`0x322` 混合选择子**值 2 的门控**（见 `scene/blend.ts`）
 * —— 只有"当前渲染目标槽的纹理是 mode-1 离屏表面"时才用 `(ONE,ZERO)` 覆盖。
 */
export function scSetRenderTarget(s: SceneState, slot: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.renderTargetSlot = slot;
}

/**
 * `0x1F8` create-texture 的 op4 = 该槽的**创建模式**（引擎 `sub_4A2C10` → `sub_48AC40` raw 107026
 * 写 `CTexture+1048`）。mode 1/2 = `Usage=D3DUSAGE_RENDERTARGET` + `Pool=DEFAULT`（离屏渲染目标），
 * 其余 = MANAGED 普通纹理。混合门控只认 **1**（raw 123111 / 119381 的 `== 1`）。
 */
export function scSetSlotMode(s: SceneState, slot: number, mode: number): void {
  // ★它也影响画面：mode 1 是"值 2 混合门控"的成立条件（`scene/blend.ts`）⇒ 与其它变更型 op 一样置脏。
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.slotModes.set(slot, mode);
}

/**
 * `0x32`（`i032`，`sub_41E2D0` → `sub_4A87A0` raw 127933-128129，引擎里叫 **StretchTexture**）：
 * **两个矩形按比例夹取到各自 surface 的边界内**（一侧被夹时另一侧**按比例跟随**）。
 *
 * 引擎逐句（raw 128005-128097）：
 * ```
 * v16 = srcW / dstW;                       // 横向比例（dst 侧被夹时用来挪源码）
 * if (dst.x1 < dstSurface.x1) { src.x1 += (dstSurface.x1 - dst.x1) * v16; dst.x1 = dstSurface.x1; }
 * if (dst.x2 > dstSurface.x2) { src.x2 += v16 * (dstSurface.x2 - dst.x2); dst.x2 = dstSurface.x2; }
 * v21 = srcH / dstH;                       // 纵向同理
 * ... 然后对**源** surface 做同一件事（夹源码时按比例挪目标码）
 * ```
 * ★夹取的位移量与引擎一样**先 `(int)` 截断再加回**（矩形在引擎里就是 int，raw 128016/128023/128032/128039…）。
 * ⇒ 传入的矩形是 `[x1, y1, x2, y2]`（**不是 w/h**），surface 边界 = `[0, 0, w, h]`（`create-texture` 给的尺寸）。
 * 返回 `null` = 退化输入（宽或高 ≤ 0 ⇒ 引擎会除零得 inf/nan，这里显式判掉、不转送）。
 */
export function clampScaledBlit(
  srcBounds: [number, number, number, number],
  dstBounds: [number, number, number, number],
  srcRect: [number, number, number, number],
  dstRect: [number, number, number, number],
): { src: [number, number, number, number]; dst: [number, number, number, number] } | null {
  const src = [...srcRect] as [number, number, number, number];
  const dst = [...dstRect] as [number, number, number, number];
  const dstW = dst[2] - dst[0];
  const dstH = dst[3] - dst[1];
  const srcW0 = src[2] - src[0];
  const srcH0 = src[3] - src[1];
  if (dstW <= 0 || dstH <= 0 || srcW0 <= 0 || srcH0 <= 0) return null;
  // ① 目标矩形夹到目标 surface（源码按比例跟随）
  const kx = srcW0 / dstW;
  if (dst[0] < dstBounds[0]) {
    src[0] += Math.trunc((dstBounds[0] - dst[0]) * kx); // 引擎 `(int)(…)` 截断（矩形是 int）
    dst[0] = dstBounds[0];
  }
  if (dst[2] > dstBounds[2]) {
    src[2] += Math.trunc(kx * (dstBounds[2] - dst[2]));
    dst[2] = dstBounds[2];
  }
  const ky = srcH0 / dstH;
  if (dst[1] < dstBounds[1]) {
    src[1] += Math.trunc((dstBounds[1] - dst[1]) * ky);
    dst[1] = dstBounds[1];
  }
  if (dst[3] > dstBounds[3]) {
    src[3] += Math.trunc(ky * (dstBounds[3] - dst[3]));
    dst[3] = dstBounds[3];
  }
  // ② 源矩形夹到源 surface（目标码按比例跟随）
  const srcW = src[2] - src[0];
  const srcH = src[3] - src[1];
  if (srcW <= 0 || srcH <= 0) return null;
  const bx = (dst[2] - dst[0]) / srcW;
  if (src[0] < srcBounds[0]) {
    dst[0] += Math.trunc((srcBounds[0] - src[0]) * bx);
    src[0] = srcBounds[0];
  }
  if (src[2] > srcBounds[2]) {
    dst[2] += Math.trunc(bx * (srcBounds[2] - src[2]));
    src[2] = srcBounds[2];
  }
  const by = (dst[3] - dst[1]) / srcH;
  if (src[1] < srcBounds[1]) {
    dst[1] += Math.trunc((srcBounds[1] - src[1]) * by);
    src[1] = srcBounds[1];
  }
  if (src[3] > srcBounds[3]) {
    dst[3] += Math.trunc(by * (srcBounds[3] - src[3]));
    src[3] = srcBounds[3];
  }
  if (src[2] - src[0] <= 0 || src[3] - src[1] <= 0 || dst[2] - dst[0] <= 0 || dst[3] - dst[1] <= 0) return null;
  return { src, dst };
}

/** `0x33F` op1 = 场景默认混合选择子（引擎 `Scene+1260`；消费点 `sub_4535F0` raw 65858-65889）。 */
export function scSetSceneBlend(s: SceneState, blend: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.sceneBlend = blend;
}

/**
 * **每帧推进 Live2D 动作**（= 引擎"绘制 572B 节点那一次调用"里的 `sub_4BCB50`）。
 *
 * ★为什么是"共享层的一个 tick"而不是各宿主自己算：引擎里**动作推进与出画是同一次调用**
 * （`sub_4B0360` → `sub_4783D0`；能力条目 `live2d-node-draw-advance`，raw 92578-92615），
 * 而且**只有"这一帧真的要画的节点"才推进** —— 槽空/节点没建的 L2D 不消耗时间轴。
 * 两个宿主（Pixi / headless）都必须经这里推进，否则"报告里的立绘"与"画面上的立绘"会处在
 * 动作时间轴的不同位置（同类漂移见 `sceneModel.ts` 顶部）。
 *
 * @param nowMs 本帧时钟（与 `scAdvance` 同一个 `clockMs`；`dirty` 由本函数自己置）
 * @returns 参与本帧推进的节点 key（诊断/报告用；空数组 = 本帧没有可画的 L2D 节点）
 */
export function scL2dTick(s: SceneState, nowMs: number): number[] {
  const host = s.l2dHost;
  if (!host) return [];
  const delta = s.l2dLastMs < 0 ? 0 : Math.max(0, nowMs - s.l2dLastMs);
  s.l2dLastMs = nowMs;
  if (delta === 0) return [];
  // 只有"这一帧真的会画"的节点才推进（引擎同一条门控：槽里得有模型）
  const drawn = [...host.l2dNodes.values()].filter((n) => l2dNodeDrawable(host, n)).map((n) => n.key);
  if (drawn.length === 0) return [];
  const overrides = l2dAdvance(host, delta, drawn);
  if (overrides.size > 0) s.dirty = true;
  return drawn;
}
