/**
 * **调试断点**（`tickets/T-0114` 第 2 步）—— 条件断点 + 语义事件断点。
 *
 * ## 要解决的问题
 * `tickets/T-0102` 排查时，最贵的一步是"把 `global 0` 从 6 改成 1 的**到底是谁**"：
 * 每换一个假设就要**改源码加诊断 → 重编 → 从标题推进约 4 分钟**。
 * 断点把这件事变成"停下看调用栈"。
 *
 * ## 两类断点（用户 2026-09-22 确认的范围）
 *  1. **条件断点**（`kind: 'step'`）：**每条指令即将执行时**（`dispatch` 进入前）求一次条件，
 *     满足即停 —— 例如 `global 0 == 1`。★它检查的是"**此刻引擎/帧的状态**"，
 *     与"刚执行过哪条指令"无关（这一点容易被"指令步"这种叫法误导，故此处显式写明）；
 *  2. **语义事件**：在"改状态"的那一刻停（不依赖用户自己拼 opcode）——
 *     目前覆盖 **写全局 int** 与 **绑定纹理槽**（这两处正是 T-0102 的两个焦点）。
 *
 * ## 设计约束（与提案 `tickets/T-0114/notes.md` §3 一致）
 *  - **纯函数 / 无 eval**：条件用**手写递归下降**解析成 AST（见 `parseCondition`/`evalCondition`），
 *    白名单操作数；绝不 `eval`/`new Function`；
 *  - **不碰 `src/*.txt`、不写引擎状态**：本模块只回答"命中了吗"；
 *  - **可测**：`evalCondition` / `matchInstruction` / `matchEvent` 都是纯函数，不依赖 DV/时钟 ⇒ 直接上 E2 守卫。
 *
 * ## 条件表达式语法（极小子集）
 * ```
 * expr    := or
 * or      := and ('||' and)*
 * and     := cmp ('&&' cmp)*
 * cmp     := unary (('=='|'!='|'<='|'>='|'<'|'>') unary)?     // 缺比较 = 真值判定（0 为假）
 * unary   := '!' unary | primary
 * primary := '(' expr ')' | INT | 'global' INT | 'local' INT
 *          | 'slot' [INT] | 'idx' | 'val' | 'imgid'
 * ```
 * ★**刻意缩范围**：**不支持** `frame[i].local` 这种"指定别的帧"的形式 ——
 *   它在纯十进制口径下与 `frame[11]` 有歧义风险，而实际排查里 99% 的条件只需**当前帧**的局部量
 *   （`local N`）。要查别的帧请用控制面板的 `flocal <帧> <下标>` **查询**（只读、不影响断点）。
 *
 * **数字口径（无歧义优先）**：`0x…` ⇒ 十六进制；含 `a-f` 的串 ⇒ 十六进制（十进制没这些字符）；
 * 纯数字串 ⇒ **十进制**。例：`0x11`=17、`11`=11、`1dd7`=0x1dd7、`f8080`=0xf8080。
 */

import type { DebugEventKind, Engine } from './engine.js';
import { decIntSlot } from './ref.js';
import { f32, i32 } from './bits.js';

// ---------------------------------------------------------------------------
// 条件表达式：解析（递归下降，白名单） + 求值
// ---------------------------------------------------------------------------

type Node =
  | { k: 'num'; v: number }
  | { k: 'global'; idx: number }
  | { k: 'local'; idx: number }
  | { k: 'slot'; idx: number }
  /** **事件断点专用**：事件参数（如写全局的 `idx`/`val`、绑槽的 `slot`/`imgid`）。 */
  | { k: 'param'; name: string }
  | { k: 'not'; a: Node }
  | { k: 'and'; a: Node; b: Node }
  | { k: 'or'; a: Node; b: Node }
  | { k: 'cmp'; op: string; a: Node; b: Node };

/** 解析失败时抛（消息面向用户，直接显示在面板上）。 */
export class ConditionError extends Error {}

const CMP_OPS = ['==', '!=', '<=', '>=', '<', '>'] as const;

/** 记一个 token（数字/标识符/符号），供递归下降消费。 */
interface Tok {
  t: 'num' | 'id' | 'op';
  s: string;
  v?: number;
}

/** 词法：把条件串切成 token（**不做任何求值**）。 */
function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(' || c === ')' || c === '[' || c === ']' || c === '.') {
      // ★`[`/`]`/`.` 必须在这里显式产出 token —— 曾经漏了 `[`/`]`，
      //   于是 `frame[1].local` 只在字符流里"看起来对"，一到 parser 就报"尾部有多余内容"。
      out.push({ t: 'op', s: c });
      i++;
      continue;
    }
    if (c === '!') {
      // `!=` 要合成一个 op；`!` 单独是"非"
      if (c === '!' && src[i + 1] === '=') {
        out.push({ t: 'op', s: '!=' });
        i += 2;
        continue;
      }
      out.push({ t: 'op', s: c });
      i++;
      continue;
    }
    if (c === '&' || c === '|' || c === '=' || c === '<' || c === '>') {
      const two = src.slice(i, i + 2);
      if (two === '&&' || two === '||' || two === '==' || two === '<=' || two === '>=') {
        out.push({ t: 'op', s: two });
        i += 2;
        continue;
      }
      if (c === '<' || c === '>') {
        out.push({ t: 'op', s: c });
        i++;
        continue;
      }
      throw new ConditionError(`表达式里不支持的符号「${c}」（可用：== != < <= > >= && || ! ( )）`);
    }
    if (/[0-9a-fA-F]/.test(c)) {
      // ★数字字面量**只吃 `[0-9]` 与 `0x[0-9a-f]`** 两种形状；裸的 `b`/`1d` 这类
      //   "看着像 hex、其实是十进制串"的输入**报错**而不是被 `parseInt(...,16)` 悄悄改变含义
      //   （本工程的坐标/层号在 src/*.txt 里是 hex，但用户手敲时很可能是十进制。
      //    错误提示会让这个歧义立刻可见，而不是给出一个"看起来对、其实差了几十倍"的值）。
      // ★数字口径（**无歧义优先**，已在文件头文档化）：
      //   - `0x…`          ⇒ 一律按**十六进制**；
      //   - 含 `a-f` 的串   ⇒ 只可能是十六进制（十进制没这些字符）⇒ 按十六进制；
      //   - 纯数字串        ⇒ 按**十进制**。
      //   例：`0x11`=17、`11`=11、`1dd7`=0x1dd7、`f8080`=0xf8080。
      //   为什么不做"裸串一律 hex"：用户在条件里手敲 `11` 时几乎一定指十进制（槽 11）；
      //   而会话/字典下标那种 hex 习惯可以写 `0x` 前缀（或含字母的串，如 `1dd7`）。
      let raw: string;
      let isHex: boolean;
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
        let j = i + 2;
        while (j < src.length && /[0-9a-fA-F]/.test(src[j]!)) j++;
        if (j === i + 2) throw new ConditionError('`0x` 后面没有数字');
        raw = src.slice(i, j);
        i = j;
        isHex = true;
      } else {
        let j = i;
        while (j < src.length && /[0-9a-fA-F]/.test(src[j]!)) j++;
        raw = src.slice(i, j);
        i = j; // ★必须推进；漏掉这一步会让 token 流卡在同一个字符上（曾真的写漏过）
        isHex = /[a-fA-F]/.test(raw);
      }
      const digits = isHex && (raw.startsWith('0x') || raw.startsWith('0X')) ? raw.slice(2) : raw;
      const v = isHex ? parseInt(digits, 16) : parseInt(digits, 10);
      if (!Number.isFinite(v)) throw new ConditionError(`不是合法的数字：${raw}`);
      out.push({ t: 'num', s: raw, v: v >>> 0 });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z_0-9]/.test(src[j]!)) j++;
      out.push({ t: 'id', s: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    throw new ConditionError(`表达式里出现无法识别的字符「${c}」`);
  }
  return out;
}

/** 把条件串解析成 AST（白名单；失败抛 `ConditionError`）。 */
export function parseCondition(src: string): Node {
  const toks = lex(src);
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const eat = (s: string): boolean => {
    const t = peek();
    if (t && t.t === 'op' && t.s === s) {
      p++;
      return true;
    }
    return false;
  };
  const expect = (s: string): void => {
    if (!eat(s)) throw new ConditionError(`表达式缺少「${s}」`);
  };
  const needNum = (): number => {
    const t = peek();
    if (!t || t.t !== 'num') throw new ConditionError('这里需要一个数字（十六进制）');
    p++;
    return t.v!;
  };
  const needId = (): string => {
    const t = peek();
    if (!t || t.t !== 'id') throw new ConditionError(`这里需要一个名字（如 global / local / slot）`);
    p++;
    return t.s;
  };

  const primary = (): Node => {
    if (eat('(')) {
      const n = or();
      expect(')');
      return n;
    }
    const t = peek();
    if (t && t.t === 'num') {
      p++;
      return { k: 'num', v: t.v! };
    }
    if (t && t.t === 'id') {
      const id = needId();
      if (id === 'global') return { k: 'global', idx: needNum() };
      if (id === 'local') return { k: 'local', idx: needNum() };
      if (id === 'slot') {
        // `slot <下标>` = 引擎台账里的该槽；裸 `slot` = **本次事件的槽**（仅事件断点有意义）
        const t2 = peek();
        if (t2 && t2.t === 'num') {
          p++;
          return { k: 'slot', idx: t2.v! };
        }
        return { k: 'param', name: 'slot' };
      }
      if (id === 'f2i') {
        // `f2i(<int32 位模式>)`：把 float 池事件带来的位模式还原成数值，便于与整数常量比。
        // ★为什么需要它：本条件语言只比整数（没有浮点字面量），而 `global-float-write` 的 `val`
        //   是 IEEE754 位模式 —— 直接写 `val == 1` 是把位模式和 1 比，**不是**"值等于 1.0"。
        expect('(');
        const a = needNum();
        expect(')');
        return { k: 'num', v: f32(a) };
      }
      if (id === 'idx' || id === 'val' || id === 'imgid') return { k: 'param', name: id };
      throw new ConditionError(
        `不认识的名字「${id}」（可用：global / local / slot / idx|val|imgid(事件断点) / 数字 / ( ) / ! / && / ||）`,
      );
    }
    throw new ConditionError('表达式在这个位置需要一个操作数');
  };

  const unary = (): Node => {
    if (eat('!')) return { k: 'not', a: unary() };
    return primary();
  };

  const cmp = (): Node => {
    const a = unary();
    const t = peek();
    if (t && t.t === 'op' && (CMP_OPS as readonly string[]).includes(t.s)) {
      p++;
      return { k: 'cmp', op: t.s, a, b: unary() };
    }
    return a;
  };

  const and = (): Node => {
    let a = cmp();
    while (eat('&&')) a = { k: 'and', a, b: cmp() };
    return a;
  };

  function or(): Node {
    let a = and();
    while (eat('||')) a = { k: 'or', a, b: and() };
    return a;
  }

  const n = or();
  if (p !== toks.length) throw new ConditionError(`表达式尾部有多余内容（从第 ${p + 1} 个 token 起）`);
  return n;
}

/** 求值上下文：命中判定只读这些（引擎 + 当前帧号）。 */
export interface EvalCtx {
  engine: Engine;
  /** 当前帧下标（条件断点用；语义事件里也用 `engine.cur`）。 */
  cur?: number;
  /**
   * **事件参数**（仅事件断点用）：条件的求值上下文里额外暴露这几个名字。
   *
   * 为什么需要：语义事件断点的条件天然要引用"这次事件带的值"——
   *   - 写全局：`idx`（哪个全局槽）+ `val`（写进去的解码值）⇒ 写 `idx == 0` 就是"任何写 global 0 都停"；
   *   - 绑槽：`slot`（槽号）+ `imgid` ⇒ 写 `slot == 11 && imgid == 5260`。
   * 这是**只读的名字**，与 `global/local/slot` 同一套白名单，不引入表达式能力。
   */
  params?: Record<string, number>;
}

function readGlobal(e: Engine, idx: number): number {
  return decIntSlot(e.key, e.globals.int.get(idx));
}
function readLocal(e: Engine, frameIdx: number, idx: number): number {
  const fr = e.frames[frameIdx];
  return fr ? decIntSlot(e.key, fr.locals.int.get(idx)) : 0;
}

/** 求值（纯函数）。返回 i32 数值：比较/逻辑结果为 0/1。 */
export function evalCondition(node: Node, ctx: EvalCtx): number {
  const { engine } = ctx;
  const cur = ctx.cur ?? engine.cur;
  switch (node.k) {
    case 'num':
      return i32(node.v);
    case 'global':
      return readGlobal(engine, node.idx);
    case 'local':
      return readLocal(engine, cur, node.idx);
    case 'slot': {
      const v = engine.texSlots.get(node.idx);
      return v === undefined ? -1 : i32(v);
    }
    case 'param':
      return i32(ctx.params?.[node.name] ?? 0);
    case 'not':
      return evalCondition(node.a, ctx) === 0 ? 1 : 0;
    case 'and':
      return evalCondition(node.a, ctx) !== 0 && evalCondition(node.b, ctx) !== 0 ? 1 : 0;
    case 'or':
      return evalCondition(node.a, ctx) !== 0 || evalCondition(node.b, ctx) !== 0 ? 1 : 0;
    case 'cmp': {
      const a = evalCondition(node.a, ctx);
      const b = evalCondition(node.b, ctx);
      switch (node.op) {
        case '==':
          return a === b ? 1 : 0;
        case '!=':
          return a !== b ? 1 : 0;
        case '<':
          return a < b ? 1 : 0;
        case '<=':
          return a <= b ? 1 : 0;
        case '>':
          return a > b ? 1 : 0;
        case '>=':
          return a >= b ? 1 : 0;
        default:
          throw new ConditionError(`未知比较符 ${node.op}`);
      }
    }
  }
}

/** 便捷入口：解析 + 求值（解析失败会抛 `ConditionError`；调用方应缓存 AST）。 */
export function testCondition(src: string, ctx: EvalCtx): boolean {
  return evalCondition(parseCondition(src), ctx) !== 0;
}

// ---------------------------------------------------------------------------
// 断点表
// ---------------------------------------------------------------------------

/** 一条断点。 */
export interface BreakSpec {
  /** 命令台里的编号（用于删除/点名；`delete 2`）。 */
  id: number;
  /**
   * `'step'` = **条件断点**（每条指令执行前求条件）；`'event'` = **语义事件断点**。
   * 事件断点的 `where` 指定事件类型，`condition` 仍会被求值（可空 = 一律命中）。
   */
  kind: 'step' | 'event';
  /**
   * 事件类型（`kind==='event'` 时必填）。**按池命名** —— 见 `Engine.debugEvent`：
   * `global-int-write` / `global-float-write` / `global-str-write` / `slot-bind`
   * （不写笼统的 `global-write`：`GlobalArrays` 是分池的，`val` 的类型随池而变）。
   */
  where?: DebugEventKind;
  /** 条件源码（空 = 无条件，即"每步/每次事件都停"）。 */
  condition: string;
  /** 已编译的 AST（由 `add` 时解析；解析失败则不入表）。 */
  ast?: Node;
  /** 条件为空时标记（省一次求值）。 */
  always?: boolean;
  /** 命中次数（诊断用）。 */
  hits?: number;
  /** 用户可读的备注（面板原样显示）。 */
  note?: string;
}

/** 命中时交给会话的信息（面板据此显示"为什么停的"）。 */
export interface BreakHit {
  spec: BreakSpec;
  /** `'step'` 时是 `脚本名@ip`；`'event'` 时是事件描述。 */
  where: string;
  /** 语义事件的细节（写全局：`idx`/`value`；绑槽：`slot`/`imgid`）。 */
  detail?: string;
  /** 结构化的值，便于面板/测试断言（不参与显示）。 */
  values?: Record<string, number | string>;
}

/** 编译一条断点（失败抛 `ConditionError`，消息面向用户）。 */
export function compileBreak(spec: Omit<BreakSpec, 'ast' | 'always'>): BreakSpec {
  // ★**事件类型必须在这一层校验**（`tickets/T-0114` 第 8 次变更）：`where` 是**事件断点的唯一
  //   匹配键**（`matchEvent` 里 `s.where !== where` 直接跳过），写错一个字母（如 `bogus-kind`）
  //   的后果是"断点进了表、命中数永远 0" —— **静默的死断点**，比报错难查得多。
  //   为什么放在这里而不是只放在 `parseDebugCommand`：命令台（面板）走前者，而**调试守护进程
  //   `tools/debugsrv.cjs` 是手工分流的**（它只做 `b event` 前缀识别、不做校验）⇒ 只在解析器里
  //   校验会漏掉 CLI 那条路（2026-09-23 实测：`dbg 'b event bogus-kind idx == 0'` 被静默注册）。
  //   `compileBreak` 是面板与 CLI 的**共同收口点** ⇒ 校验放这里两条路一起覆盖。
  if (spec.kind === 'event' && !(EVENT_KINDS as readonly string[]).includes(spec.where ?? '')) {
    throw new ConditionError(
      `事件类型必须是 ${EVENT_KINDS.join(' / ')} 之一（收到「${spec.where ?? ''}」）`,
    );
  }
  const condition = (spec.condition ?? '').trim();
  if (condition === '') return { ...spec, condition: '', always: true, ast: undefined };
  return { ...spec, condition, ast: parseCondition(condition), always: false };
}

/**
 * **条件断点**是否命中（纯函数）。
 *
 * @param specs 断点表（只取 `kind==='step'`）
 * @param e     引擎（求值条件用）
 * @param scriptName 当前脚本名（仅用于回填 `where`）
 */
export function matchInstruction(specs: readonly BreakSpec[], e: Engine, scriptName: string): BreakHit | null {
  const cur = e.cur;
  for (const s of specs) {
    if (s.kind !== 'step') continue;
    if (s.always || evalCondition(s.ast!, { engine: e, cur }) !== 0) {
      const fr = e.frames[cur];
      return {
        spec: s,
        where: `${scriptName || '(无名)'}@ip=${fr?.ip ?? '?'}`,
        values: { cur, ip: fr?.ip ?? -1 },
      };
    }
  }
  return null;
}

/**
 * **语义事件断点**是否命中（纯函数）。
 *
 * @param where 事件类型
 * @param values 事件携带的量（如 `{ idx, value }` / `{ slot, imgid }`）
 */
export function matchEvent(
  specs: readonly BreakSpec[],
  where: DebugEventKind,
  e: Engine,
  values: Record<string, number>,
  describe: string,
): BreakHit | null {
  // 事件值 → 条件里可见的名字。★**按事件种类映射**（不再假设是 int 池）：
  //   `global-int-write`   ⇒ idx / val（val = 解码后的 int）
  //   `global-float-write` ⇒ idx / val（val = **float 的 int32 位模式**，用 `f2i` 比整数常量）
  //   `global-str-write`   ⇒ idx / val（val = 字符串**长度**）
  //   `slot-bind`          ⇒ slot / imgid
  const params: Record<string, number> =
    where === 'slot-bind'
      ? { slot: values.slot ?? 0, imgid: values.imgid ?? 0 }
      : { idx: values.idx ?? 0, val: values.val ?? 0 };
  for (const s of specs) {
    if (s.kind !== 'event' || s.where !== where) continue;
    if (s.always || evalCondition(s.ast!, { engine: e, params }) !== 0) {
      const detail = Object.entries(values)
        .map(([k, v]) => `${k}=${v < 0 ? v : `0x${(v >>> 0).toString(16)}`}`)
        .join(' ');
      return { spec: s, where: describe, detail, values: { ...values } };
    }
  }
  return null;
}


// ---------------------------------------------------------------------------
// 命令台（lldb 风格）：一行输入 → 一个动作
// ---------------------------------------------------------------------------

/**
 * **一行命令解析出来的动作**（纯数据，便于守卫与"先解析后执行"的分层）。
 *
 * 交互形态（用户 2026-09-22 要求）：**输入指令 → 生效**，而不是点按钮。
 * 与 lldb 的对应关系：
 * ```
 * b <条件>              条件断点（每条指令执行前求条件）      ≈ breakpoint set --condition
 * b event <类型> <条件>  语义事件断点（写全局 / 绑槽）          ≈ watchpoint set
 * bl / breakpoints     列断点（含命中次数）                    ≈ breakpoint list
 * d [id] / delete [id] 删一条（省略 = 全删）                   ≈ breakpoint delete
 * c / cont / continue  继续（从当前指令走过去）                 ≈ process continue
 * ?  / help            帮助
 * <其它>                交给**调试查询**（见 `debugQuery.ts`）  ≈ expression / frame variable
 * ```
 */
export type DebugAction =
  | { a: 'break-add'; breakKind: 'step' | 'event'; where?: string; condition: string }
  | { a: 'break-del'; id?: number }
  | { a: 'break-list' }
  | { a: 'continue' }
  | { a: 'help' }
  /** 其它输入一律当查询（`runQuery`）；这样"查一个值"不需要任何前缀。 */
  | { a: 'query'; text: string };

/** 事件断点的合法类型（`b event <类型> <条件>`）。 */
export const EVENT_KINDS = [
  'global-int-write',
  'global-float-write',
  'global-str-write',
  'slot-bind',
] as const;

/** 命令台帮助文本。 */
export const DEBUG_COMMAND_HELP: string[] = [
  '命令（输入后回车即生效；与 lldb 同形）：',
  '  b <条件>              条件断点：**每条指令即将执行时**求一次条件，满足即停',
  '                        例：`b global 0x11 == 5260`、`b`（= 每条指令都停）',
  '  b event <类型> <条件>  语义事件断点：在"改状态"的那一瞬停',
  '                        类型（**按池命名**）：global-int-write / global-float-write /',
  '                                              global-str-write / slot-bind',
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

/** 解析一行命令（纯函数；不接触引擎）。返回 `null` = 空行。 */
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
      return {
        a: 'break-add',
        breakKind: 'event',
        where: kind,
        condition: rest.slice(2).join(' '),
      };
    }
    // `b [条件]`（条件可空 = 每条指令都停）
    return { a: 'break-add', breakKind: 'step', condition: rest.join(' ') };
  }

  return { a: 'query', text };
}
