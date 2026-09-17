'use strict';
/**
 * win32_input 的 **JS 门面 + 加载器**（CommonJS：主进程（esbuild→CJS）与测试都能直接 require）。
 *
 * ## 它解决什么
 *
 * 原生模块**可能不存在**（没人跑过 `npm run build`、换了平台、将来打包漏了 / 被 asar 压进去），
 * 而调用方（模拟器主进程）**不能因此起不来**：光标挪不动只是观感缺失，模拟器照旧要能玩。
 * 所以这里把「找 .node → 加载 → 失败也要有可用对象」收成一处：
 *
 * ```js
 * const w32 = require('<repo>/native/win32-input');
 * w32.available;      // false = 没加载上（reason 里是原因，调用方记一行诊断就够）
 * w32.setCursorPos(100, 200);  // 不可用时**返回 false**，不抛错
 * ```
 *
 * ## 加载链（按序，先命中先用）
 *
 * 1. 环境变量 `AMAYUI_WIN32_INPUT_NODE`（绝对路径；排障/打包后指到 `app.asar.unpacked` 用）；
 * 2. `build/Release/win32_input.node`、`build/Debug/…`（cmake-js 在 Linux/macOS 用单配置生成器）；
 * 3. `build/<Config>/…`（Windows 的 Visual Studio 多配置生成器：`Release`/`RelWithDebInfo`/`MinSizeRel`/`Debug`）；
 * 4. `prebuilds/<platform>-<arch>/win32_input.node`（预编译分发布局 —— 将来接 `prebuildify` 时就用这条）。
 *
 * ★**为什么要留 4**：本仓的分发策略是「二进制不进 git，按需构建」（见 README 的打包一节），
 * 但若以后要发预编译包（别人没编译器也能用），约定好的落点就是 `prebuilds/` —— 加载器先认它，
 * 就不用改调用方代码。
 */

const fs = require('node:fs');
const path = require('node:path');

const ADDON_BASENAME = 'win32_input.node';
/** VS 多配置生成器的目录名（cmake-js 在 Windows 默认走 VS 生成器 ⇒ 产物在 build/<Config>/）。 */
const VS_CONFIGS = ['Release', 'RelWithDebInfo', 'MinSizeRel', 'Debug'];

/** 该平台的 .node 是否可能有实现（非 Windows 也能编译，见 src/win32_input.cc 的口径 3）。 */
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
  const fromEnv = env.AMAYUI_WIN32_INPUT_NODE;
  if (fromEnv) out.push(fromEnv);
  out.push(path.join(root, 'build', 'Release', ADDON_BASENAME));
  out.push(path.join(root, 'build', 'Debug', ADDON_BASENAME));
  for (const cfg of VS_CONFIGS) out.push(path.join(root, 'build', cfg, ADDON_BASENAME));
  out.push(path.join(root, 'prebuilds', `${platform}-${arch}`, ADDON_BASENAME));
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
    : '没有构建产物（跑 `npm run build` —— 见 native/win32-input/README.md）';
  return { available: false, reason, addonPath: null, api: null, tried };
}

/**
 * 把加载结果包成**永远可用**的门面：不可用时所有函数返回 `null`/`false`。
 *
 * 为什么不让调用方自己判 `available`：那会逼出 `if (w32 && w32.setCursorPos) ...` 这种散落的分支，
 * 而"宿主没有真实光标"在 headless/浏览器宿主里本来就是常态（见 `NativeBridge` 的可选缝约定）。
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
    getCursorPos: call('getCursorPos', null),
    setCursorPos: call('setCursorPos', false),
    getVirtualScreenRect: call('getVirtualScreenRect', null),
    getSystemMetrics: call('getSystemMetrics', null),
    getAsyncKeyState: call('getAsyncKeyState', null),
    showCursor: call('showCursor', null),
  };
}

const status = loadAddon();

module.exports = {
  /** `.node` 是否加载成功（false 时下面所有函数都是安全空实现）。 */
  available: status.available,
  /** 平台是否**真的有实现**（`win32` = true；非 Windows 的 .node 能加载但函数返回 null/false）。 */
  supported: status.available ? status.api.supported !== false : false,
  /** `available === false` 时的原因（一行诊断用）；可用时是空串。 */
  reason: status.reason,
  /** 实际加载到的 `.node` 绝对路径（诊断/打包核对用）。 */
  addonPath: status.addonPath,
  platform: process.platform,
  arch: process.arch,
  ...makeFacade(status.api),
  // ---- 测试缝（不属于对外契约；守卫用它注入目录） ----
  _loadAddon: loadAddon,
  _candidatePaths: candidatePaths,
  _KNOWN_PLATFORMS: KNOWN_PLATFORMS,
};
