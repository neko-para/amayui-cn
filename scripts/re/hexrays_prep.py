#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# hexrays_prep.py — 把 Hex-Rays C++ 输出预处理成 clang 可解析的形式（不改动原 .c）。
#
#   目的：libclang（C++ 模式）解析 `天结_unpacked.exe_utf8.c` 的两大障碍：
#     1) 每个 __thiscall 函数的参数名是 `this`（C++ 关键字）→ 统一改成 `_this`（token 级）。
#     2) 其余（std::/Win32/CRT/异常/__ROL4__…）由 hxclang_prelude.h 预置（见 -include）。
#
#   用法：
#     python3 scripts/re/hexrays_prep.py engine/天结_unpacked.exe_utf8.c > /tmp/_typed_prep.c
#
#   可靠性：这是「最小 token 级替换」——只把标识符 `this` 换成 `_this`，
#   且跳过 // 与 /* */ 注释、"" 字符串、'' 字符字面量，因此绝不改到注释/字符串内容。
#   `this` 在此生成代码里只作形参/局部变量，从不作 C++ 关键字使用，替换是安全的。
#
#   注：本步骤只做「解析友好化」，不做语义改写；语义映射（sub_→名称、offset→字段）
#   由 libclang AST 重写器（retype.py）在解析后完成。
import sys, re

def lex_ident(src, i):
    """返回 (start,end) if src[i] starts an identifier; else None"""
    c = src[i]
    if c.isalpha() or c == '_':
        j = i
        while j < len(src) and (src[j].isalnum() or src[j] == '_'):
            j += 1
        return (i, j)
    return None

def rename_this(src):
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        # line comment
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            if j < 0: j = n
            out.append(src[i:j]); i = j
            continue
        # block comment
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            if j < 0: j = n
            out.append(src[i:j + 2]); i = j + 2
            continue
        # string literal (double-quote only). 注意：不把单引号 ' 当字符字面量——
        # Hex-Rays 的「mangled-name」符号用 ` 与 ' 装饰（如 `Concurrency::...'::'2'::...`），
        # 若把 ' 当字符字面量会吃掉含 `this` 的大段区域；而真正的 this 从不会出现在
        # 合法字符字面量里，所以只跳过 "..." 字符串与注释即安全。
        if c == '"':
            j = i + 1
            while j < n:
                if src[j] == '\\': j += 2; continue
                if src[j] == '"': j += 1; break
                j += 1
            out.append(src[i:j]); i = j
            continue
        # identifier
        ident = lex_ident(src, i)
        if ident:
            s, e = ident
            tok = src[s:e]
            out.append('_this' if tok == 'this' else tok)
            i = e
            continue
        out.append(c); i += 1
    return ''.join(out)

def main():
    if len(sys.argv) < 2:
        print("usage: hexrays_prep.py <hexrays.c>", file=sys.stderr); sys.exit(1)
    with open(sys.argv[1], 'r', encoding='utf-8', errors='replace') as f:
        src = f.read()
    sys.stdout.write(rename_this(src))

if __name__ == '__main__':
    main()
