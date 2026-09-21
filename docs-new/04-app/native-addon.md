---
kind: narrative
state: live
---
# 04-app · 宿主侧原生模块（N-API）：为什么、怎么建、怎么打包

> 适用对象：模拟器（Electron）需要**浏览器做不到**的宿主能力时。第一个模块是
> [`native/win32-input`](../../native/win32-input/README.md)（真移动系统光标 = 引擎 `0x10A` 的宿主侧，
> `tickets/T-0053` / `T-0058`）。
>
> 本文只讲**工程口径**（目录、构建、加载、降级、打包、排障）；模块自己的 API 见各自的 README。

## 1. 什么时候才该加原生模块

先按顺序排除：

1. **引擎语义**（坐标、命中测试、状态机）→ 落在 VM 层（`src/vm/**`），不要下沉到宿主；
2. **浏览器/Electron 已有的能力**（窗口、屏幕、DPI、剪贴板、电源、输入事件）→ 优先用 Electron 的
   `screen`/`BrowserWindow`/`powerMonitor` 等；例如 **DIP ↔ 物理换算**就用 `screen.dipToScreenPoint()`，
   不要自己乘 `scaleFactor`；
3. **只剩"OS 原语"**（`SetCursorPos`、`GetAsyncKeyState`、注册表、原生对话框…）→ 才引入原生模块。

判据是**"宿主缺口"**这件事本身要有票（本仓的第二层能力台账里有对应条目，例如 `host-cursor-warp`），
否则很容易把"我没实现"写成"做不到"。

## 2. 目录与统一口径

```
native/
  README.md              ← 多模块之家 + 统一口径（新增模块照抄）
  win32-input/
    CMakeLists.txt       ← CMake（cmake-js 注入 CMAKE_JS_INC/LIB/SRC）
    src/win32_input.cc   ← N-API 实现（纯 napi_*，跨 Node/Electron）
    index.js             ← ★唯一加载点：搜索链 + 降级门面（全函数安全空实现）
    index.d.ts           ← 给 TS 调用方的类型（含"可能返回 null/false"的口径）
    package.json         ← devDeps: cmake-js + node-addon-api；scripts: build/rebuild/smoke
    tools/smoke.cjs      ← 只读烟测（会改状态的动作放环境变量后面，且必须复位）
```

四条统一口径（详见 `native/README.md`）：**只做 OS 一层**、**只用 N-API**、**产物不进 git**、
**`index.js` 是唯一加载点**。

## 3. 技术选型：为什么是 CMake + cmake-js + node-addon-api

| 选择 | 理由 |
|---|---|
| **N-API（node-addon-api）** | ABI 稳定 ⇒ 同一份 `.node` 在 Node（守卫测试）与 Electron（产品）都能加载，**不需要 `@electron/rebuild`**；`napi.h` 只是头文件包，不引运行时依赖 |
| **CMake + cmake-js** | cmake-js 负责 Node/Electron 的头文件与 `node.lib`（缓存 `~/.cmake-js/`），并把 `CMAKE_JS_INC/CMAKE_JS_LIB/CMAKE_JS_SRC` 注进 CMake；`CMakeLists.txt` 只有 60 行且平台无关 |
| **不用 node-gyp** | 本仓已有 CMake/Ninja 工具链（`cmake`、VS 2026、LLVM/clang-cl、Ninja 都在本机验证过）；`binding.gyp` 会把构建知识再引一套 |

★**Windows 的两个坑**（写进 `CMakeLists.txt` 的注释，也写在模块 README 里）：

1. **延迟加载钩子**：`node.lib` 的导入记录写的是 `node.exe`，而 Electron 的宿主可执行文件是
   `electron.exe`（**没有 `node.dll`**）⇒ 必须 `CMAKE_JS_SRC`（`win_delay_load_hook.cc`）+
   `/DELAYLOAD:node.exe` + `delayimp.lib`，否则 Electron 加载时报
   `Module did not self-register` / `The specified procedure could not be found`。
   出处：<https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules>。
2. **`napi.h` 不在 Node 头里**：它是 node-addon-api 包根的文件 ⇒ CMake 里用
   `node -p "require('node-addon-api').include"` 取（官方 `doc/cmake-js.md` 的写法）。

本机实测（2026-09）：MSVC 19.51（VS 2026 Community）+ CMake 4.3 + Ninja/LLVM 均在位；
`npx cmake-js build --release` → `build/Release/win32_input.node`。

## 4. 加载与降级（**这是接入的关键**）

原生模块**随时可能不在**（没构建、换了平台、打包漏了、被 asar 压进去）⇒ 产品路径必须只有一条：

```
渲染进程（无 Node 集成）          主进程（Node）                        原生层
0x10A → NativeBridge.setSystemCursor(x, y)
   ↓ 虚拟坐标 → 客户区坐标（canvas.getBoundingClientRect）
window.api.setSystemCursor(cx, cy) ──IPC set-system-cursor──▶
                          electron/nativeAddon.ts
                            require('<repo>/native/win32-input')  ──▶ index.js（搜索链）
                            内容区原点（getContentBounds，DIP）
                            DIP → 物理（screen.dipToScreenPoint）
                            w32.setCursorPos(phys)                ──▶ SetCursorPos
```

* `index.js` 的搜索链：`AMAYUI_WIN32_INPUT_NODE` → `build/Release` → `build/Debug` →
  `build/<Config>`（VS 多配置）→ `prebuilds/<platform>-<arch>/`；**失败不抛**，返回
  `{ available:false, reason }` 且门面所有函数退化成 `null`/`false`。
* 主进程 `initNativeAddon()` 只记**一行**状态（`available/supported/path/reason`）进
  `.tmp/amayui-emulator.log`；每次真实 warp 记一行节流诊断（`[native] warp client=… dip=… phys=… ok=`）——
  这是"光标到底动没动"的唯一主进程侧证据。
* VM 侧的缝 `NativeBridge.setSystemCursor?` 是**可选**的；两个 headless 宿主
  （`StubNative`/`HeadlessScene`）把它实现成**显式 no-op**（`i10a` 全库 1678 处，缺缝会让控制窗的
  缺口清单被噪声灌满）。新增宿主缝时同时要更新 `nativeTap.ts` 的 `BRIDGE_METHODS` + `WHY`。

## 5. 打包（二进制怎么随应用走）

| 形态 | 做法 |
|---|---|
| **现状：从源码树跑**（`npm run electron`） | 什么都不用做：模块按 `REPO_ROOT/native/win32-input` 找；没构建就降级（游戏照旧可玩） |
| **打安装包**（electron-builder / Electron Forge） | ① `.node` **不能进 asar**（asar 里不是真实路径，`process.dlopen` 打不开）⇒ `asarUnpack: ["**/*.node"]`（packager：`asar.unpack`）；② 把 `native/win32-input/build/Release/win32_input.node` 放进 `extraResources`；③ 加载器已认 `AMAYUI_WIN32_INPUT_NODE`，指向 `app.asar.unpacked/...` 即可 |
| **别人没编译器也想用**（可选） | [`prebuildify`](https://github.com/prebuild/prebuildify) 产出 `prebuilds/<platform>-<arch>/` + [`node-gyp-build`](https://github.com/prebuild/node-gyp-build) 运行时挑选；**本仓加载器已把这个目录排进搜索链**，接上时不用改调用方 |
| **签名** | `.node` 是 DLL，随应用一起签；杀软对原生模块常有启发式拦截，发布说明里写一段 |

**本仓默认不发预编译**：`.node` 不进 git（`.gitignore` 忽略 `native/*/build|prebuilds`），
按需 `npm run build` —— 这也是把降级路径做扎实的原因（缺了它只有观感缺失，不会崩）。

## 6. 排障速查

| 症状 | 处置 |
|---|---|
| 光标不动，日志里 `[native] win32-input available=false` | 没构建（或打包漏了）⇒ `cd native/win32-input && npm install && npm run build` |
| 日志里连 `[native]` 都没有 | `initNativeAddon()` 没跑（`main.ts` 的装配次序）或日志还没就绪（必须在 `registerLogIpc()` 之后） |
| Electron 里报 `Module did not self-register` | 缺延迟加载钩子（见 §3 第 1 条）——确认 `CMAKE_JS_SRC` 确实进了 target |
| 光标挪到偏左上角（缩放 ≠ 100%） | 少做了 DIP→物理那一跳（`screen.dipToScreenPoint`）|
| 控制窗缺口栏里出现 `setSystemCursor` | 某个 headless 宿主没实现这条缝（VM 侧调用被闸门 A 记成缺口）|
| 纯 Node 烟测看到的屏幕尺寸比实际小 | 宿主 DPI 感知级别不同（`node.exe` 未声明 per-monitor aware）⇒ **以 Electron 里的数值为准** |

## 7. 相关

- 模块 README：[`native/win32-input/README.md`](../../native/win32-input/README.md)（API/构建/打包细节）
- 缺口与决策票：`tickets/T-0053`（宿主缺口 + 四条路线评估）、`tickets/T-0058`（本模块落地）
- 引擎侧语义：`docs-new/03-engine/input-system.md` §6a/§8/§10、`docs-new/03-engine/opcode-table.md` 的 `0x10A`
- 能力台账：`analysis/engine-capabilities.json#host-cursor-warp`
