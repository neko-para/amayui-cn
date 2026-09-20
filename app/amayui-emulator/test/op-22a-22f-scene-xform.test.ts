/**
 * 缺口收口轮（6 条「语料用到但零注册」）的守卫 —— `tickets/T-0076`。
 *
 * 本轮对象：`0x22A`/`0x22C`/`0x22D`/`0x22F`（Scene 级变换四条）与 `0x1C4`（语音总线查询）、
 * `0x23A`（布尔 getter）。
 *
 * ★**2026-09 第二轮（本文件被改写过，不是删掉重写）**：Scene 四条**已经落地**——
 *   写端 = `OPS` 的 `op_scene_scale`/`op_scene_translation`/`op_scene_axis_scale`/
 *   `op_scene_axis_translation`，模型 = `SceneState.sceneXform`，**合成级** = 两个宿主 +
 *   `pixi/presenter.ts` 里「只作用于层号 ∈ [20,30)」的那一级（`scene/ops.ts` 的
 *   `applySceneXformToPlacement`）。所以本文件对它们的三条主张**从「保持 deferred」翻转为
 *   「必须 implemented 且真有消费者」**；`0x1C4`/`0x23A` **仍 `deferred`**（理由见各自 note），
 *   它们那部分的断言原样保留。
 *   ★新行为断言在 `test/op-22a-22f-scene-world.test.ts`；本文件只留**口径与体账**这两件
 *   "防回退"的事（体账 = 这几条究竟读 float 还是 int、被调体是哪个矩阵函数）。
 *
 * 本文件守的是两件**可被推翻的具体主张**：
 *
 *  ① **体账**：这六条 handler 的**体内真实行为**逐条钉在 `engine/…_utf8.c` 的真源上 ——
 *     从 `handlerBodyLine` 起做**大括号配平**取体，再断言体内**该有的算子**（÷100 的次数 /
 *     写哪个 float 池 / 调哪个矩阵函数 / 读哪个字段）与**明确不该有的算子**（例如 `0x22A` 体内
 *     **不得**出现 `sub_41BF50`（int 池取 handle）；`sub_49A9C0` 体内**必须**是
 *     `D3DXMatrixTranslation` 而**不是** `D3DXMatrixScaling`）。
 *     ★为什么必须这么钉：本轮实测证明**筛体文档（`b3-screening-2026-09.md`）多处与体不符**
 *     （把 Scene 变换的操作数当 handle、把 `0x22F` 的被调体记成缩放、把 `0x1C4` 的语音对象
 *     记成 Scene 绘制项），若不把体钉住，下次又会照筛体抄一遍。
 *
 *  ② **口径棘轮**：六条在 `analysis/opcode-gaps.json` 里**必须都在册、都带≥80 字的 note**
 *     （体内真实行为 + 为什么不实现/怎么实现的 + 扩展点/消费者链），**四条 Scene 变换
 *     必须 `implemented` 且真在 `OPS` 里**（`deferred` ≠ 偷偷注册成 no-op，`implemented`
 *     也 ≠ 只在台账里改个字段），**`0x1C4`/`0x23A` 必须仍 `deferred` 且不在三张表里**。
 *     反向也守：`unimplemented` 必须为 0。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const DEC = path.join(ROOT, 'engine', '天结_unpacked.exe_utf8.c');
const LEDGER = path.join(ROOT, 'analysis', 'opcode-gaps.json');

const decLines = fs.readFileSync(DEC, 'utf8').split(/\r?\n/);

/**
 * 从 `//----- (XXXX)` 定义头（1-based 行号）起取函数体：跳过签名行到第一个 `{`，
 * 再按大括号配平取到匹配的 `}`。**不许**按「邻近下一个 `//-----`」取（本轮踩过：
 * 反编译里相邻函数会污染取体范围）。
 */
function bodyAt(headerLine: number): string {
  let j = headerLine - 1 + 1;
  while (j < decLines.length && !/^\{/.test(decLines[j]!)) j++;
  let depth = 0;
  for (let k = j; k < decLines.length; k++) {
    for (const c of decLines[k]!) {
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return decLines.slice(j, k + 1).join('\n');
      }
    }
  }
  throw new Error(`取不到体：header @${headerLine}`);
}

/** 定义头行号（`//----- (XXXX) ---…`），按地址精确定位 —— 不按邻近常量猜。 */
function headerLineOf(addr: string): number {
  const i = decLines.findIndex((l) => l.startsWith(`//----- (${addr})`));
  assert.ok(i >= 0, `反编译里找不到定义头 //----- (${addr})`);
  return i + 1;
}

function bodyOf(addr: string): string {
  return bodyAt(headerLineOf(addr));
}

// ---------------------------------------------------------------------------
// ① 体账：逐条钉住体内真实算子（这是本轮最重要的产出）
// ---------------------------------------------------------------------------

test('0x22A（sub_424080 raw 32003）：三条 float 操作数各 ÷100，写 Scene 缩放变换；体内无 handle 取用', () => {
  const b = bodyOf('00424080');
  // 三条读都是 float 池（sub_41C300），并且各除一次 dbl_5201F0（=100.0）
  assert.equal((b.match(/sub_41C300/g) ?? []).length, 3, '应当是 3 条 float 操作数读取');
  assert.equal((b.match(/dbl_5201F0/g) ?? []).length, 3, '三个分量都要 ÷100（dbl_5201F0）');
  // ★订正筛体：op1 不是 handle —— 体内不得出现 int 池取用（sub_41BF50 = readIntOperand）
  assert.ok(!/sub_41BF50/.test(b), '0x22A 体内不得有 handle/int 取用（筛体「op1=handle」与体不符）');
  // 转发给 Scene 级变换函数（实参 = Engine + 80708 = Scene）
  assert.match(b, /sub_49A720\(_this \+ 80708, v3, v4, v5\)/);

  const callee = bodyOf('0049A720');
  assert.match(callee, /_this\[306\] = 1/, '写变换种类格 Scene[306]');
  assert.match(callee, /j_D3DXMatrixScaling\(_this \+ 307/, '写 Scene+307 的缩放矩阵');
  assert.match(callee, /_this\[11627\] = 1/, '置脏 Scene[11627]');
});

test('0x22C（sub_424180 raw 32034）：三条 float 操作数**不除**，写 Scene 平移变换；体内无 handle 取用', () => {
  const b = bodyOf('00424180');
  assert.equal((b.match(/sub_41C300/g) ?? []).length, 3);
  assert.ok(!/dbl_5201F0/.test(b), '0x22C 是像素平移 ⇒ 不得出现 ÷100');
  assert.ok(!/sub_41BF50/.test(b), '0x22C 体内不得有 handle/int 取用（筛体「op1=handle」与体不符）');
  assert.match(b, /sub_49A820\(_this \+ 80708, v3, v4, v5\)/);

  const callee = bodyOf('0049A820');
  assert.match(callee, /_this\[306\] = 1/);
  assert.match(callee, /j_D3DXMatrixTranslation\(_this \+ 371/);
  assert.match(callee, /_this\[11627\] = 1/);
});

test('0x22D（sub_4241F0 raw 32048）：op1/op2 是 int（不是 handle），op3/4/5 各 ÷100；被调体写 Scene+323 缩放', () => {
  const b = bodyOf('004241F0');
  assert.equal((b.match(/sub_41C300/g) ?? []).length, 3, 'op3/4/5 三条 float');
  assert.equal((b.match(/dbl_5201F0/g) ?? []).length, 3, 'op3/4/5 各 ÷100');
  assert.equal((b.match(/sub_41BF50/g) ?? []).length, 2, 'op1/op2 走 int 池（子_41BF50），各一次');
  // 实参顺序：先读 op2 到 v4、再读 op1 到 v2，然后 (v2, v4, v5, v6, v7)
  assert.match(b, /sub_49A870\(_this \+ 80708, v2, v4, v5, v6, v7\)/);

  const callee = bodyOf('0049A870');
  assert.match(callee, /_this\[280\] \|= 2u/);
  assert.match(callee, /_this\[293\] = 0/);
  assert.match(callee, /_this\[295\] = a2/, 'op1 落 Scene[295]');
  assert.match(callee, /_this\[300\] = a3/, 'op2 落 Scene[300]');
  assert.match(callee, /j_D3DXMatrixScaling\(_this \+ 323/);
});

test('0x22F（sub_424330 raw 32087）：轴三条 float 不除；★被调体写 Scene+387 的 **Translation**（订正筛体的「Scaling」）', () => {
  const b = bodyOf('00424330');
  assert.equal((b.match(/sub_41C300/g) ?? []).length, 3, 'op3/4/5 三条 float（轴）');
  assert.ok(!/dbl_5201F0/.test(b), '轴分量不除（筛体亦同）');
  assert.equal((b.match(/sub_41BF50/g) ?? []).length, 2, 'op1/op2 是 int');
  assert.match(b, /sub_49A9C0\(_this \+ 80708, v2, v4, v5, v6, v7\)/);

  const callee = bodyOf('0049A9C0');
  // ★这两条断言就是「以体订正筛体」的核心：筛体说 +323/Scaling，体是 +387/Translation
  assert.match(callee, /j_D3DXMatrixTranslation\(_this \+ 387/);
  assert.ok(!/j_D3DXMatrixScaling/.test(callee), '0x22F 的被调体里不得出现 D3DXMatrixScaling（那是 0x22D 的 sub_49A870）');
  assert.match(callee, /_this\[297\] = a2/, 'op1 落 Scene[297]');
  assert.match(callee, /_this\[302\] = a3/, 'op2 落 Scene[302]');
});

test('0x1C4（sub_42E8A0 raw 38773）：读的是 **语音对象**（Engine+84128）的总线查询，不是 Scene 绘制项', () => {
  const b = bodyOf('0042E8A0');
  assert.match(b, /sub_404CB0\(\(int \*\*\)\(_this \+ 84128\)\)/, '取的是 +84128（语音对象），不是 +80708（Scene）');
  assert.ok(!/80708/.test(b), '★体内不得出现 Scene 基址 80708（订正筛体「场景层里是否已挂项」）');
  assert.match(b, /sub_42B4B0\(_this, 1, v2 != 0\)/, 'op1 = (v2 != 0) 的布尔');

  // 被调体：3 通道 + 设备判据（这是「语音总线」的证据，不是绘制项存在性）
  const callee = bodyOf('00404CB0');
  assert.match(callee, /_this\[258\]/, '总线持有设备/容器指针（槽 258）');
  assert.match(callee, /\(\*i & 3\) == 3/, '「该通道已挂设备」判据（flags & 3 == 3）');
  assert.match(callee, /sub_4B6130\(_this\[258\], v3 \+ 12\)/, '「设备在播」判据');
  assert.match(callee, /v3 >= 3/, '只查前 3 个通道');
});

test('0x23A（sub_4306F0 raw 39990）：op2 → Engine[+91322] 表，取到对象后读其 +1068 布尔；缺项回 0', () => {
  const b = bodyOf('004306F0');
  assert.match(b, /_this\[sub_41BF50\(_this, 2\) \+ 91322\]/, 'op2 是表下标，表基址 = Engine[91322]');
  assert.match(b, /_this\[30 \* _this\[95776\] \+ 95805\] = 5/);
  assert.match(b, /\*\(_DWORD \*\)\(v2 \+ 1068\) != 0/, '对象 +1068 的布尔');
  assert.match(b, /sub_42B4B0\(\(int\)_this, 1, 0\)/, '缺项 ⇒ op1 = 0 的失败分支');

  // ★订正筛体：91322 与 94672 是两张不同的表（0x23E/0x23F 用后者 = L2D 实例槽表）
  const sibling = bodyOf('00430750');
  assert.match(sibling, /\+ 94672/, '同族的 0x23E 用 94672（另一张表）⇒ 两张表不得混同');
  assert.ok(!/91322/.test(sibling), '0x23E 不碰 91322');
});

test('0x22A/0x22C/0x22D/0x22F 的被调体是 Scene 变换族（与 0x1FD 的按 handle 定位**结构不同**）', () => {
  // Scene 变换族四条 ⇒ 调用点第一个实参恒为 `_this + 80708`（Scene 基址），且无 handle 参数
  for (const addr of ['00424080', '00424180', '004241F0', '00424330']) {
    const b = bodyOf(addr);
    assert.match(b, /\(int \*\*\)|_this \+ 80708/, `${addr} 应把 Scene(Engine+80708) 作为接收者`);
  }
  // 对照：0x1FD 的 handler 体内有 sub_41BF50 取 handle ⇒ 证明「Scene 级」与「项级」在体上可区分
  const op1fd = bodyOf('00422FD0');
  assert.match(op1fd, /sub_41BF50/, '0x1FD 是项级指令（op1 = handle）⇒ 体内必有 int 池取用');
});

// ---------------------------------------------------------------------------
// ② 口径棘轮：台账 disposition + 运行时注册表
// ---------------------------------------------------------------------------

interface GapEntry {
  opcode: number;
  mnemonic: string;
  disposition: string;
  note: string;
  ticket: string;
}
const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')) as { entries: GapEntry[] };
/** 四条 Scene 变换：本轮**已落地** ⇒ 必须 `implemented` + 真在 `OPS` 里。 */
const IMPLEMENTED = [0x22a, 0x22c, 0x22d, 0x22f] as const;
/** 两条仍**未实现**（理由见各自 note）⇒ 必须留 `deferred` 且不得进任何运行时表。 */
const DEFERRED = [0x1c4, 0x23a] as const;
const MINE = [...IMPLEMENTED, ...DEFERRED] as const;

test('★六条都必须在册、note 写清「体内真实行为 + 处置 + 消费者链/扩展点」（≥80 字）', () => {
  for (const op of MINE) {
    const e = ledger.entries.find((x) => x.opcode === op);
    assert.ok(e, `0x${op.toString(16)} 必须留在 opcode-gaps.json 里（不许静默消失）`);
    assert.ok(e.ticket, `0x${op.toString(16)} 必须带票`);
    assert.ok(
      (e.note ?? '').length >= 80,
      `0x${op.toString(16)} 的 note 必须写清体内行为 / 处置 / 消费者链（当前 ${(e.note ?? '').length} 字）`,
    );
    assert.match(e.note, /扩展点|消费者/, `0x${op.toString(16)} 的 note 必须给出消费者链或扩展点`);
  }
});

test('★四条 Scene 变换：台账 `implemented` **且**真在 `OPS` 里（不许只改台账字段）', () => {
  for (const op of IMPLEMENTED) {
    const e = ledger.entries.find((x) => x.opcode === op);
    assert.ok(e, `0x${op.toString(16)} 必须在册`);
    assert.equal(e.disposition, 'implemented', `0x${op.toString(16)} 本轮已落地 ⇒ 必须是 implemented`);
    assert.ok(OPS.has(op), `0x${op.toString(16)} 标 implemented ⇒ 必须真在 OPS 里（谎报会被这条抓住）`);
  }
});

test('★两条未实现（0x1C4/0x23A）仍 `deferred`，且不得出现在运行时三张表里', () => {
  for (const op of DEFERRED) {
    const e = ledger.entries.find((x) => x.opcode === op);
    assert.ok(e, `0x${op.toString(16)} 必须在册`);
    assert.equal(e.disposition, 'deferred', `0x${op.toString(16)} 本轮仍未实现`);
    assert.ok(!OPS.has(op), `0x${op.toString(16)} 标 deferred ⇒ 不得进 OPS`);
    assert.ok(!NATIVE_OPS.has(op), `0x${op.toString(16)} 标 deferred ⇒ 不得进 NATIVE_OPS`);
    assert.ok(
      !ENGINE_INTERNAL_OPS.has(op),
      `0x${op.toString(16)} 标 deferred ⇒ 不得进 ENGINE_INTERNAL_OPS（那是「有据 no-op」，不是 deferred）`,
    );
  }
});

test('★「未实现」清零：台账里不再有 unimplemented，且 deferred 全都带 note', () => {
  const unimpl = ledger.entries.filter((e) => e.disposition === 'unimplemented');
  assert.deepEqual(
    unimpl.map((e) => `0x${e.opcode.toString(16)}`),
    [],
    '本轮目标：unimplemented 清零（每条都要有据 implemented/deferred/engine-internal）',
  );
  for (const e of ledger.entries) {
    if (e.disposition === 'deferred') {
      assert.ok((e.note ?? '').length >= 40, `deferred 0x${e.opcode.toString(16)} 必须写 why（note ≥ 40 字）`);
    }
  }
});

test('★本轮订正过的语义要点必须留在台账 note 里（防回退到筛体旧说法）', () => {
  const note = (op: number): string => ledger.entries.find((e) => e.opcode === op)?.note ?? '';
  // 0x1C4：语音总线（订正「Scene 场景层里是否已挂项」）
  assert.match(note(0x1c4), /语音/, '0x1C4 的 note 必须写明是语音总线查询');
  assert.match(note(0x1c4), /84128/, '0x1C4 的 note 必须留 +84128 这个地址锚');
  // 0x22F：被调体是 Translation（订正筛体的 Scaling）
  assert.match(note(0x22f), /Translation/, '0x22F 的 note 必须写明被调体是 D3DXMatrixTranslation');
  // 0x22A：op1 不是 handle（真源里是「不是 handle」，这里只钉「不是 handle」这一语义）
  assert.match(note(0x22a), /不是 handle/, '0x22A 的 note 必须写明 op1 不是 handle');
  // 0x23A：91322 与 94672 是两张表
  assert.match(note(0x23a), /94672/, '0x23A 的 note 必须写明 91322/94672 是两张不同的表');
  // 四条 Scene 变换都要指向同一个消费者链（RenderScene 的 20..29 层）
  for (const op of IMPLEMENTED) {
    assert.match(note(op), /20\.\.29|\[20, ?30\)|20, ?30\)/, `0x${op.toString(16)} 的 note 应写明「只作用于 20..29 层」这一消费端事实`);
  }
});
