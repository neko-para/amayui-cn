/** @tier T0 @kind tool @subsystem tool */

/**
 * `T-0114` 第 2 步守卫：**条件断点 + 语义事件断点**（`src/vm/debugBreak.ts`）。
 *
 * 覆盖四件事：
 *  1. **表达式求值口径**：数字按**十六进制**读（与 `src/*.txt` 字面量一致）；`global`/`local`/`slot` 取的是
 *     **解码后**的值（引擎 int 池内存里是 ENC 过的）；缺项语义（未写过的全局 = 0、未绑的槽 = -1）；
 *  2. **运算符**：`== != < <= > >=` 与 `&& || !`、真值判定（无比较符时"非 0 即真"）；
 *  3. **命中判定**：`step` 断点按条件命中；`event` 断点按 `where` + 条件命中，且**事件类型不匹配时绝不命中**；
 *  4. **安全棘轮**：不 `eval`、不 `new Function`（条件只走白名单递归下降）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { enc } from '../src/vm/bits.js';
import {
  ConditionError,
  compileBreak,
  matchEvent,
  matchInstruction,
  parseCondition,
  parseDebugCommand,
  testCondition,
  type BreakSpec,
} from '../src/vm/debugBreak.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SRC = path.join(ROOT, 'app/amayui-emulator/src/vm/debugBreak.ts');

function mkEngine(): Engine {
  const e = new Engine(new StubNative(() => {}));
  e.key = 0;
  return e;
}
const ctx = (e: Engine): { engine: Engine; cur: number } => ({ engine: e, cur: e.cur });

test('★求值：数字口径无歧义（`0x11`=17 / `11`=11 / `1dd7` 按 hex）', () => {
  const e = mkEngine();
  // 槽的**十进制** 11（= 0xb）放值 0x11=17，用来分辨两种读法
  e.globals.int.set(11, enc(e.key, 0x11));
  assert.equal(testCondition('global 11 == 17', ctx(e)), true, '左右都按十进制 ⇒ 槽 11 的值 17');
  assert.equal(testCondition('global 11 == 0x11', ctx(e)), true, '左侧十进制 11、右侧 0x11=17 ⇒ 相等');
  assert.equal(testCondition('global 0x11 == 17', ctx(e)), false, '★0x11=17 号槽**没写过** ⇒ 0 ≠ 17');
  assert.equal(testCondition('global 0x11 == 0', ctx(e)), true, '0x11 号槽未写过 ⇒ 读作 0');
  // 含字母 ⇒ 按 hex
  e.globals.int.set(0x1dd7, enc(e.key, 1));
  assert.equal(testCondition('global 1dd7 == 1', ctx(e)), true, '含字母的串按 hex（= 0x1dd7）');
  assert.equal(testCondition('global f8080 == 0', ctx(e)), true, '`f8080` 按 hex（= 0xf8080，未写过 ⇒ 0）');
});

test('★求值：global 取的是**解码后**的值（脚本写 6 ⇒ 与字面量 6 相等）', () => {
  const e = mkEngine();
  e.globals.int.set(0, enc(e.key, 6));
  assert.equal(testCondition('global 0 == 6', ctx(e)), true);
  assert.equal(testCondition('global 0 == 1', ctx(e)), false);
});

test('★缺项语义：未写过的全局 = 0；未绑定的槽按 -1 参与比较（文档化口径）', () => {
  const e = mkEngine();
  assert.equal(testCondition('global 1dd7 == 0', ctx(e)), true, '未写过读作 0（与操作数读侧同口径）');
  // ★本表达式语言里没有负数**字面量**（十六进制无符号），所以"未绑定"不能用 `== -1` 表达；
  //   这里用"非 0 判定"与"绑上后能比出来"两条钉住口径，避免写出语法上不存在的用例。
  assert.equal(testCondition('slot 11', ctx(e)), true, '未绑定的槽取 -1 ⇒ 非 0 ⇒ 真值判定为真（= 文档口径）');
  assert.equal(testCondition('slot 11 == 0x5260', ctx(e)), false, '未绑定时不等于任何 imgid');
  e.texSlots.set(0x11, 0x5260);
  assert.equal(testCondition('slot 0x11 == 0x5260', ctx(e)), true, '绑上后按 hex 比较（0x11=17）');
  assert.equal(testCondition('slot 11 == 0x5260', ctx(e)), false, '★十进制 11（= 0xb）不是那个槽 ⇒ 不命中');
  assert.equal(testCondition('slot 0x11 == 0', ctx(e)), false, '与 0 不是一回事');
});

test('求值：local / frame[i].local / 逻辑与比较运算符', () => {
  const e = mkEngine();
  e.frames[0]!.locals.int.set(1, enc(e.key, 3));
  e.frames[1]!.locals.int.set(2, enc(e.key, 9));
  assert.equal(testCondition('local 1 == 3', ctx(e)), true);
  // ★刻意缩范围：表达式里**不支持** `frame[i].local`（见 debugBreak.ts 文件头）。
  //   要查别的帧用面板的 `flocal <帧> <下标>` 查询。这里只钉"当前帧 local"与逻辑运算。
  assert.equal(testCondition('local 1 == 3 && local 1 != 4', ctx(e)), true);
  assert.equal(testCondition('local 1 == 4 || local 1 == 3', ctx(e)), true);
  assert.equal(testCondition('!(local 1 == 4)', ctx(e)), true);
  assert.equal(testCondition('local 1 < 4', ctx(e)), true);
  assert.equal(testCondition('local 1 >= 4', ctx(e)), false);
});

test('★解析失败给出面向用户的错误（不是抛内部错误）', () => {
  for (const bad of ['global', 'global xyz', 'local 1 ==', 'foo 1', 'global 0 == 1 )', 'global 0 == 6 extra', '1 + 1']) {
    assert.throws(() => parseCondition(bad), ConditionError, `「${bad}」应报 ConditionError`);
  }
});

test('★命中判定：step 断点（无条件 = 每步都停；有条件按条件）', () => {
  const e = mkEngine();
  e.globals.int.set(0, enc(e.key, 1));
  const everyStep = compileBreak({ id: 1, kind: 'step', condition: '' });
  assert.equal(everyStep.always, true);
  assert.ok(matchInstruction([everyStep], e, 'SC0000.BIN'), '无条件断点：每步命中');
  assert.match(matchInstruction([everyStep], e, 'SC0000.BIN')!.where, /SC0000\.BIN@ip=/);

  const cond = compileBreak({ id: 2, kind: 'step', condition: 'global 0 == 1' });
  assert.ok(matchInstruction([cond], e, 'X.BIN'), '条件成立 ⇒ 命中');
  e.globals.int.set(0, enc(e.key, 2));
  assert.equal(matchInstruction([cond], e, 'X.BIN'), null, '条件不成立 ⇒ 不命中');
});

test('★命中判定：event 断点用事件参数判定，且 `where` 不匹配绝不命中', () => {
  const e = mkEngine();
  // 「任何写 global 0 都停」——这是 T-0102 最想要的一条
  const gw = compileBreak({ id: 1, kind: 'event', where: 'global-int-write', condition: 'idx == 0' });
  const specs: BreakSpec[] = [gw];

  const hit = matchEvent(specs, 'global-int-write', e, { idx: 0, val: 1 }, '写 global0 ← 1');
  assert.ok(hit, 'idx 匹配 ⇒ 命中');
  assert.equal(hit!.where, '写 global0 ← 1');
  assert.match(hit!.detail!, /idx=0x0/, '命中信息带上事件参数，便于面板显示');

  assert.equal(
    matchEvent(specs, 'global-int-write', e, { idx: 0x1dd7, val: 1 }, '写 global1dd7'),
    null,
    'idx 不匹配 ⇒ 不命中',
  );
  assert.equal(
    matchEvent(specs, 'slot-bind', e, { slot: 0x11, imgid: 0x5260 }, '绑槽'),
    null,
    '★`where` 不匹配 ⇒ 绝不命中（否则断点会张冠李戴）',
  );

  // 绑槽断点用 slot/imgid 判定
  const sb = compileBreak({ id: 2, kind: 'event', where: 'slot-bind', condition: 'slot == 0x11 && imgid == 0x5260' });
  assert.ok(matchEvent([sb], 'slot-bind', e, { slot: 0x11, imgid: 0x5260 }, '绑槽'), '槽+imgid 都匹配 ⇒ 命中');
  assert.equal(matchEvent([sb], 'slot-bind', e, { slot: 0x11, imgid: 0x1 }, '绑槽'), null, 'imgid 不匹配 ⇒ 不命中');
});

test('★源码棘轮：断点条件不许 eval', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.ok(!/\beval\s*\(/.test(src), '不得使用 eval');
  assert.ok(!/new\s+Function\s*\(/.test(src), '不得使用 new Function');
});

test('★命令台（lldb 风格）：`b` / `b event` / `bl` / `d` / `c` / 其它当查询', () => {
  // 空行 = 什么都不做
  assert.equal(parseDebugCommand('   '), null);

  // 条件断点：`b <条件>`；`b` 单独 = 无条件（每条指令都停）
  assert.deepEqual(parseDebugCommand('b global 0x11 == 5260'), {
    a: 'break-add', breakKind: 'step', condition: 'global 0x11 == 5260',
  });
  assert.deepEqual(parseDebugCommand('b'), { a: 'break-add', breakKind: 'step', condition: '' });

  // 语义事件断点：`b event <类型> <条件>`
  assert.deepEqual(parseDebugCommand('b event global-int-write idx == 0'), {
    a: 'break-add', breakKind: 'event', where: 'global-int-write', condition: 'idx == 0',
  });
  assert.deepEqual(parseDebugCommand('b event slot-bind slot == 0x11'), {
    a: 'break-add', breakKind: 'event', where: 'slot-bind', condition: 'slot == 0x11',
  });
  // ★事件类型**按池命名**（不写笼统的 global-write）：float 池的 val 是位模式
  assert.deepEqual(parseDebugCommand('b event global-float-write idx == 0 && f2i(val) == 10'), {
    a: 'break-add', breakKind: 'event', where: 'global-float-write', condition: 'idx == 0 && f2i(val) == 10',
  });

  // 列表 / 删除 / 继续
  assert.deepEqual(parseDebugCommand('bl'), { a: 'break-list' });
  assert.deepEqual(parseDebugCommand('breakpoints'), { a: 'break-list' });
  assert.deepEqual(parseDebugCommand('d'), { a: 'break-del' });
  assert.deepEqual(parseDebugCommand('delete 3'), { a: 'break-del', id: 3 });
  assert.deepEqual(parseDebugCommand('c'), { a: 'continue' });
  assert.deepEqual(parseDebugCommand('continue'), { a: 'continue' });

  // ★其它输入**一律当查询** —— 这样"查一个值"不需要任何前缀
  assert.deepEqual(parseDebugCommand('global 0'), { a: 'query', text: 'global 0' });
  assert.deepEqual(parseDebugCommand('frame'), { a: 'query', text: 'frame' });

  // 错误用法给出**可读原因**（走 query 通道回显，不抛）
  const badEvent = parseDebugCommand('b event nope x == 1');
  assert.equal(badEvent!.a, 'query');
  assert.match((badEvent as { text: string }).text, /类型必须是/);
  const badDel = parseDebugCommand('delete abc');
  assert.equal(badDel!.a, 'query');
  assert.match((badDel as { text: string }).text, /id 必须是整数/);
});

test('★源码棘轮：控制面板**不得再硬编码事件类型清单**（用户实测踩过这份漂移）', () => {
  // 事故经过：渲染窗把事件名改成按池命名（`global-int-write` 等）后，控制面板里那份**手抄的**
  // 合法值清单没跟着改 ⇒ `b event global-int-write …` 被面板本地的校验拒掉。
  // 守卫当时**没抓住** —— 因为它测的是渲染窗的 `parseDebugCommand`，不是面板里那份拷贝。
  // 纪律：面板**不再重复校验**，一律透传，由渲染窗的 `EVENT_KINDS`（唯一真相源）判定并回可读错误。
  const panel = fs.readFileSync(path.join(ROOT, 'app/amayui-emulator/control/control.ts'), 'utf8');
  for (const kind of ['global-int-write', 'global-float-write', 'global-str-write', 'slot-bind', 'global-write']) {
    assert.ok(
      !panel.includes(`'${kind}'`),
      `control.ts 里不该出现事件类型字面量 '${kind}'（那是渲染窗 EVENT_KINDS 的职责）`,
    );
  }
  // 反向：它必须**透传** where（把 rest[1] 直接送出去），而不是先判断
  assert.ok(/where:\s*\(rest\[1\]/.test(panel), '面板应把事件类型透传给渲染窗');
});

test('★`compileBreak` 必须校验事件类型（CLI 那条路绕过了解析器 —— 2026-09-23 实测踩到）', () => {
  // 事故经过（`tickets/T-0114` 第 8 次变更）：远程调试守护进程 `tools/debugsrv.cjs` 是**手工分流**的
  //   （只认 `b event` 前缀、不做校验）⇒ `dbg 'b event bogus-kind idx == 0'` 被静默注册成
  //   「事件断点(bogus-kind) 命中 0」。而 `matchEvent` 用 `s.where !== where` 做唯一匹配键
  //   ⇒ 那是一条**永远不会命中的死断点**：不报错、只是"设了没用"，比报错难查得多。
  // 纪律：校验放在**面板与 CLI 的共同收口点**（`compileBreak`），不是只放在 `parseDebugCommand`。
  for (const kind of ['global-int-write', 'global-float-write', 'global-str-write', 'slot-bind']) {
    const ok = compileBreak({ id: 1, kind: 'event', where: kind as never, condition: 'idx == 0' });
    assert.equal(ok.where, kind);
  }
  assert.throws(
    () => compileBreak({ id: 1, kind: 'event', where: 'bogus-kind' as never, condition: 'idx == 0' }),
    /类型必须是/,
    '非法事件类型必须抛（面向用户的 ConditionError），不许静默入表',
  );
  // 条件断点没有 `where` 这回事，别把它一起拒了
  assert.equal(compileBreak({ id: 2, kind: 'step', condition: '' }).always, true);
});
