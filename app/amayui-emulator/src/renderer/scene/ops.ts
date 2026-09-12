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
import type { DrawItemConfig, Item, MeshObj } from '../drawItem.js';
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
  makeDefaultItem,
  makeItem,
  makeMesh,
  advanceWindows,
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
  // ★文本窗也要清：引擎 D3D 路径下正文行**就是** Scene 的 DrawItem（id = 行号 + win+104），
  //   `sub_4AB7A0` 清整张 DrawItem 表时它们一起没；GDI 路径下会被重画的画面盖掉。
  //   漏掉这一步的症状：**回到标题/主界面后，上一页的消息文字又画在主界面之上**（2026 实测）。
  scMsgWinClearAll(s);
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
 * `0x1FD` 立即缩放（`sub_4AC5F0`：建项 → **无门控** → `+0x68=1` + 缩放 **work** 矩阵）。
 * ★缺了它不会报错，只会让"靠缩放撑开的中段贴片"退回源尺寸（1px ⇒ 看不见）：
 *   CONFIG1 右侧滚动条拇指 = 上盖(27×23) + **中段(27×1，靠本条放大到 y=209)** + 下盖(27×24)。
 */
export function scSetScale(s: SceneState, handle: number, sx: number, sy: number, sz: number): SetterOutcome {
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
  const frame = layoutWindow(win, input);
  s.msgWins.set(win, frame);
  s.msgRev.set(win, (s.msgRev.get(win) ?? 0) + 1);
  return frame;
}

/** 清空一个消息窗（引擎 `0x85` 清行队列 / `0x301` 删绘制项区间 / `0x71` 开始新一段）。 */
export function scMsgWinClear(s: SceneState, win: number): void {
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
export function scDrawString(s: SceneState, slot: number, x: number, y: number, text: string): void {
  const list = s.slotText.get(slot);
  if (list) list.push({ x, y, text });
  else s.slotText.set(slot, [{ x, y, text }]);
}

/** `0x1F8` create-texture：新建/重建该槽 ⇒ 槽上的直绘文本随之清空（引擎是新表面）。 */
export function scCreateTextureReset(s: SceneState, slot: number): void {
  s.slotText.delete(slot);
}

/** 全部清空（引擎 `op_exit_script` 的 `msgwin.reset()` 语义）。 */
export function scMsgWinClearAll(s: SceneState): void {
  for (const win of [...s.msgWins.keys()]) scMsgWinClear(s, win);
}
