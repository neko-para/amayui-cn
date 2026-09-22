/**
 * host_input —— 宿主侧的**跨平台原生能力**（N-API 原生模块）。
 *
 * 为什么需要它：浏览器/Electron 都没有「移动真实系统光标」的 API（只有合成事件），而引擎的
 * `0x10A`（`i10a`，`sub_421EA0` raw 30530-30598）在宿主侧就是 `ClientToScreen` + **`SetCursorPos`**。
 * 两个平台的对应原语分别是：Win32 的 `SetCursorPos`、CoreGraphics 的 `CGWarpMouseCursorPosition`
 * （后者正是参考实现 [cliclick](https://github.com/BlueM/cliclick) 用的那族 API）。
 *
 * 缺口归口 `tickets/T-0053`；Windows 落地 `T-0058`、macOS 落地 `T-0116`、预置产物 `T-0117`；
 * 本文件的「一个 addon 两个平台实现」结构见 `T-0119`。
 *
 * ## 结构（一个 Init + 每个平台一个 TU）
 *
 * ```
 * host_input.cc      ← ★唯一 Init：报 platform/supported + 按平台调 Register*
 * win32_input.cc     ← Win32 实现（RegisterWin32）
 * macos_input.cc     ← macOS 实现（RegisterMacos）
 * ```
 *
 * 口径：
 *  1. **平台专有函数只在自己平台注册**（别的平台不存在 ⇒ 门面返回 null/false），跨平台同名 API
 *     语义一致、只有坐标单位不同 —— 详见 `host_input.h`；
 *  2. **纯 N-API**（`napi_*`，不含 `node::` 的 C++ 符号）⇒ 同一个 `.node` 在 Node 与 Electron 里都能加载，
 *     不需要 `@electron/rebuild`；Windows 另需延迟加载钩子（见 `CMakeLists.txt` 的 `CMAKE_JS_SRC`），
 *     macOS 没有这个坑；
 *  3. **不支持平台（Linux 等）也照样构建**：两个 TU 编译成空实现、`supported === false`、
 *     一个平台函数都不注册 ⇒ 加载器门面全返回 `null`/`false`，调用方只有一条代码路径。
 */
#include "host_input.h"

/** 模块入口：报平台能力 + 注册本平台的实现（两个 `Register*` 都调，非本平台的是空实现）。 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
#if defined(_WIN32)
  exports.Set("platform", Napi::String::New(env, "win32"));
  exports.Set("supported", Napi::Boolean::New(env, true));
#elif defined(__APPLE__)
  exports.Set("platform", Napi::String::New(env, "darwin"));
  exports.Set("supported", Napi::Boolean::New(env, true));
#elif defined(__linux__)
  exports.Set("platform", Napi::String::New(env, "linux"));
  exports.Set("supported", Napi::Boolean::New(env, false));
#else
  exports.Set("platform", Napi::String::New(env, "unknown"));
  exports.Set("supported", Napi::Boolean::New(env, false));
#endif
  RegisterWin32(env, exports);
  RegisterMacos(env, exports);
  return exports;
}

NODE_API_MODULE(host_input, Init)
