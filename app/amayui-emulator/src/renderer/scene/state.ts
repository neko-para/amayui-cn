/** 场景模型状态（= 引擎 `Scene` 在 emulator 侧的可见部分）。 */
import type { Item, MeshObj } from '../drawItem.js';

/** 场景模型状态（= `Scene` 在 emulator 侧的可见部分）。 */
export interface SceneState {
  drawItems: Map<number, Item>;
  meshes: Map<number, MeshObj>;
  /** `0x203` 的 op2 混合模式是否曾被写入（用于死写/缺口自检；当前渲染器不消费它）。 */
  blendWritten: Map<number, number>;
}

export function newSceneState(): SceneState {
  return {
    drawItems: new Map<number, Item>(),
    meshes: new Map<number, MeshObj>(),
    blendWritten: new Map<number, number>(),
  };
}