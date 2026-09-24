# T-0147 复现（已实测，2026-09-24）

## A. 用户报的那条：op2 = 立即数 ⇒ 硬抛

站点 = `src/AIM.txt:423`（战斗 `AIM.BIN`）：

```
i205 2a 23f (local-int 12) (local-int 47) 7 10000
```

实测输出：

```
A) 抛出：writeIntOperand: unsupported type 0x0 for opcode 0x205
```

## B. 同一指令的可写槽形态：不报错，但静默污染脚本状态

站点形状 = `src/AIM.txt:453-454`：

```
i205 2a (local-int 11) 227 (local-ptr 2) 1 10000
add  (local-int 48) (local-int 11) 9
```

实测输出（`mov` 预置 x=256、数值=12345、宽 8、flags 0、`cy = -lfHeight = 30`）：

```
B) 运行后：(local-int 0x11)=346（引擎应为 256=只读） / (local-int 0x12)=346（引擎应为 256）；
   对 op2 槽的写入事件 2 次：256,346
```

- `346 = 256 + 90`，`90 = start(3) × cy(30)` = emulator 自己算出的 x 前进量 ⇒ 回写确凿。
- 第 2 条「写入事件」的 256 来自 `mov (local-int 11) 256`，346 来自 0x205 ⇒ 用 `local-int-write`
  调试事件（`T-0127` 的 local 写唯一门面）即可定位「是 0x205 写的」。

## 复现脚本（临时区执行，证据正文即上面两行输出；脚本本体抄在下面以便重建）

```ts
// .tmp/d205-repro/repro.ts（app/amayui-emulator 下执行：npx tsx ../../.tmp/d205-repro/repro.ts）
import { instr, im, loc, mkEngine } from '../../app/amayui-emulator/test/harness.js';
import { stepOnce } from '../../app/amayui-emulator/src/vm/interpreter.js';
import { ENGINE_FIELD } from '../../app/amayui-emulator/src/vm/engineFieldIds.js';
import { decIntSlot } from '../../app/amayui-emulator/src/vm/ref.js';

const IM = (v: number) => im(v);
const L = (n: number) => loc(n);

async function caseA(): Promise<void> {
  const e = mkEngine([instr(0x205, [IM(0x2a), IM(0x23f), L(0x12), L(0x47), IM(7), IM(0x10000)])]);
  try {
    await stepOnce(e);
    console.log('A) 未抛错（意外）');
  } catch (err) {
    console.log('A) 抛出：' + (err as Error).message);
  }
}

async function caseB(): Promise<void> {
  const e = mkEngine([
    instr(0x55, [L(0x11), IM(256)]),   // mov  local11 = 256 (x)
    instr(0x55, [L(0x2), IM(12345)]),  // mov  local2  = 12345 (数值)
    instr(0x205, [IM(0x2a), L(0x11), IM(0x227), L(0x2), IM(8), IM(0)]),
    instr(0x50, [L(0x12), L(0x11), IM(0)]), // add local12 = local11 + 0  ← 语料形状：紧随其后又读 op2 槽
  ]);
  e.engineValues.set(ENGINE_FIELD.logfontMain, -30); // cy = 30
  const writes: number[] = [];
  e.debugEvent = (ev) => {
    if (ev.kind === 'local-int-write' && ev.values.idx === 0x11) writes.push(ev.values.val);
  };
  for (let i = 0; i < 4; i++) await stepOnce(e);
  const slot = e.curScript().locals.int;
  const vis = (n: number): number => decIntSlot(e.key, slot.get(n));
  console.log(
    `B) 运行后：(local-int 0x11)=${vis(0x11)}（引擎应为 256=只读）` +
      ` / (local-int 0x12)=${vis(0x12)}（引擎应为 256）` +
      `；对 op2 槽的写入事件 ${writes.length} 次${writes.length ? '：' + writes.join(',') : ''}`,
  );
}

void (async () => { await caseA(); await caseB(); })();
```

## 修复后这两条应变成

```
A) 未抛错
B) 运行后：(local-int 0x11)=256 / (local-int 0x12)=256；对 op2 槽的写入事件 1 次：256
（那 1 次来自 mov；0x205 不再写 op2）
```

并且**画出的 x 仍应是 346**（前进量只用于绘制，不写回）—— 守卫里用实现了 `drawString` 的假 Native 断言。
