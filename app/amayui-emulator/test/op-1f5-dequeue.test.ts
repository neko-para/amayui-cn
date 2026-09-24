/** @tier T0 @kind core @subsystem frame */

/**
 * `0x1F5`（`sub_41A0E0`，raw 25214-25236）的**出队派发**与三道门 ——
 * 审计 2026-09 §4.1 的 P1 `0x1f5 missing-branch` 与 P3 `0x1f5 missing-dispatch`（`tickets/T-0157`）。
 *
 * 引擎体（raw 25221-25235，逐字）：
 * ```c
 * *(_DWORD *)(_this + 120 * *(_DWORD *)(_this + 383104) + 383220) = 1;   // 操作数记数槽
 * v1 = *(_DWORD *)(_this + 429756);                    // ① 锁深度（dword 107439 = frameCount）
 * if ( v1 <= 0 ) {
 *   if ( *(_DWORD *)(_this + 429752) ) {               // ② 停靠标志原值必须非 0（dword 107438 = frameTickLock）
 *     v2 = *(_DWORD *)(_this + 497400) == 0;           // ③ 派发中标志（byte 497400 = dword 124350）
 *     *(_DWORD *)(_this + 429752) = 0;                 //    先无条件清停靠标志
 *     if ( v2 ) sub_40FB60(_this);                     //★本次修复接的那条线（本仓 dispatchNextRequest）
 *   }
 * } else { *(_DWORD *)(_this + 429756) = v1 - 1; }
 * ```
 *
 * **修前是什么**：`op_frame_countdown` 只有
 * `if (left > 0) frameCount-- else engineValues.set(frameTickLock, 0)` ——
 * ② 这道外层门、③ 这道派发门、以及 `sub_40FB60` 那次调用**整体缺席**（`0x1F5` 不是派发点）。
 * 于是「停靠期间入队的请求，在清停靠那一刻重试派发」这条语义在重写侧不存在。
 *
 * ★**复核纠正**（`docs-new/99-records/2026-09-impl-audit/raw/verify-verdicts.json` 的 `frame-loop` 组）：
 *  - 原报告把「队列恰剩 1 项」（`497380 < 497384 && 497384 - 497380 == 1`）记在 `0x1F5` 头上 ——
 *    那条判据属于 **`0x7C`**（`sub_41AB80` raw 25819-25821）；`0x1F5` 体里**没有**任何队列长度判据；
 *  - 复核的 `suggestedGuard` 写的是「`e.dispatching = true` ⇒ 断言 `0x1F5` 派发一条」，与体**极性相反**
 *    （体是 `v2 = (497400 == 0)`，为真才派发）⇒ 本文件按体断"非 0 不派发"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { parseScriptBytes } from '../src/script/bin.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { buildScriptBin } from './engineSlotFixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VM = path.resolve(HERE, '..', 'src', 'vm');

/** 包 1 / 包 2 的文件 #0（`$n$AUTORUN`）= `0x143` 压进队列的统一 id（`包号<<24`）。 */
const PACK1 = 0x1000000;
const PACK2 = 0x2000000;
/** 引擎 `sub_40FB60` 把请求装进 `cur = 37`（raw 18987）；emulator 的帧数同为 40。 */
const DISPATCH_FRAME = 37;

/** 包 1 的 `$1$AUTORUN`：先 `i1f4` **自己进停靠**，再 `exit`（把"停靠中退出派发链"这一格摆出来）。 */
const PACK1_SCRIPT = (): Uint8Array => buildScriptBin([{ op: 0x1f4, args: [] }, { op: 0x2, args: [] }]);
/** 包 2 的 `$2$AUTORUN`：单条 `exit`（装载进来即可断言，不必执行）。 */
const PACK2_SCRIPT = (): Uint8Array => buildScriptBin([{ op: 0x2, args: [] }]);

/** 根脚本：`ops` 逐条 0 操作数指令（`0x1f4`/`0x1f5`/`0x2` 都是 argc 0）。 */
const rootScript = (ops: number[]): Uint8Array => buildScriptBin(ops.map((op) => ({ op, args: [] })));

/** 内存 `FileSource`：只回答包脚本字节，并把每次 `readScript` 的 id 记下来（派发的观测点）。 */
function packSource(loaded: number[], scripts: Record<number, () => Uint8Array>): Engine['fileSource'] {
  return {
    readScript: async (id: number) => {
      loaded.push(id);
      const build = scripts[id];
      if (!build) throw new Error(`本测试未提供 id 0x${id.toString(16)} 的脚本`);
      return { index: id, name: `$${id >>> 24}$AUTORUN.BIN`, data: build() };
    },
  } as unknown as Engine['fileSource'];
}

/** 造一个根帧跑着合成脚本、且带包脚本源的引擎（合成夹具：不依赖任何真游戏资源）。 */
function boot(ops: number[], scripts: Record<number, () => Uint8Array> = {}): { e: Engine; loaded: number[] } {
  const loaded: number[] = [];
  const e = new Engine(new StubNative(() => {}));
  e.fileSource = packSource(loaded, scripts);
  loadScriptIntoFrame(e.frames[0]!, parseScriptBytes(rootScript(ops)), 'FAKE.BIN', 0);
  return { e, loaded };
}

// ---------------------------------------------------------------------------
// ①②③ 三道门 —— 正例：停靠期间入队的请求在清停靠那一刻被派发
// ---------------------------------------------------------------------------

test('★0x1F5：停靠期间入队的请求在清停靠标志那一刻被派发（raw 25224-25229；修前 0x1F5 只清锁）', async () => {
  const { e, loaded } = boot([0x1f4, 0x1f5], { [PACK1]: PACK2_SCRIPT });

  await stepOnce(e); // 0x1F4：停靠标志未置 ⇒ 置 1（raw 25206）
  assert.equal(e.engineValues.get(ENGINE_FIELD.frameTickLock), 1, '0x1F4 把停靠标志置 1');

  // 「停靠期间入队」：引擎里请求由 `sub_40FC90` 压进队列（raw 19023），此处直接压队 = 同一格状态。
  e.scriptRequests.push(PACK1);
  assert.equal(e.cur, 0, '发起者仍在帧 0');

  await stepOnce(e); // 0x1F5：① 锁深度 0 / ② 停靠标志 1 / ③ 非派发中

  assert.equal(e.engineValues.get(ENGINE_FIELD.frameTickLock), 0, '先清停靠标志（raw 25227）');
  assert.deepEqual(loaded, [PACK1], '★必须真的派发一条（修前这里是 []：只清锁、不派发）');
  assert.equal(e.cur, DISPATCH_FRAME, '装载进派发帧 37（引擎 raw 18987）');
  assert.equal(e.curScript().name, '$1$AUTORUN.BIN');
  assert.equal(e.curScript().caller, -10, '派发哨兵：它的 exit 走 -10 分支继续派发');
  assert.deepEqual(e.scriptRequests, [], '队首已弹出');
  assert.equal(e.dispatching, true, '派发中（引擎 raw 18980 写 497400 = 1）');
  assert.equal(
    e.engineValues.get(ENGINE_FIELD.dispatchInProgress),
    1,
    '★同一格也写进引擎字段 124350（T-0157 前该键只有读没有写 ⇒ 0x1F5 的门会退化成恒真）',
  );
});

test('★0x1F5：③ 派发中标志非 0 ⇒ 只清停靠标志、不派发（raw 25226；复核纠正了极性写反的建议守卫）', async () => {
  const { e, loaded } = boot([0x1f4, 0x1f5, 0x1f5], { [PACK1]: PACK2_SCRIPT });
  await stepOnce(e); // 置停靠标志
  e.scriptRequests.push(PACK1);
  // ★引擎在这一格读 `_this[124350]`（byte 497400）。复核的 suggestedGuard 写的是"置 dispatching=true
  //   后断言 0x1F5 派发一条"，与体 `v2 = (497400 == 0)` **极性相反** ⇒ 这里按体断反例。
  e.engineValues.set(ENGINE_FIELD.dispatchInProgress, 1);

  await stepOnce(e); // 第一条 0x1f5

  assert.equal(
    e.engineValues.get(ENGINE_FIELD.frameTickLock),
    0,
    '停靠标志照样清（清位 raw 25227 在判 ③ 的 raw 25228 之前，与 ③ 的取值无关）',
  );
  assert.deepEqual(loaded, [], '③ 为假 ⇒ 不调 sub_40FB60');
  assert.deepEqual(e.scriptRequests, [PACK1], '请求留在队列里，等下一次 0x1F5');
  assert.equal(e.cur, 0, '控制流没转移');

  // ③ 只挡住**那一次**进入：派发结束（124350 回 0）后停靠标志再次置位，同一条 0x1F5 就该放行
  // （这一步同时让本用例在**修前**为红：修前 0x1F5 永不派发）。
  e.engineValues.set(ENGINE_FIELD.dispatchInProgress, 0);
  e.engineValues.set(ENGINE_FIELD.frameTickLock, 1); // 脚本又等了一拍（0x1F4）
  await stepOnce(e); // 第二条 0x1f5
  assert.deepEqual(loaded, [PACK1], '③ 为假（非派发中）时正常派发');
  assert.equal(e.cur, DISPATCH_FRAME);
});

test('★0x1F5：② 停靠标志原值为 0 ⇒ 整段不进（连"写 0"都不发生，raw 25224；修前无条件写 frameTickLock = 0）', async () => {
  const { e, loaded } = boot([0x1f5], { [PACK1]: PACK2_SCRIPT });
  e.scriptRequests.push(PACK1);
  // 从不执行 0x1F4 ⇒ 停靠标志这一格从未被写过（引擎侧初值即 0）。

  await stepOnce(e); // 0x1f5

  assert.equal(
    e.engineValues.get(ENGINE_FIELD.frameTickLock),
    undefined,
    '引擎在 ② 为假时**不写**这一格（没有 set 过 ⇒ 键不存在）；修前这里被无条件写成 0',
  );
  assert.deepEqual(loaded, [], '不派发');
  assert.deepEqual(e.scriptRequests, [PACK1], '请求留在队列里');
  assert.equal(e.cur, 0, '控制流没转移');
});

test('0x1F5：① 锁深度 > 0 ⇒ 只递减帧计数（raw 25221/25234），第二拍才解锁派发', async () => {
  const { e, loaded } = boot([0x1f4, 0x1f4, 0x1f5, 0x1f5], { [PACK1]: PACK2_SCRIPT });

  await stepOnce(e); // 0x1F4 → 停靠标志 = 1
  await stepOnce(e); // 0x1F4（标志已置）→ 帧计数 = 1（raw 25202）
  assert.equal(e.engineValues.get(ENGINE_FIELD.frameCount), 1, '第二拍 0x1F4 累加帧计数');
  e.scriptRequests.push(PACK1);

  await stepOnce(e); // 第一条 0x1F5：① = 1 > 0 ⇒ 走 else 支
  assert.equal(e.engineValues.get(ENGINE_FIELD.frameCount), 0, '锁深度递减（raw 25234）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.frameTickLock), 1, '① > 0 时不碰停靠标志、不派发');
  assert.deepEqual(loaded, [], '这一拍不派发');

  await stepOnce(e); // 第二条 0x1F5：① = 0 / ② = 1 / ③ = 0 ⇒ 清标志 + 派发
  assert.equal(e.engineValues.get(ENGINE_FIELD.frameTickLock), 0);
  assert.deepEqual(loaded, [PACK1], '第二拍才是解锁/派发点（与 0x1F4 的"停靠一拍"配对）');
  assert.equal(e.cur, DISPATCH_FRAME);
});

// ---------------------------------------------------------------------------
// `sub_40FB60` 的入口停靠闸（raw 18966）= 0x1F5 那次派发为什么必须存在
// ---------------------------------------------------------------------------

test('★sub_40FB60 入口停靠闸（raw 18966）：停靠中退出派发链 ⇒ 不派发下一条，留到 0x1F5 重试', async () => {
  const { e, loaded } = boot([0x1f4, 0x1f5], { [PACK1]: PACK1_SCRIPT, [PACK2]: PACK2_SCRIPT });

  await stepOnce(e); // 根帧 0x1F4 → 停靠标志 = 1
  e.scriptRequests.push(PACK1, PACK2);
  await stepOnce(e); // 根帧 0x1F5 → 清标志 + 派发包 1（cur = 37，现场存 dispatchSavedCur = 0）
  assert.equal(e.cur, DISPATCH_FRAME);
  assert.deepEqual(loaded, [PACK1]);

  await stepOnce(e); // 帧 37 的 `i1f4`：派发脚本自己进了停靠（raw 25206）
  assert.equal(e.engineValues.get(ENGINE_FIELD.frameTickLock), 1, '派发脚本把自己停靠住了');

  await stepOnce(e); // 帧 37 的 `exit`（caller = -10）→ 引擎调 sub_40FB60，但停靠闸为 1
  assert.deepEqual(
    loaded,
    [PACK1],
    '★停靠中 ⇒ `sub_40FB60` 整段不执行、不弹队（raw 18966）；修前这里会把 PACK2 一起装载进来',
  );
  assert.deepEqual(e.scriptRequests, [PACK2], '请求留在队列里');
  assert.equal(e.cur, 0, '现场还原：回到发起者帧（raw 25664）');
  assert.equal(e.dispatching, false, '派发中已清（raw 25667）');

  // 重试点：发起者帧的 ip 仍停在 `0x1F5` 那条（0x1F5 用 jump(-1) 把控制让给派发帧）
  // ⇒ 再执行一次 = 引擎那个"清停靠那一刻重试派发"。
  await stepOnce(e);
  assert.deepEqual(loaded, [PACK1, PACK2], '0x1F5 清停靠后重试派发 ⇒ 第二条被装载');
  assert.equal(e.cur, DISPATCH_FRAME);
  assert.equal(e.curScript().name, '$2$AUTORUN.BIN');
});

// ---------------------------------------------------------------------------
// 棘轮：③ 依赖的 `124350` 不许再退回"只有读没有写"的死键状态
// ---------------------------------------------------------------------------

test('★棘轮：`dispatching` 的赋值点只允许有一个（control.ts 的 setDispatching），否则 124350 又会读不到 1', () => {
  // 为什么：`0x1F5` 的 ③ 门（raw 25226）读的是引擎字段 `_this[124350]`，它必须与 JS 侧镜像
  // `Engine.dispatching` **一起**被写。修前 `124350` 全仓**只有读没有写**（唯一的写是 engine.ts 的
  // 类字段声明），③ 于是退化成恒真；若将来有人绕过 `setDispatching` 直接写 `e.dispatching`，
  // 这个死键状态会静默回来（不报错、只表现不对）。
  const assigns: string[] = [];
  const walk = (dir: string): void => {
    for (const en of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, en.name);
      if (en.isDirectory()) {
        walk(p);
        continue;
      }
      if (!en.name.endsWith('.ts')) continue;
      fs.readFileSync(p, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // 只看**属性赋值** `.dispatching =`（`Engine` 里的类字段声明 `dispatching = false;` 没有点，不算）。
          if (/\.dispatching\s*=(?!=)/.test(line)) assigns.push(`${path.relative(VM, p).replace(/\\/g, '/')}:${i + 1}`);
        });
    }
  };
  walk(VM);
  const outsideHelper = assigns.filter((a) => !a.startsWith('handlers/control.ts:'));
  assert.deepEqual(
    outsideHelper,
    [],
    `只有 control.ts 的 setDispatching 允许写 dispatching（它同时写 ENGINE_FIELD.dispatchInProgress）；` +
      `越界赋值点：${outsideHelper.join(', ') || '无'}`,
  );
  assert.equal(
    assigns.length,
    1,
    `control.ts 里只允许 setDispatching 体内那一处赋值（其余写点必须走 helper）；当前：${assigns.join(', ') || '无'}`,
  );
});
