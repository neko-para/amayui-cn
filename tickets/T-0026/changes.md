# T-0026 · 变更记录（changes.md）

## 第 1 次变更（2026-09-14）：实现 `resources` 段（`version` + `path`）

### 改了什么（按文件）

| 文件 | 改动 |
|---|---|
| `app/amayui-emulator/src/emulatorOptions.ts` | 新增 `ResourceVersion` / `RESOURCE_VERSIONS`、`EmulatorOptions.resources{version,path}`、解析与 problem 上报、`normalizeEmulatorOptions()`（半份选项兜底）、`applyEmulatorOptionsToEngine()`（写 `Engine.resourceVersion`）；文件头改成 `boot`/`resources` 两节表 + 「为什么需要 `resources` 段」 |
| `app/amayui-emulator/src/arch/resourceDir.ts` | 新增唯一权威 `decideResourceDir()`（**CLI > env > config > 默认**）+ `ResourceDirSource`/`ResourceDirDecision` + `describeResourcesLine()`（**同一行**打 path+version）；`resolveResourceDir()` 保留为「只看 env + 默认」的库口径（不读文件） |
| `app/amayui-emulator/src/emulatorOptionsFile.ts` | `LoadedEmulatorOptions.text`（主进程复用已读文本，不二次读盘）+ `resourceDirOf()`（config 相对基准 = `dirname(loaded.path)`）+ `describeEmulatorOptions` 带上 version |
| `app/amayui-emulator/src/text/fontSet.ts` | `FACE_MAPS{cnjp,jp}` + `DEFAULT_FAMILIES`；`resolveFace(face, version='cnjp')`；jp 表**故意不含** `AMAYUI CN`（错误配置 → 通用回退）；`CNJP_FAMILY`/`SARASA_FAMILY` 常量 |
| `app/amayui-emulator/src/vm/engine.ts` | `Engine.resourceVersion`（默认 `cnjp`；**不是**引擎字段，故不入 `engineValues`） |
| `app/amayui-emulator/src/vm/handlers/msgwin.ts` | 两处 `resolveFace(..., e.resourceVersion)`（主面 + 注音面） |
| `app/amayui-emulator/src/run.ts` | 选项在建 `FileSource` **之前**读；`resourceDirOf` 定根；`applyEmulatorOptionsToEngine` |
| `app/amayui-emulator/src/report.ts` | `runSceneReport` 用 `decideResourceDir`（`opt.resourceDir` 作 cli 档）；新增 `configDir`；CLI 打 resources 行 |
| `app/amayui-emulator/src/tools/{scenarioBoot,gameStartChain,config1Chain}.ts` | 由 `emulatorOptions.resources.path`（基准 = 仓库根；**库不读 config 文件**）定根；改用 `applyEmulatorOptionsToEngine` |
| `app/amayui-emulator/electron/paths.ts` | 主进程读一次选项 → `RESOURCE_DECISION` / `RESOURCE_DIR` / `describeResourceDir()` |
| `app/amayui-emulator/electron/ipc/files.ts` | `read-emulator-options` 直接回主进程已读文本；`logSystemPaths` 加 resources 行 |
| `app/amayui-emulator/src/renderer/app/configBoot.ts`、`src/renderer/ipcProtocol.ts` | 渲染侧 `applyEmulatorOptionsToEngine`；注释更新 |
| `emulator.config.json`、`emulator.config.example.json` | 加 `resources` 段 + `$comment` |
| `docs-new/04-app/emulator.md` §8、`app/amayui-emulator/README.md`、`docs-new/01-translation/encoding-font.md` §3 | 文档同步（选项表、优先序、字体分叉） |

### 判据（可核对）

- **单测**：`test/emulator-options.test.ts` +7 条（默认值、两值合法、非法 problem、`normalizeEmulatorOptions`、
  `Engine.resourceVersion`、`decideResourceDir` 四档优先序、`resourceDirOf` 相对基准）；
  `test/text-layout.test.ts` +1 条（jp/cnjp 面名分叉 + `AMAYUI CN` 在 jp 下回退）。
  `npm run typecheck` ✅；`node --env-file=test/options.test.env --import tsx --test test/emulator-options.test.ts test/text-layout.test.ts` → **35/35 通过**。
- **E1（`resources.path` 真的决定资源根；headless CLI）**：伪造根 `.tmp/t0026/root-b/`（`SYSTEM4.BIN` 改过 1 字节；
  本机 `install` 是 `install -> raw` 符号链接，两根本来同内容，所以必须用伪造根才能区分）。
  config 放在 `.tmp/t0026/cfg-root-b.json`（`resources.path = "root-b"`，**相对 config 所在目录**），
  `AMAYUI_EMULATOR_CONFIG=…/cfg-root-b.json STEPS=50 npm run run` 输出：
  - `[options] resources: version=jp path=…/.tmp/t0026/root-b（来源=config: root-b）`
  - `[options] resources.version=jp ⇒ 字体面名落到未做 cnjp 替换的更纱黑体（res/fonts/SarasaGothicSC）`
  - `[boot] index 0 -> SYSTEM4.BIN (545 条指令)`

  字节证据：`sha1(raw/SYSTEM4.BIN) = 5b91e6edca47154be0171b826f062e81fb4e8eab`
  vs `sha1(root-b/SYSTEM4.BIN) = abf373bd1954f7d73e1f8fd1bc49e537a9367a87` ⇒ 读到的确实是配置指定的那个根。
- **E2（相对基准 = config 目录，不是仓库根/cwd）**：同一 config 里 `path = "../../raw"` 时
  `decision.dir = <仓库根>/raw`（若基准是仓库根，会解析成 `<仓库根>/../../raw`）。
- **E3（字体策略落点）**：`applyEmulatorOptionsToEngine` 后 `Engine.resourceVersion === 'jp'`；
  `resolveFace('メイリオ', 'jp').family === 'Sarasa Gothic SC'`（`cnjp` 下仍为 `Amayui CN`）；
  `resolveFace('Amayui CN', 'jp')` = 回退 `Sarasa Gothic SC` + `unknown`（错误配置，不特判）。
- **回归**：全套 `npm test` = **484 条 / 474 通过 / 7 失败**；HEAD 基线 = 476 / 464 / 9（其中 2 条是本单顺带修好的票据守卫）。
  两边的 7 条失败**逐条同源**：`formatIni`、`applyConfigToEngine`、`resolveSystemPaths`×2、CONFIG1 ×2、`0x300` 闸门
  ⇒ 都是既有的**平台/本机环境**失败（macOS vs Windows 路径、本机 `SYS4REG.INI`），**非本单回归**；本单净增 8 条通过。
- ⚠️ 证据脚本与伪造根都在 `.tmp/`（临时区，gitignore）⇒ 上面记的是**实测数值**本身，不是路径引用。

### 未做（明确划出边界）

- 未动 `ENGINE_FONT_LIST`（`0x2DC/0x2DD/0x2DE` 的"引擎已装字体名"等价物）：它是 CHECKCONFIG 的判正负用表，
  与"面名落到哪个内置字族"是两件事，本单不改（`jp` 下它仍列 `Amayui CN`）。
- 未给每个工具 CLI 补 `--resources` 之外的参数面；工具链走「`resources.path`（基准 = 仓库根）」，
  config 文件路径的精确基准只在 `run.ts` / `report.ts` / Electron 主进程三处生效。
