/* =============================================================================
 * global.cpp — 引擎全局对象（原反编译全局 int dword_55E1BC）
 * 由用户指定把 dword_55E1BC 的**声明**从 remaining-code.cpp 移到此处并命名为 `Engine *engine`。
 * ============================================================================= */
#include "model/engine.hpp"
using amayui::Engine;

/* ===== [x] dword_55E1BC  →  Engine *engine  状态: ANALYZED =====
 * 全局「游戏/Engine 对象」基址指针（原 guessed type `int dword_55E1BC`，位于数据段 0x55E1BC）。
 * 用途: 整个引擎用 `engine + <字节偏移>` 访问全局游戏对象字段，例如
 *       engine + 383104  = cur_script（0x5D880，当前脚本帧深度）
 *       engine + 697620  = 调试/窗口子对象（其 vtable+4 是 is_open/写入回调）
 *       engine + 699168 / 699172 = 两个数值字段（常被当作 float 读取，如当前帧参数）
 *       engine + 667856  = 开关/标志位（==1 判定的全局开关，如 debug/窗口显示）
 * 注意: `engine` 是 `Engine*`；反编译里的偏移是**字节偏移**，阅读时应按 `(char *)engine + off`
 *        理解（纯 `engine + off` 会按 sizeof(Engine) 缩放、与原始不符；各精修文件为保持反编译
 *        形态略去了显式 `(char *)` 转换，见其函数头说明）。
 * 证据: engine/天结_unpacked.exe_utf8.c raw 7006（声明）；调用例 raw 12228、45675、78304。
 */
Engine *engine;
