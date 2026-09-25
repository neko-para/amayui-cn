/** @tier T0 @kind core @subsystem texture */

/**
 * **宿主缝的"拆缝 + 进桥"两件事**（`tickets/T-0175` 的 ③，出处 `tickets/T-0159` §4.1 + `tickets/T-0163` §7-1）。
 *
 * ## 两件事实
 *
 * 1. **一条缝两种语义**（`T-0163` §7-1 报的）：`setTextureObjectParam` 同时承载
 *    `0x246`（CTexture 子对象 `vtable+56`，`op2 ÷ 100`）与 `0x1F9`/`0x249`（**颜色** ARGB，
 *    `Scene[5*slot+467]`）—— 宿主拿到同一个 `(slot, value)` 签名时**不可能分辨**要干什么。
 *    拆法：新增 `setTextureObjectColor`（颜色）与 `setTextureObjectSubParam`（子对象参数），
 *    旧名保留（既有宿主适配 + 闸门文案），生产路径改调两个新名。
 * 2. **两条存档槽缝没进桥**（`T-0159` §4.1 报的）：`confirmSlotOverwrite` / `slotWriteFailed`
 *    原先只是 `handlers/save-slot.ts` 里的**结构化类型**（`SlotHostSeams`）⇒ 宿主不实现时
 *    `?.` 是**真正的静默**（连闸门 A 都记不到）。进桥后它们会出现在缺口清单里。
 *
 * ## 判据
 *
 * | # | 断言 |
 * |---|---|
 * | 1 | 三条缝都在 `NativeBridge` 的**声明面**（`BRIDGE_METHODS`）里 —— 缺一就退回静默 |
 * | 2 | 生产路径（`handlers/gfx-texture.ts`）调的是**拆开后**的两个新名；旧名只在回退支里出现 |
 * | 3 | **可选缝语义**：宿主不实现 ⇒ 不抛、不改变调用方行为（`0x1F9` 的颜色照发、`0x246` 的值照算） |
 * | 4 | 旧名回退**只在没有新名时**生效（不许"双写"：两个都实现时只调新名一次） |
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRIDGE_METHODS, DropRecorder, withNativeTap } from '../src/vm/nativeTap.js';
import type { NativeBridge } from '../src/vm/native.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMU = path.join(HERE, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(EMU, rel), 'utf8');
}

test('★三条缝必须在桥的声明面里（否则宿主不实现时是**真静默**，闸门 A 也记不到）', () => {
  const bridge = new Set<string>(BRIDGE_METHODS);
  for (const m of ['setTextureObjectColor', 'setTextureObjectSubParam', 'confirmSlotOverwrite', 'slotWriteFailed']) {
    assert.ok(bridge.has(m), `${m} 必须进 BRIDGE_METHODS（这是 T-0159/T-0163 留的缺口本体）`);
  }
  assert.ok(
    bridge.has('setTextureObjectParam'),
    '旧名保留：已经实现它的宿主（结构性类型）不会被这次拆缝打断',
  );
});

test('★生产路径调拆开后的新名：颜色走 setTextureObjectColor、子对象参数走 setTextureObjectSubParam', () => {
  const src = read('src/vm/handlers/gfx-texture.ts');
  assert.match(src, /c\.native\.setTextureObjectSubParam\?\.\(slot, value \/ 100\)/, '`0x246` 必须调子对象参数缝');
  // 颜色是三处（`0x1F9` / `0x249` 与绑定路径）⇒ 都必须经统一的 `emitTextureColor`
  const colors = src.match(/emitTextureColor\(c\.native, slot, normalizeTextureColor\(color\)\)/g) ?? [];
  assert.equal(colors.length, 2, '`0x1F9`（bindTexture 路径）与 `0x249` 两处的颜色都必须走 emitTextureColor');
  assert.doesNotMatch(
    src,
    /c\.native\.setTextureObjectParam\?\.\(slot, normalizeTextureColor\(/,
    '★颜色不许再直连旧名（那样宿主侧又分不清语义了）',
  );
  // 旧名只允许出现在回退支里，且回退必须有门（`if (native.setTextureObjectColor)` 之后 return）
  assert.match(src, /if \(native\.setTextureObjectColor\) \{[\s\S]{0,200}?native\.setTextureObjectParam\?\.\(slot, argb\);/, '旧名回退必须只在没有新名时生效');
});

test('★可选缝语义：宿主不实现两条新缝 ⇒ 不抛、不改变调用方行为（`?.` 的语义）', () => {
  // 注：这里不构造 Engine（会拉起整条 handlers 装配链），只验证"桥的语义"这一层。
  const rec = new DropRecorder(() => 0x246);
  const inner = { log: (_m: string) => {} } as unknown as NativeBridge;
  const tapped = withNativeTap(inner, rec) as unknown as NativeBridge;

  // ① `?.` 调用不抛（宿主没实现）
  assert.doesNotThrow(() => tapped.setTextureObjectColor?.(3, 0xff112233));
  assert.doesNotThrow(() => tapped.setTextureObjectSubParam?.(3, 1.5));
  assert.doesNotThrow(() => tapped.confirmSlotOverwrite?.(3));
  assert.doesNotThrow(() => tapped.slotWriteFailed?.(3, '保存失败'));
  // ② 但**留了痕**：四条都进了闸门 A（这就是"进桥"的全部意义）
  const methods = rec.list().map((e) => e.method).sort();
  assert.deepEqual(
    methods,
    ['confirmSlotOverwrite', 'setTextureObjectColor', 'setTextureObjectSubParam', 'slotWriteFailed'],
    '★宿主没实现 ⇒ 必须进缺口清单（修前 confirmSlotOverwrite/slotWriteFailed 连这一条都没有）',
  );
  for (const e of rec.list()) {
    assert.ok(e.why.length > 10, `${e.method} 的 WHY 文案必须说清"缺了它会怎样"`);
  }

  // ③ 语义退化方向必须与 `handlers/save-slot.ts` 的判据一致：`=== false` 不成立 ⇒ 恒按"是"
  assert.notEqual(tapped.confirmSlotOverwrite?.(3), false, '★没缝时不许假装"玩家点了否"（那会凭空拒绝覆盖）');
});

test('★声明面与实现的"可选"口径一致：两个真宿主都不实现这四条（对称，不改宿主差异表）', () => {
  // `test/native-tap.test.ts` 的 DECLARED_HOST_DIVERGENCE 是"差异只允许一个方向"的表：
  // 只要**一个**宿主实现了这些缝，就必须同步改那张表（那是别人的文件）⇒ 本票刻意保持
  // "两条新缝 + 两条存档缝在两宿主都不实现"，于是差异表一个字都不用动。
  for (const rel of ['src/renderer/pixiBackend.ts', 'src/renderer/headlessScene.ts']) {
    const src = read(rel);
    for (const m of ['setTextureObjectColor', 'setTextureObjectSubParam', 'confirmSlotOverwrite', 'slotWriteFailed']) {
      assert.doesNotMatch(
        src,
        new RegExp(`\\b${m}\\s*\\(`),
        `${rel} 实现了 ${m} ⇒ 必须同步更新 test/native-tap.test.ts 的 DECLARED_HOST_DIVERGENCE（不属本票文件范围）`,
      );
    }
  }
});
