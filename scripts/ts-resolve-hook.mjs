#!/usr/bin/env node
/**
 * ts-resolve-hook.mjs —— **让纯 node 直接跑本仓库的 `.ts`**（不依赖 tsx / esbuild / 任何构建产物）。
 *
 * ## 为什么需要它
 * Node ≥ 23.6 **自带类型剥离**（`--experimental-strip-types`，本机 v24.14 实测默认开），
 * 所以"跑一个 .ts 文件"本身不需要 tsx。**卡住的是模块解析**：本仓库的 import 全是 NodeNext 口径的
 * `../x/y.js`（磁盘上只有 `y.ts`），而 Node 的内建解析器**不做** `.js` → `.ts` 改写；
 * 本机 node 也没有 `--experimental-ts-module-resolution` 这类开关（`node --help` 里不存在）。
 *
 * ## 用法
 * ```bash
 * node --import ./scripts/ts-resolve-hook.mjs app/amayui-emulator/src/tools/saveDump.ts ".tmp/instances/<id>/base/SAVE/SAVE78.DAT"
 * ```
 * `--import` 的路径**相对 cwd**（上面这条要在仓库根跑；别处跑就给绝对路径或 `file://` URL）。
 *
 * ## 它做什么 / 不做什么
 * - **只**改写一种说明符：`./x.js`、`../x.js`（即"相对 + `.js` 结尾"）且**同名 `.ts` 文件存在** ⇒ 指向那个 `.ts`；
 * - package 名、真 `.js`、`.json`（本仓库那一处带 `with { type: 'json' }`）、`.node` 一律原样交给内建解析器；
 * - **同线程**（`module.registerHooks`）：不起 worker、**不起子进程**、不用管道 ⇒ 在受限沙箱里也能跑
 *   （`spawn` 的 `stdio:'pipe'` 在受限模式下是 EPERM，见 `AGENTS.md`；tsx 就是死在那里的）。
 *
 * ## 什么时候还得用 tsx / tsc
 * - 需要 esbuild 的**语法转换**（`enum` / `namespace` / 参数属性 / decorator）：原生剥离会拒。
 *   本仓库 `app/amayui-emulator/src/**` 实测 **0 处**，所以日常用不到；测试或未来代码若引入，就要 tsx 或 `--experimental-transform-types`。
 * - 需要 `npm run typecheck`（= `npx tsc --noEmit`，tsc 不起子进程 ⇒ 受限 shell 下也能跑）。
 * - 需要**落盘产物**：`npx tsc -p tsconfig.json --outDir <dir>`（同样不起子进程）。
 *
 * 出处：`tickets/T-0192`（受限 shell 下 `slotFingerprint` 的 tsx 子进程被 EPERM 卡死）+
 * `AGENTS.md`「跑 TypeScript」节。
 */
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 已改写过的说明符（打一行 stderr 便于归因；同样的替换只打一次）。 */
const seen = new Set();

/** `TS_RESOLVE_QUIET=1` ⇒ 不打改写日志。 */
const quiet = process.env.TS_RESOLVE_QUIET === '1';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const parent = path.dirname(fileURLToPath(context.parentURL));
      const ts = path.resolve(parent, specifier.slice(0, -3) + '.ts');
      if (fs.existsSync(ts)) {
        const key = `${context.parentURL} -> ${ts}`;
        if (!seen.has(key)) {
          seen.add(key);
          if (!quiet) console.error(`[ts-resolve] ${specifier} → ${path.relative(process.cwd(), ts)}`);
        }
        return { url: pathToFileURL(ts).href, shortCircuit: true, format: 'module-typescript' };
      }
    }
    return nextResolve(specifier, context);
  },
});
