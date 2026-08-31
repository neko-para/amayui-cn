// =============================================================================
//  engine.hpp — 天結いキャッスルマイスター (AGE engine) 「this」对象模型复原
//
//  目的：把引擎 VM 对象（解释器/Command 的 `this`）的 C++ 数据结构复原出来，
//        作为后续逆向分析（字段语义、运行时数组、opcode handler 读写）的底座。
//
//  依据（全部为工程内真实路径 / 已确认结论）：
//    - engine/天结_unpacked.exe_utf8.c           (Hex-Rays 反编译，字节寻址)
//    - docs/re/engine/03-opcode分发与解释器.md   (dispatch 表 this+0xA509C, 主循环 sub_412290)
//    - docs/re/engine/05-操作数访问原语.md        (sub_41BF50/sub_42B4B0, DEC/ENC, 全局/局部数组基址)
//    - docs/re/engine/07-提取全局数据与定位this.md (全局数组基址 this+0x5D800..., key this+0x5EC8C)
//
//  约定：
//    - `this` 是「字节寻址」的 base 指针（反编译里 `this + N` 的 N 是 BYTE offset），x86 32 位。
//    - 只对「已确认」的字段给出类型与位置；**其余一律 char 数组占位**，绝不臆测。
//    - 游戏为 32 位 x86，地址都是 32 位 → 所有「指针/地址」字段用 `uaddr`(=uint32_t) 存储，
//      访问器里再 reinterpret_cast 成真实指针。这样在 64 位宿主机上也能得到与 32 位一致的布局。
//    - 本头文件仅供分析，不会被可执行游戏调用；调用约定仅为在 x86/Win 下表达。
//
//  用法示例（把运行进程里定位到的 `this` 转成该结构体）：
//      Engine* e = (Engine*)runtime_this;                 // 见 docs/re/engine/07 §6 的定位方案
//      e->readGlobalInt(0x53E104 + unitId*5 + slot);      // 掉落 rate（已解码，rate/100=个数）
// =============================================================================
#pragma once

#include <cstdint>
#include <cstddef>

namespace amayui {

// -----------------------------------------------------------------------------
// 32 位地址类型（游戏是 x86）；调用约定（仅表达用）
// -----------------------------------------------------------------------------
typedef uint32_t uaddr;        // 32 位地址/指针值（游戏进程地址域）

#if defined(_MSC_VER) && defined(_M_IX86)
#  define AMAYUI_THISCALL __thiscall
#else
#  define AMAYUI_THISCALL                                   // 分析用，不实际调用
#endif

#pragma pack(push, 4)          // 强制 4 字节对齐，匹配 32 位 x86 布局

// =============================================================================
// 1. 全局 variant 数组的「元素类型」
// =============================================================================

// 全局/局部 [整型] 数组元素：裸 uint32，值是 **编码后的位模式**（须过 DEC）。
//  - int 槽、ptr 目标、数组元素 全部经 key 异或 + 循环移位混淆；float 槽不编码。
using EngineGlobalInt   = uint32_t;                        // 有符号语义由字节码决定，底层存位模式

// 全局/局部 [浮点] 数组元素：直接存/取（**不编码**）。
using EngineGlobalFloat = float;

// 全局/局部 [指针] 数组元素：槽里存「指向目标值的指针」，读值要 *slot（int 化过 DEC / float 直取）。
using EngineGlobalPtr      = uaddr;                        // 槽里再解引用才是值
using EngineGlobalFloatPtr = uaddr;

// 全局/局部 [字符串] 数组元素：7-dword = 28 字节的 SSO(Small String Optimization) 结构。
//  来自 sub_41BF50 case 5/11 的访问路径：
//      v5 = 7 * idx; v6 = base;                 // 每个元素 28 字节
//      if ( *(v6 + 4*v5 + 20) < 0x10 )          // 长度字段 < 16 → 内联小串
//          p = (v6 + 4*v5);                     //   字符就在对象头部(+0)
//      else
//          p = *(char**)(v6 + 4*v5);            //   长串：+0 存堆指针
struct EngineString {                            // 0x1C (28) bytes
    union {
        char     inline_data[16];                // SSO：长度 < 0x10 时字符在头部（含结尾 NUL）
        uaddr    heap;                           // 长串：+0 是堆指针
        uint32_t dwords[4];                      // 原始视图
    } data;                                      // +0x00
    uint32_t dword4;                             // +0x10 当前访问路径未用到（保留）
    uint32_t length;                             // +0x14 (dword5)：< 0x10 → 内联小串
    uint32_t capacity;                           // +0x18 (dword6)
};
static_assert(sizeof(EngineString) == 0x1C, "EngineString must be 28 bytes");

// 全局/局部 [整型数组批量] 参数（0x8003/0x8009）的数组描述符。
//  来自 sub_42B4B0 数组分支：`operator new(0x10)` 拆成 {begin,end,cap} 4 dword，
//      元素数 = (end - begin) / 4；空数组时 push_back；非空时写 begin[0]。
struct SliceDescriptor {                         // 0x10 (16) bytes
    uaddr    begin;                              // +0x00 首元素地址
    uaddr    end;                                // +0x04 尾后地址
    uaddr    cap;                                // +0x08 容量（按元素）
    uint32_t reserved;                           // +0x0C
};
static_assert(sizeof(SliceDescriptor) == 0x10, "SliceDescriptor must be 16 bytes");

// =============================================================================
// 2. 每个脚本上下文的「页」（120 字节 / 0x78）
// =============================================================================
//  引擎按 `this[95776]=cur_script` 区分脚本上下文；每页 = 120 字节 = 0x78，
//  页基址 = this + 0x5D894 + 0x78*cur_script。
//  页内偏移（相对页基址）＝ 反编译绝对常量 − 0x5D894：
//       0x00 字符串表   0x04 IP指针   0x20 local-int  0x24 local-float
//       0x28 local-string 0x2C local-ptr 0x30 local-float-ptr
//       0x38 caller(返回链接)  0x3C frame_arg  0x60 arity(长度?)  0x70 数组容器
//
//  ★ local_xxx 与脚本头 `local_vars = { ... }` 的关系（推测，未逐一坐实）：
//     脚本 BIN 头（BinaryInformation）里有 `local_vars = { f 1 1 6 1 2 }` 这类声明，反汇编器把它命名成
//        local_integer_1 / local_floats / local_strings_1 / local_integer_2 / unknown_data / local_strings_2
//     —— 这就是该脚本「声明的局部变量按类别的数量/容量」。
//     而这里的 local_xxx 是引擎**运行时**为“当前脚本”的各种局部变量池准备的 **基址指针**
//     （local-int/float/string/ptr/float-ptr，分别对应操作数 arg type 0x9/0xA/0xB/0xC/0xD），
//     `sub_41BF50`/`sub_42B4B0` 用它们按 `base + 4*raw` 读/写局部操作数。
//     头里的 6 个计数 vs 这里的 5 个类别基址：头部多出的 “integer_2/strings_2/unknown” 可能与
//     反汇编器里 “Another type of int and string?”（0xE / 0x8000 序列）的**另一组局部区**对应；
//     下述未标定 dword 即可能承载它们（此为推测）。
struct ScriptContext {                           // 0x78 (120) bytes
    uaddr    str_table;                          // +0x00 字符串表基址 (this[95781])
    uaddr    ip;                                 // +0x04 当前指令指针（解释器里用它取 opcode）
    char     _pad_08[0x18];                      // +0x08..0x20
    uaddr    local_int;                          // +0x20 (this[95789])：local-int 数组基址
    uaddr    local_float;                        // +0x24 (this[95790])
    uaddr    local_string;                       // +0x28 (this[95791])
    uaddr    local_ptr;                          // +0x2C (this[95792])
    uaddr    local_float_ptr;                    // +0x30 (this[95793])
    char     _pad_34[0x04];                      // +0x34..0x38
    uint32_t caller;                             // +0x38 (this[95795] = 383180)：返回链接（回到调用层）
    uint32_t frame_arg;                          // +0x3C (this[95796] = 383184)：本帧传入参数
    char     _pad_40[0x20];                      // +0x40..0x60
    uint32_t arity;                              // +0x60 指令长度(单位=dword，含 opcode)
    char     _pad_64[0x0C];                      // +0x64..0x70
    uaddr    array_container;                    // +0x70 每脚本数组容器 (this[95809] = 383236)
    char     _pad_74[0x04];                      // +0x74..0x78
};
static_assert(sizeof(ScriptContext) == 0x78, "ScriptContext must be 120 bytes");

// ★ 每脚本帧的「调用栈」：引擎在 this 里放了一个 40 帧的固定帧数组（0..39），
//   `cur_script` 就是当前帧的深度/指针。call-script 用它做“压栈/弹栈”：
//     - 压栈（call，opcode，`sub_41C6A0`）：`this+383108 = cur`（保存调用层）；`cur = cur+1`；
//       超过 39 → 抛“ファイルの階層が深すぎます…最大40”；`sub_40ED40` 初始化新帧（读脚本文件、分配字符串表）。
//     - 弹栈（return/exit，opcode，`sub_41A820` 等）：`cur = *(this+383108)`（或 `cur-1`）回退到调用层；
//       被挂起的调用层帧的 IP/局部变量/字符串表一直留在原帧里，所以嵌套脚本互不覆盖。
//   故「call-script 叠加」= 固定 40 帧数组 + `cur_script` 当深度指针，不需要动态再分配。
//   `this+0x5D884(=383108)/0x5D888(=383112)/0x5D88C(=383116)` 是 cur_script 旁的三个☞控制流目标深度寄存器
//   （存帧下标或 -1/-10/-11 哨兵，见 struct Engine 里 call_ret/call_link/call_flag 的注释）。

// =============================================================================
// 3. DEC / ENC 混淆（异或 + 循环移位）—— 先定义，供访问器使用
// =============================================================================
//  读侧 DEC(x) = __ROR4__( key ^ __ROL4__(x,11), 25 )   =  ROL4(key ^ ROL4(x,11), 7)
//  写侧 ENC(a) = __ROL4__( key ^ __ROR4__(a,7),  21 )     (与 DEC 互为逆运算, key 相同)
inline uint32_t amayui_rol32(uint32_t v, int n) { n &= 31; return (v << n) | (v >> ((32 - n) & 31)); }
inline uint32_t amayui_ror32(uint32_t v, int n) { n &= 31; return (v >> n) | (v << ((32 - n) & 31)); }
inline uint32_t amayui_dec(uint32_t key, uint32_t x) { return amayui_ror32(key ^ amayui_rol32(x, 11), 25); }
inline uint32_t amayui_enc(uint32_t key, uint32_t a) { return amayui_rol32(key ^ amayui_ror32(a, 7), 21); }

// =============================================================================
// 4. 核心引擎对象：`struct Engine`（= 解释器 / Command 的 `this`）
// =============================================================================
struct Engine;

// opcode → handler 函数指针表（this + 0xA509C + 4*opcode，上限 0x400）
using EngineHandler = void (AMAYUI_THISCALL *)(Engine *);

struct Engine {
    // 头部未知区（0x000000 .. 0x5D800）
    char _reserved_000000[0x5D800];              // 未知区域占位

    // ---- 全局 variant 数组基址（each = 运行时数组起始地址的 32 位值；数组本体在别处）----
    uaddr global_int_base;                       // 0x5D800  this[95744]：global-int 数组基址
    char _pad_5D804[4];                          // 0x5D804  未标定（可能为计数/尾指针）
    uaddr global_float_base;                     // 0x5D808  this[95746]：global-float 数组基址
    char _pad_5D80C[4];                          // 0x5D80C  未标定
    uaddr global_string_base;                    // 0x5D810  this[95748]：global-string 数组基址
    char _pad_5D814[4];                          // 0x5D814  未标定
    uaddr global_ptr_base;                       // 0x5D818  this[95750]：global-ptr 数组基址
    char _pad_5D81C[4];                          // 0x5D81C  未标定
    uaddr global_float_ptr_base;                 // 0x5D820  this[95752]：global-float-ptr 数组基址
    char _pad_5D824[4];                          // 0x5D824  未标定

    // 全局块后再到 cur_script 的未知区
    char _reserved_5D828[0x58];                  // 0x5D828 .. 0x5D880

    // ---- 当前脚本上下文（调用/恢复的“控制流寄存器”，不是栈内字段）----
    //  这三个紧邻 dword 不是帧内字段，而是引擎的“控制流目标深度”寄存器：它们存的是
    //  **帧下标 0..39**（或哨兵 -1 空 / -10 续跑 / -11 特殊退出），不是内存地址。
    //  - cur_script  ≈ “当前在运行的那层”（像 esp/帧顶：指向 active 帧）。
    //  - call_ret    ≈ “返回/恢复目标深度”（像 active 帧的返回地址/保存的 bp：return 时 cur=call_ret）。
    //  - call_link   ≈ 次级“续跑目标深度”（-10 路径 sub_40FB60 用它保存要回跳的深度）。
    //  持久的帧内回链是 frames[cur].caller(page+0x38)，所以这些瞬时寄存器被覆盖也不失调用链。
    uint32_t cur_script;                         // 0x5D880  this[95776] (383104)：当前帧深度
    uint32_t call_ret;                           // 0x5D884  this[95777] (383108)：返回/恢复目标深度（-1/-10/-11 哨兵）
    uint32_t call_link;                          // 0x5D888  this[95778] (383112)：次级续跑目标深度（-10 用）
    uint32_t call_flag;                          // 0x5D88C  this[95779] (383116)：控制流/状态标志
    char     _reserved_5D890[0x04];              // 0x5D890 .. 0x5D894

    // ---- 每脚本帧数组（40 帧，0..39；`cur_script` 选中当前帧）----
    ScriptContext frames[40];                    // 0x5D894 .. 0x5EB54
    char _reserved_5EB54[0x138];                 // 0x5EB54 .. 0x5EC8C

    // ---- 解混淆 key ----
    uint32_t key;                                // 0x5EC8C  this[97059]：DEC/ENC 用的异或+移位 key

    // 到 dispatch 表的未知区
    char _reserved_5EC90[0x4640C];               // 0x5EC90 .. 0xA509C

    // opcode→handler 一维函数指针表（存 32 位地址，用 handler() 读取）
    uaddr dispatch[0x400];                       // 0xA509C .. 0xA609C  下标=opcode，默认 sub_418E30

    // 尾部未知区（实际大小未知；占位到 0xB0000，覆盖已观测到的最大 this+偏移 0xAAB7C）
    char _reserved_A609C[0x9F64];                // 0xA609C .. 0xB0000

    // =========================================================================
    // 5. 便捷访问器（非必需；仅为后续分析方便。均在「已确认」语义上构造）
    // =========================================================================
    //  -- 全局 int --
    uint32_t readGlobalInt (uint32_t idx) const { return amayui_dec(key, reinterpret_cast<uint32_t*>(global_int_base)[idx]); }
    void     writeGlobalInt(uint32_t idx, uint32_t v) { reinterpret_cast<uint32_t*>(global_int_base)[idx] = amayui_enc(key, v); }
    //  -- 全局 float（不编码） --
    float    readGlobalFloat (uint32_t idx) const { return reinterpret_cast<float*>(global_float_base)[idx]; }
    void     writeGlobalFloat(uint32_t idx, float v) { reinterpret_cast<float*>(global_float_base)[idx] = v; }
    //  -- 全局 string（SSO） --
    const char *globalStringCStr(uint32_t idx) const {
        const EngineString &s = reinterpret_cast<EngineString*>(global_string_base)[idx];
        return s.length < 0x10 ? s.data.inline_data : reinterpret_cast<const char*>(s.data.heap);
    }
    //  -- 全局 ptr（槽里是指针，再解引用一次，int 值过 DEC） --
    uint32_t readGlobalPtr (uint32_t idx) const {
        uint32_t *slot = reinterpret_cast<uint32_t**>(global_ptr_base)[idx];
        return amayui_dec(key, *slot);
    }
    void     writeGlobalPtr(uint32_t idx, uint32_t v) {
        uint32_t *slot = reinterpret_cast<uint32_t**>(global_ptr_base)[idx];
        *slot = amayui_enc(key, v);
    }
    float    readGlobalFloatPtr(uint32_t idx) const {
        float *slot = reinterpret_cast<float**>(global_float_ptr_base)[idx];
        return *slot;
    }
    //  -- 每脚本页（0..39） --
    ScriptContext *script(uint32_t cur) {
        return &frames[cur];
    }
    const ScriptContext *script(uint32_t cur) const {
        return &frames[cur];
    }
    //  -- opcode handler --
    EngineHandler handler(uint32_t opcode) const {
        if (opcode >= 0x400) return nullptr;
        return reinterpret_cast<EngineHandler>(dispatch[opcode]);
    }
    //  -- 局部 int（按当前脚本页） --
    uint32_t readLocalInt(uint32_t cur, uint32_t idx) const {
        return amayui_dec(key, reinterpret_cast<uint32_t*>(script(cur)->local_int)[idx]);
    }
    void     writeLocalInt(uint32_t cur, uint32_t idx, uint32_t v) {
        reinterpret_cast<uint32_t*>(script(cur)->local_int)[idx] = amayui_enc(key, v);
    }
};

static_assert(sizeof(Engine) == 0xB0000, "Engine object size placeholder");
static_assert(offsetof(Engine, global_int_base)      == 0x5D800, "offset global_int_base");
static_assert(offsetof(Engine, global_float_base)    == 0x5D808, "offset global_float_base");
static_assert(offsetof(Engine, global_string_base)   == 0x5D810, "offset global_string_base");
static_assert(offsetof(Engine, global_ptr_base)      == 0x5D818, "offset global_ptr_base");
static_assert(offsetof(Engine, global_float_ptr_base)== 0x5D820, "offset global_float_ptr_base");
static_assert(offsetof(Engine, cur_script)           == 0x5D880, "offset cur_script");
static_assert(offsetof(Engine, call_ret)             == 0x5D884, "offset call_ret");
static_assert(offsetof(Engine, call_link)            == 0x5D888, "offset call_link");
static_assert(offsetof(Engine, call_flag)            == 0x5D88C, "offset call_flag");
static_assert(offsetof(Engine, frames)               == 0x5D894, "offset frames");
static_assert(offsetof(Engine, key)                  == 0x5EC8C, "offset key");
static_assert(offsetof(Engine, dispatch)             == 0xA509C, "offset dispatch");

#pragma pack(pop)

} // namespace amayui
