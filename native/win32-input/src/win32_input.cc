/**
 * win32_input —— 宿主侧的 Win32 能力（N-API 原生模块）。
 *
 * 为什么需要它：浏览器/Electron 都没有「移动真实系统光标」的 API（只有合成事件），而引擎的
 * `0x10A`（`i10a`，`sub_421EA0` raw 30530-30598）在宿主侧就是 `ClientToScreen` + **`SetCursorPos`**。
 * 缺口与决策见 `tickets/T-0053`；接入方式见 `docs-new/04-app/native-addon.md`。
 *
 * 设计口径（写给下一个加函数的人）：
 *  1. **只做 Win32 一层**，不掺业务：坐标一律是 Win32 语义（**物理像素**）。DIP ↔ 物理的换算由
 *     Electron 的 `screen.dipToScreenPoint()` 负责（它按显示器缩放算，且 Windows 专用）——别在这里
 *     自己乘 scaleFactor。
 *  2. **纯 N-API**（`napi_*`，不含 `node::` 的 C++ 符号）⇒ 同一个 `.node` 在 Node 与 Electron 里都能加载，
 *     不需要 `@electron/rebuild`。Windows 上另需延迟加载钩子，见 `CMakeLists.txt` 的 `CMAKE_JS_SRC`。
 *  3. **非 Windows 平台也能编译**：所有函数存在，但返回 `null`/`false`（`supported === false`）。
 *     这样调用方只有一条代码路径，守卫测试也不必按平台分叉（见 `index.js` 的 `available`）。
 *  4. **运行时失败返回 `null`/`false`**；只有"参数类型/个数写错"才抛 `TypeError`（编程错误要吵）。
 */
#include <napi.h>

#include <string>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

namespace {

Napi::Object PointObject(Napi::Env env, long x, long y) {
  Napi::Object o = Napi::Object::New(env);
  o.Set("x", Napi::Number::New(env, static_cast<double>(x)));
  o.Set("y", Napi::Number::New(env, static_cast<double>(y)));
  return o;
}

/** 取第 `i` 个参数为整数（越界/类型错 ⇒ 抛 TypeError）。 */
int32_t IntArg(const Napi::CallbackInfo& info, size_t i, const char* what) {
  if (info.Length() <= i || !info[i].IsNumber()) {
    throw Napi::TypeError::New(info.Env(), std::string("win32_input: 参数 ") + what + " 需要是整数");
  }
  return info[i].As<Napi::Number>().Int32Value();
}

// ---------------------------------------------------------------------------
// 光标
// ---------------------------------------------------------------------------

/** `getCursorPos()` → `{x,y}`（物理屏幕像素）| `null`（非 Windows / 调用失败）。 */
Napi::Value GetCursorPosFn(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
#ifdef _WIN32
  POINT p{};
  if (!::GetCursorPos(&p)) return env.Null();
  return PointObject(env, p.x, p.y);
#else
  return env.Null();
#endif
}

/** `setCursorPos(x, y)` → `true/false`（物理屏幕像素）。= 引擎 `0x10A` 的宿主侧动作。 */
Napi::Value SetCursorPosFn(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const int32_t x = IntArg(info, 0, "x");
  const int32_t y = IntArg(info, 1, "y");
#ifdef _WIN32
  return Napi::Boolean::New(env, ::SetCursorPos(x, y) != 0);
#else
  return Napi::Boolean::New(env, false);
#endif
}

/** `getVirtualScreenRect()` → `{x,y,width,height}`（多显示器**并集**，物理像素）| `null`。 */
Napi::Value GetVirtualScreenRectFn(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
#ifdef _WIN32
  const int x = ::GetSystemMetrics(SM_XVIRTUALSCREEN);
  const int y = ::GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int w = ::GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const int h = ::GetSystemMetrics(SM_CYVIRTUALSCREEN);
  Napi::Object o = PointObject(env, x, y);
  o.Set("width", Napi::Number::New(env, w));
  o.Set("height", Napi::Number::New(env, h));
  return o;
#else
  return env.Null();
#endif
}

// ---------------------------------------------------------------------------
// 其它 Win32 查询（当前调用方用不到，作为"通用工具"的常用面；都是无副作用查询）
// ---------------------------------------------------------------------------

/** `getSystemMetrics(index)` → 数值 | `null`（`SM_*` 常量，物理像素）。 */
Napi::Value GetSystemMetricsFn(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const int32_t index = IntArg(info, 0, "index");
#ifdef _WIN32
  return Napi::Number::New(env, ::GetSystemMetrics(index));
#else
  return env.Null();
#endif
}

/**
 * `getAsyncKeyState(vk)` → Win32 的 **SHORT**（bit15 = 当前按下，bit0 = 上次调用后按过）| `null`。
 *
 * 引擎用 `GetAsyncKeyState` 轮询"按住态真值"（`sub_4770A0`，全库 10 处）——这正是
 * `InputManager.syncButtons` 用 `e.buttons` 模拟的那件事（`tickets/T-0027`）。
 */
Napi::Value GetAsyncKeyStateFn(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const int32_t vk = IntArg(info, 0, "vk");
#ifdef _WIN32
  const SHORT s = ::GetAsyncKeyState(vk);
  return Napi::Number::New(env, static_cast<int16_t>(s));
#else
  return env.Null();
#endif
}

/** `showCursor(show)` → 调用后的显示计数（引擎的 `ShowCursor` 语义）| `null`。 */
Napi::Value ShowCursorFn(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBoolean()) {
    throw Napi::TypeError::New(env, "win32_input: 参数 show 需要是 boolean");
  }
  const bool show = info[0].As<Napi::Boolean>().Value();
#ifdef _WIN32
  return Napi::Number::New(env, ::ShowCursor(show ? TRUE : FALSE));
#else
  return env.Null();
#endif
}

}  // namespace

/** 模块入口：导出常量 + 上面那些函数。 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
#ifdef _WIN32
  exports.Set("platform", Napi::String::New(env, "win32"));
  exports.Set("supported", Napi::Boolean::New(env, true));
#elif defined(__APPLE__)
  exports.Set("platform", Napi::String::New(env, "darwin"));
  exports.Set("supported", Napi::Boolean::New(env, false));
#elif defined(__linux__)
  exports.Set("platform", Napi::String::New(env, "linux"));
  exports.Set("supported", Napi::Boolean::New(env, false));
#else
  exports.Set("platform", Napi::String::New(env, "unknown"));
  exports.Set("supported", Napi::Boolean::New(env, false));
#endif
  exports.Set("getCursorPos", Napi::Function::New(env, GetCursorPosFn));
  exports.Set("setCursorPos", Napi::Function::New(env, SetCursorPosFn));
  exports.Set("getVirtualScreenRect", Napi::Function::New(env, GetVirtualScreenRectFn));
  exports.Set("getSystemMetrics", Napi::Function::New(env, GetSystemMetricsFn));
  exports.Set("getAsyncKeyState", Napi::Function::New(env, GetAsyncKeyStateFn));
  exports.Set("showCursor", Napi::Function::New(env, ShowCursorFn));
  return exports;
}

NODE_API_MODULE(win32_input, Init)
