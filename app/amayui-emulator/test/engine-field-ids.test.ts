/**
 * **引擎字段注册表的守卫**（`tickets/T-0057` R2/R3）。
 *
 * 为什么需要它：`engineValues` 的键是引擎 `_this[K]` 的 **dword 下标**，而反编译里同时存在
 * `*(_DWORD *)(_this + N)`（**字节**偏移）。两者相差 4 倍，写错后只是"读写了一个不存在的字段" ——
 * 不报错、只表现不对。实测事故（`0x1F5`）：把字节 429756/429752 当键，与 `0x1F4` 的
 * `_this[107439]/[107438]` 不是同一格 ⇒ 帧计数只增不减、停靠锁永不释放、时钟冻在第一帧。
 *
 * 本文件钉三件事：
 *  1. 关键字段常量的**数值**与 raw 锚点一致（含字节↔下标的 4 倍关系）；
 *  2. `src/vm/**` 里**不再有**裸数字 `engineValues.get/set(<数字>)`（ratchet，防回潮）；
 *  3. `0x1F4`/`0x1F5` 成对语义（锁 + 帧计数 + 时钟刷新）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, Frame } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS } from '../src/vm/ops.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { im, instr } from './harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VM = path.resolve(HERE, '..', 'src', 'vm');

test('ENGINE_FIELD 的关键取值与 raw 锚点一致（含字节↔dword 的 4 倍关系）', () => {
  // raw `sub_41A090`：`_this[107438]`（锁）/ `_this[107439]`（帧计数）
  // raw `sub_41A0E0`：`*(_DWORD *)(_this + 429756)` / `+ 429752` ⇒ 同一对格。
  assert.equal(ENGINE_FIELD.frameTickLock, 107438);
  assert.equal(ENGINE_FIELD.frameCount, 107439);
  assert.equal(ENGINE_FIELD.frameTickLock * 4, 429752, 'raw 里是字节 429752');
  assert.equal(ENGINE_FIELD.frameCount * 4, 429756, 'raw 里是字节 429756');
  assert.equal(ENGINE_FIELD.clock * 4, 369332, 'raw 里是字节 369332');
  assert.equal(ENGINE_FIELD.clockPrev * 4, 369336);
  // 0x106 / 0x201 的字段（opcode-table.md:214/345；raw 39043/39862）
  assert.equal(ENGINE_FIELD.engineField550, 550);
  assert.equal(ENGINE_FIELD.drawMode, 166964);
  // 几个跨文件共用字段
  assert.equal(ENGINE_FIELD.messageSpeed, 21668);
  assert.equal(ENGINE_FIELD.defaultWindow, 21631);
  assert.equal(ENGINE_FIELD.verticalText, 80101);
  assert.equal(ENGINE_FIELD.waitTimerStart, 92338);
  assert.equal(ENGINE_FIELD.waitTimerMs, 92339);
  assert.equal(ENGINE_FIELD.loadInProgress, 95780);
  assert.deepEqual(
    [ENGINE_FIELD.winRevealGateBase, ENGINE_FIELD.winRevealDelayBase, ENGINE_FIELD.winRevealDoneBase],
    [122466, 122476, 122486],
  );
});

test('ratchet：src/vm/** 不得再出现裸数字的 engineValues.get/set 键', () => {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!e.name.endsWith('.ts') || e.name === 'engineFieldIds.ts') continue;
      const text = fs.readFileSync(p, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (/engineValues\.(get|set)\(\s*\d/.test(line)) offenders.push(`${path.relative(VM, p)}:${i + 1}`);
      });
    }
  };
  walk(VM);
  assert.deepEqual(offenders, [], '请把裸字段下标换成 ENGINE_FIELD.*（新增字段先进 engineFieldIds.ts）');
});

interface Harness {
  e: Engine;
  f: Frame;
  step: (op: number, args?: ReturnType<typeof im>[]) => void;
}

function mk(): Harness {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  const f = new Frame();
  const step = (op: number, args: ReturnType<typeof im>[] = []): void => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
    h!(makeCtx(e, f, instr(op, args), native, () => {}));
  };
  return { e, f, step };
}

test('0x1F4 / 0x1F5：停靠锁 + 帧计数 + 时钟刷新成对（T-0057 R3 的真 bug 守卫）', () => {
  const { e, step } = mk();
  const lock = (): number | undefined => e.engineValues.get(ENGINE_FIELD.frameTickLock);
  const count = (): number | undefined => e.engineValues.get(ENGINE_FIELD.frameCount);
  const clock = (): number | undefined => e.engineValues.get(ENGINE_FIELD.clock);

  e.nowMs = 1000;
  step(0x1f4); // 首次：置锁 + 刷时钟
  assert.equal(lock(), 1);
  assert.equal(clock(), 1000);

  e.nowMs = 1016;
  step(0x1f4); // 已锁 ⇒ 只累加帧计数，不刷时钟
  assert.equal(count(), 1, '帧计数走 frameCount（107439），不是幽灵键 429756');
  assert.equal(clock(), 1000, '锁在 ⇒ 时钟不刷新');

  e.nowMs = 1032;
  step(0x1f5); // 计数 1 → 0
  assert.equal(count(), 0, '0x1F5 递减的是 frameCount（与 0x1F4 同一格）');
  assert.equal(lock(), 1, '计数还没到"<=0 且已置锁"的收尾');

  e.nowMs = 1048;
  step(0x1f5); // 计数 0 且锁在 ⇒ 清锁
  assert.equal(lock(), 0, '0x1F5 清的是 frameTickLock（107438）—— 旧实现清幽灵键 429752，锁永不释放');

  e.nowMs = 1064;
  step(0x1f4); // 锁已清 ⇒ 重新刷时钟
  assert.equal(lock(), 1);
  assert.equal(clock(), 1064, '锁被 0x1F5 释放后，0x1F4 恢复刷新时钟（旧实现时钟冻死在第一帧）');
});
