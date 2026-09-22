# native/ —— 宿主侧原生模块（N-API）

给模拟器（Electron 主进程）补上**浏览器/Electron 做不到的宿主能力**。一个子目录 = 一个独立可构建的
原生模块，互不依赖；每个模块自带 `CMakeLists.txt` / `index.js`（加载器 + 降级门面）/ `index.d.ts` /
`README.md`，并遵守下面这套统一口径。

**一个模块可以有多个平台实现**（这才是常态，不要一个平台一个模块）：`src/host_input.cc` 是唯一的
`Init`，每个平台一个 TU（`src/win32_input.cc` / `src/macos_input.cc`）提供 `Register*` 钩子 ——
于是调用方（`app/amayui-emulator/electron/nativeAddon.ts`）只需要加载**一个**模块，
不必按 `process.platform` 挑。

| 模块 | 用途 | 状态 |
|---|---|---|
| [`host-input/`](./host-input/README.md) | 移动真实系统光标（`SetCursorPos` / `CGWarpMouseCursorPosition`）、读光标/虚拟屏、平台专有的键态与授权态 | ✅ 两个平台都接入 + **预编译通用二进制随仓库分发**（`tickets/T-0053` / `T-0058` / `T-0116` / `T-0117` / `T-0119`） |

## 统一口径（新增模块时照抄）

1. **CMake + C++ + node-addon-api**；构建入口是 `npx cmake-js build --release`（`cmake-js` 负责 Node/Electron
   的头文件与 `node.lib`，并注入 `CMAKE_JS_INC/CMAKE_JS_LIB/CMAKE_JS_SRC`）。
   ★`CMAKE_JS_LIB` / `CMAKE_JS_SRC` **只有 Windows 有** ⇒ 非 Windows 的 `CMakeLists.txt` 必须用
   `if(CMAKE_JS_LIB)` / `if(CMAKE_JS_SRC)` 守卫，否则会「空参数」报错。
   ★cmake-js 的 `--CD` 只能写成 **`--CDKEY=VALUE`**（拼成一个参数）；空格分隔的写法被**静默忽略**
   （见 `host-input/README.md` 的「四个坑」第 3 条）。
2. **只用 N-API**（`napi_*`，不碰 `node::`）⇒ 同一个 `.node` 在 Node 与 Electron 里都能加载，
   **不需要 `@electron/rebuild`**。Windows 上另需延迟加载钩子（`CMAKE_JS_SRC`），否则 Electron 加载报
   `Module did not self-register` —— 出处与链接见 `host-input/README.md` 的「四个坑」第 1 条；
   macOS 没有这个坑（那是 `node.lib` 把导入记录写成 `node.exe` 造成的，Windows 独有）。
3. **产物默认不进 git**（`/native/*/build/`、`/native/*/build-*/`、`/native/*/prebuilds/` 已在 `.gitignore`）：
   按需构建；没构建时**必须**能优雅降级（`index.js` 的 `available/reason` + 全函数返回 `null`/`false`）。
   ★**唯一的例外是 macOS 的预编译通用二进制**（`/native/host-input/prebuilds/`，`tickets/T-0117`）：
   纯 N-API 的 ABI 稳定性 + fat Mach-O（一份文件服务 arm64/x86_64）+ macOS 上「装了 Xcode CLT」
   并非必然，三条合起来才让预置站得住 —— **开新例外要按这三条逐项论证**，别顺手把 `.node` 都塞进 git。
   存储走 **git-lfs**（`.gitattributes` 的 `*.node`，与 `*.png`/`*.exe`/`*.DAT` 同口径）。
   预置产物必须能被守卫钉住（存在性 + 架构 + 最低系统版本），见 `test/native-host.test.ts`。
4. **`index.js` 是唯一加载点**：候选路径顺序（env → `build/Release` → `build/Debug` → VS 多配置 →
   `prebuilds/<platform>-<arch>/` → `prebuilds/<platform>-universal/`）对所有模块一致，
   将来接 `prebuildify` 时不用改调用方。★最后一条 `-universal` 是**通用/fat 二进制**的兜底落点
   （macOS 预置产物用它；其它平台命中不了，留着只为口径一致）。
5. **坐标/句柄一律用「宿主原语」语义**（Win32 = 物理像素、HWND；CoreGraphics = 点、`CGDirectDisplayID`），
   业务换算留在调用方（例如 Windows 的 DIP→物理是 Electron `screen.dipToScreenPoint()` 的活；
   **macOS 没有这一跳** —— 它的屏幕坐标本来就是点）。
6. 每个模块都要有**只读烟测**（`tools/smoke.cjs`）：默认不动用户的系统状态，会改状态的动作放在
   环境变量后面（例如 `AMAYUI_HOST_INPUT_MOVE_TEST=1` 才会真的挪鼠标，且**挪完必须复位**）。
7. **一个模块内：同名 API 必须同语义，平台专有的函数只在自己平台注册**
   （`src/host_input.h` 的口径）：跨平台同名 API 是调用方不分平台的前提；`getSystemMetrics`/`getAsyncKeyState`/
   `showCursor`（Windows 语义）与 `postMouseMove`/`isAccessibilityTrusted`（macOS 语义）**不要**硬凑同名 ——
   名字相同、语义不同比没有更危险。加载器的门面负责把"本平台不存在"兜成 `null`/`false`。
