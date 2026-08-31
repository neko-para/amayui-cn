// =============================================================================
//  hxclang_prelude.h — 让 clang（非 MSVC 宿主）解析 Hex-Rays C++ 输出的预置头 v2
//
//  用途：配合 `python3 scripts/re/hexrays_prep.py`（把 `this`→`_this`）驱动 libclang
//        解析 engine/天结_unpacked.exe_utf8.c（MSVC 编译的 C++、含 Win32/CRT/STL 符号）。
//
//  用法（不修改目标 .c；-include 强制前置）：
//     python3 scripts/re/hexrays_prep.py engine/天结_unpacked.exe_utf8.c > /tmp/_prep.c
//     clang -x c++ -fms-extensions -std=c++17 \
//           -include engine/hxclang_prelude.h -I engine \
//           -fsyntax-only /tmp/_prep.c
//
//  设计要点：
//   - C++ 模式的 engine/defs.h 已自带 ll/ull/__int64/_BYTE/_WORD/_DWORD/_QWORD、
//     uint/uchar/ushort/ulong、int8..uint64、BYTE/WORD/DWORD/LONG/BOOL/QWORD、
//     __ROL4__/__ROR4__/__ROL__ & __ROR__、_UNKNOWN、__noreturn 等 => 本头**不重复**它们。
//   - 本头只补 defs.h 没有的：Windows 类型/API 桩、CRT 专有、全局 new/delete、异常运行时、
//     std:: MSVC 内部最小桩。
//   - 不 include <new>/<exception>（避免拉起 macOS 的 std::exception/bad_alloc 造成重定义），
//     因此 std:: 桩可由本头安全定义；MSVC-STL 极深内部（_Impl_no_alloc0 等）仅给最小成型。
//   - 对「分析关键」的偏移/函数体，clang 错误恢复即可给 AST；这里尽量把首类错误清零。
// =============================================================================
#pragma once

#include <stdint.h>
#include <stddef.h>
#include <stdarg.h>
#include <math.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

// -----------------------------------------------------------------------------
// Windows 类型（defs.h 已给 BYTE/WORD/DWORD/LONG/BOOL/QWORD，故这里只加缺的；用裸整数避免撞）
// -----------------------------------------------------------------------------
typedef void *HANDLE;
typedef void *HWND;
typedef void *HINSTANCE;
typedef void *HMODULE;
typedef void *HDC;
typedef void *HBRUSH;
typedef void *HPEN;
typedef void *HFONT;
typedef void *HICON;
typedef void *HKEY;
typedef void *HTREEITEM;
typedef void *HGDIOBJ;
typedef void *LPVOID;
typedef const void *LPCVOID;
typedef char *LPSTR;
typedef const char *LPCSTR;
typedef wchar_t *LPWSTR;
typedef const wchar_t *LPCWSTR;
typedef long         HRESULT;        // 32 位 HRESULT
typedef long         LRESULT;        // 32 位 LRESULT
typedef unsigned int UINT;
typedef unsigned long ULONG;
typedef int          INT;
typedef unsigned int UINT_PTR;
typedef intptr_t     LONG_PTR;
typedef unsigned int *LPDWORD;
typedef int *LPLONG;
typedef long long LARGE_INTEGER;
typedef long long LONGLONG;
typedef unsigned long long ULONGLONG;
typedef char              CHAR;
typedef unsigned long     SIZE_T;          // 32 位 size_t（匹配 32 位目标）
typedef SIZE_T          *LPSIZE;
typedef unsigned long     DWORD_PTR;       // 32 位指针宽整数
typedef unsigned long     ULONG_PTR;
typedef HANDLE            HLOCAL;
typedef void            *HCURSOR;
typedef unsigned long     COLORREF;

// 线程同步（Hex-Rays 会在签名里引用；裸定义以能解析字段）
typedef struct _RTL_CRITICAL_SECTION_DEBUG { void *Type; void *CreatorBackTraceIndex; } _RTL_CRITICAL_SECTION_DEBUG;
typedef struct _RTL_CRITICAL_SECTION { _RTL_CRITICAL_SECTION_DEBUG *DebugInfo; long LockCount, RecursionCount, OwningThread, LockSemaphore, SpinCount; } RTL_CRITICAL_SECTION, *LPCRITICAL_SECTION;
typedef union __v_m64 { unsigned long long v; } __m64;   // 仅解析用

// 常用结构（Hex-Rays 引用其字段；裸定义以能解析成员访问，尺寸不求精确）
typedef struct _WINDOWPLACEMENT {
  unsigned int length, flags, showCmd;
  int ptMinPosition[2];  int ptMaxPosition[2];  int rcNormalPosition[4];
} WINDOWPLACEMENT;
typedef struct _OVERLAPPED {
  unsigned long Internal, InternalHigh, Offset, OffsetHigh; HANDLE hEvent;
} OVERLAPPED, *LPOVERLAPPED;
typedef struct _FILETIME { unsigned long dwLowDateTime, dwHighDateTime; } FILETIME;
typedef struct _SYSTEMTIME {
  unsigned short wYear,wMonth,wDayOfWeek,wDay,wHour,wMinute,wSecond,wMilliseconds;
} SYSTEMTIME, *LPSYSTEMTIME;
typedef struct _SECURITY_ATTRIBUTES {
  unsigned long nLength; void *lpSecurityDescriptor; int bInheritHandle;
} SECURITY_ATTRIBUTES, *LPSECURITY_ATTRIBUTES;
typedef struct _RECT { int left,top,right,bottom; } RECT, *LPRECT;
typedef struct _POINT { int x,y; } POINT, *LPPOINT;
typedef struct _MSG { HWND hwnd; unsigned int message; unsigned long wParam; long lParam; unsigned long time; int pt[2]; } MSG, *LPMSG;
typedef struct _WIN32_FIND_DATAA {
  unsigned long dwFileAttributes; FILETIME ftCreationTime, ftLastAccessTime, ftLastWriteTime;
  unsigned long nFileSizeHigh, nFileSizeLow, dwReserved0, dwReserved1;
  char cFileName[260]; char cAlternateFileName[14];
} WIN32_FIND_DATAA, *LPWIN32_FIND_DATAA;

// -----------------------------------------------------------------------------
// Windows / CRT / 全局 new-delete 桩
// -----------------------------------------------------------------------------
extern "C" {
  void Sleep(unsigned long);
  unsigned long GetTickCount(void);
  unsigned long timeGetTime(void);
  int GetWindowPlacement(HWND, WINDOWPLACEMENT*);
  int SetWindowPos(HWND, HWND, int,int,int,int, unsigned int);
  int GetClientRect(HWND, RECT*);
  int GetWindowLongA(HWND, int);
  int SetWindowLongA(HWND, int, int);
  LRESULT SendMessageA(HWND, unsigned int, unsigned long, long);
  LRESULT SendMessageW(HWND, unsigned int, unsigned long, long);
  HMODULE GetModuleHandleA(LPCSTR);
  HMODULE GetModuleHandleW(LPCWSTR);
  void *GetProcAddress(HMODULE, LPCSTR);
  HMODULE LoadLibraryA(LPCSTR);
  HANDLE CreateFileA(LPCSTR, unsigned long, unsigned long, SECURITY_ATTRIBUTES*, unsigned long, unsigned long, HANDLE);
  int ReadFile(HANDLE, void*, unsigned long, LPDWORD, LPOVERLAPPED);
  int WriteFile(HANDLE, const void*, unsigned long, LPDWORD, LPOVERLAPPED);
  int CloseHandle(HANDLE);
  unsigned long GetFileAttributesA(LPCSTR);
  void *GlobalAlloc(unsigned int, unsigned long);
  void *GlobalFree(void*);
  int MessageBoxA(HWND, LPCSTR, LPCSTR, unsigned int);
  int PostMessageA(HWND, unsigned int, unsigned long, long);
  int WideCharToMultiByte(unsigned int, unsigned long, LPCWSTR, int, LPSTR, int, LPCSTR, void*);
  int MultiByteToWideChar(unsigned int, unsigned long, LPCSTR, int, LPWSTR, int);
  void RtlMoveMemory(void*, const void*, unsigned long);
  unsigned long lstrlenA(LPCSTR);
  HRESULT CoInitializeEx(void*, unsigned long);
  HRESULT CoCreateInstance(const void*, void*, unsigned long, const void*, void**);
  void CoTaskMemFree(void*);
  void GetSystemTime(SYSTEMTIME*);
  int GetFileTime(HANDLE, FILETIME*, FILETIME*, FILETIME*);

  // CRT（MSVC 专有；其余在 <string.h>/<stdlib.h>/<stdio.h>）
  int strcpy_s(char*, unsigned long, const char*);
  int sprintf_s(char*, unsigned long, const char*, ...);
  int vsprintf_s(char*, unsigned long, const char*, ...);
  int swprintf_s(wchar_t*, unsigned long, const wchar_t*, ...);
  int _itoa_s(int, char*, unsigned long, int);
  int _snprintf(char*, unsigned long, const char*, ...);
  int _snwprintf(wchar_t*, unsigned long, const wchar_t*, ...);
  int _vsnprintf(char*, unsigned long, const char*, ...);
  int _stricmp(const char*, const char*);
  int _strnicmp(const char*, const char*, unsigned long);
  int _wcsicmp(const wchar_t*, const wchar_t*);
  char* _strdup(const char*);
  void srand(unsigned int);
  int rand(void);
}

// 全局 operator new/delete（含数组形式）
void *operator new(unsigned long);
void *operator new[](unsigned long);
void operator delete(void*);
void operator delete[](void*);

// -----------------------------------------------------------------------------
// Hex-Rays / MSVC 异常运行时（解析用声明；_TI* 仅作不透明类型）
// -----------------------------------------------------------------------------
#if defined(__cplusplus)
namespace std {
  // 异常类族（最小；非 MSVC 主机无真实定义，只为让类型名/继承解析）
  class exception { public: virtual ~exception(); virtual const char* what() const; };
  class bad_alloc : public exception {};
  class bad_cast : public exception {};
  class bad_typeid : public exception {};
  class bad_exception : public exception {};
  class length_error : public exception {};
  class out_of_range : public exception {};
  class invalid_argument : public exception {};
  class __non_rtti_object : public exception {};

  // MSVC STL 内部函数（以限定名被调用）
  void _Xlength_error(const char*);
  void _Xout_of_range(const char*);
  void __uncaught_exception();

  // 最小容器 / tr1（只让类型/成员符可解析，不保证语义）
  class string { public: void operator=(const char*); unsigned long size() const; const char* c_str() const; };
  template <class T> class vector { public: static void _Xlen(unsigned long, unsigned long); };
  namespace tr1 {
    void _Xfunc(void*, const char*);
    template <class T> struct _Impl_no_alloc0 { typedef T value_type; };
  }
}

// `_TI1_*`/`_TI2_*`/`_TI3_*` 是引擎侧（_utf8.c 的 RTTI 全局区）定义的 `_ThrowInfo` **全局对象**，
// 这里**不再**把它们 typedef 成类型（否则 `&_TI1_...` 会被当作“对类型取址”，clang 报
// `unexpected type name '...'`，从而丢弃含 `_CxxThrowException(&_TI1_...)` 的函数体）。
// 只定义 `_ThrowInfo` 结构（与其 `{v, pfn, pnih, pcatch} = {0u, &sub, NULL, &_CTA}` 初始化对位）。
typedef struct _ThrowInfo { unsigned long vfptr; void* pmfn; void* pnih; void* pcatcharray; } _ThrowInfo;

void _CxxThrowException(void*, void*);
void *__RTDynamicCast(void*, long, void*, void*, int*);
#endif
