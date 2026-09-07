/* =============================================================================
 * utils.cpp — 引擎通用工具函数（自由函数：非 Engine 成员 / 非 opcode handler）
 * 本文件存放跨子系统复用、与任何特定类无关的引擎工具函数。
 * 由用户指定从 engine-refined/remaining-code.cpp 拆出；remaining-code.cpp 在原
 * 函数定义区间以空行回填，保持其行号与 engine/天结_unpacked.exe_utf8.c 对应。
 * ============================================================================= */

/* ===== [x] sub_408050  →  StringFormat                  状态: ANALYZED =====
 * 安全/有界 printf 格式化字符串构建 —— 引擎版的 sprintf_s / StringCbPrintf / StringCchPrintf。
 * 签名: int StringFormat(char *Buffer, int size, char *Format, ...)
 * 注意: 自由函数（非 __thiscall / 非成员），自 remaining-code.cpp 迁至 utils.cpp。
 * 语义（已读体确认）:
 *   - va_start(va, Format) 取可变参数；用 _vsnprintf(Buffer, size-1, Format, va) 格式化，
 *     故最多写 size-1 个内容字节，保证 Buffer[size-1] 恒为 '\0'（防溢出/截断）。
 *   - 返回 HRESULT 风格状态码:
 *       size <= 0                      → 0x80070057  E_INVALIDARG
 *         (HRESULT_FROM_WIN32(ERROR_INVALID_PARAMETER=87)，参数非法)
 *       写入数 v6 < 0（_vsnprintf 出错/截断）或 v6 > v4（超长）=size-1
 *                                         → Buffer[size-1]=0，0x8007007A
 *         (HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER=122)，缓冲区太小)
 *       v6 == v4（刚好填满）              → Buffer[size-1]=0，返回 0
 *       其余（成功）                      → 返回 0（v5 恒为 0）
 * 用途: 全引擎用它在固定大小栈缓冲里构造：错误信息（"画像ファイル %s の読み込みに失敗しました"、
 *       "Depth が不正です %s != %s"、CMD 错误等，写 _this+8/message_buf，size=1024）、
 *       文件名/路径（"%s\\CG%6.6d.BMP"、"SAVE%2.2d.DAT"、VARIABLES*.TXT，size=256）、
 *       注册表子键（"Software\\%s\\%s"，size=256）、LOGFONT.lfFaceName（size=32）、
 *       调试/数值转串（"%lf"/"%d"）等。调用点分布见 remaining-code.cpp(~60) 与 engine/*.cpp。
 * 无 `_this[K]` 直接数值偏移字段访问；仅调用 CRT _vsnprintf/va_start（非引擎函数），故可标 ANALYZED。
 * 证据: engine/天结_unpacked.exe_utf8.c raw 217（声明）/12928（定义）；调用示例 raw 13306、43203、110493。
 */
int StringFormat(char *Buffer, int a2, char *Format, ...)
{
  int result; // eax
  unsigned int v4; // esi
  int v5; // ebx
  int v6; // eax
  va_list va; // [esp+14h] [ebp+14h] BYREF

  va_start(va, Format);
  result = 0;
  if ( a2 <= 0 )
    result = -2147024809;
  if ( result >= 0 )
  {
    v4 = a2 - 1;
    v5 = 0;
    v6 = _vsnprintf(Buffer, a2 - 1, Format, va);
    if ( v6 < 0 || v6 > v4 )
    {
      Buffer[v4] = 0;
      return -2147024774;
    }
    else if ( v6 == v4 )
    {
      Buffer[v4] = 0;
      return 0;
    }
    return v5;
  }
  return result;
}
