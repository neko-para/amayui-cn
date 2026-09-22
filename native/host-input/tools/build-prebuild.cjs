'use strict';
/**
 * 产出**预编译通用二进制**（`tickets/T-0117`）：`prebuilds/darwin-universal/host_input.node`。
 *
 * ```
 * npm run build:prebuild      # 只在 macOS 上有意义（其它平台直接报错退出）
 * ```
 *
 * ## 为什么要单独一条命令（而不是让 `npm run build` 直接产出通用二进制）
 *
 * `npm run build` 是**开发回路**：改一行 C++ 就要重编，双架构会把它的耗时翻倍，而开发机只需要本机那一份。
 * 预编译产物是**分发物**：它的消费者是「只装了 Node + Electron、没有 CMake/Xcode」的机器，
 * 所以它必须是 fat Mach-O（一份文件同时服务 arm64 与 x86_64），且最低系统版本必须是 11.0 ——
 * 这两件事都由本脚本**编译完当场校验**（而不是靠人记得看一眼 `lipo`）。
 *
 * ## 落点为什么是 `prebuilds/darwin-universal/`
 *
 * 加载器（`index.js`）的最后一条兜底是 `prebuilds/<platform>-universal/<basename>`：
 * 通用二进制不需要按 arch 分目录，`prebuilds/darwin-arm64/` 与 `prebuilds/darwin-x64/` 各放一份
 * 只会让人以为它们内容不同。本地构建的产物（`build/Release/…`）在搜索链里**排在预编译之前**，
 * 所以跑过 `npm run build` 的开发者用的仍是自己的产物。
 *
 * ## 校验（任一不符即非 0 退出）
 *
 * 1. `lipo -archs` 必须**同时**含 `arm64` 与 `x86_64`；
 * 2. 每个 slice 的 `LC_BUILD_VERSION.minos`（旧格式 `LC_VERSION_MIN_MACOSX.version`）必须是 11.0
 *    —— 它由 `CMakeLists.txt` 顶部的 `CMAKE_OSX_DEPLOYMENT_TARGET` 决定。
 *
 * 这两条在守卫里也有一份（`app/amayui-emulator/test/native-host.test.ts`）：那个防的是
 * 「预置产物被单架构的本地构建覆盖 / deployment target 被悄悄抬高」，本脚本防的是「这次就编错了」。
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'build-universal');
const DEST_DIR = path.join(ROOT, 'prebuilds', 'darwin-universal');
const DEST = path.join(DEST_DIR, 'host_input.node');
const ARCHS = ['arm64', 'x86_64'];
const MIN_OS = '11.0';

/** 跑一条命令并把 stdout 收回来（继承 stdio 会让下面解析 lipo 输出变麻烦）。 */
function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
}

/** 从 `otool -l` 里取某个 slice 的最低系统版本（LC_BUILD_VERSION 优先，退回 LC_VERSION_MIN_MACOSX）。 */
function minOsVersion(file, arch) {
  const out = run('otool', ['-l', '-arch', arch, file]);
  const build = /cmd LC_BUILD_VERSION[\s\S]*?\n\s*minos\s+(\S+)/.exec(out);
  if (build) return build[1];
  const legacy = /cmd LC_VERSION_MIN_MACOSX[\s\S]*?\n\s*version\s+(\S+)/.exec(out);
  return legacy ? legacy[1] : null;
}

function main() {
  if (process.platform !== 'darwin') {
    console.error(`✗ build:prebuild 只在 macOS 上有意义（当前 platform=${process.platform}）`);
    process.exit(1);
  }

  console.log(`$ npx cmake-js build --release --out ${path.relative(ROOT, OUT_DIR)} \\`);
  console.log(`      --CDCMAKE_OSX_ARCHITECTURES=${ARCHS.join(';')} --CDCMAKE_OSX_DEPLOYMENT_TARGET=${MIN_OS}`);
  // ★cmake-js 的 `--CD` 只有一个正确写法：**`--CDKEY=VALUE` 拼成一个参数**（`_parseCustomOptions` 从
  //   `process.argv` 里按 `indexOf('=') >= 5` 切 key）——写成空格分隔的 `--CD KEY=VALUE` 会被**静默忽略**，
  //   于是 cmake-js 自己注入的 `-DCMAKE_OSX_ARCHITECTURES=<本机 arch>` 就赢了（实测：产出的仍是单架构，
  //   且没有任何报错）。它的自定义项排在平台默认项**之后**，所以后出现的 `-D` 覆盖先出现的。
  run(
    'npx',
    [
      'cmake-js', 'build', '--release',
      '--out', OUT_DIR,
      `--CDCMAKE_OSX_ARCHITECTURES=${ARCHS.join(';')}`,
      `--CDCMAKE_OSX_DEPLOYMENT_TARGET=${MIN_OS}`,
    ],
    { stdio: 'inherit' },
  );

  const built = path.join(OUT_DIR, 'Release', 'host_input.node');
  if (!fs.existsSync(built)) {
    console.error(`✗ 没找到构建产物：${built}`);
    process.exit(1);
  }

  // ---- 校验 1：双架构 ----
  const archs = run('lipo', ['-archs', built]).trim().split(/\s+/).sort();
  const missing = ARCHS.filter((a) => !archs.includes(a));
  const extra = archs.filter((a) => !ARCHS.includes(a));
  console.log(`\n[lipo] ${path.relative(ROOT, built)} → ${archs.join(' ')}`);
  if (missing.length || extra.length) {
    console.error(`✗ 架构不符：期望 ${ARCHS.join(' ')}，实得 ${archs.join(' ')}（缺 ${missing.join(',') || '无'}${extra.length ? `；多 ${extra.join(',')}` : ''}）`);
    process.exit(1);
  }

  // ---- 校验 2：每个 slice 的最低系统版本 ----
  for (const a of ARCHS) {
    const minos = minOsVersion(built, a);
    console.log(`[otool] ${a} minos = ${minos}`);
    if (minos !== MIN_OS) {
      console.error(`✗ ${a} 的最低系统版本应为 ${MIN_OS}，实得 ${minos}（检查 CMakeLists.txt 顶部的 CMAKE_OSX_DEPLOYMENT_TARGET）`);
      process.exit(1);
    }
  }

  fs.mkdirSync(DEST_DIR, { recursive: true });
  fs.copyFileSync(built, DEST);
  const size = fs.statSync(DEST).size;
  console.log(`\n✅ 预置产物已写出：${path.relative(ROOT, DEST)}（${(size / 1024).toFixed(1)} KB）`);
  console.log('   ★改了 src/*.cc 或 NAPI_VERSION 后必须重跑本命令，否则仓库里那份就是旧的。');
}

main();
