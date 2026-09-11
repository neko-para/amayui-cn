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
 * 汉化随包字体**只有** `Amayui-CN_cnjp.ttf`（Sarasa Gothic SC 基底 + cnjp 字形替换 +
 * 唯一族名 `Amayui CN`；`patch/patch.config.json` 的字体条目也只同步这一个文件）。
 * 汉化说明（`patch/README-测试版说明.md` 第 8 步）要求玩家把**全部**字体分类
 * （説明文 / パラメータ文字/数字 / ＡＤＶルビ / ＡＤＶメッセージ）都设为 `Amayui CN`
 * —— 也就是引擎侧无论拿到 `メイリオ`、`ＭＳ ゴシック`、`游ゴシック` 还是 `ＭＳ 明朝`，
 * 实际渲染的都是 `Amayui CN`。
 *
 * 因此 `FACE_MAP` 把**所有**日文面名都指向 `Amayui CN`，并**彻底摘掉**旧 WenQuanYi 线：
 * `MSGothic_WenQuanYi_cnjp.ttf`（族名伪装成 `MS Gothic`）属已废弃基底
 * （见 `docs/font-build.md` §8「基底更新：WenQuanYi → SarasaGothicSC」、
 * `docs-new/00-overview/authority.md`），**不再作为任何面名的落地字族** ——
 * 历史错误：`メイリオ`（`$1$INITCONFIG0.txt:18` 设给 `bbb`，即消息窗主字体）被映射到
 * `MS Gothic`，于是 ADV 正文实际用 WenQuanYi 渲染（日志实证
 * `[font] MS Gothic#400 ← MSGothic_WenQuanYi_cnjp.ttf（4880KB）`）。
 */

/**
 * 一个内置字族：`family` = 注册进 `document.fonts` 的名字，`file` = `res/fonts/` 下的相对路径。
 *
 * ★`files` 的键是**该文件自己声明的字重**（读 TTF 的 name 表确认过），不是"我们想让它扮演的字重"：
 *  - 汉化随包的 `Amayui-CN_cnjp.ttf`（family 名就叫 `Amayui CN`）**只有 Regular**；
 *  - 把 Regular 文件**注册成 700** 会让浏览器认为"这就是粗体面"、于是**不再合成加粗**
 *    ⇒ 脚本要的 `lfWeight=700` 完全失效；反之只注册 400，浏览器会**合成**加粗（与 GDI 对无粗体面的处理一致，也更轻）。
 *  - Sarasa 有真的 Bold 面（`-Bold.ttf`），所以它按 700 注册。
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
    // 汉化随包字体：TTF 的 family 名就是 `Amayui CN`（只有一个 Regular 面）。
    // ★所有引擎面名都落到这里（见文件头「字体政策」）—— 包括主面 `bbb=メイリオ` 与注音面 `bbc=ＭＳ ゴシック`。
    family: 'Amayui CN',
    files: { 400: 'Amayui-CN_cnjp.ttf' },
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

/**
 * 引擎面名 → 内置字族。键一律**大写、去空格**后比较。
 *
 * ★取值依据**汉化随包字体只有 `Amayui CN` 这一个**（`patch/patch.config.json` 只同步
 * `res/fonts/Amayui-CN_cnjp.ttf`），且汉化说明要求把所有字体分类都设为 `Amayui CN`
 * ⇒ 引擎侧的这些日文面名在汉化环境里**都渲染成 Amayui CN**，映射到别的字族就是错。
 * （旧 WenQuanYi 线的 `MSGothic_WenQuanYi_cnjp.ttf` 已废弃，不再有对应字族。）
 *
 * 参考（引擎侧事实）：`$1$INITCONFIG0.txt:18-27` 把 `bbb/bbf=メイリオ`、`bbc/bbe=ＭＳ ゴシック`、
 * `bbd=游ゴシック` 写进全局字符串，脚本用 `set-font`(0x1A5)/`i2fe`(0x2FE) 取用；
 * `0x1A5` 的 handler（`sub_4328F0` raw 41385-41400）对**不在可选字体表内**的名字只打警告、
 * 仍然把名字写进 `Font+1260` ⇒ 名字本身不决定渲染器，落到哪个内置字族才是重写侧的事。
 */
const FACE_MAP: Record<string, string> = {
  // 引擎默认的注音面（`sub_465390` raw 78875 硬编码 "ＭＳ ゴシック"）与 CONFIG 的可选面。
  ＭＳゴシック: 'Amayui CN',
  MSGOTHIC: 'Amayui CN',
  ＭＳ明朝: 'Amayui CN', // 随包无 Mincho 面 ⇒ 同渲染为 Amayui CN
  MSMINCHO: 'Amayui CN',
  メイリオ: 'Amayui CN', // ★消息窗主字体（bbb/bbf）—— 历史上被误映射到 WenQuanYi 的 `MS Gothic`
  MEIRYO: 'Amayui CN',
  游ゴシック: 'Amayui CN', // 同上（Yu Gothic）
  YUGOTHIC: 'Amayui CN',
  AMAYUICN: 'Amayui CN',
  'AMAYUI CN': 'Amayui CN',
  SARASAGOTHICSC: 'Sarasa Gothic SC',
};

/** 默认字族（表里查不到时的回退；也是随包 `message:Font` 的值）。 */
export const DEFAULT_FAMILY = 'Amayui CN';

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

/** 引擎面名 → 内置字族（未知则回退 `DEFAULT_FAMILY` 并标 `unknown`）。 */
export function resolveFace(engineFace: string): FaceResolution {
  if (!engineFace) return { family: DEFAULT_FAMILY, unknown: true };
  const hit = FACE_MAP[normalizeFace(engineFace)];
  return hit ? { family: hit, unknown: false } : { family: DEFAULT_FAMILY, unknown: true };
}

/**
 * 解析"请求某个字重时该注册哪个文件、按什么字重注册"（按需加载用）。
 *
 * ★返回的 `weight` 是**文件自己声明的字重**：请求 700 但该字族只有 Regular 时，
 * 返回 `{ file: regular, weight: 400 }` —— 注册成 400 才能让浏览器**合成**加粗；
 * 注册成 700 会让浏览器以为"这就是粗体面"而跳过合成（那样 `i2bd 1` 就白设了）。
 */
export function fontFaceFor(family: string, reqWeight: 400 | 700): { file: string; weight: 400 | 700 } | null {
  const f = BUILTIN_FAMILIES.find((x) => x.family === family);
  if (!f) return null;
  if (reqWeight === 700 && f.files[700]) return { file: f.files[700], weight: 700 };
  const file = f.files[400];
  return file ? { file, weight: 400 } : null;
}

/** 列出全部需要预载的 `(family, file)`（诊断/预热用）。 */
export function fontFileList(): { family: string; weight: 400 | 700; file: string }[] {
  const out: { family: string; weight: 400 | 700; file: string }[] = [];
  for (const f of BUILTIN_FAMILIES) {
    for (const w of [400, 700] as const) {
      const file = f.files[w] ?? f.files[400];
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
