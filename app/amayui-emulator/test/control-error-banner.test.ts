/** @tier T0 @kind tool @subsystem tool */

/**
 * **控制窗 ⚠️ 横幅必须"粘住"硬错误**（`tickets/T-0056`）。
 *
 * 用户实测：加载存档时命中 `Depth が不正です 51 != 54`，但**控制面版什么都没显示**，
 * 只能去翻 `.tmp/amayui-emulator.log`。
 *
 * 根因（读代码即可确认，与本文件的两个断言一一对应）：
 *  1. `#onError` 确实上报了一次（`notifyStatus(emsg)`）—— 所以不是"没上报"；
 *  2. 但状态上报是**幂等快照**：`notifyStatus()` 不带 override 时 `error: undefined`，
 *     而 `run()` 收尾**必再上报一次**（"把最终态给控制窗"）⇒ 横幅在毫秒级被擦掉。
 *
 * 修法：会话把硬错误文本**粘住**（`#errorText`），每次上报都带上它，直到有更明确的文本
 * （override / 暂停态）或显式清除（跳过未知指令）。
 *
 * 本文件锁：① 纯函数的优先级；② `session.ts` 里那条接线真的存在（源码棘轮 —— 纯函数测不到"忘了传"）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlErrorText } from '../src/renderer/app/session.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SESSION = path.join(HERE, '..', 'src', 'renderer', 'app', 'session.ts');

const PAUSED = { opcode: 0x327, name: 'i327', script: 'TEST.BIN' };

test('优先级：显式文本 > 暂停提示 > 粘住的错误', () => {
  assert.equal(controlErrorText('本次', '上次', PAUSED), '本次', '本次上报的文本最优先');
  assert.equal(controlErrorText(undefined, '上次', PAUSED), '停在未知指令 0x327 (i327) @ TEST.BIN');
  assert.equal(controlErrorText(undefined, '上次', null), '上次', '★没有新信息时，粘住的错误必须继续上报');
  assert.equal(controlErrorText(undefined, undefined, null), undefined, '什么都没有 ⇒ 不显示横幅');
});

test('★回归：错误之后的"无 override"上报不得把横幅擦掉（用户报的那条）', () => {
  // 复刻会话里的两次调用：① 出错时带文本；② `run()` 收尾不带文本。
  const err = 'Depth が不正です 51 != 54（跨脚本派发 label：热点/回调注册于脚本 id 54，当前 51 SAVE.BIN）';
  let sticky: string | undefined;
  const report = (override?: string): string | undefined => controlErrorText(override, sticky, null);

  assert.equal(report(err), err, '出错当次上报');
  sticky = err; // = `#onError` 里的 `this.#errorText = emsg`
  assert.equal(report(), err, '★收尾那次不带 override 的上报必须仍然显示同一个错误（修前这里是 undefined）');
  sticky = undefined; // = 跳过未知指令后的清除
  assert.equal(report(), undefined, '显式清除后才不显示');
});

test('接线棘轮：`session.ts` 把硬错误粘住，并在跳过未知指令时清掉', () => {
  const src = fs.readFileSync(SESSION, 'utf8');
  assert.match(src, /#errorText: string \| undefined;/, '会话要有粘住错误文本的槽');
  assert.match(
    src,
    /this\.#errorText = emsg;[\s\S]{0,200}?this\.notifyStatus\(emsg\);/,
    '`#onError` 必须先粘住、再上报',
  );
  assert.match(
    src,
    /error: controlErrorText\(errorOverride, this\.#errorText, paused\)/,
    '`notifyStatus` 必须把粘住的文本交给 `controlErrorText`（否则等于没修）',
  );
  assert.match(src, /this\.#errorText = undefined;/, '暂停解除时要清掉粘住的文本');
});
