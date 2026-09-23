/** @tier T0 @kind ratchet @subsystem vm */

/**
 * **指令集 JSON 同步棘轮**（`tickets/T-0022`）。
 *
 * ## 两份文件的关系（别搞反）
 * | 文件 | 角色 |
 * |---|---|
 * | `scripts/asm/opcodes.json` | **真源生成物**（`node scripts/asm/build-opcodes.js` 从 `docs-new/03-engine/opcode-table.md` + `age-shared.cpp` 写出；装配器 `scripts/asm/cli.js` 直接读它） |
 * | `app/amayui-emulator/src/generated/opcodes.json` | **包内副本**（同一次生成写出；`src/opcodes.ts` import 它） |
 *
 * 为什么要有包内副本：`src/opcodes.ts` 原先 import `../../../scripts/asm/opcodes.json` —— 一个跨出
 * `tsconfig.json` 的 `rootDir: src` 的编译输入（实测 `npm run build` 今天**不**报 TS6059，但
 * `dist/tsc/opcodes.js` 里留下的说明符从 `dist/tsc/` 出发解析不到任何东西 ⇒ 长期隐患）。
 * 副本让包内自洽，同时把"真源"留在原处（装配器与所有测试读的还是仓根那份）。
 *
 * ## 判据
 *  - 两份**逐字节**相同（生成器用同一个字符串写两次 ⇒ 只可能是"改了真源没重跑生成器"）；
 *  - 条数 > 500（防止解析口径坏掉后"两份都空 ⇒ 也算相同"这种假绿）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const CANON = path.join(ROOT, 'scripts', 'asm', 'opcodes.json');
const COPY = path.join(ROOT, 'app', 'amayui-emulator', 'src', 'generated', 'opcodes.json');

test('★T-0022：包内 opcodes.json 必须与仓根真源逐字节相同（改了真源就重跑 build-opcodes.js）', () => {
  assert.ok(fs.existsSync(CANON), `真源缺失：${CANON}`);
  assert.ok(
    fs.existsSync(COPY),
    `包内副本缺失：${COPY}\n  ⇒ 跑 \`node scripts/asm/build-opcodes.js\`（它会同时写两份）`,
  );
  const a = fs.readFileSync(CANON);
  const b = fs.readFileSync(COPY);
  assert.equal(
    Buffer.compare(a, b),
    0,
    '两份 opcodes.json 不一致（不是"格式差异"——生成器写的是同一个字符串）⇒ 重跑 `node scripts/asm/build-opcodes.js`',
  );
});

test('★T-0022：副本内容可用（条数 > 500，且每条有 argc/name 字段形状）', () => {
  const list = JSON.parse(fs.readFileSync(COPY, 'utf8')) as { opcode: number; argc: number; name: string }[];
  assert.ok(list.length > 500, `条数异常：${list.length}`);
  const bad = list.filter((e) => typeof e.opcode !== 'number' || typeof e.argc !== 'number' || typeof e.name !== 'string');
  assert.deepEqual(bad.slice(0, 5), [], '有条目缺 opcode/argc/name 的形状');
});
