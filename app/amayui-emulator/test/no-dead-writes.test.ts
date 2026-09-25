/** @tier T0 @kind ratchet @subsystem ledger */

/**
 * **闸门 C 的回归测试**：死写 ratchet。
 *
 * 规则：`dead-writes.baseline.json` 里登记过的死写不算失败（它们是已记录的能力缺口），
 * **新增**死写则测试失败 —— 逼实现者二选一：给它接上消费者，或登记进基线并写清理由。
 *
 * 这条测试是针对一类**完全无报错**的缺陷设的闸：
 * "字段写进了模型、VM 也正常推进、日志一切正常，但渲染器从来不读它 ⇒ 效果就是不出现"。
 *
 * ## ★覆盖面（`tickets/T-0150`）
 * 扫描面从 `drawitem/model.ts` 的 `Item`/`MeshObj` 扩到 `Engine`（`src/vm/engine.ts` 的 class，
 * 含构造函数参数属性）、`SceneState`（含嵌套的 `SceneState.render4`）、`SceneXform`、`TextFrame`
 * —— 见 `src/tools/deadWrites.ts` 的 `SCOPES`。本文件的第 4 条用例把"扩面真的生效"钉死
 * （`Engine`/`SceneState` 各至少扫到 N 个字段）。
 *
 * ## ★加基线的规矩（`tickets/T-0150` 起强制执行）
 * 往 `dead-writes.baseline.json` 的 `known[]` 加一条，**必须**同时：
 *  1. 在 `reason[<id>]` 写清"谁是它唯一的读者、为什么那不算消费者"（≥20 字，否则判不合格）；
 *  2. 在 `tickets[<id>]` 写承接票号（`T-0150` 这种；确实没有票就写 `"none"` 并在 reason 里说明）。
 * 缺任一项 ⇒ 第 5 条用例失败、`npm run check:dead-writes` 也 exit 1（`auditBaseline()` 同一套判据）。
 * 为什么要这么严：基线是**棘轮的豁免名单**，一句"已知"就等于永久静音 —— 必须留下可复核的依据。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditBaseline, findDeadWrites, formatReport, loadBaseline, ratchet } from '../src/tools/deadWrites.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const BASELINE = path.join(APP_ROOT, 'dead-writes.baseline.json');

test('死写 ratchet：不得新增「写了但没人读」的模型字段', () => {
  const report = findDeadWrites(APP_ROOT);
  const base = loadBaseline(BASELINE);

  assert.ok(report.alive.length + report.dead.length > 20, `应扫到足量字段（实际 ${report.alive.length + report.dead.length}）`);

  const { added } = ratchet(report, base);
  assert.deepEqual(
    added.map((d) => d.id),
    [],
    `新增死写字段（写了但没有消费者）——请接上消费者，或登记进 dead-writes.baseline.json 并说明理由：\n${formatReport(report, base)}`,
  );
});

test('死写检测自身有效：合成模型里"只写不读"的字段必须被报出来', () => {
  // ★2026-09（`tickets/T-0017`）：这条原来断言"真实模型里的 `Item.blend` 应被判为死写" ——
  //   `T-0017` 给它接上消费者（场景混合状态机）之后基线清空，那条断言自然失效。
  //   改成**合成输入**：检测能力不该依赖"真实模型里恰好还有一个死写字段"。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-writes-'));
  try {
    fs.mkdirSync(path.join(dir, 'src', 'renderer', 'drawitem'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'renderer', 'drawitem', 'model.ts'),
      'export interface Item {\n  onlyWritten: number;\n  consumed: number;\n}\n',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'renderer', 'consumer.ts'),
      'export const x = { onlyWritten: 1, consumed: 2 };\nexport const y = x.consumed;\n',
    );
    const report = findDeadWrites(dir, ['src/renderer/drawitem/model.ts', 'src/renderer/consumer.ts']);
    const ids = report.dead.map((d) => d.id);
    assert.ok(ids.includes('Item.onlyWritten'), `只写不读的字段应被判为死写（实际死写：${ids.join(' ') || '无'}）`);
    assert.ok(!ids.includes('Item.consumed'), '有消费者的字段不能被误判');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * ★**注释/字符串里的字段名不算"读"**（`tickets/T-0039`）。
 *
 * 复现的现场：在 `src/renderer/drawitem/model.ts` 的文档注释里写一句「见 MeshObj.blend」，
 * `npm run check:dead-writes` 立刻把两个**已登记的能力缺口**报成"已修"（dead → alive）——
 * 报告与 `fixed` 列表一起失真，而"没有反向断言"的字段从此可以被一句注释静默洗白。
 * 修法：`stripCommentsAndStrings` 在统计前剥掉 `//`/块注释（含文档注释）与字符串字面量内容。
 */
test('死写检测对注释/字符串免疫：注释里提到字段名，不改变读数', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-writes-comment-'));
  try {
    fs.mkdirSync(path.join(dir, 'src', 'renderer', 'drawitem'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'renderer', 'drawitem', 'model.ts'),
      'export interface Item {\n  onlyWritten: number;\n}\n',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'renderer', 'consumer.ts'),
      [
        'export const x = { onlyWritten: 1 };',
        '/** 说明：这里**不**消费 {@link Item.onlyWritten}（文档注释） */',
        '// 行注释里提到 x.onlyWritten 也不算读',
        "export const msg = 'log: x.onlyWritten 未消费';",
        "export const url = 'http://example.com/x.onlyWritten';",
        'export const y = x.onlyWritten; // ← 唯一真读（下面断言靠它做对照）',
      ].join('\n'),
    );
    const report = findDeadWrites(dir, ['src/renderer/drawitem/model.ts', 'src/renderer/consumer.ts']);
    const entry = [...report.alive, ...report.dead].find((d) => d.id === 'Item.onlyWritten');
    assert.ok(entry, '字段应被扫到');
    assert.equal(entry!.reads, 1, `只有代码里的那一次访问算读（注释/字符串都不算），实际 ${entry!.reads}`);

    // 反面：把**唯一**那次真读也改成注释 ⇒ 必须回到"死写"
    fs.writeFileSync(
      path.join(dir, 'src', 'renderer', 'consumer.ts'),
      ['export const x = { onlyWritten: 1 };', '// x.onlyWritten 只出现在注释里'].join('\n'),
    );
    const report2 = findDeadWrites(dir, ['src/renderer/drawitem/model.ts', 'src/renderer/consumer.ts']);
    assert.ok(
      report2.dead.map((d) => d.id).includes('Item.onlyWritten'),
      `注释不算读 ⇒ 该字段必须是死写（实际死写：${report2.dead.map((d) => d.id).join(' ') || '无'}）`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * ★**扩面生效**（`tickets/T-0150`）：闸门必须真的扫到 `Engine`/`SceneState` 的字段。
 *
 * 为什么单独一条：修前 `findDeadWrites` 只解析 `export interface Item|MeshObj`，
 * 而审计 `missing-consumer` 类 finding 大多落在 `Engine`/`SceneState`/文本对象上 ——
 * 闸门看不见就永远不会红（这是本票要修的结构性缺口）。这条用**真实模型**钉住覆盖面，
 * 顺带把"字段解析器认不认 class / 嵌套对象类型"这件事变成可失败的断言。
 */
test('死写检测覆盖面：Engine / SceneState / 嵌套 render4 / TextFrame 都必须被扫到', () => {
  const report = findDeadWrites(APP_ROOT);
  const ids = [...report.alive, ...report.dead].map((d) => d.id);
  const inScope = (prefix: string): number => ids.filter((id) => id.startsWith(prefix + '.')).length;
  assert.ok(inScope('Engine') >= 30, `Engine 字段应被扫到（实际 ${inScope('Engine')} 个）`);
  assert.ok(inScope('SceneState') >= 15, `SceneState 字段应被扫到（实际 ${inScope('SceneState')} 个）`);
  assert.ok(
    inScope('SceneState.render4') >= 10,
    `★嵌套对象类型 render4 的字段也要被扫到（实际 ${inScope('SceneState.render4')} 个）`,
  );
  assert.ok(inScope('TextFrame') >= 5, `文本对象 TextFrame 字段应被扫到（实际 ${inScope('TextFrame')} 个）`);
  assert.ok(inScope('SceneXform') >= 5, `SceneXform 字段应被扫到（实际 ${inScope('SceneXform')} 个）`);
  // 消费方识别：`Engine` 的消费者散落在 vm/宿主，"扫面必须覆盖到它们"才算数
  assert.ok(
    report.files.length >= 100,
    `扫描面必须覆盖 src/** 的消费者（实际只扫了 ${report.files.length} 个文件）`,
  );
});

/**
 * ★**容器型字段的变更方法算"写"**（`tickets/T-0150`）。
 *
 * 复现的现场：`Engine.texSlotFlags`（引擎 `0x258` 写 / `0x259` 整表清）体内**全是**
 * `map.set(...)` / `map.clear()` —— 修前 `countAccess` 只把 `.field = …` 与对象字面量键当写，
 * 于是这个字段的 `writes` 恒为 0，**永远不进死写列表**（闸门对 Map/Set/Array 型字段等于瞎的）。
 * 修法：`MUTATING_METHODS` 里的方法名出现在 `.field.` 之后即计一次写。
 */
test('死写检测自身有效：容器变更方法（`.set` / `.clear` / `.push`）算"写"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-writes-mutator-'));
  try {
    fs.mkdirSync(path.join(dir, 'src', 'model'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'model', 'm.ts'), 'export interface Engine {\n  flags: Map<number, number>;\n}\n');
    fs.writeFileSync(
      path.join(dir, 'src', 'model', 'writer.ts'),
      ['export function w(e: Engine): void {', '  e.flags.set(1, 2);', '  e.flags.clear();', '}'].join('\n'),
    );
    const report = findDeadWrites(dir, ['src/model/m.ts', 'src/model/writer.ts'], [
      { scope: 'Engine', type: 'Engine', file: 'src/model/m.ts', kind: 'interface' },
    ]);
    const ids = report.dead.map((d) => d.id);
    assert.ok(
      ids.includes('Engine.flags'),
      `只有 .set()/.clear() 的字段必须被判为死写（否则 Map 型字段永远逃过闸门）；实际死写：${ids.join(' ') || '无'}`,
    );
    const entry = report.dead.find((d) => d.id === 'Engine.flags');
    assert.ok((entry?.writes ?? 0) >= 2, `两次变更方法各算一次写（实际 ${entry?.writes}）`);

    // 反面：加一个真读者 ⇒ 必须回到 alive（证明上一步不是"什么都判死写"）
    fs.writeFileSync(
      path.join(dir, 'src', 'model', 'writer.ts'),
      ['export function w(e: Engine): void {', '  e.flags.set(1, 2);', '  if (e.flags.get(1)) return;', '}'].join('\n'),
    );
    const report2 = findDeadWrites(dir, ['src/model/m.ts', 'src/model/writer.ts'], [
      { scope: 'Engine', type: 'Engine', file: 'src/model/m.ts', kind: 'interface' },
    ]);
    assert.ok(
      !report2.dead.map((d) => d.id).includes('Engine.flags'),
      '有 .get() 读者之后不该再判死写（那会变成"见谁都报"的噪声）',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * ★**消费方识别**（`tickets/T-0150`）：跨 scope 的同名字段不许互相洗白/误杀。
 *
 * 复现的现场：`Engine.key` 与别的模型的 `key`/`handle` 之类同名字段在全仓到处都是；
 * 只按"字段名出现过就算有人读"统计，会把 `Engine.key` 这种真死写洗成 alive。
 * 判据靠**类型注解线索**（`e: Engine`）与"这个接收者被本 scope 的别的字段用过没有"。
 */
test('死写检测自身有效：别的 scope 的同名字段不算消费者（跨 scope 同名不洗白）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-writes-collide-'));
  try {
    fs.mkdirSync(path.join(dir, 'src', 'model'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'model', 'm.ts'),
      [
        'export interface Item {',
        '  key: number;',
        '  handle: number;',
        '}',
        'export interface Engine {',
        '  key: number;',
        '  handle: number;',
        '}',
      ].join('\n'),
    );
    // `e` 被注解成 Engine ⇒ `e.key` 只能是 Engine.key 的读，不许把 Item.key 洗活
    fs.writeFileSync(
      path.join(dir, 'src', 'model', 'consumer.ts'),
      [
        'import type { Engine } from "./m.js";',
        'export function f(e: Engine): number {',
        '  e.key = 1;',
        '  return e.key + e.handle;',
        '}',
      ].join('\n'),
    );
    const scopeSpecs = [
      { scope: 'Item', type: 'Item', file: 'src/model/m.ts', kind: 'interface' as const },
      { scope: 'Engine', type: 'Engine', file: 'src/model/m.ts', kind: 'interface' as const },
    ];
    const report = findDeadWrites(dir, ['src/model/m.ts', 'src/model/consumer.ts'], scopeSpecs);
    const dead = report.dead.map((d) => d.id);
    assert.ok(
      dead.includes('Item.key'),
      `\`e: Engine\` 的 \`e.key\` 不许算作 Item.key 的消费者（实际死写：${dead.join(' ') || '无'}）`,
    );
    assert.ok(!dead.includes('Engine.key'), 'Engine.key 有 `e.key` 读者 ⇒ 不许误判死写');

    // 反面：接收者没有类型注解，但被同 scope 的**别的**字段用过（`x.handle`）⇒ 保守算消费者
    fs.writeFileSync(
      path.join(dir, 'src', 'model', 'consumer.ts'),
      ['export function f(x: unknown): number {', '  return x.key + x.handle;', '}'].join('\n'),
    );
    const report2 = findDeadWrites(dir, ['src/model/m.ts', 'src/model/consumer.ts'], scopeSpecs);
    assert.ok(
      !report2.dead.map((d) => d.id).includes('Item.key'),
      `无注解但被同 scope 别的字段用过的接收者 ⇒ 保守算消费者（实际死写：${report2.dead.map((d) => d.id).join(' ') || '无'}）`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * ★**基线本身要体检**（`tickets/T-0150`）：加基线必须写 `reason`（为什么暂时是死写）与
 * `tickets`（承接票号，没有就 `none`）。`npm run check:dead-writes` 的 `auditBaseline()` 用同一套判据。
 */
test('基线登记规矩：每条 known 都必须有 reason（≥20 字）与 tickets（无票写 none）', () => {
  const base = loadBaseline(BASELINE);
  const problems = auditBaseline(base);
  assert.deepEqual(problems, [], `基线登记不合格：\n  - ${problems.join('\n  - ')}`);

  // 反向自检：把 reason/tickets 各打掉一个 ⇒ 体检必须报出来（否则这条断言是"永远绿"的摆设）
  const first = base.known[0];
  if (first !== undefined) {
    const broken = { known: [first], reason: {}, tickets: {} };
    const found = auditBaseline(broken);
    assert.equal(found.length, 2, `缺 reason 与 tickets 必须各报一条（实际 ${found.length} 条：${found.join(' / ')}）`);
    const tooShort = { known: [first], reason: { [first]: '已知' }, tickets: { [first]: 'none' } };
    assert.ok(
      auditBaseline(tooShort).some((p) => p.includes('reason 太短')),
      '一句"已知"必须被判成不合格（基线是棘轮的豁免名单，不许静默）',
    );
  }
});
