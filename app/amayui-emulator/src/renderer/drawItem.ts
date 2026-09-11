/**
 * **DrawItem / MeshEntry 模型层**（`src/renderer/drawitem/`）的公共入口。
 *
 * 这一层刻意不依赖 Pixi/DOM，可以在 Node 里直接跑；两个宿主
 * （`pixiBackend.ts` WebGL、`headlessScene.ts` 报告）共用它，以保证
 * "报告里的模型"与"画面上的模型"是同一份语义。
 *
 * | 模块 | 职责 |
 * |---|---|
 * | `drawitem/model.ts` | 数据类型 + 建项 + 引擎字段偏移表（含 740 字节布局说明） |
 * | `drawitem/animWindow.ts` | 5 个动画窗的状态机（相位/收尾/推进） |
 * | `drawitem/colorMath.ts` | 插值原语（Vec3 / ARGB） |
 * | `drawitem/eval.ts` | 逐帧求值（颜色/缩放/旋转/平移/源矩形/diffuse） |
 * | `drawitem/setters.ts` | 指令写入端（`apply*`） |
 * | `drawitem/cgDigit.ts` | `0x23B` CG 数字条几何 |
 */

export * from './drawitem/model.js';
export * from './drawitem/animWindow.js';
export * from './drawitem/colorMath.js';
export * from './drawitem/eval.js';
export * from './drawitem/setters.js';
export * from './drawitem/cgDigit.js';
