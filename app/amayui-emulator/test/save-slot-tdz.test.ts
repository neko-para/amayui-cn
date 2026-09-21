/**
 * `T-0089` 守卫：**模块环 TDZ** —— `handlers/save-slot` ⟷ `vm/ops` ⟷ `handlers/index`。
 *
 * ## 环与症状（修前）
 * ```
 * handlers/save-slot.ts  --import { loadScriptIntoFrame } from '../ops.js'-->  vm/ops.ts
 * vm/ops.ts              --re-export from-->                                  handlers/index.ts
 * handlers/index.ts      --顶层展开 ...SAVE_SLOT_OPS-->                        handlers/save-slot.ts
 * ```
 * ⇒ 若**某个模块先** import `save-slot`（本文件就是这种姿势），ESM 会在 `handlers/index.ts:66`
 * 展开 `SAVE_SLOT_OPS` 时撞上"还没初始化"⇒ `ReferenceError: Cannot access 'SAVE_SLOT_OPS' before
 * initialization`（**模块级抛错**，整个测试文件红成一片，看起来像"测试坏了"而不是环）。
 *
 * ## 本文件为什么能当守卫
 * `node --test` 每个测试文件是**独立的模块图**，而本文件**只** import `save-slot` 与 `engine`
 * （不 import `ops`）⇒ 只要这四条断言能跑完，"先 import save-slot"的姿势就是安全的。
 * 另外两条静态断言把"不许再长出这条边"钉住（不然下一个人又会加回 `'../ops.js'`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// ★注意 import 顺序就是本测试的**被测对象**：save-slot（**handler 模块**，环的那一端）必须能在
//   没有被 ops 预热的情况下加载。
import { SAVE_SLOT_OPS } from '../src/vm/handlers/save-slot.js';
import { buildSlotFile, parseSlotFile } from '../src/save/saveSlot.js';
import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');

/** 取一个文件里的 import 说明符（只认静态 import/re-export 的 `from '...'`）。 */
function importsOf(rel: string): string[] {
  const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
  const out: string[] = [];
  for (const line of src.split('\n')) {
    const m = /\bfrom\s+'([^']+)'/.exec(line);
    if (m) out.push(m[1]!);
  }
  return out;
}

test('★T-0089 ①：`save-slot.ts` 不得 import `../ops.js`（环的那条边）', () => {
  const specs = importsOf('vm/handlers/save-slot.ts');
  assert.equal(
    specs.includes('../ops.js'),
    false,
    `★环边又长回来了：save-slot → ops（会 TDZ）。用 \`../scriptFrame.js\`（叶子模块）取 loadScriptIntoFrame。\n  当前 import：${specs.join(', ')}`,
  );
  assert.equal(specs.includes('./index.js'), false, 'save-slot 也不得 import handlers/index（那是环的另一半）');
});

test('★T-0089 ①：`handlers/frame.ts` 同样不得 import `../ops.js`（同型环边）', () => {
  const specs = importsOf('vm/handlers/frame.ts');
  assert.equal(
    specs.includes('../ops.js'),
    false,
    `handlers/frame.ts → ops 是同型环边（index → frame → ops → index）。\n  当前 import：${specs.join(', ')}`,
  );
});

test('★T-0089 ②：只 import `save-slot` + `engine` 也能跑（修前这里会 TDZ）', () => {
  // 能执行到这一行，就说明 `handlers/save-slot.ts` 的**模块级求值**没有踩到环
  // （修前：`handlers/index.ts:67` 的 `...SAVE_SLOT_OPS` 直接 `ReferenceError`，本文件一行都跑不到）。
  assert.ok(SAVE_SLOT_OPS.length > 0, 'save-slot 的 opcode 表非空（模块已正确求值）');
  const e = new Engine(new StubNative(() => {}));
  assert.ok(e.frames[0], 'engine 也要能正常构造（同图里没有别的模块级抛错）');
  assert.equal(typeof buildSlotFile, 'function');
  assert.equal(typeof parseSlotFile, 'function');
});

test('T-0089 ③：`loadScriptIntoFrame` 的定义位置是叶子模块（`vm/scriptFrame.ts`），不是 handlers', () => {
  const spec = importsOf('vm/handlers/save-slot.ts').find((s) => s.includes('scriptFrame'));
  assert.ok(spec, `save-slot 必须从 scriptFrame.js 取 loadScriptIntoFrame（当前 import：${importsOf('vm/handlers/save-slot.ts').join(', ')}）`);
  const leaf = fs.readFileSync(path.join(SRC, 'vm/scriptFrame.ts'), 'utf8');
  assert.ok(leaf.includes('export function loadScriptIntoFrame'), 'scriptFrame.ts 必须定义 loadScriptIntoFrame');
  const leafImports = importsOf('vm/scriptFrame.ts');
  const bad = leafImports.filter((s) => s.includes('handlers/') || s.endsWith('/ops.js'));
  assert.deepEqual(bad, [], `叶子模块不得 import handlers/ 或 ops.js（现在：${bad.join(', ')}）`);
});
