/** @tier T0 @kind core @subsystem l2d */

/**
 * **眨眼链（L2D 实例 `+16` EyeBlinkMotion 与 `+23` 门控）的命名守卫。**
 *
 * 出处：`analysis/engine-capabilities.json` 的 `live2d-node-draw-advance` 条 note 里的"唯一剩下的缺口"，
 * 以及 `tickets/T-0166/changes-c166.md` §4-①（`tickets/T-0175` acceptance ⑥）。
 * 证据全部来自 `engine/天结_unpacked.exe_utf8.c`（每条断言上面写 raw 行）与
 * `engine/天结_unpacked.exe.lst` 的反汇编，**不是**从 emulator 反推。
 *
 * ## 读体得到的眨眼链（每环带 raw）
 * | 环 | 事实 | raw / 反汇编 |
 * |---|---|---|
 * | 实例 `+16` | `sub_478270` 里 `sub_4BC380(104)` → `sub_4BC3E0` ⇒ **`live2d::EyeBlinkMotion`**（vftable `??_7EyeBlinkMotion@live2d@@6B@`），落在 `+16` | raw 92540-92545；vftable raw 143005 / `.lst` `.data:0052E30C` |
 * | 参数名 | 构造里硬编码 `PARAM_EYE_L_OPEN` / `PARAM_EYE_R_OPEN`（`sub_4BF510`）| raw 143014-143015 / `.data:0052E2E0`/`0052E2F4` |
 * | 缺省参数 | `+84 = 4000`(眨眼间隔上界) / `+88 = 100`(闭眼) / `+92 = 50`(闭合) / `+96 = 150`(睁眼) / `+32 = 1`(随机化) | raw 143009-143013 |
 * | 推进门 | `if ( *((_BYTE*)_this + 23) ) sub_4BC550(_this[4], *_this);` —— **`+23 != 0` 才推进**（非 0 即真）；`+16` 是 `_this[4]` | raw 92605-92606；反汇编 `cmp byte ptr [esi+17h],0 / jz`（`.lst` 00478429-0047842D） |
 * | 状态机 | `+16` 的 `switch`：0/其它 ⇒ `+16=1` + 排下次；1 ⇒ 到点 `+16=2`；2 ⇒ `elapsed/+88`；3 ⇒ `elapsed/+92`；4 ⇒ `elapsed/+96` 且到点回 1 并重排 | raw 143061-143121 |
 * | 写回 | 每帧 `sub_4BD490(模型, L, w, 1.0)` + `sub_4BD490(模型, R, -w, 1.0)`（`+32` 决定右眼是否取负）| raw 143123-143131；`sub_4BD3E0` raw 143791-143801 = `(1-a4)*现价 + a4*目标` |
 * | 时间源 | `sub_4BF8D0` = `clock()`（毫秒，`clock_t`），不是 `$fps` 帧计数 | raw 145679-145687；`.lst` `call _clock` |
 * | 抖动 | `rand() * dbl_52E310 * (2*interval - 1)`，`dbl_52E310 = 0.00003051850947599719 = 1/32767`（`.data:0052E310`）⇒ `[0, 2*interval - 1]` | raw 143031-143037 / 143113-143116 |
 *
 * ## ★`+23` 的**极性与来源**（读体结论，见 changes-c166-blink.md §2）
 * - 极性 = **非 0 即真**（`cmp byte ptr [esi+17h],0` + `jz`）；
 * - **来源 = 没有任何写者**：构造器 `sub_478270` 只写 `+20/+21/+25`（字节）与 `+28/+32`（dword），
 *   **不写 `+23`**；全 `.c` 里 `*((_BYTE *)_this + 23) = …` 命中 **0** 次，`.lst` 里 `byte ptr [reg+13h]`
 *   全库 **1** 处（`004D71D5`，属 `sub_4D7320` 的**另一个**对象）；写 `+24`/`+25` 的 `sub_478540`/`sub_478560`
 *   （`0x352` 预置）也**不碰 `+23`**。⇒ **随包二进制里这一支读的是未初始化堆字节、永远不执行**。
 *
 * ## 因此 emulator 的口径
 * 状态机**按体建模**（数值与转移逐句对齐，可独立推进），门控**缺省关**（= 引擎的实际运行行为）；
 * "开"只作为可测/可重开的开关暴露（`L2dInstance.blinkEnabled`），**不许**默认打开。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkEngine } from './harness.js';
import * as rt from '../src/live2d/runtime.js';
import { l2dAdvance, l2dCreateNode, l2dDestroySlot, l2dLoadModel } from '../src/live2d/runtime.js';
import { newL2dInstance } from '../src/live2d/mtn.js';
import type { L2dInstance } from '../src/live2d/runtime.js';
import type { MocModel } from '../src/live2d/moc.js';

/**
 * ★新面的取用口：**故意**走类型断言而不是 `import { … }`。
 *
 * 理由（红→绿的"红"必须是**断言红**，不是模块解析前的 `SyntaxError`）：ESM 的具名导入缺一个导出
 * 会让整个文件在**跑任何一条用例之前**就炸（`SyntaxError: does not provide an export named …`，
 * 那时连"哪一条判据不成立"都看不到）。经命名空间 + 断言取用 ⇒ 模块正常加载，
 * 三条用例逐条跑到**真正的断言**上才红（本单元的红→绿见 changes-c166-blink.md §3）。
 */
const R = rt as unknown as {
  BLINK_DEFAULTS: { intervalMs: number; closingMs: number; holdingMs: number; openingMs: number };
  BLINK_PARAM_L: string;
  BLINK_PARAM_R: string;
  /** `+16` 的状态值 ↔ 名字（引擎里那格是 `_DWORD`：0/未初始化、1、2、3、4）。 */
  BLINK_MODE_VALUE: Record<'idle' | 'closing' | 'holding' | 'opening', number>;
  /** 字段名 → 引擎实例偏移（可读性/守卫用：`blinkTimings.findFirst` 之类按它定位）。 */
  BLINK_FIELDS: Record<string, string>;
  /** `dbl_52E310`（`.data:0052E310`）；必须**恰好**是 `1/32767`，不是 `2^-15`。 */
  BLINK_RAND_SCALE: number;
  /** 眨眼那一支的入口（**含** `+23` 门与"模型非空"门，= `sub_4783D0` raw 92605-92606）。 */
  l2dBlinkTick: (
    inst: L2dInstance,
    deltaMs: number,
    opts?: { clockMs?: number; rng?: () => number },
  ) => Map<string, number> | null;
};
const BLINK_DEFAULTS = R.BLINK_DEFAULTS;
const BLINK_PARAM_L = R.BLINK_PARAM_L;
const BLINK_PARAM_R = R.BLINK_PARAM_R;
const BLINK_MODE_VALUE = R.BLINK_MODE_VALUE;
const BLINK_FIELDS = R.BLINK_FIELDS;
const BLINK_RAND_SCALE = R.BLINK_RAND_SCALE;
/**
 * 引擎 `sub_4783D0` 的眨眼那两句（`if (+23) sub_4BC550(+16, 模型)`）的直译。
 *
 * ★走**带门的**入口（不是裸 `blinkStep`）：门控本身就是要被测的判据，
 * 用裸函数测会把"门关着"的那一半测漏（本单元第一版就是这么错的，见 changes §3）。
 * `rng` 缺省 ⇒ 用固定的 0.5（引擎那份是 `rand() * (1/32767)`；测试要可复现）。
 */
const l2dBlinkUpdate = (inst: L2dInstance, deltaMs: number, rng: () => number = fixed(0.5)) =>
  R.l2dBlinkTick(inst, deltaMs, { rng });

/**
 * 合成模型：**含**眨眼用参数（`PARAM_EYE_L_OPEN`/`PARAM_EYE_R_OPEN`，缺省 1.0）。
 *
 * 参数定义照 `MocParamDef`；眨眼写回的目标正是这两个名字（raw 143014-143015 的
 * `sub_4BF510(…, aParamEyeLOpen/aParamEyeROpen)`）。
 */
function eyeModel(): MocModel {
  const paramDef = (name: string) => ({
    kind: 'paramDef' as const,
    min: 0,
    max: 1,
    defaultValue: 1,
    id: { kind: 'id' as const, idClass: 'param' as const, name },
  });
  return {
    kind: 'model',
    params: [paramDef(BLINK_PARAM_L), paramDef(BLINK_PARAM_R), paramDef('PARAM_ANGLE_X')],
    parts: [],
    canvasWidth: 100,
    canvasHeight: 50,
    stats: { version: 10, objects: 0, byTag: {}, bytesRead: 0, bytesTotal: 0, eofMarker: true },
  };
}

/** **不含**任何眨眼参数的模型（引擎里那条路会 OOB，见 §"做不到的"）。 */
function noEyeModel(): MocModel {
  return {
    kind: 'model',
    params: [
      {
        kind: 'paramDef',
        min: 0,
        max: 1,
        defaultValue: 0.25,
        id: { kind: 'id', idClass: 'param', name: 'PARAM_A' },
      },
    ],
    parts: [],
    canvasWidth: 100,
    canvasHeight: 50,
    stats: { version: 10, objects: 0, byTag: {}, bytesRead: 0, bytesTotal: 0, eofMarker: true },
  };
}

/** 一个可复现的"随机源"：固定返回 `v`（引擎那份是 `rand()`；本机不引全局 srand 状态）。 */
const fixed = (v: number) => () => v;

// ───────────────────────── ① 装载后按帧推进 ⇒ 眨眼参数真的在变 ─────────────────────────

test('★T-0166 blink ①：装载后逐帧推进 ⇒ PARAM_EYE_L_OPEN 真的在变（raw 92605-92606 的 +23 支）', () => {
  const e = mkEngine([]);
  l2dLoadModel(e, 0, 0x100, eyeModel());
  l2dCreateNode(e, 1, 0);
  const inst = e.l2dSlots.get(0)!;
  // 引擎缺省：门 `+23 = 0` ⇒ 这一支不执行
  assert.equal(inst.blinkEnabled, false, '★`+23` 缺省为 0（随包二进制里没有任何写者，见文件头 §极性）');
  assert.equal(inst.params.get(BLINK_PARAM_L), 1, '装载后参数是模型缺省 1.0');

  // 打开门（= 把那格改成非 0；极性：非 0 即真）
  inst.blinkEnabled = true;
  inst.blink.nextBlinkAtMs = 0;
  inst.blink.mode = 'idle'; // `+16` 的 0/其它分支 ⇒ 到点就直接转闭眼
  inst.blink.negateRight = true; // `+32`（构造为 1）

  // 第 1 拍：`nextBlinkAtMs = 0` 且 clock = 0 ⇒ 到点，`+16 = 2`（closing），w 是 LABEL_14 的 1.0
  const rng = fixed(0.5);
  // ★经**带门的**入口（`l2dBlinkTick`）。时钟显式给（= 引擎的 `clock()` 单值），
  //   免得"delta 累计"把拍与拍之间的时间关系藏起来：下面每拍都写明它落在哪个 clock 上。
  let clock = 0;
  const tick = (advanceMs: number) => {
    clock += advanceMs;
    return R.l2dBlinkTick(inst, 0, { clockMs: clock, rng });
  };
  const first = tick(0);
  assert.equal(inst.blink.mode, 'closing', '★到点 ⇒ `+16 = 2`（closing，raw 143066-143068）');
  assert.equal(first?.get(BLINK_PARAM_L), 1, '★到点那一拍：w = LABEL_14 的 1.0（raw 143118-143119）');

  // 第 2 拍：clock = 25 ⇒ 闭眼期 1/4 ⇒ w = 1 - 25/88 /… 即 1 - 25/100 = 0.75
  assert.equal(tick(BLINK_DEFAULTS.closingMs / 4)?.get(BLINK_PARAM_L), 0.75, 'w = 1 - elapsed/+88');

  // 第 3 拍：clock = 100 ⇒ 走过 +88(100ms) ⇒ `+16 = 3`（闭合保持），w = 0
  assert.equal(tick((BLINK_DEFAULTS.closingMs * 3) / 4)?.get(BLINK_PARAM_L), 0, '闭眼走完 ⇒ w = 0（raw 143079-143080）');
  assert.equal(inst.blink.mode, 'holding', '`+16 = 3`（raw 143076；`>= 1.0` 才转，见 raw 143087-143090）');

  // 第 4 拍：clock = 125（闭合保持期 elapsed 25 < +92 的 50）⇒ 仍是 0
  assert.equal(tick(BLINK_DEFAULTS.holdingMs / 2)?.get(BLINK_PARAM_L), 0, '闭合保持 `+92 = 50ms` 内 w = 0');
  // 第 5 拍：clock = 150（elapsed = 50）⇒ `+16 = 4`（睁眼中）
  assert.equal(tick(BLINK_DEFAULTS.holdingMs / 2)?.get(BLINK_PARAM_L), 0, '转睁眼那一拍 w 仍是 0');
  assert.equal(inst.blink.mode, 'opening', '`+16 = 4`（raw 143092）');
  // 第 6 拍：clock = 225（睁眼 elapsed 75）⇒ w = 75/+96 = 0.5
  assert.equal(tick(BLINK_DEFAULTS.openingMs / 2)?.get(BLINK_PARAM_L), 0.5, '睁眼 w = elapsed/+96 = 0.5（raw 143099）');

  // 第 7 拍：clock = 300（睁眼 elapsed 150 >= +96）⇒ 回 `+16 = 1`、w 夹到 1.0、并重排
  assert.equal(tick(BLINK_DEFAULTS.openingMs / 2)?.get(BLINK_PARAM_L), 1, '睁眼走完 w = 1.0（raw 143104 的 `v11 = 1.0`）');
  assert.equal(inst.blink.mode, 'idle', '回到 `+16 = 1`（raw 143103）');
  // 重排 = clock + rand()*dbl_52E310*(2*+84 - 1)（sub_4BC500 raw 143035-143036 的直译）
  assert.equal(
    inst.blink.nextBlinkAtMs,
    300 + 0.5 * BLINK_RAND_SCALE * (2 * BLINK_DEFAULTS.intervalMs - 1),
    '重排 = clock + rand*(2*+84-1)',
  );
  // ★常量守卫：`dbl_52E310` 是 **1/32767**（= MSVC RAND_MAX），不是 2^-15（差 9.3e-10，肉眼看不出来）
  assert.equal(BLINK_RAND_SCALE, 1 / 32767, '★`dbl_52E310` = 0.00003051850947599719 = 1/32767（.data:0052E310）');
  assert.notEqual(BLINK_RAND_SCALE, 2 ** -15, '★它**不是** `2^-15`（这条断言是那 9.3e-10 的棘轮）');

  // ★端到端：**经 `l2dAdvance`**（= `sub_4783D0` 的入口，宿主只走这一条）
  const e2 = mkEngine([]);
  l2dLoadModel(e2, 0, 0x100, eyeModel());
  l2dCreateNode(e2, 1, 0);
  const inst2 = e2.l2dSlots.get(0)!;
  inst2.blinkEnabled = true;
  inst2.blink.nextBlinkAtMs = 0;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < 12; i++) {
    l2dAdvance(e2, 0, [1], { clockMs: i * 50, rng: fixed(0.5) });
    left.push(inst2.params.get(BLINK_PARAM_L)!);
    right.push(inst2.params.get(BLINK_PARAM_R)!);
  }
  const show = (a: number[]) => JSON.stringify(a.map((v) => Number(v.toFixed(3))));
  assert.ok(
    left.some((v) => v < 1) && left.some((v) => v === 1),
    `★眨眼曲线必须在推进中真的起伏（L: ${show(left)}）`,
  );
  // `+32 = 1` ⇒ 右眼写的是 `-w`（raw 143123-143131 的 `v6 = -v6`）
  assert.ok(
    left.every((v, i) => Number.isFinite(v) && right[i] === -v),
    `★\`+32\` 置位 ⇒ 右眼逐拍都取负（L: ${show(left)} R: ${show(right)}）`,
  );
});

// ───────────────────────── ② `+23` 门控：置位/清零行为不同 ─────────────────────────

test('★T-0166 blink ②：`+23` 门控 —— 置 0 时一拍都不推进（含状态机与排期都不动），置非 0 才走（raw 92605 的 cmp/jz）', () => {
  const on = mkEngine([]);
  l2dLoadModel(on, 0, 0x100, eyeModel());
  l2dCreateNode(on, 1, 0);
  const a = on.l2dSlots.get(0)!;
  a.blinkEnabled = true;
  a.blink.mode = 'idle';
  a.blink.nextBlinkAtMs = 1000;
  R.l2dBlinkTick(a, 0, { clockMs: 5000, rng: fixed(0.5) });
  assert.equal(a.blink.mode, 'closing', '门开 ⇒ 到点转闭眼（closing）');

  const off = mkEngine([]);
  l2dLoadModel(off, 0, 0x100, eyeModel());
  l2dCreateNode(off, 1, 0);
  const b = off.l2dSlots.get(0)!;
  // ★缺省就是关（= 引擎实际行为）：门关 ⇒ 推进多少拍都不动
  b.blink.mode = 'idle';
  b.blink.nextBlinkAtMs = 1000;
  for (let i = 0; i < 20; i++) {
    assert.equal(R.l2dBlinkTick(b, 500, { clockMs: 5000 + i * 500, rng: fixed(0.5) }), null, '门关 ⇒ 恒返回 null');
  }
  assert.equal(b.blink.mode, 'idle', '★`+23 == 0` ⇒ `sub_4BC550` 一次都不被调到：状态机停在 `+16 = 1`');
  assert.equal(b.params.get(BLINK_PARAM_L), 1, '★门关 ⇒ 参数一个字节都不改（这是随包引擎的真实行为）');
  assert.equal(b.blink.nextBlinkAtMs, 1000, '★门关 ⇒ 连排期都不动（门在第一句，时钟都没读）');

  // 极性：**非 0 即真**（不是"== 1 才真"）——`0x02` 也必须走这一支
  const two = mkEngine([]);
  l2dLoadModel(two, 0, 0x100, eyeModel());
  l2dCreateNode(two, 1, 0);
  const c = two.l2dSlots.get(0)!;
  c.blinkEnabled = true; // 布尔模型：非 0
  c.blink.mode = 'idle';
  c.blink.nextBlinkAtMs = 0;
  l2dBlinkUpdate(c, 1, fixed(0.5));
  assert.notEqual(c.blink.mode, 'idle', '★极性 = `cmp …,0 / jz`（非 0 即真），不是"等于 1 才真"');

  // `+16` 的字面量 ↔ 名字（引擎里那格是 `_DWORD`：1/2/3/4，见 raw 143066/143076/143092/143103）
  assert.deepEqual(
    BLINK_MODE_VALUE,
    { idle: 1, closing: 2, holding: 3, opening: 4 },
    '★`+16` 的取值：idle=1 / closing=2 / holding=3 / opening=4（构造为 0 ⇒ 首次推进落到 idle 支）',
  );
  // 字段 ↔ 引擎偏移（本模块的"哪一格是哪个偏移"不能漂）
  assert.equal(BLINK_FIELDS.state, '+16', '状态机那一格是 `+16`');
  assert.equal(BLINK_FIELDS.nextBlinkAtMs, '+8', '下次眨眼时刻是 `+8`（sub_4BF8D0 的 clock 值）');
  assert.equal(BLINK_FIELDS.intervalMs, '+84', '间隔上界是 `+84`（4000）');
  assert.equal(BLINK_FIELDS.randomize, '+32', '右眼取负位是 `+32`（构造为 1）');

  // `l2dAdvance` 也要尊重门：关着时它的返回值里不得出现眨眼参数
  const e3 = mkEngine([]);
  l2dLoadModel(e3, 0, 0x100, eyeModel());
  l2dCreateNode(e3, 1, 0);
  const d = e3.l2dSlots.get(0)!;
  d.blink.nextBlinkAtMs = 0;
  const adv = l2dAdvance(e3, 3000, [1]);
  assert.equal(adv.has(0), false, '★门关着 ⇒ `l2dAdvance` 不得产出眨眼参数（否则等于把闸门默认打开）');
  assert.equal(d.params.get(BLINK_PARAM_L), 1);
});

// ───────────────────────── ③ 无 blink 数据的模型不崩 ─────────────────────────

test('★T-0166 blink ③：模型没有 PARAM_EYE_* 参数 ⇒ 不崩、不注入参数（退化为不眨眼）', () => {
  const e = mkEngine([]);
  l2dLoadModel(e, 0, 0x100, noEyeModel());
  l2dCreateNode(e, 1, 0);
  const inst = e.l2dSlots.get(0)!;
  assert.equal(inst.params.has(BLINK_PARAM_L), false, '模型没定义这两个参数 ⇒ 参数表里不该凭空出现');
  inst.blinkEnabled = true; // 即使把门打开
  inst.blink.nextBlinkAtMs = 0;
  const ws: (Map<string, number> | null)[] = [];
  let t = 0;
  for (let i = 0; i < 40; i++) {
    t += 100;
    ws.push(R.l2dBlinkTick(inst, 0, { clockMs: t, rng: fixed(0.5) }));
  }
  // 状态机照常跑（引擎那一步不做存在性检查 —— 缺格时 `sub_4BD3E0` 直接 `_CxxThrowException`，
  // 见 `blink.ts` 文件头；emulator 的选择是"跳过这一格"而不是抛），但**不得抛**、也不得把参数塞进表里
  assert.ok(
    ['idle', 'closing', 'holding', 'opening'].includes(inst.blink.mode),
    `眨眼态必须停在一个合法态（实际 ${inst.blink.mode}）`,
  );
  assert.ok(
    ws.every((m) => m === null),
    '★模型没声明这两个参数 ⇒ `declaresParam` 全 false ⇒ 这一支**一条写回都不产出**' +
      `（引擎对应后果是抛，见文件头；emulator 退化取"跳过"）— ws=${JSON.stringify(ws.filter((m) => m !== null))}`,
  );
  assert.equal(inst.params.has(BLINK_PARAM_L), false, '★模型没声明 `PARAM_EYE_L_OPEN` ⇒ 不得凭空写进参数表');
  assert.deepEqual([...inst.params.keys()], ['PARAM_A'], '★参数表仍然只有模型自己声明的那些（无幽灵参数）');
  assert.notEqual(inst.blink.nextBlinkAtMs, 0, '状态机照常推进（排期发生过 ⇒ 与"门关着"那条可区分）');

  // 无模型（空实例）也必须安全：引擎那边的门是 `if (*_this)`（`sub_4783D0` raw 92584）+
  //   调用点的"槽里有实例"（`sub_4B0360` raw 134320）⇒ `l2dAdvance` 的眨眼支连进都不进。
  const empty: L2dInstance = newL2dInstance(3);
  empty.blinkEnabled = true;
  assert.equal(l2dBlinkUpdate(empty, 1000, fixed(0.5)), null, '★没有模型 ⇒ 不推进（`if (*_this)`；门在第一句）');
  assert.equal(empty.blink.mode, 'idle', '状态机不动');

  // 销毁槽后再推进：不得使用已销毁实例（引擎 `0x342` 顺手 delete 实例、连带析构 `+16`，raw 92567-92575 + 121745）
  const e4 = mkEngine([]);
  l2dLoadModel(e4, 0, 0x100, eyeModel());
  l2dCreateNode(e4, 1, 0);
  assert.equal(l2dDestroySlot(e4, 0), true, '0x342 销毁槽');
  assert.equal(e4.l2dSlots.has(0), false, '槽没了');
  assert.doesNotThrow(() => l2dAdvance(e4, 500, [1]), '槽被销毁后推进不得抛（`l2dNodeDrawable` 先把不可画的节点滤掉）');
});
