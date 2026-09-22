# T-0119 · 变更记录

## 第 1 次变更：两个平台模块合并成 `native/host-input`（2026-09-22）

### 文件搬家（`git` 会识别成 rename）

| 旧 | 新 |
|---|---|
| `native/win32-input/src/win32_input.cc` | `native/host-input/src/win32_input.cc` |
| `native/macos-input/src/macos_input.cc` | `native/host-input/src/macos_input.cc` |
| `native/macos-input/package.json` / `package-lock.json` | `native/host-input/…`（name 改 `amayui-host-input`） |
| `native/macos-input/tools/build-prebuild.cjs` | `native/host-input/tools/build-prebuild.cjs`（产物名 → `host_input.node`） |
| `native/macos-input/prebuilds/darwin-universal/macos_input.node` | `native/host-input/prebuilds/darwin-universal/host_input.node`（**用新源码重建**，见下） |
| `native/win32-input/tools/smoke.cjs` + `native/macos-input/tools/smoke.cjs` | `native/host-input/tools/smoke.cjs`（合并成一份，平台差异只体现在"多测哪几项"） |
| `native/win32-input/index.js` + `native/macos-input/index.js` | `native/host-input/index.js`（合并成一份加载器） |
| `native/win32-input/index.d.ts` + `native/macos-input/index.d.ts` | `native/host-input/index.d.ts`（一份 API，标注各函数的平台可用性） |
| `native/win32-input/README.md` + `native/macos-input/README.md` | `native/host-input/README.md`（平台差异列成表；两边的坑都保留） |
| `app/amayui-emulator/test/native-win32.test.ts` + `native-macos.test.ts` | `app/amayui-emulator/test/native-host.test.ts`（11 条） |

### 新增 / 改写的源码

| 文件 | 内容 |
|---|---|
| `native/host-input/src/host_input.cc` | ★**唯一 Init**：`platform`/`supported` + 调 `RegisterWin32` / `RegisterMacos`（替掉原来两份各自 `NODE_API_MODULE`） |
| `native/host-input/src/host_input.h` | 两个 `Register*` 的声明 + 「同名 API 必须同语义、平台专有函数只在自己平台注册」的口径 |
| `native/host-input/src/win32_input.cc` / `macos_input.cc` | 实现体逐行照搬，但**整块**包在 `#ifdef _WIN32` / `#ifdef __APPLE__` 里、末尾加 `Register*`；顺手删掉每个函数上的 `#else return null/false` 桩分支（代码比合并前更短） |
| `native/host-input/CMakeLists.txt` | 三个 TU 一起编；Windows 的 `CMAKE_JS_SRC`/`delayimp`/`/DELAYLOAD:node.exe` 与 macOS 的 `CMAKE_OSX_DEPLOYMENT_TARGET=11.0`（先于 `project()`）/frameworks/`-undefined dynamic_lookup` 逐字保留；补上 `elseif(MSVC)` 分支让 Windows 也吃到 `/utf-8 /permissive- /W4` |
| `native/host-input/index.js` | 合并加载器：`host_input.node`、`AMAYUI_HOST_INPUT_NODE`、搜索链含 `prebuilds/<platform>-universal/`；门面把**两个平台专有组**都兜成 `null`/`false` |
| `native/host-input/README.md` | 合并文档：结构图 / 同名 API 语义表 / 四个平台特有的坑（延迟加载钩子、`napi.h`、`--CD` 拼写、deployment target）/ 权限 / 预置产物 |
| `app/amayui-emulator/test/native-host.test.ts` | 原两份守卫的并集 + **新增第 5 条**「平台专有函数在对方平台上由门面兜成 null/false」 |

### 接线与文档

| 文件 | 改动 |
|---|---|
| `app/amayui-emulator/electron/nativeAddon.ts` | 去掉 `HostModuleName` 类型与三元分派、去掉 `LOAD_SUMMARY_PREFIX` 映射表 ⇒ `const HOST_MODULE = 'host-input'` + 一行 `[native] host-input available=…` |
| `app/amayui-emulator/tools/verify-cursor.cjs` | 单模块（不再按平台挑路径）；其余口径不变 |
| `.gitignore` / `.gitattributes` | 例外与 LFS 注释改指 `native/host-input/prebuilds/` |
| `native/README.md` | 模块表收敛成一行；统一口径新增「一个模块可以有多个平台实现（不要一个平台一个模块）」 |
| `docs-new/04-app/native-addon.md` | 目录树/加载链/平台分派段改写；保留 `## 5. 打包（二进制怎么随应用走）`（T-0058 的锚点） |
| `analysis/opcodes.json` → `docs-new/03-engine/opcode-table.md` | 0x10A 的 semantics 里「按平台挑一个模块」改成「用 `native/host-input`（一个 addon 两个平台实现）」；`node scripts/build-opcode-table.mjs` 重生成 |
| `analysis/engine-capabilities.json` → `docs-new/03-engine/engine-capabilities.md` | `host-cursor-warp`：`guard` → `test/native-host.test.ts`，note 里两段分平台叙述合并（含 `T-0119` 回链） |
| 注释引用（`main.ts`/`preload.ts`/`ipcProtocol.ts`/`vm/native.ts`/`handlers/input.ts`/`input-system.md`） | 路径与措辞改指 `native/host-input` |
| 票据 | `T-0053`（tests/links.docs）、`T-0058`(7)、`T-0116`(7)、`T-0117`(5)、`T-0118`(1) 的 evidence 逐条 retarget（**不删任何一条**），各自 history 记一次 scope retarget |

### 行为变化

- **调用方**：主进程不再按 `process.platform` 挑模块；`initNativeAddon()` 的日志前缀统一成
  `[native] host-input available=`（这是 T-0058/T-0116 的加载摘要锚点，已同步 retarget）。
- **导出面**：`available`/`supported`/`reason`/`addonPath`/`platform`/`arch` + 8 个函数（合并后一次导出，
  平台专有的由门面兜底）—— 对主进程而言**没有行为变化**（它只用 `setCursorPos`/`getCursorPos`）。
- **非支持平台（Linux）**：以前会加载 `win32-input` 得到 `supported=false`，现在加载 `host-input` 同样
  `supported=false`（两个 TU 都是空实现、一个函数都不注册）⇒ 语义不变。

### 判据（实测）

- `cd native/host-input && npm run build` ⇒ 三个 TU 全部编过（`host_input.cc` / `win32_input.cc`(空 Register) /
  `macos_input.cc`）+ 链接；
- `npm run build:prebuild` ⇒ `[lipo] → arm64 x86_64`、两个 slice `minos = 11.0`、写出 123.5 KB；
- `node tools/smoke.cjs` ⇒ `available=true supported=true platform=darwin`；`getSystemMetrics(0)`（darwin 专有缺失）
  ⇒ `null`；`AMAYUI_HOST_INPUT_MOVE_TEST=1 AMAYUI_HOST_INPUT_POST_TEST=1` ⇒ 挪动 + 复位一致、`postMouseMove` 已授权（exit 0）；
- `npx tsx --test test/native-host.test.ts` ⇒ **12 pass / 0 fail**；
- `AMAYUI_CURSOR_VERIFY=1 npx electron tools/verify-cursor.cjs`（真实 Electron 宿主）⇒
  `[verify] host-input available=true supported=true path=…/native/host-input/build/Release/host_input.node`、
  目标 DIP(440,392) → 屏幕点(440,392) → 读回一致 → 复位一致（exit 0）；
- 产品宿主（`npm run build:electron && npx electron tools/shot.cjs`）⇒ 主进程日志出现
  `[native] host-input available=true supported=true …`；
- `node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate` ⇒ 通过（0 红）；
- `node scripts/build-capabilities.mjs` / `build-opcode-table.mjs` / `build-doc-index.mjs` 重生成后守卫绿；
- 全量 `npm run verify`（typecheck + 全量测试 + 死写检测）exit 0。

### ★合并时手滑的一处（值得留在案）

搬 `verify-cursor.cjs` 时删掉了 `const MODULE = …`，却漏了日志里的一处 `${MODULE}` ⇒ 该脚本在 Electron 里
**当场 `ReferenceError: MODULE is not defined`**，而 `npm test`（1067 条）**全绿** —— 因为它只能在 Electron
里跑（`electron/*.ts` 与 `tools/*.cjs` 不在 `npm test` 的采集面内）。
处置：修好后补了一条**工具棘轮**（`test/native-host.test.ts` 的第 12 条）：断言该脚本加载 `native/host-input`、
**不许再出现 `MODULE` 这个已删除的绑定**、且保留 `AMAYUI_CURSOR_VERIFY` 锚点。

### 未证到的

- **Windows 侧没有实机重跑**（本机 macOS）：合并只动文件布局与 `Register*` 装配，`win32_input.cc` 的实现体
  与 `CMakeLists.txt` 里 Windows 那三行（`CMAKE_JS_SRC`/`delayimp`/`/DELAYLOAD:node.exe`）逐字未变，
  但**严格说需要一台 Windows 再确认一次**（`npm run build` + 产品宿主日志出现
  `[native] host-input available=true`）⇒ 已开 `T-0120` 跟踪，与 `T-0118`（x86_64 slice 未实跑）同属
  "需要另一台机器"的遗留核验。
- 本轮的 Electron 核验跑在 `--no-sandbox --disable-gpu` 下（本会话的沙箱里 Chromium 起不来 GPU 进程，
  且用户另有一个 Electron 实例在跑）—— 这是**环境**限制，不是仓库需要的开关：`tools/verify-cursor.cjs`
  与 `npm run shot` 本身没有也不需要这些参数。
