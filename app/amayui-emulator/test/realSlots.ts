/**
 * **真游戏槽/缩略图的定位（唯一实现）** —— `tickets/T-0128`。
 *
 * ## 为什么要有它
 *
 * 本机的**真存档槽只在 `overlay` 一侧**（`<LOCALAPPDATA>\Eushully\<游戏>\.overlay\SAVE\`），
 * `base` 目录**不存在**。而 7~9 处 "E4" 闸门把路径写成 `resolveSystemPaths(REPO).baseDir/SAVE`
 * ⇒ 这些本该是最硬一档的用例**在开发机上静默跳过**（`save-slot-chain` 2/2 全跳）。
 * `engine-slot.test.ts` 的 E4b 是当时**唯一**两侧都看的写法 —— 本模块就是把它抽出来、给所有站点共用。
 *
 * ## 契约
 *
 * - 目录顺序 **base → overlay**（同名以 base 优先，与 `NodeFileSource` 的读取优先级一致）；
 * - 返回值按 `name` 升序，确定性（同一台机器给同一序列）；
 * - 目录不存在或读不了 ⇒ 当"没有"，**不抛**（调用方据此 `t.skip`）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveSystemPaths } from '../src/arch/systemPaths.js';

export interface RealFile {
  /** 文件名（如 `SAVE79.DAT`）。 */
  name: string;
  /** 所在目录（绝对路径）。 */
  dir: string;
  /** 绝对路径。 */
  path: string;
}

/** 真槽的搜索目录：**base 与 overlay 两侧都看**（顺序即优先级）。 */
export function realSlotDirs(repoRoot: string): string[] {
  const system = resolveSystemPaths(repoRoot);
  return [path.join(system.baseDir, 'SAVE'), path.join(system.overlayDir, 'SAVE')];
}

/** 在两侧目录里找匹配 `kind`（`DAT`/`STH`）的 `SAVE\d\d.<kind>`；按名字升序、同名去重（先命中者胜）。 */
export function findRealFiles(repoRoot: string, kind: 'DAT' | 'STH'): RealFile[] {
  const seen = new Set<string>();
  const out: RealFile[] = [];
  for (const dir of realSlotDirs(repoRoot)) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((f) => new RegExp(`^SAVE\\d\\d\\.${kind}$`).test(f)).sort();
    } catch {
      names = [];
    }
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, dir, path: path.join(dir, name) });
    }
  }
  return out;
}

/** 第一个真槽/缩略图；没有 ⇒ `null`（调用方 `t.skip`）。 */
export function firstRealFile(repoRoot: string, kind: 'DAT' | 'STH'): RealFile | null {
  return findRealFiles(repoRoot, kind)[0] ?? null;
}

/** `SAVE78.DAT` → `78`（槽号；`0x1A1` 的 op2 用它选槽）。 */
export function slotNumberOf(name: string): number {
  const m = /^SAVE(\d\d)\.(?:DAT|STH)$/.exec(name);
  if (!m) throw new Error(`不是槽文件名：${name}`);
  return Number(m[1]);
}

/** 读一份真文件的字节（调用方负责先 `firstRealFile`）。 */
export function readReal(file: RealFile): Uint8Array {
  return new Uint8Array(fs.readFileSync(file.path));
}
