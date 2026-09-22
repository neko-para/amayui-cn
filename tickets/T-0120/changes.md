# T-0120 · 变更记录

## 第 1 次变更：Windows 侧实机核验（2026-09-23；本机 = Windows，取代 T-0119「本机 macOS」的缺口）

判据来自本票 `acceptance`，逐条给**实测原文**（不摘编）。

### 环境（实测）

| 项 | 值 |
|---|---|
| 主机 | Windows 11（`10.0.26200`），物理屏 2048×1280，**系统缩放 125%** |
| 工具链 | cmake-js 8.0.0 + Visual Studio 2026（`18.9.12120.119`，MSVC `19.51.36256.0`）+ Windows SDK `10.0.26100.0` + CMake `4.3.0-rc1` |
| Node | `v24.14.0` / npm `11.9.0`；cmake-js 取头与导入库于 `C:\Users\liaoh\.cmake-js\node-x64\v24.14.0`（`node.lib`） |
| 构建前置 | `native/host-input` 本轮才 `npm install`（合并后该目录**没有** `node_modules`）⇒ `added 40 packages` |

### 判据 1 · 构建（acceptance[0]）✅

```
npm run build  →  cmake-js build --release
INFO TOOL Using Visual Studio 18 2026 generator.
  host_input.cc
  win32_input.cc
  macos_input.cc
  win_delay_load_hook.cc
  host_input.vcxproj -> E:\Games\Eushully\天結\native\host-input\build\Release\host_input.node
```

- **三个 TU + 延迟加载钩子四个都编过**（`CMAKE_JS_SRC` 在合并后的 `CMakeLists.txt` 里仍然生效；
  生成器参数里可见 `-DCMAKE_JS_SRC=…/cmake-js/lib/cpp/win_delay_load_hook.cc`、
  `-DCMAKE_JS_LIB=…\node.lib`、`-DCMAKE_SHARED_LINKER_FLAGS=/DELAYLOAD:NODE.EXE`）；
- `elseif(MSVC)` 分支确实吃到：命令行有 `/utf-8 /permissive- /W4`，**全程无 C4819、无警告输出**；
- 产物 `native/host-input/build/Release/host_input.node` = **141,312 B**，
  SHA256 `C43BC43CD21F04D7FC90FF4B430FF6077D7FA16AEDCFA853EBF17903E33C1849`（2026-09-23 00:12:42）。

### 判据 2 · 模块级 smoke（acceptance[1]）✅

只读：

```
available                      true
supported                      true
addonPath                      E:\Games\Eushully\天結\native\host-input\build\Release\host_input.node
platform/arch                  win32/x64
getCursorPos()                 {"x":491,"y":428}
getVirtualScreenRect()         {"x":0,"y":0,"width":2048,"height":1280}
getSystemMetrics(SM_CXSCREEN=0) 2048
getSystemMetrics(SM_CYSCREEN=1) 1280
getAsyncKeyState(VK_LBUTTON=0x01) 0
```

`AMAYUI_HOST_INPUT_MOVE_TEST=1`（exit 0）：

```
setCursorPos(+3,+3)            true
  → getCursorPos()             {"x":1272,"y":654}      （原位 1269,651）
setCursorPos(原位)               true
  → getCursorPos()             {"x":1269,"y":651}
结论：setCursorPos ✅ 生效；复位 ✅
```

- `getSystemMetrics`/`getAsyncKeyState` 都给出**数值**（不是 `null`）⇒ win32 专有组注册成功；
- darwin 专有组（`postMouseMove`/`isAccessibilityTrusted`）在 win32 上由门面兜成 `false`
  —— 由守卫 `★平台专有函数只在自己平台存在` 断言（本轮 pass）。

### 判据 3 · 产品宿主：延迟加载钩子（acceptance[2]）✅ ★本票的核心

`npm run shot`（真实 Electron 产品宿主，`build:electron` 全绿；exit 0），主进程日志原文：

```
[native] host-input available=true supported=true path=E:\Games\Eushully\天結\native\host-input\build\Release\host_input.node
```

⇒ **合并后的工程在 Electron 里能 self-register**（没有 `Module did not self-register`），
即 `win_delay_load_hook.cc` + `/DELAYLOAD:node.exe` + `delayimp` 三者接对了 —— 这是 T-0119
「Windows 侧没有实机重跑」里唯一无法靠读代码确认的一条。

### 判据 4 · Electron 里的 DIP→物理那一跳（acceptance[3]）✅

`AMAYUI_CURSOR_VERIFY=1 npx electron tools/verify-cursor.cjs`（exit 0）：

```
[verify] host-input available=true supported=true path=…\build\Release\host_input.node
[verify] 内容区 bounds(DIP)={"x":127,"y":150,"width":626,"height":443}
[verify] 目标 DIP={"x":447,"y":390} → 物理={"x":559,"y":488}
[verify] setCursorPos ok=true 读回={"x":559,"y":488}
[verify] 复位 ok=true 读回={"x":251,"y":1180}（原位置 {"x":251,"y":1180}）
[verify] 结论：搬迁✅一致；复位✅
```

- 缩放档位 125%：`447 × 1.25 = 558.75 → 559`、`390 × 1.25 = 487.5 → 488` ⇒ **DIP→物理那一跳
  在非 100% 缩放下仍然正确**（这正是「缺最后一跳 ⇒ 光标挪偏」那条棘轮要防的）。

### 判据 5 · 预置落点（本次请求：构建并复制到对应 `prebuilds`）✅

- 落点依据 `index.js` 搜索链第 4 条 `prebuilds/<platform>-<arch>/`，本机 `win32/x64` ⇒
  `native/host-input/prebuilds/win32-x64/host_input.node`（141,312 B，SHA256 与 `build/Release` **完全相同**）；
- **兜底路径实测**：把 `build/Release/host_input.node` 暂时改名后重跑 smoke ⇒
  `addonPath = …\native\host-input\prebuilds\win32-x64\host_input.node`，`available=true supported=true
  platform/arch=win32/x64`；改回后恢复命中 `build/Release`（搜索链「本地构建优先于预置」的口径不变）；
- ★**但这条落点目前没被 `.gitignore` 忽略**（见下 §顺带实测 2）—— 是否让 win32 产物也进库是**口径决定**，
  不由本票单方面改。

### 顺带实测到的三处（不改判据、不消红，只记录）

1. **`npx tsx --test test/native-host.test.ts` ⇒ 10 pass / 1 fail / 1 skip**（本机 Windows）：
   红的是 `★预置产物就是"没编译器也能用"的那条路：加载器在 build/ 不存在时会命中 prebuilds/`（`test/native-host.test.ts:259`）：
   ```
   AssertionError: 按 arch 的落点应能加载：找到文件但加载失败：
   …\host_input-prebuilt-3JbyJ0\prebuilds\darwin-x64\host_input.node is not a valid Win32 application.
   ```
   定因（两条都在这条用例自身，**不是**合并引入的回归）：① 它把 darwin 的 fat Mach-O 拷进临时目录后
   用 `require()` 真去 dlopen —— 传 `platform:'darwin'` 只影响**路径选择**，`process.dlopen` 仍跑在宿主平台
   上 ⇒ 任何非 darwin 平台必红（与该用例自己那句「本文件在任何平台上都要跑（Windows 开发机也不该红）」相反）；
   ② 后半段「x64 上应命中通用落点」在 `darwin-${process.arch}` 目录存在时只对 **arm64 宿主**成立
   （x64 宿主上按 arch 的目录就叫 `darwin-x64`，会先命中它）。⇒ 已另立 `T-0121` 跟踪（Windows 上 `npm run verify` 转绿的入口）。
2. **`prebuilds/win32-x64/host_input.node` 未被忽略**：`git ls-files -o --exclude-standard native/host-input`
   列出了它。真因是 `.gitignore:27` 的例外写成 `!/native/host-input/prebuilds/`（**整目录**取消忽略），
   而它的注释与 `native/README.md` §3 都写「唯一的例外是 macOS 的预编译通用二进制……Windows 维持按需构建」
   ⇒ 例外范围与自述口径不一致；`git add` 会把 141 KB 的 win32 产物一并收进库。
   ★那行是 `T-0117` 的锚点（evidence[2]），改它要连带 retarget，故**本票不动**，只在 `notes.md` 记待决。
3. **遗留目录 `native/win32-input/`（6.3 MB）仍在盘上**（只有被忽略的 `build/` + `node_modules/`，无跟踪文件）：
   `T-0119` 的判据写「两个目录**不再存在**」——在 git 口径上成立（无跟踪文件），但在**本工作副本**上不成立；
   删它属于清理动作，未擅自执行。

### 结论

合并（`T-0119`）之后的 Windows 侧：**构建 ✅ / 模块级读写 ✅ / 产品宿主延迟加载钩子 ✅ / DIP→物理 ✅**
——本票 `acceptance` 的 5 条全部实测通过，缺口关闭。剩余的是上面三条**台账与卫生**问题
（`T-0121` 守卫跨平台、`.gitignore` 例外范围、遗留旧构建目录），不属于本票判据。

## 第 2 次变更：win32 预置产物进库 + 棘轮（2026-09-23；用户逐条裁定）

第 1 次变更留下的三个待决项，用户当场裁定：**例外保持覆盖整个 `native/host-input/prebuilds/`**
（即 win32-x64 那份也随仓库分发）、**修那条跨平台守卫**、**删遗留目录**。于是本轮改了这些文件：

| 文件 | 改动 |
|---|---|
| `native/host-input/tools/build-prebuild.cjs` | **按平台分支**：darwin 走原路（`build-universal/` + `lipo -archs` 双架构 + 两个 slice `minos = 11.0` + 落 `prebuilds/darwin-universal/`）／win32 走新路（`build/Release` + 校验 PE `Machine` = 本机 arch + 落 `prebuilds/win32-<arch>/`）。★顺手去掉对 `npx` 的依赖：Windows 上 `npx` 是 `npx.cmd`，`execFileSync` 起不了 `.cmd`（CVE-2024-27980 之后必须走 shell）⇒ 改成 `node node_modules/cmake-js/bin/cmake-js`，三平台一条路 |
| `app/amayui-emulator/test/native-host.test.ts` | ① 修 `★预置产物就是"没编译器也能用"的那条路` 的跨平台口径（= `T-0121`：非 darwin 只断言搜索链命中，不 dlopen 异平台二进制）；② **新增 win32 预置产物棘轮**（在库 + PE `Machine = 0x8664` + Windows 上按预置落点真能加载）；③ 头部断言清单同步 |
| `.gitignore` | 例外**注释**改写成「darwin + win32 两条，逐条论证」；★**例外那一行 `!/native/host-input/prebuilds/` 原文未动**（`T-0117` 的锚点） |
| `native/README.md` | §3「开新例外要按三条逐项论证」改写成两条例外的共同论证 + 模块表那一行 |
| `native/host-input/README.md` | 产物清单 / `build:prebuild` 用法 / 「预置产物」整节（两平台落点、两平台各跑一次、win32 的手工核对）/ 排障 / 相关 |
| `docs-new/04-app/native-addon.md` | 目录树、统一口径、§5 打包四行、腐坏面、排障、相关（★`## 5. 打包（二进制怎么随应用走）` 标题原文保留 = `T-0058` 的锚点） |
| `native/win32-input/`（目录） | **删除**（6.3 MB：上一轮的 `build/` + `node_modules/`，全是被忽略内容、无跟踪文件）⇒ 本工作副本现在才真的符合 `T-0119` 的「两个目录不再存在」 |

### 判据（实测）

```
$ npm run build:prebuild          # native/host-input，Windows
$ cmake-js build --release   # = node node_modules/cmake-js/bin/cmake-js …
  host_input.vcxproj -> E:\Games\Eushully\天結\native\host-input\build\Release\host_input.node
[pe] build\Release\host_input.node → Machine=0x8664（期望 0x8664 / x64）

✅ 预置产物已写出：prebuilds\win32-x64\host_input.node（138.0 KB）
   ★改了 src/*.cc 或 NAPI_VERSION 后必须重跑本命令，否则仓库里那份就是旧的。
```

- `npx tsx --test test/native-host.test.ts` ⇒ **13 tests / 12 pass / 0 fail / 1 skip**
  （skip 的仍是 darwin 的 `lipo`/`otool` 那条）；
- `git ls-files -o --exclude-standard native` ⇒ 只列出 `native/host-input/prebuilds/win32-x64/host_input.node`
  （**未被忽略 ⇒ 是"可提交的未跟踪文件"**：`git add` 会把它收进库，这正是本轮裁定的口径。
  `git check-ignore -v` 对它 **exit=1 = 不被忽略**，与 `.gitignore:27` 那条例外一致）；
- `node --check native/host-input/tools/build-prebuild.cjs` ⇒ exit 0（改后脚本语法自检）；
- `native/host-input/package-lock.json` ⇒ `npm install` 顺手补齐了 `T-0119` 搬包时漏改的 `name`
  （`amayui-macos-input` → `amayui-host-input`，`name` 与 `packages[""].name` 两处）——
  与依赖树无关，是合并遗留的字段（`package.json` 当时改了、lock 没跟着改）。

### 仍然不覆盖的

- **darwin 分支本轮没有重跑**（本机是 Windows）。上一轮（`T-0119`）已用新源码重建过那份通用二进制；
  本轮只把 darwin 原有逻辑搬进 `buildDarwin()`（逐字保留 `--CDKEY=VALUE` 的写法与 `lipo`/`otool` 校验、
  以及 `T-0117` 锚定的 `--CDCMAKE_OSX_ARCHITECTURES=`），**没有触碰任何编译选项**；
  那份 fat Mach-O 的「在库 + 双架构 + minos」仍由守卫在 darwin 上继续钉（`T-0118` 的 x86_64 实跑仍开着）。
- 新增的 win32 棘轮在 **win32** 上才会真去 dlopen 预置落点；别的平台上只校验「在库 + x64 PE」，
  与 `T-0121` 定下的口径一致（`platform` 参数只管路径，`process.dlopen` 永远在宿主平台上）。
