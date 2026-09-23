/**
 * **守卫规格的唯一实现**（`tickets/T-0130`）—— 三层台账 + 三个 `--validate` 工具 + TS 守卫测试**共用这一份**。
 *
 * 规格：`<相对路径>` 或 `<相对路径>#<用例名片段>`。
 *  - 只给路径 ⇒ 只查文件存在（旧写法，向后兼容）；
 *  - 带 `#锚点` ⇒ 再查"这个字面串出现在该文件里"（用例改名/删除/搬走 ⇒ 台账当场红）。
 *
 * ★为什么单独抽出来：这条规则原先在 **4 个地方**各写一遍 ——
 *   `app/amayui-emulator/test/{capability,script,ticket}-ledger.test.ts`（TS）与
 *   `.agents/skills/<skill>/scripts/{capabilities,scripts,tickets}.js`（**CommonJS** 校验器）。
 *   审计已经抓过一次"两处实现不同步"的事故（`capabilities.js` 的注释里记着）。
 *
 * ★模块格式：三个校验器是 CommonJS ⇒ 实现用 `.cjs`；TS 侧（ESM）import 它、类型走 `guard-spec.d.cts`。
 *   **只有这一份实现**，不存在 `.mjs` / `.cjs` 两份。
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** 拆 `file#anchor`。 */
function splitGuardSpec(spec) {
  const s = String(spec ?? '');
  const i = s.indexOf('#');
  if (i < 0) return { file: s, anchor: undefined };
  return { file: s.slice(0, i), anchor: s.slice(i + 1) };
}

/** 校验一条守卫规格；返回 `null` = 通过，否则是"为什么不行"。 */
function checkGuard(root, spec) {
  const { file, anchor } = splitGuardSpec(spec);
  if (!file) return '空规格';
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) return '文件不存在';
  if (anchor === undefined) return null;
  if (anchor.trim() === '') return '`#` 后锚点为空（要么删掉 `#`，要么写一段真的用例名）';
  const body = fs.readFileSync(abs, 'utf8');
  if (!body.includes(anchor)) return `文件里找不到锚点「${anchor}」`;
  return null;
}

/** 批量校验；返回 `条目 → 原因` 列表（空 = 全通过）。 */
function checkGuards(root, pairs) {
  const bad = [];
  for (const [id, spec] of pairs) {
    const why = checkGuard(root, spec);
    if (why) bad.push(`${id} → ${spec}（${why}）`);
  }
  return bad;
}

module.exports = { splitGuardSpec, checkGuard, checkGuards };
