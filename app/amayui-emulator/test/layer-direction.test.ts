/** @tier T0 @kind ratchet @subsystem render */

/**
 * **分层方向棘轮**（`tickets/T-0021` 的守卫）—— 把"A1 分层违规已消"变成可执行检查。
 *
 * ## 规则（为什么是这几条）
 * 依赖方向必须单向：`electron → src/*`；`src/vm → src/save → src/util`；`src/arch` 是**资源来源**层，
 * 它**不得**反向依赖 VM（否则"换资源来源"要动 VM，而且 `arch → vm → arch` 会成环）。
 * 历史实证：`arch/nodeFileSource.ts` 与 `electron/ipc/files.ts` 都 import 过 `vm/saveData.js`
 * （2026-09 的 A1 违规，见 `docs-new/04-app/emulator-refactor-plan.md` A1）；本守卫是那次搬移
 * （`vm/{saveData,saveSlot,crc32}.ts` → `save/`、`util/crc32.ts`）之后**防复发**的那一半。
 *
 * ## 判据
 *  - `src/arch/**` 与 `electron/**` 里**没有任何**指向 `…/vm/…` 的 import（`import`/`export … from`/动态 `import(`）；
 *  - `src/save/**` 是**叶子层**：不 import `vm/`、`arch/`、`renderer/`、`electron/`（只许 `util/` 与同层）；
 *  - 例外必须写进 `ALLOW` 并给理由 —— 空 = 现在一条例外都没有。
 *
 * ★只扫**代码里的 import**（剥掉注释与字符串）：`electron/ipc/files.ts` 的注释里提到过旧路径，
 *   那种"文档性引用"不该让守卫红（但也别把它当成允许的依赖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');

/** 明文例外：`文件 → 理由`。现在为空 —— 新增前先想清楚"这条依赖为什么非加不可"。 */
const ALLOW: Record<string, string> = {};

/** 递归收集 `.ts`（排除 `.d.ts` 与 node_modules/dist）。 */
function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, out);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** 剥注释与字符串：只留下可能承载 import 的代码行（保持行号）。 */
function codeLines(src: string): string[] {
  const out: string[] = [];
  for (const raw of src.split('\n')) {
    let line = raw;
    // 行注释（够用：import 语句不会出现在块注释中间；块注释行以 * 或 /* 开头，见下面的过滤）
    const slash = line.indexOf('//');
    if (slash >= 0) line = line.slice(0, slash);
    out.push(line);
  }
  return out;
}

/** 一行里出现的 import 说明符（静态 / 动态）。 */
function specifiers(line: string): string[] {
  const out: string[] = [];
  const stat = /\bfrom\s+['"]([^'"]+)['"]/g;
  const bare = /^\s*import\s+['"]([^'"]+)['"]/;
  const dyn = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = stat.exec(line))) out.push(m[1]!);
  const b = bare.exec(line);
  if (b) out.push(b[1]!);
  while ((m = dyn.exec(line))) out.push(m[1]!);
  return out;
}

function violations(dirAbs: string, forbidden: RegExp): string[] {
  const bad: string[] = [];
  for (const file of walk(dirAbs)) {
    const rel = path.relative(APP, file).replace(/\\/g, '/');
    if (ALLOW[rel]) continue;
    for (const [i, line] of codeLines(fs.readFileSync(file, 'utf8')).entries()) {
      for (const spec of specifiers(line)) {
        if (forbidden.test(spec)) bad.push(`${rel}:${i + 1} import '${spec}'`);
      }
    }
  }
  return bad;
}

test('★A1 棘轮：`src/arch/**` 与 `electron/**` 不得 import VM 层（`…/vm/…`）', () => {
  const bad = [...violations(path.join(APP, 'src/arch'), /(^|\/)vm\//), ...violations(path.join(APP, 'electron'), /(^|\/)vm\//)];
  assert.deepEqual(
    bad,
    [],
    `I/O 层反向依赖 VM（A1 违规复发；要新增就写进 ALLOW 并说明理由）：\n  ${bad.join('\n  ')}`,
  );
});

test('★A1 棘轮：`src/save/**` 是叶子层（不 import vm/arch/renderer/electron）', () => {
  const bad = violations(path.join(APP, 'src/save'), /(^|\/)(vm|arch|renderer|electron)\//);
  assert.deepEqual(bad, [], `存档格式层必须保持叶子（只依赖 util/）：\n  ${bad.join('\n  ')}`);
});

test('★A1 棘轮：没有文件再有指向旧路径的 import（`vm/saveData|saveSlot|crc32`）', () => {
  // 只扫**真实代码目录**（`src/`、`electron/`、`test/`）：`app/amayui-emulator/.tmp/` 是临时区
  // （gitignore；里面可能有旧会话留下的探针脚本，不属于本工程的分层面）。
  const bad = [
    ...violations(path.join(APP, 'src'), /(^|\/)vm\/(saveData|saveSlot|crc32)\.js$/),
    ...violations(path.join(APP, 'electron'), /(^|\/)vm\/(saveData|saveSlot|crc32)\.js$/),
    ...violations(path.join(APP, 'test'), /(^|\/)vm\/(saveData|saveSlot|crc32)\.js$/),
  ];
  assert.deepEqual(bad, [], `搬移后的旧路径仍在被 import：\n  ${bad.join('\n  ')}`);
});
