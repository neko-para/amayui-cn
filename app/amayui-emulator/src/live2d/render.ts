/**
 * Live2D **出画几何**：把求值后的模型顶点变成"能直接画/能直接断言"的三角批次。
 *
 * ## 为什么单独一层（而不是把这段写进 Pixi 的 presenter）
 * 快照（`renderer/scene/snapshot.ts`）与画面（`renderer/pixi/presenter.ts`）必须**同源** ——
 * 否则又会出现"报告说有 60 个网格、屏幕上一片空白"这类不可诊断的漂移（同类事故见
 * `renderer/sceneModel.ts` 顶部）。所以几何/摆放/纹理号分组只在这里算一次，两个消费方都读它。
 *
 * ## 摆放（O，逐行确证）
 * 引擎在 `sub_4B0360`（raw 134277-134396）里自建正交投影与中心平移：
 *
 * ```c
 * v25 = sub_478490(inst);   // = ModelImpl+12 = 画布宽（.moc 头里的 canvasWidth）  raw 92624
 * v23 = sub_4784B0(inst);   // = ModelImpl+16 = 画布高                              raw 92636
 * v22 = 显示高; v17 = 显示宽;                                                       raw 134350-134353
 * D3DXMatrixOrthoLH(proj, v17, -v22, -1.0, 1.0);                                    raw 134354
 * D3DXMatrixTranslation(world, -0.5*v25, 0.5*v22 - 0.5*v23, 0);                     raw 134374-134376
 * ```
 *
 * D3D 的行向量约定 + 视口变换（`sx = (ndc_x+1)·W/2`、`sy = (1-ndc_y)·H/2`）化简后就是
 * **画布中心对齐屏幕中心**：
 *
 * ```
 * screen = model + ((viewW - canvasW)/2, (viewH - canvasH)/2)
 * ```
 *
 * ★**画布尺寸只进"居中平移"、不进缩放**：投影用的宽度/高度是**显示尺寸**，
 * 而 `.moc` 的 `canvasWidth/Height` 只决定平移量 ⇒ 模型按 **1:1 像素**出画。
 * TITLE.MOC 的画布恰好是 `1280x720` ⇒ 平移量 `(0,0)`、模型坐标直接就是屏幕坐标
 * （实测：`src/tools/_l2dgeom.ts` 的 dump 与 `raw-parts/DATA6/TITLE.MOC`）。
 *
 * ## 顶点/UV（O，逐行确证）
 *  - 位置流 = 每顶点 12 字节 `{x, y, alpha}`（`sub_4C1EA0` raw 148038-148053 只拷前 12 字节）；
 *  - UV 流 = 每顶点 8 字节，**直接从 `.moc` 的 `+60 uvs` 原样 memcpy**（`sub_4C8620`
 *    raw 153065-153069）⇒ **UV 不做任何翻转**（D3D 与 WebGL/Pixi 的纹理原点都在左上）；
 *  - 索引 = 三角形列表（`sub_4C8620` raw 153076/153087 拷 `6*polygonCount` 字节，
 *    `sub_4C1EA0` raw 148068 以 `PrimitiveType=4`/`PrimCount=idx/3` 提交）。
 *
 * ## 已知未建模（写在缺口里，不假装支持）
 *  - **572B 节点的 `+508` 4x4 矩阵**：`sub_49CA10`（raw 118402-118512）把它初始化成**单位阵**
 *    （`+508/+528/+548/+568 = 1.0`），只有 `0x346`-`0x34D` 会动它；而**本作语料对节点的用法
 *    只有 `0x344`**（`src/TITLE.txt:590`）⇒ 出画路径恒为单位阵。`l2dNodeTransform()` 是这条
 *    结论的落点（返回单位变换），将来要支持 `0x347`-`0x34D` 时改它一处。
 *  - **`.MTN` 的 `LAYOUT:`**：语料 237 个动作里 236 个是引擎缺省（`X=1024 / Y=512 / SCALE=1`
 *    = 2048x1024 参考画布的正中、不缩放）；剩下 5 个 `Y=1024` 会整体下移半个参考高。
 *    本作 TITLE 用的是缺省值 ⇒ 当前按"不影响摆放"处理（未逐行确证参考画布口径）。
 *  - **裁剪**：引擎 `+64` 选 blend、`optionFlag & 0x20` ⇒ cull NONE（默认是背面剔除）。
 *    Pixi 的 2D 管线不做背面剔除 ⇒ 不剔除是**超集**（多画的那些面在 alpha 混合下无害）。
 *
 * ## ★批次粒度 = **一个网格一次提交**（不是按纹理号合并）
 * 引擎对**每个 DrawData** 单独提交一次 `DrawIndexedPrimitive`（`sub_4C1EA0` raw 148068），
 * 而每个顶点写进位置流的 alpha **就是这个 DrawData 的 opacity**（同一个值写满它的所有顶点，
 * 见 `sub_4C88B0` raw 153207）。所以：
 *
 *  - 按**网格**切批次 ⇒ 每批一个 `opacity` 是**精确**的（不是近似）；
 *  - 按**纹理号合并**（早期实现）是**错的**：只要批里有一个 `opacity = 0` 的网格，
 *    整批就被压成 0 —— 实测 TITLE 的 `D_EYE.09`/`D_EYE.10`（当前参数下 op=0）正好落在
 *    角色那张纹理（tex 0，3062 个三角形）里 ⇒ **整个角色消失**，屏幕上只剩背景与特效；
 *  - 也不能按 `(纹理号, opacity)` 合并：那会让同一纹理上 opacity 不同的网格被拆成两组
 *    先后画，**破坏 drawOrder**。
 */
import type { DrawDataFrame, ModelFrame } from './deform.js';
import { evaluateModel } from './deform.js';
import type { L2dInstance, L2dNode } from './runtime.js';
import { l2dNodeDrawable } from './runtime.js';

/**
 * 出画需要的**最小宿主面**：只有实例槽表与节点表。
 *
 * 比 `L2dHost` 窄（不含动作缓存、不含 `fileSource`）⇒ `L2dSnapshotHost`（快照只声明读得到的
 * 那些）也能直接传进来，而不必为了类型去伪造一个没人读的字段。
 */
export interface L2dRenderHost {
  readonly l2dSlots: Map<number, L2dInstance>;
  readonly l2dNodes: Map<number, L2dNode>;
}

/** 一个网格的三角形（= 引擎对一个 `DrawData` 的一次 `DrawIndexedPrimitive`）。 */
export interface L2dMeshBatch {
  /** 572B 节点的 map key（= `0x344` 的 op1，也是**归并键**）。 */
  key: number;
  /** 节点 `+4`：L2D 实例槽。 */
  slot: number;
  /** 网格 id 名（`.moc` 里的 `D_xxx`；诊断用）。 */
  id: string;
  /** 部件 id 名（诊断用）。 */
  partId: string;
  /** 绘制序（同节点内越小越先画；已按它排序）。 */
  drawOrder: number;
  /** 模型内纹理号（`0x345` 的 op3）。 */
  textureNo: number;
  /** 该纹理号绑的图像**统一文件 id**（`0x345` 的 op1）；`null` = 还没绑。 */
  textureFileId: number | null;
  /** `0x34F` 的乘色（`get(-1)`）；`null` = 没设过。 */
  mulColor: number | null;
  /** 画布坐标顶点（x,y 交错，已含居中平移）。 */
  positions: Float32Array;
  /** UV（与 `positions` 同长，**未翻转**）。 */
  uvs: Float32Array;
  /** 三角形列表索引（已按批次内的顶点偏移重定基）。 */
  indices: Uint32Array;
  /** 这个网格的 alpha（= 引擎写进它每个顶点的位置流第 3 个 float；`0` = 本帧不画）。 */
  opacity: number;
  /** 网格把 `+64` 标成不剔除（`optionFlag & 0x20`）。 */
  cullNone: boolean;
  vertexCount: number;
  triangleCount: number;
  /** 变形后顶点的外接矩形（画布坐标）。 */
  rect: { x: number; y: number; w: number; h: number };
}

/** 画布居中平移量（见文件头推导）。 */
export function l2dPlacement(
  canvasW: number,
  canvasH: number,
  viewW: number,
  viewH: number,
): { dx: number; dy: number } {
  return { dx: (viewW - canvasW) / 2, dy: (viewH - canvasH) / 2 };
}

/**
 * 572B 节点的变换（引擎 `sub_4A07F0` 装出来的 `+508` 4x4）。
 *
 * ★当前恒为单位变换，**且这是已知缺口**：`sub_49CA10`（raw 118402-118512）把 `+508` 初始化成单位阵，
 * 只有 `0x346`-`0x34D` 会动它；`sub_4B0360` 在 `Scene+46532`（"有节点矩阵"位，raw 134385）非 0 时
 * 才把 `Scene+46536` 乘进世界矩阵。而 `Scene+46536` 由 `sub_4A07F0`（raw 121131-121520）从节点记录
 * **逐窗求值**后合成（缩放 `record+80`/`+144`、旋转 `+208`/`+272`、平移 `+336`/`+400`、
 * 基础偏移 `record[2..4]`，含 `delay/dur` 插值）——**那个合成器整体未实现**，所以：
 *  - `L2dNode` 上的 `scale`/`rotation`/`translate`/`baseOffset`/`wins` 已按体落值（`0x346`-`0x34D`），
 *    但**没有消费端**（本函数就是那个唯一的落点）；
 *  - 本作语料对节点只用 `0x344` 建节点（`src/TITLE.txt:590`）`0x346`-`0x34D` 里只有
 *    `0x349`(7)/`0x34D`(12, BTL) 有命中 ⇒ 出画路径在实际语料下确实是单位变换；
 *  - 要接上它，就在本函数里把 `sub_4A07F0` 的合成实现出来（当前签名返回各向同性 scale + 平移，
 *    要支持轴角旋转得先把它扩成 2x3 仿射 —— 那是这次范围之外的工作，故不在此凭空近似）。
 */
export function l2dNodeTransform(_node: L2dNode): { scale: number; tx: number; ty: number } {
  return { scale: 1, tx: 0, ty: 0 };
}

/** 按 `.moc` 的初始 visible 位 + 实例上的 `VISIBLE:` 覆盖（`.MTN` / `0x34C` 等）过滤并排序。 */
function flattenVisible(frame: ModelFrame, inst: L2dInstance): { partId: string; dd: DrawDataFrame }[] {
  const out: { partId: string; dd: DrawDataFrame }[] = [];
  for (const p of frame.parts) {
    if (!(inst.partVisible.get(p.id) ?? p.visible)) continue;
    for (const dd of p.drawables) out.push({ partId: p.id, dd });
  }
  out.sort((a, b) => a.dd.drawOrder - b.dd.drawOrder);
  return out;
}

/**
 * 把宿主里**这一帧真的会出画**的 L2D 节点算成三角批次。
 *
 * 门控与引擎逐字对齐：`节点+0 bit0` 且 `节点+4` 指向的槽**真有模型**（raw 134320）——
 * 槽空 ⇒ 整块不出画、**无日志无错误**（这是"脚本在跑、画面什么都没有"的成因）。
 * 所以这里**不抛错、不占位**：过滤掉就是引擎的行为。
 *
 * @param viewW/viewH 显示尺寸（引擎 `Scene+1100/+1104`，即投影用的宽高）。
 * @param keys 只要这些节点 key（缺省 = 全部）；传入 `[]` 时返回空。
 */
export function l2dBatches(
  host: L2dRenderHost,
  viewW: number,
  viewH: number,
  keys?: number[],
): L2dMeshBatch[] {
  const out: L2dMeshBatch[] = [];
  const nodes = [...host.l2dNodes.values()].sort((a, b) => a.key - b.key);
  for (const node of nodes) {
    if (keys && !keys.includes(node.key)) continue;
    if (!l2dNodeDrawable(host, node)) continue;
    const inst = host.l2dSlots.get(node.slot);
    const model = inst?.model;
    if (!inst || !model) continue; // 与 l2dNodeDrawable 同一条门（双保险，语义也更清楚）

    const frame = evaluateModel(model, { get: (name) => inst.params.get(name) ?? 0 });
    const drawables = flattenVisible(frame, inst);
    if (drawables.length === 0) continue;

    const { dx, dy } = l2dPlacement(model.canvasWidth, model.canvasHeight, viewW, viewH);
    const nt = l2dNodeTransform(node);
    const mulColor = inst.textures.get(-1) ?? null;

    // ★**一个网格一个批次**（= 引擎的一次 DrawIndexedPrimitive），顺序 = drawOrder。
    //   理由见文件头"批次粒度"：按纹理号合并会让 op=0 的网格把整张纹理压成全透明。
    for (const { partId, dd } of drawables) {
      const n = (dd.points.length / 2) | 0;
      const indexCount = dd.indices.length;
      if (n < 3 || indexCount < 3) continue;

      const positions = new Float32Array(n * 2);
      const uvs = new Float32Array(n * 2);
      const indices = new Uint32Array(indexCount);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const mx = dd.points[i * 2]!;
        const my = dd.points[i * 2 + 1]!;
        const px = mx * nt.scale + nt.tx + dx;
        const py = my * nt.scale + nt.ty + dy;
        positions[i * 2] = px;
        positions[i * 2 + 1] = py;
        uvs[i * 2] = dd.uvs[i * 2] ?? 0;
        uvs[i * 2 + 1] = dd.uvs[i * 2 + 1] ?? 0;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
      for (let k = 0; k < indexCount; k++) indices[k] = dd.indices[k] ?? 0;
      if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue;

      const textureNo = dd.textureNo;
      out.push({
        key: node.key,
        slot: node.slot,
        id: dd.id,
        partId,
        drawOrder: dd.drawOrder,
        textureNo,
        // ★`textureNo == -1` = ".moc 说这个网格没有纹理"（`MocDrawData.textureNo` 的口径）；
        //   而实例表里的 `-1` 号键是 `0x34F` 的**乘色记录**（见 `l2dTextureMulColor`）——
        //   两者语义完全不同，混起来会把一个颜色值当成文件 id。所以这里显式挡掉负数。
        textureFileId: textureNo >= 0 ? inst.textures.get(textureNo) ?? null : null,
        mulColor,
        positions,
        uvs,
        indices,
        opacity: Math.max(0, Math.min(1, dd.opacity)),
        cullNone: !dd.culling,
        vertexCount: n,
        triangleCount: (indexCount / 3) | 0,
        rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      });
    }
  }
  return out;
}

/** 批次总顶点/三角形数（诊断与断言用）。 */
export function l2dBatchTotals(batches: L2dMeshBatch[]): { vertices: number; triangles: number } {
  let vertices = 0;
  let triangles = 0;
  for (const b of batches) {
    vertices += b.vertexCount;
    triangles += b.triangleCount;
  }
  return { vertices, triangles };
}
