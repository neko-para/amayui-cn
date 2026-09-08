/**
 * 用 esbuild 编译 Electron 壳：
 *  - electron/main.ts     -> dist/electron/main.cjs    (CommonJS, node, electron external)
 *  - electron/preload.ts  -> dist/electron/preload.cjs (CommonJS, node, electron external)
 *  - src/renderer/renderer.ts -> dist/renderer/renderer.js (IIFE, browser)
 *  - src/renderer/index.html  -> dist/renderer/index.html (copy)
 *  - control/control.ts   -> dist/control/control.js    (IIFE, browser；控制窗)
 *  - control/index.html   -> dist/control/index.html    (copy)
 */
import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

function p(...parts) {
  return path.join(root, ...parts);
}

async function main() {
  await Promise.all([
    build({
      entryPoints: [p('electron', 'main.ts')],
      outfile: p('dist', 'electron', 'main.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['electron'],
      sourcemap: true,
    }),
    build({
      entryPoints: [p('electron', 'preload.ts')],
      outfile: p('dist', 'electron', 'preload.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['electron'],
      sourcemap: true,
    }),
    build({
      entryPoints: [p('src', 'renderer', 'renderer.ts')],
      outfile: p('dist', 'renderer', 'renderer.js'),
      bundle: true,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      sourcemap: true,
    }),
    build({
      entryPoints: [p('control', 'control.ts')],
      outfile: p('dist', 'control', 'control.js'),
      bundle: true,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      sourcemap: true,
    }),
  ]);

  await copyFile(p('src', 'renderer', 'index.html'), p('dist', 'renderer', 'index.html'));
  await copyFile(p('control', 'index.html'), p('dist', 'control', 'index.html'));
  console.log('[electron] built main.cjs / preload.cjs / renderer.js / control.js (browser) + htmls');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
