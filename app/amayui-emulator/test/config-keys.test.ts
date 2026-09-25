/** @tier T0 @kind core @subsystem config */

/**
 * **配置键单一真源的守卫**（`tickets/T-0057` R1）。
 *
 * 为什么需要它：`cfgInt(cfg, 'set:keepmusicvoice')` 这类**手打键名**拼错时**不会报错** ——
 * 只是永远读不到值、静默走 fallback。实测三个键就是这么错的（raw 里 0 次）：
 * `set:keepmusicvoice` / `set:cancelmessagekey` / `set:controldisibiecursor`，
 * 而真键（`set:KeepMusicVolume` / `set:CancelMesSkipOnClick` / `set:ControlDisibleCursor`）
 * 一直躺在权威键表 `configRegistry.ts` 里没人用。症状是"BGM 在语音前不让路 / 取消键三态机不生效"
 * 这类**不报错、只表现不对**的行为。
 *
 * 守卫口径：扫 `src/**` 里出现的 `section:key` 字面量（**先剥注释** —— 否则一句文档注释就能让它失效，
 * 这正是 `T-0039` 在死写棘轮上踩过的坑），每个都必须在
 * `CONFIG_REGISTRY_KEYS` ∪ `DYNAMIC_INI_KEY_PATTERNS` ∪ 显式 EXEMPT（带理由）里。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG, CONFIG_REGISTRY_DEFAULTS, CONFIG_REGISTRY_KEYS, DYNAMIC_INI_KEY_PATTERNS, isRegistryKey } from '../src/configRegistry.js';
import { cfgBool, cfgEquals, cfgInt, parseIni } from '../src/engineConfig.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');

/** 非 INI 键、但长得像 `section:key` 的字面量（每条必须写清为什么不是配置键）。 */
const EXEMPT: readonly string[] = [
  // `tools/live2dMoc.ts` 的统计标签（`stats.dist('drawData:textureNo', …)`），不是 INI 键。
  'drawData:textureNo',
];

/** 剥掉 `//` 行注释与 `/* … *​/` 块注释（字符串里的 `//` 不处理：本仓没有这种键）。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('src 里的每个配置键字面量都必须在权威键表（或动态键白名单/显式豁免）里', () => {
  const files = walk(SRC).filter((f) => !f.endsWith(`${path.sep}configRegistry.ts`));
  const offenders: string[] = [];
  const re = /'([a-z][a-zA-Z0-9]*:[A-Za-z0-9_]+)'/g;
  for (const f of files) {
    const text = stripComments(fs.readFileSync(f, 'utf8'));
    for (const m of text.matchAll(re)) {
      const key = m[1]!;
      if (key.startsWith('node:')) continue; // Node 内建模块说明符（不是 INI 键）
      if (isRegistryKey(key)) continue;
      if (DYNAMIC_INI_KEY_PATTERNS.some((p) => p.test(key.toLowerCase()))) continue;
      if (EXEMPT.includes(key)) continue;
      offenders.push(`${path.relative(SRC, f)}: ${key}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    '配置键不在权威键表里（手打键名拼错不会报错，只会恒读 fallback —— 请改用 configRegistry 的 CFG.*）',
  );
});

test('CFG 的每一项都在键表里，且三个幽灵键不再出现', () => {
  const known = new Set(CONFIG_REGISTRY_KEYS.map((k) => k.key.toLowerCase()));
  for (const [name, key] of Object.entries(CFG)) {
    assert.ok(known.has(key.toLowerCase()), `CFG.${name} = ${key} 不在 CONFIG_REGISTRY_KEYS`);
  }
  for (const phantom of ['set:keepmusicvoice', 'set:cancelmessagekey', 'set:controldisibiecursor']) {
    assert.ok(!known.has(phantom), `${phantom} 不应出现在权威键表里（raw 里不存在）`);
    assert.ok(!Object.values(CFG).map((k) => k.toLowerCase()).includes(phantom), `CFG 里不应有幽灵键 ${phantom}`);
  }
});

test('cfgBool / cfgEquals 的语义：非 0 vs 精确相等', () => {
  const cfg = parseIni(['[set]', 'KeepMusicVolume=2', 'CancelMesSkipOnClick=1', 'DrawMode=0'].join('\r\n'));
  // 引擎对 KeepMusicVolume 的判据是 `== 1`（raw 29769）⇒ 值 2 不算"开"。
  assert.equal(cfgEquals(cfg, CFG.soundKeepMusicVolume, 1), false, '2 != 1');
  assert.equal(cfgEquals(cfg, CFG.soundKeepMusicVolume, 2), true);
  assert.equal(cfgBool(cfg, CFG.soundKeepMusicVolume, false), true, 'cfgBool 是"非 0"口径');
  assert.equal(cfgInt(cfg, CFG.soundKeepMusicVolume, -1), 2);
  assert.equal(cfgInt(cfg, CFG.setWheelKeyDown, -1), -1, '缺键 ⇒ fallback');
  assert.equal(cfgEquals(cfg, CFG.setDrawMode, 0), true);
});

/**
 * ★**权威键表自身不得有重复 key**（`tickets/T-0161` 读体时发现的在飞缺陷）。
 *
 * 为什么这是**静默**缺陷（两个消费点方向**相反**）：
 *  1. `CONFIG_REGISTRY_DEFAULTS = new Map(CONFIG_REGISTRY_KEYS.map(...))` ⇒ **后写者胜**
 *     （`registryDefault()` 拿到靠后那条的 `def`）；
 *  2. `engineConfig.ts` 的 `formatIni()` 用 `seen` 去重 ⇒ 写进 INI 的是**先出现那条**的 `def`；
 *  3. 外加表头声明的契约「顺序 = `sub_491880` 构造顺序」也被重复项破坏。
 * ⇒ 同一个"内建默认值"在同一份表里给出**两个答案**，谁都不报错。
 * 实测形态：`set:DependMovieSound` 被加了第二条（sound 段，`def: 0`），原条目是 `def: 1`
 * ⇒ 新玩家首跑的 INI 得到 0、而 `registryDefault()` 返回 1。
 * 引擎真值：raw 111734-111735 `v13 = 1; sub_434D00(v2, aSetDependmovie, &v13);`（注册顺序 = raw 111728-111739：
 * TexHeight → CreateObject → DrawMode → DependMovieSound → WheelKeyUp → WheelKeyDown）⇒ 只应保留 `def: 1`。
 *
 * 第二条判据（`size === length`）抓"Map 静默去重"这一形态：即使将来重复项写成不同大小写
 * （查询一律小写、Map 键也是小写）⇒ size 一样会变小。
 */
test('权威键表不得有重复 key（Map 后写者胜 vs formatIni 先写者胜 = 默认值静默分叉）', () => {
  const seen = new Map<string, number>();
  for (const { key } of CONFIG_REGISTRY_KEYS) {
    const k = key.toLowerCase(); // 键表语义大小写不敏感（查询统一小写）
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dupes = [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`);
  assert.deepEqual(
    dupes,
    [],
    `键表里有重复键（registryDefault 取靠后那条、formatIni 取靠前那条 ⇒ 内建默认值分叉；表头还声明"顺序=构造顺序"）：${dupes.join(' ')}`,
  );
  assert.equal(
    CONFIG_REGISTRY_DEFAULTS.size,
    CONFIG_REGISTRY_KEYS.length,
    'Map 化后条目数变少 ⇒ 有重复 key 被静默去重（后写者胜）',
  );
});
