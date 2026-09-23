/**
 * **调试命令台的纯词汇表**（`tickets/T-0127`）—— 解析、合法事件类型、帮助文本**只有这一份**。
 *
 * ## 为什么单独抽出来（审计发现的真实事故）
 *
 * 命令表原先有 **3 份拷贝**：`src/vm/debugBreak.ts` 的 `parseDebugCommand`（被测试守着，但**零生产调用者**）、
 * `control/control.ts` 的 if 链（真发货、无测试）、`tools/debugsrv.cjs` 的 head 分流（真发货、无测试）。
 * 后果已经发生：**面板的用户可见帮助至今写着非法事件类型 `global-write`**
 * （合法值是 `global-int-write` / `global-float-write` / `global-str-write` / `slot-bind`），
 * 而守卫测的是渲染窗那份 ⇒ **钉不住**。
 *
 * ## 约束（为什么本模块必须零依赖）
 *
 * 控制窗与渲染窗是**两个编译单元**，跨单元 import 会把对方的依赖拖进打包（`ipcProtocol.ts` 的
 * `recordScript` 注释记过同类事故）。所以本模块**只依赖 TypeScript 类型**，不 import 任何引擎/渲染/
 * DOM 模块 —— 两个bundle 都能安全引它，从而"表只有一份"与"不拖依赖"同时成立。
 */

/** 一次命令解析的结果。 */
export type DebugAction =
  | { a: 'break-add'; breakKind: 'step' | 'event'; where?: string; condition: string }
  | { a: 'break-del'; id?: number }
  | { a: 'break-list' }
  | { a: 'continue' }
  | { a: 'help' }
  /** 其它输入一律当查询（`runQuery`）；这样"查一个值"不需要任何前缀。 */
  | { a: 'query'; text: string };

/**
 * 事件断点的合法类型（`b event <类型> <条件>`）。
 * ★命名按**池**（`global-int-write` 而不是笼统的 `global-write`）：`GlobalArrays` 是分池的，
 *   `val` 的类型随池而变（见 `engine.ts` 的 `DebugEventKind` 与 `emitDebugEvent` 的注释）。
 */
export const EVENT_KINDS = [
  'global-int-write',
  'global-float-write',
  'global-str-write',
  'slot-bind',
  // ★`tickets/T-0127` 扩的两类（见 `engine.ts` 的 `DebugEventKind`）：
  //   `engine-field-write` = 引擎字段 `_this[K]` 被写（`EngineFieldMap` 的写即发事件）；
  //   `local-int-write`    = 本帧 local int 被脚本写（`writeIntOperand` 的唯一写门面）。
  //   有了它们，"谁写了 Engine[N] / local N" 才能用一条命令回答（而不是写一个 E3 探针用例）。
  'engine-field-write',
  'local-int-write',
] as const;

/** 命令台帮助文本（**单一真源**：渲染窗与控制面板都渲染它）。 */
export const DEBUG_COMMAND_HELP: string[] = [
  '命令（输入后回车即生效；与 lldb 同形）：',
  '  b <条件>              条件断点：**每条指令即将执行时**求一次条件，满足即停',
  '                        例：`b global 0x11 == 5260`、`b`（= 每条指令都停）',
  '  b event <类型> <条件>  语义事件断点：在"改状态"的那一瞬停',
  `                        类型（**按池命名**）：${EVENT_KINDS.slice(0, 2).join(' / ')} /`,
  `                                              ${EVENT_KINDS.slice(2).join(' / ')}`,
  '                        参数：int/float/str 池 → `idx`（池下标）+ `val`',
  '                              （int：解码后的值；float：位模式，用 f2i 比；str：长度）',
  '                              slot-bind → `slot` + `imgid`',
  '                        例：`b event global-int-write idx == 0`（任何写 global 0 都停）',
  '                            `b event slot-bind slot == 0x11 && imgid == 0x5260`',
  '  bl / breakpoints      列断点（含命中次数）',
  '  d [id] / delete [id]  删一条；省略 id = 全删',
  '  c / continue          继续（从当前指令**走**过去）',
  '  ? / help              本帮助',
  '  <其它>                当查询：global <下标> / local <下标> / frame [下标|all] / slot <槽> / run',
  '★下标与常量口径：`0x…`=十六进制；含 a-f 的串=十六进制；纯数字=十进制。',
];

/** 解析一行命令（纯函数；不接触引擎、不接触 DOM）。返回 `null` = 空行。 */
export function parseDebugCommand(raw: string): DebugAction | null {
  const text = raw.trim();
  if (text === '') return null;
  const parts = text.split(/\s+/);
  const cmd = parts[0]!.toLowerCase();

  if (cmd === '?' || cmd === 'help') return { a: 'help' };
  if (cmd === 'c' || cmd === 'cont' || cmd === 'continue') return { a: 'continue' };
  if (cmd === 'bl' || cmd === 'breakpoints') return { a: 'break-list' };

  if (cmd === 'd' || cmd === 'delete') {
    if (parts[1] === undefined) return { a: 'break-del' };
    const id = Number.parseInt(parts[1], 10);
    if (!Number.isInteger(id)) return { a: 'query', text: `delete：id 必须是整数（收到「${parts[1]}」）` };
    return { a: 'break-del', id };
  }

  if (cmd === 'b' || cmd === 'break') {
    const rest = parts.slice(1);
    // `b event <类型> <条件>`
    if (rest[0]?.toLowerCase() === 'event') {
      const kind = (rest[1] ?? '').toLowerCase();
      if (!(EVENT_KINDS as readonly string[]).includes(kind)) {
        return {
          a: 'query',
          text: `b event：类型必须是 ${EVENT_KINDS.join(' / ')} 之一（收到「${rest[1] ?? ''}」）`,
        };
      }
      return { a: 'break-add', breakKind: 'event', where: kind, condition: rest.slice(2).join(' ') };
    }
    // `b [条件]`（条件可空 = 每条指令都停）
    return { a: 'break-add', breakKind: 'step', condition: rest.join(' ') };
  }

  return { a: 'query', text };
}
