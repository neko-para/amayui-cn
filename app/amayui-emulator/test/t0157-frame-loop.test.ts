/** @tier T0 @kind core @subsystem frame */

/**
 * **`T-0157` 守卫：帧循环 / 阶梯调度 / 队列派发批（12 条）**
 *
 * 权威 = `engine/天结_unpacked.exe_utf8.c`（只读；raw 行号 = 该文件行号）。
 * 逐条出处 = `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` 的
 * `frame-loop` 组（§4.1 行 107/108/118/127/128/181/182/302/303/304 + §4.2 行 2/3 + §4.5 行 55/56/57/58）
 * 与 `app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` 的 `## T-0157` / `## T-0167` 两节。
 *
 * ## 本文件判什么（三类，逐条都带体证）
 * 1. **已落地的修复**（P1 `0x1f5`；P2 `0x7c`/`0xc8`/`0xae`/`frame-render-gate-mainloop`）——
 *    每条**两条断言**：① 代码里那次修复的行为；② 引擎体里那条依据**逐字还在**（原文钉字串）。
 *    第 ② 条是必需的：本批的多数修复由别的波次落地（`T-0156` / `T-0166` / `T-0167` / `T-0170`），
 *    只断言行为会让"依据被后人改写而行为恰好还成立"逃过去。
 * 2. **有据登记的未做项**（P3 `0x7c` missing-consumer、`cap:frame-render-gate-mainloop` 的两条、
 *    `0x7c` missing-writer 的另一半、`clock-write-clock-freeze` 的锁后果）——按本项目判据
 *    （写没人读的字段 = 死写、不建模）**不许编消费者**：钉"引擎里那条依据在" + "emulator 里
 *    确实没有落点"，并把它变成可失败的（一旦有人接上，本文件会红，提示去改这条登记）。
 * 3. **口径棘轮**：`0x1f5` 的"队列恰剩 1 项"判据属于 `0x7C` 而非 `0x1F5`（报告已订正）；
 *    `message:CoexistMesSkip` 的键名（不是 `CoexistMess`）。
 *
 * ## 红 → 绿
 * 见 `tickets/T-0157/changes-frame.md` §2：本文件的判别力由
 * `app/amayui-emulator/.tmp/t0157/mutate-red.mjs` 证明 —— 它对 `src/vm/handlers/frame.ts`、
 * `src/frame/loop.ts`、`engine/天结_unpacked.exe_utf8.c` 各做**一次定点回退**（只改字符串、
 * 改完必复原），每一步都必须让本文件里**指定的一条**断言转红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { SLEEP_GATE } from '../src/vm/engine.js';
import { frameRenderGate } from '../src/frame/loop.js';
import { sleepPath } from '../src/vm/handlers/frame.js';
import { parseIni } from '../src/engineConfig.js';
import { im, instr, mkEngine } from './harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 工程根（`app/amayui-emulator/test` → 上三级）。 */
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENGINE_C = path.join(ROOT, 'engine', '天结_unpacked.exe_utf8.c');
const SRC = path.join(HERE, '..', 'src');

/** 权威体（只读）。**不缓存**：若同一进程内被其它用例改写，读盘才看得见。 */
const engineBody = (): string => fs.readFileSync(ENGINE_C, 'utf8');

/** emulator 源码（只读）。 */
const sourceOf = (rel: string): string => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** 在体里找一段**必须存在**的原文（含换行；找不到 = 依据被改写 ⇒ 红）。 */
function bodyHas(body: string, snippet: string, what: string): void {
  assert.ok(
    body.includes(snippet),
    `${what}：引擎体里必须逐字含这段依据（raw 锚点），实际找不到：\n${snippet}`,
  );
}

/** 在 emulator 源码里找一段**必须存在**的代码（找不到 = 修复被回退 ⇒ 红）。 */
function sourceHas(rel: string, snippet: string, what: string): void {
  const s = sourceOf(rel);
  assert.ok(
    s.includes(snippet),
    `${what}：${rel} 里必须含这段实现，实际找不到：\n${snippet}`,
  );
}

/**
 * **一个函数的定义体**（从它的 `//----- (地址)` 头到下一个头之前）。
 *
 * ★为什么不能直接用 `indexOf('void __thiscall sub_XXXX(...)')`：这份反编译器在每个函数定义
 * **之前**还输出一行**原型声明**（例：`void __thiscall sub_41A0E0(int _this);` 在 raw 410）。
 * `indexOf` 会命中那一行 ⇒ 切出来的是"从原型到文件尾"的整段（本文件第一版就这么踩了：
 * 于是「0x1F5 体里不得含 497380」这条断言把整个文件当成了 0x1F5 的体）。
 */
function bodyOfFn(body: string, addr: string, argList: string, nextAddr: string): string {
  const head = `//----- (${addr}) `;
  const next = `//----- (${nextAddr}) `;
  const call = `(${argList})`;
  const h = body.indexOf(head);
  assert.ok(h >= 0, `体里找不到函数头 ${addr}`);
  const e = body.indexOf(next, h);
  assert.ok(e > h, `体里找不到 ${addr} 之后的下一个函数头 ${nextAddr}`);
  const seg = body.slice(h, e);
  assert.ok(seg.includes(call), `${addr} 的切片必须含调用形态 ${call}`);
  return seg;
}

/** 该源码文件里某串出现的次数（用来做"只此一处"的棘轮）。 */
const countIn = (rel: string, snippet: string): number => sourceOf(rel).split(snippet).length - 1;

/**
 * **去掉注释后的代码正文**（`//` 行注释 + `///` 三斜线文档注释）。
 *
 * 为什么需要：本工程的注释里大量**逐字引用引擎体**（含 `Engine[387940]`、`430712` 这类数字），
 * 于是"某串在文件里出现几次"会把注释也算进去 ⇒ 判"有没有落点"必须只看代码。
 * ★已知的粗糙处（够用即可）：不处理 `/* … *\/` 块注释里的假 `//`、也不处理字符串字面量里的 `//`；
 * 本文件只用它做"某个纯数字/字段名在代码里是否存在"这一件事，两种误判都不会影响结论。
 */
function stripComments(src: string): string {
  let inBlock = false;
  return src
    .split('\n')
    .map((l) => {
      // JSDoc/块注释：起于 `/** `，体行以 ` *` 开头，止于 ` */`
      if (!inBlock && /^\s*\/\*/.test(l)) {
        inBlock = !l.includes('*/');
        return '';
      }
      if (inBlock) {
        if (l.includes('*/')) inBlock = false;
        return '';
      }
      const i = l.indexOf('//');
      return i >= 0 ? l.slice(0, i) : l;
    })
    .join('\n');
}

// ===========================================================================
// P1 `0x1f5`（报告 §4.1 行 107/181/182；raw 25214-25236）
// ===========================================================================

/**
 * 引擎 `sub_41A0E0`（raw 25214-25236）逐字：
 * ```c
 * v1 = *(_DWORD *)(_this + 429756);          // ① 锁深度（dword 107439 = frameCount）
 * if ( v1 <= 0 ) {
 *   if ( *(_DWORD *)(_this + 429752) ) {     // ② 停靠标志原值（dword 107438 = frameTickLock）
 *     v2 = *(_DWORD *)(_this + 497400) == 0; // ③ 派发中（byte 497400 = dword 124350）
 *     *(_DWORD *)(_this + 429752) = 0;       //    先清位
 *     if ( v2 ) sub_40FB60(_this);           //    再按 ③ 决定是否放行脚本队列
 *   }
 * } else { *(_DWORD *)(_this + 429756) = v1 - 1; }
 * ```
 * ★复核纠正：报告把「队列恰剩 1 项」（`497380 < 497384 && 497384 - 497380 == 1`）记在 `0x1F5` 头上；
 * 那条判据属 **`0x7C`**（`sub_41AB80` raw 25819-25821）—— 见本文件第 ⑥ 组。
 */
test('★P1 0x1f5：三层门 + 清停靠 + 放行队列 —— emulator 落点与体依据（raw 25221-25229）', () => {
  const body = engineBody();
  /** ★只看 `sub_41A0E0` 的**体**：`if ( *(_DWORD *)(_this + 429752) )` 这个串全库出现 **2** 次
   * （raw 20896 的内层出口与 raw 25224 的 ② 门）⇒ 在全文上判"它在不在"会**放过**把 ② 门删掉的改动
   * （实测：`mutate-red.mjs` 第 1 步就是这么被放过的）⇒ 必须限定在本函数的体里判。 */
  const if5 = bodyOfFn(body, '0041A0E0', 'int _this', '0041A130');
  assert.ok(if5.length > 100 && if5.length < 2000, '0x1f5 体切片必须在合理长度内（防"切到文件尾"）');
  // ① 锁深度在**外层**先判 `<= 0`（`v1 = ...429756` 与 `if ( v1 <= 0 )` 同段）
  bodyHas(if5, 'v1 = *(_DWORD *)(_this + 429756);\n  if ( v1 <= 0 )', 'P1 0x1f5 ① 锁深度门');
  bodyHas(if5, '*(_DWORD *)(_this + 429756) = v1 - 1;', 'P1 0x1f5 ① else 支递减帧计数');
  // ② 停靠标志（在 ① 之内）
  bodyHas(if5, 'if ( *(_DWORD *)(_this + 429752) )', 'P1 0x1f5 ② 停靠标志门');
  // ③ 派发中标志 + 清位 + 放行（这三行是同一段、且有固定先后）
  bodyHas(if5, 'v2 = *(_DWORD *)(_this + 497400) == 0;', 'P1 0x1f5 ③ 派发中标志');
  bodyHas(if5, '*(_DWORD *)(_this + 429752) = 0;', 'P1 0x1f5 清停靠标志');
  bodyHas(if5, 'if ( v2 )\n        sub_40FB60(_this);', 'P1 0x1f5 放行脚本队列（sub_40FB60）');
  // 清位在判 ③ **之后**（先取 v2、再清、再按 v2 决定）⇒ 三行的次序即语义
  const seg = if5.slice(if5.indexOf('v2 = *(_DWORD *)(_this + 497400) == 0;'));
  assert.ok(
    seg.indexOf('*(_DWORD *)(_this + 429752) = 0;') < seg.indexOf('if ( v2 )'),
    'P1 0x1f5：`= 0` 必须排在 `if ( v2 )` 之前（raw 25226-25229 的次序）',
  );
  // ② 与 ③ 必须**嵌套**（② 是 ③ 的外层门）—— 删掉 ② 就会破坏这个嵌套形状
  bodyHas(
    if5,
    'if ( *(_DWORD *)(_this + 429752) )\n    {\n      v2 = *(_DWORD *)(_this + 497400) == 0;',
    'P1 0x1f5：② 必须是 ③ 的外层门（raw 25224-25226 的嵌套形状）',
  );
  // 该判据**不属于** 0x1f5：0x1f5 体里不得出现队列游标比较
  assert.ok(!if5.includes('497380'), 'P1 0x1f5：体里**没有**队列游标 497380（复核订正的那条判据属 0x7C）');
  assert.ok(!if5.includes('497384'), 'P1 0x1f5：体里**没有**队列游标 497384');

  // emulator：三条门逐条落点（`handlers/frame.ts` 的 op_frame_countdown）
  sourceHas(
    'vm/handlers/frame.ts',
    'if (!e.engineValues.get(ENGINE_FIELD.frameTickLock)) return;',
    'P1 0x1f5 ② 停靠标志原值门',
  );
  sourceHas(
    'vm/handlers/frame.ts',
    'const dispatchAllowed = (e.engineValues.get(ENGINE_FIELD.dispatchInProgress) ?? 0) === 0;',
    'P1 0x1f5 ③ 派发中门',
  );
  sourceHas(
    'vm/handlers/frame.ts',
    'e.engineValues.set(ENGINE_FIELD.frameTickLock, 0); // raw 25227：先清停靠标志',
    'P1 0x1f5 清停靠标志（先于派发）',
  );
  sourceHas(
    'vm/handlers/frame.ts',
    'if (dispatchAllowed) await dispatchNextRequest(c); // raw 25228-25229',
    'P1 0x1f5 放行脚本队列（本仓 sub_40FB60 = control.ts 的唯一一份）',
  );
  // `dispatchNextRequest` 是**唯一一份**（不许在 frame.ts 抄第二份），且入口停靠闸在它体内
  assert.equal(
    countIn('vm/handlers/control.ts', 'export async function dispatchNextRequest('),
    1,
    'control.ts 里 dispatchNextRequest 只允许一处实现',
  );
  sourceHas(
    'vm/handlers/control.ts',
    'const docked = (e.engineValues.get(ENGINE_FIELD.frameTickLock) ?? 0) !== 0;',
    'P1 0x1f5/sub_40FB60 入口停靠闸（raw 18966）',
  );
  // 体里那条闸也在（raw 18966）
  assert.ok(
    engineBody().split('if ( !*(_DWORD *)(_this + 429752) )').length - 1 >= 2,
    'P1 0x1f5：raw 18966 的 sub_40FB60 入口停靠闸必须还在体里',
  );
});

/**
 * 三层门的**极性**：`dispatching === 1` ⇒ 只清停靠、不派发（体 `v2 = (497400 == 0)`）。
 * 复核记录（`verify-verdicts.json` 的 `frame-loop` 组）点名"建议守卫把极性写反了" ⇒ 本条钉住正确极性。
 */
test('★P1 0x1f5：③ 派发中标志非 0 ⇒ 清停靠但**不**派发（raw 25226 的 `== 0`，极性棘轮）', () => {
  const body = engineBody();
  bodyHas(body, 'v2 = *(_DWORD *)(_this + 497400) == 0;', '0x1f5 ③ 的判据必须是 `== 0`');
  assert.ok(
    !body.includes('v2 = *(_DWORD *)(_this + 497400) != 0;'),
    '0x1f5 ③ 不得被改成 `!= 0`（那就是把门反了）',
  );
  sourceHas(
    'vm/handlers/frame.ts',
    '(e.engineValues.get(ENGINE_FIELD.dispatchInProgress) ?? 0) === 0',
    '0x1f5 ③ 的 emulator 极性',
  );
});

// ===========================================================================
// P2 `0x7c`（报告 §4.1 行 108/302/303/304；raw 25778-25824）
// ===========================================================================

/**
 * 引擎 `sub_41AB80` raw 25798-25807：
 * ```c
 * v3 = (_DWORD *)(_this + 8 * v2);                  // = frames[cur]
 * if ( v3[95796] != *(_DWORD *)(_this + 430712) )   // ★无条件（无"哨兵"前置条件）
 *   … "Depth が不正です %s != %s" … _CxxThrowException(…);
 * ```
 */
test('★P2 0x7c：深度校验**无条件** + 依据仍在体里（raw 25798-25807）', () => {
  const body = engineBody();
  bodyHas(body, 'if ( v3[95796] != *(_DWORD *)(_this + 430712) )', 'P2 0x7c 无条件深度校验');
  sourceHas(
    'vm/handlers/frame.ts',
    'if (c.frame.scriptId !== want) {',
    'P2 0x7c 的 emulator 深度校验（去掉 `want !== -1` 哨兵后的形状）',
  );
  assert.ok(
    !sourceOf('vm/handlers/frame.ts').includes('if (want !== -1)'),
    'P2 0x7c：`want !== -1` 这条哨兵**不许**回来（体里没有这个前置条件）',
  );
});

/**
 * P3 `0x7c` missing-consumer（报告 §4.1 行 303）：引擎在 `387940` 置位时清 0，并在
 * **队列恰剩 1 项**（`497380 < 497384 && 497384 - 497380 == 1`）时调 `sub_40FB60`。
 *
 * ★`387940` 在本 build 里**全库无写者**（只有构造清零 raw 22605 与这条 0x7C 两处引用）
 * ⇒ 门恒假 ⇒ emulator 侧"既不写也没有该派发点"是**正确的如实处置**（不许编一个写者）。
 * 本条把"依据在体里 + emulator 没落点"同时钉住：一旦有人接了 `387940`，本文件会红，
 * 提示回去把这条登记改成真实现。
 */
test('P3 0x7c：387940 的列表收尾派发 —— 依据在体里、emulator 如实未做（raw 25816-25822）', () => {
  const body = engineBody();
  bodyHas(body, 'if ( *(_DWORD *)(_this + 387940) )', 'P3 0x7c 的 387940 门');
  bodyHas(body, 'if ( v5 < v6 && v6 - v5 == 1 )', 'P3 0x7c 的「队列恰剩 1 项」判据');
  // 全库只有两处引用（构造清零 + 这条 0x7C）⇒ 无写者、门恒假
  assert.equal(
    body.split('387940').length - 1,
    3,
    '387940 必须只有三处引用（构造清零 raw 22605 + 0x7C 的读 raw 25816 与写 raw 25818）⇒ 无写者、门恒假',
  );  assert.equal(
    stripComments(sourceOf('vm/handlers/frame.ts')).includes('387940'),
    false,
    'P3 0x7c：emulator 侧**代码里没有** 387940 的落点（注释里的登记不算落点；接上后请改本条与本票 §1）',
  );
});

/**
 * P3 `0x7c` missing-writer（报告 §4.1 行 304）：「主循环两条臂」在 emulator 里只落了一条半。
 *
 * 体证（逐行读）：
 *  - raw 20365-20374（ADV 泵的**右键取消路由**）= `src/vm/engine.ts` 的 `#cancelRoute()` —— **已实现**；
 *  - raw 13997-14008（`effect_flags & 0x20` 分支）= **未实现**（emulator 里没有任何落点）；
 *  - raw 20870-20877（`0x4000000` 分支）= **未实现**。
 * 报告/复核把这三条一并说成"未实现"⇒ 本条**订正**为"三处写者里已落一处"。
 */
test('P3 0x7c：`redisplayScriptId` 的三处写者 —— 取消路由已落、另两臂未落（raw 13997-14008 / 20365-20374 / 20870-20877）', () => {
  const body = engineBody();
  bodyHas(body, '_this[107678] = *(_DWORD *)(result + 383184);', 'raw 14007：`& 0x20` 臂写 430712（字节）= dword 107678');
  bodyHas(body, 'if ( (result & 0x20) != 0 )', 'raw 13997：`& 0x20` 臂的判据');
  bodyHas(body, 'sub_4051E0', 'raw 20874：`0x4000000` 臂写 489812（经 sub_4051E0）');
  bodyHas(body, 'v28[95782] = v28[95781] + 4 * *(_DWORD *)(_this + 4 * v26 + 489648);', 'raw 20877：`0x4000000` 臂改写帧 ip');
  // 已落的那一处（右键取消路由，raw 20365-20374）
  sourceHas(
    'vm/engine.ts',
    'this.engineValues.set(ENGINE_FIELD.redisplayScriptId, f.scriptId); // raw 20372',
    'raw 20372：右键取消路由的写点（已实现）',
  );
  // 未落的两臂：emulator 里 `& 0x20` 这条输入根本没有落点 ⇒ 钉住"确实没有"
  assert.equal(
    sourceOf('vm/engine.ts').split('effectFlags & 0x20').length - 1,
    0,
    'P3 0x7c：emulator 侧**没有** `effect_flags & 0x20` 臂（未做的另一半；接上后请改本条）',
  );
});

// ===========================================================================
// P2 `0xc8`（报告 §4.1 行 127/128；raw 30287-30315 + 66101-66186）
// ===========================================================================

/**
 * 引擎 `sub_4218D0`（raw 30287-30315）逐字：
 * ```c
 * _this[30 * _this[95776] + 95805] = 3;                 // argc=1
 * v2 = (int (*)(void))_this[97062];
 * if ( v2 && v2() || !_this[97059]
 *   || (pExceptionObject = __ROL4__(_this[97060], 11), pExceptionObject != _this[97059]) )
 *   _CxxThrowException(Command_Exit);                   // ★完整性自检：失败即退出（不影响 sleep 语义）
 * if ( (_this[174801] & 0x8000000) == 0 ) {             // ADV 未激活
 *   v3 = readIntOperand(1);
 *   if ( v3 >= 10 ) { _this[174801] |= 1u; sub_453A60(_this + 107440, v3); }
 *   else            { Sleep(v3); }
 * }
 * ```
 * 语料实测（`src/*.txt` 的 `^sleep `）：**`1f4` 334 / `1` 38 / `0` 12 / `10` 1** = 385 处，
 * 其中 `n < 10` 共 **51** 处 —— 与审计的口径一致（钉在断言里，防后人凭印象改）。
 */
test('★P2 0xc8：两支分离的边界（9/10）与「ADV 激活整段不进」+ 体依据（raw 30301-30312）', () => {
  const body = engineBody();
  bodyHas(body, 'if ( (_this[174801] & 0x8000000) == 0 )', '0xc8 的 ADV 门（该串全库 4 处，取其一即可）');
  bodyHas(body, 'if ( v3 >= 10 )', '0xc8 的 9/10 边界');
  bodyHas(body, '_this[174801] |= 1u;', '0xc8 的 n>=10 支武装节流位');
  bodyHas(body, 'sub_453A60(_this + 107440, v3);', '0xc8 的 n>=10 支起帧节流计时器');
  bodyHas(body, 'Sleep(v3);', '0xc8 的 n<10 支进程级硬阻塞');
  // 完整性自检（三格）也在体里，但**不属于 sleep 语义**（失败即退出，与 n 无关）
  bodyHas(body, 'pExceptionObject = __ROL4__(_this[97060], 11)', '0xc8 体首的密钥自检（97059/97060）');
  bodyHas(body, 'v2 && v2() || !_this[97059]', '0xc8 体首调试器/密钥自检的门');

  // emulator：判定函数 + 两支落点
  assert.equal(sleepPath(0), 'block', 'raw 30304：0 < 10 ⇒ Sleep(0)');
  assert.equal(sleepPath(9), 'block');
  assert.equal(sleepPath(10), 'throttle', 'raw 30304 的边界值 10');
  sourceHas(
    'vm/handlers/frame.ts',
    "return n >= 10 ? 'throttle' : 'block';",
    '0xc8 的判定函数（边界在 9/10）',
  );
  sourceHas('vm/handlers/frame.ts', 'if (c.e.advActive) return;', '0xc8 的 ADV 激活 ⇒ 整段不进');
  sourceHas('vm/handlers/frame.ts', 'if (sleepPath(n) === \'throttle\') c.e.effectFlags |= 1;', '0xc8 的 `|= 1` 只在 n>=10');
  sourceHas('vm/handlers/frame.ts', 'c.e.sleepUntil = c.e.nowMs + Math.max(0, n);', '0xc8：`Sleep(0)` 不得被抬成 1ms');
});

/** 语料计数棘轮（我本轮实测：`Select-String src/*.txt '^\\s*sleep\\s'`）。 */
test('P2 0xc8：语料计数棘轮 —— n<10 共 51 处（`1`×38 / `0`×12 / `10`×1 之外）+ n>=10 334 处', () => {
  const files = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.txt'));
  const counts = new Map<string, number>();
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').split('\n')) {
      const m = /^\s*sleep\s+(\S+)\s*$/.exec(line);
      if (m) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, 385, '`sleep` 语料总数 = 385（334+38+12+1，与审计一致）');
  assert.equal(counts.get('1f4'), 334, '`sleep 1f4` = 500ms ⇒ n>=10 支，334 处');
  assert.equal(counts.get('1'), 38, '`sleep 1` ⇒ n<10 支（硬阻塞），38 处');
  assert.equal(counts.get('0'), 12, '`sleep 0` ⇒ n<10 支（且是 `Sleep(0)`），12 处');
  assert.equal(counts.get('10'), 1, '`sleep 10` ⇒ 边界值，1 处');
  const small = total - (counts.get('1f4') ?? 0) - (counts.get('10') ?? 0);
  assert.equal(
    small,
    50,
    '★实测：n<10 支 = **50** 处（`1`×38 + `0`×12）—— 审计写的「51 处」比实测多 1，' +
      '按本项目纪律以实测为准（同一段里它给的 334/38/12/1 四个桶与我的扫描逐字一致）',
  );
});

// ===========================================================================
// P2 `0xae`（报告 §4.1 行 118/324/325；raw 24634-24773）
// ===========================================================================

/**
 * 引擎 `sub_4192F0` 的入口分派：raw 24663 `if ( v3 != 1 )` … raw 24738 `if ( result == 20 )`
 * ⇒ `sv1 == 1` 时**只有** `sv2 == 20` 才进 `263*cur` 槽组，否则整支什么都不做。
 * `sv1/sv2` 的来源**只有**注册表两次调用（raw 24660-24661）。
 */
test('★P2 0xae：sv1=1 时 sv2 必须 =20（raw 24663/24738）+ 版本源只有注册表两处', () => {
  const body = engineBody();
  bodyHas(body, 'if ( v3 != 1 )', '0xae 的 sv1==1 分派');
  bodyHas(body, 'if ( result == 20 )', '0xae 的 sv2==20 门');
  assert.equal(
    body.split('aSetSaveversion').length - 1 >= 2,
    true,
    '0xae：sv1/sv2 来自两次 GetConfig（`aSetSaveversion` / `aSetSaveversion_0`）',
  );
  const f = sourceOf('vm/handlers/frame.ts');
  sourceHas('vm/handlers/frame.ts', 'if (spec !== undefined && spec.sv2 !== undefined && sv2 !== spec.sv2) {', '0xae 的 sv2 门落点');
  sourceHas('vm/handlers/frame.ts', 'const sv1 = resume?.sv1 ??', '0xae 的 sv1 来源');
  // `resume.sv1`（容器头）优先是**本工程槽的设计**（T-0156 有意保留），不是缺口 —— 钉住现状
  assert.ok(
    f.includes('resume?.sv1 ??') && f.includes('resume?.sv2 ??'),
    '0xae：容器头声明的版本仍优先（本工程槽 `format=0`/`aux=20`；见 T-0156 §2 行 7）',
  );
});

// ===========================================================================
// P2 `cap:frame-render-gate-mainloop` + `cap:clock-write-clock-freeze`
// （报告 §4.2 行 2/3，§4.5 行 55/56/57/58；raw 20740-20765 / 20831-20896 / 21109-21114）
// ===========================================================================

/** `DrawMode=1` / `DrawMode=0` 的配置（`set:DrawMode`；随包 INI 实测 0）。 */
const D3D_ON = parseIni('[set]\nDrawMode=1');
const D3D_OFF = parseIni('[set]\nDrawMode=0');

/** 一行源码里某串出现的位置。 */
const lineOf = (rel: string, snippet: string): number => {
  const lines = sourceOf(rel).split('\n');
  for (let i = 0; i < lines.length; i++) if (lines[i]!.includes(snippet)) return i + 1;
  return -1;
};

test('★P2 frame-render-gate：`frameRenderGate` 复刻 raw 20740-20761（DrawMode=0 ⇒ 整块不进、时钟不写）', () => {
  const body = engineBody();
  bodyHas(body, 'if ( *(_DWORD *)(_this + 667856) == 1 )', 'cap ① DrawMode 门（raw 20740）');
  bodyHas(body, 'if ( *(_DWORD *)(_this + 675968) )', 'cap ② 外部挂起（raw 20742）');
  bodyHas(body, '*(_DWORD *)(_this + 369336) = *(_DWORD *)(_this + 369332);', 'cap ④ 帧时钟写（raw 20750）');
  bodyHas(body, '*(_DWORD *)(_this + 369332) = v94;', 'cap ④ 帧时钟写（raw 20751）');
  bodyHas(body, 'sub_4B4040(_this + 322832);', 'cap ⑥ 帧提交（raw 20758）');

  const e = mkEngine([instr(0x101, [])]);
  e.config = D3D_OFF;
  e.engineValues.set(ENGINE_FIELD.engineBool, 1);
  e.effectFlags = 0x2400;
  const off = frameRenderGate(e);
  assert.equal(off.drawMode, false, 'DrawMode=0 ⇒ 整块不进（与旧行为一致）');
  assert.equal(off.clockWrite, false, '门不进 ⇒ 帧时钟不写');

  e.config = D3D_ON;
  assert.equal(frameRenderGate(e, true).gateOpen, false, 'raw 20742-20745：宿主挂起 ⇒ v92 = 0');
  const on = frameRenderGate(e, false);
  assert.equal(on.gateOpen, true);
  assert.equal(on.clockWrite, true, 'raw 20750-20751 在同一支里');
  assert.ok(on.unknown.length >= 2, 'raw 20754/20756 两条未定位条件必须显式登记（不许假装完整）');
});

test('★P2 frame-render-gate：驱动里门在 `advanceModel`/`present` **之前**（raw 20758 早于 20766+）', () => {
  const gate = lineOf('frame/loop.ts', 'const renderGate = frameRenderGate(');
  const model = lineOf('frame/loop.ts', 'host.advanceModel?.(nowMs,');
  const present = lineOf('frame/loop.ts', 'if (wantPresent) await host.present?.();');
  assert.ok(gate > 0 && model > 0 && present > 0, '三个锚点都必须在场');
  assert.ok(gate < model && model <= present, `门(${gate}) → advanceModel(${model}) → present(${present}) 的次序`);
});

/**
 * 报告 §4.5 行 56 的**复核结论**：帧提交段与电影对象生命周期在**同一轮**主循环里先后执行
 * （20896-20917 是内层 while 的出口，**不跳过**帧提交）。两条依据：
 *  - 内层的 `break`（raw 20896 `if ( *(_DWORD *)(_this + 429752) ) break;`）在帧提交段**之后**；
 *  - 电影段自己的"没有电影对象 ⇒ 清 0x2000"出口（raw 20899 的 `(v30 & 0x2000) == 0 ⇒ break`）
 *    与 raw 20903 的 `&= ~0x2000`。
 * ★同一处的**真缺口**是电影对象子系统整体未建模（`0x20F` 只听日志）—— 登记项。
 */
test('P2 frame-render-gate：帧提交段与电影段同轮先后（raw 20740-20765 / 20896-20917）+ 真空缺登记', () => {
  const body = engineBody();
  bodyHas(body, 'if ( *(_DWORD *)(_this + 429752) )\n                break;', 'raw 20896：内层出口在帧提交段之后');
  bodyHas(body, 'if ( (v30 & 0x2000) == 0 )\n                break;', 'raw 20899：电影段的 0x2000 门');
  bodyHas(body, '*(_DWORD *)(_this + 699204) = v30 & 0xFFFFDFFF;', 'raw 20903：没有电影对象 ⇒ 清 0x2000');
  // 帧提交段（20740）必须在 20896 之前 ⇒ 同轮
  const submit = body.indexOf('if ( *(_DWORD *)(_this + 667856) == 1 )');
  const exit = body.indexOf('if ( *(_DWORD *)(_this + 429752) )\n                break;');
  assert.ok(submit > 0 && exit > submit, '帧提交段（20740）必须排在内层出口（20896）之前');
  // emulator：`0x20F` 只到宿主缝（native.playMovie），没有影片对象生命周期 ⇒ 电影子系统整体未建模
  sourceHas('vm/handlers/gfx-misc.ts', 'c.native.playMovie?.(id, slot, gate);', '0x20F 的落点 = 宿主缝（未建模的现状，接上后请改本条）');
  sourceHas('vm/nativeTap.ts', "playMovie: '影片起播：不实现 ⇒ 黑屏/停在上一帧，无报错'", 'nativeTap 的丢弃记录登记');
});

/**
 * 报告 §4.2 行 3 的**复核订正**：主循环 raw 20831-20837 的
 * 「`effect_flags & 0x200` 的 10ms/10000ms 双计时器刷新」**在**停靠锁检查之外；
 * 被 `429752` 挡住的是 raw 20838-20858（阶梯/等待段）。
 * ★本条同时纠正工作清单里"锁挡住 20831-20837"的措辞。
 */
test('★P2 clock-write-clock-freeze：停靠锁挡的是 20838-20858（阶梯段），**不是** 20831-20837 的双计时器', () => {
  const body = engineBody();
  bodyHas(body, 'if ( (*(_DWORD *)(_this + 699204) & 0x200) != 0 )', 'raw 20831：0x200 双计时器段');
  bodyHas(body, 'if ( !*(_DWORD *)(_this + 429752) )\n                  {', 'raw 20838：停靠锁门（在 20831 段之后）');
  const timer = body.indexOf('if ( (*(_DWORD *)(_this + 699204) & 0x200) != 0 )');
  const lock = body.indexOf('if ( !*(_DWORD *)(_this + 429752) )\n                  {');
  assert.ok(timer > 0 && lock > timer, 'raw 20831 的双计时器段排在 raw 20838 的锁门之前 ⇒ 锁挡不住它');
  // 锁那一支的体内只有 0x1000 的阶梯/等待处理
  const locked = body.slice(lock, lock + 400);
  assert.ok(locked.includes('(v24 & 0x1000) != 0'), '锁门内是 0x1000 的阶梯/等待段');
  assert.ok(!locked.includes('& 0x200) != 0'), '锁门内**不得**含 0x200 双计时器段（措辞订正）');
});

/**
 * `cap:frame-render-gate-mainloop`（报告 §4.5 行 55，**未做项**）：
 * 引擎的 `0x400` 动画等待门在放行前还要求 `Engine[92340]`（= `0x24E` 写的那个字段）的 **bit0 为 0**
 * （raw 21113-21114：`GetConfig("system:EffectSkip") && (*(_BYTE*)(_this+369360) & 1) == 0`）；
 * 同一处的 `0x243`（`sub_41B180` raw 26023）与 `send-text` 出口（raw 26090）用的是 **bit1**。
 *
 * emulator 侧：`0x24E` 把值存进 `ENGINE_FIELD.msgField92340`，bit1 的两个读者**都已建模**
 * （`0x243` 的 `op_reset_wait_timer`、`send-text` 出口），但**bit0 的门没有落点** ⇒ 如实登记。
 */
test('P2 frame-render-gate：`Engine[92340]` bit0 的 `0x400` 门 —— 依据在体里、emulator 未做（raw 21113-21114）', () => {
  const body = engineBody();
  bodyHas(body, '&& (*(_BYTE *)(_this + 369360) & 1) == 0 )', 'raw 21114：bit0 的 0x400 门');
  bodyHas(body, 'if ( (*(_BYTE *)(_this + 369360) & 2) == 0 )', 'raw 26023 / 13910 / 13923：bit1 的三处读者');
  bodyHas(body, '  _this[92340] = result;', 'raw 32965：`0x24E` 写 92340');
  // 写者只此一处（`0x24E` = sub_4258C0）
  bodyHas(body, 'int __thiscall sub_4258C0(_DWORD *_this)', '0x24E 的 handler');
  // emulator：bit1 的两个读者都在
  sourceHas('vm/handlers/gfx-state.ts', '(gate & 2) !== 0', 'bit1 读者①：0x243');
  sourceHas('vm/handlers/msgwin.ts', '& 2) === 0', 'bit1 读者②：send-text 出口');
  // ★bit0 的门：emulator 里没有落点 ⇒ 钉住现状
  assert.equal(
    sourceOf('vm/handlers/gfx-state.ts').split('& 1) === 0').length - 1,
    0,
    'cap:frame-render-gate：bit0 的 0x400 门在 emulator 里没有落点（如实登记的现状）',
  );
});

// ===========================================================================
// 登记项：`clock-write-clock-freeze` 的另一半（锁在主循环里挡住的段）
// ===========================================================================

/**
 * 报告 §4.5 行 58：锁非 0 时主循环被挡住的是 raw 20838 的等待/阶梯段与 raw 20896 的电影段。
 * emulator 侧 `frame/loop.ts` **没有**这两个段 —— 但帧提交门（raw 20740-20765）**不在**锁之内
 * （挡它的是 20740 的 DrawMode 门）⇒ 现状是"两个都缺、但顺序不错"。
 * 本条钉住体里的三段次序，并登记 emulator 的落点缺失。
 */
test('P2 clock-write-clock-freeze：锁挡住的两段（20838-20858 / 20896-20917）在 emulator 无对应段（登记）', () => {
  const body = engineBody();
  const submit = body.indexOf('if ( *(_DWORD *)(_this + 667856) == 1 )');
  const wait = body.indexOf('if ( !*(_DWORD *)(_this + 429752) )\n                  {');
  const exit = body.indexOf('if ( *(_DWORD *)(_this + 429752) )\n                break;');
  assert.ok(submit > 0 && wait > submit && exit > wait, '次序必须是 帧提交(20740) → 阶梯段(20838) → 内层出口(20896)');
  // 阶梯段里是「0x1000 门 + 0x800/0x8000000 子门 + sub_453B60 定时器」
  const seg = body.slice(wait, exit);
  assert.ok(seg.includes('(v24 & 0x1000) != 0'), '阶梯段判 0x1000');
  assert.ok(seg.includes('sub_453B60'), '阶梯段用 sub_453B60 读计时器');
  // emulator：没有这两个段的等价物（登记）
  const loop = sourceOf('frame/loop.ts');
  assert.ok(!loop.includes('stepLadder'), 'emulator 侧没有"阶梯段"的独立落点（登记项，接上后请改本条）');
});

// ===========================================================================
// 口径棘轮：配置键名
// ===========================================================================

/**
 * 报告 §4.1 行 175 顺带点名的键名：引擎表 raw 4276 的键串是 **`set:CoexistMesSkip`**，
 * 不是 `set:CoexistMess`。`0x1b6` 那条的注释曾把键名写错 —— 本条作为棘轮钉住正确键名。
 */
test('口径：`set:CoexistMesSkip` 是引擎的键名（raw 4270-4280），不是 `CoexistMess`', () => {
  const body = engineBody();
  bodyHas(body, 'char aSetCoexistmess[19] = "set:CoexistMesSkip";', '引擎注册表里的键串常量（raw 4276）');
  sourceHas('configRegistry.ts', 'set:CoexistMesSkip', 'emulator 注册表键名与体一致');
  assert.ok(
    !sourceOf('configRegistry.ts').includes('set:CoexistMess"'),
    '不得把键名写成 `set:CoexistMess`',
  );
});
