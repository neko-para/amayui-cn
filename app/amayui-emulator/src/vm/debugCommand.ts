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
  /**
   * **宿主焦点模式**（`tickets/T-0134`）：`auto` = 跟随真实 DOM 焦点（默认）；`on`/`off` = 调试器显式接管。
   *
   * ★`mode` 用**本地字面量联合**，不 import `InputManager.HostFocus`：本模块的设计约束是**零依赖**
   *   （见文件头：控制窗与渲染窗两个编译单元都安全引它）。字面量与 `HostFocus` 结构相同，
   *   `session.ts` 侧 `input.setHostFocus(act.mode)` 天然类型兼容。
   */
  | { a: 'focus'; mode: 'auto' | 'on' | 'off' }
  /**
   * **抓一帧当前画面**（`tickets/T-0134`）：B′ 判据实验与 agent 取证的统一入口。
   *
   * 走 `FrameHost.capture`（= 页面内 `renderer.extract.canvas` 读回），**不是** Electron 的
   * `capturePage()` —— 两者是不同管线（`T-0133` §B.4.4 的 B′ vs 形态 C）。结果里带 `png`（base64）。
   *
   * ★**为什么不叫 `shot`**：`tools/debugsrv.cjs:215` 在**主进程**就截获了 `shot`/`screencap`
   *   （走 `capturePage()`），压根不会转发到渲染窗 ⇒ 同名命令永远收不到。`capture` 是"页面内读回"
   *   这条新路的专属名字，与那条待退役的旧路分清。
   */
  | { a: 'capture' }
  /**
   * **注入输入**（`tickets/T-0135` Phase 2）：把一条命令翻成若干 `ScenarioEvent`，
   * 由**拥有 `InputManager` 的那一侧**逐个 `applyScenarioEvent` 执行。
   *
   * ★为什么走这里而不是各宿主自己写一套：`T-0133` §B.4.3 —— 输入是**宿主无关**的
   *   （浏览器宿主与 Electron 宿主共用同一份词汇/执行器），而 `capture`/`focus` 也在这张表里，
   *   于是"agent 看到的命令面"只有一个（`T-0127` 的单一收口点）。
   * ★类型用**本地结构字面量**（不 import `ScenarioEvent`）：本模块的约束是**零依赖**
   *   （控制窗/渲染窗两个编译单元都引它）。字段与 `src/frame/scenario.ts` 的 `ScenarioEvent` 同形。
   */
  | {
      a: 'input'
      events: {
        kind: 'cursor' | 'press' | 'release' | 'wheel' | 'keydown' | 'keyup'
        x?: number
        y?: number
        button?: 0 | 1
        delta?: number
        vk?: number
        valid?: boolean
      }[]
    }
  /**
   * **引擎态快照**（`tickets/T-0122`）：`snapshot` 只读地导出当前引擎态（JSON 由渲染窗放进结果的一行）；
   * `restore <base64>` 把快照灌回去（base64 里的原文是 UTF-8 的 JSON）。
   * ★与 `capture`（画面 PNG）并列但不同物：这个记的是**引擎态**（池/帧链/槽/门/文本项/路由），
   *   那个记的是**画面**。两者的落盘都在守护进程/宿主侧（渲染进程没有 fs）。
   */
  | { a: 'snapshot' }
  | { a: 'restore'; json: string }
  /**
   * **写脚本全局 / 全局数组元素**（`tickets/T-0189`；"测试期把配置类全局定死"的 H2 方案）。
   *
   * 起因：ADV 侧栏（charm 表）的**每格是什么动作**存在全局数组 `global 13b0[0..8]` 里，
   * 而**默认布局里没有 SAVE/LOAD**（`src/INITCHARM.txt:6` = `[1 b c 2 3 4 5 6 7]`），玩家排布又存在
   * SAVE.DAT 里 ⇒ 任何"点侧栏读档"的用例都不该依赖玩家配置。派发是**点击时**读表（`src/SN0000.txt:401`）
   * ⇒ 只要在点击前把表写死即可。
   *
   * ★口径（与 `save-slot.ts` 的池装载一致）：写的是**脚本全局 int 池**（`Engine.globals.int`），
   *   **按 ENC 写**（`enc(key, v)`；否则脚本读出来是垃圾），**只改运行期内存、不写回 SAVE.DAT**
   *   —— 这条是刻意的：不许把"玩家数据"当成测试夹具。
   * ★`set-array` 就是 `set-global(base + index)`（数组在 emulator 里 = 一段连续全局槽，见 `memory.ts`
   *   的 `lookup-array`：`op1 = &op2[op3]`），分开命名只为让用例读起来是"写数组元素"。
   */
  | { a: 'set-global'; index: number; value: number }
  | { a: 'set-array'; base: number; index: number; value: number }
  /**
   * **计时器**（`tickets/T-0180`）：`profile [on|off|reset|report [minMs]|watch on|off|slow <ms>]`。
   * 起因 = 用户实测"存档页 80→90 有 ~4s 同步阻塞"，而文件层实测只要 2ms/次 ⇒ 必须按帧记账才能定位。
   * 无参 = `report`（最常问的那一个）。
   */
  | { a: 'profile'; cmd: 'on' | 'off' | 'reset' | 'report' | 'watch-on' | 'watch-off' | 'slow'; minMs?: number; slowMs?: number }
  /**
   * **页面内存账**（`tickets/T-0181`）：无参 ⇒ 报一次当前占用（JS 堆 + 纹理缓存项数/像素数 + 槽账）。
   *
   * 起因 = 用户实测**两次 `out of memory` 崩溃**（接入 DSH 之后），且 500MB 时采样到
   * Pixi 的 `ImageSource` 占 300MB+。本命令只**读**、不清理 —— 先能测，才谈得上治。
   */
  | { a: 'mem' }
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
  '  focus [auto|on|off]   宿主焦点模式（缺省 auto）：auto=跟随真实 DOM 焦点；',
  '                        on/off=调试器显式接管（off 立即释放全部按住态并忽略后续 DOM 焦点事件）',
  '  capture               抓一帧当前画面（页面内 extract；PNG 见结果的 png 字段）',
  '  mem                   页面内存账（JS 堆 + 纹理缓存的项数/像素数 + 槽账；只读，不清理）',
  '  snapshot              导出一份**引擎态**快照（JSON；池/帧链/槽/门/文本项/路由）',
  '  restore <base64>      灌回一份引擎态快照（base64 里是 snapshot 输出的 UTF-8 JSON）',
  '  set-global <下标> <值>  写**脚本全局 int**（按 ENC 写；只改运行期内存，**不写回 SAVE.DAT**）',
  '  set-array <基址> <i> <值> 写**全局数组元素**（= set-global 基址+i；例：侧栏 charm 表 `13b0`）',
  '  move <x> <y>          注入光标移动到虚拟坐标（1280×720；触发引擎的命中测试/悬停）',
  '  leave                 注入「光标出窗」（等价窗口 mouseleave；侧栏收起那条路）',
  '  click <x> <y> [左|右]  注入一次点击（= press + release；缺省左键）',
  '  press <x> <y> [左|右] / release [左|右]   分别注入按下/抬起（按住态可跨命令保持）',
  '  wheel <±120> [x y]    注入滚轮（引擎单位：上滚正、一格 120；缺省沿用当前光标）',
  '  key <vk> / keyup <vk> 注入键盘按下/抬起（vk = Windows 虚拟键码，如 38=↑、13=Enter）',
  '  ? / help              本帮助',
  '  profile [子命令]       计时器（`T-0180`）：无参 = 报告；on/off = 按 opcode 计时（默认关，开才有开销）；',
  '                        reset = 清零；watch on/off = 帧看门狗（**默认开**，只报数不解释）；',
  '                        slow <ms> = 慢帧阈值（默认 200）；report [minMs] = 只列累计 ≥ minMs 的指令',
  '  <其它>                当查询：global <下标> / local <下标> / frame [下标|all] / slot <槽> / run',
  '★下标与常量口径：`0x…`=十六进制；含 a-f 的串=十六进制；纯数字=十进制。',
];

/**
 * 命令行里的**数字口径**（与帮助文本「`0x…`=十六进制；含 a-f 的串=十六进制；纯数字=十进制」同一套）：
 * 下标与值共用。返回 `null` = 不合法（调用方按"当查询回报"处理，**不抛错、不崩**）。
 */
function parseNumToken(s: string): number | null {
  const t = s.trim();
  if (/^0x[0-9a-f]+$/i.test(t)) return Number.parseInt(t.slice(2), 16);
  if (/^-?\d+$/.test(t)) return Number.parseInt(t, 10);
  if (/^[0-9a-f]+$/i.test(t) && /[a-f]/i.test(t)) return Number.parseInt(t, 16);
  return null;
}

/** 解析一行命令（纯函数；不接触引擎、不接触 DOM）。返回 `null` = 空行。 */
export function parseDebugCommand(raw: string): DebugAction | null {  const text = raw.trim();
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

  if (cmd === 'focus') {
    // `focus` / `focus auto` / `focus on` / `focus off`（无参 = auto）。
    // 非法参数按既有 `b event` / `delete` 的口径回报：`{a:'query'}` 兜到 `runQuery` 打印"未知命令 + 帮助"，
    // **不抛错、不崩**（面板与 CLI 拿到同一句失败）。
    const arg = (parts[1] ?? 'auto').toLowerCase();
    if (arg !== 'auto' && arg !== 'on' && arg !== 'off') {
      return { a: 'query', text: `focus：模式必须是 auto / on / off 之一（收到「${parts[1] ?? ''}」）` };
    }
    return { a: 'focus', mode: arg };
  }

  // `capture`：抓一帧（PNG base64 由渲染窗填进结果的 `png` 字段）。只认裸命令，不吃参数。
  // ★不叫 `shot`：那个名字被 `tools/debugsrv.cjs` 在主进程截获（capturePage 路线，见 `T-0133` §B.4.4）。
  if (cmd === 'capture') return { a: 'capture' };

  // ---- 引擎态快照 / 恢复（`tickets/T-0122`）----
  // `snapshot` 只读导出；`restore <base64>` 灌回（base64 里是 UTF-8 JSON）。
  // ★为什么走 base64 而不是裸 JSON：命令是**按行**传输的（`\n` 会截断），而 JSON 里有换行/引号/反斜杠。
  if (cmd === 'snapshot') return { a: 'snapshot' };
  // `profile`（`tickets/T-0180`）：无参 = report。非法子命令按既有口径"当查询回报"（不抛错、不崩）。
  if (cmd === 'profile') {
    const sub = (parts[1] ?? 'report').toLowerCase();
    if (sub === 'on' || sub === 'off' || sub === 'reset' || sub === 'report') {
      const minMs = sub === 'report' && parts[2] !== undefined ? Number(parts[2]) : undefined;
      if (minMs !== undefined && !Number.isFinite(minMs)) {
        return { a: 'query', text: `profile report：minMs 必须是数（收到「${parts[2]}」）` };
      }
      return { a: 'profile', cmd: sub, ...(minMs !== undefined ? { minMs } : {}) };
    }
    if (sub === 'watch') {
      const v = (parts[2] ?? '').toLowerCase();
      if (v !== 'on' && v !== 'off') return { a: 'query', text: 'profile watch：参数是 on / off' };
      return { a: 'profile', cmd: v === 'on' ? 'watch-on' : 'watch-off' };
    }
    if (sub === 'slow') {
      const ms = Number(parts[2]);
      if (!Number.isFinite(ms) || ms <= 0) return { a: 'query', text: `profile slow：要一个正数 ms（收到「${parts[2] ?? ''}」）` };
      return { a: 'profile', cmd: 'slow', slowMs: ms };
    }
    return {
      a: 'query',
      text: 'profile：子命令是 on / off / reset / report [minMs] / watch on|off / slow <ms>（无参 = report）',
    };
  }
  if (cmd === 'restore') {
    // ★这里用字面量而不是下面那个 `bad()` 帮助函数：`bad` 在**输入注入那一节**才声明（在后面），
    //   而本块在它之前 —— 用它会撞 TDZ（`tsc` 的 "used before its declaration"）。
    const badRestore = (msg: string): DebugAction => ({ a: 'query', text: msg });
    if (parts[1] === undefined) return badRestore('restore：用法 restore <base64 的 JSON>（先用 snapshot 取一份）');
    let json: string;
    try {
      const bin = atob(parts[1]);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      json = new TextDecoder().decode(bytes);
    } catch {
      return badRestore('restore：base64 解不开（参数应当是 snapshot 输出的 base64 形式）');
    }
    return { a: 'restore', json };
  }

  // `mem`（`tickets/T-0181`）：只认裸命令（报一次当前占用）。参数一律当查询回报（不抛错、不崩）。
  if (cmd === 'mem') {
    if (parts[1] !== undefined) return { a: 'query', text: `mem：不吃参数（收到「${parts[1]}」）` };
    return { a: 'mem' };
  }

  // ---- 写脚本全局 / 全局数组元素（`tickets/T-0189`）----
  // 口径与命令行其它地方一致：`0x…` / 含 a-f 的串 = 十六进制，纯数字 = 十进制；
  // 非法参数走既有的"当查询回报"（不抛错、不崩），面板与 CLI 拿到同一句失败。
  if (cmd === 'set-global' || cmd === 'set-array') {
    if (cmd === 'set-array') {
      if (parts.length !== 4) {
        return { a: 'query', text: 'set-array：用法 set-array <基址下标> <元素下标> <值>（例：set-array 13b0 1 e）' };
      }
      const base = parseNumToken(parts[1]!);
      const idx = parseNumToken(parts[2]!);
      const value = parseNumToken(parts[3]!);
      if (base === null || base < 0 || !Number.isInteger(base)) {
        return { a: 'query', text: `set-array：基址下标不合法（收到「${parts[1]}」）` };
      }
      if (idx === null || idx < 0 || !Number.isInteger(idx)) {
        return { a: 'query', text: `set-array：元素下标不合法（收到「${parts[2]}」）` };
      }
      if (value === null) return { a: 'query', text: `set-array：值不合法（收到「${parts[3]}」）` };
      return { a: 'set-array', base, index: idx, value };
    }
    if (parts.length !== 3) {
      return { a: 'query', text: 'set-global：用法 set-global <下标> <值>（例：set-global a9ce 1）' };
    }
    const index = parseNumToken(parts[1]!);
    const value = parseNumToken(parts[2]!);
    if (index === null || index < 0 || !Number.isInteger(index)) {
      return { a: 'query', text: `set-global：下标不合法（收到「${parts[1]}」）` };
    }
    if (value === null) return { a: 'query', text: `set-global：值不合法（收到「${parts[2]}」）` };
    return { a: 'set-global', index, value };
  }

  // ---- 输入注入（`tickets/T-0135`；解析出来的就是 `ScenarioEvent` 的形状）----
  // 非法参数一律走既有的"当查询回报"口径（不抛错、不崩），面板与 CLI 拿到同一句失败。
  const bad = (msg: string): DebugAction => ({ a: 'query', text: msg });
  const int2 = (a: string | undefined, b: string | undefined): [number, number] | null => {
    const x = Number(a);
    const y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  };
  const btn = (t: string | undefined): 0 | 1 => (t === '右' || t === 'right' || t === 'r' ? 1 : 0);
  /** `release` 的两种写法收敛到一处（带坐标就顺手把光标也设过去，与 `press` 对称）。 */
  const xyy = (ps: string[], xy: [number, number] | null, b: 0 | 1): DebugAction =>
    xy
      ? { a: 'input', events: [{ kind: 'cursor', x: xy[0], y: xy[1], valid: true }, { kind: 'release', x: xy[0], y: xy[1], button: b }] }
      : { a: 'input', events: [{ kind: 'release', button: btn(ps[1]) }] };
  if (cmd === 'move') {
    const xy = int2(parts[1], parts[2]);
    if (!xy) return bad('move：用法 move <x> <y>（虚拟坐标 0..1280 / 0..720）');
    return { a: 'input', events: [{ kind: 'cursor', x: xy[0], y: xy[1], valid: true }] };
  }
  if (cmd === 'leave') {
    // ★`valid:false` 就是"光标出窗"（`T-0133` §0.11 的真缺口，由 `ScenarioEvent.valid` 补上）。
    return { a: 'input', events: [{ kind: 'cursor', x: 0, y: 0, valid: false }] };
  }
  if (cmd === 'click') {
    const xy = int2(parts[1], parts[2]);
    if (!xy) return bad('click：用法 click <x> <y> [左|右]');
    const b = btn(parts[3]);
    return {
      a: 'input',
      events: [
        { kind: 'cursor', x: xy[0], y: xy[1], valid: true },
        { kind: 'press', x: xy[0], y: xy[1], button: b },
        { kind: 'release', x: xy[0], y: xy[1], button: b },
      ],
    };
  }
  if (cmd === 'press') {
    const xy = int2(parts[1], parts[2]);
    if (!xy) return bad('press：用法 press <x> <y> [左|右]');
    return { a: 'input', events: [{ kind: 'cursor', x: xy[0], y: xy[1], valid: true }, { kind: 'press', x: xy[0], y: xy[1], button: btn(parts[3]) }] };
  }
  if (cmd === 'release') {
    // `release` 允许多种写法：`release` / `release 右` / `release <x> <y> [左|右]`
    const xy = int2(parts[2], parts[3]) ?? int2(parts[1], parts[2]);
    const b = btn(xy ? parts[4] ?? parts[3] : parts[1]);
    return xyy(parts, xy, b);
  }
  if (cmd === 'wheel') {
    const d = Number(parts[1]);
    if (!Number.isFinite(d)) return bad('wheel：用法 wheel <±120> [x y]');
    const xy = int2(parts[2], parts[3]);
    return {
      a: 'input',
      events: xy
        ? [{ kind: 'cursor', x: xy[0], y: xy[1], valid: true }, { kind: 'wheel', x: xy[0], y: xy[1], delta: d }]
        : [{ kind: 'wheel', delta: d }],
    };
  }
  if (cmd === 'key' || cmd === 'keyup') {
    const vk = Number(parts[1]);
    if (!Number.isInteger(vk) || vk <= 0) return bad(`${cmd}：用法 ${cmd} <vk>（Windows 虚拟键码，如 38=↑）`);
    return { a: 'input', events: [{ kind: cmd === 'key' ? 'keydown' : 'keyup', vk }] };
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
