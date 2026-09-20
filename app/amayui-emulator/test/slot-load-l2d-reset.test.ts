/**
 * **装载点必须清 L2D 运行态** —— `tickets/T-0090`（由 `T-0066`/`T-0072` 那一族里实测出来的一处具体泄漏）。
 *
 * 实测症状（`npm run shot -- --load 79`，2026-09）：读档进 SN0000 后画面**背景完全混乱**、
 * 有一大堆位置/缩放都不对的图元（用户原话）。实测定位：那 25 个绘制项全在右缘（x=1148..1224 = 右侧栏），
 * 场景里**一项背景都没有**；真正在画的是 **Live2D** —— 而且挂着的是 **TITLE 的**：
 * `TITLE.txt:590` 的 `i344 14 0` 建的 node `0x14` + 它的模型（`D_MY_PARTS_SORA_*` 这种满屏件）+ 60 个批次，
 * 而 **`SN0000` 一条 L2D 指令都没有**。
 *
 * 为什么装载点必须清（引擎依据 + 容器依据）：
 *  - 存档槽的 body 布局**没有任何 L2D 字段**（`vm/engineSlot.ts`：帧镜像 + 三个池 + 三张 ip 表 + 图像清单）
 *    ⇒ 装载后进程里的 L2D 状态**必然属于上一个执行链**；
 *  - 引擎在同一段复位显示容器（raw 19913-19915 的两次 `sub_403EF0`）⇒ 那一层没了，立绘节点不再出画。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
// ★**必须先 import `vm/ops.js`**：本工程有一条既有的模块环
//   `handlers/save-slot → vm/ops → handlers/index → handlers/save-slot`，直接先 import `save-slot` 会在
//   `handlers/index.ts` 求值 `...SAVE_SLOT_OPS` 时踩 TDZ（`ReferenceError: Cannot access 'SAVE_SLOT_OPS'
//   before initialization`）。既有测试都是这个顺序（见 `slot-load-transfer.test.ts`）；
//   环本身登记在 `tickets/T-0089`（属 `T-0021` 的分层违规族）。
import '../src/vm/ops.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { loadSlotIntoEngine } from '../src/vm/handlers/save-slot.js';
import { l2dBindTexture, l2dCreateNode } from '../src/live2d/runtime.js';
import { buildBody, buildScriptBin, buildSlotFile, SEEDS } from './engineSlotFixtures.js';

/** 只提供"读槽 / 读脚本"的内存 FileSource。 */
function fakeSource(slot: number, bytes: Uint8Array, scriptId: number, script: Uint8Array): Engine['fileSource'] {
  return {
    readSaveSlot: async (s: number) => (s === slot ? bytes : null),
    readScript: async (id: number) => (id === scriptId ? { index: id, name: 'SN0000.BIN', data: script } : null),
  } as unknown as Engine['fileSource'];
}

function fixture(): { bytes: Uint8Array; script: Uint8Array } {
  const script = buildScriptBin([{ op: 0xae, args: [] }]);
  const body = buildBody({
    savedCur: 0,
    savedRet: -1,
    pre8: 0,
    frames: [{ returnFrame: -1, scriptId: 100, retIdx: [], messageIdx: -1, callIdx: -1 }],
    ints: [],
    floats: [],
    strings: [],
    ipTables: [[], [], []],
    images: [],
    records: [],
  });
  return { bytes: buildSlotFile(body, { ...SEEDS, format: 3, aux: 20 }), script };
}

test('★装载点清 L2D：读档后不许再挂着上一个画面的立绘节点/实例槽', async () => {
  const { bytes, script } = fixture();
  const scene = new HeadlessScene({});
  const logs: string[] = [];
  const e = new Engine(scene);
  e.native.log = (m: string): void => void logs.push(m);
  e.fileSource = fakeSource(3, bytes, 100, script);

  // "上一屏"：TITLE 那种 node key 0x14 + 一个带纹理的实例槽 + 一条动作缓存
  l2dCreateNode(e, 0x14, 0);
  l2dBindTexture(e, 0, 0x4f9f, 0);
  e.l2dMotionCache.set(0, {} as never);
  assert.equal(e.l2dNodes.size, 1, '前置：上一个画面确实有立绘节点');
  assert.equal(e.l2dSlots.size, 1, '前置：确实有实例槽');

  const r = await loadSlotIntoEngine(e, 3, { full: true });
  assert.equal(r.code, 0, '槽必须装载成功');

  assert.equal(e.l2dNodes.size, 0, '★读档后不许再有上一个画面的立绘节点（否则整块立绘继续画在新场景上）');
  assert.equal(e.l2dSlots.size, 0, '★实例槽（模型/纹理绑定）也不许留');
  assert.equal(e.l2dMotionCache.size, 0, '动作缓存同样属于上一个执行链');
  assert.ok(
    logs.some((m) => m.includes('清掉上一个执行链的 L2D 运行态')),
    `必须记一条日志（静默清掉会让人以为"画面自己好了"）；实际：${logs.filter((m) => m.includes('l2d')).join(' | ')}`,
  );
});

test('★没有 L2D 时不留噪声：装载点不该为"清了 0 个"记日志', async () => {
  const { bytes, script } = fixture();
  const scene = new HeadlessScene({});
  const logs: string[] = [];
  const e = new Engine(scene);
  e.native.log = (m: string): void => void logs.push(m);
  e.fileSource = fakeSource(3, bytes, 100, script);
  await loadSlotIntoEngine(e, 3, { full: true });
  assert.equal(
    logs.filter((m) => m.includes('L2D')).length,
    0,
    '一个都没清时不许记（否则每次读档都刷一行无意义日志）',
  );
});
