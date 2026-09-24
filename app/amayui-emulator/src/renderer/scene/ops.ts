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
  applyColorLoop,
  applyDrawColor,
  applyDrawColorAlpha,
  applyDrawItemLoopReset,
  applyDrawPivot,
  applyDrawPos,
  applyDrawScale,
  applyDrawTranslation,
  applyFlipbook,
  applyFlipbookLoop,
  applyMeshVertexColor,
  applyMeshVertexColorAlpha,
  applyPrimAxisRotation,
  applyRotationAnim,
  applyRotationLoop,
  applyScaleAnim,
  applyScaleLoop,
  applyTranslationAnim,
  applyTranslationLoop,
  cgDigitItems,
  cloneItem,
  cloneMesh,
  makeDefaultItem,
  makeItem,
  makeMesh,
  advanceWindows,
  calcDiffuse,
  freezeWindow,
  itemAnimationsPending,
  itemLoopAnimationsPending,
  meshWindowDone,
  resetItemTransform,
} from '../drawItem.js';
import type { SceneState } from './state.js';
import type { SceneXform, SceneXformKind } from './state.js';
import { layoutWindow, type MsgWinInput, type TextFrame } from '../../text/layout.js';
import { l2dAdvance, l2dComposeNodeAt, l2dNodeDrawable, l2dNodeWindowsPending } from '../../live2d/runtime.js';
import { scTransitionsPending } from './transition.js';
import {
  ensureEffect3DSlots,
  ensureSharedEffect3D,
  weatherAdvance,
  weatherCreate,
  weatherDestroyAll,
  weatherNodeKey,
  weatherSetDestroyThresholds,
} from './weather.js';
import { SCENE_SCRATCH_SLOT_A, SCENE_SCRATCH_SLOT_B, sceneScratchMode } from './effectLevel.js';

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
  // ★"这一项是谁画的"是**覆盖语义**：每次 draw-texture 都刷新（与引擎覆盖整块元素同口径）。
  //   显式给的优先；否则用**当前帧**（VM 每步下发的 `s.currentFrame`）—— 这样"哪些项属于上一屏"
  //   对**所有**建项路径都成立，而不只是带 `ownerFrame` 的那一条（`tickets/T-0083` 的 (B) 步）。
  const owner = cfg.ownerFrame ?? s.currentFrame;
  if (owner >= 0) it.ownerFrame = owner;
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
  if (s.currentFrame >= 0) it.ownerFrame = s.currentFrame; // 见 `SceneState.currentFrame`
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
 *
 * ★2026-09-24（`tickets/T-0144` 的 D1）：**还要擦 572B 立绘节点表** —— 引擎 `0x1F7` 的两条路径
 * 都按 key 从 `Scene+1032`/`+1064`/`+1080`/`+1096` **四张表**擦（单条 raw 130825-130837：`sub_4A9D70`
 * 加 `sub_4A9270`；区间 raw 130909 / 131002 / 「131044」 / 「131077」：`sub_4AA1D0` / `sub_4AA330` /
 * `sub_4AA3D0(+270)` / `sub_4AA3D0(+274)`）⇒ 命中区间内的立绘节点**必须一起没了**（出画门只遍历表里
 * 已有的节点，见 `sub_4B0360` raw 134316-134320）。**实例槽不动**（那是 `0x342`/读档装载段的事）。
 */
export function scDetachTexture(
  s: SceneState,
  handle: number,
  count: number,
): { drawItems: number; meshes: number; nodes: number; clearedWins: number[] } {
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
  // ★0x1F7 的第三条/第四条：572B 立绘节点表（emulator = `Engine.l2dNodes`，键 = `0x344` 的 op1）
  const nodes = clearL2dNodes(s, (k) => k >= handle && k < hi);
  // 窗的正文/注音图元区间被删光 ⇒ 该窗在画面上不该再有字
  const clearedWins: number[] = [];
  for (const [win, ranges] of s.msgRanges) {
    if (!ranges.some((r) => r.count > 0 && r.base < hi && r.base + r.count > handle)) continue;
    if (!s.msgWins.has(win)) continue;
    scMsgWinClear(s, win);
    clearedWins.push(win);
  }
  return { drawItems, meshes, nodes, clearedWins };
}

/**
 * **擦 572B 立绘节点表**里的节点（引擎 `Scene+1096`；emulator = `Engine.l2dNodes`）。
 *
 * ★为什么放在这里：引擎 `0x1F6`/`0x1F7`/`0x21D` 都动**四张表**（DrawItem 1032 / MeshEntry 1064 /
 * 572B-A 1080 / 572B-B **1096 = 立绘节点**），而 emulator 早先只做了前两张 ⇒ 上一屏的立绘节点活过拆场
 * （症状：新游戏路径 TITLE 的 Live2D 立绘残留在章节切换处；读档路径靠 `save-slot.ts` 的补丁遮住）。
 * 证据与验收：`tickets/T-0144`；引擎体 raw 130699 / 130764 / 「130765」 / 「130766」、
 * 130825-130837 / 「131044」 / 「131077」、131241-131249（`0x21D` 也拷这张表）。
 *
 * ★只删**节点**，**不碰 10 个实例槽**（`l2dSlots`）—— 引擎侧清槽只发生在 `0x342` 与读档装载段
 * （`sub_410160` raw 19387-19388），拆场不清槽是常态。
 */
export function clearL2dNodes(s: SceneState, pred: (key: number) => boolean): number {
  const nodes = s.l2dHost?.l2dNodes;
  if (!nodes) return 0;
  let n = 0;
  for (const key of [...nodes.keys()]) {
    if (!pred(key)) continue;
    nodes.delete(key);
    n++;
  }
  if (n > 0) s.dirty = true;
  return n;
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
export function scCopyItem(
  s: SceneState,
  srcHandle: number,
  dstHandle: number,
): { copied: boolean; drawItem: boolean; mesh: boolean; node: boolean } {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const srcItem = s.drawItems.get(srcHandle);
  const srcMesh = s.meshes.get(srcHandle);
  // ★2026-09-24（`tickets/T-0144` 的 D1）：引擎 `0x21D` 拷的是**三张表**（1032/1064/**1096**）——
  //   raw 131241-131248 用 `sub_4AACA0` 保证目标节点存在后 `qmemcpy(dst, src, 0x23C)` 整块拷；
  //   而"源不存在"的报错要求**三张表全空**（raw 131249）⇒ 只命中立绘节点也算命中。
  const srcNode = s.l2dHost?.l2dNodes.get(srcHandle);
  if (!srcItem && !srcMesh && !srcNode) return { copied: false, drawItem: false, mesh: false, node: false };
  if (srcItem) s.drawItems.set(dstHandle, cloneItem(srcItem, dstHandle));
  if (srcMesh) s.meshes.set(dstHandle, cloneMesh(srcMesh, dstHandle));
  let node = false;
  if (srcNode && s.l2dHost) {
    const copy = structuredClone(srcNode);
    copy.key = dstHandle;
    s.l2dHost.l2dNodes.set(dstHandle, copy);
    node = true;
  }
  return { copied: true, drawItem: !!srcItem, mesh: !!srcMesh, node };
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

/**
 * **丢掉"某一帧画的"绘制项**（`tickets/T-0083` 的 (B) 步；**降级为 fallback**，见下方订正）。
 *
 * ★2026-09 订正：引擎装载路径**真的会整批替换绘制项**（`sub_410160` raw 19810-19832：先 delete-walk
 * 清 `Scene+1032`、再从存档 body 的 740 B 记录清单逐条插回）⇒ 引擎真槽读档**不需要**这个近似
 * （`engineSlot.ts` 的 `drawItems` 一解出来就走 `scRestoreDrawItems`）。本函数只剩两种场合：
 *  ① **实测**：本工程自己的槽（`format = 0`）与旧布局（`sv1 = 1/2`）的 body 里没有那份清单；
 *  ② 清单**解析失败**（`drawItems === null`）—— 那时宁可留着上一屏，也不清空。
 *
 * 引擎依据（raw 9958-9971）：`sub_403EF0` 对一个 仮想ディスプレイ 对象只做
 * `_this[258] = 0`（**项数清零**）、`_this[959] = -1`、`_this[960] = 0`、`_this[7464/7466/7467/7468] = 0/-1`，
 * 构造函数 `sub_403F40` 另加几个 `SetRectEmpty` —— 装载路径在 raw 19913-19915 对
 * `Engine+51904`/`Engine+21976` 各调一次 ⇒ 那一层 UI 不再组成（**注意**：那两次复位的是
 * 「仮想ディスプレイ」（点击热点/路由表 + 游标），不是绘制项容器 —— `tickets/T-0083` 的以体订正）。
 *
 * emulator 是单一扁平绘制表、没有"平面"对象 ⇒ 用 `Item.ownerFrame`（谁画的）近似"哪一层"：
 * 被读档放弃的那个**调用方帧**画出来的项 = 那一层，装载点把它们丢掉。
 */
export function scDropFrameItems(s: SceneState, frame: number): { items: number; handles: number[] } {
  const handles: number[] = [];
  for (const [h, it] of s.drawItems) if (it.ownerFrame === frame) handles.push(h);
  for (const h of handles) s.drawItems.delete(h);
  if (handles.length > 0) s.dirty = true;
  return { items: handles.length, handles };
}

/**
 * **用存档里的绘制项清单整批替换绘制项**（`tickets/T-0083`）—— 引擎 `sub_410160` raw 19810-19832 的等价物。
 *
 * 引擎那一段的两半：① delete-walk 释放 `Scene+1032`（那个 map）的全部结点、复位哨兵、`size = 0`；
 * ② 对清单每条 `sub_49A300`-式默认构造 + `memcpy` 740 B + `sub_40C910`/`sub_40C310` 插入。
 * ⇒ 语义就是"**先清后装**"（与 `scRestorePresent` 同型），所以这里也一次做完，不拆成两个宿主调用。
 *
 * ★**只碰绘制项**：引擎的清场只走 `Scene+1032` 那棵树（`*(a1+323868)`），**网格容器（`Scene+1064`）
 * 一个结点都不动** ⇒ 本函数**不**调 `scClearMeshSlots`（这正是它不能直接用 `scClearDrawContainer`
 * 的原因 —— 后者会把网格一起清掉，与体不符）。文本窗另有 `scMsgWinClearAll`，而装载点的 ③ 步
 * 本来就会 `msgwin.reset()` + `msgWinClearAll`，这里不重复。
 */
export function scRestoreDrawItems(s: SceneState, items: readonly Item[]): { cleared: number; installed: number } {
  const cleared = s.drawItems.size;
  // ★与 `scConfigureDrawItem` 同一道闸（`assertFlags`）：还原出来的 flags 也是从字节里读的，
  //   读错一个偏移就会变成"不认识的位" ⇒ 这里**硬中断**比静默画错好（真槽 79 的 69 条只有 0b001/0b011）。
  for (const it of items) assertFlags('drawitem', it.handle, it.flags);
  s.drawItems = new Map(items.map((it) => [it.handle, it])); // 先清后装（引擎同：清容器 → 逐条插回）
  s.dirty = true;
  return { cleared, installed: s.drawItems.size };
}

/**
 * `0x1F6` clearDrawContainer：整批释放绘制项 + 网格 + **572B 立绘节点**（**保留纹理槽**）。
 *
 * ★2026-09-24（`tickets/T-0144` 的 D1）：引擎 `sub_4AB7A0` 清的是**四张表** ——
 * `Scene+1032` DrawItem（raw 130699）/ `Scene+1064` MeshEntry（raw 130764）/
 * **`Scene+1080` 572B-A**（raw 130765）/ **`Scene+1096` 572B-B = Live2D 立绘节点表**（raw 130766）。
 * 早先只清前两张 ⇒ TITLE 的立绘节点（key `0x14`）活过 TITLE 退场（`src/TITLE.txt:810` 的 `i1f6`）
 * 与之后每一次拆场。⇒ 这里补上立绘节点表；**10 个实例槽不动**（引擎的 `0x1F6` 也不动它们）。
 */
export function scClearDrawContainer(s: SceneState): { drawItems: number; meshes: number; nodes: number } {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const drawItems = s.drawItems.size;
  const meshes = s.meshes.size;
  s.drawItems.clear();
  s.meshes.clear();
  // ★572B 立绘节点表（`Scene+1096`）：整批清（`sub_4A9D10(v1 + 274)` raw 130766）
  const nodes = clearL2dNodes(s, () => true);
  // ★文本窗也要清：引擎 D3D 路径下正文行**就是** Scene 的 DrawItem（id = 行号 + win+104），
  //   `sub_4AB7A0` 清整张 DrawItem 表时它们一起没；GDI 路径下会被重画的画面盖掉。
  //   漏掉这一步的症状：**回到标题/主界面后，上一页的消息文字又画在主界面之上**（2026 实测）。
  scMsgWinClearAll(s);
  return { drawItems, meshes, nodes };
}

/**
 * `0x32B`（`sub_41A4A0` raw 25411）：**清 D3DX 网格层级槽表**（`Scene+50708` 区，1000 槽）。
 *
 * 引擎逐项 `sub_4A0750 → sub_479A50` + delete 释放那些网格对象（与 `0x23D`/`0x259` 都不同族）。
 * emulator 的网格对象就在 `scene.meshes` 里 ⇒ 等价物 = 整表清掉（真语料唯一调用点是
 * `src/TITLE.txt:810-814` 的标题界面收尾：`i1f6` → release-texture → `i23d` → **`i32b`** → `ret`）。
 */
export function scClearMeshSlots(s: SceneState): number {
  const n = s.meshes.size;
  s.meshes.clear();
  s.dirty = true;
  return n;
}

/*
 * ★口径纠错（`tickets/T-0063`）：`0x259`（`sub_41A3A0` raw 25357-25376）**不是**"清绘制记录" ——
 * 它的引擎体就是一趟 `v2 = 1000` 的循环，把主/影两张槽表（`_this[81176]`/`[86176]`，步长 5 dword）
 * 每条的 **[0]/[1] 两个 dword 清 0**：
 * ```c
 * result = _this + 86176;
 * do { *(result - 5000) = 0; *result = 0; *(result - 4999) = 0; result[1] = 0;
 *      result += 5; --v2; } while (v2);
 * ```
 * ⇒ 清的是**槽记录**（"槽 → 统一文件 id"那一格 + 邻居），**不碰绘制项、也不 delete 纹理对象**
 * （引擎绘制走 CTexture 对象表 `_this[op2+94672]`，与这份记录无关 ⇒ 清记录**不会**让画面空掉）。
 * 本仓一度把它实现成"清 `scene.drawItems`"，于是每个 ADV 场景入口的 `i259`（`src/SN0000.txt:7`、
 * 语料 517 处）会把**刚画好的场景**一起清掉 ⇒ 读档后屏幕上什么都不剩（GUI 的留帧机制继续显示上一屏
 * = 玩家看到的"回到标题界面"）。宿主侧的落实见 `TextureCache.clearSlotRecords` / `HeadlessScene.clearSlotRecords`。
 */

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
// **`Item.flags` bit2（B 层：周期/循环动画层）** —— opcode `0x230`–`0x235` 的写入端。
//
// 与上面 A 层（`0x202`/`0x21E`/`0x21F`/`0x220`/`0x239`）的**三处关键差异**（依据 = 逐条读体）：
//  ① **没有 `flags & 1` 门控** ⇒ 项不存在时会建一个 `flags = 0`（bit0 未置 ⇒ 不可见）的项并把动画配上，
//     **不报错**（`sub_4AAA50` 的缺失即建项；三个写入端 raw 132227 / 132248 / 132272 / 132299 / 132328
//     都没有 `& 1` 判断）⇒ 返回 `'created-applied'` 而不是 `'created-gated'`；
//  ② 各通道的"起点槽"（`+524/528/532/536/540`）在写入时清 0 ⇒ **下一帧求值锁存 now**（重新计时），
//     名字上像 delay 但**不是** delay（对比 A 层的 `+56..+72` 才是 delay）；
//  ③ 波形与 A 层不同：颜色/缩放/平移是**三角波往复**，旋转是**每周期一圈的锯齿**，贴图换格是
//     **单调递增再取模**（不是保持末帧）。
//
// 消费端 = `drawitem/eval.ts`（`flags & 4` 门 + 每通道 `period > 0` 门）；
// 与等待门**无关**（池挂起位 `Scene+46516` 只在 A 层路径置位）⇒ 见 `scAnimationsPending` 的说明。
// ---------------------------------------------------------------------------

/**
 * `0x230`（`sub_4243B0` raw 32105-32113 → `sub_4AD580` raw 132151-132217）：**停全部 B 层通道**。
 * 引擎 = `*v4 &= ~4u`（raw 132173）+ 循环清 `{540,544,548,552,556,560}`（raw 132174-132215）。
 * ★**不置 Scene 脏位**（`sub_4AD580` 是全场唯一没有 `_this[11627] = 1` 的族成员）；
 *   emulator 必须置脏：引擎每帧重画，emulator 只在脏/有动画时合成 ⇒ 不置脏会少一帧终态。
 * ★**不碰** `+524/+528/+532/+536`（另 4 个起点槽）与 bit1/A 层 5 个窗（"停掉全部动画窗"的说法不准确）。
 */
export function scResetDrawItemLoop(s: SceneState, handle: number): SetterOutcome {
  s.dirty = true; // ★与引擎的差异（引擎不置脏），理由见上
  const { item, created } = scEnsureItem(s, handle);
  applyDrawItemLoopReset(item);
  return created ? 'created-applied' : 'applied';
}

/**
 * `0x231`（`sub_4243F0` raw 32115-32129 → `sub_4AD690` raw 132219-132239）：**贴图换格循环**。
 * `op1`=handle、`op2`=周期 ms（`+560`）、`op3`=总格数（`+568`）、`op4`=每行列数（`+572`）。
 * ★`+568/+572` 与 A 层 `0x239` 共用（引擎如此）⇒ 两层分支都在 `eval.ts` 里（`aWindowSrcRect` / `loopSrcRect`）。
 */
export function scSetFlipbookLoop(s: SceneState, handle: number, period: number, frames: number, cols: number): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { item, created } = scEnsureItem(s, handle);
  applyFlipbookLoop(item, period, frames, cols);
  return created ? 'created-applied' : 'applied';
}

/**
 * `0x232`（`sub_424440` raw 32131-32164 → `sub_4AD730` raw 132241-132258）：**颜色往复**。
 * `op2`=周期 ms（`+544`）、`op3`=**alpha**、`op4`=**rgb**（`+576` = `α<<24 | rgb`）。
 *
 * ★两个**回退分支**必须实现（handler raw 32144-32160，与 `0x322` 同型）：
 *  - `op3 > 255` ⇒ alpha = 255；`op3 < 0` ⇒ alpha 取**当前色 `+96`（= `Item.from`）的 alpha**；
 *  - `op4 < 0` ⇒ rgb 取**当前色 `+96` 的 rgb**。
 *  引擎的 `sub_4ADD60`（raw 132583-132587）在项缺失时返回 **−1** ⇒ alpha = 0xff、rgb = 0xffffff；
 *  emulator 的"缺失即建项"给的 `from` 默认就是 `0xffffffff` ⇒ 与引擎同值（无需特判）。
 *  ★订正：旧注写"与 `0x202` 同一组字段"**不准确** —— `0x202` 写的是 A 层的 `+56`(delay)/`+76`(dur)/`+100`(TO)
 *  （raw 131972-131976），本条的 `+576` 是**另一格**（B 层目标色）；两者语义相同、存储不同。
 */
export function scSetColorLoop(s: SceneState, handle: number, period: number, alpha: number, rgb: number): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { item, created } = scEnsureItem(s, handle);
  const cur = item.from >>> 0; // 引擎 `sub_4ADD60` = 元素 `+96`（工作色）
  const a = alpha > 255 ? 255 : alpha < 0 ? (cur >>> 24) & 0xff : alpha & 0xff;
  const c = rgb < 0 ? cur & 0xffffff : rgb & 0xffffff;
  applyColorLoop(item, period, (((a & 0xff) << 24) | c) >>> 0);
  return created ? 'created-applied' : 'applied';
}

/**
 * `0x233`（`sub_424510` raw 32166-32182 → `sub_4AD7B0` raw 132260-132286）：**缩放往复**。
 * `op2`=周期 ms（`+548`）、`op3/op4/op5` = sx/sy/sz（handler raw 32176-32178 **各 ÷100**，
 * `dbl_5201F0`）→ `D3DXMatrixScaling(元素+592, …)`。
 * ★订正：旧注写"图元尺寸动画"是**错的**；也不是"与 `0x21E` 同字段"——`0x21E` 写 A 层 `+60/+80/+0xAC`。
 */
export function scSetScaleLoop(s: SceneState, handle: number, period: number, sx: number, sy: number, sz: number): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { item, created } = scEnsureItem(s, handle);
  applyScaleLoop(item, period, sx, sy, sz);
  return created ? 'created-applied' : 'applied';
}

/**
 * `0x234`（`sub_4245B0` raw 32185-32201 → `sub_4AD850` raw 132289-132314）：**匀速旋转**。
 * `op2`=周期 ms（`+552`）、`op3/op4/op5` = **旋转轴**（float，**不除**；`元素[145..147]` = `+580/584/588`）。
 *
 * ★★**订正（以体为准）**：旧注/筛体文档把本条记成"**平移窗（窗3）**、与 `0x220` 同字段、消费端
 *   raw 118232-118238"——**与体不符**。`+532/+552/+580..588` 在消费端（raw 118222-118228）是
 *   **旋转通道**（`D3DXMatrixRotationAxis`，角度 = `360·((now−start) % period)/period`）；
 *   平移往复用的是 `+536/+556/+656`，那是 `0x235`（`sub_4AD900`）。语料也印证是旋转：
 *   `i234 <h> 168 0 0 (local-int 2)` 的轴是 `(0,0,±1)`（`src/SC0000.txt:16096/16192`）。
 */
export function scSetRotationLoop(s: SceneState, handle: number, period: number, ax: number, ay: number, az: number): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { item, created } = scEnsureItem(s, handle);
  applyRotationLoop(item, period, ax, ay, az);
  return created ? 'created-applied' : 'applied';
}

/**
 * `0x235`（`sub_424630` raw 32203-32219 → `sub_4AD900` raw 132316-132343）：**平移往复**。
 * `op2`=周期 ms（`+556`）、`op3/op4/op5` = 平移（float，**不除**；`D3DXMatrixTranslation(+656, …)`）。
 * 语料形态：`i235 <h> 50 0 a 0`（50ms、纵向 10px 抖动）后紧跟 `i230 <h>` 关停。
 */
export function scSetTranslationLoop(s: SceneState, handle: number, period: number, x: number, y: number, z: number): SetterOutcome {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const { item, created } = scEnsureItem(s, handle);
  applyTranslationLoop(item, period, x, y, z);
  return created ? 'created-applied' : 'applied';
}

/**
 * `0x244`（`sub_41A370` raw 25349-25355 → `sub_4AD9F0` raw 132364-132503）：**批量清 A 层动画窗起点**。
 *
 * 引擎逐字：`sub_4AD9F0(Scene, 2)` 遍历 **三张表**，对 `flags & 2`（mask = op2 = 2）的元素把它的
 * 窗起点清 0：
 *  - `Scene+1036`（绘制项，740B；`sub_4AAD40` 取元素）⇒ `*(elem + 52) = 0`（raw 132401-132403）
 *    = **`+0x34` 全项共享的 A 层窗起点**（正是 `Item.animStart`）；
 *  - `Scene+1084` / `Scene+1100`（两张 572B 表；`sub_4AAEC0` 取元素）⇒ `*(node + 24) = 0`
 *    （raw 132438-132440 / 132476-132478）。后者 = `Engine.l2dNodes`（Live2D 立绘/变换节点）。
 *
 * emulator：**只实现绘制项那一支**（`animStart = 0` ⇒ 下一帧 `winPhase` 重新锁存 now，窗从头跑）。
 * ★两张 572B 表**未实现**：`L2dNode`（`src/live2d/runtime.ts`）的窗口只有 `delay/dur`、
 *   **没有"起点"字段**（引擎的 `+24` 在 emulator 侧不存在）⇒ 如实记缺口，不伪造一个没人读的格子。
 *
 * @param mask 引擎固定传 2（`sub_41A370` 的立即数）；保留参数是为了照抄体的形状。
 * @returns 命中并清掉起点的绘制项数（= 引擎遍历里命中 `a2 & flags` 的项数）。
 */
export function scClearDrawItemAnimStarts(s: SceneState, mask: number): number {
  let n = 0;
  for (const it of s.drawItems.values()) {
    if ((it.flags & mask) === 0) continue;
    it.animStart = 0; // raw 132403：`*(elem + 52) = 0`
    n++;
  }
  if (n > 0) s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（引擎另有 46508 脏位语义）
  return n;
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
 * `0x228`（`sub_430650` → `sub_4AA060`）：绘制项**当前平移**三元组 —— 引擎分解元素 `+0x16C`
 * （平移 **work** 矩阵，即 `0x1FF`/`0x220` 写的那个）后取平移分量。
 *
 * ★与 `0x21A`（`+0x24` 描画位置）是两个不同的量：`0x21A` 是"项画在哪"，这里是"项被平移了多少"。
 *   emulator 侧的对应字段就是 `Item.transWork`（`scSetDrawTranslation` 与平移窗推进都写它）。
 * ★项不存在 ⇒ 返回 `undefined`（引擎 `sub_4AA060` 查表失败返回 0 ⇒ 调用方把 op1 写 1）；
 *   注意这与"项存在但平移是 (0,0,0)"必须区分（后者 op1 写 0）。
 */
export function scGetDrawItemTranslation(s: SceneState, handle: number): { x: number; y: number; z: number } | undefined {
  const it = s.drawItems.get(handle);
  return it ? { x: it.transWork.x, y: it.transWork.y, z: it.transWork.z } : undefined;
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
 * **`Scene+46512` 强制冻结 ⇒ 把一帧里所有 A 层动画窗当帧收尾**（`tickets/T-0091` 的 G1）。
 *
 * 引擎依据（逐行读体）：冻结为 1 时，三类窗口的判定都走"到期"分支 ——
 *  - 绘制项 `sub_49AA30` raw 117439-117449：`v112 = *(Scene+46512); … v16 >= v15+v14+v13 || v112 == 1`
 *    ⇒ 收尾（`work ← target`），随后 117831-117836 `flags &= ~2; +720 bit0 &= ~1; start = 0`；
 *  - mesh `sub_4AF1C0` raw 133508/133517：`v5 = *(Scene+46512); if (… && !v5) {在途}` ⇒ 否则落到
 *    133531-133538 的收尾（`delay/dur/start = 0; state0 ← state1; flags &= ~2`）；
 *  - 转场 `sub_4B06D0` raw 134941 / 135806 / 136182（由 `transition.ts` 的 `freeze` 形参处理）。
 * ★这三处的置脏语义与引擎同：求值器**无条件**置 `Scene+46508`（raw 133540 / 117839）
 *   ⇒ 只要该项/mesh 还带 bit1，冻结这一帧就要再合成一次。
 * ★**未做的两格**（不静默跳过，登记在 `T-0091` 报告）：①引擎收尾时还清 `+720` bit0
 *   （raw 117836 `*((_DWORD *)a2 + 180) &= ~1u`）、②mesh 收尾还写 `state1 = -1`（raw 133536）。
 *   这两格 emulator 的**非冻结**收尾路径（`advanceWindows` / `calcDiffuse`）本来也没做 ⇒
 *   冻结路径与它保持一致，避免同一模型出现"两套收尾"。二者都不影响本票判据。
 */
function freezeItemWindows(it: Item): void {
  for (let i = 0; i < 5; i++) if (it.wins[i]!.set) freezeWindow(it, i);
  it.flags &= ~2;
  it.animStart = 0;
}

/** mesh 颜色窗的收尾（引擎 raw 133531-133538；与 `calcDiffuse` 的收尾分支同一套字段）。 */
function freezeMeshColor(m: MeshObj): void {
  if (m.anim) {
    m.anim.delay = 0;
    m.anim.dur = 0;
    m.anim.start = 0;
  }
  m.state0 = m.state1;
  m.flags &= ~2;
}

/**
 * 逐帧驱动：推进所有 DrawItem 的 5 个窗（窗末 `work ← target`；全窗结束清动画位）。
 * ★只有**真的推进了窗**（窗末收尾 / 动画位清零）才置脏：否则每帧推进都会把 `dirty` 一直点亮，
 * 脏位就失去意义（`tickets/T-0003`）。注意窗"跑完"的那一帧要置脏 —— 求值器在 `after` 相位返回目标值，
 * 与上一帧的插值结果不同，必须再合成一次才能看到终态。
 *
 * @param freeze `Scene+46512`（强制冻结；`tickets/T-0091` 的 G1）。为真时**不按墙钟推进**，
 *   而是把每个带 bit1 的项/mesh 立刻收尾（见 `freezeItemWindows` / `freezeMeshColor`）。
 *   ★这是 `advanceModel(nowMs, { freeze })` 的入口：此前冻结只在 `gatePending` 与帧末锁存里被用，
 *   窗模型完全看不到它 ⇒ 玩家跳过等待门后窗照墙钟跑完（画面差异 + `needsRender` 多亮若干帧）。
 */
export function scAdvance(s: SceneState, clock: number, freeze = false): void {
  // ★★**帧级冻结总闸 `Scene+46676`**（审计 §4.2 #24）：非 0 ⇒ 引擎整趟渲染提交被跳过
  //   （`sub_4B06D0` raw 134898、`sub_4AF1C0` raw 133547、`sub_49AA30` raw 117375、
  //    文本行 raw 71833/72266 …）⇒ 窗**不按墙钟推进**、也不收尾。
  //   ★放在 `freeze`（46512 = "立即收尾"）**之前**：46512 是"这一遍照画、但窗跳到终态"，
  //     46676 是"这一遍根本不画" —— 两者是不同层级（见 `SceneState.frozen` 的说明）。
  if (s.frozen) return;
  if (freeze) {
    // ★冻结路径与引擎同：每遍绘制**无条件**置 `46508`（raw 117839 / 133540 的 LABEL 不论在途与否都落这里）
    //   ⇒ 有窗可收尾就置脏，把终态画出来。
    for (const it of s.drawItems.values()) {
      if ((it.flags & 2) === 0) continue;
      // ★**`+720` bit0 = 豁免强制冻结**（`sub_49AA30` raw 117439-117442）：
      //   `v11 = (a2[180] & 1) == 0; v112 = Scene+46512; if (!v11 && (Scene+46528 & 4) == 0) v112 = 0;`
      //   —— `46528` bit2 在本 exe **无写者**（恒 0，见 `T-0091` design §2.5）⇒ 判据就是 `+720` bit0。
      //   同一个格子也是"不置池挂起位"的判据（raw 117843-117844，见 `scPoolPending`）⇒
      //   序章 80 000 ms 慢推（`src/SN0000.txt:1043` 的 `i242 f8023 1`）**跳过等待门时不许被截断**。
      if ((it.entryParam & 1) !== 0) continue;
      freezeItemWindows(it);
      s.dirty = true;
    }
    for (const m of s.meshes.values()) {
      if ((m.flags & 2) === 0) continue;
      freezeMeshColor(m);
      s.dirty = true;
    }
    return;
  }
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
 *
 * @param freeze `Scene+46512`（`tickets/T-0091` 的 G1）：为真时**非豁免的 A 层（bit1）窗视为已收尾**
 *   （引擎 `sub_4AF1C0` raw 133517 的 `&& !v5`、`sub_49AA30` raw 117449 的 `|| v112 == 1`）
 *   ⇒ 不再算它们 pending。
 *   ★**两个例外**（都回体核过）：①`+720` bit0 的项**豁免冻结**（raw 117440-117442）⇒ 仍按墙钟跑、
 *   仍算 pending；②B 层（bit2）循环动画不受冻结影响 —— 唯一读者 `sub_40BE10` 判它用的是
 *   `v6[0] & 4`（raw 16028），与 `46512` 无关 ⇒ 冻结帧只要还有循环动画就仍要合成。
 *   （`tickets/T-0091/design.md` §5.3 写的"freeze ⇒ 直接返回 false"两处都没写；此处按体，见 `T-0091` 报告。）
 */
export function scAnimationsPending(s: SceneState, clock: number, freeze = false): boolean {
  // mesh：**没有** `+720` 那类豁免（`sub_4AF1C0` raw 133517 只读 `Scene+46512`）⇒ 冻结一律收尾。
  if (!freeze) {
    for (const m of s.meshes.values()) if (m.flags & 2 && !meshWindowDone(m, clock)) return true;
  }
  for (const it of s.drawItems.values()) {
    if ((it.flags & 2) === 0) continue;
    // 冻结语义下只有 `+720` bit0 的项还按墙钟跑（raw 117440-117442 的豁免）⇒ 它们仍算 pending。
    if (freeze && (it.entryParam & 1) === 0) continue;
    // 极性：`itemAnimationsPending` = "**还有**窗没走完"（不需要取反）
    if (itemAnimationsPending(it, clock)) return true;
  }
  // ★B 层（bit2）周期/循环动画也是"还在动"⇒ 必须继续合成，否则画面上只有一个静止初相。
  //   **但这一条只进合成判据，绝不进 `scPoolPending`（等待门）**：引擎的池挂起位 `Scene+46516`
  //   只在 A 层（bit1）路径置位（raw 117844/133528），B 层永远不会"结束" ⇒ 接进等待门就是死等。
  //   依据见 `itemLoopAnimationsPending` 与 `b3-bit2-model-spec-2026-09.md` §4.6。
  for (const it of s.drawItems.values()) if (itemLoopAnimationsPending(it)) return true;
  // ★Live2D 节点窗（`tickets/T-0054` 的 M3 `live2d-slot-probe`）：引擎的合成判据 `sub_40BE10`
  //   （raw 16022 一带）除了绘制项/网格，还读 `Scene+55812` 的 10 个实例槽 —— 节点有窗在跑就必须继续合成，
  //   否则 `present:'needsRender'` 档下**立绘的动作只画一帧就冻住**（没有报错，只是不动了）。
  //   ★冻结（`Scene+46512`）时引擎把 `winSkip` 传给合成器 ⇒ 全窗当帧吸附 ⇒ 不算 pending（与上面 mesh 同口径）。
  //   ★探针是**纯读**（`l2dNodeWindowsPending` 不推进、不改窗）：这里只问"要不要再画一帧"。
  if (!freeze && s.l2dHost) {
    for (const n of s.l2dHost.l2dNodes.values()) {
      if (!l2dNodeDrawable(s.l2dHost, n)) continue;
      if (l2dNodeWindowsPending(n, clock)) return true;
    }
  }
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
 *    ★`T-0091` G1 之后冻结**真的传进了窗模型**（`scAdvance(s, clock, true)` 当帧收尾，
 *    由 `frame/loop.ts` 的 `advanceModel(nowMs, { freeze })` 驱动）⇒ 本探针自然为假；
 *    `loop.ts` 里 `e.scenePending = !e.sceneFreeze && host.poolPending()` 的折法是同一语义的第二道保险。
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
 * **引擎的 Live2D 槽探针**（`sub_4A1AF0`，raw 121777-121790）：`Scene+55812` 起的 **10 个实例槽**
 * 里**只要有一个非空**就返回 1。调用点 = 合成判据 `sub_40BE10` 的 raw 16025：
 *
 * ```c
 * if ( v2[258] || v2[259] || v2[260] || sub_4A1AF0(_this) ) return 1;   // 16025
 * ```
 *
 * ★为什么必须**照体的这一条**（`tickets/T-0054` M3 的缺口，2026-09）：
 * emulator 此前只把"**节点动画窗还在跑**"接进合成判据（`scAnimationsPending` 里的 L2D 段）——
 * 那是**更窄**的一条：立绘动作播完（窗 `dur` 到点）后判据就为假，而引擎**只要槽里有实例就一直
 * 强制重画**。差别在"没有窗在跑、但 L2D 状态被改过"的那类操作上会显形：
 * `0x34F`（纹理乘色）/`0x351`（命名参数）/**`0x346`/`0x34D`**（572B 节点 setter）**都不置任何脏位**
 * ⇒ `present:'needsRender'` 档下那几笔改完**不会重画**（不报错、只是画面不对，正是本台账要抓的类别）。
 * 引擎靠"槽非空 ⇒ 每帧都合成"把这一类兜住。
 *
 * ★口径与边界：
 *  - 判据 = `l2dSlots`（= 引擎 `Scene+55812` 的同一张 10 槽表）**非空**，**不看**`model` 是否存在、
 *    也不看节点是否可画 —— 与体逐字一致（体只解引用槽指针）；
 *  - 与 `0x342`（销毁槽）天然成对：析构后槽被删 ⇒ 探针转假，合成可以停；
 *  - 与**冻结**（`Scene+46512`）无关：体里这条在冻结门**之前**（raw 16022-16025 同一串 `||`），
 *    所以冻结帧也照样强制合成 —— 别把它并进 `scAnimationsPending` 的冻结分支。
 *
 * ★**代价与备选**（写在这里免得后人以为是漏优化）：这一条会让"屏上有立绘"的页面在
 * `present:'needsRender'` 档下**每帧都合成**（引擎就是这样：原生每帧都重画）。想省掉它需要的是
 * "让 L2D 的变更型指令自己置脏"（`0x34F`/`0x351`/`0x346`/`0x34D`），但那要在 VM → 宿主的窄缝上
 * 再加一条（`L2dHost` 目前没有"置脏"缝）⇒ 先按体保正确性，性能另开票再谈。
 */
export function scL2dSlotProbe(s: SceneState): boolean {
  return (s.l2dHost?.l2dSlots.size ?? 0) > 0;
}

/**
 * **"这一帧该不该合成"** —— 引擎式 present 条件：`场景脏 || 仍有动画在播 || 有活动转场 || L2D 槽非空`。
 *
 * 为什么做成共享函数（`tickets/T-0008` 的 D3）：这条判据原先只活在 `PixiBackend.needsRender()` 里，
 * 而它**读了宿主自己的 `waitFlags` 镜像**（只置不清 ⇒ 永久为真）⇒ 既测不到（pixi 需要 WebGL/DOM），
 * 也无法被 headless 复用。现在判据在共享层：两个宿主同一份，且能在 Node 里断言。
 *
 * ★这里**没有**"命中 `0x400` 等待门"这一项：门状态的真源是 `Engine.waitFlags`，
 * 而"门等待期间持续合成"是**帧驱动**的职责（产品路径在门分支里无条件 present）。
 */
export function sceneNeedsRender(s: SceneState, clock: number, dirty: boolean): boolean {
  // ★第零项：**帧级冻结总闸**（`Scene+46676`，审计 §4.2 #24）—— 非 0 ⇒ 引擎整趟提交被跳过，
  //   `46508` 也不会被置位 ⇒ "这一帧不用合成"。
  if (s.frozen) return false;
  // ★第一项：**池挂起位 `Scene+46516` 的场景侧锁存**（审计 §4.2 #2 的 P1 `missing-consumer`）：
  //   引擎 `sub_4B4040` raw 136718-136719 的收尾是 `if (*(_QWORD *)(Scene+46512)) Scene[46508] = 1;`
  //   —— 8 字节一起判 ⇒ **上一遍绘制时还有元素在动**（46516）与**强制冻结**（46512）都要把本遍标脏。
  //   修前这一项只喂 `0x400` 等待门（`Engine.scenePending` → `Engine.gatePending`），判据里没有它
  //   ⇒「绘制期置了 46516、但窗判据此刻已为假」会漏掉一帧终态。宿主用 `scSetScenePending` 锁存。
  if (s.pending) return true;
  // ★第三项：**有活动转场窗**（引擎 `Scene+46508` 的置位点之一就是转场消费端 raw 136718-136719
  //   `if (46512 | 46516) 46508 = 1`，唯一读者 = `sub_40BE10` raw 16022 = needsRender）。
  //   少了这一项，转场期间 `present:'needsRender'` 档会**停止合成**，条带/淡入淡出只画一帧。
  // ★第四项：**L2D 槽非空**（`sub_4A1AF0`，raw 16025 的最后一个 `||`）—— 见 `scL2dSlotProbe`。
  return dirty || scAnimationsPending(s, clock) || scTransitionsPending(s) || scL2dSlotProbe(s);
}

/**
 * ★**锁存池挂起位 `Scene+46516` 的场景侧值**（审计 §4.2 #2）—— 宿主在每帧末 `advanceModel` 之后
 * 调一次，把 `Engine.scenePending`（= 引擎"上一遍绘制时还有元素在动"）交给共享模型。
 *
 * 为什么必须由宿主**推**进来而不是判据函数自己去问 `Engine`：`sceneNeedsRender` 是纯函数
 * （`SceneState` + 时钟 + 脏位），两个宿主（pixi/headless）共用；`Engine` 在渲染层不可见
 * （`tickets/T-0003` 的 B3 纪律：判据只能读共享模型）。
 *
 * 清零：宿主在**真的合成了一次**之后调 `scClearScenePending`（= 引擎下一遍绘制开头的 `46516 = 0`，
 * raw 130427-130428 的第一句在 `sub_4AD9...` 前缀里；见 `scClearScenePending` 的说明）。
 */
export function scSetScenePending(s: SceneState, pending: boolean): void {
  s.pending = pending;
  // ★不需要置脏：本位本身就是"要不要再合成一遍"的输入（引擎也是读它、不是置 46508 之外的东西）。
}

/** 本遍合成已消费掉池挂起位（引擎每遍绘制开头 `46516 = 0`）。 */
export function scClearScenePending(s: SceneState): void {
  s.pending = false;
}

/**
 * ★★**开始一遍绘制**（`sub_4B06D0` / `sub_4B4040` / `sub_4B4460` 的同一段开头）。
 *
 * 引擎里那三处开头都做同一件事：
 * ```c
 * Scene+46508 = 0;   // 本遍"要重画"位（收尾由 raw 136718-136719 按 46512|46516 置回）
 * Scene+46516 = 0;   // 池挂起位（绘制期再置）
 * ```
 * （raw 130427-130428 的 `0x2xx` 前缀、raw 137035-137036 的 `0x222`、raw 136792-136793 的帧提交）
 * ⇒ emulator 的等价物 = 清 `dirty` 与 `pending`。调用点 = `0x222` handler 与宿主每次真正合成之前。
 */
export function scBeginRenderPass(s: SceneState): void {
  s.dirty = false;
  s.pending = false;
}

/**
 * ★**`0x222` 的逐节点 bit0 分派**（`sub_4B4460` raw 136905/136915/136926/136936：
 * `if ((node[0] & 0x10001) == 1) sub_4B4020 / sub_4AF1C0 / sub_4B0360`）。
 *
 * emulator 侧能做的部分：把该 handle 的绘制项/mesh 的 **work 变换复位**（`+0x10000` 是引擎给
 * "被转场占用"打的标记位，`& 10001 == 1` 实际等价于"可绘制"）——`0x221`/`0x321` 的参数在
 * emulator 侧无从取值（3D 层节点表未建模，见 `handlers/scene-commit.ts` 的"未落地"②）。
 *
 * @returns 真的碰到了模型（`false` = 该 handle 两侧都不存在 ⇒ 只置脏）。
 */
export function scPrimDispatch(s: SceneState, handle: number): boolean {
  const it = s.drawItems.get(handle);
  const m = s.meshes.get(handle);
  if (!it && !m) return false;
  if (it && (it.flags & 1) !== 0) resetItemTransform(it);
  if (m && (m.flags & 1) !== 0) {
    m.anim = undefined; // 3D mesh 路径的对应物：颜色窗当帧收尾（`sub_4AF1C0` raw 133531-133538）
    m.flags &= ~2;
  }
  s.dirty = true;
  return true;
}

/** 管理器创建一路效果（`0x326` Snow / `0x327` Rain / `0x328` Leaf 的共享半边）。 */
export function scWeatherCreate(s: SceneState, which: number, params: readonly number[]): boolean {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  return weatherCreate(s.weather, which, params);
}

/** 销毁全部效果 + 清旗标（`0x324` → thunk `sub_453530` → `sub_453150`）。 */
export function scWeatherDestroyAll(s: SceneState): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  weatherDestroyAll(s.weather);
}

/** 写两个销毁阈值（`0x325` → `sub_426DC0`）。 */
export function scWeatherSetDestroyThresholds(s: SceneState, rainAt: number, othersAt: number): void {
  weatherSetDestroyThresholds(s.weather, rainAt, othersAt);
}

/**
 * **`sub_4535F0(管理器, key)` 的销毁半边**（raw 65890-65909）—— 逐节点销毁判据。
 * 调用点 = `sub_4B06D0` 的三表归并（raw 136903/136913/136924）与 `0x222`（raw 137169/137208/137218）。
 */
export function scWeatherNodeKey(s: SceneState, key: number): number[] {
  return weatherNodeKey(s.weather, key);
}

/**
 * **`sub_453540`：每帧按墙钟推进三路效果**（审计 §4.2 #18；raw 65791-65839）。
 *
 * 时钟口径 = **宿主注入的 `s.weather.clockMs`**（引擎是 `timeGetTime()`；驱动传 `Engine.nowMs`
 * —— 产品路径上就是墙钟，headless 走虚拟时钟以保确定性）。上限 100 步/帧在 `weather.ts` 里。
 *
 * @returns 本帧推进的步数（0..100）。
 */
export function scWeatherAdvance(s: SceneState): number {
  // ★帧级冻结总闸（`Scene+46676`）在这里也成立：冻结期间 `sub_4B06D0` 整段被跳过
  //   ⇒ `sub_453540` 也不会被调用（raw 136828 在 `sub_4B06D0` 体内）。
  if (s.frozen) return 0;
  const steps = weatherAdvance(s.weather, s.weather.clockMs);
  if (steps > 0) s.dirty = true; // ★真的推进了 ⇒ 本帧要重画（否则雨雪在 present:needsRender 档下会冻住）
  return steps;
}

/** 注入本帧时钟（`0x118`/`0x23C` 之类的帧钟由驱动给；天气推进用它，见 `scWeatherAdvance`）。 */
export function scWeatherSetClock(s: SceneState, clockMs: number): void {
  s.weather.clockMs = clockMs;
}

// ---------------------------------------------------------------------------
// `Scene+46668` 3D 效果等级（审计 §4.2 #20 `scene-3d-effect-level-writer`）
//   ★等级 → 槽 mode / 效果资源 id 的**纯映射**在 `scene/effectLevel.ts`（无循环依赖：
//     `state.ts` 需要 `sceneScratchMode`，而它不能 import 本文件）。
// ---------------------------------------------------------------------------

/**
 * ★★**写 3D 效果等级**（`Scene+46668`）。
 *
 * 写端在引擎里是构造/设备切换（`sub_4A6EE0` raw 126561 的 `Scene+46668 = a3`）；emulator 没有
 * D3D 设备版本可读 ⇒ 由宿主/驱动/守卫经本函数注入（默认 2 = 满档，见 `SceneState.effect3DLevel`）。
 *
 * 三件持续后果（全在这一次调用里落地）：
 *  1. 两个 scratch 槽（36/37）的 mode 跟着等级重写（`sceneScratchMode`）；
 *  2. 主/副 `ID3DXEffect` 按等级惰性建（`ensureEffect3DSlots`）；
 *  3. 降级**不**主动释放已建的槽（引擎只在 `>1` 时惰性建、降级也不会回头释放 ⇒ 与体的惰性语义一致）。
 */
export function scSetEffect3DLevel(s: SceneState, level: number): number {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const lv = Math.max(0, Math.min(2, Math.trunc(level)));
  s.effect3DLevel = lv;
  const mode = sceneScratchMode(lv);
  scSetSlotMode(s, SCENE_SCRATCH_SLOT_A, mode);
  scSetSlotMode(s, SCENE_SCRATCH_SLOT_B, mode);
  ensureEffect3DSlots(s.effect3DSlots, lv);
  return lv;
}

/**
 * ★**绘制期按等级补齐效果槽**（`sub_4B06D0` raw 134820-134855 的惰性建）——
 * 由宿主每帧经 `scSceneCommitRange` 调用（不是"构造时一次"：引擎也是**每帧**判空后惰性建）。
 *
 * @returns 这一次新建了哪些槽（空 = 都已建 / 门未过）。
 */
export function scEnsureEffect3DSlots(s: SceneState): string[] {
  return ensureEffect3DSlots(s.effect3DSlots, s.effect3DLevel);
}

/**
 * ★**`0x326` Set3DEffectSnow 的两半**（审计 §4.2 #20 的 (c) / #21 的 `0x326` 那一半）。
 *
 * 引擎（`sub_426E10` raw 33941-33954 → `sub_418340` raw 23910-23947）：
 *  - **门**：`Scene+46668 >= 1`（raw 23917）；
 *  - **共享效果懒建**：`Scene[42456 + 4*op4]`（纹理槽 `op4`）非空 ⇒ 若 `Scene+46496` 为空则
 *    `D3DXCreateEffectFromResourceA(设备, 0, 202, …, Scene+46496)`（raw 23922-23932）；
 *  - **重建 Snow**：`sub_453330(管理器, op1, f2, op3, 纹理, effect)`（raw 23935）。
 *
 * @param textureReady 纹理槽 `op4` 是否已有纹理（"槽里有没有 CTexture"是宿主侧的事实）。
 * @returns `false` = 门未过或纹理缺失（引擎在后者打 `Set3DEffectSnow エラー` 并**什么都不做**）。
 */
export function scSet3DEffectSnow(
  s: SceneState,
  op1: number,
  f2: number,
  op3: number,
  textureReady: boolean,
): boolean {
  const gate = ensureSharedEffect3D(s.effect3DSlots, s.effect3DLevel, textureReady);
  if (!gate.built) return false; // 等级 < 1 或纹理槽空 ⇒ 引擎什么都不做（只报错串）
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  // `sub_453330(管理器, op1, f2, op3, 纹理, effect)`：重建 Snow（`operator new(0xE4)`），
  // 16-dword 参数块前三位 = 引擎真读的三格（其余由效果对象自己解释）。
  weatherCreate(s.weather, 1, [op1, f2, op3]);
  return true;
}

/**
 * ★★**写渲染冻结总闸 `Scene+46676`**（审计 §4.2 #24）。
 *
 * 反编译里这一格**只有读点（105 处）、零写点** ⇒ 它的运行期取值无法静态判定（同 `Scene+1856`
 * 的处置）。默认 `false` = 与修前逐字节相同；需要复现冻结的宿主/回归走本函数注入。
 */
export function scSetSceneFrozen(s: SceneState, frozen: boolean): void {
  s.frozen = !!frozen;
  // ★**不置脏**：本位的唯一消费者是 `sceneNeedsRender` 的"第零项早退"（frozen ⇒ 恒假）
  //   ⇒ 置脏没有任何后果（判据先看它）。清位时"重新开始合成"由**窗/脏位**自然给出
  //   （冻结期间脚本的改动照旧置脏，只是那些帧不合成）⇒ 这不会静默丢掉一帧。
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

/**
 * 清空一个消息窗（引擎 `0x301` 删绘制项区间 / `0x71` 开始新一段 / `sub_404F80`）。
 * ★订正（`T-0095`）：这里曾把 `0x85` 也列进来 —— `0x85`（`sub_418F50` → `sub_45EBE0` raw 74182-74194）
 * 清的是**回看页索引表 + 72B 记录表**，与消息窗绘制项无关（`msgWinClear` 的调用者只有 `0x301` 与
 * `engine.ts` 的 `sub_404F80` 那条路）。
 */
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
  s.slotFills.delete(slot);
}

/**
 * **`0x20B` FillTexture 的共享模型记录**（`sub_423690` → `sub_4A4C70`，raw 31569-31592）。
 *
 * 引擎往**纹理槽的表面**填一个纯色矩形（`op4/op5` 是宽/高、`op6` α 夹 255、`op7` RGB 组装成 `0xFFRRGGBB`）。
 * Pixi 宿主把它真画进该槽的画布（`TextureCache.fillSlotRect`）；headless 用本函数记录，
 * 使"报告里的模型"与"画面上的模型"同源（与 `scDrawString` 同一设计）。
 */
export function scFillSlotRect(
  s: SceneState,
  slot: number,
  x: number,
  y: number,
  w: number,
  h: number,
  argb: number,
  alpha: number,
): void {
  s.dirty = true;
  const list = s.slotFills.get(slot);
  const rec = { x, y, w, h, argb, alpha };
  if (list) list.push(rec);
  else s.slotFills.set(slot, [rec]);
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

/**
 * `0x1FC` 复位图元变换（`sub_4AC470`：清该 DrawItem 的缩放/旋转/平移字段）。
 *
 * ★**2026-09（审计 §4.2 #8）不再只是"记录"**：引擎把三块 work 矩阵复位成单位元
 * （`sub_4AC470` raw 131276-131327），所以这里真的把 `Item` 的 work/target 三元组复位
 * （`resetItemTransform`）。消费者 = `presenter.#buildItemSprite` 的 `itemRenderPlacement`
 * （它读 `itemScale`/`itemRotationRad`/`itemTranslation`）⇒ 复位之后画面立刻回正。
 * 台账字段 `render4.primReset` 保留（报告/快照要能看到脚本下发的这一次复位）。
 */
export function scResetPrimTransform(s: SceneState, handle: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.primReset = handle;
  s.render4.primTransform.delete(handle);
  const it = s.drawItems.get(handle);
  if (it) resetItemTransform(it); // 引擎 `sub_4AAA50` 建的是"缺失即建"的默认项 ⇒ 不存在则只记台账
}

/**
 * `0x1FE` 图元变换 4 浮点（`sub_4AC660`；**不除 100**，与 0x1FD 的缩放不同）。
 *
 * ★这四个量是 `(轴 x, 轴 y, 轴 z, 角°)`——**绕任意轴旋转**，不是"四个自由浮点"（读体得，见
 * `applyPrimAxisRotation` 的引擎逐句）。修前只写台账 ⇒ 画面完全没有这一笔（审计 §4.2 #8）。
 */
export function scSetPrimTransform4(s: SceneState, handle: number, a: number, b: number, c: number, d: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.primTransform.set(handle, [a, b, c, d]);
  let it = s.drawItems.get(handle);
  if (!it) {
    // 引擎 `sub_4AC660` 第一步就是 `sub_4AAA50(Scene, a2)`（缺失即建项，`flags = 0` ⇒ 尚不可画）
    it = makeDefaultItem(handle);
    s.drawItems.set(handle, it);
  }
  applyPrimAxisRotation(it, a, b, c, d);
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

/**
 * `0x224` 清转场表（`sub_41A290` → `sub_4AA180` → `sub_4A9BE0(Scene+1048)`）。
 *
 * ★`sub_4A9BE0`（raw 129282-129302）是**逐节点 delete + 复位头尾**（`_this[2] = 0`）⇒ 真的清空容器，
 * 所以本层也清 `render4.transitions`（否则 `i251` 写的记录会在 `i224` 之后继续"存在"，与引擎分叉）。
 */
export function scClearTransitions(s: SceneState): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.transitionClears++;
  s.render4.transitions.clear();
  // ★运行期窗状态必须跟着清（`tickets/T-0084`）：不清的话下一次同 id 写入会继承上一轮的锁存起点
  //   （`scTransitionTick` 只在"一条都不活动"时清；`0x224` 是脚本显式清表，更该立刻清）。
  s.render4.transitionRuntime.clear();
}

/** 引擎新建转场记录的默认值（`sub_49A640` raw 117059-117077）：24 格，其中 `[4] = -1`（= 后台缓冲）。
 *
 * ★偏差披露：`sub_49A640` 只写前 56 字节（`[0..13]`），`[14..23]` 在引擎里是**未初始化的栈残留**
 * （`sub_4AAAF0` 用一个没有 memset 的 96 字节局部做默认记录）；本层按 0 起 —— 三条约会把要用的格写满
 * （`0x24F` 不写 `[16..23]`，但类别 2 的渲染路径也不读那几格）。
 */
export function scTransitionDefaultRecord(): number[] {
  const rec = new Array<number>(24).fill(0);
  rec[4] = -1;
  return rec;
}

/**
 * **转场记录逐格写入**（`0x24F`/`0x250`/`0x251` → `handlers/gfx-state.ts`）：
 * `writes` = `[[格下标, 值]…]`，与引擎的 `sub_4AAE10(Scene+1048, &id)[i] = v` 一一对应。
 *
 * 引擎语义（`sub_4AAAF0` + `sub_4AAE10`，raw 130052-130075 / 130197-130240）是"**确保记录存在再写格**"
 * ⇒ 已存在的记录**只改被写的格**（其余保持上次的值），所以这里是合并而不是整条覆盖。
 */
export function scSetTransition(
  s: SceneState,
  id: number,
  writes: ReadonlyArray<readonly [number, number]>,
): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const rec = s.render4.transitions.get(id) ?? scTransitionDefaultRecord();
  for (const [i, v] of writes) {
    if (i >= 0 && i < rec.length) rec[i] = v | 0;
  }
  s.render4.transitions.set(id, rec);
  // ★逐条的新鲜度（`tickets/T-0091` 的 D2 变更需要）：写入端每次都把 `[1]`（窗口起点）写 0，
  //   引擎的起点是"第一次被消费的那一帧"才锁存 ⇒ 同 id 的**新**记录必须丢掉上一轮的运行期起点
  //   （否则新窗会继承旧 `start`，`t` 立刻越界）。整表清仍然是 `0x224`/帧尾门的事。
  //   注：D2 让"到期记录多活一帧"（为了把终值合成进 `[4]`），所以这里必须按 id 清，不能只靠整表清。
  if (s.render4.transitionRuntime.has(id)) s.render4.transitionRuntime.delete(id);
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

/** `0x321` MeshEntry 属性（`sub_4AE280`：`entry[op2 + 7] = op3`）。
 *
 * ★**2026-09（审计 §4.2 #8）消费者已接**：`presenter.drawMesh` 把这个 map 交给
 * `meshColor`/`meshVertexColor`（`drawitem/eval.ts` 的 `meshAttrsTint`）⇒ 改属性真的改画面。
 * ★`scSetDrawEntryParam` 那类"台账 + 模型双写"的口径这里不需要：`render4.meshAttrs` **就是**
 * 消费者读的那一份（唯一真源）。
 */
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

/**
 * `0x32D` 3D 颜色（`sub_499DF0`：四分量各 ÷255 后下发）。
 *
 * ★**2026-09（审计 §4.2 #8）消费者已接**：引擎的四分量被组装成一个 ARGB 写进
 * `Engine[13947]` 并 `SetRenderState(139 = D3DRS_TEXTUREFACTOR, 该值)`（raw 116637 / 116693-116696）
 * —— 那是**纹理阶段常量**，Pixi 没有对应档 ⇒ emulator 把它当**网格通路的全局染色倍率**
 * （`presenter.drawMesh` → `meshColor`/`meshVertexColor` 的 `color3DTint`）。
 * 恒等 `[1,1,1,1]`（初值）**不参与乘法** ⇒ 与修前逐字节相同。
 * ★口径差异如实登记：真机上 TEXTUREFACTOR 只影响**用了该 stage 常量**的纹理阶段
 * （本作 3D 通路的 shader 用法未在反编译里逐条确证）⇒ 这里是"全局网格染色"的近似。
 */
export function scSet3DColor(s: SceneState, r: number, g: number, b: number, a: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.render4.color3D = [r, g, b, a];
}

/**
 * ★★**`sub_4A1E90`：把 Scene 自己的变换记录复位成单位阵**（raw 122129-122157）。
 *
 * 引擎体：`_this[11650]`（= `Scene+46600`，Scene 世界矩阵）置单位阵，再调
 * `sub_49AA30(this, Scene+1120, Scene+46600, …)` 把**元素记录**（四条 `0x22A`/`0x22C`/`0x22D`/`0x22F`
 * 写的那个）按当前值合成一次。调用点 = `sub_4B4040` raw 136795（每帧 2D 提交）与
 * `sub_4B4460`（`0x222`）raw 137038。
 *
 * emulator 侧的等价物 = **清掉 `SceneXform`**（`sceneAffine2DOf` 对 `null` 返回单位变换）
 * ⇒ 那些 `scSetScene*` 的分量不再参与后续合成。这是 `0x222` 能落地的一半里最有观测意义的一件
 * （审计 §4.2 #19 的"世界矩阵复位"）。
 */
export function scResetSceneWorldMatrix(s: SceneState): 'applied' | 'noop' {
  const had = s.sceneXform !== null;
  s.sceneXform = null;
  s.sceneRotRad = 0;
  if (had) s.dirty = true; // 真的变了才置脏（否则每帧都亮，脏位失去意义 —— `tickets/T-0003`）
  return had ? 'applied' : 'noop';
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

// ---------------------------------------------------------------------------
// ★Scene 级世界矩阵（`0x22A`/`0x22C`/`0x22D`/`0x22F`）—— 只作用于层号 ∈ [20,30) 的项
// ---------------------------------------------------------------------------

/**
 * **Scene 变换作用的层号区间**（引擎 RenderScene raw 133405 的判据 `(层号 − 20) > 9` 取反）：
 * `层号 ∈ [SCENE_LAYER_LO, SCENE_LAYER_HI)` 的项走"被压成 2D"的支路，也就是**只有它们**
 * 才真正受 `0x22A`/`0x22C`/`0x22D`/`0x22F` 影响（见 `scene/state.ts` 的 `sceneXform` 说明）。
 */
export const SCENE_LAYER_LO = 20;
export const SCENE_LAYER_HI = 30;

/** 该层号是否落在「Scene 变换只作用于我」的区间里（`[20,30)`）。 */
export function sceneLayerAffected(layer: number): boolean {
  return layer >= SCENE_LAYER_LO && layer < SCENE_LAYER_HI;
}

/** 一份"还没算 world·scene 的 work 矩阵"的 2D 结果（`itemRenderPlacement` 的形状）。 */
type Affine2D = { position: { x: number; y: number }; scale: { x: number; y: number } };

// ---------------------------------------------------------------------------
// ★Scene 世界矩阵的**四块矩阵合成**（`0x22A`/`0x22C`/`0x22D`/`0x22F`）
//   —— 依据 = `sub_49AA30` 的**收尾**（LABEL_72，raw 117927-117933）：
//        v73 = v90;
//        D3DXMatrixMultiply(v90, v90, v118);      // v118 = 元素 +0x6C  = 动画「缩放」块 current
//        D3DXMatrixMultiply(v73, v73, v120);      // v120 = 元素 +0xEC  = 动画「旋转」块 current
//        D3DXMatrixMultiply(v73, v73, v121);      // v121 = 元素 +0x16C = 动画「work」块 current
//        D3DXMatrixTranslation(v119, v111, v110, v91);
//        return D3DXMatrixMultiply(v73, v73, v119);
//   D3DX 是**行向量**约定（`v' = v·M`）⇒ `work ← work·v118·v120·v121·T(pos)`。
//   四块矩阵各自独立（raw 117123 `D3DXMatrixScaling(Scene+307)` / 117159
//   `D3DXMatrixTranslation(Scene+371)` / 117175 `D3DXMatrixScaling(Scene+323)` / 117232
//   `D3DXMatrixTranslation(Scene+387)`；进链处 = 117496 / 117646 的 `qmemcpy` + 424 的 pivot 平移）
//   ⇒ **不再用互斥的 `kind` 选择分量**（修前：`applySceneXformToPlacement` 按 `kind` 三选一，
//   跨种类混用只应用最近一次下发的那一种；引擎四块同时在）。
//
//   ★P1（本文件本轮修的那条）：**`0x22F` 的 op3/4/5 对层 20..29 是旋转轴，不是屏幕空间 2D 平移**。
//   体（`sub_49AA30` 层号支 raw 117624-117632，逐字）：
//        if ( !*(_DWORD *)(v113 + 46676) && *(_DWORD *)(*(_DWORD *)(v113 + 1860) + 1164) == 2 )
//        {
//          v55 = *((_DWORD *)a2 + 1);              // 元素 +4 = 层号
//          if ( v55 >= 20 && v55 < 30 )
//          {
//            ((void (__stdcall *)(_DWORD, _DWORD, _DWORD))j_D3DXMatrixRotationAxis)(v120, a2 + 181, a2[184]);
//            v26 = 0.0; v42 = 1.0;
//          }
//        }
//   `a2` = 元素（740 B DrawItem），`a2 + 181` = 元素 +724 = **轴三分量**、`a2[184]` = 元素 +736 =
//   **角（弧度）**；`v120` 随后在 117930 被乘进 work ⇒ 层 20..29 上这三格**是旋转**。
//   修前的两处错：①`presenter.ts` 的 `sceneXform2D` 把 `x.axisTranslate.x/.y` 当 `tx/ty` 做 2D 平移；
//   ②`scene/state.ts` 的注释写「`v120` 在 20..29 支里被置成单位阵 ⇒ `0x22F` 的轴分量对该区间
//   不产生任何影响」——紧跟 `D3DXMatrixRotationAxis` 的 `v26 = 0.0; v42 = 1.0;` 是给**后面
//   `+0x1B0` 那块矩阵**（raw 117647-117662 用 v26/v42 填零/一、再 `qmemcpy(v121, a2 + 91)`）用的，
//   不是"把 `v120` 置成单位阵"。
//
//   ★**由上述四块合成得到的 Scene 变换是 2D 仿射**（这解释了 RenderScene 层号支里的 decompose）：
//     `z` 在两次投影中都被丢掉 ⇒ 3D 复合的 (1,1)/(1,2)/(2,1)/(2,2)/(4,1)/(4,2) 六个分量与
//     "先把每块矩阵投到 2D 再乘"**逐位相同**。所以这里就按体做 4×4 合成、再取那六个分量。
// ---------------------------------------------------------------------------

/** 行主序 4×4（D3DX 行向量约定：`v' = v·M`）—— 与 `nodeMatrix.ts` 的 `Affine` 同一转置口径。 */
type Mat4 = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

/** `M = A·B`（行向量约定：先 A 后 B）。 */
function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0) as Mat4;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i * 4 + k]! * b[k * 4 + j]!;
      out[i * 4 + j] = s;
    }
  }
  return out;
}

/** `D3DXMatrixTranslation`（raw 117159/117232/117429）。 */
function mat4Translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/** `D3DXMatrixScaling`（raw 117123/117175）。三轴可为 0/负（引擎不拦）。 */
function mat4Scaling(x: number, y: number, z: number): Mat4 {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

/**
 * `D3DXMatrixRotationAxis`（raw 117630）—— 标准 Rodrigues，D3DX 的**行向量**矩阵。
 *
 * ★**先归一化**：`.c` 里轴是原样传进去的（raw 117630 `a2 + 181`），归一化发生在 `d3dx9_43.dll`
 * 内部（与 `live2d/nodeMatrix.ts:277-296` 同一条实测结论；那里还把这个 3×3 的 2D 部分
 * `M11/M12/M21/M22` 逐位钉在测试里）。轴长为 0 ⇒ d3dx 那头是 0 除（无定义）⇒ 这里退化成单位阵。
 */
function mat4RotationAxis(ax: number, ay: number, az: number, rad: number): Mat4 {
  const len = Math.sqrt(ax * ax + ay * ay + az * az);
  if (!(len > 0) || !Number.isFinite(len)) {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }
  const x = ax / len;
  const y = ay / len;
  const z = az / len;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
}

/** 单位阵（字面量，避免共享可变对象）。 */
function mat4Identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/**
 * **Scene 变换在层 20..29 上的 2D 仿射形式**（= 引擎 RenderScene 层号支 raw 133411-133438 的
 * `D3DXMatrixDecompose` 后重建的净结果）。
 *
 * 返回的六个分量正是**D3DX 4×4 的前两列 + 第四行**（`M11/M12/M21/M22/M41/M42`）——
 * 点映射 `(x,y) → (x·M11 + y·M21 + M41, x·M12 + y·M22 + M42)`。之所以**不**把它压成
 * "scale + rotation"两样：两轴缩放不同（`axisScale.x ≠ axisScale.y`）且带旋转时那个 2×2
 * 不是"缩放∘旋转"可表示的（会留剪切项），而这六个数是引擎拿到的**同一组数**
 * （`D3DXMatrixDecompose` 的输出就是它们，随后 `D3DXMatrixScaling/ RotationAxis/ Translation` 重建）。
 *
 * 返回 `null` = 这一层不吃 Scene 变换（层号不在 `[20,30)`）或**四块矩阵全为默认 + 角 0**
 * （`sceneXform` 锚为 null 且 `sceneRotRad === 0`）⇒ 调用方必须保持"与接线前逐字节相同"。
 *
 * 组合序（**行向量约定，从左到右作用**；依据 = `sub_49AA30` 的 117425-117431 + 收尾 117927-117933）：
 * ```
 * 点 ← 点 ·T(−pivot)·S(axisScale_x, axisScale_y, 1)·R(axis, angle)·T(axisTranslate)
 *          ·S(scale_x, scale_y, 1)·T(translate_x, translate_y, 0)
 * ```
 * 即"先按 `0x22D` 的轴缩放 → 绕 `0x22F` 的轴旋转 → 加 `0x22F` 的分量 → 乘 `0x22A` 的缩放
 * → 加 `0x22C` 的平移"，四块**互相独立、可叠加**（修前是一个 `kind` 互斥三选一）。
 */
export function sceneAffine2DOf(
  s: SceneState,
  layer: number,
): { a: number; b: number; c: number; d: number; tx: number; ty: number } | null {
  if (!sceneLayerAffected(layer)) return null;
  const x = s.sceneXform;
  if (!x && s.sceneRotRad === 0) return null;
  const asx = x ? x.axisScale.x : 1;
  const asy = x ? x.axisScale.y : 1;
  const ax = x ? x.axisTranslate.x : 0;
  const ay = x ? x.axisTranslate.y : 0;
  const az = x ? x.axisTranslate.z : 0;
  const sx = x ? x.scale.x : 1;
  const sy = x ? x.scale.y : 1;
  const tx = x ? x.translate.x : 0;
  const ty = x ? x.translate.y : 0;
  // ★修前：op3/4/5 被当屏幕空间 2D 平移（直接当 `tx/ty`）；修后：它们是**旋转轴**。
  const axis = x ? x.axis : { x: 0, y: 0, z: 0 };
  const m = mat4Mul(
    mat4Mul(
      mat4Mul(mat4Mul(mat4Scaling(asx, asy, 1), mat4RotationAxis(axis.x, axis.y, axis.z, s.sceneRotRad)), mat4Translation(ax, ay, az)),
      mat4Scaling(sx, sy, 1),
    ),
    mat4Translation(tx, ty, 0),
  );
  return { a: m[0]!, b: m[1]!, c: m[4]!, d: m[5]!, tx: m[12]!, ty: m[13]! };
}

/**
 * 把 2D 仿射套到一个点上（`(x,y) → (x·a + y·c + tx, x·b + y·d + ty)`；行向量序）。
 * 与 `snapshot.ts` 的 `before→after`、以及 `presenter.ts` 的父容器是**同一条式子**。
 */
export function sceneAffineApply(
  m: { a: number; b: number; c: number; d: number; tx: number; ty: number },
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: x * m.a + y * m.c + m.tx, y: x * m.b + y * m.d + m.ty };
}

/**
 * 仿射的**旋转分量**（`atan2(b, a)`，与 `Item.rotRad` 同口径的弧度；Pixi 的 `Container.rotation` 直接可用）。
 * 只在"两轴缩放相同"时它才是完整的旋转（否则那个 2×2 带剪切，见 `sceneAffine2DOf` 的说明）。
 */
export function sceneAffineRotation(m: { a: number; b: number }): number {
  return m.a === 0 && m.b === 0 ? 0 : Math.atan2(m.b, m.a);
}

/**
 * **把 Scene 世界矩阵按引擎的左右序叠加到一个绘制项的 work 矩阵结果上**。
 *
 * 左右序（按体，不凭直觉）：RenderScene raw 133407 是
 * `D3DXMatrixMultiply(Scene+46536 /* dst *\/, Scene+46536 /* a *\/, Scene+46600 /* b *\/)`，
 * 即 `work ← work · sceneWorld`。D3DX 的矩阵是**行向量**约定（`v' = v·M`）⇒
 * `v·(work·sceneWorld) = (v·work)·sceneWorld` ⇒ **Scene 变换作用在"该项自己变换完"的点上**
 * （屏幕空间），平移分量因此**不被该项的缩放旋转放大**。项自身的组合序仍是既有的
 * `T(−pivot)·S·R·T(t)·T(pos)`（`itemRenderPlacement`），Scene 那一级**接在它后面**。
 *
 * `scale` 的取值 = 2×2 两列的**长度**（= 引擎 `D3DXMatrixDecompose` 给出的两轴缩放）；
 * Scene 的**旋转分量不在返回值里**（`Affine2D` 的 `scale` 只承载缩放）—— 需要旋转的调用方
 * （`presenter.ts`）用 `sceneAffine2DOf` + 父容器施加，见那里的说明。
 * ★**缩放/旋转是绕屏幕原点 (0,0) 的**（不是绕项的中心）—— 这是 `v·S`/`v·R` 的直接后果。
 *
 * @returns **已叠加**的 `{position, scale}`；`layer` 不在区间内或四块矩阵全默认 ⇒ 原对象返回。
 */
export function applySceneXformToPlacement<T extends Affine2D>(s: SceneState, layer: number, pl: T): T {
  const m = sceneAffine2DOf(s, layer);
  if (!m) return pl;
  const p = sceneAffineApply(m, pl.position.x, pl.position.y);
  // 两轴缩放 = 两列长度（行向量矩阵：第一列 = (M11,M12) = (a,b)、第二列 = (M21,M22) = (c,d)）。
  const sx = Math.hypot(m.a, m.b);
  const sy = Math.hypot(m.c, m.d);
  return {
    ...pl,
    position: p,
    scale: { x: pl.scale.x * sx, y: pl.scale.y * sy },
  };
}

/**
 * 取（必要时新建）Scene 变换锚；`kind` 只是**"最近一次下发的是哪一种"的参考字段**
 * （引擎 `Scene[306] = 1` —— 四条指令都写同一个值，体上不可区分）。
 *
 * ★**它不再是合成选择子**（修前 `applySceneXformToPlacement` 按 `kind` 三选一 ⇒ 跨种类混用
 * 只剩最近一次那一种）。现在合成走 `sceneAffine2DOf` 的四块矩阵乘积，`kind` 只供快照/诊断。
 */
function sceneXformOf(s: SceneState, kind: SceneXformKind): SceneXform {
  s.sceneXform ??= {
    kind,
    scale: { x: 1, y: 1, z: 1 },
    translate: { x: 0, y: 0, z: 0 },
    axisScale: { x: 1, y: 1, z: 1 },
    axisTranslate: { x: 0, y: 0, z: 0 },
    axis: { x: 0, y: 0, z: 0 },
    maskA: null,
    maskB: null,
  };
  s.sceneXform.kind = kind;
  return s.sceneXform;
}

/**
 * `0x22A`（`sub_424080` raw 32003-32016 → `sub_49A720` raw 117117-117126）：**Scene 级立即缩放**。
 * 体内三条操作数**全是 float**（`sub_41C300`，**无 handle 查表**）、**各 ÷ `dbl_5201F0`(=100)**；
 * 被调体写 `Scene[306] = 1`（变换种类）与 `D3DXMatrixScaling(Scene+307)`。
 * ★语料 2 处（`FIELD.txt:14360` / `LOOK.txt:108`）都是 `i22a (global-int b234) (global-int b234) 64`
 *   ⇒ 缩放 (1,1,1)。**指令仍然要真实现**（语料少不是不实现的理由）。
 */
export function scSetSceneScale(s: SceneState, sx: number, sy: number, sz: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const x = sceneXformOf(s, 'scale');
  x.scale = { x: sx, y: sy, z: sz };
}

/**
 * `0x22C`（`sub_424180` raw 32034-32046 → `sub_49A820` raw 117153-117162）：**Scene 级立即平移**。
 * 三条操作数都是 float（`sub_41C300`，无查表）、**不除**（像素）；被调体写 `Scene[306] = 1` 与
 * `D3DXMatrixTranslation(Scene+371)`。★与 `0x1FF`（改**某项**的 work 矩阵）**结构不同**：
 * 这条改的是 Scene 自己的变换块。
 */
export function scSetSceneTranslation(s: SceneState, x: number, y: number, z: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const xf = sceneXformOf(s, 'translate');
  xf.translate = { x, y, z };
}

/**
 * `0x22D`（`sub_4241F0` raw 32048-32064 → `sub_49A870` raw 117165-117179）：**Scene 级带轴缩放**。
 * `op1`/`op2` 走 **int** 池（`sub_41BF50`）→ `Scene[295]`/`Scene[300]`；`op3/4/5` 走 float 池、
 * **各 ÷100** → `D3DXMatrixScaling(Scene+323)`；被调体还写 `Scene[280] |= 2`、`Scene[293] = 0`。
 * ★语料 5 处：`i22d 0 258 (local-int 0) (local-int 1) 64` / `i22d 0 12c (global-int b234) (global-int b234) 64`
 *   ⇒ `op1` 恒为 0、缩放恒 (1,1,1)。
 */
export function scSetSceneAxisScale(s: SceneState, a: number, b: number, sx: number, sy: number, sz: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const x = sceneXformOf(s, 'axis-scale');
  x.axisScale = { x: sx, y: sy, z: sz };
  x.maskA = a;
  x.maskB = b;
}

/**
 * `0x22F`（`sub_424330` raw 32087-32103 → `sub_49A9C0` raw 117222-117236）：**Scene 级带轴成分**。
 * ★**以体订正筛体**：被调体写的是 **`D3DXMatrixTranslation(Scene+387)`**（`+323`/`D3DXMatrixScaling`
 * 属 `0x22D` 的 `sub_49A870`，筛体把两条的被调体记混了）；`op3/4/5` 是浮点分量、**不除**。
 * 被调体还写 `Scene[280] |= 2`、`Scene[293] = 0`、`Scene[297] = op1`、`Scene[302] = op2`。
 * ★语料 7 处（`ALLMAP:1393` / `FIELD:2203,11436` / `LOOK:98` / `MOVERUIN:176` / `REIGN:1015` /
 *   `SHOWALLMAP:150`），`op1` 恒为 0。
 *
 * ★★**这一条的 op3/4/5 在不同层上落到不同的矩阵块**（同一份 op 数，两条消费路径，依据 raw 117624-117632）：
 *  - **层号 ∉ [20,30)**：走 `D3DXMatrixMultiply(work, work, Scene+46600)` 那一支 ⇒ 拿到的是
 *    `sub_49AA30` 里 **`v121`（T(axisTranslate)）** 那一块 ⇒ 净效果 = **平移** `(op3, op4, op5)`；
 *  - **层号 ∈ [20,30)**：该支把 `v120` **重建成** `D3DXMatrixRotationAxis(a2 + 181, a2[184])` ——
 *    轴 = 这三格（元素 +724/+728/+732 = `a2[181..183]`）、角 = `a2[184]`（元素 +736）——
 *    然后 117930 把 `v120` 乘进 work ⇒ 这三格**是旋转轴**、不是屏幕空间 2D 平移。
 *    `a2` 那份"轴/角"由动画块 raw 117610-117620（`a2[181..184] = 轴/角`）与瞬时写 117242-117255
 *    （`*(float *)(this + 1624/1628/1632) = a4/a5/a6`、`+1640 = a7`；`j_D3DXMatrixRotationAxis(this + 1420, …)`）
 *    共同供给 ⇒ **`i22f` 自己只写"分量"，不写"轴"**，但两条路径消费的正是同一个三格。
 *    所以这里**同时**记两份：`axis`（旋转轴；给层 20..29 的合成）与 `axisTranslate`
 *    （平移分量；给非 [20,30) 的完整 3D 世界矩阵那一条路，emulator 尚未实现那条）。
 */
export function scSetSceneAxisTranslation(s: SceneState, a: number, b: number, x: number, y: number, z: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  const xf = sceneXformOf(s, 'axis-scale');
  xf.axis = { x, y, z }; // ★修前：这三格只落进 `axisTranslate`、且被当屏幕空间 2D 平移用
  xf.axisTranslate = { x, y, z };
  xf.maskA = a;
  xf.maskB = b;
}

/**
 * **Scene 变换记录里的"角"**（引擎 raw 117630 的 `a2[184]`，弧度）。
 *
 * ★`i22f` 的五个操作数里**没有角** —— 体上它是 `D3DXMatrixRotationAxis(v120, a2 + 181, a2[184])`：
 * 轴来自 `i22f` 的三格、**角来自元素自己的 `a2[184]`**（`a2` = 模板 `Scene+1120` 或它的副本
 * `sub_4AEEA0` 的 740 B 局部拷贝，raw 117641-117646）。`a2[184]` 的写点只有动画块（raw 117616）
 * 与瞬时写（raw 117255 `*(float *)(this + 1640) = a7`），**都不是 `i22f`**。
 *
 * ★**emulator 侧的卡点（如实披露）**：`RenderScene` 的层号支读的是 **`Scene` 自己那份**
 * `j_D3DXMatrixRotationAxis(v28, _this + 1844, *(float *)(_this + 1856))`（raw 133427，`_this` = Scene）
 * —— 即 Scene 字节 1844/1856 = **dword 461/464**。这两个格在反编译里**只有这一个读点、没有任何
 * 写点**（全文件检索 `1844`/`1856`/`461`/`464` 无写；Scene 的 465 格是 D3D 设备指针，
 * 与 `sub_49AA30` 的元素记录不同物）⇒ 它的运行期取值**无法从反编译静态判定**。
 * 故这里把它建成**显式模型字段**：默认 `0`（= 恒等旋转，画面与"修前"逐字节相同 —— 这是保守取法），
 * 由宿主经 {@link scSetSceneRotationRad} 注入。**未解析出的那个字段值**是本条唯一的已知缺口
 * （见 `presenter.ts` 的 `sceneXform2D` 说明与报告）。
 */
export function scSetSceneRotationRad(s: SceneState, rad: number): void {
  s.dirty = true; // ★模型变更 ⇒ 该重新合成一次（`tickets/T-0003`；判据在共享层 sceneNeedsRender）
  s.sceneRotRad = rad;
  // 只有角、四块矩阵全默认时也要有锚（否则 `sceneAffine2DOf` 提前返回"没下发过"）。
  sceneXformOf(s, 'axis-scale');
}

/**
 * **每帧推进 Live2D 动作 + 合成节点矩阵**（= 引擎"绘制 572B 节点那一次调用"里的 `sub_4BCB50`
 * 与 `sub_4A07F0`）。
 *
 * ★为什么是"共享层的一个 tick"而不是各宿主自己算：引擎里**动作推进、节点矩阵合成与出画是同一次调用**
 * （`sub_4B0360` → `sub_4A07F0` raw 134341 → `sub_4783D0`；能力条目 `live2d-node-draw-advance`，
 * raw 92578-92615），而且**只有"这一帧真的要画的节点"才推进** —— 槽空/节点没建的 L2D 不消耗时间轴。
 * 两个宿主（Pixi / headless）都必须经这里推进，否则"报告里的立绘"与"画面上的立绘"会处在
 * 动作时间轴的不同位置（同类漂移见 `sceneModel.ts` 顶部）。
 *
 * ★2026-09（`tickets/T-0096`）新增**节点矩阵合成**：引擎的合成器 `sub_4A07F0`
 * （raw 121131-121655）就在逐节点绘制里跑，所以这里同步跑一遍（写入 `node.matrix`，
 * 由 `live2d/render.ts` 的 `l2dNodeTransform` 读走）⇒ 桌面端画面与无头快照仍然是同一份几何。
 * 窗起点的锁存（`record+24 = 0 ⇒ now`，raw 121261-121265）也在这里发生 ⇒ **即使本帧 delta = 0
 * 也必须跑合成器**（否则第一条窗指令的起点会晚一帧才锁存）。
 *
 * @param nowMs 本帧时钟（与 `scAdvance` 同一个 `clockMs`；`dirty` 由本函数自己置）
 * @returns 参与本帧推进与合成的节点 key（诊断/报告用；空数组 = 本帧没有可画的 L2D 节点）
 */
export function scL2dTick(s: SceneState, nowMs: number): number[] {
  const host = s.l2dHost;
  if (!host) return [];
  const delta = s.l2dLastMs < 0 ? 0 : Math.max(0, nowMs - s.l2dLastMs);
  s.l2dLastMs = nowMs;
  // 只有"这一帧真的会画"的节点才推进（引擎同一条门控：槽里得有模型）
  const drawn = [...host.l2dNodes.values()].filter((n) => l2dNodeDrawable(host, n)).map((n) => n.key);
  if (drawn.length === 0) return [];
  if (delta > 0) {
    const overrides = l2dAdvance(host, delta, drawn);
    if (overrides.size > 0) s.dirty = true;
  }
  // ★节点矩阵合成：**每帧每节点一次**（与引擎同序：在出画之前）。帧级标志（`M[46512]` 的
  //   winSkip / `M[46528] & 4` 的 alpha 门）emulator 暂无对应字段 ⇒ 用引擎缺省值（都 false）。
  for (const key of drawn) {
    const node = host.l2dNodes.get(key);
    if (node) l2dComposeNodeAt(node, nowMs);
  }
  return drawn;
}
