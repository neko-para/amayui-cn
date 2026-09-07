// =============================================================================
//  engine-refined/model/engine.hpp — 天結いキャッスルマイスター Engine「指令层」字段模型（初版）
//
//  依据：仅收录**目前已拆分的指令**（engine-refined/engine/{arith,bit,float,str,memory}-ops.cpp）
//  实际引用到的 Engine 字段；其余一律还原为 padding，供后续「重新准确分析」时迭代填充。
//
//  已确认引用（来自指令函数体扫描）：
//    - this->frames[this->cur_script].arity             → cur_script(0x5D880) + frames(0x5D894) + arity(frame+0x60)
//    - this->key                                        → key(0x5EC8C)
//    - _this[97060]                                     → byte 388240 (0x5EC90)：fill-zero 读的 ENC(0) 常量槽
//    - _this + 8(子对象/字符缓冲)  → byte 8   ：bit-set/reset/check-bit/random 的 ShowMessage sprintf 目标（**待确认**）
//    - _this + 5452(_DWORD* 索引) → byte 21808(0x5530)：string-lookup-set 的引擎全局字符串表基址（**待确认**）
//    - _this + 107724(_DWORD* 索引)→ byte 430896(0x69330)：random 的计数器（**待确认**）
//
//  构造初始化（commandConstructor_415640）新增建模的扁平字段：
//    - vftable @0x0                  → ctor 设 = &Command___vftable_
//    - script_state0..5 @0x5D860..0x5D878 → ctor 清零（**待确认**：cur_script 之下的脚本运行状态槽）
//    - kernel32_module @0x5EC94 / is_debugger_present @0x5EC98 → ctor 做反调试初始化
//
//  构造里的子对象初始化（如 _this+1032/7912/18664/… 传给 sub_XXX）不在本文件建模；各自偏移+初始化函数
//  见 engine-refined/engine/members.cpp 的 commandConstructor_415640 头部注释。
//
//  约定：本模型用**字节偏移**（同 engine/engine.hpp）。反编译里 `_this[...]`（DWORD 索引）×4=字节偏移；
//  `_this + N` 按 `_this` 类型换算（_DWORD*/int* → N*4；char*/int → N）。**凡标「待确认」的偏移，后续需重新核对。**
//  只作分析底座，不被可执行游戏调用。与 engine/engine.hpp 的区别：本文件砍掉了指令层未用到的字段
//  （dispatch 表 0xA509C、call_ret/call_link/call_flag、global_*_base 等），保留指令实际依赖的部分。
// =============================================================================
#pragma once

#include <cstdint>
#include <cstddef>

namespace amayui {

typedef uint32_t uaddr;   // 32 位地址/指针字段（游戏 x86）

#if defined(_MSC_VER) && defined(_M_IX86)
#  define AMAYUI_THISCALL __thiscall
#else
#  define AMAYUI_THISCALL
#endif

#pragma pack(push, 4)

// -----------------------------------------------------------------------------
// DEC/ENC 混淆（异或 + 循环移位；与 engine/engine.hpp 一致）
// -----------------------------------------------------------------------------
inline uint32_t amayui_rol32(uint32_t v, int n) { n &= 31; return (v << n) | (v >> ((32 - n) & 31)); }
inline uint32_t amayui_ror32(uint32_t v, int n) { n &= 31; return (v >> n) | (v << ((32 - n) & 31)); }
inline uint32_t amayui_dec(uint32_t key, uint32_t x) { return amayui_ror32(key ^ amayui_rol32(x, 11), 25); }
inline uint32_t amayui_enc(uint32_t key, uint32_t a) { return amayui_rol32(key ^ amayui_ror32(a, 7), 21); }

// -----------------------------------------------------------------------------
// 每脚本帧（仅收录指令用到的字段；未用区以 char[] 占位，可后续按需建模）
// -----------------------------------------------------------------------------
struct ScriptContext {                 // 0x78 (120) bytes
    uaddr    str_table;                // +0x00 字符串表基址 (this[95781])
    uaddr    ip;                       // +0x04 当前指令指针
    char     _pad_08[0x18];            // +0x08..0x20
    uaddr    local_int;                // +0x20 local-int 数组基址
    uaddr    local_float;              // +0x24
    uaddr    local_string;             // +0x28
    uaddr    local_ptr;                // +0x2C
    uaddr    local_float_ptr;          // +0x30
    char     _pad_34[0x04];            // +0x34..0x38
    uint32_t caller;                   // +0x38 返回链接
    uint32_t frame_arg;                // +0x3C 本帧传入参数
    char     _pad_40[0x20];            // +0x40..0x60
    uint32_t arity;                    // +0x60 指令长度(dword，含 opcode) —— 指令大量写它
    char     _pad_64[0x0C];            // +0x64..0x70
    uaddr    array_container;          // +0x70 每脚本数组容器
    char     _pad_74[0x04];            // +0x74..0x78
};
static_assert(sizeof(ScriptContext) == 0x78, "ScriptContext must be 120 bytes");

// -----------------------------------------------------------------------------
// Engine 对象模型（指令层；未用区 padding）
// -----------------------------------------------------------------------------
struct Engine;
using EngineHandler = void (AMAYUI_THISCALL *)(Engine *);

struct Engine {
    // ---- 头部未知区（0x000000 .. 0x5D800）：仅标出指令用到的散落字段 ----
    uaddr    vftable;                                        // 0x0    Engine 对象 vtable（ctor 设 = &Command___vftable_）
    char     _reserved_0x004[0x4];                           // 0x4  .. 0x8
    char     message_buf[0x400];                             // 0x8  .. 0x408  ShowMessage sprintf 目标（**待确认**；bit-set 等经 _this+8 使用）
    char     _reserved_0x408[0x5530 - 0x408];                // 0x408 .. 0x5530
    uaddr    string_table_base;                              // 0x5530  引擎全局字符串表基址（**待确认**；string-lookup-set 经 _this+5452 使用）
    char     _reserved_0x5534[0x5D860 - 0x5534];             // 0x5534 .. 0x5D860

    // ---- cur_script 之上（低地址侧）的一批清零 dword（ctor 把 0x5D860/64/68/70/74/78 清零；**待确认**：疑为解释器/脚本运行状态槽）----
    uint32_t script_state0;                                  // 0x5D860  ctor 清零（待确认）
    uint32_t script_state1;                                  // 0x5D864  ctor 清零（待确认）
    uint32_t script_state2;                                  // 0x5D868  ctor 清零（待确认）
    uint32_t _reserved_5D86C;                                // 0x5D86C  ctor 未写（缺口）
    uint32_t script_state3;                                  // 0x5D870  ctor 清零（待确认）
    uint32_t script_state4;                                  // 0x5D874  ctor 清零（待确认）
    uint32_t script_state5;                                  // 0x5D878  ctor 清零（待确认）
    uint32_t _reserved_5D87C;                                // 0x5D87C  ctor 未写（缺口，之后紧接 cur_script）

    // ---- 当前脚本上下文（0x5D880）----
    uint32_t cur_script;                                     // 0x5D880  this[95776] (383104)：当前帧深度 —— 指令大量用它
    char     _reserved_5D884[0x10];                          // 0x5D884 .. 0x5D894（指令未用 call_ret/call_link/call_flag）

    // ---- 每脚本帧数组（40 帧）----
    ScriptContext frames[40];                                // 0x5D894 .. 0x5EB54
    char     _reserved_5EB54[0x138];                         // 0x5EB54 .. 0x5EC8C

    // ---- 混淆 key 与紧邻的 ENC(0) 常量槽 ----
    uint32_t key;                                            // 0x5EC8C  this[97059]：DEC/ENC 用密钥
    uint32_t enc_zero;                                       // 0x5EC90  this[97060]：fill-zero 读取的 ENC(0) 常量槽

    // ---- 反调试初始化（ctor 写入）----
    uaddr    kernel32_module;                                // 0x5EC94  LoadLibraryA("Kernel32.dll") 返回的模块句柄
    uaddr    is_debugger_present;                            // 0x5EC98  GetProcAddress(kernel32_module,"IsDebuggerPresent") 函数地址
    char     _reserved_5EC9C[0x69330 - 0x5EC9C];             // 0x5EC9C .. 0x69330

    // ---- 计数器（random 用）----
    uint32_t counter;                                        // 0x69330  this[107724]：random 的帧计数器（**待确认**）
    char     _reserved_69334[0xB0000 - 0x69334];             // 0x69334 .. 0xB0000（指令未用到 dispatch 等）

    // ---- 便捷访问器（仅指令层用到）----
    ScriptContext *script(uint32_t cur) { return &frames[cur]; }
    const ScriptContext *script(uint32_t cur) const { return &frames[cur]; }
    uint32_t readLocalInt(uint32_t cur, uint32_t idx) const {
        return amayui_dec(key, reinterpret_cast<uint32_t*>(script(cur)->local_int)[idx]);
    }
    void writeLocalInt(uint32_t cur, uint32_t idx, uint32_t v) {
        reinterpret_cast<uint32_t*>(script(cur)->local_int)[idx] = amayui_enc(key, v);
    }
};

static_assert(sizeof(Engine) == 0xB0000, "Engine object size (placeholder, must be ≥ max observed this+offsets)");
static_assert(offsetof(Engine, cur_script)          == 0x5D880, "offset cur_script");
static_assert(offsetof(Engine, frames)              == 0x5D894, "offset frames");
static_assert(offsetof(Engine, key)                 == 0x5EC8C, "offset key");
static_assert(offsetof(Engine, enc_zero)            == 0x5EC90, "offset enc_zero (_this[97060])");
static_assert(offsetof(Engine, vftable)             == 0x0,     "offset vftable");
static_assert(offsetof(Engine, script_state0)       == 0x5D860, "offset script_state0");
static_assert(offsetof(Engine, script_state3)       == 0x5D870, "offset script_state3");
static_assert(offsetof(Engine, kernel32_module)     == 0x5EC94, "offset kernel32_module");
static_assert(offsetof(Engine, is_debugger_present) == 0x5EC98, "offset is_debugger_present");

#pragma pack(pop)

} // namespace amayui
