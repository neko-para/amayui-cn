/**
 * **调试查询（direct query）** —— 把"当前引擎/场景里的某个量是多少"变成控制面板上的一句话。
 *
 * ## 为什么需要它（`tickets/T-0114` 提案的第 1 步）
 * 在 `tickets/T-0102` 的排查里，验证一个假设的代价是：
 * **改源码加临时诊断 → 重编 → 从标题推进约 4 分钟**（那一轮在 `arithmetic`/`gfx-texture`/`save-slot`/`control`
 * 四处打了 `[T-0102 诊断]` 探针、每轮都要用户手动重现；**那些探针已于 2026-09-23 全部撤掉** ——
 * 本模块 + 断点 + 输入驱动（见 `tools/debugsrv.cjs`）已经覆盖同一批观测，见 `tickets/T-0114/changes.md` 第 8 次变更）。
 * 而绝大多数时候想问的只是"这个全局/这个槽/这一帧现在是多少"。本模块把这类问题**只读**地回答掉。
 *
 * ## 设计约束（与提案一致）
 *  - **纯函数**：`runQuery(engine, text)` 不改状态、不打日志、不依赖 DOM/IPC ⇒ 可以直接上 E2 守卫；
 *  - **不 eval**：手写的小解析器 + 白名单命令，绝不 `eval`/`Function`；
 *  - **只读**：本模块没有写路径（写入类能力若要做，另开一条通道并单独设计，见提案 §3）。
 *
 * ## 命令集（`?` / 空行 = 帮助）
 * ```
 * global <下标> [count]     读全局 int 槽（**解码后**的值；原始编码值一并给出）
 * local <下标>              读当前帧的 local int 槽
 * frame [下标]              列帧栈；给下标则展开该帧（脚本/ip/caller/局部量条数）
 * flocal <帧> <下标>        读写不出帧时，直接指定帧读它的局部量
 * slot <槽号>               读纹理槽绑定（VM 台账 + 宿主已就绪纹理，两者分开报以免混淆）
 * l2d <槽号>                Live2D 槽运行态（模型/纹理数/当前动作）
 * barrier                   纹理帧屏障②运行账（0x1F9/0x249 之后 await 了几次）
 * run                       当前运行态（cur / 脚本 / ip / 等待门 / 错误）
 * help                      命令帮助
 * ```
 * ★**为什么 `global` 要同时给"解码后"和"原始"**：引擎的 int 池在内存里是 ENC 过的
 * （`bits.ts` 的 `enc`/`dec`），脚本写 `6` 存取的是 `0x18000`。只看原始值会误判
 * （`tickets/T-0102` 真的踩过：`0x4000` 到底是"1"还是"6"取决于 key）。
 */
import type { Engine } from '../vm/engine.js';
import { decIntSlot } from '../vm/ref.js';
import { i32 } from '../vm/bits.js';

/** 一条查询的结果（给控制面板直接渲染）。 */
export interface DebugQueryResult {
  /** 回显用户输入（便于面板把"问题/答案"配对）。 */
  query: string;
  /** 是否解析/执行成功（失败时 `lines` 里是原因与用法）。 */
  ok: boolean;
  /** 结果正文（每行一条；面板按等宽文本渲染）。 */
  lines: string[];
}

/** 把值同时给成十进制与十六进制（负数按 i32 显示，便于与脚本里的裸 hex 字面量对照）。 */
function num(v: number): string {
  const s = i32(v);
  return `${s}${s < 0 ? ` (0x${(v >>> 0).toString(16)}, 即有符号 ${s})` : ` (0x${(v >>> 0).toString(16)})`}`;
}

/** 帮助文本（`?` / 空输入 / 未知命令时给）。 */
export const DEBUG_QUERY_HELP: string[] = [
  '可用查询：',
  '  global <下标> [count]   全局 int 槽（给解码后的值 + 原始编码值）',
  '  local <下标>            当前帧的 local int 槽',
  '  frame [下标|all]       列**活帧**（空槽折叠；给下标则展开该帧；`all` 强制全列）',
  '  flocal <帧> <下标>      指定帧的 local int 槽',
  '  slot <槽号>             纹理槽绑定（VM 台账 / 宿主纹理 分开报）',
  '  l2d <槽号>              Live2D 槽运行态（模型/纹理数/当前动作；需要宿主查询）',
  '  barrier                 纹理帧屏障②运行账（0x1F9/0x249 之后 await 了几次；需要宿主查询）',
  '  run                     当前运行态（cur / 脚本 / ip / 门 / 错误）',
  '  help                    本帮助',
  '★全部只读；下标按**十六进制**输入（与 src/*.txt 的字面量口径一致），也接受 0x 前缀。',
];

/** 解析一个下标：按 hex 读（与脚本口径一致），接受 `0x` 前缀与十进制数字串的歧义由 hex 优先。 */
function parseIndex(tok: string | undefined): number | null {
  if (tok === undefined) return null;
  const t = tok.startsWith('0x') || tok.startsWith('0X') ? tok.slice(2) : tok;
  if (!/^[0-9a-fA-F]+$/.test(t)) return null;
  return parseInt(t, 16) >>> 0;
}

/** 读一个全局 int 槽：返回 {raw, decoded}（未写过 = undefined ⇒ decoded 当 0，与操作数读侧一致）。 */
function readGlobalInt(e: Engine, key: number): { raw?: number; decoded: number } {
  const raw = e.globals.int.get(key);
  return { ...(raw === undefined ? {} : { raw }), decoded: decIntSlot(e.key, raw) };
}

/**
 * **执行一条调试查询**（纯函数：只读 `engine`，不改任何状态）。
 *
 * @param engine 当前引擎
 * @param text   用户输入的一行（控制面板文本框）
 * @returns      结构化结果（`lines` 已按面板可读的粒度切好）
 */
/**
 * **宿主侧的可观测面**（`tickets/T-0127`）—— 可选注入：VM 层拿不到宿主的状态（纹理是否真的就位、
 * Live2D 槽里是什么），只能由渲染窗在调用点提供。**不传 ⇒ 行为与本票之前完全一致**（向后兼容）。
 */
export interface DebugQueryHost {
  /** 宿主侧槽状态（如"已就位 W×H"/"没有该槽"）；返回 `null` = 这一侧没有信息。 */
  slot?: (slot: number) => string | null;
  /** Live2D 槽的运行态（模型 id / 纹理数 / 当前动作）；返回 `null` = 该槽没有立绘。 */
  l2d?: (slot: number) => string | null;
  /**
   * **纹理帧屏障②的运行账**（`tickets/T-0175` 的 ⑦，出处 `tickets/T-0166` §4-③）：
   * "`0x1F9`/`0x249` 之后 await 宿主 `texturesIdle`"这件事在渲染会话里，VM 看不到
   * （`StepTrace` 不带操作数值）⇒ 走注入的回调，与 `slot`/`l2d` 同一套。
   */
  barrier?: () => string;
}

export function runQuery(engine: Engine, text: string, host?: DebugQueryHost | null): DebugQueryResult {
  const query = text.trim();
  const fail = (msg: string): DebugQueryResult => ({ query, ok: false, lines: [msg, ...DEBUG_QUERY_HELP] });
  if (query === '' || query === '?' || query === 'help') {
    return { query, ok: true, lines: DEBUG_QUERY_HELP };
  }

  const parts = query.split(/\s+/);
  const cmd = parts[0]!.toLowerCase();

  switch (cmd) {
    case 'global': {
      const key = parseIndex(parts[1]);
      if (key === null) return fail('global：需要一个下标（十六进制），如 `global 0` 或 `global 1dd7`');
      const count = parts[2] === undefined ? 1 : (parseIndex(parts[2]) ?? 1);
      const lines: string[] = [];
      for (let i = 0; i < Math.max(1, Math.min(count, 64)); i++) {
        const k = key + i;
        const { raw, decoded } = readGlobalInt(engine, k);
        lines.push(
          `global 0x${k.toString(16)} = ${num(decoded)}` +
            (raw === undefined
              ? '  ← **未写过**（读侧按 0）'
              : `  [raw 0x${(raw >>> 0).toString(16)}]`),
        );
      }
      return { query, ok: true, lines };
    }

    case 'local': {
      const idx = parseIndex(parts[1]);
      if (idx === null) return fail('local：需要一个下标（十六进制），如 `local 1`');
      const fr = engine.frames[engine.cur];
      if (!fr) return fail(`local：当前没有帧（cur=${engine.cur}）`);
      const raw = fr.locals.int.get(idx);
      return {
        query,
        ok: true,
        lines: [
          `frame[${engine.cur}] local 0x${idx.toString(16)} = ${num(decIntSlot(engine.key, raw))}` +
            (raw === undefined ? '  ← **未写过**（读侧按 0）' : `  [raw 0x${(raw >>> 0).toString(16)}]`),
        ],
      };
    }

    case 'frame': {
      if (parts[1] === undefined) {
        // ★只列"活帧"（有脚本或有 ip 进展的），空壳折叠成一行汇总。
        //   为什么：读档/调用链之后 `frames[]` 会留下大量 `scriptId=0xffffffff, ip=0` 的空槽
        //   （实测 40 帧里绝大多数是空壳），全列出来会把控制面板刷满、把真正要看的几帧埋掉。
        // 「活帧」= 装了脚本（`script` 非空）**或** `scriptId >= 0`。
        //   实测空壳的形状是 `scriptId=0xffffffff / ip=0 / 无 script`（读档或调用链残留）。
        const isLive = (fr: (typeof engine.frames)[number]): boolean => fr.script !== null || fr.scriptId >= 0;
        const live = engine.frames.map((fr, i) => ({ fr, i })).filter(({ fr }) => isLive(fr));
        const empty = engine.frames.length - live.length;
        const lines = [
          `cur=${engine.cur}  帧数=${engine.frames.length}（活帧 ${live.length}，空槽 ${empty}，已折叠）  key=${engine.key}`,
        ];
        for (const { fr, i } of live) {
          const mark = i === engine.cur ? ' ←cur' : '';
          lines.push(
            `  [${i}] ${fr.name || '(无名)'} scriptId=0x${(fr.scriptId >>> 0).toString(16)} ` +
              `ip=${fr.ip}/${fr.script?.instructions.length ?? '?'} caller=${fr.caller} ` +
              `local.int=${fr.locals.int.size} retStack=${fr.retStack.length}${mark}`,
          );
        }
        if (empty > 0) {
          const idx = engine.frames
            .map((fr, i) => ({ fr, i }))
            .filter(({ fr }) => !isLive(fr))
            .map(({ i }) => i);
          lines.push(`  空槽下标：${idx.slice(0, 24).join(',')}${idx.length > 24 ? ` …共 ${idx.length} 个` : ''}`);
          lines.push('  ★要看空槽用 `frame <下标>`；`frame all` 可强制全列。');
        }
        return { query, ok: true, lines };
      }
      if (parts[1] === 'all') {
        const lines = [`cur=${engine.cur}  帧数=${engine.frames.length}  key=${engine.key}（全列）`];
        engine.frames.forEach((fr, i) => {
          const mark = i === engine.cur ? ' ←cur' : '';
          lines.push(
            `  [${i}] ${fr.name || '(无名)'} scriptId=0x${(fr.scriptId >>> 0).toString(16)} ` +
              `ip=${fr.ip}/${fr.script?.instructions.length ?? '?'} caller=${fr.caller}${mark}`,
          );
        });
        return { query, ok: true, lines };
      }
      const i = parseIndex(parts[1]);
      const fr = i === null ? undefined : engine.frames[i];
      if (!fr) return fail(`frame：没有下标 ${parts[1]} 的帧（共 ${engine.frames.length} 帧）`);
      const locals = [...fr.locals.int.entries()]
        .slice(0, 40)
        .map(([k, v]) => `    local 0x${k.toString(16)} = ${decIntSlot(engine.key, v)}`);
      return {
        query,
        ok: true,
        lines: [
          `frame[${i}] ${fr.name || '(无名)'} scriptId=0x${(fr.scriptId >>> 0).toString(16)}`,
          `  ip=${fr.ip} caller=${fr.caller} arg=${fr.frameArg}`,
          `  retStack=[${fr.retStack.join(', ')}]`,
          `  local.int 条数=${fr.locals.int.size}（最多列 40 条）`,
          ...locals,
        ],
      };
    }

    case 'flocal': {
      const fi = parseIndex(parts[1]);
      const li = parseIndex(parts[2]);
      if (fi === null || li === null) return fail('flocal：用法 `flocal <帧下标> <局部下标>`（都是十六进制）');
      const fr = engine.frames[fi];
      if (!fr) return fail(`flocal：没有帧 ${fi}`);
      const raw = fr.locals.int.get(li);
      return {
        query,
        ok: true,
        lines: [
          `frame[${fi}] local 0x${li.toString(16)} = ${num(decIntSlot(engine.key, raw))}` +
            (raw === undefined ? '  ← **未写过**' : `  [raw 0x${(raw >>> 0).toString(16)}]`),
        ],
      };
    }

    case 'slot': {
      const s = parseIndex(parts[1]);
      if (s === null) return fail('slot：需要一个槽号（十六进制），如 `slot 11`');
      const vm = engine.texSlots.get(s);
      const size = engine.texSizes.get(s);
      return {
        query,
        ok: true,
        lines: [
          `slot 0x${s.toString(16)}（= ${s}）`,
          `  VM 台账 texSlots = ${vm === undefined ? '**未绑定**' : `0x${(vm >>> 0).toString(16)}`}`,
          `  VM texSizes   = ${size ? `${size[0]}×${size[1]}` : '（无，非 create-texture 或未建）'}`,
          // ★`tickets/T-0127`：宿主侧状态（有注入就报，没有就明说"查不到"）
          `  宿主          = ${host?.slot ? (host.slot(s) ?? '（宿主没有该槽）') : '（本次调用未注入宿主查询）'}`,
          '  ★两侧分开报的原因：VM 台账有绑定 ≠ 宿主纹理已就位（异步载入/在途丢弃，见 T-0102）。',
        ],
      };
    }

    case 'l2d': {
      // ★`tickets/T-0127`：Live2D 的运行态在**宿主**（`scene.l2dHost`）里，VM 看不到 ⇒ 走注入的回调。
      const slot = parseIndex(parts[1]);
      if (slot === null) return fail('l2d：需要一个槽号（十六进制），如 `l2d 5`');
      if (!host?.l2d) {
        return { query, ok: false, lines: ['l2d：本次调用未注入宿主查询（Live2D 运行态在宿主里，不在 VM 里）'] };
      }
      const info = host.l2d(slot);
      return {
        query,
        ok: true,
        lines: [`l2d 槽 0x${slot.toString(16)}（= ${slot}）`, `  ${info ?? '（该槽没有立绘实例）'}`],
      };
    }

    case 'barrier': {
      // ★`tickets/T-0175` 的 ⑦（出处 `tickets/T-0166` §4-③）：**纹理帧屏障②**的可观测面。
      //   修前这一面完全问不到 —— `slot` 只答宿主槽状态，问不出"0x1F9 之后到底有没有 await 过"。
      if (!host?.barrier) {
        return { query, ok: false, lines: ['barrier：本次调用未注入宿主查询（屏障账在渲染会话里，不在 VM 里）'] };
      }
      return { query, ok: true, lines: [`纹理帧屏障②（0x1F9/0x249 之后 await 宿主 texturesIdle）`, `  ${host.barrier()}`] };
    }

    case 'run': {
      const fr = engine.frames[engine.cur];
      const known = engine.engineValues;
      return {
        query,
        ok: true,
        lines: [
          `cur=${engine.cur} 帧数=${engine.frames.length}`,
          `当前帧 ${fr ? `${fr.name || '(无名)'} ip=${fr.ip}` : '(无)'}`,
          `waitFlags=0x${(engine.waitFlags >>> 0).toString(16)}  advActive=${engine.advActive}`,
          // ★**不要调 `engine.gatePending(nowMs)`**（实测踩过两个坑）：
          //   ① 它是**方法**，直接插值会把函数源码打出来；
          //   ② 更糟 —— 它**会写状态**（惰性把 `gateWaitStart` 置为 nowMs，到期还清零两格）
          //      ⇒ 一个"只读查询"会扰动门计时器。查询**绝不能**有副作用（守卫钉住）。
          //   所以这里只报**可读字段**，由读者自己判断门状态。
          `effectFlags=0x${(engine.effectFlags >>> 0).toString(16)}`,
          `门：waitFlags=0x${(engine.waitFlags >>> 0).toString(16)} gateWaitMs=${engine.gateWaitMs} ` +
            `gateWaitStart=${engine.gateWaitStart} sceneFreeze=${engine.sceneFreeze} scenePending=${engine.scenePending}`,
          `playSeconds=${engine.playSeconds}  已装载脚本名=${engine.curScript?.().name ?? '(无)'}`,
          `engineValues 条数=${known.size}`,
        ],
      };
    }

    default:
      return fail(`未知查询：${cmd}`);
  }
}
