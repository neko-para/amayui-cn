/**
 * **引擎 740 B DrawItem 记录 → emulator `Item`**（`tickets/T-0083`）。
 *
 * ## 为什么需要它
 *
 * 引擎的存档 body 里带着 **Scene 绘制项容器（`Scene+1032`）的全量快照**
 * （`sub_410160` raw 19806-19832）：`{u32 记录字节数 = 740, u32 count, (u32 handle + 740 B 记录) × count}`。
 * 装载时引擎**先整批清空那个容器**（raw 19810-19825 的 delete-walk + 哨兵复位 + `size = 0`），
 * 再把每条记录 `memcpy` 进一个 740 B 元素并插回去 ⇒ **上一屏的绘制项一个不留，画面 = 存档当时的场景**。
 *
 * 这就是 `--load 79` 画面错乱的根因：emulator 只解析了清单里的 handle（而且步长算错），
 * 记录体全被丢掉，于是上一屏（TITLE）的项留在 `scene.drawItems` 里，而装载又按存档把
 * 槽 4 重绑到 `BG050ABL`（2048×1152）⇒ TITLE 那些项（全用槽 4）按**标题屏的源矩形**采这张背景，
 * 就成了「天空碎片阶梯」（handle 0x12C/0x12E/0x130/0x132/0x134，156×156，dst (1102,294)/(992,402)/
 * (869,485)/(729,543)/(1107,554)）与那块采样越界（`0x64` 的 src y=1161 > 图像高 1152）的灰板。
 *
 * ## 偏移表（全部以体为准）
 *
 * | 记录偏移 | 字段 | 依据 |
 * |---|---|---|
 * | `+0` | `flags`（bit0 可见 / bit1 A 层窗 / bit2 B 层周期） | `ITEM_FLAG_*`；`sub_49A300` raw 116899 |
 * | `+4` | `tex`（纹理槽号） | `sub_4ACE50`（`0x1FB`）；raw 31287-31299 |
 * | `+8/+0xC/+0x10/+0x14` | 源矩形 **left/top/right/bottom** | `SetRect(a2+8,…)` raw 116901 |
 * | `+0x18/+0x1C/+0x20` | pivot（`0x217`） | `sub_4ACF20`；`sub_49A300` raw 116904-116910 |
 * | `+0x24/+0x28/+0x2C` | 描画位置（`0x219`） | `sub_4ACEE0`；`sub_49A300` raw 116911-116917 |
 * | `+0x30` | `blend` | `sub_49A300` raw 116919 |
 * | `+0x34` | `animStart`（全项共享的窗起点） | 5 个窗 setter 都写 `+52 = 0`（raw 131970/132002/…） |
 * | `+0x38..+0x48` / `+0x4C..+0x5C` | 5 个窗的 `delay` / `dur` | `sub_4AD0C0` raw 131968-131978（`+56`/`+76`）、`sub_4AD170`（`+60`/`+80`）、`0x239`（`+0x48`/`+0x5C`） |
 * | `+0x60` / `+0x64` | FROM / TO 色 | `sub_49A300` raw 116937-116946（初值 `-1`）、`0x203`/`0x202` |
 * | `+0x68` | `useWorld` | `sub_4AC5F0` raw 131342 / `sub_4AC750` raw 131414 写 `1` |
 * | `+0x6C` / `+0xAC` | 缩放矩阵（work / target，4×4 f32） | `sub_4AC5F0` raw 131349 `j_D3DXMatrixScaling(v7 + 108, …)` |
 * | `+0x16C` / `+0x1AC` | 平移矩阵（work / target，4×4 f32） | `sub_4AC750` raw 131421 `j_D3DXMatrixTranslation(v7 + 364, …)` |
 * | `+0x234/0x238/0x23C` | flipbook 标志 / 总帧数 / 每行列数 | `0x239`（raw 132119-132145） |
 * | `+524+4i` / `+544+4i` | B 层第 i 条通道的 `start` / `period`（i = 0..4） | `sub_49A300` raw 116995-117007 逐个写 524/544/528/548/…/540/560 |
 * | `+576` / `+580+4i` / `+592` / `+656` | B 层颜色目标 / 旋转轴 / 缩放矩阵 / 平移矩阵 | `sub_4AD730` raw 132255、`sub_4AD850` raw 132309-132311、`sub_4AD7B0` raw 132283、`sub_4AD900` raw 132339 |
 * | `+720` | `entryParam`（`0x242`） | `sub_4AD9A0` raw 132346-132361 |
 *
 * ## 两处**必须**按 D3DX 语义拆矩阵（不是"连续 3 个 f32"）
 *
 * 记录里那 4 个"矩阵"字段是**真正的 4×4 矩阵**（渲染期整块交给 D3D，raw 117431 `qmemcpy(v118, a2+27, 64)`），
 * 而 emulator 的 `Item` 把它们存成**分量**（`scaleWork: Vec3` = 缩放分量、`transWork: Vec3` = 平移分量）
 * —— 这是 emulator 侧的既有口径（`applyDrawScale`/`applyDrawTranslation` 就是把操作数写进这些分量、
 * 再由渲染端重新装配矩阵）。所以还原时必须按 D3DX 的写入位置取分量：
 *
 *  - `D3DXMatrixScaling(m, sx, sy, sz)` 只写**对角线** `m[0][0]/m[1][1]/m[2][2]`（行主序 = 字节
 *    `+0/+20/+40`）⇒ `scaleWork` = `{+0x6C, +0x80, +0x94}`、`scaleTarget` = `{+0xAC, +0xC0, +0xD4}`；
 *  - `D3DXMatrixTranslation(m, x, y, z)` 只写**第 4 行** `m[3][0..2]`（= 字节 `+48/+52/+56`）⇒
 *    `transWork` = `{+0x19C, +0x1A0, +0x1A4}`、`transTarget` = `{+0x1DC, +0x1E0, +0x1E4}`。
 *    这一条有**读取端自证**：`0x228`（`sub_430650`）就是取这份矩阵的平移分量 —— `sub_4AA060`
 *    raw 129543 `j_D3DXMatrixDecompose(v17, v11, v18, &v16[364])` 把**平移放在 `v18`** 交回调用方
 *    （raw 129562-129566 逐分量写回操作数），而 `D3DXMatrixDecompose` 的平移输出 = `m[3][0..2]`。
 *    实测（真槽 79 的 0x18A88 那条）：按此口径读出 `scaleWork=(1,1,1)`、`transWork=(0,0,0)`、
 *    `transTarget=(768,0,0)`（正是序章那条 80 s 慢推的 A 层平移窗，`+0x58` = 80000）；若按"连续 3 f32"
 *    读，缩放会全成 `(1,0,0)`、平移全成 `(0,0,0)` —— 静默把还原出来的项画错。
 *
 * ## 有意**不还原**的字段（不加猜测）
 *
 *  - `rotWork`/`rotTarget`（`+0xEC`/`+0x12C` 矩阵 + `+0x1EC..+0x208` 的轴/角）：模型里只登记了
 *    "轴/角在 `+0x1EC..+0x208`"这个**区间**，逐字段偏移未确证 ⇒ 保持默认（单位旋转），
 *    在注释里留名（`Item.rotWork` 的既有默认就是"不旋转"）。
 *  - `fbHold`：emulator 侧的每帧持久化（引擎对元素局部副本求值，raw 117828-117831）⇒ 没有对应字节，
 *    保持默认 `-1`。
 *  - `ownerFrame`：emulator 记账（引擎没有这一格）⇒ 一律 `-1`（"未知/不是本进程任何帧画的"，
 *    于是 `dropFrameItems` 那套 fallback 永远不会把还原出来的项当成"上一屏"丢掉，见 `tickets/T-0083`）。
 *
 * ## 已知缺口（如实登记，不在此处修）
 *
 *  `animStart` 是**引擎时钟**的绝对值（实测真槽 79 = `0x13C0EB57` ≈ 3.8 天，即 `timeGetTime` 那类
 *  自开机起的毫秒），而 emulator 的时钟是**本进程内的相对毫秒**（`pixiBackend.clockMs`）。
 *  逐字还原 ⇒ `clock − animStart − delay` 是很大的负数 ⇒ `winPhase` 判成 `before` ⇒ 求值取
 *  **work 矩阵那一份**（= 存档当时那份状态）⇒ 画面等于"存档那一刻"，只是动画不再继续推进。
 *  要在 emulator 侧接着推进需要"存档时的引擎时钟"这个锚点，body 里没有 ⇒ 保持逐字还原 + 本注记。
 */
import type { AnimWin, Item, LoopWin, Vec3 } from '../renderer/drawItem.js';

/** 引擎 740 B DrawItem 元素的字节数（`0x2E4`）。 */
export const ENGINE_DRAW_ITEM_BYTES = 740;

/** 5 个动画窗的下标（与引擎 5 个窗一一对应，口径同 `drawItem.ts` 的 `W_*`）。 */
const W_COUNT = 5;

/** 一个 4×4 行主序矩阵里"对角线"三个元素的字节偏移（`D3DXMatrixScaling` 的写入位置）。 */
const M_DIAG = [0, 20, 40] as const;
/** 一个 4×4 行主序矩阵里"平移分量"三个元素的字节偏移（`D3DXMatrixTranslation` / `D3DXMatrixDecompose`）。 */
const M_TRANS = [48, 52, 56] as const;

function vec3(dv: DataView, base: number, offs: readonly [number, number, number] | readonly number[]): Vec3 {
  return { x: dv.getFloat32(base + offs[0]!, true), y: dv.getFloat32(base + offs[1]!, true), z: dv.getFloat32(base + offs[2]!, true) };
}

/** 从引擎记录里读一个"矩阵字段"的分量（`kind` 决定取对角线还是平移分量）。 */
function matVec(dv: DataView, base: number, kind: 'scale' | 'trans'): Vec3 {
  return vec3(dv, base, kind === 'scale' ? M_DIAG : M_TRANS);
}

/**
 * 把一条引擎 740 B DrawItem 记录解成 emulator `Item`。
 *
 * @param handle 清单里的 handle（= Scene map 的 key = 层序；记录体里**不存** handle）
 * @param record 恰好 740 B 的记录镜像（长度不符会抛 —— 调用方已按 `size === 740` 守卫过）
 */
export function decodeEngineDrawItem(handle: number, record: Uint8Array): Item {
  if (record.length !== ENGINE_DRAW_ITEM_BYTES) {
    throw new Error(`DrawItem 记录长度 ${record.length} ≠ ${ENGINE_DRAW_ITEM_BYTES}（调用方应先按 size 守卫）`);
  }
  const dv = new DataView(record.buffer, record.byteOffset, record.byteLength);
  const i32 = (at: number): number => dv.getInt32(at, true);
  const u32 = (at: number): number => dv.getUint32(at, true);

  // 源矩形在元素里存成 left/top/right/bottom（`0x1FB` 的 handler 先 SetRect 再写入）⇒ 宽高是差。
  const srcL = i32(0x8);
  const srcT = i32(0xc);
  const posX = dv.getFloat32(0x24, true);
  const posY = dv.getFloat32(0x28, true);

  const wins: AnimWin[] = [];
  for (let i = 0; i < W_COUNT; i++) {
    const delay = u32(0x38 + 4 * i);
    const dur = u32(0x4c + 4 * i);
    // 引擎里"配置过但 dur = 0"与"从未配置"必须区分（前者当帧立即收尾）⇒ 任一格非零即视为已配置。
    wins.push({ delay, dur, set: delay !== 0 || dur !== 0 });
  }
  const loops: LoopWin[] = [];
  for (let i = 0; i < W_COUNT; i++) loops.push({ start: u32(524 + 4 * i), period: u32(544 + 4 * i) });

  return {
    handle,
    layer: handle, // 元素内部不存层序（层序 = handle）
    ownerFrame: -1, // emulator 记账；还原出来的项不属于本进程任何帧
    tex: i32(0x4),
    srcX: srcL,
    srcY: srcT,
    srcW: i32(0x10) - srcL,
    srcH: i32(0x14) - srcT,
    pivotX: dv.getFloat32(0x18, true),
    pivotY: dv.getFloat32(0x1c, true),
    pivotZ: dv.getFloat32(0x20, true),
    posX,
    posY,
    posZ: dv.getFloat32(0x2c, true),
    blend: i32(0x30),
    animStart: u32(0x34),
    wins,
    from: u32(0x60) >>> 0,
    to: u32(0x64) >>> 0,
    useWorld: u32(0x68) !== 0,
    scaleWork: matVec(dv, 0x6c, 'scale'),
    scaleTarget: matVec(dv, 0xac, 'scale'),
    // ★旋转：记录里是 `+0xEC`/`+0x12C` 两个 4×4 矩阵 + `+0x1EC..+0x208` 的轴/角，但逐字段偏移未确证
    //   ⇒ 不还原（保持默认"不旋转"），见本文件头"有意不还原的字段"。
    rotWork: { axis: { x: 0, y: 0, z: 0 }, deg: 0 },
    rotTarget: { axis: { x: 0, y: 0, z: 0 }, deg: 0 },
    transWork: matVec(dv, 0x16c, 'trans'),
    transTarget: matVec(dv, 0x1ac, 'trans'),
    fbFlags: i32(0x234),
    fbFrames: i32(0x238),
    fbCols: i32(0x23c),
    fbHold: -1, // emulator 侧的每帧持久化（引擎求值在局部副本上）⇒ 无对应字节
    dstX: posX, // 仅诊断：引擎的"描画位置"就是绘制位置
    dstY: posY,
    loops,
    loopTo: u32(576) >>> 0,
    loopScale: matVec(dv, 592, 'scale'),
    loopAxis: vec3(dv, 580, [0, 4, 8]),
    loopTrans: matVec(dv, 656, 'trans'),
    flags: u32(0) >>> 0,
    entryParam: u32(720) >>> 0,
  };
}
