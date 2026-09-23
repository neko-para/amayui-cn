/**
 * 用 esbuild 编译 Electron 壳：
 *  - electron/main.ts     -> dist/electron/main.cjs    (CommonJS, node, electron external)
 *  - electron/preload.ts  -> dist/electron/preload.cjs (CommonJS, node, electron external)
 *  - src/renderer/renderer.ts -> dist/renderer/renderer.js (IIFE, browser)
 *  - src/renderer/index.html  -> dist/renderer/index.html (copy)
 *  - control/control.ts   -> dist/control/control.js    (IIFE, browser；控制窗)
 *  - control/index.html   -> dist/control/index.html    (copy)
 *
 * web 宿主（`tickets/T-0135` Phase 2；与 Electron 壳**共用同一份渲染入口**，只是换一层 `window.api`）：
 *  - src/renderer/webBridgeEntry.ts -> dist/web/bridge.js   (IIFE, browser；先装 window.api)
 *  - src/renderer/renderer.ts       -> dist/web/renderer.js (IIFE, browser；同一份渲染入口)
 *  - src/renderer/index.web.html    -> dist/web/index.html  (copy)
 *  ★两份产物顺序即契约（bridge 先于 renderer）；esbuild 不做顺序保证，靠 HTML 的两个 script 标签。
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
      entryPoints: [p('src', 'renderer', 'webBridgeEntry.ts')],
      outfile: p('dist', 'web', 'bridge.js'),
      bundle: true,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      sourcemap: true,
    }),
    build({
      entryPoints: [p('src', 'renderer', 'renderer.ts')],
      outfile: p('dist', 'web', 'renderer.js'),
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
  await copyFile(p('src', 'renderer', 'index.web.html'), p('dist', 'web', 'index.html'));
  await copyFile(p('control', 'index.html'), p('dist', 'control', 'index.html'));
  console.log('[electron] built main.cjs / preload.cjs / renderer.js / control.js / web/{bridge,renderer}.js (browser) + htmls');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
