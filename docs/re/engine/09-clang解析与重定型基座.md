# clang 解析 Hex-Rays 输出的基座：prelude + prep（engine）

> 级别：**已确认 / 可运行**（clang 17 实测）。目标：在**无 IDA**、纯文件驱动的流程里，
> 用 **libclang（C++ 模式）** 解析 `engine/天结_unpacked.exe_utf8.c`，为 AST 重写器
> （`retype.py`，按 `engine.hpp` 把 `_this+偏移`→`字段`、`sub_XXXX`→语义名）提供稳定的 AST。
>
> 产物：
> - `engine/hxclang_prelude.h` —— 预置头（Win32/CRT/异常/最小 `std::` 桩 + 全局 new/delete）。
> - `scripts/re/hexrays_prep.py` —— token 级把 `this`→`_this`（不动注释/字符串）。

---

## 1. 为什么是「C++ 模式 + prep」而不是纯 C

这份 Hex-Rays 输出是 **MSVC 编译的 C++ 二进制**，反编译里混有：

- `std::vector`/`std::string`/`std::tr1`/`std::exception`/`std::bad_alloc`/`_Xlength_error`…（`::` 只出现在 C++）；
- `operator new/delete`、`__hidden this`、模板成员符（`_Impl_no_alloc0<...>`）；
- `__ROL4__`/`__ROR4__`/`__ROR__`（`defs.h` 的 **C++ 分支**才有）。

**C 模式**：能容忍形参名 `this`，但被 `::`/`operator`/`__ROL4__` 卡死。
**C++ 模式**：`::`/`operator`/`__ROL4__` 都能解析，**但 `this` 是 C++ 关键字**，形参名 `this` 报
`invalid use of 'this' outside of a non-static member function`。

→ 于是用 **C++ 模式 + `this`→`_this` token 级改名**（`hexrays_prep.py`），把唯一的关键字冲突消掉。

> 关键坑（实测踩到）：若把单引号 `'` 当**字符字面量**处理，会被 Hex-Rays 的
> **mangled-name 装饰符**（`` `Concurrency::...'::'2'::... `` 里的 `'`）误导成“未闭合字面量”，
> 从而吞掉含 `this` 的大段区域。`hexrays_prep.py` **只按 `"`（双引号）与注释跳过**，
> 不把 `'` 当字面量起点——因为真正的 `this` 不会出现在合法字符字面量里，mangled-name 的 `'` 原样穿过即可。

## 2. 用法（不改动目标 .c）

```bash
# 1) 预处理：this -> _this（token 级，输出到临时副本）
python3 scripts/re/hexrays_prep.py engine/天结_unpacked.exe_utf8.c > /tmp/_prep.c

# 1.5) 清理 mangled 符号（`...' 反引号/引号 + `::` 全限定名 -> 单个标识符）
python3 scripts/re/sanitize_symbols.py /tmp/_prep.c > /tmp/_sanitized.c

# 2) libclang / clang 解析（C++ 模式 + -include prelude + -I engine）
clang -x c++ -fms-extensions -std=c++17 \
      -include engine/hxclang_prelude.h -I engine \
      -Wno-ignored-attributes -Wno-implicit-exception-spec-mismatch \
      -ferror-limit=0 -fsyntax-only /tmp/_sanitized.c
```

- `<defs.h>` 由 `-I engine` 命中；`-fms-extensions` 让 `__thiscall/__fastcall/__stdcall/__declspec`
  被当作关键字（针对非 x86 target 只是 warning，可 `-Wno-ignored-attributes` 消除）。
- 不 `-fms-compatibility`（实测它会与 macOS SDK 头冲突，报 `char16_t`/`char32_t` 未声明）。
- **mangled 符号清理**：反编译里大量 `` `vftable' ``、`Concurrency::ISource<bool>::`vftable'` 等——**反引号 ` 在 C/C++ 都是非法 token**，是 clang 解析失败/级联的主因。`sanitize_symbols.py` 把
  `` `...' ``（含反引号/引号及内部 `:<>*'` 等）与含 `::` 的全限定符号替换为**单个标识符**
  （非标识符字符→`_`）。实测错误数 9793 → **7290**（~26% ↓）。8 种反引号符号（`vftable`、
  `anonymous namespace`、`RTTI Type Descriptor`、`eh vector destructor/constructor iterator`、
  `scalar deleting destructor`、`Concurrency::asend<bool>`、`2`），1727 处。

## 3. 解析结果与剩余诊断（已实测）

从「完全无法解析」降到「**文件能进 AST**」：

- 已解决的：`defs.h` 的宏/类型、`__ROL4__`/`__ROR4__`、`this` 关键字、Win32 类型
  （`HWND/HANDLE/DWORD/HLOCAL/SIZE_T/DWORD_PTR/LPCRITICAL_SECTION/COLORREF/__m64`…）、
  Win32/CRT API、异常运行时（`_CxxThrowException`、`_TI1_*`）、`std::` 最小桩、全局 new/delete。
- **剩余诊断（不阻塞 AST 重写器）**，大致三类：
  1. **类型不安全（占大头）**：把函数指针/指针存进 `uint` 槽（`assigning to 'uint' from incompatible
     type 'int (uint32*)...'`、`pointer to integer conversion`）。这是**反编译器的类型自由**，
     不是结构错误——AST 照常生成 `BinaryOperator`/`CastExpr`。
  2. **MSVC PPL/STL 极深内部**（`Concurrency::`、`std::tr1::_Impl_no_alloc0/_Impl_base1`、
     `_mm_pause`、`__m64` 的 `m_i16/m_u64` 等）：非 Win 主机无法也无须完整定义；集中在
     约 100000 行起的 std::thread / parallel_for 反编译块。
  3. **个别全局/前向声明顺序**（`dword_E1BC`/`byte_D6D8`/`lived`/`sub_D00` 等）：Hex-Rays 全局
     在函数体前未声明导致；可通过追加全局前向声明或接受 AST 恢复缓解。

> 结论：**prelude + prep 的目的不是“零告警”，而是让结构可解析、AST 可遍历**。
> 剩下的类型不安全/STL 内部诊断与重写器的目标无关（重写器关注 `_this[..]`/`_this+const`/`sub_XXXX`
> 这些节点，不关心赋值是否类型严格）。

## 4. 下一步（TODO）

- [x] **v1 落地（libclang 重写）**：`scripts/re/retype.py` 已实现并跑通——用 `clang.cindex` + brew `libclang.dylib`
      解析 `/tmp/_prep.c`，对“可确证 Engine”的函数把 `_this[K]`（常数下标，且元素宽=4、`K*4` 命中
      `ENGINE_TOP` 字段）改写成 `((Engine*)_this)->field`。全文件命中 **904 处**；产物
      `engine/天结_unpacked.exe_typed.c`。
  - 关键正确性：libclang 的 `extent.offset` 是**字节**，文件含多字节 UTF-8 → 必须按 `bytearray` 字节切片，
      不能按 Python 字符切片（否则错位乱码）。另：`_this[K]` 的字节偏移 = `K * sizeof(pointee)`
      （Engine 的 `this` 是 `_DWORD*`→4；`char*` 基址→1），据此排除 char* 缓冲函数、只改真正的 Engine 访问。
  - **v1 范围**：只改「常数下标的 Engine 顶层字段」（`global_int/float/string/ptr/float_ptr_base`、
      `cur_script`、`call_ret/call_link/call_flag`、`key`）。**未改**：帧内访问 `_this[30*cur+C]`→`frames[cur].field`、
      `char*`/`int` 基址的 `_this + 字节偏移` 形式、`sub_XXXX`→语义名、全局 `dword_*` 前向声明。
- [ ] v2：帧内访问 `_this[30*cur+C]` → `_this->frames[cur].field`（`C*4-0x5D894` 命中 `FRAME_FIELD`）。
- [ ] v2：`_this + <byte>`（char*/int 基址）+ `*(_DWORD*)(_this+…)` → 字段；以及嵌套 `_this->frames` 链。
- [ ] v3：`semantic_names.json` 驱动 `sub_XXXX`→语义名；全局 `dword_*/byte_*` 前向声明降噪。
- [ ] 需要 `pip install clang`（Python 绑定；`/Library/Developer/CommandLineTools/usr/lib/libclang.dylib` 已存在）。
