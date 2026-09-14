# T-0026 · 过程笔记（notes.md）

> 本文记录**为什么开这张单**：`emulator.config.json` 是什么、字体政策现在是什么、以及为什么
> 「资源版本」必须被显式标记出来。所有结论都指向工程内**已存在**的文件（行号随重构会漂，以锚点为准）。

## 1. `emulator.config.json` 是什么（背景调查）

| 问题 | 答案 | 依据 |
|---|---|---|
| 它是什么 | 仓库根的 JSON，**只影响「怎么跑」**的运行开关；**不是**游戏配置，**绝不写回、不进存档** | `emulator.config.json` 的 `$comment`；`src/emulatorOptions.ts` 文件头 |
| 和 `SYS4REG.INI` 什么关系 | 那份是**游戏的**玩家配置（设置界面写它、存档里有它，`src/engineConfig.ts`）；这份是**重写侧/测试侧的**运行开关，真游戏里没有这个概念 | `src/emulatorOptions.ts:1-5` |
| 怎么开始用 | 复制入库的示例 `emulator.config.example.json` → `emulator.config.json` 再改；后者**本机私有**（gitignore），避免「我改了它 → 别人测试红」 | `docs-new/04-app/emulator.md` §8（:215-217） |
| 路径 | 默认 `<仓库根>/emulator.config.json`；环境变量 `AMAYUI_EMULATOR_CONFIG` 可换任意路径 | `src/emulatorOptionsFile.ts` 的 `resolveOptionsPath` |
| 现在有哪些键 | **只有一个**：`boot.showLogo`（boolean，默认 `true`） | `src/emulatorOptions.ts` 的 `EmulatorOptions` / `DEFAULT_EMULATOR_OPTIONS` |
| 解析纪律 | **永不抛**：坏 JSON / 未知键 / 类型不对 ⇒ 默认值 + 一条 `problems`（未知键也报，因为文件是人手改的，拼错会导致「以为跳过了 LOGO 其实没跳」） | `parseEmulatorOptions()` 及其注释 |
| 谁读它 | 只有 **CLI / Electron 入口**（`run.ts` / `report.ts` / `opInventory.ts` / `diagText.ts` / Electron `boot.ts` / `configBoot.ts`）；**库入口一律用 `DEFAULT_EMULATOR_OPTIONS`** | `docs-new/04-app/emulator.md` §8（:234-236） |
| 测试怎么隔离 | `npm test` 用 `test/options.test.env` 把 `AMAYUI_EMULATOR_CONFIG` 钉到 `emulator.config.test.json`（= 全默认）⇒ 本机配置不影响测试 | `docs-new/04-app/emulator.md` §8（:239-244） |
| 新增选项的清单 | ① 同步文档表 + `emulatorOptions.ts` 文件头表；② 在 `test/emulator-options.test.ts` 加一条（拼错的键必须报 problem，不许静默） | `docs-new/04-app/emulator.md` §8（:237-238） |

> 「它为什么存在」的原始动机是 LOGO/版权页跳过（`src/LOGO.txt` 59 行的等待 + `LOGO.MPG`），
> 但**文件名与机制是通用的运行开关**：新增键不需要新机制，只要扩展 `EmulatorOptions` 与解析分支。

## 2. 字体政策现在是什么（问题的根）

`src/text/fontSet.ts` 的文件头把政策写死成**单一 cnjp 政策**：

- `FACE_MAP`：`ＭＳゴシック` / `ＭＳ明朝` / `メイリオ` / `游ゴシック` / `AMAYUICN` … **全部** → `Amayui CN`；
- `DEFAULT_FAMILY = 'Amayui CN'`：表里查不到也回退到它；
- `ENGINE_FONT_LIST` 里的日文面名只是「引擎装得到这个名字」的等价物，渲染时同样落到 `Amayui CN`。

这条政策对**汉化版（cnjp）是对的**，理由是引擎侧与分发侧一致：

- 汉化脚本把简体字写成 **cp932 可编码的日文写法占位**（`scripts/lib/sjis-encode.js` + `res/subs_cn_jp.json`）；
- `Amayui-CN_cnjp.ttf` 的 cmap 把**日文写法码位 → 简体字形**，于是占位码位显示成简体；
- `patch/patch.config.json` 随包分发 `Amayui-CN_cnjp.ttf`（+ Bold），说明要求玩家把全部字体分类设为 `Amayui CN`。
  见 `docs-new/01-translation/encoding-font.md`、`docs-new/00-overview/authority.md`。

**风险点**：同一张 cmap 对**纯日文资源**（`raw/`）是破坏性的 —— 原版日文文本本来就该显示日文字形，
却会被换成简体字形（`说/説`、`为/為` 这类同形替换肉眼可见）。而这条路径是**支持的**：
`src/arch/resourceDir.ts` 默认 `install/`（汉化版），`AMAYUI_RESOURCE_DIR=raw` 可切原版日文，
README 明确写着用它对比原版。**没有任何地方记录「现在这套资源是哪一版」**，字体政策也不会跟着变。

## 3. 需求（用户原话的落点）

> 添加一个新的配置项，标记资源的版本，有两个可选值：
> `jp` → 纯日文资源，应该直接使用系统的更纱黑体；`cnjp` → ShiftJIS 编码的中文资源，应该使用 Amayui CN。

即：把「资源版本」从**隐式**（只看环境变量选了哪个根）变成**显式配置**，并让**字体策略随它分叉**。

## 4. 建议设计（未定稿；实现前先确认 §5）

- **键名/位置**：建议 `resources.version`（对象 `resources`，与 `boot` 平级），取值 `'jp' | 'cnjp'`。
  也可叫 `font.resourceVersion`（更贴「它驱动字体」）——**待确认**。
- **默认值**：`'cnjp'`，与默认资源根 `install/`（汉化版）一致 ⇒ 不配就是当前行为，测试不受影响。
- **分叉点**：把 `fontSet.ts` 的 `FACE_MAP` / `DEFAULT_FAMILY` 变成按版本取的两张表（或 `resolveFace(face, version)`）；
  `jp` 表把日文面名落到**未做 cnjp 替换**的更纱黑体，`AMAYUI CN` 这类汉化专属面名在 jp 下可保留或告警（待定）。
- **传递路径**：渲染进程已经经 IPC 拿 `readEmulatorOptions()` 的文本（`configBoot.ts` 的
  `loadEmulatorOptionsFile`），把解析结果传到 `resolveFace` 即可；headless/CLI 走 `emulatorOptionsFile.ts`。
- **诊断**：日志里打「本次字体策略 = jp/cnjp」一行，避免「改了配置但不知道生效没有」。

## 5. 未确认项（实现前需要用户拍板）

1. **「系统的更纱黑体」指哪一个**：工程 `res/fonts/SarasaGothicSC/` 里**自带**了 SC Regular+Bold
   （`fontSet.ts` 的 `Sarasa Gothic SC` 字族），但 emulator 的既定原则是「不依赖操作系统字体（跨平台一致性）」。
   ⇒ 是继续用**随工程**的 SarasaGothicSC，还是真去用 **OS 安装**的 Sarasa Gothic？后者要先放宽那条原则。
2. **jp 用 SC 还是 J 版**：`res/fonts/` 只有 `SarasaGothicJ-TTF-1.0.40.7z`（未解包），SC 版含假名但汉字是简体字形；
   纯日文资源理想基底是 **Sarasa Gothic J**。是否要解包/入库 J 版？
3. **键名与归属**：`resources.version` vs `font.resourceVersion` vs `resourceVersion`（顶层）。
   ⇒ **已定（2026-09-14）：`resources` 前缀，两键共用（`resources.version` + `resources.path`），见 §6。**
4. **该键是否也驱动资源根**：现在根由 `AMAYUI_RESOURCE_DIR` 选。要不要让配置键与资源根**互相校验**
   （两边不一致时至少报一条 problem）？还是只做「字体策略」一件事？
   ⇒ **已定（2026-09-14）：版本键只驱动字体；资源根改由新增的 `resources.path` 驱动（§6）。
   不做路径猜测式互校（路径名不可靠），替代 = 日志同一行打印 path + version。**
5. **`AMAYUI CN` 面名在 jp 下的语义**：引擎的字体白名单里有 `Amayui CN`（`ENGINE_FONT_LIST`），
   jp 下请求它应该落到哪里（更纱黑体？还是保持 Amayui CN 并告警？）。

## 2026-09-14

### 决策（2026-09-14，用户确认）

- **`jp` 的落地字体 = 工程自带的 `res/fonts/SarasaGothicSC`（`Sarasa Gothic SC` 字族 Regular+Bold）**，即 §5 未确认项 1 与 2 的答案：
  - 不用 **OS 安装**的 Sarasa Gothic —— emulator 的「不依赖操作系统字体（跨平台一致性）」原则保持不变；
  - 不用 `res/fonts/SarasaGothicJ-TTF-1.0.40.7z`（未解包）—— 不引入新基底；
  - `SarasaGothicSC` 正是 `Amayui CN` 的基底（`docs-new/01-translation/encoding-font.md` §3、`docs/font-build.md` §8），
    两者只差「有没有做 cnjp cmap 替换」⇒ 分叉点干净：`jp` = 原味基底，`cnjp` = 替换版。
- 对应判据已同步进 `acceptance` 第 3 条（写明字族与「不依赖 OS」）。
- 仍未定（实现前可继续拍板）：`AMAYUI CN` 面名在 jp 下的落点（§5 第 5 条）。

## 6. 补充需求：`resources.path`（同一前缀）+ 优先序（2026-09-14 用户确认）

原需求只说「标记资源版本」（决定**字体**），但资源根现在也只由 `AMAYUI_RESOURCE_DIR` / CLI 选择、**没进配置**
（`resolveResourceDir` 只看 env + 默认 `install/`）。补充：**再加一个字段指定资源路径**，与版本键
**共用同一前缀**。已确认的两个决策：

1. **前缀 = `resources`**（与 `boot` 平级）⇒ 两个键：`resources.version`、`resources.path`。
   不叫 `font.resourceVersion`：因为 path 与字体无关，它是整根资源树的所在；两键放同一段也保证
   「换资源」时不会只改一半（见下面第 3 条的日志要求）。
2. **优先序 = CLI `--resources` > 环境变量 `AMAYUI_RESOURCE_DIR` > `resources.path` > 默认 `install/`**。
   理由：环境变量/CLI 是**单次调用的临时覆盖**（测试、临时对比原版照旧可用，既有文档与工具不动），
   配置里的 `resources.path` 是**持久默认值**。`--resources` 现在在 `src/report.ts:348-350`（`--raw` 旧名兼容）。

### 路径语义（实现要点）

- **相对基准 = 生效的 config 文件所在目录** —— 注意**不是仓库根、也不是 cwd**：
  `AMAYUI_EMULATOR_CONFIG` 可以把 options 文件指到任意位置（`resolveOptionsPath`），
  此时 `resources.path` 的 `./raw` 应当相对**那份 config**。⇒ 解析必须发生在「知道 config 路径」的一侧
  （CLI / Electron 主进程），或把 config 的 `dirname` 一起带出来；纯函数 `parseEmulatorOptions(text)`
  **不能**假设自己知道路径（它的入参只有文本）。
- **绝对路径直接采用**（与 `AMAYUI_RESOURCE_DIR`、`resolveOptionsPath` 同一套 `path.isAbsolute` 约定）。
- **不做版本猜测**：`resources.version` 的缺省恒为 `cnjp`，**不**根据 path 是不是 `raw` 去推断
  （路径名不可靠）。替代做法是**两个值同时打进日志一行**，让「换了 path 忘改 version」当场可见。

### 新增/变更的判据（已写入 `acceptance`）

- 新增 `resources.path` 与优先序、相对基准、真正驱动资源根（位图 sha1 / 脚本正文差异为证）、
  日志同打 path+version 共 5 条；原「字体分叉」条改为挂在 `resources.version` 下。
- 证据新增两条锚点：`resourceDir.ts` 的 `resolveResourceDir`（唯一解析点，现在没有 config 输入）、
  `report.ts` 的 `arg('resources')`（最高优先的 CLI 覆盖）。

