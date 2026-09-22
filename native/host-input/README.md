# native/host-input —— 宿主侧原生能力（N-API 原生模块，一个 addon 两个平台实现）

**一句话**：给模拟器（Electron 主进程）补上浏览器做不到的**系统原语** —— 眼下最要紧的是
**移动真实系统光标**（引擎 `0x10A` 的宿主侧动作 `SetCursorPos`，macOS 上对应
`CGWarpMouseCursorPosition`；缺口归口 `tickets/T-0053`，Windows 落地 `T-0058`、macOS 落地 `T-0116`）。

- 技术栈：**CMake + C++17 + node-addon-api（N-API）**
- 产物：`build/Release/host_input.node`（开发回路）+ `prebuilds/darwin-universal/host_input.node`
  （★**预编译通用二进制，随仓库分发**，见下面「预置产物」）
- 调用方：`app/amayui-emulator/electron/nativeAddon.ts`（主进程，经 IPC 供渲染进程调用）

## 一个 addon、两个平台实现

```
src/host_input.cc    ← ★唯一 Init：报 platform/supported，再按平台调 Register*（两个都调，另一个是空实现）
src/host_input.h     ← 两个 Register 的声明 + 「同名 API 必须同语义」的口径
src/win32_input.cc   ← Win32 实现：getCursorPos / setCursorPos / getVirtualScreenRect / getSystemMetrics / getAsyncKeyState / showCursor
src/macos_input.cc   ← macOS 实现：getCursorPos / setCursorPos / getVirtualScreenRect / postMouseMove / isAccessibilityTrusted
```

三个 TU 都参与编译、靠 `#ifdef` 决定谁是真实现（**不是**按平台选源文件）——这样在任何平台上另一平台的
**包装层**也会过一遍编译，代价只是几个空函数。三个 TU 的取名与 `Register*` 钩子的口径见 `src/host_input.h`。

**同名 API 必须同语义**（这是调用方不必分平台的前提）：

| API | win32 | darwin | 坐标单位 |
|---|---|---|---|
| `getCursorPos` / `setCursorPos` / `getVirtualScreenRect` | `GetCursorPos` / `SetCursorPos` / `SM_*VIRTUALSCREEN` | `CGEventGetLocation` / `CGWarpMouseCursorPosition` / `CGGetActiveDisplayList`+`CGDisplayBounds` | win32 = **物理像素**；darwin = **点**（= Electron 的 DIP） |
| `getSystemMetrics` / `getAsyncKeyState` / `showCursor` | ✅ | ❌ 不注册 | Win32 语义 |
| `postMouseMove` / `isAccessibilityTrusted` | ❌ 不注册 | ✅ | macOS 语义 |

★**不硬凑同名**：`getSystemMetrics` 的 `SM_*` 常量、`getAsyncKeyState` 的 VK 码表、macOS 的辅助功能授权态
都是平台独有的，名字相同、语义不同比没有更危险 ⇒ 它们只在自己平台注册，别的平台上加载器的门面
（`index.js` 的 `makeFacade`）把它们兜成 `null`/`false`。

## 为什么必须是原生模块

| 事实 | 出处 |
|---|---|
| 引擎 `0x10A`（`i10a`，`sub_421EA0` raw 30530-30598）= `ClientToScreen` + **`SetCursorPos`** | 甲骨文 `engine/天结_unpacked.exe_utf8.c` |
| 浏览器 / Electron **没有**移动真实系统光标的 API（`Input.dispatchMouseEvent`/`sendInputEvent` 只合成事件，读回的光标仍在原地） | `tickets/T-0053` 的评估 |
| macOS 的对应原语是 `CGWarpMouseCursorPosition`（挪光标）或 cliclick 那套 `CGEventCreateMouseEvent` + `CGEventPost` | 参考实现 <https://github.com/BlueM/cliclick>（`Actions/MouseBaseAction.m` 的 `m:` 分支） |
| 缺了它的症状：脚本逻辑正确但"玩家看得见光标被挪过去"的观感只生效到下一次 `mousemove` | 同上（1470 处 ADV 侧栏钉光标 + 光标位置记忆 + 拖动回夹 + 对话框居中） |

## 构建

前置：Windows = VS 2022+（或 LLVM/clang-cl）；macOS = Xcode Command Line Tools；CMake ≥ 3.20；Node ≥ 16
（本机验证：Windows MSVC 19.51 / macOS 26.3 + Xcode 17，CMake 4.3/4.4，Node v24.16）。

```bash
cd native/host-input
npm install                 # 只装 devDependencies：cmake-js + node-addon-api（都在 git 忽略范围内）
npm run build               # = cmake-js build --release ⇒ build/Release/host_input.node（本机架构）
npm run smoke               # 只读烟测（状态/光标/虚拟屏/平台专有查询）
AMAYUI_HOST_INPUT_MOVE_TEST=1 npm run smoke    # 额外验证"真能挪动"（+3px 再挪回原位）
npm run build:prebuild      # ★只在 macOS 上有意义：产出通用二进制并写进 prebuilds/darwin-universal/
```

`cmake-js` 会自己下载/定位 Node 的头文件与 `node.lib`（缓存在 `~/.cmake-js/`），并把变量注进 CMake：

| 变量 | 内容 | 用不用 |
|---|---|---|
| `CMAKE_JS_INC` | Node 头文件目录 | ✅ `napi.h`（node-addon-api 的 include 另外用 `node -p "require('node-addon-api').include"` 取） |
| `CMAKE_JS_LIB` | `node.lib` 导入库 | ❌ **只有 Windows 有**（`CMakeLists.txt` 里有 `if(CMAKE_JS_LIB)` 守卫） |
| `CMAKE_JS_SRC` | `win_delay_load_hook.cc` | ❌ **只有 Windows 有**（见下面第 1 条坑） |

### ★四个"不这么做就出错"的坑（都有出处）

1. **延迟加载钩子（Windows 独有）**：`node.lib` 把导入记录写成 **`node.exe`**，而 Electron 的宿主可执行
   文件是 `electron.exe`（**没有 `node.dll`**）⇒ 不加钩子，Electron 里 `require()` 会报
   `The specified module could not be found` / `Module did not self-register`。链接行要带
   `/DELAYLOAD:node.exe` + `delayimp.lib` + `win_delay_load_hook.obj`（= `CMAKE_JS_SRC`）
   → <https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules>。
   macOS 没有这个坑（那是 `node.lib` 独有的）。
2. **`napi.h` 不在 Node 头里**：它是 node-addon-api 包根的文件 ⇒ CMake 里用
   `node -p "require('node-addon-api').include"` 取（官方 `doc/cmake-js.md` 的写法）。
3. **cmake-js 的 `--CD` 只有一种写法：`--CDKEY=VALUE` 拼成一个参数**。它的解析是从 `process.argv` 里按
   `indexOf('=') >= 5` 切 key ⇒ 写成空格分隔的 `--CD KEY=VALUE` 会被**静默忽略**（实测：产出的仍是
   cmake-js 按本机 arch 注入的单架构产物，且**没有任何报错**）。`tools/build-prebuild.cjs` 用的就是拼写
   形式，并**编译完当场校验** `lipo -archs`。
4. **`CMAKE_OSX_DEPLOYMENT_TARGET` 必须写在第一个 `project()` 之前**（macOS）：CMake 只在初始化编译器
   命令行时读它一次（`-mmacosx-version-min`），晚设会「看起来生效、其实没进命令行」—— 而最低系统版本
   恰恰是预置二进制最容易被悄悄抬高、进而装不上旧系统的地方（`tickets/T-0117` 有守卫钉它）。
   另：N-API 符号由宿主进程提供 ⇒ macOS 需要 `-undefined dynamic_lookup`（cmake-js 一般已注入，
   `CMakeLists.txt` 里显式再写一遍）。

## API

```js
const host = require('<repo>/native/host-input');
host.available;                      // .node 是否加载成功
host.supported;                      // 本平台是否真有实现（win32/darwin=true；Linux=false）
host.reason;                         // 没加载上时的一行原因（诊断用）

// 跨平台（两平台同名同义）
host.getCursorPos();                 // {x,y} | null
host.setCursorPos(x, y);             // boolean ← 引擎 0x10A 的宿主侧动作
host.getVirtualScreenRect();         // {x,y,width,height} | null（所有活动显示器的并集）

// win32 专有（darwin 上由门面兜成 null）
host.getSystemMetrics(index);        // number | null（SM_* 常量）
host.getAsyncKeyState(vk);           // SHORT | null（bit15 = 当前按下）
host.showCursor(show);               // number | null（调用后的显示计数）

// darwin 专有（win32 上由门面兜成 false）
host.postMouseMove(x, y);            // boolean（cliclick 口径；返回值 = 有没有辅助功能授权）
host.isAccessibilityTrusted();       // boolean
```

口径（写给下一个加函数的人，也见 `index.d.ts` 与 `src/host_input.h`）：

1. **只做 OS 一层**，不掺业务。**坐标一律是「宿主原语」语义**：Win32 = 物理像素、CoreGraphics = 点。
   ★macOS 上「点」**就是** Electron 的 DIP ⇒ 主进程**不做** Windows 那种「DIP → 物理」换算；
   在那里乘 `scaleFactor` 是**双重换算**（Retina 的缩放不在这个坐标系里）。
2. **`setCursorPos` 走各自的原语**：win32 = `SetCursorPos`；darwin = `CGWarpMouseCursorPosition` +
   立刻 `CGAssociateMouseAndMouseCursorPosition(true)`。后一步不能省 —— Apple 文档写明 warp 会让
   「鼠标」与「光标」短暂脱钩（防止 warp 制造出一次巨大的相对位移），不复位关联的症状是
   「脚本挪完光标后，玩家推鼠标推不动」。
3. **macOS 的取整**：系统里的光标位置落在**整数点**，而 warp 对小数是**截断**（实测 `1234.9 → 1234`、
   `-102.9 → -103`）⇒ macOS 实现统一**四舍五入**后再 warp，让 `setCursorPos(p)` 与随后的
   `getCursorPos()` 自洽（调用方给的本来就是整数：主进程 `Math.round(b.x + clientX)`）。反过来，
   `getCursorPos()` 在 macOS 上可能读到**小数**（触控板按亚像素累积）⇒ 比较时先取整。
4. **非支持平台也能编译**：两个平台 TU 都编译成空实现、`supported === false`、一个平台函数都不注册
   ⇒ 门面全返回 `null`/`false`，调用方只有一条代码路径。
5. **运行时失败返回 `null`/`false`**；只有参数类型/个数写错才抛 `TypeError`（编程错误要吵）。
   门面 `index.js` 还会把原生层的抛错兜成 `null`/`false`，所以调用方永远不会因为本模块崩。
6. 新增函数的流程：对应平台的 TU 加实现 → 该 TU 的 `Register*` 里 `exports.Set` → `index.js` 的
   `makeFacade` 加一行 → `index.d.ts` 加声明 → `tools/smoke.cjs` 加只读探测。

## 权限（macOS；为什么默认路径不需要授权）

| 动作 | 需要「辅助功能」授权？ | 说明 |
|---|---|---|
| `getCursorPos` / `getVirtualScreenRect` / `isAccessibilityTrusted` | ❌ 不需要 | 纯查询 |
| **`setCursorPos`（warp）** | ❌ **不需要**（本机实测） | 引擎 `0x10A` 走的就是这条路 |
| `postMouseMove`（`CGEventPost`） | ✅ **需要** | 未授权时事件被系统**静默丢弃** ⇒ 返回值取 `AXIsProcessTrusted()`，让调用方能分辨「投递了但没生效」 |

## 预置产物（二进制怎么随应用走）

**现状：darwin 的通用二进制已经随仓库分发**（`tickets/T-0117`），落点
`prebuilds/darwin-universal/host_input.node`（加载器的最后一条兜底）：

| 形态 | 做法 |
|---|---|
| **从源码树跑**（`npm run electron`） | **darwin：什么都不用做** —— `build/Release/…` 有就用本地产物（**优先**），没有就用预置的通用二进制（**不需要** CMake/Xcode）。**win32：按需构建**（`npm run build`），没构建就降级（游戏照旧可玩） |
| **打安装包**（electron-builder / Electron Forge） | ① `.node` **不能进 asar**（asar 里不是真实路径，`process.dlopen` 打不开）⇒ `asarUnpack: ["**/*.node"]`（packager：`asar.unpack`）；② 把 `build/Release/host_input.node`（win32）或 `prebuilds/darwin-universal/host_input.node`（darwin）放进 `extraResources`；③ 加载器已认 `AMAYUI_HOST_INPUT_NODE`，指向 `app.asar.unpacked/...` 即可 |

★**存储走 git-lfs**：`.gitattributes` 里 `*.node filter=lfs diff=lfs merge=lfs -text`，与本仓其余二进制
（`*.png`/`*.exe`/`*.DAT` … 现有 100+ 个）同口径。

### 为什么这里可以预置（而 node-gyp 系模块通常不行）

1. **纯 N-API（`NAPI_VERSION=8`）⇒ ABI 稳定**：一份 `.node` 跨 Node 16+ 与 Electron 14+ 通用，
   没有「换 Node 版本必须重编」的腐坏面（用 V8/NAN C++ API 的模块才有）；
2. **macOS 支持 fat Mach-O**：一份 123 KB 的文件同时服务 arm64 与 x86_64，不需要按 arch 放两份；
3. **缺了它不会崩，只会静默降级**（`host-cursor-warp` 的 `whySilent`）—— 而 macOS 上「装了 Xcode CLT」
   并非必然（只装 Node + Electron 的机器跑 `npm install` 不会顺手带上 CMake）⇒ 预置是唯一能让
   「没编译器的机器」也拿到这条观感的办法。

### ★什么时候必须重跑 `npm run build:prebuild`

- 改了任意 `src/*.cc` / `src/host_input.h`（预置产物是**编译结果**）；
- 改了 `CMakeLists.txt`（编译选项 / 最低系统版本 / `NAPI_VERSION`）；
- 换了工具链或 Node 头文件（`~/.cmake-js/`）；
- 任何时候你**不确定**它是不是最新的 —— 重跑一遍是幂等的。

守卫 `app/amayui-emulator/test/native-host.test.ts` 会钉住三件事：**预置产物必须存在**、
**必须双架构**（`lipo -archs` = `arm64 x86_64`）、**每个 slice 的 `minos` 必须 = 11.0**
⇒ 用单架构的本地构建覆盖它、或抬高 deployment target 都会红。

手工核对：

```bash
lipo -archs native/host-input/prebuilds/darwin-universal/host_input.node
otool -l native/host-input/prebuilds/darwin-universal/host_input.node | grep -A4 LC_BUILD_VERSION
```

## 排障

| 症状 | 原因 / 处理 |
|---|---|
| 光标不动，日志里 `[native] host-input available=false` | 没构建（或打包漏了）⇒ `cd native/host-input && npm install && npm run build`（darwin 正常 checkout 不该出现：预置产物在库里，看同一行的 `reason`） |
| 日志里 `available=true supported=false` | 本平台没有实现（Linux）⇒ 属于预期，引擎侧坐标照旧生效 |
| 日志里连 `[native]` 都没有 | `initNativeAddon()` 没跑（`main.ts` 的装配次序）或日志还没就绪（必须在 `registerLogIpc()` 之后） |
| Electron 里报 `Module did not self-register` | 缺延迟加载钩子（Windows；见「四个坑」第 1 条）——确认 `CMAKE_JS_SRC` 确实进了 target |
| 光标挪到偏左上角（缩放 ≠ 100%） | 少做了 DIP→物理那一跳（`screen.dipToScreenPoint`）—— **Windows 专用**，别在 macOS 上补 |
| macOS 上光标挪到了"别的地方" | 多做了一次 DIP→物理换算（macOS 的屏幕坐标本来就是点）|
| macOS 上 `postMouseMove` 返回 false | 没有辅助功能授权（事件被静默丢弃）⇒ 系统设置 → 隐私与安全性 → 辅助功能 |
| 挪完光标后鼠标"推不动" | 少了 `CGAssociateMouseAndMouseCursorPosition(true)`（warp 的脱钩没有复位） |
| `CMAKE_JS_INC 未定义`（CMake FATAL_ERROR） | 直接跑了 `cmake` 而不是 `npx cmake-js build` ⇒ cmake-js 才有 Node 头文件与那三个变量 |
| `npm run build:prebuild` 产出的是单架构 | `--CD` 写成了空格分隔（见「四个坑」第 3 条）——脚本本身会**当场报错退出**，不会静默放过 |
| 控制窗缺口栏里出现 `setSystemCursor` | 某个 headless 宿主没实现这条缝（VM 侧调用被闸门 A 记成缺口）|
| 纯 Node 烟测看到的屏幕尺寸比实际小 | 宿主 DPI 感知级别不同（`node.exe` 未声明 per-monitor aware）⇒ **以 Electron 里的数值为准**（Windows 特有）|

## 相关

- 工程口径：[`native/README.md`](../README.md)（多模块之家）、[`docs-new/04-app/native-addon.md`](../../docs-new/04-app/native-addon.md)
- 票据：`tickets/T-0053`（宿主缺口 + 四条路线评估）、`T-0058`（Windows 落地）、`T-0116`（macOS 落地）、
  `T-0117`（预置产物）、`T-0119`（两个平台实现合并成一个 addon）
- 引擎侧语义：`docs-new/03-engine/input-system.md`、`docs-new/03-engine/opcode-table.md` 的 `0x10A`
- 能力台账：`analysis/engine-capabilities.json#host-cursor-warp`
