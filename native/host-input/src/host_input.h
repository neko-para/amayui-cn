/**
 * host_input.h —— 宿主侧原生能力的**跨平台入口声明**。
 *
 * 本模块是**一个 addon、两个平台实现**：`host_input.cc` 里的 `Init` 只负责
 * 「报 platform/supported + 按平台调用对应的 `Register*`」；真正的函数住在各自的平台 TU 里：
 *
 * | TU | 平台 | 注册什么 |
 * |---|---|---|
 * | `src/win32_input.cc` | `_WIN32` | `getCursorPos` / `setCursorPos` / `getVirtualScreenRect` / `getSystemMetrics` / `getAsyncKeyState` / `showCursor` |
 * | `src/macos_input.cc` | `__APPLE__` | `getCursorPos` / `setCursorPos` / `getVirtualScreenRect` / `postMouseMove` / `isAccessibilityTrusted` |
 *
 * ★口径：**同名 API 必须同语义**（`getCursorPos`/`setCursorPos`/`getVirtualScreenRect` 三者在两个平台上
 * 含义一致，差别只在坐标单位 —— Win32 是物理像素、CoreGraphics 是点），这是调用方不必按平台分叉的前提；
 * **平台专有的东西绝不硬凑同名**（`getSystemMetrics` 的 `SM_*` 常量、`getAsyncKeyState` 的 VK 码表、
 * macOS 的辅助功能授权态），它们只在自己的平台上注册，别的平台上根本不存在 ⇒ 加载器门面退化成
 * `null`/`false`。
 *
 * 新增函数的流程（照抄即可）：在对应平台的 TU 里加实现 → 该 TU 的 `Register*` 里 `exports.Set` →
 * `index.js` 的 `makeFacade` 加一行 → `index.d.ts` 加声明 → `tools/smoke.cjs` 加只读探测。
 */
#ifndef HOST_INPUT_H_
#define HOST_INPUT_H_

#include <napi.h>

/** 注册 Win32 那套实现（非 Windows 平台是**空实现**：什么都不注册）。 */
void RegisterWin32(Napi::Env env, Napi::Object& exports);

/** 注册 macOS 那套实现（非 macOS 平台是**空实现**：什么都不注册）。 */
void RegisterMacos(Napi::Env env, Napi::Object& exports);

#endif  // HOST_INPUT_H_
