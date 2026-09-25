/** @tier T0 @kind core @subsystem render */

/**
 * 命名守卫：**`0x320` create-mesh 建项时两格态色的初值 = `-1`（不透明白）**。
 *
 * 引擎 `sub_49C9D0`（raw 118377-118398，由 `sub_4AAB80` raw 130093 调用 = 网格表的"缺失即建项"）：
 * ```
 * a1[13] = -1;   // +52 = state0（起始态色）
 * a1[14] = -1;   // +56 = state1（目标态色；`-1` 同时是"无 TO"哨兵）
 * ```
 * 后果只在"**有几何但从未发过 `0x322`/`0x323`**"的 mesh 上可见：
 *  - 引擎：可见色 = 基础色 × state0 = `mulArgb(base, 0xFFFFFFFF)` = 基础色 ⇒ 照画；
 *  - 修前 emulator：`makeMesh` 给 `state0 = 0` ⇒ `calcDiffuse` 返回全透明 ⇒
 *    `presenter.drawMesh` 对 `calcDiffuse(...) >>> 24 <= 0` 直接 `return` ⇒ **整块不画**。
 *
 * 红→绿：把 `model.ts` 的 `makeMesh` 两格改回 `0` ⇒ 本文件第 1/2 例红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcDiffuse, makeMesh, meshColor } from '../src/renderer/drawItem.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scCreateMesh } from '../src/renderer/scene/ops.js';

const MESH_SPEC = {
  handle: 0x11,
  layer: 1,
  vcount: 4,
  verts: [
    { x: -0.5, y: -0.5, z: 0, u: 0, v: 0 },
    { x: 1279.5, y: -0.5, z: 0, u: 1, v: 0 },
    { x: -0.5, y: 719.5, z: 0, u: 0, v: 1 },
    { x: 1279.5, y: 719.5, z: 0, u: 1, v: 1 },
  ],
  baseColors: [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff],
};

test('★0x320：makeMesh 的两格态色初值 = 0xFFFFFFFF（raw 118396-118397），不是 0', () => {
  const m = makeMesh(0x11, 1);
  assert.equal(m.state0 >>> 0, 0xffffffff, '`+52` = `a1[13] = -1` ⇒ 不透明白');
  assert.equal(m.state1 >>> 0, 0xffffffff, '`+56` = `a1[14] = -1`');
  assert.equal(m.flags & 1, 0, '前置（不变）：没有几何 ⇒ bit0 未置 ⇒ 不画');

  // "有几何但从未发 0x322/0x323"：引擎按基础色绘制 ⇒ diffuse 必须是透明白（恒等乘法）
  m.flags |= 1;
  assert.equal(calcDiffuse(m, 1000) >>> 0, 0xffffffff, '无窗 ⇒ 可见态色 = state0 = 透明白');
  assert.equal(meshColor(m, calcDiffuse(m, 1000)) >>> 0, 0xffffffff, '基础色 × 透明白 = 基础色（可见）');
});

test('★0x320：走真实入口（scCreateMesh）建出的网格同样是不透明白初值', () => {
  const s = newSceneState();
  const m = scCreateMesh(s, MESH_SPEC);
  assert.equal(m.flags & 1, 1, '前置：vcount > 0 ⇒ bit0 置');
  assert.equal(m.state0 >>> 0, 0xffffffff, '0x320 建项后 `+52` 是不透明白');
  assert.equal(m.state1 >>> 0, 0xffffffff, '0x320 建项后 `+56` 是不透明白');
  assert.equal(calcDiffuse(m, 500) >>> 0, 0xffffffff, '这一帧该网格可见（不是 alpha = 0 的整块不画）');
});
