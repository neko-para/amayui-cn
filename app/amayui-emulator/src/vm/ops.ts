/**
 * opcode handler 的公共入口（**稳定的对外 API**）。
 *
 * 实现已按引擎子系统拆到 `./handlers/` 下，本文件只做再导出，使
 * `import { OPS } from './ops.js'` 这类既有调用点（测试、解释器、run/report）
 * 不必随内部分文件而改动：
 *
 * | 表 | handlerKind | 含义 |
 * |---|---|---|
 * | `OPS` | `implemented` | VM 核心，精确实现 |
 * | `NATIVE_OPS` | `native` | 经 NativeBridge 落到宿主子系统 |
 * | `ENGINE_INTERNAL_OPS` | `engine-internal` | 引擎内部/无对应子系统 → 记录并跳过（全部为纯 no-op） |
 *
 * 未出现在任何表中 ⇒ 解释器硬报错（ADR-005）。
 * 分模块导览见 `./handlers/index.ts`（拼装）与各子系统模块头部注释。
 */

export {
  OPS,
  NATIVE_OPS,
  ENGINE_INTERNAL_OPS,
  REGISTRY_NAMES,
  ExitScript,
  ScriptReset,
  loadScriptIntoFrame,
} from './handlers/index.js';
export type { OpTable } from './handlers/shared.js';
