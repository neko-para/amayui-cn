/**
 * 场景模型状态（= 引擎 `Scene` 在 emulator 侧的可见部分）。
 */
import type { Item, MeshObj } from '../drawItem.js';
import type { TextFrame } from '../../text/layout.js';

/** 场景模型状态（= `Scene` 在 emulator 侧的可见部分）。 */
export interface SceneState {
  drawItems: Map<number, Item>;
  meshes: Map<number, MeshObj>;
  /** `0x203` 的 op2 混合模式是否曾被写入（用于死写/缺口自检；当前渲染器不消费它）。 */
  blendWritten: Map<number, number>;
  /**
   * **消息窗文本**（引擎里是「每窗一张离屏表面 + 逐行显现」，见
   * `docs-new/03-engine/adv-text-rendering.md` §3）。键 = 窗索引（0..9）。
   *
   * 与 drawItems 的关系：引擎在 D3D 路径下把每行文本登记成 DrawItem（平面号 = 20+win）、
   * 在 DD 路径下直接 blit 到表面 0；重写侧统一为「每窗一张纹理 + 一个 Sprite（层序 20+win）」，
   * 两种观感等价而实现单一。**文本不是 DrawItem**，所以放在这里而不是 `drawItems`。
   */
  msgWins: Map<number, TextFrame>;
  /** 每个窗的**内容版本号**：宿主据此判断纹理是否需要重新光栅化（递增即重画）。 */
  msgRev: Map<number, number>;
  /**
   * **直绘进纹理槽的文本**（`0x204` draw-string → 引擎 `sub_456710` 的 GDI 整串直绘）。
   *
   * 为什么单独记：它**不是**消息窗文本（没有排版、没有逐字显现、不属于任何 win），
   * 而是往"某个纹理槽的表面"上叠一串字（`CONFIG1` 的设置行就是这么画的：先
   * `create-texture 196 628 360`，再逐行 `draw-string 196 …`，最后按行裁贴到 UI 上）。
   * 宿主据此光栅化；报告/测试据此断言"这串字确实被画进了槽 N"，而不是只能靠肉眼看画面。
   */
  slotText: Map<number, { x: number; y: number; text: string }[]>;
}

export function newSceneState(): SceneState {
  return {
    drawItems: new Map<number, Item>(),
    meshes: new Map<number, MeshObj>(),
    blendWritten: new Map<number, number>(),
    msgWins: new Map<number, TextFrame>(),
    msgRev: new Map<number, number>(),
    slotText: new Map<number, { x: number; y: number; text: string }[]>(),
  };
}