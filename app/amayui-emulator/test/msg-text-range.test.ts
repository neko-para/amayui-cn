/** @tier T0 @kind ratchet @subsystem adv */

/**
 * ★`tickets/T-0102`「ADV 窗口背景是白色」的**渲染侧判据**（2026-09，E4 日志归因到的那一条）。
 *
 * ## 症状与根因（都可复算）
 *
 * 用户实测：从 SN0000 进 SC 场景后 ADV 窗口区域是**白色**，开合侧边栏刷新一次才变正确。
 * 产品日志（`.tmp/amayui-emulator.log`）里的形状是：
 *
 * ```text
 * [call-script] 0x5258 -> LOADCONFIG.BIN (41 instr)
 * [present] item h=0x19a28 layer=105000 未绑定纹理槽 → 占位块
 * [present] item h=0x19a29 layer=105001 未绑定纹理槽 → 占位块      ← …共 28 条（12+ 行）
 * ```
 *
 * `0x19a28` = **105000** = `SYSTEM4.txt:69` 的 `i213 8 19a28 1f4` 给 win8 登记的正文行 id 起点
 * （区间 `[105000,105500)`）。引擎里那一批 id **就是文本行**（GDI 把字排进窗表面后按 id 贴出来），
 * 而 emulator 的文本另有载体（`textLayer` + `msgWins`）⇒ 这些 DrawItem 没有纹理槽，
 * 被 `presenter.#placeholder` 画成**纯白矩形** ⇒ 盖住整个 ADV 窗口。
 *
 * ## 本测试钉什么
 *
 *  1. 区间判据本身（`inMsgTextRange`）：命中/边界（左闭右开）/跨窗/`count<=0` 视为未登记；
 *  2. **源码棘轮**：`presenter.itemSprite` 必须在"无纹理槽"那一支上调用它并 `return null`
 *     （否则白块会回来，而症状只在真界面上看得见 ⇒ 必须有机器判据）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inMsgTextRange } from '../src/renderer/drawitem/msgTextRange.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/** 本作真实登记（`SYSTEM4.txt:57/58/69` 经 `0x213`/`0x25D`）：win1 正文 `[105000,105500)`、win1 注音 `[104300,104303)`。 */
const REAL = new Map<number, { base: number; count: number }[]>([
  [1, [{ base: 105000, count: 500 }, { base: 104300, count: 3 }]],
  [8, [{ base: 105000, count: 500 }]],
]);

test('★T-0102：消息窗正文区间判据（左闭右开、跨窗、count<=0 视为未登记）', () => {
  // ★每次传**新**迭代器：`Map.values()` 是一次性的（测试第一版就踩了这个 ⇒ 第二条断言起全落空）
  const hit = (h: number): boolean => inMsgTextRange(REAL.values(), h);
  assert.equal(hit(0x19a28), true, '行 0（= 用户日志里那个 handle）必须命中');
  assert.equal(hit(0x19a28 + 11), true, '第 11 行必须命中');
  assert.equal(hit(105000 + 499), true, '区间内最后一个 id 命中（左闭右开）');
  assert.equal(hit(105000 + 500), false, '区间右端**不在**内');
  assert.equal(hit(104300), true, '注音区间（win1 的 `i25d 1 1976c 3`）也要命中');
  assert.equal(hit(104303), false, '注音区间右端不在内');
  assert.equal(hit(0x19258), false, '普通图元（序章暗幕）不命中');
  assert.equal(
    inMsgTextRange([[{ base: 105000, count: 0 }]], 105000),
    false,
    '`count <= 0` = 未登记（引擎口径：`+108 <= 0` 视为没登记过）',
  );
});

test('★T-0102 源码棘轮：`itemSprite` 对"正文区间内且无纹理槽"的项必须跳过（不许画成白块）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/amayui-emulator/src/renderer/pixi/presenter.ts'), 'utf8');
  const at = src.indexOf('const { tex, imgid } = this.textures.resolve(it);');
  assert.ok(at > 0, '`itemSprite` 里应有一处 `textures.resolve(it)`');
  const seg = src.slice(at, at + 1400);
  assert.ok(
    /imgid === undefined && inMsgTextRange\(scene\.msgRanges\.values\(\), it\.handle\)/.test(seg),
    '必须在"无纹理槽"这一支上判消息窗正文区间',
  );
  assert.ok(/return null;/.test(seg), '命中后必须 `return null`（跳过 = 交给文本层画）');
  // 反向：这一支**不能**反过来影响有槽的项（否则正文/图片会被误吞）
  assert.ok(
    !/imgid !== undefined[\s\S]{0,80}inMsgTextRange/.test(seg),
    '判据只针对"没有纹理槽"的项',
  );
});
