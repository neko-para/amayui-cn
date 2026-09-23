/**
 * **测试分类的组织规则（单一实现）** —— 由 `test/run.ts`（执行入口）与
 * `test/organization.test.ts`（守卫）共用，禁止两处各写一份。
 *
 * 分类法见 `docs-new/04-app/test-organization.md`：三个轴 + 一条文件头声明。
 *
 * ```
 * /** @tier T0 @kind core @subsystem vm *\/
 * ```
 *
 * | 轴 | 取值 | 回答 |
 * |---|---|---|
 * | `tier` | `T0` 默认档（纯合成）/ `T1` 真资产档（依赖未入库资源）/ `T2` 真机档（Electron） | **什么时候必须跑** |
 * | `kind` | `core` 行为守卫 / `ratchet` 防漂移棘轮 / `tool` 工具与宿主管线 | **红了意味着什么** |
 * | `subsystem` | `frame`/`vm`/`ops`/`adv`/`text`/`render`/`texture`/`transition`/`l2d`/`save`/`audio`/`config`/`input`/`host`/`ledger`/`tool` | **去哪找** |
 *
 * ★**为什么不把 `evidence`（E0–E4）也放进声明**：那是**每条引擎能力**的属性，已经活在
 * `analysis/engine-capabilities.json` 的 `emulator.evidence` 里（并有守卫校验）。按测试文件再记一份
 * 就是**第二个真源**，必然漂移。本模块只回答"怎么跑 / 红了算什么 / 在哪"，不回答"判据有多硬"。
 *
 * ★**为什么不移动文件**：实测移动 40 个 T1 文件会打断 **924 处**跨台账/文档引用
 * （其中 183 处在 `analysis/engine-capabilities.json` 这类机器真源里）。分类必须**可机械校验**，
 * 而机械校验不依赖目录位置 ⇒ 用文件头声明 + 本模块的规则。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const TIERS = ['T0', 'T1', 'T2'] as const;
export type Tier = (typeof TIERS)[number];

export const KINDS = ['core', 'ratchet', 'tool'] as const;
export type Kind = (typeof KINDS)[number];

export const SUBSYSTEMS = [
  'frame', 'vm', 'ops', 'adv', 'text', 'render', 'texture', 'transition',
  'l2d', 'save', 'audio', 'config', 'input', 'host', 'ledger', 'tool',
] as const;
export type Subsystem = (typeof SUBSYSTEMS)[number];

export interface Pragma {
  tier: Tier;
  kind: Kind;
  subsystem: Subsystem;
  line: number;
}

const PRAGMA_RE = /@tier\s+(T\d)\s+@kind\s+([a-z]+)\s+@subsystem\s+([a-z0-9]+)/;

/** 语料装载器：import 了就一定依赖**未入库**的真游戏资源（`install/` 或 `raw/`）。 */
export const CORPUS_LOADERS = [
  'nodeFileSource', 'loadScriptData', 'runGameStartChain', 'runConfig1Chain',
  'scenarioBoot', 'resolveResourceDir', 'decideResourceDir', 'config1Chain', 'systemPaths',
];

/**
 * 真资产**路径字面量**：必须是一个"整串就是资源目录名（或它下面的路径）"的字符串字面量。
 * 这样 `'raw operand'`、注释里的 `raw 12345`（反编译行号）都不会误命中。
 */
const ASSET_LITERAL = new RegExp(
  [
    String.raw`(['"])(?:\.\.\/|\/)*(?:install|raw-parts|raw)(?:[\\/][^'"\n]*)?\1`,
    String.raw`(['"])[^'"\n]*\.tmp[\\/]appdata`,
    String.raw`process\.env\.AMAYUI_RESOURCE_DIR`,
  ].join('|'),
);

/** 粗粒度去注释（够用即可：用于"注释里的 raw 12345 不算证据"）。 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
}

/** 读文件头的分类声明；缺声明或取值非法 ⇒ 返回 `null`（由调用方报问题）。 */
export function readPragma(src: string): Pragma | null {
  const m = PRAGMA_RE.exec(src);
  if (!m) return null;
  const tier = m[1] as Tier;
  const kind = m[2] as Kind;
  const subsystem = m[3] as Subsystem;
  if (!TIERS.includes(tier) || !KINDS.includes(kind) || !SUBSYSTEMS.includes(subsystem)) return null;
  const line = src.slice(0, m.index).split('\n').length;
  return { tier, kind, subsystem, line };
}

/** 该文件里"依赖未入库真资产"的**机械证据**（返回人类可读的条目；空 = 无证据）。 */
export function corpusEvidence(src: string): string[] {
  const hits: string[] = [];
  const importText = src
    .split('\n')
    .filter((l) => /^\s*import\b/.test(l) || /^\s*\} from\b/.test(l))
    .join('\n');
  for (const k of CORPUS_LOADERS) {
    if (new RegExp(String.raw`\b${k}\b`).test(importText)) hits.push(`import:${k}`);
  }
  const body = stripComments(src);
  if (ASSET_LITERAL.test(body)) hits.push('asset-path');
  return hits;
}

/** ★假绿形态①：`console.warn('[skip]…')` 之后裸 `return;`，不调 `t.skip()` ⇒ node:test 记 pass（零断言）。 */
export function silentSkipReturns(src: string): number[] {
  const lines = src.split('\n');
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/console\.(warn|log)\(\s*['"`]\[skip\]/.test(lines[i]!)) continue;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      if (/^\s*return\s*;/.test(lines[j]!)) { out.push(i + 1); break; }
    }
  }
  return out;
}

export interface TestFile {
  /** 相对 `test/` 的文件名，例如 `config1-chain.test.ts`。 */
  name: string;
  abs: string;
  src: string;
  pragma: Pragma | null;
}

export function scanTests(testDir: string): TestFile[] {
  return readdirSync(testDir)
    .filter((f) => f.endsWith('.test.ts'))
    .sort()
    .map((f) => {
      const src = readFileSync(path.join(testDir, f), 'utf8');
      return { name: f, abs: path.join(testDir, f), src, pragma: readPragma(src) };
    });
}

export interface Problem {
  file: string;
  rule: 'R1-pragma' | 'R2-tier' | 'R3-silent-skip';
  detail: string;
}

/** 三条硬规则（守卫与 `run.ts check` 共用同一份实现）。 */
export function checkOrganization(files: TestFile[]): Problem[] {
  const problems: Problem[] = [];
  for (const f of files) {
    // R1：必须声明齐全且取值合法
    if (!f.pragma) {
      problems.push({ file: f.name, rule: 'R1-pragma', detail: '缺少或非法的分类头（应为首行的 `/** @tier T? @kind ? @subsystem ? */`）' });
    } else if (f.pragma.tier === 'T0') {
      // R2：默认档**不得**依赖未入库真资产（这是"哪天在干净 clone / CI 上跑"的判据）
      const ev = corpusEvidence(f.src);
      if (ev.length) {
        problems.push({
          file: f.name, rule: 'R2-tier',
          detail: `声明 T0 但有真资产证据 [${ev.join(', ')}] ⇒ 应改声明为 T1（或在真正需要它时留在 T1）`,
        });
      }
    }
    // R3：不许零断言空跑
    const silent = silentSkipReturns(f.src);
    if (silent.length) {
      problems.push({
        file: f.name, rule: 'R3-silent-skip',
        detail: `第 ${silent.join('/')} 行是「console.warn('[skip]…') + 裸 return」⇒ node:test 会记为 pass（零断言）。改用 \`t.skip()\`（回调记得接 t）`,
      });
    }
  }
  return problems;
}

/** 按三轴聚合（供 `run.ts list` 打印索引树）。 */
export function groupByAxis(files: TestFile[]): {
  byTier: Record<string, TestFile[]>;
  bySubsystem: Record<string, TestFile[]>;
  byKind: Record<string, TestFile[]>;
} {
  const byTier: Record<string, TestFile[]> = {};
  const bySubsystem: Record<string, TestFile[]> = {};
  const byKind: Record<string, TestFile[]> = {};
  for (const f of files) {
    const t = f.pragma?.tier ?? '(未声明)';
    const s = f.pragma?.subsystem ?? '(未声明)';
    const k = f.pragma?.kind ?? '(未声明)';
    (byTier[t] ??= []).push(f);
    (bySubsystem[s] ??= []).push(f);
    (byKind[k] ??= []).push(f);
  }
  return { byTier, bySubsystem, byKind };
}
