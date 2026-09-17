# native/ —— 宿主侧原生模块（N-API）

给模拟器（Electron 主进程）补上**浏览器/Electron 做不到的宿主能力**。一个子目录 = 一个独立可构建的
原生模块，互不依赖；每个模块自带 `CMakeLists.txt` / `index.js`（加载器 + 降级门面）/ `index.d.ts` /
`README.md`，并遵守下面这套统一口径。

| 模块 | 用途 | 状态 |
|---|---|---|
| [`win32-input/`](./win32-input/README.md) | 移动真实系统光标（引擎 `0x10A` 的 `SetCursorPos`）、读光标/虚拟屏/键态 | ✅ 已构建并接入（`tickets/T-0053` / `T-0058`） |

## 统一口径（新增模块时照抄）

1. **CMake + C++ + node-addon-api**；构建入口是 `npx cmake-js build --release`（`cmake-js` 负责 Node/Electron
   的头文件与 `node.lib`，并注入 `CMAKE_JS_INC/CMAKE_JS_LIB/CMAKE_JS_SRC`）。
2. **只用 N-API**（`napi_*`，不碰 `node::`）⇒ 同一个 `.node` 在 Node 与 Electron 里都能加载，
   **不需要 `@electron/rebuild`**。Windows 上另需延迟加载钩子（`CMAKE_JS_SRC`），否则 Electron 加载报
   `Module did not self-register` —— 出处与链接见 `win32-input/README.md` 的「两个坑」。
3. **产物不进 git**（`/native/*/build/`、`/native/*/prebuilds/` 已在 `.gitignore`）：按需构建；
   没构建时**必须**能优雅降级（`index.js` 的 `available/reason` + 全函数返回 `null`/`false`）。
4. **`index.js` 是唯一加载点**：候选路径顺序（env → `build/Release` → `build/Debug` → VS 多配置 →
   `prebuilds/<platform>-<arch>/`）对所有模块一致，将来接 `prebuildify` 时不用改调用方。
5. **坐标/句柄一律用「宿主原语」语义**（Win32 = 物理像素、HWND），业务换算留在调用方
   （例如 DIP→物理是 Electron `screen.dipToScreenPoint()` 的活）。
6. 每个模块都要有**只读烟测**（`tools/smoke.cjs`）：默认不动用户的系统状态，会改状态的动作放在
   环境变量后面（例如 `AMAYUI_WIN32_INPUT_MOVE_TEST=1` 才会真的挪鼠标，且**挪完必须复位**）。
