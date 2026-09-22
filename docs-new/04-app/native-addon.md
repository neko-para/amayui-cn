---
kind: narrative
state: live
---
# 04-app · 宿主侧原生模块（N-API）：为什么、怎么建、怎么打包

> 适用对象：模拟器（Electron）需要**浏览器做不到**的宿主能力时。现有模块是
> [`native/host-input`](../../native/host-input/README.md) —— **一个 addon、两个平台实现**
> （Windows = `SetCursorPos`、macOS = `CGWarpMouseCursorPosition`），都是引擎 `0x10A` 的宿主侧
> （`tickets/T-0053` / `T-0058` / `T-0116` / `T-0117` / `T-0119`）。
>
> 本文只讲**工程口径**（目录、构建、加载、降级、打包、排障）；模块自己的 API 见模块 README。

## 1. 什么时候才该加原生模块

先按顺序排除：

1. **引擎语义**（坐标、命中测试、状态机）→ 落在 VM 层（`src/vm/**`），不要下沉到宿主；
2. **浏览器/Electron 已有的能力**（窗口、屏幕、DPI、剪贴板、电源、输入事件）→ 优先用 Electron 的
   `screen`/`BrowserWindow`/`powerMonitor` 等；例如 **DIP ↔ 物理换算**就用 `screen.dipToScreenPoint()`，
   不要自己乘 `scaleFactor`；
3. **只剩"OS 原语"**（`SetCursorPos`、`CGWarpMouseCursorPosition`、`GetAsyncKeyState`、注册表、
   原生对话框…）→ 才引入原生模块。

判据是**"宿主缺口"**这件事本身要有票（本仓的第二层能力台账里有对应条目，例如 `host-cursor-warp`），
否则很容易把"我没实现"写成"做不到"。

## 2. 目录与统一口径

```
native/
  README.md                ← 多模块之家 + 统一口径（新增模块照抄）
  host-input/              ← 宿主侧系统原语（一个 addon、两个平台实现）
    CMakeLists.txt         ← CMake（cmake-js 注入 CMAKE_JS_INC；LIB/SRC 只有 Windows 有）
    src/host_input.cc      ← ★唯一 Init：报 platform/supported + 调两个 Register*
    src/host_input.h       ← Register 声明 + 「同名 API 必须同语义」的口径
    src/win32_input.cc     ← Windows 实现（非 Windows 上是空的 RegisterWin32）
    src/macos_input.cc     ← macOS 实现（非 macOS 上是空的 RegisterMacos）
    index.js               ← ★唯一加载点：搜索链 + 降级门面（全函数安全空实现）
    index.d.ts             ← 给 TS 调用方的类型（含"可能返回 null/false"与平台可用性）
    package.json           ← devDeps: cmake-js + node-addon-api；scripts: build/build:prebuild/smoke
    tools/smoke.cjs        ← 只读烟测（会改状态的动作放环境变量后面，且必须复位）
    tools/build-prebuild.cjs ← 产出通用二进制并**当场校验**架构与最低系统版本
    prebuilds/darwin-universal/host_input.node ← ★唯一进 git 的二进制（走 git-lfs）
```

统一口径（详见 `native/README.md`）：**只做 OS 一层**、**只用 N-API**、**产物默认不进 git**
（macOS 的预编译通用二进制是唯一的、逐条论证过的例外）、**`index.js` 是唯一加载点**、
**一个模块内同名 API 必须同语义、平台专有的函数只在自己平台注册**。

★**不要一个平台一个模块**：`tickets/T-0119` 之前这里是 `native/win32-input` + `native/macos-input`
两份几乎一样的加载器/类型/README，主进程还要按 `process.platform` 挑一个 —— 现在是一个模块、
每个平台一个 TU，调用方只管加载它。

## 3. 技术选型：为什么是 CMake + cmake-js + node-addon-api

| 选择 | 理由 |
|---|---|
| **N-API（node-addon-api）** | ABI 稳定 ⇒ 同一份 `.node` 在 Node（守卫测试）与 Electron（产品）都能加载，**不需要 `@electron/rebuild`**；也正因为这一点，**预编译产物才敢随仓库分发**（没有"换 Node 版本必须重编"的腐坏面）；`napi.h` 只是头文件包，不引运行时依赖 |
| **CMake + cmake-js** | cmake-js 负责 Node/Electron 的头文件与 `node.lib`（缓存 `~/.cmake-js/`），并把 `CMAKE_JS_INC/CMAKE_JS_LIB/CMAKE_JS_SRC` 注进 CMake；`CMakeLists.txt` 只有 ~110 行 |
| **不用 node-gyp** | 本仓已有 CMake/Ninja 工具链（`cmake`、VS 2026、LLVM/clang-cl、Xcode 都在本机验证过）；`binding.gyp` 会把构建知识再引一套 |
| **平台实现用 TU 分开、不按平台选源文件** | 三个 TU 在任何平台都参与编译 ⇒ 另一平台的**包装层**也会过一遍编译（真实现体当然还是 `#ifdef` 掉的）；代价只是几个空函数 |

★**平台特有的坑**（都写进 `CMakeLists.txt` 注释与模块 README 的「四个坑」）：

| 坑 | 平台 | 症状 | 处置 |
|---|---|---|---|
| **延迟加载钩子** | win32 | Electron 里 `Module did not self-register` / `The specified procedure could not be found`（`node.lib` 的导入记录写的是 `node.exe`，而宿主是 `electron.exe`） | `CMAKE_JS_SRC`（`win_delay_load_hook.cc`）+ `/DELAYLOAD:node.exe` + `delayimp.lib`；出处 <https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules> |
| **`napi.h` 不在 Node 头里** | 两平台 | `C1083: Cannot open include file: 'napi.h'` | CMake 里用 `node -p "require('node-addon-api').include"` 取（官方 `doc/cmake-js.md` 的写法） |
| **`CMAKE_JS_LIB`/`CMAKE_JS_SRC` 只有 Windows 有** | 非 win32 | CMake 报「`target_link_libraries` 参数个数不对」 | 用 `if(CMAKE_JS_LIB)` / `if(CMAKE_JS_SRC)` 守卫 |
| **cmake-js 的 `--CD` 必须写成 `--CDKEY=VALUE`** | 两平台 | 写成空格分隔会被**静默忽略**（产出的仍是本机单架构，且不报错） | 拼成一个参数；跨架构/发布构建**编译完当场校验**（`lipo -archs`） |
| **`CMAKE_OSX_DEPLOYMENT_TARGET` 必须早于第一个 `project()`** | darwin | 最低系统版本"看起来生效、其实没进命令行" ⇒ 预置产物装不上旧系统 | 写在 `cmake_minimum_required` 之后、`project()` 之前 |
| **`-undefined dynamic_lookup`** | darwin | 链接期找不到 `napi_*` | cmake-js 一般已注入；`CMakeLists.txt` 里显式再写一遍 |

本机实测（2026-09）：Windows = MSVC 19.51（VS 2026）+ CMake 4.3 + Ninja/LLVM；macOS = Xcode 17 +
CMake 4.4 + Ninja ⇒ 两平台都是 `npx cmake-js build --release` 直接出产物。

## 4. 加载与降级（**这是接入的关键**）

原生模块**随时可能不在**（没构建、换了平台、打包漏了、被 asar 压进去）⇒ 产品路径必须只有一条：

```
渲染进程（无 Node 集成）          主进程（Node）                          原生层（★一个 addon）
0x10A → NativeBridge.setSystemCursor(x, y)
   ↓ 虚拟坐标 → 客户区坐标（canvas.getBoundingClientRect）
window.api.setSystemCursor(cx, cy) ──IPC set-system-cursor──▶
                          electron/nativeAddon.ts
                            require('<repo>/native/host-input')  ──▶ index.js（搜索链）
                            内容区原点（getContentBounds，DIP）
                            DIP → 物理（screen.dipToScreenPoint）  ← ★只有 Windows 有这一跳
                            host.setCursorPos(...)                 ──▶ win32_input.cc / macos_input.cc
```

* **一个模块**：`HOST_MODULE = 'host-input'`，不再按平台挑；平台差异在 `.node` 内部（`platform`/`supported`
  两个常量 + 各 TU 注册的函数集）。
* `index.js` 的搜索链：`AMAYUI_HOST_INPUT_NODE` → `build/Release` → `build/Debug` →
  `build/<Config>`（VS 多配置）→ `prebuilds/<platform>-<arch>/` → `prebuilds/<platform>-universal/`；
  **失败不抛**，返回 `{ available:false, reason }` 且门面所有函数退化成 `null`/`false`。
  ★本地构建产物**优先**于预置产物（改了源码跑一次 `npm run build` 即生效）。
* 主进程 `initNativeAddon()` 只记**一行**状态（`available/supported/path/reason`）进
  `.tmp/amayui-emulator.log`；每次真实 warp 记一行节流诊断（`[native] warp client=… dip=… phys=… ok=`）——
  这是"光标到底动没动"的唯一主进程侧证据。
* VM 侧的缝 `NativeBridge.setSystemCursor?` 是**可选**的；两个 headless 宿主
  （`StubNative`/`HeadlessScene`）把它实现成**显式 no-op**（`i10a` 全库 1678 处，缺缝会让控制窗的
  缺口清单被噪声灌满）。新增宿主缝时同时要更新 `nativeTap.ts` 的 `BRIDGE_METHODS` + `WHY`。

## 5. 打包（二进制怎么随应用走）

| 形态 | 做法 |
|---|---|
| **现状：从源码树跑**（`npm run electron`） | **darwin：什么都不用做** —— 仓库里已经预置了通用二进制（`native/host-input/prebuilds/darwin-universal/`，`tickets/T-0117`），没装 CMake/Xcode 也能拿到真实光标。**win32：按需构建**（`npm run build`），没构建就降级（游戏照旧可玩） |
| **打安装包**（electron-builder / Electron Forge） | ① `.node` **不能进 asar**（asar 里不是真实路径，`process.dlopen` 打不开）⇒ `asarUnpack: ["**/*.node"]`（packager：`asar.unpack`）；② 把 `build/Release/host_input.node`（win32）或 `prebuilds/darwin-universal/host_input.node`（darwin）放进 `extraResources`；③ 加载器已认 `AMAYUI_HOST_INPUT_NODE`，指向 `app.asar.unpacked/...` 即可 |
| **别人没编译器也想用**（可选 / 部分已做） | [`prebuildify`](https://github.com/prebuild/prebuildify) 产出 `prebuilds/<platform>-<arch>/` + [`node-gyp-build`](https://github.com/prebuild/node-gyp-build) 运行时挑选；**本仓加载器已把这两个落点排进搜索链**（含 `-universal`），接上时不用改调用方。darwin 现在走的是"直接提交预编译产物"而不是 prebuildify（见模块 README 的「预置产物」） |
| **仓库里怎么存**（darwin 的预置产物） | 走 **git-lfs**（`.gitattributes` 的 `*.node filter=lfs diff=lfs merge=lfs -text`，与 `*.png`/`*.exe`/`*.DAT`/`*.STH` 等同口径）。win32 的 `.node` 既不进 git，也就无所谓 |
| **签名** | win32 的 `.node` 是 DLL、darwin 的是 Mach-O bundle，都随应用一起签；macOS 上**替换预置产物后必须重签**。杀软对原生模块常有启发式拦截，发布说明里写一段 |

**预置产物的腐坏面**（`tickets/T-0117` 的守卫就是为它准备的）：改了 `src/*.cc` / `NAPI_VERSION` /
工具链后忘记重跑 `npm run build:prebuild`；用单架构的本地构建覆盖通用二进制；deployment target 被
悄悄抬高。守卫 `app/amayui-emulator/test/native-host.test.ts` 钉住**存在性 + 双架构 + minos=11.0**。

## 6. 排障速查

| 症状 | 处置 |
|---|---|
| 光标不动，日志里 `[native] host-input available=false` | 没构建（或打包漏了）⇒ `cd native/host-input && npm install && npm run build`（darwin 正常 checkout 不该出现：预置产物在库里）|
| 日志里 `available=true supported=false` | 本平台没有实现（Linux）⇒ 属于预期，引擎侧坐标照旧生效 |
| 日志里连 `[native]` 都没有 | `initNativeAddon()` 没跑（`main.ts` 的装配次序）或日志还没就绪（必须在 `registerLogIpc()` 之后） |
| Electron 里报 `Module did not self-register` | 缺延迟加载钩子（Windows；见 §3 第 1 条）——确认 `CMAKE_JS_SRC` 确实进了 target |
| 光标挪到偏左上角（缩放 ≠ 100%） | 少做了 DIP→物理那一跳（`screen.dipToScreenPoint`）—— **Windows 专用**，别在 macOS 上补 |
| macOS 上光标挪到了"别的地方" | 多做了一次 DIP→物理换算（macOS 的屏幕坐标本来就是点）|
| macOS 上 `postMouseMove` 返回 false | 没有辅助功能授权（事件被静默丢弃）⇒ 系统设置 → 隐私与安全性 → 辅助功能 |
| 控制窗缺口栏里出现 `setSystemCursor` | 某个 headless 宿主没实现这条缝（VM 侧调用被闸门 A 记成缺口）|
| 纯 Node 烟测看到的屏幕尺寸比实际小 | 宿主 DPI 感知级别不同（`node.exe` 未声明 per-monitor aware）⇒ **以 Electron 里的数值为准**（Windows 特有）|

## 7. 相关

- 模块 README：[`native/host-input/README.md`](../../native/host-input/README.md)（API / 构建 / 权限 /
  预置产物 / 排障细节）
- 缺口与决策票：`tickets/T-0053`（宿主缺口 + 四条路线评估）、`T-0058`（Windows 落地）、
  `T-0116`（macOS 落地）、`T-0117`（darwin 通用二进制预置进仓库）、`T-0119`（两个平台实现合并成一个 addon）
- 引擎侧语义：`docs-new/03-engine/input-system.md` §6a/§8/§10、`docs-new/03-engine/opcode-table.md` 的 `0x10A`
- 能力台账：`analysis/engine-capabilities.json#host-cursor-warp`
