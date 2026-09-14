/**
 * 回归测试：**mesh 顶点四边形 + 逐顶点色**（引擎 `0x320/0x322/0x323`）。
 *
 * 为什么必须有这条测试：这是"**VM 一切正常、日志空白、画面却整屏黑**"的那一类缺陷。
 * 2026-09 实测症状：`SN0000` 序章首文案到达后整屏黑（`.tmp/gs2-7-sn0000-first-text.png`，
 * `present` 摘要 `meshes={8:a0 0:a255}`）。两个成因**都不报错**：
 *  1. `presenter.ts` 把**每个** mesh 画成 `width=VIEW_W; tint=0x000000`（全屏不透明黑，忽略 RGB）；
 *  2. `0x322`/`0x323` 把 `alpha/rgb` 当**无符号**读，漏掉引擎的"负值 = 用当前 state0"回退
 *     （`sub_426C20` raw 33865-33884）：SN0000 的 `set-vertex-color 19640 0 0 (local)`
 *     里 `local = -2`，引擎语义 ⇒ 目标色 = **当前 50% 黑**（`0x80000000`），按位模式读却成了
 *     `0x00FFFFFE`（近白）⇒ 插值出 `0xFFFFFFFF`（不透明）⇒ 黑幕变全黑。
 *
 * 引擎事实（raw 证据）：
 *  - 几何：`sub_432150` raw 41035-41069 读 op2/3/4（x/y/z 数组基址）+ op7/8（u/v 数组基址）
 *    + op9=vcount + op10=layer，交给 `sub_4ADFE0` → `sub_4A2280` 建 VB；
 *    顶点记录 36 字节 `x,y,z,w,u,v,…`；`sub_4AF1C0` raw 133502 以 `flags & 1` 为绘制门。
 *  - 颜色：同函数 raw 41054-41058 用 DEC key 解出 `(dec(alpha)<<24)|(dec(rgb)&0xFFFFFF)`；
 *    `CalcDiffuse`（`sub_4A2050` raw 122287-122325）把态色**逐通道乘**到基础色上（`×/255`）。
 *  - 语料：所有 `0x320` 站点都是满屏四边形 `x=(0,1280,0,1280)`、`y=(0,0,720,720)`
 *    （源码里的 `500`/`2d0` 是**十六进制**），基础色来自 INIT2 的 `f8c48/f8c4c` = 纯白。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { calcDiffuse, meshColor, mulArgb, type MeshObj } from '../src/renderer/drawItem.js';

/** 一个满屏 mesh（几何已建、基础色全白）—— 与语料里的 `0x320` 站点同形。 */
function fullScreenMesh(handle = 0x19640): MeshObj {
  return {
    handle,
    layer: 0,
    flags: 1,
    state0: 0,
    state1: 0,
    verts: [
      { x: 0, y: 0, z: 0, u: 0, v: 0 },
      { x: 1280, y: 0, z: 0, u: 1, v: 0 },
      { x: 0, y: 720, z: 0, u: 0, v: 1 },
      { x: 1280, y: 720, z: 0, u: 1, v: 1 },
    ],
    baseColors: [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff],
    blend: 0,
  };
}

test('0x322：负 alpha/rgb 回退到当前 state0；>255 的 alpha 夹到 255（引擎 sub_426C20）', () => {
  const s = new HeadlessScene({});
  s.scene.meshes.set(0x19640, fullScreenMesh());

  // ① 正常写：op3=0x80(alpha)、op4=0(rgb) → 50% 黑
  s.setVertexColor(0x19640, 0, 0x80, 0);
  assert.equal(s.scene.meshes.get(0x19640)!.state0 >>> 0, 0x80000000);

  // ② alpha>255 ⇒ 255（脚本常把整颗颜色当 alpha 传：`f807d` = 0xc0/0xa0/0x80 时取低字节，
  //    但 0x80000000 这种"当作 alpha 传的大数"必须夹到 255）
  s.setVertexColor(0x19640, 0, 0x80000000, 0xffffff);
  assert.equal(s.scene.meshes.get(0x19640)!.state0 >>> 0, 0xffffffff);

  // ③ 负值回退：先设成 0x80000000（50% 黑），再用 alpha=0 / rgb=-2 写 ⇒ rgb 保持黑
  s.setVertexColor(0x19640, 0, 0x80, 0);
  s.setVertexColor(0x19640, 0, 0, -2);
  assert.equal(s.scene.meshes.get(0x19640)!.state0 >>> 0, 0x00000000, 'alpha=0 且 rgb<0 ⇒ 透明黑（沿用当前 rgb）');

  // ④ 两个通道都取负 ⇒ 完全等于当前 state0
  s.setVertexColor(0x19640, 0, 0x80, 0xff0000);
  s.setVertexColor(0x19640, 0, -1, -1);
  assert.equal(s.scene.meshes.get(0x19640)!.state0 >>> 0, 0x80ff0000);
});

test('0x323：负 alpha/rgb 回退 + 窗字段（delay/count）写入，state1 不变成 0xFFFFFFFF', () => {
  const s = new HeadlessScene({});
  s.scene.meshes.set(0x19640, fullScreenMesh());
  s.setVertexColor(0x19640, 0, 0x80, 0); // 当前 = 50% 黑

  // SN0000.txt:3272 —— `set-vertex-color-alpha 19640 0 f8043 (-1) (-1)`：目标色 = 当前色
  s.setVertexColorAlpha(0x19640, 0, 6144, -1, -1);
  const m = s.scene.meshes.get(0x19640)!;
  assert.equal(m.state1 >>> 0, 0x80000000, '★目标色必须是 0x80000000（50% 黑），不是 0xFFFFFFFF');
  assert.equal(m.anim?.dur, 6144, 'op3 = 窗时长');
  assert.equal(m.flags & 2, 2, '置动画位 bit1');
});

test('CalcDiffuse 逐通道乘（mulArgb）：态色全白 = 基础色；态色 50% 黑 ⇒ alpha 减半', () => {
  assert.equal(mulArgb(0xffffffff, 0xffffffff), 0xffffffff, 'blend=全白 ⇒ 基础色原样（引擎的快路径）');
  assert.equal(mulArgb(0xffffffff, 0x80000000), 0x80000000);
  assert.equal(mulArgb(0xff808080, 0xffffffff), 0xff808080);
  // 0xFF * 0x40 / 0xFF = 0x40（逐通道乘，只影响对应通道）
  assert.equal(mulArgb(0x00ff0000, 0x00400000) >>> 0, 0x00400000);
});

test('CalcDiffuse 窗末冻结在 state1：50% 黑幕的最终色必须是 0x80000000', () => {
  const m = fullScreenMesh();
  m.state0 = 0x00000000;
  m.state1 = 0x80000000;
  m.flags |= 2;
  // ★`start === 0` 是引擎的"窗未开始"哨兵（raw 133509：`if(!entry[10]) entry[10]=clock`），
  //   时钟恰为 0 时锁存后仍是 0 ⇒ 会再次锁存。测试从 start=1 开始，避开这个边界。
  m.anim = { start: 1, delay: 0, dur: 6144 };
  const at = (t: number): number => meshColor(m, calcDiffuse(m, t));
  assert.equal(at(1) >>> 0, 0x00000000, '窗起点 = state0（全透明）');
  assert.equal(at(3073) >>> 0, 0x40000000, '中点 = 逐字节插值 50% × 50%');
  assert.equal(at(6145) >>> 0, 0x80000000, '窗末 = state1（50% 黑，背景仍可见）');
});

test('★回归：没有动画窗时 mesh 可见色 = state0（不是 state1）—— SN0000 进场黑幕不许在设色与开窗之间闪出背景', () => {
  // 引擎的可见色是**顶点缓冲里那份**：`0x322`（sub_4AE2C0 raw 132816-132823）写 entry[13]=state0 后
  // 立刻以比例 0 刷 VB ⇒ 当帧可见；`0x323`（sub_4AE330 raw 132834-132843）只置 bit1/delay/dur/state1，
  // **不碰 VB** ⇒ 在 `set-vertex-color` 与 `set-vertex-color-alpha` 之间（未开窗）看到的仍是 state0。
  const m = fullScreenMesh();
  m.state0 = 0xff000000; // 0x322 写的：全黑、不透明
  m.state1 = 0x00000000; // 尚未写（引擎里是 -1"无 TO"）
  assert.equal(m.anim, undefined, '未开窗');
  assert.equal(meshColor(m, calcDiffuse(m, 1000)) >>> 0, 0xff000000, '未开窗 ⇒ 全黑幕必须可见（此前返回 state1=0 ⇒ 透明 ⇒ 背景闪一帧）');

  // 开窗（0x323）后：延迟期仍是 state0，窗内插值，窗末冻在 state1
  m.flags |= 2;
  m.anim = { start: 1, delay: 100, dur: 3600 };
  assert.equal(meshColor(m, calcDiffuse(m, 50)) >>> 0, 0xff000000, '延迟期保持 state0（黑）');
  assert.equal(meshColor(m, calcDiffuse(m, 4100)) >>> 0, 0x00000000, '窗末 = state1（透明，背景露出）');
  assert.equal(m.flags & 2, 0, '窗末清 bit1');
  assert.equal(m.state0 >>> 0, 0x00000000, '窗末 state0 ← state1（此后可见色继续由 state0 决定）');
  assert.equal(meshColor(m, calcDiffuse(m, 5000)) >>> 0, 0x00000000, '窗末之后仍是 state0（= 新的当前色）');
});

test('mesh 颜色 = 基础色 × 态色：SN0000 的"50% 黑幕"必须是 alpha=0x80，而不是 255', () => {
  const m = fullScreenMesh();
  assert.equal(meshColor(m, 0x80000000) >>> 0, 0x80000000, '不透明黑幕会把背景与首文案一起吃掉');
  m.baseColors = [0x00000000, 0x00000000, 0x00000000, 0x00000000];
  assert.equal(meshColor(m, 0xffffffff) >>> 0, 0x00000000, '基础色透明 ⇒ 无论态色多重都不画');
});

test('★E3 回归：Game Start → ゲーム開始 → SN0000 首文案时的两块满屏幕布（几何 + 端点色）', async () => {
  const { runGameStartChain } = await import('../src/tools/gameStartChain.js');
  const r = await runGameStartChain({});
  assert.ok(r.firstTextReached, '应到达 SN0000 首文案');

  const full = r.scene.meshes.filter((m) => m.rect === '0,0..1280,720');
  assert.ok(full.length > 0, `应有满屏 mesh（顶点色幕布）；实际 ${JSON.stringify(r.scene.meshes)}`);
  for (const m of r.scene.meshes) {
    assert.equal(m.verts, 4, `mesh 0x${m.handle.toString(16)} 应有 4 个顶点（引擎 create-mesh op9=4）`);
    assert.equal(m.flags & 1, 1, `mesh 0x${m.handle.toString(16)} 的 bit0（几何已建）应置`);
  }

  // ① 场景淡入幕 0x19258：**从全黑渐显到透明**（`0x322` state0=0xFF000000 + `0x323` state1=0）
  const fade = r.scene.meshes.find((m) => m.handle === 0x19258);
  assert.ok(fade, `应有 0x19258 淡入幕；实际 ${JSON.stringify(full)}`);
  assert.equal(fade.state0, '#ff000000', '淡入幕起点 = 不透明黑');
  assert.equal(fade.state1, '#00000000', '淡入幕终点 = 全透明（★漏掉它 ⇒ 一直黑）');

  // ② ADV 暗幕 0x19640：场景装配期就写好的 **50% 黑**（`SN0000.txt:3091` 的
  //    `set-vertex-color 19640 0 (global-int f807d) 0`，f807d = a9e1 = 0x80，见 INITCONFIG2.txt:16）
  //
  // ★2026-09（`tickets/T-0002` 第 2 批）：门策略统一到**产品语义**（`0x400` 按引擎真值放行：池挂起位 + 0x238 计时器，`T-0024`；
  //   不再"每帧无条件清"）之后，第一句文案那一刻这块幕布正处于 `0x323 set-vertex-color-alpha` 的
  //   **淡入窗内**（`SN0000.txt:3272`：state0=透明 → state1=50% 黑，`flags & 2` 仍置）。
  //   修前链条会**越过目标最多一整批**（实测 clear=283100 步 / 停在 CHARMEDIT；wait=250913 步 / 停在 SN0000），
  //   于是那份"已淡完（state0=#80000000、无窗）"的状态其实是**停止点伪影**，不是第一句文案的时刻。
  //   所以这里断言**目标色**（state1 = 50% 黑）——它才是不变量；当前色随淡入进度而变。
  const adv = r.scene.meshes.find((m) => m.handle === 0x19640);
  assert.ok(adv, `应有 0x19640 暗幕；实际 ${JSON.stringify(full)}`);
  // ★2026-09（`tickets/T-0004` 的 G3）：报告里的 `state0`/`state1` 现在是**脚本写的两端色**
  //   （在 `0x322`/`0x323` 写入那一刻抓取）⇒ 可以直接断言**目标色**，不再需要
  //   `(flags & 2) ? state1 : state0` 那个"当前或目标"的模糊口径。
  assert.equal(
    adv.state1,
    '#80000000',
    `★ADV 暗幕的目标色必须是半透明黑（背景仍可见），实际 state0=${adv.state0} state1=${adv.state1} flags=${adv.flags}`,
  );
  // ③ 终态检查：不允许存在"最终会变成不透明黑"的满屏幕布（用跑完那一刻的当前值判 `flags & 2`）。
  for (const m of r.scene.meshes) {
    const end = (m.flags & 2) !== 0 ? m.nowState1 : m.nowState0;
    assert.notEqual(end, '#ff000000', `mesh 0x${m.handle.toString(16)} 的终态是不透明黑 ⇒ 整屏黑`);
  }
});
