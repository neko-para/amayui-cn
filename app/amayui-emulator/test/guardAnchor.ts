/**
 * **守卫锚点**（`tickets/T-0130`）—— 把三层台账的 `guard` / `guards[]` / `tests[]`
 * 从"文件存在"升级为"**用例存在**"：`test/x.test.ts` 或 `test/x.test.ts#<用例名片段>`。
 *
 * ★**实现只有一份**：`<repo>/scripts/lib/guard-spec.cjs`。本文件只是它的**再导出** ——
 *   同一个规则还被三个 `--validate` 工具（`capabilities.js` / `scripts.js` / `tickets.js`）共用，
 *   它们是 **CommonJS** ⇒ 共享物放 `.cjs`，TS 侧用 `.d.cts` 拿类型。
 *
 * 为什么需要它（审计原话）：三份台账原先都只 `fs.existsSync(file)`。实测 139 条能力 / 92 条 guard
 * 只用到 **54 个文件**，`test/adv-msgwin.test.ts` 一家给 **11 条能力**当守卫；把全部 guard 指向
 * `test/harness.ts` 也**全绿** ⇒ "声称有守卫"与"真有守卫"之间没有机械联系。
 */
export { splitGuardSpec, checkGuard, checkGuards } from '../../../scripts/lib/guard-spec.cjs';
