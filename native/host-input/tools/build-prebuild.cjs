'use strict';
/**
 * 产出**预编译产物**并写进 `prebuilds/`（加载链的最后两条兜底落点）—— 按平台分支：
 *
 * ```
 * npm run build:prebuild
 *   darwin → prebuilds/darwin-universal/host_input.node   fat Mach-O（arm64 + x86_64）、minos 11.0
 *   win32  → prebuilds/win32-<arch>/host_input.node       PE、按 arch 分目录
 * ```
 *
 * ## 为什么落点不同（这不只是命名习惯）
 *
 * - **darwin**：支持 fat Mach-O ⇒ 一份文件同时服务 arm64 与 x86_64，于是用 `prebuilds/<platform>-universal/`
 *   （加载链最后一条），不必按 arch 放两份内容相同的文件（`tickets/T-0117`）；
 * - **win32**：PE **没有** fat 等价物（一份 DLL 只能是一个架构）⇒ 只能走加载链第 4 条
 *   `prebuilds/<platform>-<arch>/`（`tickets/T-0120`：用户裁定 win32 产物也随仓库分发）。
 *
 * ## 为什么要有这条命令（而不是让 `npm run build` 直接产出预置产物）
 *
 * `npm run build` 是**开发回路**：改一行 C++ 就要重编（macOS 上双架构还会把耗时翻倍），
 * 而开发机只需要本机那一份。预置产物是**分发物**：消费者是「只装了 Node + Electron」的机器，
 * 所以它必须当场被校验（架构 / 最低系统版本），而不是靠人记得看一眼。
 *
 * 本地构建的产物（`build/Release/…`）在搜索链里**排在预编译之前**，所以跑过 `npm run build`
 * 的开发者用的仍是自己的产物；反过来，改了 `src/*.cc` 之后**必须重跑本命令**，否则仓库里那份就是旧的。
 *
 * ## 校验（任一不符即非 0 退出）
 *
 * | 平台 | 校验 | 为什么这么验 |
 * |---|---|---|
 * | darwin | `lipo -archs` 同时含 `arm64` 与 `x86_64`；每个 slice 的 `LC_BUILD_VERSION.minos`（旧格式 `LC_VERSION_MIN_MACOSX.version`）= 11.0 | 单架构产物不许冒充通用二进制；`minos` 由 `CMakeLists.txt` 顶部的 `CMAKE_OSX_DEPLOYMENT_TARGET` 决定，被悄悄抬高会让旧系统装不上 |
 * | win32 | 产物是 PE 且 `Machine` = 本机 arch 对应值（`x64` → `0x8664`、`arm64` → `0xAA64`、`ia32` → `0x014c`） | 提交别的架构会让 `prebuilds/win32-<arch>/` 这个**落点名**说谎 |
 *
 * ★win32 那份为什么**不**用 `dumpbin`：它只有装了 VS 的机器才有，而"校验"这件事恰恰应该在任何平台
 * 都能做（守卫 `test/native-host.test.ts` 就在 macOS/Linux 上钉 win32 那份）—— PE 头是纯字节读取。
 *
 * darwin 的两条在守卫里也有一份（`app/amayui-emulator/test/native-host.test.ts`）：那个防的是
 * 「预置产物被单架构的本地构建覆盖 / deployment target 被悄悄抬高」，本脚本防的是「这次就编错了」；
 * win32 那边同理（守卫钉「在库 + x64 PE + win32 上按预置落点真能加载」）。
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ADDON = 'host_input.node';
const ARCHS = ['arm64', 'x86_64'];
const MIN_OS = '11.0';
/** `process.arch` → PE `Machine`（win32 的落点按 arch 分目录，所以架构必须钉死）。 */
const PE_MACHINE = { x64: 0x8664, arm64: 0xaa64, ia32: 0x014c };

/** 跑一条命令并把 stdout 收回来（继承 stdio 会让下面解析 lipo 输出变麻烦）。 */
function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
}

/**
 * 跑 `cmake-js` —— ★**不经过 `npx`**：Windows 上 `npx` 是 `npx.cmd`，而 `execFileSync` 起不了
 * `.cmd`/`.bat`（Node 的 CVE-2024-27980 之后必须走 shell）⇒ 直接让 node 跑包自己的入口，
 * 三个平台一条路（也省掉一层 shell 引号）。
 */
function cmakeJs(args, opts = {}) {
  const bin = path.join(ROOT, 'node_modules', 'cmake-js', 'bin', 'cmake-js');
  if (!fs.existsSync(bin)) {
    console.error(`✗ 找不到 ${path.relative(ROOT, bin)} ⇒ 先在 native/host-input 里跑 npm install`);
    process.exit(1);
  }
  console.log(`$ cmake-js ${args.join(' ')}   # = node node_modules/cmake-js/bin/cmake-js …`);
  return run(process.execPath, [bin, ...args], opts);
}

/** 从 `otool -l` 里取某个 slice 的最低系统版本（LC_BUILD_VERSION 优先，退回 LC_VERSION_MIN_MACOSX）。 */
function minOsVersion(file, arch) {
  const out = run('otool', ['-l', '-arch', arch, file]);
  const build = /cmd LC_BUILD_VERSION[\s\S]*?\n\s*minos\s+(\S+)/.exec(out);
  if (build) return build[1];
  const legacy = /cmd LC_VERSION_MIN_MACOSX[\s\S]*?\n\s*version\s+(\S+)/.exec(out);
  return legacy ? legacy[1] : null;
}

/** 读 PE（COFF）头的 `Machine` 字段（`0x8664` = x64；见 PE 规范）。 */
function peMachine(file) {
  const b = fs.readFileSync(file);
  if (b.length < 0x40 || b.readUInt16LE(0) !== 0x5a4d) return null; // 'MZ'
  const eLfanew = b.readUInt32LE(0x3c);
  if (b.length < eLfanew + 6 || b.readUInt32LE(eLfanew) !== 0x00004550) return null; // 'PE\0\0'
  return b.readUInt16LE(eLfanew + 4);
}

/** 写出预置产物并打印体积（两个平台共用；`dest` 是最终文件路径）。 */
function install(built, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(built, dest);
  const size = fs.statSync(dest).size;
  console.log(`\n✅ 预置产物已写出：${path.relative(ROOT, dest)}（${(size / 1024).toFixed(1)} KB）`);
  console.log('   ★改了 src/*.cc 或 NAPI_VERSION 后必须重跑本命令，否则仓库里那份就是旧的。');
}

/** darwin：双架构通用二进制（落 `prebuilds/darwin-universal/`）。 */
function buildDarwin() {
  const outDir = path.join(ROOT, 'build-universal');
  console.log(`      （产出目录 ${path.relative(ROOT, outDir)}）`);
  // ★cmake-js 的 `--CD` 只有一个正确写法：**`--CDKEY=VALUE` 拼成一个参数**（`_parseCustomOptions` 从
  //   `process.argv` 里按 `indexOf('=') >= 5` 切 key）——写成空格分隔的 `--CD KEY=VALUE` 会被**静默忽略**，
  //   于是 cmake-js 自己注入的 `-DCMAKE_OSX_ARCHITECTURES=<本机 arch>` 就赢了（实测：产出的仍是单架构，
  //   且没有任何报错）。它的自定义项排在平台默认项**之后**，所以后出现的 `-D` 覆盖先出现的。
  cmakeJs(
    [
      'build', '--release',
      '--out', outDir,
      `--CDCMAKE_OSX_ARCHITECTURES=${ARCHS.join(';')}`,
      `--CDCMAKE_OSX_DEPLOYMENT_TARGET=${MIN_OS}`,
    ],
    { stdio: 'inherit' },
  );

  const built = path.join(outDir, 'Release', ADDON);
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

  install(built, path.join(ROOT, 'prebuilds', 'darwin-universal', ADDON));
}

/** win32：本机 arch 的 PE（落 `prebuilds/win32-<arch>/`；PE 没有 fat 等价物）。 */
function buildWin32() {
  const expected = PE_MACHINE[process.arch];
  if (!expected) {
    console.error(`✗ 不认识的 Windows arch=${process.arch}（已知：${Object.keys(PE_MACHINE).join(' / ')}）`);
    process.exit(1);
  }
  console.log(`      （目标落点 prebuilds/win32-${process.arch}/）`);
  cmakeJs(['build', '--release'], { stdio: 'inherit' });

  const built = path.join(ROOT, 'build', 'Release', ADDON);
  if (!fs.existsSync(built)) {
    console.error(`✗ 没找到构建产物：${built}`);
    process.exit(1);
  }

  const machine = peMachine(built);
  console.log(`\n[pe] ${path.relative(ROOT, built)} → Machine=0x${(machine ?? 0).toString(16)}（期望 0x${expected.toString(16)} / ${process.arch}）`);
  if (machine !== expected) {
    console.error(`✗ 架构不符：` + `期望 ${process.arch}（0x${expected.toString(16)}），实得 0x${(machine ?? 0).toString(16)}`);
    process.exit(1);
  }

  install(built, path.join(ROOT, 'prebuilds', `win32-${process.arch}`, ADDON));
}

function main() {
  if (process.platform === 'darwin') return buildDarwin();
  if (process.platform === 'win32') return buildWin32();
  console.error(`✗ build:prebuild 只覆盖 darwin / win32（当前 platform=${process.platform}）—— 本模块在这两个平台上才有实现。`);
  process.exit(1);
}

main();
