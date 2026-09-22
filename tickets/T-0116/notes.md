# T-0116 · 调查与设计（macOS 宿主侧那半件）

## 0. 用户要求（原文）

> 目前 windows 上 emulator 有一个辅助二进制来实现移动鼠标的能力，但是似乎采用的是就地构建二进制而非打包。
> 请先实现一个 macos 版本，可以考虑参考 https://github.com/BlueM/cliclick。
> 然后研究能否将其直接编译好后预置进仓库中。macos 的话 deployment target = 11，双架构。

本票只做**前半句**（macOS 版本）；「预置进仓库」拆成 `tickets/T-0117`（`blockedBy` 本票）。

## 1. 现状：`native/win32-input` 的边界在哪里

`native/win32-input/src/win32_input.cc` 里所有实现都在 `#ifdef _WIN32` 之内，`#else` 一律
`return env.Null()` / `Napi::Boolean::New(env, false)`，`Init` 里 `supported = false`
⇒ **macOS 上模块能编译、能加载，但 `setCursorPos` 是空实现**。主进程 `nativeAddon.ts` 读到
`supported === false` 后只记一行降级诊断，`0x10A` 退化成「只改引擎侧光标」——
而这是**静默**的（`analysis/engine-capabilities.json#host-cursor-warp` 的 `whySilent`）。

结论：这不是"以后再说"的缺口，而是**本机（macOS）上这条能力根本不存在**。

## 2. 设计决策：为什么是「第二个模块」而不是往 win32-input 里加 `__APPLE__`

| 方案 | 评价 |
|---|---|
| 在 `win32-input/src/win32_input.cc` 里补 `#ifdef __APPLE__` | ❌ 一个叫 `win32` 的模块同时服务两个平台的**坐标语义**（物理像素 vs 点）、**权限模型**（无 vs TCC 辅助功能）、**构建变量**（`CMAKE_JS_LIB/SRC` 只有 Windows 有）——名字会立刻开始骗人；而且 Windows 那份的 evidence 锚点全挂在这个目录上 |
| **新增 `native/macos-input`（采纳）** | ✅ `native/README.md` 本来就是"多模块之家"，且已写明「一个子目录 = 一个独立可构建的原生模块」；两个模块**同口径**（同一套加载链/降级门面/API 名），主进程只多一处「按平台挑一个」 |
| 改名叫 `native/host-input` 让一个模块跨平台 | ❌ 会打断 `tickets/T-0053`/`T-0058` 上十条 evidence 锚点（都在 `native/win32-input/**`），收益只是省一个目录 |

## 3. macOS 三条路线的实测比较

| 路线 | 需辅助功能授权？ | 实测 | 结论 |
|---|---|---|---|
| `CGWarpMouseCursorPosition` + `CGAssociateMouseAndMouseCursorPosition(true)` | **不需要** | `setCursorPos(+3,+3)` → 读回一致 → 复位一致 | ✅ **默认路径**（= 引擎 `SetCursorPos` 的对应物） |
| `CGEventCreateMouseEvent(kCGEventMouseMoved)` + `CGEventPost(kCGHIDEventTap, …)`（**cliclick 的 `m:` 就是这条**） | **需要** | 本机 `isAccessibilityTrusted() === true` 时投递成功 | ✅ 保留为**显式可选**的 `postMouseMove`；未授权时事件被**静默丢弃** ⇒ 返回值取 `AXIsProcessTrusted()`，让调用方能分辨"投递了但没生效" |
| `NSEvent` / Cocoa 层 | 需要（且要跑在主线程 + runloop） | 未试 | ❌ 引入 ObjC 运行时与主线程约束，换不来额外能力 |

★为什么默认不用 cliclick 那条：它需要授权，而**缺授权时的表现是静默失败**（本能力最怕的就是
"看起来做了"）；warp 不需要授权、语义上也更接近 `SetCursorPos`（都是"直接摆过去"）。
cliclick 值得借鉴的另一半是：它对本能力的定位就是"移动光标"这一件事。

## 4. 两条实测出来的口径（都写进了 `src/macos_input.cc` 的头注释）

1. **warp 会让鼠标与光标短暂脱钩**：Apple 文档写明 warp 后 mouse/cursor 会短暂 disassociate（防止
   warp 制造一次巨大的相对位移）⇒ 必须立刻 `CGAssociateMouseAndMouseCursorPosition(true)`，
   否则症状是「脚本挪完光标后，玩家推鼠标推不动」。
2. **系统光标落整数点，而 warp 对小数是截断**：实测 `1234.9 → 1234`、`-102.9 → -103`
   （`getCursorPos` 本身会读到小数：触控板按亚像素累积，实测读到 `2377.984375`）。
   ⇒ 模块内统一**四舍五入**后再 warp，让 `setCursorPos(p)` 与随后的 `getCursorPos()` 自洽；
   比较读回值时先取整（smoke 与 `verify-cursor.cjs` 都按这个口径写，否则会假红）。

## 5. 坐标：macOS 只有两跳（Windows 三跳）

```
引擎虚拟坐标 → 渲染进程 canvas rect 逆换算 → IPC 客户区 CSS 像素
   → 主进程 + getContentBounds()（DIP 点）
   → [Windows] screen.dipToScreenPoint() ⇒ 物理像素
   → [macOS]  没有这一跳：CoreGraphics 的全局显示坐标**就是点**，Electron 的 DIP 也是点
```

`electron/nativeAddon.ts` 里那一跳本来就写成「`typeof screen.dipToScreenPoint === 'function'` 则用」
（Windows 专用 API）⇒ 平台分派只要换模块 + 保留这句「有则用」即可。
**在 macOS 上补这一跳就是双重换算**（Retina 的缩放不在这个坐标系里），守卫把这句话钉住了。

## 6. 加载链口径的一处扩展

`native/README.md` 的统一口径说两个模块的搜索链一致。为了「通用二进制」这个落点，两边都加了
最后一条兜底 `prebuilds/<platform>-universal/<basename>`（win32 命中不了它，加它只为口径一致）：

```
env → build/Release → build/Debug → build/<Config> → prebuilds/<platform>-<arch>/ → prebuilds/<platform>-universal/
```

★本地构建产物**优先**于预置产物：开发者改了 C++ 只要 `npm run build` 就生效，不必重跑预编译。

## 7. 真机核验数字（macOS 26.3 / arm64 / Node v24.16 / Electron 44.2）

| 核验 | 命令 | 结果 |
|---|---|---|
| 模块级只读 | `node native/macos-input/tools/smoke.cjs` | `available=true supported=true`；光标 `(2767.98, 822)`；虚拟屏 `{0,-323,4288,1440}`；`isAccessibilityTrusted=true` |
| 模块级真挪 | `AMAYUI_MACOS_INPUT_MOVE_TEST=1 …` | `(+3,+3)` → 读回一致 → 复位一致（exit 0） |
| 真 Electron 宿主 | `AMAYUI_CURSOR_VERIFY=1 npx electron tools/verify-cursor.cjs` | 内容区 DIP `(120,152)` ⇒ 目标 DIP `(440,392)` → 屏幕点 `(440,392)` → 读回一致 → 复位一致（exit 0） |
| **仅预置产物**（把 `build/` 移走再跑上面两条） | 同上 | 路径变成 `prebuilds/darwin-universal/macos_input.node`，结论不变 ⇒ 「没编译器也能用」成立 |
| 产品宿主 | `npm run shot`（真实主进程装配） | 日志第 6 行 `[native] macos-input available=true supported=true path=…`（日志在 `.tmp/`，故证据锚点落在产出这行字的源码上） |

## 8. 明确不做的（边界）

- `getSystemMetrics` / `getAsyncKeyState` / `showCursor` **不提供 macOS 版**：名字相同、语义不同
  （`SM_*` 常量、Windows VK 码表、`ShowCursor` 的显示计数）比没有更危险 —— 需要时另起名字并写清语义。
- 只接 `0x10A` 这条路。引擎另两处「把光标居中」（raw 11863 / 141138）与 `ShowCursor` 两处仍未接线
  （与 Windows 侧同一结论，见 `host-cursor-warp` 的 note）。
- 没做「观感」的 E4 目视确认（ADV 侧栏钉光标那 1470 处）——那属于 `tickets/T-0051` 的 E4 清单。

## 2026-09-22

★2026-09-22 设计反转（`tickets/T-0119`）：本票当时选了「与 win32-input 平行的第二个模块」，理由是「不要往一个以平台命名的模块里塞另一个平台的实现」—— 方向对，但**落点错了**：正确做法不是再加一个以平台命名的模块，而是让模块本身跨平台（`native/host-input`：一个 Init + 每平台一个实现 TU）。本票的 macOS 实现与结论全部有效，只是搬家了；路径映射见 changes.md 末尾的指针。
