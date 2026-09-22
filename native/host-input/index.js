'use strict';
/**
 * host_input 的 **JS 门面 + 加载器**（CommonJS：主进程（esbuild→CJS）与测试都能直接 require）。
 *
 * ## 它解决什么
 *
 * 原生模块**可能不存在**（没人跑过 `npm run build`、换了平台、将来打包漏了 / 被 asar 压进去），
 * 而调用方（模拟器主进程）**不能因此起不来**：光标挪不动只是观感缺失，模拟器照旧要能玩。
 * 所以这里把「找 .node → 加载 → 失败也要有可用对象」收成一处：
 *
 * ```js
 * const host = require('<repo>/native/host-input');
 * host.available;      // false = 没加载上（reason 里是原因，调用方记一行诊断就够）
 * host.setCursorPos(100, 200);  // 不可用时**返回 false**，不抛错
 * ```
 *
 * ★**在 Linux 上 `available === true` 但 `supported === false`**（`.node` 能编译、能加载，但两个平台
 * 实现 TU 都是空的）⇒ 门面同样全返回 `null`/`false`。调用方只看 `supported`，不看平台。
 *
 * ## 加载链（按序，先命中先用）
 *
 * 1. 环境变量 `AMAYUI_HOST_INPUT_NODE`（绝对路径；排障/打包后指到 `app.asar.unpacked` 用）；
 * 2. `build/Release/host_input.node`、`build/Debug/…`（cmake-js 在 Linux/macOS 用单配置生成器）；
 * 3. `build/<Config>/…`（Windows 的 Visual Studio 多配置生成器）；
 * 4. `prebuilds/<platform>-<arch>/host_input.node`（预编译分发布局 —— `prebuildify` 用的就是这条）；
 * 5. `prebuilds/<platform>-universal/host_input.node`（★**通用二进制**落点：`tickets/T-0117` 预置的
 *    就是它 —— 一份 fat Mach-O 同时服务 arm64 与 x86_64，所以不按 arch 分目录）。
 *
 * ★**为什么 2/3 排在 4/5 前面**：本地构建的产物永远比预置的更新（开发者改了源码只需 `npm run build`，
 * 不必重跑预编译）；预置产物是「没编译器的人也能用」的兜底，不是首选。
 * ★预置产物走 **git-lfs**（`.gitattributes` 的 `*.node`），与仓库其余二进制同口径。
 */

const fs = require('node:fs');
const path = require('node:path');

const ADDON_BASENAME = 'host_input.node';
/** VS 多配置生成器的目录名（cmake-js 在 Windows 默认走 VS 生成器 ⇒ 产物在 build/<Config>/）。 */
const VS_CONFIGS = ['Release', 'RelWithDebInfo', 'MinSizeRel', 'Debug'];

/** 该平台的 .node 是否可能有实现（`win32`/`darwin` 有；其余平台能加载但 `supported === false`）。 */
const KNOWN_PLATFORMS = new Set(['win32', 'darwin', 'linux']);

/**
 * 候选路径（**顺序即优先级**）。导出只为守卫测试能断言搜索链本身。
 *
 * @param {{root?: string, env?: Record<string, string|undefined>, platform?: string, arch?: string}} [opts]
 */
function candidatePaths(opts = {}) {
  const root = opts.root ?? __dirname;
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const out = [];
  const fromEnv = env.AMAYUI_HOST_INPUT_NODE;
  if (fromEnv) out.push(fromEnv);
  out.push(path.join(root, 'build', 'Release', ADDON_BASENAME));
  out.push(path.join(root, 'build', 'Debug', ADDON_BASENAME));
  for (const cfg of VS_CONFIGS) out.push(path.join(root, 'build', cfg, ADDON_BASENAME));
  out.push(path.join(root, 'prebuilds', `${platform}-${arch}`, ADDON_BASENAME));
  // 通用（fat）二进制的兜底落点：一份文件同时服务多个 arch，所以不按 arch 分目录。
  out.push(path.join(root, 'prebuilds', `${platform}-universal`, ADDON_BASENAME));
  // 去重但保序（env 覆盖路径可能与其它候选重合）
  return [...new Set(out)];
}

/** 加载一个候选文件；失败时把异常留着（诊断要看到真正的原因，而不是"文件不存在"）。 */
function tryRequire(file) {
  try {
    return { mod: require(file), error: null };
  } catch (error) {
    return { mod: null, error };
  }
}

/**
 * 找一个能加载的 `.node`。
 *
 * @returns {{available: boolean, reason: string, addonPath: string|null, api: object|null, tried: string[]}}
 */
function loadAddon(opts = {}) {
  const candidates = candidatePaths(opts);
  const tried = [];
  const failures = [];
  for (const file of candidates) {
    if (!fs.existsSync(file)) {
      tried.push(`${file} (不存在)`);
      continue;
    }
    const { mod, error } = tryRequire(file);
    if (mod) return { available: true, reason: '', addonPath: file, api: mod, tried };
    tried.push(`${file} (加载失败: ${error && error.message})`);
    failures.push(error);
  }
  const reason = failures.length
    ? `找到文件但加载失败：${failures.map((e) => e && e.message).join(' / ')}`
    : '没有构建产物（跑 `npm run build`，或见 native/host-input/README.md 的「预置产物」一节）';
  return { available: false, reason, addonPath: null, api: null, tried };
}

/**
 * 把加载结果包成**永远可用**的门面：不可用（或本平台没有实现）时所有函数返回 `null`/`false`。
 *
 * 为什么不让调用方自己判 `available`/`supported`：那会逼出 `if (host && host.setCursorPos) ...` 这种
 * 散落的分支，而"宿主没有真实光标"在 headless/浏览器/不支持的平台里本来就是常态。
 * ★**平台专有函数在别的平台上根本不存在**（`getSystemMetrics` 只有 win32 注册、`postMouseMove`
 * 只有 darwin 注册）⇒ 这里统一兜成 `null`/`false`，调用方不必分平台。
 */
function makeFacade(api) {
  const call = (name, fallback) => (...args) => {
    const fn = api && api[name];
    if (typeof fn !== 'function') return fallback;
    try {
      const v = fn(...args);
      return v === undefined ? fallback : v;
    } catch {
      // 原生层抛错（参数写错）不该让调用方崩：按"这次没成功"处理。参数错误在开发期由 smoke 暴露。
      return fallback;
    }
  };
  return {
    // ---- 跨平台（两平台同名同义；坐标单位：win32 = 物理像素、darwin = 点） ----
    getCursorPos: call('getCursorPos', null),
    setCursorPos: call('setCursorPos', false),
    getVirtualScreenRect: call('getVirtualScreenRect', null),
    // ---- win32 专有 ----
    getSystemMetrics: call('getSystemMetrics', null),
    getAsyncKeyState: call('getAsyncKeyState', null),
    showCursor: call('showCursor', null),
    // ---- darwin 专有（`postMouseMove` 的返回值 = 有没有辅助功能授权） ----
    postMouseMove: call('postMouseMove', false),
    isAccessibilityTrusted: call('isAccessibilityTrusted', false),
  };
}

const status = loadAddon();

module.exports = {
  /** `.node` 是否加载成功（false 时下面所有函数都是安全空实现）。 */
  available: status.available,
  /** 本平台是否**真有实现**（win32/darwin = true；Linux 等的 .node 能加载但函数返回 null/false）。 */
  supported: status.available ? status.api.supported !== false : false,
  /** `available === false` 时的原因（一行诊断用）；可用时是空串。 */
  reason: status.reason,
  /** 实际加载到的 `.node` 绝对路径（诊断/打包核对用）。 */
  addonPath: status.addonPath,
  platform: process.platform,
  arch: process.arch,
  ...makeFacade(status.api),
  // ---- 测试缝（不属于对外契约；守卫用它注入目录 / 断言门面的空实现语义） ----
  _loadAddon: loadAddon,
  _candidatePaths: candidatePaths,
  _makeFacade: makeFacade,
  _KNOWN_PLATFORMS: KNOWN_PLATFORMS,
};
