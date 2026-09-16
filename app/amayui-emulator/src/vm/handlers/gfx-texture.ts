/**
 * 纹理槽族：绑定 / 建纹理 / 释放 / 删区间 / 尺寸查询 / 槽变换 / 按槽绘制。
 *
 * 槽表 `Engine.texSlots`（槽号 → imgid）由 `0x1F9` set-texture 建立、`0x1FA` release-texture 清除；
 * `0x1FB` draw-texture 的 **op2 是槽号、op1 才是图元 handle/层序键**（2025 修正，见 README）。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, writeIntOperand } from '../operand.js';
import type { OpTable } from './shared.js';

/**
 * **`0x208`（sub_4302E0 → `sub_49ED60`, raw 39866）：纹理尺寸 getter（写回脚本操作数）**。
 * 引擎：`op1` = 纹理槽（合法 0..999）→ `sub_49ED60(Scene, slot, &w, &h)` 读该槽 `CTexture` 的
 * `+1040`（宽）/`+1044`（高）→ 分别 **写回 op2 / op3**（`sub_42B4B0`）。
 * ★这是一个**会写脚本操作数**的查询指令：漏实现会让脚本拿到未初始化的宽高并引发**脚本层逻辑错误**
 *   （不只是画面问题）；槽越界/未创建时引擎写 0/0 并只记日志（不改控制流）。
 */
const op_get_texture_size: OpHandler = (c) => {
  const slot = readIntOperand(c.e, c.frame, c.instr, 1);
  const size = slot <= 999 ? c.native.getTextureSize?.(slot) : undefined;
  writeIntOperand(c.e, c.frame, c.instr, 2, size?.w ?? 0);
  writeIntOperand(c.e, c.frame, c.instr, 3, size?.h ?? 0);
};



/** `0x344`（sub_427CB0, raw 34507）：**纹理槽变换**：读 op1/op2 → `sub_4AFBF0(_this+80708, op1, op2)`
 *  （`_this+274` 的 map：置 `|=1` 与 `[+4]=op2`）。emulator 无该 map → 记录式转发。 */
const op_set_texture_transform: OpHandler = (c) => {
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const value = readIntOperand(c.e, c.frame, c.instr, 2);
  c.native.setTextureTransform?.(handle, value);
};

/**
 * `0x249`（`sub_425310` raw 32717-32768）：**按统一 id 把纹理载入槽 `op2`（带颜色 `op3`）**。
 *
 * 引擎体（51 行，是 0x1F9 的"重型兄弟"）：
 * ```c
 * if (_this[op2 + 94672]) { sub_488FB0(old); (*old->vt)->dtor(old, 1); _this[op2+94672] = 0; }  // 先释放该槽
 * h = sub_4559C0(FileDB, hwnd, op1, &v);        // 按统一 id 打开图像文件（写 FileDB 的「已使用」表）
 * f = sub_455560(FileDB, h);                    // 取文件句柄
 * color = op3 < 0 ? 0 : (0xFF000000 | (op3&0xFFFFFF 重排为 BGR→RGB?));
 * if (sub_4A3800(Scene, op1, f, op2, color, 1) != 1) {   // ★失败
 *   关闭文件; sub_408050("画像ファイル %s の読み込みに失敗しました", FileDB.name(op1)); throw ShowMessage;
 * }
 * 关闭文件;
 * ```
 * ⇒ 与 `0x1F9` 同样是"槽 ↔ 图像"绑定，但**先释放旧槽对象**、带颜色、且**失败会抛异常**。
 * 语料：`i249` **20 处 / 8 个脚本**（`BTL` 7 / `ALLMAP` 3 / `MOVERUIN` 3 / `SHOWALLMAP` 3 / `ADDEXP` 1 …）。
 *
 * **emulator 取舍**：槽绑定 + 「已使用」标记 + `native.bindTexture` 与 `0x1F9` 一致；
 * 「文件不存在 ⇒ 抛 `画像ファイル %s の読み込みに失敗しました`」这条**归宿主**（`FileSource` 是异步接口，
 * handler 不能同步探测；宿主 `bindTexture` 拿不到图时按自己的缺口通道报告）。
 */
const op_load_texture_by_id: OpHandler = (c) => {
  const e = c.e;
  const imgid = readIntOperand(e, c.frame, c.instr, 1);
  const slot = readIntOperand(e, c.frame, c.instr, 2);
  const color = readIntOperand(e, c.frame, c.instr, 3);
  e.texSlots.set(slot, imgid);
  e.markFileUsed(imgid); // 引擎按 id 打开文件 ⇒ 写 FileDB 的「已使用」表（鉴赏解锁的判据）
  c.native.bindTexture?.(imgid, slot);
  if (color >= 0) c.native.setTextureObjectParam?.(slot, color); // 颜色随绑定下发（宿主可选）
};

/**
 * `0x245`（`sub_4251E0` raw 32661-32676）：**纹理对象的浮点参数**。
 * 引擎：`obj = Engine[op1 + 94672]`（CTexture 对象表）；存在则 `sub_4081B0(obj, op2 / dbl_51FB50)`
 * （把 op2 按常量缩放后写进对象的浮点字段）。emulator 无 CTexture 对象 ⇒ 转发给宿主的
 * 纹理对象参数缝（未实现该缝的宿主只当"记录"）。
 * 语料 0 处，但它是"对象属性面"的一员，且会写宿主可见的对象状态，故不 no-op。
 */
const op_texture_obj_float: OpHandler = (c) => {
  const slot = readIntOperand(c.e, c.frame, c.instr, 1);
  const value = readIntOperand(c.e, c.frame, c.instr, 2);
  c.native.setTextureObjectFloat?.(slot, value);
};

/**
 * `0x246`（`sub_425250` raw 32680-32700）：**纹理对象子对象的 vtable+56 调用**。
 *
 * 引擎：`obj = Engine[op1+94672]`；若 `*(obj+1084) == dword_52839C`（对象类型判定）
 * 则 `(**(obj+1044))+56` 用 `op2 / dbl_5201F0`（÷100，`dbl_5201F0` = 缩放常量）调用。
 * 即"对纹理对象的某个子对象下发一个浮点参数"。emulator 同 `0x245`：转发宿主缝。
 */
const op_texture_obj_param: OpHandler = (c) => {
  const slot = readIntOperand(c.e, c.frame, c.instr, 1);
  const value = readIntOperand(c.e, c.frame, c.instr, 2);
  c.native.setTextureObjectParam?.(slot, value);
};

/**
 * `0x1F8` create-texture（sub_422C20, raw 31161）：读 op1=槽、op2/op3/op4（w/h/mode）；
 * 引擎**先释放该槽旧纹理对象**（`_this[slot+94672]`：`sub_488FB0` + vtable delete + 置 0），
 * 再 `sub_4A2C10(_this+80708, slot, w, h, mode)` 新建 ⇒ 程序化/空白纹理（非文件图像）。
 * emulator：转发 `native.createTexture`（渲染器侧刷新该槽图像缓存）。
 */
const op_create_texture: OpHandler = (c) => {
  const slot = readIntOperand(c.e, c.frame, c.instr, 1);
  const w = readIntOperand(c.e, c.frame, c.instr, 2);
  const h = readIntOperand(c.e, c.frame, c.instr, 3);
  const mode = readIntOperand(c.e, c.frame, c.instr, 4);
  c.native.createTexture?.(slot, w, h, mode);
};

const op_release_texture: OpHandler = (c) => {
  // 0x1FA：op1=layer。
  const layer = readIntOperand(c.e, c.frame, c.instr, 1);
  c.native.releaseTexture?.(layer);
};

const op_draw_texture: OpHandler = (c) => {
  // `0x1FB`（sub_422E70）draw-texture：**op1 = 图元 handle（= Scene map 的 key，同时就是层序，越小越先画）**、
  // **op2 = 纹理槽号**、op3/4 = 源 x/y、op5/6 = 源 w/h、op7/8 = 目标 x/y。
  //
  // ★2025 重大修正（两位独立分析员核对 `Scene` 模型 + 脚本三方互证，见 .tmp/re-draw-container.md / re-texture.md）：
  //   - DrawItem 的 `+4` 存**纹理槽号**（= op2），渲染时用 `Scene+4*slot+42456` 取 `CTexture*`；
  //   - **层序 = map key = op1**，元素内部**不存 layer**。
  //   旧实现在这里把两者**写反了**（把 op1 当槽、op2 当层）→ present() 按"层号"取纹理全部落空 →
  //   退化成占位色块。这是"背景消失、只剩零星方块"的第二半原因（第一半是 present 里用 layer 查槽表）。
  const layer = readIntOperand(c.e, c.frame, c.instr, 1); // 图元 handle / 层序键
  const slot = readIntOperand(c.e, c.frame, c.instr, 2); // 纹理槽号
  const srcX = readIntOperand(c.e, c.frame, c.instr, 3);
  const srcY = readIntOperand(c.e, c.frame, c.instr, 4);
  const srcW = readIntOperand(c.e, c.frame, c.instr, 5);
  const srcH = readIntOperand(c.e, c.frame, c.instr, 6);
  const dstX = readIntOperand(c.e, c.frame, c.instr, 7);
  const dstY = readIntOperand(c.e, c.frame, c.instr, 8);
  if (!c.e.texSlots.has(slot)) c.e.texSlots.set(slot, 0);
  c.native.configureDrawItem?.({ handle: layer, layer, tex: slot, srcX, srcY, srcW, srcH, dstX, dstY });
};
const op_set_texture: OpHandler = (c) => {
  // `0x1F9`（sub_422CB0）set-texture：op1=imgid、op2=槽、op3=color（引擎：载入文件纹理并写槽记录 `[5*slot+466]=imgid`）。
  const imgid = readIntOperand(c.e, c.frame, c.instr, 1);
  const slot = readIntOperand(c.e, c.frame, c.instr, 2);
  c.e.texSlots.set(slot, imgid);
  // ★引擎在这里 `sub_4559C0` 按 id 打开图像文件 ⇒ 写 FileDB 的「已使用」表（`sub_454960`）。
  //   这正是「回想的 CG 鉴赏」判定某张 CG 是否解锁的途径（见 handlers/resource-usage.ts 的 0x19D）。
  c.e.markFileUsed(imgid);
  c.native.bindTexture?.(imgid, slot);
};

/** 0x1F7 detach-texture (sub_422BC0)：纹理/图形子系统方法。op1=handle、op2=count；count≤1 单参(删单)，count>1 双参(删 [handle,handle+count))。 */
const op_detach_texture: OpHandler = (c) => {
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const count = readIntOperand(c.e, c.frame, c.instr, 2);
  c.native.detachTexture?.(handle, count);
};

/** 纹理槽族（真实现；native 转发 + 槽表建模）。 */
export const GFX_TEXTURE_OPS: OpTable = [
  [0x1f8, op_create_texture], // 创建程序化纹理（释放旧槽对象）→ native.createTexture
  [0x208, op_get_texture_size], // 纹理尺寸 getter（写回 op2/op3）→ native.getTextureSize
  // ★`0x344` **已移出本表**（2026-09 语义订正）：它不是"纹理槽变换"，而是**建/绑 572B 立绘节点**
  //   （`sub_427CB0` → `sub_4AFBF0` raw 133937-133947：`record[0] |= 1`、**`record[1] = slot`**）。
  //   现归 `handlers/live2d.ts` 的 `LIVE2D_OPS`。留在本表时 `i344 14 0`（TITLE）会被当成纹理变换。
  [0x249, op_load_texture_by_id], // ★按统一 id 载纹理入槽（带颜色；先释放旧槽）→ native.bindTexture
  [0x245, op_texture_obj_float], // 纹理对象浮点参数 → native.setTextureObjectFloat
  [0x246, op_texture_obj_param], // 纹理对象子对象参数 → native.setTextureObjectParam
];

/** 纹理槽族的 native 转发（绘制/绑定/删除/变换）。 */
export const GFX_TEXTURE_NATIVE_OPS: OpTable = [
  [0x1f7, op_detach_texture], // → native.detachTexture（删单/区间）
  [0x1fa, op_release_texture], // → native.releaseTexture
  [0x1fb, op_draw_texture], // → native.configureDrawItem
  [0x1f9, op_set_texture], // → native.bindTexture
];

