# T-0116 · 变更记录

## 第 1 次变更：新增 `native/macos-input` 并接入产品链路（2026-09-22）

### 新增文件

| 文件 | 内容 |
|---|---|
| `native/macos-input/CMakeLists.txt` | CMake + C++17；`CMAKE_OSX_DEPLOYMENT_TARGET=11.0` 写在第一个 `project()` **之前**；`if(CMAKE_JS_LIB)` 守卫（macOS 上没有这个变量）；链 `-framework ApplicationServices/CoreFoundation/CoreGraphics`；`-undefined dynamic_lookup` |
| `native/macos-input/src/macos_input.cc` | 纯 N-API 实现：`getCursorPos`（`CGEventCreate`+`CGEventGetLocation`）、`setCursorPos`（`CGWarpMouseCursorPosition`+`CGAssociateMouseAndMouseCursorPosition(true)`）、`postMouseMove`（cliclick 口径，返回值取 `AXIsProcessTrusted()`）、`getVirtualScreenRect`（`CGGetActiveDisplayList`+`CGRectUnion(CGDisplayBounds)`）、`isAccessibilityTrusted` |
| `native/macos-input/index.js` | 唯一加载点（env → build/Release → build/Debug → build/`<Config>` → `prebuilds/<platform>-<arch>` → `prebuilds/<platform>-universal`）+ 降级门面；额外导出 `_makeFacade` 供守卫断言"不可用时全 null/false 且不抛" |
| `native/macos-input/index.d.ts` / `package.json` / `README.md` / `tools/smoke.cjs` / `tools/build-prebuild.cjs` | 与 `win32-input` 同口径的类型/脚本/文档/只读烟测；`build-prebuild` 属于 `T-0117` |
| `app/amayui-emulator/test/native-macos.test.ts` | 7 条守卫（见下） |

### 修改文件

| 文件 | 改动 |
|---|---|
| `app/amayui-emulator/electron/nativeAddon.ts` | 平台分派：`HOST_MODULE = win32 ? 'win32-input' : darwin ? 'macos-input' : null`；`Win32Input` → `HostInput`，变量 `w32` → `host`；**新增** `LOAD_SUMMARY_PREFIX` 表，把 `[native] win32-input available=` 与 `[native] macos-input available=` 两串字面量留在源码里（前者的锚点属 `T-0058`） |
| `native/win32-input/index.js` | 搜索链补最后一条 `prebuilds/<platform>-universal/`（保持两模块口径一致；win32 命中不了它） |
| `app/amayui-emulator/test/native-win32.test.ts` | 两处断言随变量改名（`w32\.` → `host\.`）；**断言意图不变**，`T-0058` 的证据锚点（测试名）不动 |
| `app/amayui-emulator/tools/verify-cursor.cjs` | 按平台选模块；不再无条件调用 `screen.dipToScreenPoint`；读回值比较先取整（macOS 会读到小数） |
| `app/amayui-emulator/electron/main.ts` | 两处注释提到 macos-input（无逻辑改动） |
| `native/README.md` | 模块表加一行；统一口径补「`CMAKE_JS_LIB/SRC` 只有 Windows 有」「`--CD` 拼写」「通用二进制兜底」「同名 API 必须同语义」 |
| `docs-new/04-app/native-addon.md` | 平台分派 + 两跳/三跳 + 打包一节改写（保留 `T-0058` 锚点 `## 5. 打包（二进制怎么随应用走）`） |
| `analysis/engine-capabilities.json` | `host-cursor-warp` 的 `emulator.note` 补 macOS 落地段（含两跳与权限口径） |

### 守卫（`test/native-macos.test.ts`，7 条全绿）

1. 降级契约：空目录 ⇒ `available=false` + 一行 `reason` + `tried` 全在 root 下；
2. 搜索链顺序（含 `-universal` 兜底排在按 arch 落点**之后**）；
3. 门面不可用时全 `null`/`false`，且原生层抛错被兜住；
4. `★E3` 真产物只读探测（`available/supported` 为真、光标落在虚拟屏矩形内、**不动光标**）；
5. `★预置产物棘轮`：`prebuilds/darwin-universal/macos_input.node` 必须存在、`lipo -archs` 必须
   `arm64 x86_64`、每个 slice 的 `minos` 必须 `11.0`（`T-0117` 的判据）；
6. 预置产物就是"没编译器也能用"那条路（两个落点都能被加载器命中）；
7. 主进程源码棘轮：darwin 选 `macos-input`、`T-0058` 的两串锚点字面量仍在、
   `const phys =` / `dipToScreenPoint` 的「有则用」写法仍在、`initNativeAddon()` 仍在 `registerLogIpc()` 之后。

### 判据与实测

- `npx tsx --test test/native-macos.test.ts` ⇒ 7 pass / 0 fail；
- `npx tsx --test test/native-win32.test.ts` ⇒ 6 pass / 1 skip（Windows 产物缺失，预期）/ 0 fail；
- `AMAYUI_MACOS_INPUT_MOVE_TEST=1 node native/macos-input/tools/smoke.cjs` ⇒ 挪动 + 复位一致（exit 0）；
- `AMAYUI_CURSOR_VERIFY=1 npx electron tools/verify-cursor.cjs` ⇒ DIP(440,392) → 点(440,392) → 读回一致 → 复位一致（exit 0）；
  把 `build/` 移走后重跑 ⇒ 走 `prebuilds/darwin-universal/macos_input.node`，结论不变；
- `npm run shot`（真实主进程）⇒ 日志出现 `[native] macos-input available=true supported=true`。

## 2026-09-22

★2026-09-22 路径变更（`tickets/T-0119`）：本文件里提到的 `native/win32-input/**`（或 `native/macos-input/**`）现在合并成了 `native/host-input/**` —— 一个 addon、两个平台实现；产物名与 env 分别是 `host_input.node` 与 `AMAYUI_HOST_INPUT_NODE`，预置产物在 `prebuilds/darwin-universal/host_input.node`，守卫并成 `test/native-host.test.ts`。下文按当时的记录保留。
