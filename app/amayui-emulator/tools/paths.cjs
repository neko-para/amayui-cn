/**
 * **命令行路径参数的唯一基准与前置校验**（`tickets/T-0032`）。
 *
 * ## 为什么有它（实测事故）
 * `tools/record.cjs` 原先**同一个命令里两种基准**：
 * ```bash
 * cd app/amayui-emulator
 * npx electron tools/record.cjs --scenario ../../.tmp/scen.json --out ../../.tmp/x.jsonl.gz
 * #  --scenario → path.resolve(arg)                （相对 **cwd**）
 * #  --out      → path.resolve(ROOT, arg)           （相对 **仓库根**）
 * #  ⇒ --out 拼成 <repo>/../../.tmp/x（越出仓库）→ fs.mkdirSync EPERM →
 * #    未捕获异常在 `require(main.cjs)` 阶段抛出 ⇒ Electron 弹「App threw an error during load」
 * ```
 * 用户看到的是"应用还没起来就崩"，而不是一行可读的参数错误。
 *
 * ## 本模块定的规则（唯一基准 + 可读报错）
 *  - **基准统一为仓库根**（= `app/amayui-emulator/tools/` 上溯三级），与 `shot.cjs` 的 `.tmp/` 一致；
 *  - 相对路径**越出仓库** ⇒ 前置报错（`ToolPathError`），调用方据此在 **require Electron 之前**
 *    打印一行可读信息并 `exit(2)`（绝不再让 mkdir 的 EPERM 冒成加载期异常）；
 *  - `--scenario` 额外容忍一种**历史写法**：仓库根候选不存在、而 cwd 候选存在时用它
 *    （文档里的 `--scenario tools/scenarios/gamestart.json` 是在包目录下敲的）—— 但会把
 *    "用了 cwd 候选"这件事**打印出来**，不做静默双基准；
 *  - 绝对路径一律原样使用（同样必须落在仓库内 —— 我们是"只往仓库 `.tmp/` 写"的工具）。
 */

const path = require('node:path');

/** 仓库根（`app/amayui-emulator/tools/paths.cjs` 上溯三级）。 */
const ROOT = path.resolve(__dirname, '..', '..', '..');

/** 路径参数越界/非法（**可读**，不含堆栈噪声）。 */
class ToolPathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolPathError';
  }
}

/** `a` 是否等于 `b` 或位于 `b` 之内（纯字符串比较，允许 Windows 分隔符）。 */
function isInside(a, b) {
  const rel = path.relative(b, a);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 解析一个路径参数为绝对路径，并断言它**落在仓库内**。
 *
 * @param {string} raw 命令行给的原始值
 * @param {string} what 参数名（只用于报错与日志）
 * @param {{cwdFallback?: boolean, mustExist?: boolean, cwd?: string}} [opts]
 *   `cwdFallback`：仓库根候选项不存在时，允许退回 cwd 候选（`--scenario` 用；见文件头）
 *   `mustExist`：解析后必须存在（读入类参数）
 * @returns {{abs: string, how: string}} `how` = 命中了哪条规则（进日志，便于归因）
 */
function resolveRepoPath(raw, what, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const candidates = [];
  const primary = path.isAbsolute(raw) ? raw : path.resolve(ROOT, raw);
  candidates.push({ abs: primary, how: path.isAbsolute(raw) ? 'absolute' : 'repo-root' });
  if (opts.cwdFallback && !path.isAbsolute(raw)) {
    const viaCwd = path.resolve(cwd, raw);
    if (viaCwd !== primary) candidates.push({ abs: viaCwd, how: 'cwd(fallback)' });
  }
  const exists = (p) => {
    try {
      require('node:fs').accessSync(p);
      return true;
    } catch {
      return false;
    }
  };
  let picked = candidates[0];
  if (opts.mustExist) {
    const hit = candidates.find((c) => exists(c.abs));
    if (!hit) {
      throw new ToolPathError(
        `--${what} 指向的文件不存在：${candidates.map((c) => `${c.abs}（${c.how}）`).join(' 或 ')}`,
      );
    }
    picked = hit;
  } else if (opts.cwdFallback) {
    // 写出类参数没有"存在性"可判；只有必须存在的（--scenario）才走上面那条。这里保持主候选。
    picked = candidates[0];
  }
  if (!isInside(picked.abs, ROOT)) {
    throw new ToolPathError(
      `--${what} 越出仓库：${picked.abs}\n` +
        `    基准是**仓库根**（${ROOT}）；仓库外的路径一律拒绝 —— ` +
        `要写仓库临时区请用 \`.tmp/…\`（例如 \`--${what} .tmp/x.jsonl.gz\`）。`,
    );
  }
  return { abs: picked.abs, how: picked.how };
}

/**
 * 起跑前的统一装配：解析 + 校验 + **打印最终绝对路径**（可读的一行），
 * 并把错误转成"一行信息 + 非零退出"，**绝不抛出到调用方的加载阶段**。
 *
 * @param {{scenario?: string, out?: string, cwd?: string, log?: (m: string) => void}} spec
 * @returns {{scenarioPath?: string, outPath?: string}}
 */
function preflight(spec) {
  const log = spec.log ?? ((m) => console.log(m));
  const out = {};
  try {
    if (spec.scenario !== undefined) {
      const r = resolveRepoPath(spec.scenario, 'scenario', { mustExist: true, cwdFallback: true, cwd: spec.cwd });
      out.scenarioPath = r.abs;
      log(`[paths] --scenario = ${r.abs}（命中规则：${r.how}）`);
    }
    if (spec.out !== undefined) {
      const r = resolveRepoPath(spec.out, 'out', { cwd: spec.cwd });
      out.outPath = r.abs;
      log(`[paths] --out = ${r.abs}（命中规则：${r.how}；基准 = 仓库根 ${ROOT}）`);
    }
    return out;
  } catch (err) {
    if (err instanceof ToolPathError) {
      console.error(`✗ 路径参数非法：${err.message}`);
      console.error('  （参数错误必须在起 Electron **之前**报出来；见 tickets/T-0032）');
      process.exit(2);
    }
    throw err;
  }
}

module.exports = { ROOT, ToolPathError, isInside, resolveRepoPath, preflight };
