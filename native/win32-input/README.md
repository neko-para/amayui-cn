# native/win32-input —— 宿主侧 Win32 能力（N-API 原生模块）

**一句话**：给模拟器（Electron 主进程）补上浏览器做不到的 Win32 调用 —— 眼下最要紧的是
**移动真实系统光标**（引擎 `0x10A` 的宿主侧动作 `SetCursorPos`，`tickets/T-0053`）。

- 技术栈：**CMake + C++17 + node-addon-api（N-API）**
- 产物：`build/Release/win32_input.node`（**不进 git**，按需构建）
- 调用方：`app/amayui-emulator/electron/nativeAddon.ts`（主进程，经 IPC 供渲染进程调用）

## 为什么必须是原生模块

| 事实 | 出处 |
|---|---|
| 引擎 `0x10A`（`i10a`，`sub_421EA0` raw 30530-30598）= `ClientToScreen` + **`SetCursorPos`** | 甲骨文 `engine/天结_unpacked.exe_utf8.c` |
| 浏览器 / Electron **没有**移动真实系统光标的 API（`Input.dispatchMouseEvent`/`sendInputEvent` 只合成事件，读回的光标仍在原地） | `tickets/T-0053` 的评估 |
| 缺了它的症状：脚本逻辑正确但"玩家看得见光标被挪过去"的观感只生效到下一次 `mousemove` | 同上（1470 处 ADV 侧栏钉光标 + 光标位置记忆 + 拖动回夹 + 对话框居中） |

## 构建

前置：CMake ≥ 3.20、一套 C++ 工具链（本机两套都验证过：**VS 2026 的 MSVC 19.51** 与 **LLVM/clang-cl**）、
Node ≥ 16（本机 v24.14.0）。

```bash
cd native/win32-input
npm install                 # 只装 devDependencies：cmake-js + node-addon-api（都在 git 忽略范围内）
npm run build               # = cmake-js build --release ⇒ build/Release/win32_input.node
npm run smoke               # 只读烟测（状态/光标/虚拟屏/键态）
AMAYUI_WIN32_INPUT_MOVE_TEST=1 npm run smoke   # 额外验证"真能挪动"（+3px 再挪回原位）
```

`cmake-js` 会自己下载/定位 Node 的头文件与 `node.lib`（缓存在 `~/.cmake-js/`），并把三个变量注进 CMake：

| 变量 | 内容 | 用途 |
|---|---|---|
| `CMAKE_JS_INC` | Node/Electron 的头文件目录 | `node_api.h` |
| `CMAKE_JS_LIB` | `node.lib`（导入库） | 链接 `napi_*` |
| `CMAKE_JS_SRC` | `win_delay_load_hook.cc` | ★Windows + Electron 必需的延迟加载钩子（见下） |

`napi.h` 不在 Node 头里，所以 `CMakeLists.txt` 另外用
`node -p "require('node-addon-api').include"` 取 node-addon-api 的包根（官方 `doc/cmake-js.md` 的写法）。

### ★两个"不这么做就加载不起来"的坑（都有出处）

1. **延迟加载钩子**：Windows 上 `node.lib` 把导入记录写成 **`node.exe`**，而 Electron 的宿主可执行文件是
   `electron.exe`（**没有 `node.dll`**）⇒ 不加钩子，`require()` 会报
   `The specified module could not be found` / `Module did not self-register`。
   官方口径：「you'll need to ensure that you build with a delay-load hook installed in the main `.node` file」，
   链接行要带 `/DELAYLOAD:node.exe` + `delayimp.lib` + `win_delay_load_hook.obj`
   → <https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules>。
   `CMakeLists.txt` 里就是这三样（`CMAKE_JS_SRC` 就是那个 `.cc`）。
2. **同一个 `.node` 不需要为 Electron 重编译**：本模块**只用 N-API**（`napi_*`，不碰 `node::` 的 C++ 符号），
   而 Node-API 是 ABI 稳定的 ⇒ Node 24 下编译的产物在 Electron 44 里直接可用，**不需要
   `@electron/rebuild`**（Electron 文档说的"必须重编译"针对的是用 V8/NAN C++ API 的模块）。
   `NAPI_VERSION` 固定在 8（Node 16+ / Electron 14+ 的公共子集）：抬高只会收窄能加载的宿主范围。

## API

```js
const w32 = require('<repo>/native/win32-input');
w32.available;                    // .node 是否加载成功
w32.supported;                    // 本平台是否真有实现（win32=true）
w32.reason;                       // 没加载上时的一行原因（诊断用）

w32.getCursorPos();               // {x,y} | null            （物理屏幕像素）
w32.setCursorPos(x, y);           // boolean                 ← 引擎 0x10A 的宿主侧动作
w32.getVirtualScreenRect();       // {x,y,width,height} | null（多显示器并集）
w32.getSystemMetrics(index);      // number | null           （SM_* 常量）
w32.getAsyncKeyState(vk);         // SHORT | null            （bit15 = 当前按下）
w32.showCursor(show);             // number | null           （调用后的显示计数）
```

口径（写给下一个加函数的人，也见 `index.d.ts`）：

1. **只做 Win32 一层，坐标一律物理像素**。DIP ↔ 物理的换算**不在这里**：Electron 的
   `screen.dipToScreenPoint()` 已按显示器缩放算好（Windows 专用），主进程算完再传进来。
   ★附加注意：`GetSystemMetrics`/`SetCursorPos` 的结果取决于**宿主进程的 DPI 感知级别**
   （同一条代码在 DPI-unaware 的 `node.exe` 里会看到"被虚拟化"的尺寸，在 per-monitor-aware 的
   `electron.exe` 里看到物理尺寸）。所以：**以 Electron 里的数值为准**，从纯 Node 跑烟测看到的
   尺寸在缩放 ≠ 100% 时可能偏小 —— 这不是 bug。
2. **非 Windows 也能编译**：函数都在，但返回 `null`/`false`（`supported === false`）⇒ 调用方只有一条路径。
3. **运行时失败返回 `null`/`false`**；只有参数类型/个数写错才抛 `TypeError`（编程错误要吵）。
   门面 `index.js` 还会把原生层的抛错兜成 `null`/`false`，所以调用方永远不会因为本模块崩。
4. 新增函数的流程：`src/win32_input.cc` 加实现 → `Init` 里 `exports.Set` → `index.js` 的 `makeFacade`
   加一行 → `index.d.ts` 加声明 → `tools/smoke.cjs` 加只读探测。

## 打包（二进制怎么随应用走）

**本项目现在的形态：应用直接从源码树跑**（`npm run electron`），没有 asar/安装包 ⇒ **什么都不用做**：
`app/amayui-emulator/electron/nativeAddon.ts` 按 `REPO_ROOT/native/win32-input` 找模块，
找不到就降级（`available === false` + 一行日志），游戏照旧可玩。

### 如果将来要打安装包（Electron Forge / electron-builder）

按 Electron 官方口径（[Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)）：

1. **别把 `.node` 放进 asar**：asar 里的文件不是真实路径，`process.dlopen` 打不开。
   - electron-builder：`"asarUnpack": ["**/*.node"]`；
   - Electron Forge + `@electron/packager`：`"asar": { "unpack": "**/*.node" }`。
   打包后 `.node` 会落在 `app.asar.unpacked/...`，加载器只要把候选路径指过去
   （两种可用做法：`process.resourcesPath` 相对路径，或设 `AMAYUI_WIN32_INPUT_NODE=<绝对路径>` ——
   加载器**已经认这个环境变量**，见 `index.js` 的加载链第 1 条）。
2. **把 `native/win32-input/build/Release/win32_input.node` 加进打包资源**（`extraResources` /
   `extraResource`），路径与上面的 `asarUnpack` 规则对齐。
3. **不需要** `@electron/rebuild`：N-API 产物跨 Node/Electron 通用（见上）；**但**要注意架构
   （x64 vs arm64）与平台 —— 一个 `.node` 只服务一个 `platform-arch`。
4. **别人没编译器也想用**（可选）：接 [`prebuildify`](https://github.com/prebuild/prebuildify)
   （`prebuildify --napi --strip`，或 `prebuildify -t <node-version> --cmake-js`）把二进制放进
   `prebuilds/<platform>-<arch>/`，配 [`node-gyp-build`](https://github.com/prebuild/node-gyp-build)
   做运行时挑选。**本仓的加载器已经把这个目录排进搜索链**（第 4 条），所以接上时不用改调用方。
   ★本仓默认**不发预编译**：`.node` 不进 git（`.gitignore` 已忽略 `native/*/build|prebuilds`），
   而是"按需构建"—— 这也是把降级做扎实的原因。
5. **签名/公证**：Windows 上 `.node` 是 DLL，随应用一起签名；若做 SmartScreen/杀软白名单，注意
   原生模块常被启发式拦（给"构建脚本"与"发布包"分别留说明）。

## 排障

| 症状 | 原因 / 处理 |
|---|---|
| `available: false`（reason: 没有构建产物） | 没跑构建 ⇒ `npm install && npm run build`（或就接受降级：光标不动，别的照旧） |
| `Module did not self-register` / `The specified procedure could not be found` | 缺延迟加载钩子 ⇒ 确认 `CMakeLists.txt` 里 `CMAKE_JS_SRC` 被加进 target（`.node` 里应能看到 `win_delay_load_hook.cc` 一起编译的日志） |
| `NODE_MODULE_VERSION ... requires ...` | 用了非 N-API 的 C++ API（或模块是别的 ABI）⇒ 本模块不会出现；若出现说明有人引入了 `node::` 符号 |
| `C1083: Cannot open include file: 'napi.h'` | node-addon-api 的 include 没进去 ⇒ `npm install` 是否在 `native/win32-input` 下跑过（`CMakeLists.txt` 会打印 `node-addon-api include: …`） |
| 光标挪到了错的地方（缩放 ≠ 100%） | 传进去的是 DIP 而不是物理像素 ⇒ 主进程必须过 `screen.dipToScreenPoint()` |
