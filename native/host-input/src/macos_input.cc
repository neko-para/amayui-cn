/**
 * macos_input —— 宿主侧 macOS 能力的**平台实现 TU**（由 `host_input.cc` 的 `Init` 调 `RegisterMacos` 注册）。
 *
 * 为什么需要它：浏览器/Electron 都没有「移动真实系统光标」的 API（只有合成事件），而引擎的
 * `0x10A`（`i10a`，`sub_421EA0` raw 30530-30598）在宿主侧就是 `ClientToScreen` + **`SetCursorPos`**。
 * macOS 上的对应原语是 CoreGraphics：`CGWarpMouseCursorPosition`（挪光标）与
 * `CGEventCreateMouseEvent(kCGEventMouseMoved)` + `CGEventPost(kCGHIDEventTap, …)`
 * ——后者正是参考实现 [cliclick](https://github.com/BlueM/cliclick) 的 `m:` 口径。
 *
 * 缺口归口 `tickets/T-0053`；落地见 `T-0116`；模块结构见 `T-0119`。
 *
 * 设计口径（写给下一个加函数的人，也见 `host_input.h`）：
 *  1. **只做 CoreGraphics 一层**，不掺业务：坐标一律是 **CGEvent 的全局显示坐标（点）**。
 *     ★macOS 上「点」就是 Electron 的 DIP（`win.getContentBounds()` 与 `screen` 给的都已经是点）
 *     ⇒ 主进程**不需要** Windows 那种「DIP → 物理」换算；在这里乘 `scaleFactor` 是双重换算。
 *  2. **只在自己平台注册**：本文件在非 macOS 上编译成空的 `RegisterMacos`（一个函数都不注册）
 *     ⇒ 加载器门面把 `getCursorPos` 等退化成 `null`/`false`，调用方只有一条代码路径。
 *  3. **运行时失败返回 `null`/`false`**；只有「参数类型/个数写错」才抛 `TypeError`（编程错误要吵）。
 *  4. **权限**：`CGWarpMouseCursorPosition` 是「挪光标」原语，**不需要**辅助功能（Accessibility）授权；
 *     `CGEventPost(kCGHIDEventTap, …)` **需要**授权，未授权时事件被**静默丢弃** ⇒ 默认走 warp，
 *     `postMouseMove` 只作为显式可选动作，并用 `isAccessibilityTrusted()` 让调用方能诊断。
 *  5. **取整口径**：系统里的光标位置落在**整数点**上，而 `CGWarpMouseCursorPosition` 对小数是**截断**
 *     （实测 `1234.9 → 1234`、`-102.9 → -103`）。截断会让「挪到 x、再读回 x」在小数上不成立
 *     ⇒ 本模块统一**四舍五入到整数点**再 warp，使 `setCursorPos(p)` 与随后的 `getCursorPos()` 自洽
 *     （调用方给的本来就是整数：主进程 `Math.round(b.x + clientX)`）。
 */
#include "host_input.h"

#ifdef __APPLE__

#include <ApplicationServices/ApplicationServices.h>

#include <cmath>
#include <string>
#include <vector>

namespace {

Napi::Object PointObject(Napi::Env env, double x, double y) {
  Napi::Object o = Napi::Object::New(env);
  o.Set("x", Napi::Number::New(env, x));
  o.Set("y", Napi::Number::New(env, y));
  return o;
}

/** 取第 `i` 个参数为数字（越界/类型错 ⇒ 抛 TypeError）。坐标是**点**，允许小数。 */
double NumberArg(const Napi::CallbackInfo& info, size_t i, const char* what) {
  if (info.Length() <= i || !info[i].IsNumber()) {
    throw Napi::TypeError::New(info.Env(), std::string("host_input/macos: 参数 ") + what + " 需要是数字");
  }
  return info[i].As<Napi::Number>().DoubleValue();
}

/** 把坐标吸附到整数点（口径 5）；荒谬的巨值原样交给系统去拒绝，不在这里发明钳制。 */
double Snap(double v) {
  if (!(v > -1e7 && v < 1e7)) return v;
  return static_cast<double>(std::llround(v));
}

// ---------------------------------------------------------------------------
// 光标
// ---------------------------------------------------------------------------

/** `getCursorPos()` → `{x,y}`（CGEvent 全局显示坐标，点）| `null`（调用失败）。 */
Napi::Value GetCursorPosFn(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  CGEventRef ev = ::CGEventCreate(nullptr);
  if (ev == nullptr) return env.Null();
  const CGPoint p = ::CGEventGetLocation(ev);
  ::CFRelease(ev);
  return PointObject(env, static_cast<double>(p.x), static_cast<double>(p.y));
}

/**
 * `setCursorPos(x, y)` → `true/false`。= 引擎 `0x10A` 的宿主侧动作（Windows 上的 `SetCursorPos`）。
 *
 * ★为什么 warp 之后要立刻 `CGAssociateMouseAndMouseCursorPosition(true)`：Apple 文档写明了 warp 会让
 * 「鼠标」与「光标」**短暂脱钩**（防止 warp 制造出一次巨大的相对位移）。脱钩期间物理移动不再累积到
 * 光标上，若不复位关联，症状是「脚本挪完光标后，玩家推鼠标推不动/要抖一下」。
 */
Napi::Value SetCursorPosFn(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const double x = Snap(NumberArg(info, 0, "x"));
  const double y = Snap(NumberArg(info, 1, "y"));
  const CGError err = ::CGWarpMouseCursorPosition(CGPointMake(x, y));
  if (err != kCGErrorSuccess) return Napi::Boolean::New(env, false);
  ::CGAssociateMouseAndMouseCursorPosition(true);
  return Napi::Boolean::New(env, true);
}

/**
 * `postMouseMove(x, y)` → `true/false` —— cliclick 的 `m:` 口径（合成 `kCGEventMouseMoved` 投到 HID 事件流）。
 *
 * 返回值是 **`AXIsProcessTrusted()`**：`CGEventPost` 自身返回 void，而未授权时事件会被系统**静默丢弃**
 * ⇒ 用「有没有辅助功能授权」当返回值，才能让调用方分辨「投递了但没生效」。本模块的默认路径
 * （`setCursorPos`）不走这条路，所以没有授权也能把光标挪过去。
 */
Napi::Value PostMouseMoveFn(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const double x = Snap(NumberArg(info, 0, "x"));
  const double y = Snap(NumberArg(info, 1, "y"));
  CGEventRef ev = ::CGEventCreateMouseEvent(nullptr, kCGEventMouseMoved, CGPointMake(x, y), kCGMouseButtonLeft);
  if (ev == nullptr) return Napi::Boolean::New(env, false);
  ::CGEventPost(kCGHIDEventTap, ev);
  ::CFRelease(ev);
  return Napi::Boolean::New(env, ::AXIsProcessTrusted());
}

/** `getVirtualScreenRect()` → `{x,y,width,height}`（所有活动显示器的**并集**，点）| `null`。 */
Napi::Value GetVirtualScreenRectFn(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  uint32_t count = 0;
  if (::CGGetActiveDisplayList(0, nullptr, &count) != kCGErrorSuccess || count == 0) return env.Null();
  std::vector<CGDirectDisplayID> ids(count);
  if (::CGGetActiveDisplayList(count, ids.data(), &count) != kCGErrorSuccess || count == 0) return env.Null();
  // `CGDisplayBounds` 给的是**全局显示坐标**（原点 = 主显示器左上角，左上原点）——与 CGEvent 同一套坐标系。
  CGRect u = CGRectNull;
  for (uint32_t i = 0; i < count; ++i) u = ::CGRectUnion(u, ::CGDisplayBounds(ids[i]));
  if (::CGRectIsNull(u)) return env.Null();
  Napi::Object o = PointObject(env, static_cast<double>(u.origin.x), static_cast<double>(u.origin.y));
  o.Set("width", Napi::Number::New(env, static_cast<double>(u.size.width)));
  o.Set("height", Napi::Number::New(env, static_cast<double>(u.size.height)));
  return o;
}

/** `isAccessibilityTrusted()` → 进程是否有「辅助功能」授权（只有 `postMouseMove` 这条路需要它）。 */
Napi::Value IsAccessibilityTrustedFn(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), ::AXIsProcessTrusted());
}

}  // namespace

void RegisterMacos(Napi::Env env, Napi::Object& exports) {
  exports.Set("getCursorPos", Napi::Function::New(env, GetCursorPosFn));
  exports.Set("setCursorPos", Napi::Function::New(env, SetCursorPosFn));
  exports.Set("getVirtualScreenRect", Napi::Function::New(env, GetVirtualScreenRectFn));
  exports.Set("postMouseMove", Napi::Function::New(env, PostMouseMoveFn));
  exports.Set("isAccessibilityTrusted", Napi::Function::New(env, IsAccessibilityTrustedFn));
}

#else

// 非 macOS：什么都不注册 —— Init 已把 supported 置成 false，门面会把这些函数退化成 null/false。
void RegisterMacos(Napi::Env, Napi::Object&) {}

#endif
