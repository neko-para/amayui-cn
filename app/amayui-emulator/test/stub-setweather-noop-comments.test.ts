/** @tier T0 @kind ratchet @subsystem ops */

/**
 * **T-0163 的 SETWEATHER 族登记口径棘轮**（`0x326`/`0x327`/`0x328`/`0x329`/`0x32C`/`0x32E`）。
 *
 * 行为守卫（不硬停 / ip 前进 / 分类）已在 `test/op-327-32e-setweather-noop.test.ts` 与
 * `test/registry-classification.test.ts` 里；本文件只补审计点在**登记文本**上的缺口 ——
 * 这些缺口不会让任何代码报错，但会让下一位实现者按错的定性/扩展点动手（审计原文给的
 * `suggestedGuard` 逐条落在这里）：
 *
 *  ① `0x327`（P2 `stale-ledger`）：块注释里那句「同族的 `0x327`…与 `0x328`…**目前根本没注册** ⇒
 *     命中即 `NotImplementedOp`。**故意不上桩**」与同文件 156/157 行的 `ENGINE_INTERNAL_OPS`
 *     登记**直接矛盾**（撤表 ⇒ `SETWEATHER` 整段剧情重新硬停）⇒ 该句必须消失。
 *  ② `0x32E`（P2 `overreach`）：行注释写成「3D 图元/效果」，而体 `sub_49A080` 是 D3D **`SetLight`**
 *     （灯光索引 = **op1**、进入 `Scene` 偏移的是 **op2**，`qmemcpy` 到 `Scene[26*op2+13687]` 后置
 *     `Scene[op2+13677] = 1`）⇒ 行注释不得再出现「图元」。
 *  ③ `0x326`（P3 `approximation` + `missing-branch`）：豁免文本必须写清**外层门 `Scene+46668 >= 1`**
 *     与 `op4 == 0` 的 `Set3DEffectSnow エラー：…TEXTURE=%d` 错误支。
 *  ④ `0x328`（P3 `approximation`）：豁免理由必须承认网格槽表**已建模为 `scene.meshes`**
 *     （`0x32A`/`0x32B` 由它承接），缺的是 Effect3D 的 Leaf 对象。
 *  ⑤ `0x328`/`0x329`（P3 `missing-branch`/`missing-consumer`）：装载端与挂接端必须**同表同处置**
 *     （否则会出现"装载端被实现、挂接端仍 no-op"的静默半实现）。
 *  ⑥ `0x32C`（P3 `missing-branch` + `missing-consumer`）：必须写清**二段式**（管理器为 0 时相机仍生效）
 *     与「先整块复位 `Scene+41928..41988`」。
 *  ⑦ `scene-3d-weather-effects-rain-snow-leaf`（P3 `overreach`）：扩展点必须补上
 *     **`sub_4531B0`**（`Manager[262..309]` 三组 16-dword 参数块的唯一写入端）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const STUBS = path.join(ROOT, 'app/amayui-emulator/src/vm/handlers/stubs.ts');
const GAPS = path.join(ROOT, 'analysis/opcode-gaps.json');

const src = fs.readFileSync(STUBS, 'utf8');

/** 取 `stubs.ts` 里挂着某个 opcode 的**那一行**（行注释）。 */
function rowLine(op: number): string {
  const line = src.split('\n').find((l) => l.includes(`[0x${op.toString(16)}, op_engine_internal]`));
  assert.ok(line, `stubs.ts 里找不到 0x${op.toString(16)} 的登记行`);
  return line;
}

test('★① 0x327：陈旧的「根本没注册 / 故意不上桩」注释必须消失（它与同文件登记矛盾）', () => {
  assert.ok(
    !src.includes('根本没注册'),
    'stubs.ts 不得再出现「根本没注册」：0x327/0x328 就在本文件的 ENGINE_INTERNAL_OPS 里（撤表 ⇒ SETWEATHER 剧情重新硬停）',
  );
  assert.ok(ENGINE_INTERNAL_OPS.has(0x327), '0x327 仍须登记（否则命中即 NotImplementedOp）');
  assert.ok(ENGINE_INTERNAL_OPS.has(0x328), '0x328 仍须登记');
});

test('★② 0x32E 行注释：定性为 D3D SetLight（不得再写「图元」）', () => {
  const row = rowLine(0x32e);
  assert.ok(/SetLight/.test(row), `0x32E 的登记行必须写明 SetLight：${row}`);
  assert.ok(!/图元/.test(row), `0x32E 的登记行不得再写「图元/效果」（体是 sub_49A080 = SetLight）：${row}`);
  assert.ok(src.includes('13687'), '0x32E 的文档必须给出灯光表落点 Scene[26*op2+13687]');
  assert.ok(src.includes('13677'), '0x32E 的文档必须给出 Scene[op2+13677] 的启用位');
});

test('★③ 0x326：豁免文本必须含外层门 `Scene+46668 >= 1` 与 TEXTURE 错误支', () => {
  assert.ok(src.includes('Scene+46668'), '0x326 自带 3D/文字渲染冻结总闸 Scene+46668 >= 1');
  assert.ok(/Set3DEffectSnow/.test(src), '0x326 的 op4==0 错误支必须被披露（「Set3DEffectSnow エラー」）');
  assert.ok(/TEXTURE=%d/.test(src), '0x326 的错误串实参 TEXTURE=%d 必须被披露');
});

test('★④ 0x328：豁免理由必须承认网格槽表已建模为 scene.meshes（缺的是 Leaf）', () => {
  assert.ok(src.includes('scene.meshes'), '0x328 的扩展点必须指向既有 scene.meshes，而不是"没有网格表"');
  assert.ok(/Leaf/.test(src), '0x328 缺的是 Effect3D 的 Leaf 对象');
});

test('★⑤ 0x328 / 0x329：装载端与挂接端同表同处置（不许半实现）', () => {
  assert.ok(ENGINE_INTERNAL_OPS.has(0x328) && ENGINE_INTERNAL_OPS.has(0x329), '两端都须登记');
  const g = JSON.parse(fs.readFileSync(GAPS, 'utf8')) as {
    entries: { opcode: number; disposition: string }[];
  };
  const d328 = g.entries.find((e) => e.opcode === 0x328)?.disposition;
  const d329 = g.entries.find((e) => e.opcode === 0x329)?.disposition;
  assert.ok(d328, '0x328 必须在缺口台账里');
  assert.ok(d329, '0x329 必须在缺口台账里');
  assert.equal(d328, d329, '装载端（0x329）与挂接端（0x328）的处置必须一致');
  assert.ok(
    ['engine-internal', 'partial'].includes(d328!),
    `0x328/0x329 的处置只允许 engine-internal 或 partial（实际 ${d328}）`,
  );
  assert.ok(/表恒空|恒空|无人装/.test(src), '0x329 的登记必须写清"唯一装载端是 no-op ⇒ 表恒空"');
});

test('★⑥ 0x32C：必须写清二段式（管理器为 0 时相机仍生效）与先复位 Scene+41928..41988', () => {
  assert.ok(/二段式/.test(src), '0x32C 的体是二段式');
  assert.ok(src.includes('41928'), '0x32C 每次调用先整块复位 Scene+41928..41988 再写入');
  assert.ok(src.includes('sub_499CE0'), '0x32C 的被调体 = sub_499CE0');
});

test('★⑦ 扩展点必须补上 sub_4531B0（Manager[262..309] 的唯一写入端）', () => {
  assert.ok(
    src.includes('sub_4531B0'),
    '0x324/0x325/0x326 的扩展点必须列出 sub_4531B0（否则三组效果参数块会以全 0 构造）',
  );
});
