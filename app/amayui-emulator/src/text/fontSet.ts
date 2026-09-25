/**
 * **面名 → 内嵌字族**的映射（引擎字体名的等价物）。
 *
 * 引擎侧：字体名来自配置 `message:Font` 与脚本 `set-font`(0x1A5) / `0x2FE`，
 * 并要过一遍白名单（`sub_428990` 查 `Font+201664` 的 32B/条 向量，向量由 `EnumFontFamilies` 填充；
 * 不在表内只打警告但仍继续，raw 41385-41393 / 41613-41621）。
 * **竖排时引擎创建 `"@%s"` 面**（`'@'` 前缀 = GDI 的竖排字体），重写侧要**剥掉前缀**。
 *
 * 重写侧：白名单 = 下面这张表；所有字族都由 `loadFonts()` 从 `res/fonts/` 内置注册，
 * 不依赖操作系统字体（跨平台一致性）。缺字族时回退到默认字族并**只记一次日志**。
 *
 * ## ★字体政策（2026-09 修正）：一切文本面 → `Amayui CN`
 * 汉化随包字体是 `Amayui CN` 族的两面：`Amayui-CN_cnjp.ttf`（Regular）+ `Amayui-CN_cnjp-Bold.ttf`（Bold，
 * Sarasa Gothic SC Bold 基底 + 同款 cnjp 替换；构建步骤见 `docs/font-build.md` §8.7）；
 * `patch/patch.config.json` 的字体条目同步这两个文件。
 * 汉化说明（`patch/README-测试版说明.md` 第 8 步）要求玩家把**全部**字体分类
 * （説明文 / パラメータ文字/数字 / ＡＤＶルビ / ＡＤＶメッセージ）都设为 `Amayui CN`
 * —— 也就是引擎侧无论拿到 `メイリオ`、`ＭＳ ゴシック`、`游ゴシック` 还是 `ＭＳ 明朝`，
 * 实际渲染的都是 `Amayui CN` 族（按 `lfWeight` 在 Regular/Bold 两面之间选）。
 *
 * 因此 `FACE_MAP` 把**所有**日文面名都指向 `Amayui CN`，并**彻底摘掉**旧 WenQuanYi 线：
 * `MSGothic_WenQuanYi_cnjp.ttf`（族名伪装成 `MS Gothic`）属已废弃基底
 * （见 `docs/font-build.md` §8「基底更新：WenQuanYi → SarasaGothicSC」、
 * `docs-new/00-overview/authority.md`），**不再作为任何面名的落地字族** ——
 * 历史错误：`メイリオ`（`$1$INITCONFIG0.txt:18` 设给 `bbb`，即消息窗主字体）被映射到
 * `MS Gothic`，于是 ADV 正文实际用 WenQuanYi 渲染（日志实证
 * `[font] MS Gothic#400 ← MSGothic_WenQuanYi_cnjp.ttf（4880KB）`）。
 *
 * ## ★字体政策按资源版本分叉（2026-09，`emulator.config.json` 的 `resources.version`）
 *
 * 上面那条"一切面名 → `Amayui CN`"只是 **`cnjp`（ShiftJIS 编码的中文资源）** 的政策。
 * `Amayui CN` 的 cmap 是**为占位编码服务的**（日文写法码位 → 简体字形），拿它渲染**纯日文资源**
 * 会把原文的日文码位也换成简体（`说/説`、`为/為` 同形替换肉眼可见），且**不报错、只是显示不对**。
 * ⇒ `resources.version = 'jp'` 时改走**未做 cnjp 替换**的更纱黑体（工程自带的
 * `res/fonts/SarasaGothicSC`，正是 `Amayui CN` 的基底 ⇒ 两者只差"有没有做 cmap 替换"）。
 *
 * ★`resources.version = 'jp'` 下请求 `Amayui CN` 面名 = **错误配置**（该面名只因汉化而存在）：
 * **不做特殊处理**，走通用回退（默认字族 + 一条 `unknown` 日志）—— 见 `FACE_MAPS.jp`。
 */
import type { ResourceVersion } from '../emulatorOptions.js';

/**
 * 一个内置字族：`family` = 注册进 `document.fonts` 的名字，`file` = `res/fonts/` 下的相对路径。
 *
 * ★`files` 的键是**该文件自己声明的字重**（读 TTF 的 name / OS/2 表确认过），不是"我们想让它扮演的字重"：
 *  - 理想情况：一族有 Regular(400) 与 Bold(700) **两个真面**（`Amayui CN`、`Sarasa Gothic SC` 都是如此）；
 *  - 只有 Regular 的族：**不要**把同一个文件既登记成 400 又登记成 700 —— 那等于告诉浏览器
 *    "这就是粗体面"，于是浏览器**不再合成** ⇒ 脚本要的 `lfWeight=700` 完全失效（静默没效果）；
 *    反之只登记 400、让请求 700 时落到"无粗体面"（浏览器合成加粗，或按宿主策略忽略）才是可解释的行为。
 *    ★`Amayui CN` 曾经就是"只有 Regular"⇒ 靠浏览器合成；2026-09 起按 `docs/font-build.md` §8.7
 *    补了真 Bold 面（`Amayui-CN_cnjp-Bold.ttf`），合成路径不再被走到。
 */
export interface BuiltinFamily {
  family: string;
  /** 该文件**声明**的字重 → 文件路径。 */
  files: Partial<Record<400 | 700, string>>;
}

export const FONT_DIR = 'res/fonts';

/** 内置字族表（`res/fonts/` 下确实存在的文件）。 */
export const BUILTIN_FAMILIES: BuiltinFamily[] = [
  {
    // 汉化随包字体：TTF 的 family 名就是 `Amayui CN`，**Regular + Bold 两面**
    // （Bold = SarasaGothicSC-Bold 基底 + 同款 cnjp 替换 + OS/2 码页补齐，见 docs/font-build.md §8.7）。
    // ★所有引擎面名都落到这里（见文件头「字体政策」）—— 包括主面 `bbb=メイリオ` 与注音面 `bbc=ＭＳ ゴシック`。
    family: 'Amayui CN',
    files: { 400: 'Amayui-CN_cnjp.ttf', 700: 'Amayui-CN_cnjp-Bold.ttf' },
  },
  {
    // 工程既有的 UI 文字渲染字体（docs/images/FONT.md）；有真 Bold 面。
    family: 'Sarasa Gothic SC',
    files: {
      400: 'SarasaGothicSC/SarasaGothicSC-Regular.ttf',
      700: 'SarasaGothicSC/SarasaGothicSC-Bold.ttf',
    },
  },
];

/** 汉化随包字体族名（`cnjp` 的落地字族）。 */
export const CNJP_FAMILY = 'Amayui CN';
/** 更纱黑体 SC（`jp` 的落地字族；也是 `Amayui CN` 的**基底**，只差没做 cnjp cmap 替换）。 */
export const SARASA_FAMILY = 'Sarasa Gothic SC';

/**
 * 引擎面名 → 内置字族（按 `resources.version` 分两张表）。键一律**大写、去空格**后比较。
 *
 * `cnjp`：取值依据**汉化随包字体就是 `Amayui CN` 一族**（`patch/patch.config.json` 同步它的 Regular+Bold
 * 两个文件），且汉化说明要求把所有字体分类都设为 `Amayui CN`
 * ⇒ 引擎侧的这些日文面名在汉化环境里**都渲染成 Amayui CN**，映射到别的字族就是错。
 * （旧 WenQuanYi 线的 `MSGothic_WenQuanYi_cnjp.ttf` 已废弃，不再有对应字族。）
 *
 * `jp`：纯日文资源 ⇒ 落到**未做 cnjp 替换**的更纱黑体，不再经 `Amayui CN` 的 cmap 置换日文码位。
 * ★该表**故意不含 `AMAYUI CN`**：纯日文资源下请求该面名是**错误配置**，不做特殊处理
 * （走通用回退 = 默认字族 `Sarasa Gothic SC` + 一条 `unknown` 日志）。
 *
 * 参考（引擎侧事实）：`$1$INITCONFIG0.txt:18-27` 把 `bbb/bbf=メイリオ`、`bbc/bbe=ＭＳ ゴシック`、
 * `bbd=游ゴシック` 写进全局字符串，脚本用 `set-font`(0x1A5)/`i2fe`(0x2FE) 取用；
 * `0x1A5` 的 handler（`sub_4328F0` raw 41385-41400）对**不在可选字体表内**的名字只打警告、
 * 仍然把名字写进 `Font+1260` ⇒ 名字本身不决定渲染器，落到哪个内置字族才是重写侧的事。
 */
const FACE_MAPS: Record<ResourceVersion, Record<string, string>> = {
  cnjp: {
    // 引擎默认的注音面（`sub_465390` raw 78875 硬编码 "ＭＳ ゴシック"）与 CONFIG 的可选面。
    ＭＳゴシック: CNJP_FAMILY,
    MSGOTHIC: CNJP_FAMILY,
    ＭＳ明朝: CNJP_FAMILY, // 随包无 Mincho 面 ⇒ 同渲染为 Amayui CN
    MSMINCHO: CNJP_FAMILY,
    メイリオ: CNJP_FAMILY, // ★消息窗主字体（bbb/bbf）—— 历史上被误映射到 WenQuanYi 的 `MS Gothic`
    MEIRYO: CNJP_FAMILY,
    游ゴシック: CNJP_FAMILY, // 同上（Yu Gothic）
    YUGOTHIC: CNJP_FAMILY,
    AMAYUICN: CNJP_FAMILY,
    'AMAYUI CN': CNJP_FAMILY,
    SARASAGOTHICSC: SARASA_FAMILY,
  },
  jp: {
    // 日文面名 → 未做 cnjp 替换的更纱黑体（`AMAYUI CN` 见上：错误配置，故意不列）。
    ＭＳゴシック: SARASA_FAMILY,
    MSGOTHIC: SARASA_FAMILY,
    ＭＳ明朝: SARASA_FAMILY,
    MSMINCHO: SARASA_FAMILY,
    メイリオ: SARASA_FAMILY,
    MEIRYO: SARASA_FAMILY,
    游ゴシック: SARASA_FAMILY,
    YUGOTHIC: SARASA_FAMILY,
    SARASAGOTHICSC: SARASA_FAMILY,
  },
};

/** 各版本查不到面名时的回退字族。 */
const DEFAULT_FAMILIES: Record<ResourceVersion, string> = {
  cnjp: CNJP_FAMILY,
  jp: SARASA_FAMILY,
};

/** 把引擎面名规范化成查表键：剥 `'@'` 前缀（GDI 竖排字体）、去首尾空白与内部空格、转大写。 */
export function normalizeFace(name: string): string {
  let s = name.trim();
  if (s.startsWith('@')) s = s.slice(1); // ★竖排前缀：`"@ＭＳ ゴシック"` → `"ＭＳ ゴシック"`
  return s.replace(/[\s\u3000]/g, '').toUpperCase();
}

/** 映射结果（`unknown=true` 表示引擎面名不在内置表里，已回退 —— 调用方应记一次日志）。 */
export interface FaceResolution {
  family: string;
  unknown: boolean;
}

/**
 * 引擎面名 → 内置字族（未知/空则回退该版本的默认字族并标 `unknown`）。
 *
 * `version` 省略 = `'cnjp'`（保持既有调用方/测试的行为不变）；渲染侧一律显式传
 * `Engine.resourceVersion`（由 `emulator.config.json` 的 `resources.version` 决定）。
 */
export function resolveFace(engineFace: string, version: ResourceVersion = 'cnjp'): FaceResolution {
  // 运行时兜底：`version` 来自 `Engine.resourceVersion`，理论上一定合法，但"半份选项/手写字面量"
  // 的历史调用点不走 tsc ⇒ 非法值一律按 cnjp（= 当前行为），绝不让查表返回 undefined 崩在渲染路径上。
  const table = FACE_MAPS[version] ?? FACE_MAPS.cnjp;
  const fallback = DEFAULT_FAMILIES[version] ?? DEFAULT_FAMILIES.cnjp;
  if (!engineFace) return { family: fallback, unknown: true };
  const hit = table[normalizeFace(engineFace)];
  return hit ? { family: hit, unknown: false } : { family: fallback, unknown: true };
}

/**
 * 解析"请求某个字重时该注册哪个文件、按什么字重注册"（按需加载用）。
 *
 * 三条分支（都要能解释得通，别让"加粗静默失效"再次发生）：
 *  1. 请求 700 且该族**有真 Bold 面** ⇒ 用 Bold 文件、按 **700** 注册（真粗体，浏览器不再合成）；
 *     当前 `Amayui CN`（`docs/font-build.md` §8.7）与 `Sarasa Gothic SC` 都属于这一类；
 *  2. 请求 700 但该族**只有 Regular** ⇒ 返回 `{ file: regular, weight: 400 }`：注册成 400，
 *     让宿主（浏览器）走"无粗体面"路径（合成加粗或忽略），**绝不**把 Regular 登记成 700
 *     —— 那等于宣称"这就是粗体"，会让 `i2bd 1` 静默无效；
 *  3. 请求 400 ⇒ Regular 文件、按 400 注册。
 */
export function fontFaceFor(family: string, reqWeight: 400 | 700): { file: string; weight: 400 | 700 } | null {
  const f = BUILTIN_FAMILIES.find((x) => x.family === family);
  if (!f) return null;
  if (reqWeight === 700 && f.files[700]) return { file: f.files[700], weight: 700 };
  const file = f.files[400];
  return file ? { file, weight: 400 } : null;
}

/**
 * 列出全部需要预载的 `(family, file)`（诊断/预热用）。
 *
 * ★只列**真面**：一族声明的 400/700 各一条。不要用 `files[w] ?? files[400]` 去"补"缺失的字重
 * —— 那会把同一个 Regular 文件同时说成 400 与 700，与 `fontFaceFor` 的口径矛盾
 * （旧实现就是这样，属于同一族的"加粗静默失效"隐患）。
 */
export function fontFileList(): { family: string; weight: 400 | 700; file: string }[] {
  const out: { family: string; weight: 400 | 700; file: string }[] = [];
  for (const f of BUILTIN_FAMILIES) {
    for (const w of [400, 700] as const) {
      const file = f.files[w];
      if (file) out.push({ family: f.family, weight: w, file });
    }
  }
  return out;
}

/**
 * **引擎侧"可选字体名列表"的等价物**（`Font+201664` 的 32B/条 向量，由 `EnumFontFamilies` 填充）。
 *
 * 引擎的 `0x2DE`（`sub_430DF0` → `sub_428990` raw 35124-35168）在这个表里线性查名并返回下标，
 * 查不到返回 **-1**；脚本用它的**符号**判断"保存的字体名是否还装着"
 * （`$1$CHECKCONFIG.txt:6-11`：`i2de` 得到 <0 就写回默认面名并保存）。
 *
 * 重写侧的表 = 我们真正支持的面名（引擎名 + 内置字族名）。顺序固定，便于脚本做 `lookup-array`。
 * ★表里的日文面名**只是"引擎装得到这个名字"的等价物**（供 CHECKCONFIG 的 `i2de` 判正负）：
 *   它们经 `FACE_MAP` 全部渲染为 `Amayui CN`（汉化环境即如此，见文件头「字体政策」）。
 * ★`sub_428990` 查表前会把查询串开头的 `'@'` 去掉（raw 35149 `&a2[*a2 == 64]`），这里同样处理。
 */
export const ENGINE_FONT_LIST: readonly string[] = [
  'ＭＳ 明朝',
  'ＭＳ ゴシック',
  'メイリオ',
  '游ゴシック',
  'Amayui CN',
  'MS Gothic',
  'MS Mincho',
  'Meiryo',
  'Sarasa Gothic SC',
];

/** 在可选字体名列表里线性查名（剥 `'@'` 前缀、大小写与空格不敏感）；查不到返回 -1。 */
export function fontListIndex(name: string): number {
  if (!name) return -1;
  const k = normalizeFace(name);
  return ENGINE_FONT_LIST.findIndex((x) => normalizeFace(x) === k);
}

// ---------------------------------------------------------------------------
// ★引擎 `sub_459F40` / `sub_45A6E0` 建的 GDI 句柄组与度量缓冲（`tickets/T-0151`）
// ---------------------------------------------------------------------------
// 审计（`lazy-gdi-font-set`/missing-behavior）：重写侧此前只做 `(family,weight,size)→文件` 的选择，
// 引擎重建的**一整组**句柄（含字形度量面、Aspect 修正面、两张 1800 竖排面）与**字形度量/位图缓冲**
// 整块没有对应物。这里把体里**实际建的每一格**落成数据（raw 锚点逐个标），再把"重写侧没有等价物"
// 的那几格登记进 `GDI_FACE_REBUILD_NOT_MODELED` —— **不是为了模仿 GDI**，而是为了让"缺了什么"可核对：
// 下一轮审计不必再从 700 行反汇编里重数一遍 `CreateFontIndirectA` 的次数与槽号。
//
// 为什么这条必须留痕（`whySilent`）：这些句柄为 0 时 GDI 的 `SelectObject` **静默退化**，
// 面名为空（`Font+1260` 首字节 0，raw 70984）则整个重建直接 `return` ⇒ 文字用系统默认字体画出来，
// 全程没有一行错误输出；Aspect/缩放修正漏掉则只是"字号差 1px / 比例不对"。

/**
 * 引擎重建出的**一支 GDI 句柄**（槽号 = `Font` 对象字节偏移；`raw` = 那次 `CreateFontIndirectA`）。
 *
 * 字段语义都以 `sub_459F40`/`sub_45A6E0` 的体为准：
 *  - `template`：用的哪支 LOGFONTA 模板。`Font+1232`（面名 `Font+1260`）与 `Font+1292`（面名 `Font+1320`）
 *    是主/注音本体模板；`Font+101972`（面名 `Font+102000` = `"@" + 主面名`）与 `Font+102032`
 *    （面名 `Font+102060` = `"@" + 注音面名`）是它们的 `@` 竖排变体（`Initialize` raw 78882-78883 把
 *    `Font+102040/+102044` 设成 2700）。
 *  - `face`：建之前把面名改成了什么（`raw 71097` 写 `aAgeExtend[] = "AGE Extend"`、
 *    `raw 71099` 写 `aAgeExtend_0[] = "@AGE Extend"`）；`main`/`@main`/`ruby`/`@ruby` = 沿用模板面名。
 *  - `size`：`base` = 用模板自己的 `lfHeight`；`scaled` = 走过 `Font+1232 × Font+218596 + 0.5`
 *    （raw 71055 / 71059 / 71240）那一步。
 *  - `rotated1800`：**只有** raw 71178-71186 的两支把 `lfEscapement`/`lfOrientation` 设成 1800。
 */
export interface GdiFaceSlot {
  /** 引擎里的句柄槽（`Font` 对象字节偏移）。 */
  slot: string;
  /** 那次 `CreateFontIndirectA` 的 raw 行号。 */
  raw: string;
  template: 'main' | '@main' | 'ruby' | '@ruby';
  face: 'main' | '@main' | 'ruby' | '@ruby' | 'AGE Extend' | '@AGE Extend';
  size: 'base' | 'scaled';
  rotated1800: boolean;
  role: string;
}

/**
 * 引擎重建的句柄组：**主套 10 支 + 注音套 4 支**（`sub_459F40` raw 71170-71187 / `sub_45A6E0` raw 71263-71272）。
 *
 * ★"10" 是数出来的，不是抄来的：`DeleteObject` 清单（raw 71144-71169 的 9 支 + raw 71039 的
 * `Font+101852`）与 `CreateFontIndirectA` 一一对应。旧台账把主套记成 ×8 并漏掉 `Font+101852`
 * （字形度量面）与两张 1800 竖排面 —— 审计 `lazy-gdi-font-set`/overreach 已点名。
 */
export const GDI_FACE_REBUILD: { readonly main: readonly GdiFaceSlot[]; readonly ruby: readonly GdiFaceSlot[] } = {
  main: [
    {
      slot: 'Font+101852',
      raw: '71042',
      template: '@main',
      face: '@main',
      size: 'base',
      rotated1800: false,
      role: '★字形度量面：紧接着 raw 71045 `GetTextMetricsA(HDC, Font+101860)`；`sub_404EE0` 量宽用的就是它',
    },
    { slot: 'Font+1084', raw: '71171', template: 'main', face: 'main', size: 'base', rotated1800: false, role: '主面（原样模板）；raw 71187 最后被 SelectObject 进度量 IC' },
    { slot: 'Font+1100', raw: '71172', template: 'main', face: 'main', size: 'scaled', rotated1800: false, role: '主面（缩放修正 raw 71055-71090）' },
    { slot: 'Font+218624', raw: '71173', template: '@main', face: '@main', size: 'scaled', rotated1800: false, role: '@主面（缩放修正 raw 71059-71060）' },
    { slot: 'Font+235068', raw: '71174', template: 'main', face: 'AGE Extend', size: 'base', rotated1800: false, role: 'AGE Extend 主面（raw 71096-71097 换面名）' },
    { slot: 'Font+235076', raw: '71175', template: '@main', face: '@AGE Extend', size: 'base', rotated1800: false, role: '@AGE Extend 主面（raw 71098-71099 换面名）' },
    { slot: 'Font+235072', raw: '71176', template: 'main', face: 'AGE Extend', size: 'scaled', rotated1800: false, role: 'AGE Extend 主面（缩放 raw 71106-71131）' },
    { slot: 'Font+235080', raw: '71177', template: '@main', face: '@AGE Extend', size: 'scaled', rotated1800: false, role: '@AGE Extend 主面（缩放 raw 71107-71131）' },
    { slot: 'Font+235100', raw: '71182', template: '@main', face: '@AGE Extend', size: 'base', rotated1800: true, role: '★竖排面：raw 71178-71179 设 lfEscapement/lfOrientation = 1800' },
    { slot: 'Font+235104', raw: '71183', template: '@main', face: '@AGE Extend', size: 'scaled', rotated1800: true, role: '★竖排面（缩放副本）：raw 71180-71181 设 1800' },
  ],
  ruby: [
    { slot: 'Font+1096', raw: '71229', template: 'ruby', face: 'ruby', size: 'base', rotated1800: false, role: '注音面（原样模板）；raw 71232 `GetTextMetricsA(HDC, Font+1168)`' },
    { slot: 'Font+218568', raw: '71265', template: 'ruby', face: 'ruby', size: 'scaled', rotated1800: false, role: '注音面（缩放修正 raw 71240-71254）' },
    { slot: 'Font+218628', raw: '71266', template: '@ruby', face: '@ruby', size: 'scaled', rotated1800: false, role: '@注音面（缩放修正）' },
    { slot: 'Font+101856', raw: '71269', template: '@ruby', face: '@ruby', size: 'base', rotated1800: false, role: '★@注音面：`sub_456B80` raw 68661-68662 在画注音前把它选进两个 DC' },
  ],
};

/**
 * 引擎的**内部派生面名**（`aAgeExtend[] = "AGE Extend"` raw 4455、`aAgeExtend_0[] = "@AGE Extend"` raw 4678）。
 *
 * ★这两支被 `0x1A5`/`0x2FE` 的 handler **显式豁免**白名单警告：
 * `if (sub_428990(_this, Source) < 0 && strcmp(Source, aAgeExtend))`（raw 41385 / raw 41613）
 * ⇒ "AGE Extend" 是引擎自己写进去的合法面名，不是"装不到的用户面名"。
 * 重写侧目前**没有**为它做映射（`FACE_MAPS` 里没有 ⇒ `resolveFace` 回退 + `unknown: true`）——
 * 这是**有据的缺口**（落哪支内置字族未证），登记见 `GDI_FACE_REBUILD_NOT_MODELED` 的 `71097` 条。
 */
export const AGE_EXTEND_FACES: readonly string[] = ['AGE Extend', '@AGE Extend'];

/**
 * 引擎的**字形位图缓冲**尺寸（纯算术；重写侧无等价物 ⇒ 只登记，供宿主按需分配、或明确不分配）。
 *
 * ```c
 * // 注音两块（raw 71028-71035）：t = Font+101972 = −字号
 * v11 = abs32(4 * (t / 4) + 4);                     // C 整数除法**向零截断**
 * Font+102092 = operator new[](4 * v11 * v11);      // 位图
 * Font+102096 = operator new[](4 * |q| * |q|);      // 另一块（同长）
 * Font+102100 = 4 * |q| * |q|;                      // 字节数（GetGlyphOutline 的 cbBuffer，raw 85120）
 * // 主套两块（raw 71138-71141）：h = Font+1232 = −字号
 * Font+1408 = Font+1412 = operator new[](16 * (h/4 − 1)^2);
 * Font+1416 = (h/4 − 1) * (16 * (h/4) − 16);        // = 16*(h/4−1)^2 ⇒ 与每块长度恒等
 * ```
 * @param stage `'main'` = `Font+1408/+1412/+1416`；`'ruby'` = `Font+102092/+102096/+102100`
 * @param size  字号（`Font+201684`，正数）；引擎里的 `lfHeight` 是它的相反数
 */
export function glyphBitmapBufferBytes(stage: 'main' | 'ruby', size: number): { each: number; sizeWord: number } {
  const h = -Math.abs(size); // Font+1232 / Font+101972 = −字号
  const q = Math.trunc(h / 4); // C 的整数除法向零截断
  if (stage === 'main') {
    const n = q - 1;
    return { each: 16 * n * n, sizeWord: n * (16 * q - 16) };
  }
  const m = 4 * (q + 1); // abs32(4*(t/4)+4)
  return { each: 4 * m * m, sizeWord: 4 * m * m };
}

/**
 * 引擎的 **lfHeight 缩放步**（`sub_459F40` raw 71055 / 71059、`sub_45A6E0` raw 71240）：
 * `lfHeight = (int)(模板 lfHeight × Font+218596 + 0.5)`，`+0.5` 是 `dbl_51D7F8`（raw 4197 = `0.5`）。
 *
 * ★注意 C 的 `(int)` 是**向零截断**：默认 `Font+218596 = 1.0`（raw 78767）时
 * `−30 × 1.0 + 0.5 = −29.5 ⇒ −29` —— 缩放修正**在缩放 1 时也不是恒等**（`base` 面用模板原值 −30、
 * `scaled` 面用 −29，两者差 1px）。这条以前整块缺失，现在至少是显式的。
 */
export function aspectScaledLfHeight(lfHeight: number, scale: number): number {
  return Math.trunc(lfHeight * scale + 0.5);
}

/**
 * 引擎的 **lfWidth 纵横比修正**（raw 71088-71090 / 71130-71131 / 71252-71254）：
 * `lfWidth = (int)(lfWidth ÷ Font+218596 × Font+218592)`。
 *
 * 门（三处同形）：`dword_55E1BC` 非 0 **且** `GetConfig("display:AspectMode") == 1`（raw 4257）
 * **且** `Font+218596 != Font+218592`（两个缩放因子不等）—— 否则原样返回。
 */
export function aspectCorrectedLfWidth(lfWidth: number, scale: number, baseScale: number): number {
  return Math.trunc((lfWidth / scale) * baseScale);
}

/**
 * **量宽用哪支句柄**（审计点名的"关键格"）：`sub_404EE0`（raw 10716-10739）的
 * `if (*(_DWORD *)(_this + 201680)) Font+1092 = SelectObject(Font+1108, Font+201784);`（raw 10733-10734）。
 *
 *  - `Font+201784`：`sub_456C90`（raw 68678-68722）单独建的一支**参考面**，面名写死
 *    `asc_52686C = "ＭＳ ゴシック"`（raw 4671），`lfHeight = −Font+201684`、`lfWidth = Font+201684 / −2`
 *    （raw 68697-68700），并用 `GetGlyphOutline(HDC, 0x8C83, …)` 取参考字度量（raw 68718）。
 *  - `Font+101852`：`Font+201680 == 0` 时不重选 ⇒ 用度量 IC 上**当时已选中**的那支；重建流程把它留在
 *    `Font+101852`（raw 71041-71046），`sub_456B80`（raw 68661-68662）画注音前也再选它一次。
 *
 * ★`Font+201680` 全库只有 raw 78769 / 78895 两处写、都是 `= 0` ⇒ 本 build 里恒 0 ⇒ 走后者。
 */
export function metricFaceSlot(fontMetricsFlag: number): string {
  return fontMetricsFlag !== 0 ? 'Font+201784' : 'Font+101852';
}

/**
 * 引擎重建里**重写侧没有等价物**的格（有据登记；`what`/`why`/`recheck` 三段都要写）。
 *
 * 判据：这些格是 GDI 的设备相关资源（TEXTMETRICA 快照、字形位图缓冲、缩放因子、内部参考面），
 * 重写侧用浏览器/自建光栅器**结构上不同构**；同构的那部分（面名 + 字号/字重/竖排参数）已由
 * `resolveFace`/`fontFaceFor`/`MsgWindow.font` 建模。缺口在"缺了会怎样"上是可解释的：
 * 句柄为 0 时 GDI 静默退化（见本节的 `whySilent`），所以**不能靠报错发现**。
 */
export const GDI_FACE_REBUILD_NOT_MODELED: readonly { raw: string; what: string; why: string; recheck: string }[] = [
  {
    raw: '71045',
    what: '主套的 `GetTextMetricsA(Font+1108, Font+101860)`：`Font+101852` 那支字形度量面的 `TEXTMETRICA` 快照（含 `tmAscent`，绘制落点 raw 68489/68628 要用）。',
    why: '浏览器 canvas 没有 `TEXTMETRICA`；`measureText` 只给 advance width。重写侧的字形基线由 `raster.ts` 自己定 ⇒ 结构上不同构。',
    recheck: '当真机文本**整体垂直偏移**（尤其 `Font+201680 == 1` 那条 `+Font+201712 − tmAscent`，raw 68488-68489）时，回来查该用 `TextMetrics.fontBoundingBoxAscent` 还是固定偏移。',
  },
  {
    raw: '71232',
    what: '注音套的 `GetTextMetricsA(Font+1108, Font+1168)`：注音面的 `TEXTMETRICA` 快照。',
    why: '同上（浏览器无 TEXTMETRICA）。',
    recheck: '当注音垂直位置与真机差一档时（`Font+1292`/`Font+102036` 那条 −字号 偏移之外还有 tmAscent 参与）。',
  },
  {
    raw: '71029',
    what: '注音字形位图缓冲 `Font+102092` / `Font+102096`（各 `4·N²` 字节，`N = |4·(Font+101972/4)+4|`）与字节数 `Font+102100`。',
    why: '它们是 `GetGlyphOutline(GGO_GRAY4)` 的输出缓冲（消费点 raw 85120-85121）。重写侧直接拿 canvas 字形位图，没有"先申请缓冲再让 GDI 填"这一步。',
    recheck: '当出现"字形被裁剪/在离屏槽里位置偏"且排除排版原因后，核对该缓冲的边长口径（`N` vs 实际字形外框）。',
  },
  {
    raw: '71138',
    what: '主套字形位图缓冲 `Font+1408` / `Font+1412`（各 `16·(h/4−1)²` 字节）与 `Font+1416`（= 同值字节数，raw 71141 展开后恒等）。',
    why: '同上；另外受 `Font+1356 == 1` 时调用的 `sub_4745A0`（raw 89204 起：按填充色/表面位深 16/24/32bpp 建 `Font+1420` 起的 17 个 WORD 位移表）支配 —— 那是 GDI 位图掩码合成，重写侧用 canvas 的 alpha 合成。',
    recheck: '当描边/抗锯齿的**像素级**观感与真机不一致、且已排除颜色与档位因素时。',
  },
  {
    raw: '71028',
    what: '缩放修正的**输入**：`Font+218592`（基准缩放，raw 78765 初值 1.0）与 `Font+218596`（当前缩放，raw 78767 初值 1.0），以及 `display:AspectMode`（raw 4257）这道门。',
    why: '重写侧没有"逻辑分辨率 / 实际显示比例"这对字段（`MsgWindow.font` 只有 family/size/weight），无法判断该不该做纵横比修正。',
    recheck: '当 `display:AspectMode=1` 且逻辑/物理分辨率不等（非 1280×720 或非整数 DPR）时，核对面/字形宽度是否该按 `218592/218596` 修正。',
  },
  {
    raw: '71097',
    what: '内部派生面名 `"AGE Extend"` / `"@AGE Extend"`（raw 71097/71099；引擎在 `0x1A5`/`0x2FE` 里对它豁免白名单警告，raw 41385/41613）在重写侧的落地字族。',
    why: '未证：引擎只是把模板面名换成字面量 `"AGE Extend"` 再 `CreateFontIndirectA`；GDI 找不到该面时**静默替换默认字体**，所以"它到底渲染成哪个字族"从体里读不出来。',
    recheck: '拿到真机 E4 截图（同一条文本分别经 `Font+235068..235104` 与 `Font+1084` 画）后比对字形，再决定映射；此前保持 `resolveFace` 回退 + `unknown` 日志（不许猜成 Amayui CN）。',
  },
];
