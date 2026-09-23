/** @tier T0 @kind core @subsystem tool */
/**
 * **`control/` 层的最小测试**（`tickets/T-0127`）—— 补的是 `tickets/T-0124` 变异实测查出的**零覆盖点 Z3**：
 * 删掉 `opHex` 的前导零补足，全量 **1086 例无一红**（`control/` 当时零测试覆盖）。
 *
 * 为什么这条值钱：2026-09 用户实测把 `0x0B5`（`i0b5`，DsPlaySound 音轨）看成了 `0x05B`（`ne`，已实现），
 * 于是以为「已实现的指令被当成缺口」。补足三位是**当时那个修复**，而它此前没有任何守卫。
 *
 * ★可测性改造：`opHex` 原先住在 `control/control.ts`（模块加载即摸 DOM/`window.api`，Node 测不了），
 *   本票把它挪到不依赖 DOM/IPC 的 `control/format.ts`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opHex } from '../control/format.js';

test('★Z3 `opHex`：指令码必须补足三位十六进制（`0x0b5` 不是 `0xb5`）', () => {
  assert.equal(opHex(0x0b5), '0x0b5', '★三位补零 —— 用户实测把 0x0B5 看成 0x05B 的就是这条');
  assert.equal(opHex(0x5b), '0x05b');
  assert.equal(opHex(0x1fb), '0x1fb');
  assert.equal(opHex(0), '0x000');
  assert.equal(opHex(0x1111), '0x1111', '超过三位不截断');
  // ★反面控制：不补零的写法绝不能通过（否则"补零"这件事没被钉住）
  assert.notEqual(opHex(0x0b5), '0xb5');
  assert.notEqual(opHex(0x5b), '0x5b');
});
