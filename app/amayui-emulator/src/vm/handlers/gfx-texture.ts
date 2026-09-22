/**
 * 纹理槽族：绑定 / 建纹理 / 释放 / 删区间 / 尺寸查询 / 槽变换 / 按槽绘制。
 *
 * 槽表 `Engine.texSlots`（槽号 → imgid）由 `0x1F9` set-texture 建立、`0x1FA` release-texture 清除；
 * `0x1FB` draw-texture 的 **op2 是槽号、op1 才是图元 handle/层序键**（2025 修正，见 README）。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { readIntOperand, writeIntOperand } from '../operand.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import { decIntSlot } from '../ref.js';
import type { OpTable } from './shared.js';

/**
 * 取本族的**操作数计划视图**（`tickets/T-0082` 批次：纹理族（gfx-texture），10 条）；缺计划 = 编程错误。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：纹理族（gfx-texture）走操作数计划层，但没有声明计划`);
  return p;
}


/**
 * **`0x1F9`/`0x249` 共用的纹理颜色归一化**（两处 raw 逐字相同，`tickets/T-0086`）。
 *
 * 引擎 `sub_422CB0` raw 31225-31230（`0x1F9`）与 `sub_425310` raw 32750-32755（`0x249`）都是：
 * ```c
 * v6 = sub_41BF50(_this, 3);                       // 读 op3
 * if ( v6 < 0 ) v7 = 0;                            // ★负值落 0（不是"不下发"）
 * else v7 = (u8)v6 | ((BYTE1(v6) | (((v6 >> 16) | 0xFF00) << 8)) << 8);
 * ```
 * 结果作 `color` 传 `sub_4A3800(Scene, imgid, hFile, slot, color, 0|1)`。
 *
 * ★**口径与"只取低 3 字节 + 强置 A=0xFF"等价**：那个表达式的两步 `sar`+`<<8` 最终只保留
 * `op3` 的 bit0-23（`.lst` 里是 `sar`，算术右移；但因为随后都 `& 0xFF`/`movzx al`，结果与逻辑
 * 右移**逐位相同**）。★但**负值判定必须做在 i32 域上**（`v6 = op3 | 0` 再判 `< 0`）：`0x80123456`
 * 这种"高位字节为 1"的枚举值经 `| 0` 就是负数 ⇒ 引擎走 `v7 = 0`，**不是** `0xFF123456`。
 * 在 i32 域内则 `normalizeTextureColor(op3) === 0xFF000000 | (op3 & 0x00FFFFFF)`（已按低 24 位
 * 全枚举 + 边界值逐位核对）。
 *
 * ★`0x249` 此前是 `if (color >= 0) 原样下发`（负值**什么都不发**、正值**不置 A**）⇒ `T-0086` 订正。
 */
export function normalizeTextureColor(op3: number): number {
  const v6 = op3 | 0; // 引擎的操作数域是**有符号 i32**（`if (v6 < 0)` 判在这个域上，不是 JS 的 number）
  return v6 < 0 ? 0 : (v6 & 0xff) | (((v6 >>> 8) & 0xff) << 8) | (((v6 >>> 16) & 0xff) << 16) | 0xff000000;
}

/**
 * **`0x208`（sub_4302E0 → `sub_49ED60`, raw 39866）：纹理尺寸 getter（写回脚本操作数）**。
 * 引擎：`op1` = 纹理槽（合法 0..999）→ `sub_49ED60(Scene, slot, &w, &h)` 读该槽 `CTexture` 的
 * `+1040`（宽）/`+1044`（高）→ 分别 **写回 op2 / op3**（`sub_42B4B0`）。
 * ★这是一个**会写脚本操作数**的查询指令：漏实现会让脚本拿到未初始化的宽高并引发**脚本层逻辑错误**
 *   （不只是画面问题）；槽越界/未创建时引擎写 0/0 并只记日志（不改控制流）。
 */
const op_get_texture_size: OpHandler = (c) => {
  const plan = planFor(c);
  const slot = (plan.int(1) ?? 0);
  const size = slot <= 999 ? c.native.getTextureSize?.(slot) : undefined;
  plan.setInt(2, size?.w ?? 0);
  plan.setInt(3, size?.h ?? 0);
};



/**
 * `0x249`（`sub_425310` raw 32717-32768）：**按统一 id 把纹理载入槽 `op2`（带颜色 `op3`）**。
 *
 * 引擎体（51 行，是 0x1F9 的"重型兄弟"）：
 * ```c
 * if (_this[op2 + 94672]) { sub_488FB0(old); (*old->vt)->dtor(old, 1); _this[op2+94672] = 0; }  // 先释放该槽
 * h = sub_4559C0(FileDB, hwnd, op1, &v);        // 按统一 id 打开图像文件（写 FileDB 的「已使用」表）
 * f = sub_455560(FileDB, h);                    // 取文件句柄
 * color = op3 < 0 ? 0 : (0xFF000000 | (op3 & 0x00FFFFFF));   // ★raw 32750-32755，见 normalizeTextureColor
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
 * ★颜色口径见 `normalizeTextureColor`：此前这里是 `if (color >= 0)` **原样**下发（负值不下发、正值不置 A）
 *   ⇒ 与引擎分叉，`T-0086` 订正为与 `0x1F9` **共用同一处归一化**、负值**仍下发 0**。
 */
const op_load_texture_by_id: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const imgid = (plan.int(1) ?? 0);
  const slot = (plan.int(2) ?? 0);
  const color = (plan.int(3) ?? 0);
  e.texSlots.set(slot, imgid);
  e.markFileUsed(imgid); // 引擎按 id 打开文件 ⇒ 写 FileDB 的「已使用」表（鉴赏解锁的判据）
  c.native.bindTexture?.(imgid, slot);
  // raw 32750-32757：读 op3 ⇒ 归一化 ⇒ 作 `color` 传 `sub_4A3800(..., color, 1)`（负值也是 0，不是跳过）
  c.native.setTextureObjectParam?.(slot, normalizeTextureColor(color));
};

/**
 * `0x245`（`sub_4251E0` raw 32661-32676）：**纹理对象的浮点参数**。
 * 引擎：`obj = Engine[op1 + 94672]`（CTexture 对象表）；存在则 `sub_4081B0(obj, op2 / dbl_51FB50)`
 * （把 op2 按常量缩放后写进对象的浮点字段）。emulator 无 CTexture 对象 ⇒ 转发给宿主的
 * 纹理对象参数缝（未实现该缝的宿主只当"记录"）。
 * 语料 0 处，但它是"对象属性面"的一员，且会写宿主可见的对象状态，故不 no-op。
 */
const op_texture_obj_float: OpHandler = (c) => {
  const plan = planFor(c);
  const slot = (plan.int(1) ?? 0);
  const value = (plan.int(2) ?? 0);
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
  const plan = planFor(c);
  const slot = (plan.int(1) ?? 0);
  const value = (plan.int(2) ?? 0);
  c.native.setTextureObjectParam?.(slot, value);
};

/**
 * `0x1F8` create-texture（sub_422C20, raw 31161）：读 op1=槽、op2/op3/op4（w/h/mode）；
 * 引擎**先释放该槽旧纹理对象**（`_this[slot+94672]`：`sub_488FB0` + vtable delete + 置 0），
 * 再 `sub_4A2C10(_this+80708, slot, w, h, mode)` 新建 ⇒ 程序化/空白纹理（非文件图像）。
 * emulator：转发 `native.createTexture`（渲染器侧刷新该槽图像缓存）。
 */
const op_create_texture: OpHandler = (c) => {
  const plan = planFor(c);
  const slot = (plan.int(1) ?? 0);
  const w = (plan.int(2) ?? 0);
  const h = (plan.int(3) ?? 0);
  const mode = (plan.int(4) ?? 0);
  c.e.texSizes.set(slot, [w, h]); // 见 `Engine.texSizes`（0x23F 的尺寸来源）
  c.native.createTexture?.(slot, w, h, mode);
};

/**
 * **`0x23F`**（`sub_4307B0` raw 40019-40031，argc 2）：**`op1 = 槽 op2 的尺寸 ×1000；缺 ⇒ −1`**。
 *
 * 引擎体：`v2 = _this[sub_41BF50(_this, 2) + 94672]`（按 op2 取对象）；`v2 == 0` ⇒ `op1 = -1`，
 * 否则 `op1 = (int)(sub_4080B0(v2) * 1000.0)`（`dbl_51FB50 = 1000.0`，raw 4393；`sub_4080B0` = 该对象的
 * 尺寸 getter，体 raw 12960-12980，按 `node[+1084]` 分派 vtable `+40`/`+68`）。
 * ★**语料**：`0x23F` 3 处（FIELD×2、BTL×1），且 `op2` 是**刚 `create-texture` 出来的槽**
 * （`src/FIELD.txt:13718-13721`：`create-texture 2a 78 78 0` → `i23f (local-int 80e8) 2a`），
 * 该纹理 120×120 = **正方形** ⇒ **`sub_4080B0` 对应宽还是高，本文语料不可分辨**（如实披露，不猜）。
 * `0x23E`（`sub_430750`，同族另一半）**语料 0 处** ⇒ 登记 `deferred`。
 * emulator 侧尺寸来自 `0x1F8` 建槽时记下的 `Engine.texSizes`（AGF 载入的槽在 VM 侧无尺寸 ⇒ 同样回 −1）。
 */
const op_get_slot_size: OpHandler = (c) => {
  const plan = planFor(c);
  const slot = (plan.int(2) ?? 0);
  const sz = c.e.texSizes.get(slot);
  if (!sz) {
    plan.setInt(1, -1);
    return;
  }
  plan.setInt(1, Math.trunc(sz[0] * 1000));
};

const op_release_texture: OpHandler = (c) => {
  const plan = planFor(c);
  // 0x1FA：op1=layer。
  const layer = (plan.int(1) ?? 0);
  c.e.texSizes.delete(layer); // 见 `Engine.texSizes`
  c.native.releaseTexture?.(layer);
};

const op_draw_texture: OpHandler = (c) => {
  const plan = planFor(c);
  // `0x1FB`（sub_422E70）draw-texture：**op1 = 图元 handle（= Scene map 的 key，同时就是层序，越小越先画）**、
  // **op2 = 纹理槽号**、op3/4 = 源 x/y、op5/6 = 源 w/h、op7/8 = 目标 x/y。
  //
  // ★2025 重大修正（两位独立分析员核对 `Scene` 模型 + 脚本三方互证，见 .tmp/re-draw-container.md / re-texture.md）：
  //   - DrawItem 的 `+4` 存**纹理槽号**（= op2），渲染时用 `Scene+4*slot+42456` 取 `CTexture*`；
  //   - **层序 = map key = op1**，元素内部**不存 layer**。
  //   旧实现在这里把两者**写反了**（把 op1 当槽、op2 当层）→ present() 按"层号"取纹理全部落空 →
  //   退化成占位色块。这是"背景消失、只剩零星方块"的第二半原因（第一半是 present 里用 layer 查槽表）。
  const layer = (plan.int(1) ?? 0); // 图元 handle / 层序键
  const slot = (plan.int(2) ?? 0); // 纹理槽号
  const srcX = (plan.int(3) ?? 0);
  const srcY = (plan.int(4) ?? 0);
  const srcW = (plan.int(5) ?? 0);
  const srcH = (plan.int(6) ?? 0);
  const dstX = (plan.int(7) ?? 0);
  const dstY = (plan.int(8) ?? 0);
  if (!c.e.texSlots.has(slot)) c.e.texSlots.set(slot, 0);
  // ★**临时诊断（T-0102 白底，跑完即撤）**：ADV 窗口那两笔（handle 0x19640 / 0x19708，槽 0x11）在同一帧里
  //   是「黑幕支 vs 白纸窗支」的判决点 —— 脚本 `SC0000/SN0000` 的窗口例程是
  //   `eq local0, global0, 6` / `jcc` ⇒ `global 0 == 6` 走 `draw-texture … 11 …`（白纸窗），
  //   `!= 6` 走 `create-mesh 19640 + set-vertex-color …(f807d)… 0`（半透明黑幕）。
  //   把 `global 0` 与槽 0x11 的绑定**在指令本身上**打出来，就能一次定性：
  //   白纸窗 = `global 0` 真的读到 6（⇒ 查它的赋值路径），还是槽 0x11 没绑上（⇒ 查绑定/清记录）。
  if ((slot === 0x11 && layer === 0x19640) || (slot === 0x11 && layer === 0x19708)) {
    const g0 = c.e.globals.int.get(0);
    // ★关键：把 `eq … 6` 真正会读到的那份值（**解码后**）也打出来 —— 只打原始值无法判读。
    const g0dec = decIntSlot(c.e.key, g0);
    c.log(
      `[T-0102 诊断] draw-texture h=0x${layer.toString(16)} 槽=0x11 ` +
        `global0(原始)=${g0 === undefined ? '未写过' : '0x' + (g0 >>> 0).toString(16)} ` +
        `global0(解码)=${g0dec} ` +
        `texSlots[0x11]=${c.e.texSlots.has(0x11) ? '0x' + (c.e.texSlots.get(0x11) as number).toString(16) : '未绑定'}`,
    );
  }
  // ★`ownerFrame`（emulator 记账，引擎无此格）：读档装载点要丢掉"被放弃的调用方那一层 UI"
  //   （`tickets/T-0083` 的 (B) 步）⇒ 这里记下"这一项是哪一帧画的"。见 `Item.ownerFrame` 的依据说明。
  c.native.configureDrawItem?.({
    handle: layer,
    layer,
    tex: slot,
    srcX,
    srcY,
    srcW,
    srcH,
    dstX,
    dstY,
    ownerFrame: c.e.cur,
  });
};

/**
 * `0x1F9` set-texture（`sub_422CB0` raw 31192-31243，argc=3）：**槽 ↔ 图像绑定**。
 * 引擎：`op1` = 图像 id、`op2` = 槽、`op3` = 颜色。
 *  - 先释放该槽的旧纹理对象（`if (Engine[slot+94672]) { 释放; 置 0 }`，raw 31211-31221）；
 *  - `sub_4559C0(FileDB, hwnd, op1, &v)` 按 id 开文件（写 FileDB「已使用」表）→ `sub_455560` 取句柄；
 *  - ★**读 op3**（raw 31225-31230）并归一化：`op3 < 0 ⇒ 0`，否则 `(u8)op3 | ((BYTE1 | ((op3>>16 | 0xFF00)<<8))<<8)`
 *    —— 即拼成 `0xFFrrggbb`（A 通道**被强置 0xFF**，不是 0；负值判定在 i32 域上，见
 *    `normalizeTextureColor`）。与 `0x249`（`sub_425310` raw 32750-32755）**是同一段代码** ⇒ 共用一处实现；
 *  - `sub_4A3800(Scene, op1, hFile, op2, color, 0)` 载入（写槽记录 `[5*slot+466]=op1`）；
 *    失败 ⇒ 清句柄 + 抛 `画像ファイル %s の読み込みに失敗しました`（宿主侧，见 `0x249` 的同款说明）。
 * ★此前只读 op1/op2 ⇒ 审计 P2 的「`0x1F9` 丢掉第 3 操作数（颜色）」。已按体补上。
 */
const op_set_texture: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) return;
  const imgid = p.int(1) ?? 0;
  const slot = p.int(2) ?? 0;
  // ★op3 **引擎确实读**（raw 31225-31230 `v6 = sub_41BF50(_this, 3)`；`v6 < 0 ⇒ 0`，否则
  //   `(u8)v6 | ((BYTE1(v6) | (((v6>>16)|0xFF00)<<8)) << 8)` ⇒ 字节序无关地钳出 `0xFFrrggbb`），
  //   作为颜色参下发给 `sub_4A3800(Scene, imgid, hFile, slot, v12, 0)`（raw 31232）。
  //   此前这里只读 op1/op2（审计 P2 `0x1F9` 的"丢掉第 3 操作数"），op3 一格永不消费。
  //   传递方式与 `0x249`（同一函数的"重型兄弟"）一致：走宿主的纹理对象参数缝。
  const color = p.int(3) ?? 0;
  c.e.texSlots.set(slot, imgid);
  // ★引擎在这里 `sub_4559C0` 按 id 打开图像文件 ⇒ 写 FileDB 的「已使用」表（`sub_454960`）。
  //   这正是「回想的 CG 鉴赏」判定某张 CG 是否解锁的途径（见 handlers/resource-usage.ts 的 0x19D）。
  c.e.markFileUsed(imgid);
  c.native.bindTexture?.(imgid, slot);
  // 引擎的颜色参（`op3 < 0 ⇒ 0` + A 通道强置 `0xFF` 的归一化，raw 31226-31230）—— 与 `0x249` 共用
  // `normalizeTextureColor`（两处 raw 逐字相同；`T-0086` 已把 `0x249` 的旧写法也并过来）。
  c.native.setTextureObjectParam?.(slot, normalizeTextureColor(color)); // 颜色随绑定下发（宿主可选；见 native.ts 缝说明）
};

/** 0x1F7 detach-texture (sub_422BC0)：纹理/图形子系统方法。op1=handle、op2=count；count≤1 单参(删单)，count>1 双参(删 [handle,handle+count))。 */
const op_detach_texture: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const count = (plan.int(2) ?? 0);
  c.native.detachTexture?.(handle, count);
};

/** 纹理槽族（真实现；native 转发 + 槽表建模）。 */
export const GFX_TEXTURE_OPS: OpTable = [
  [0x1f8, op_create_texture], // 创建程序化纹理（释放旧槽对象）→ native.createTexture
  [0x23f, op_get_slot_size], // ★B3：槽尺寸 ×1000（缺槽 −1；0x23E 语料 0 处 ⇒ deferred）
  [0x208, op_get_texture_size], // 纹理尺寸 getter（写回 op2/op3）→ native.getTextureSize
  // ★`0x344` **已移出本表**（2026-09 语义订正）：它不是"纹理槽变换"，而是**建/绑 572B 立绘节点**
  //   （`sub_427CB0` → `sub_4AFBF0` raw 133937-133947：`record[0] |= 1`、**`record[1] = slot`**）。
  //   现归 `handlers/live2d.ts` 的 `LIVE2D_OPS`。留在本表时 `i344 14 0`（TITLE）会被当成纹理变换。
  [0x249, op_load_texture_by_id], // ★按统一 id 载纹理入槽（带颜色；先释放旧槽）→ native.bindTexture
  [0x245, op_texture_obj_float], // 纹理对象浮点参数 → native.setTextureObjectFloat
  [0x246, op_texture_obj_param], // 纹理对象子对象参数 → native.setTextureObjectParam
];

/**
 * **`0x20B` FillTexture**（`sub_423690` raw 31569-31592 → `sub_4A4C70` raw 124572 起，argc 7）：
 * **往纹理槽的表面上填一个纯色矩形**（引擎的"涂底色/进度条底"原语）。
 *
 * 引擎体逐字：
 * ```
 * arity 槽 = 15;                        // ⇒ argc 7（有据）
 * v7 = op2; v8 = op3;                   // 左上角
 * v9 = v7 + op4; v10 = v8 + op5;        // ★op4/op5 是**宽/高**（不是右下角坐标）
 * v2 = min(op6, 255);                   // α 夹到 255
 * v3 = op7; v6 = (v3 & 0xFF) | (((v3>>8 & 0xFF) | (((v3>>16) | 0xFF00) << 8)) << 8);  // ⇒ 0xFFRRGGBB（A 固定 FF）
 * sub_4A4C70(Scene, op1, &rect, v6, v2);
 * ```
 * `sub_4A4C70` 先取 `Scene[slot+10614]` 的纹理对象；**没有**就打「FillTexture」错误串（dst/tex 各一句）⇒ 不画。
 * ★语料 **204 处 / 187 个脚本**（DRAWMINIMAP / INFOFA / `$1$SC0330` / SC0820 / SC1820 / SC4160 …）；
 *   此前未注册 ⇒ 命中即 `NotImplementedOp`（审计 P1 `op-7-0x20b-doc-semantics-but-unimplemented`）。
 * ★文档的括注「op4=op2+宽」写反了：体里 `op4/op5` 本身就是宽/高（已同步订正 `opcode-table.md`）。
 */
const op_fill_texture: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const slot = (plan.int(1) ?? 0);
  const x = (plan.int(2) ?? 0);
  const y = (plan.int(3) ?? 0);
  const w = (plan.int(4) ?? 0);
  const h = (plan.int(5) ?? 0);
  const a = Math.min((plan.int(6) ?? 0), 255);
  const rgb = (plan.int(7) ?? 0);
  c.native.fillSlotRect?.(slot, x, y, w, h, 0xff000000 | (rgb & 0xffffff), a);
};

/** 纹理槽族的 native 转发（绘制/绑定/删除/变换）。 */
export const GFX_TEXTURE_NATIVE_OPS: OpTable = [
  [0x1f7, op_detach_texture], // → native.detachTexture（删单/区间）
  [0x1fa, op_release_texture], // → native.releaseTexture
  [0x1fb, op_draw_texture], // → native.configureDrawItem
  [0x1f9, op_set_texture], // → native.bindTexture
  [0x20b, op_fill_texture], // ★FillTexture：往槽表面填纯色矩形（语料 204 处/187 脚本；审计 P1 缺口）
];

