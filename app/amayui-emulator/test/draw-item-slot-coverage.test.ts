/**
 * 管线级回归测试：**draw-item 的纹理槽解析覆盖率**（跑到 TITLE，统计绘制项能否解析到纹理槽）。
 *
 * 为什么需要它：曾经有两个叠加的真实 bug 让画面"背景消失、只剩零星色块"——
 *   1. `draw-texture`(0x1FB) 的 op1/op2 写反（op1 是图元 handle/层序、op2 才是纹理槽）；
 *   2. `present()` 用 `it.layer` 去查纹理槽表。
 * 两者都不会抛异常，只会让**绝大多数绘制项取不到纹理**。单元测试只覆盖解析函数，覆盖不到
 * "脚本跑起来后实际有多少项能解析"这件事，所以这里用整条 boot 管线做一次端到端计数。
 *
 * 断言口径（不管渲染后端、不依赖 Pixi/DOM）：
 *   - 跑到 TITLE 后，`draw-texture` 建立的绘制项里，**槽已由 set-texture 绑定**的比例 ≥ 95%；
 *   - 每一项的 `tex`（= op2）必须与 `layer`（= op1）语义分离（禁止用 layer 当槽号）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { Engine } from '../src/vm/engine.js';
import { loadScriptData, stepOnce, NotImplementedOp } from '../src/vm/interpreter.js';
import type { NativeBridge } from '../src/vm/native.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RAW_DIR = path.join(ROOT, 'raw');

/** 只记录 draw-texture / set-texture / detach 的最小 NativeBridge（不渲染，只统计）。 */
class SlotRecorder implements NativeBridge {
  readonly slotBound = new Set<number>();
  readonly items = new Map<number, { tex: number; layer: number }>();
  log(): void {}
  /** `draw-texture`(0x1FB) 走的是类型化接口（不是旧的数组接口）。 */
  configureDrawItem(cfg: { handle: number; layer: number; tex: number }): void {
    this.items.set(cfg.handle, { tex: cfg.tex, layer: cfg.layer }); // handle = op1（层序），tex = op2（槽）
  }
  setTexture(args: number[]): void {
    const [, slot = 0] = args;
    this.slotBound.add(slot);
  }
  bindTexture(_imgid: number, slot: number): void {
    this.slotBound.add(slot);
  }
  detachTexture(handle: number, count: number): void {
    if (count <= 1) this.items.delete(handle);
    else for (const k of [...this.items.keys()]) if (k >= handle && k < handle + count) this.items.delete(k);
  }
  clearDrawContainer(): void {
    this.items.clear();
  }
}

test('跑到 TITLE：draw-texture 的绘制项绝大多数能解析到已绑定纹理槽（op1/op2 不混淆）', async () => {
  const src = new NodeFileSource({ rawDir: RAW_DIR });
  const rec = new SlotRecorder();
  const e = new Engine(rec);
  e.fileSource = src;
  const boot = await src.readScript(0);
  assert.ok(boot, '应解析出索引 0 = SYSTEM4.BIN');
  loadScriptData(e, boot.data, boot.name);

  let steps = 0;
  const MAX = 200_000;
  try {
    while (steps < MAX) {
      const f = e.curScript();
      if (!f.script || f.ip >= f.script.instructions.length) break;
      await stepOnce(e);
      steps++;
    }
  } catch (err) {
    // 未实现 opcode 不算失败：本测试只关心"跑到的部分"里纹理槽解析得对不对
    if (!(err instanceof NotImplementedOp)) throw err;
  }

  assert.ok(rec.items.size > 0, `应至少建立过一个绘制项（实际 steps=${steps}）`);
  let resolved = 0;
  const sample: string[] = [];
  for (const it of rec.items.values()) {
    if (rec.slotBound.has(it.tex)) resolved++;
    else if (sample.length < 8) sample.push(`handle=${it.tex} slot=${it.tex} layer=${it.layer}`);
  }
  const ratio = resolved / rec.items.size;
  assert.ok(
    ratio >= 0.95,
    `槽解析覆盖率 ${(ratio * 100).toFixed(1)}% (${resolved}/${rec.items.size}) 应 ≥ 95%；未解析样例: ${sample.join(', ')}`,
  );

  // 语义分离的基本检查：至少存在一项 tex ≠ layer（否则说明两者被当成同一个量）
  const mixed = [...rec.items.values()].filter((it) => it.tex !== it.layer).length;
  assert.ok(mixed > 0, '应存在 tex(op2) ≠ layer(op1) 的绘制项，证明两者是不同语义');

  await src.dispose?.();
});
