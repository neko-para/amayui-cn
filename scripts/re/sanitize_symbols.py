#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# sanitize_symbols.py — 清理 Hex-Rays 输出里的 mangled 符号，使其可被 clang 解析。
#
#  问题：反编译里出现大量形如
#      `vftable'                          -> 反引号+引号包裹
#      `anonymous namespace'::_lambda1_
#      Concurrency::ISource<bool>::`vftable'
#      `Concurrency::asend<bool>'::`2'::_AsyncOriginator::`vftable'
#   这些是 MSVC mangled 名；**反引号 ` 在 C/C++ 中都是非法 token**（单引号 ' 也会让词法器
#   误判为字符字面量起点），是 clang 解析失败/级联的主要根源。
#
#  处理：对每个 `` `...' ``（反引号…引号）符号，把其中**所有非标识符字符**（包括外围的反引号
#   与引号、空格、`:`、`<`、`>`、`,`、`*` 等）替换为 `_`，得到一个合法标识符。
#      `vftable'                        -> _vftable_
#      `anonymous namespace'::_lambda1_ -> _anonymous_namespace_::_lambda1_   (:: 处另留待 v2)
#      Concurrency::ISource<bool>::`vftable' -> Concurrency::ISource<bool>::_vftable_
#
#  只动反引号区段；不碰真实字符串 "..."、注释内的反引号区间也无害（注释本就忽略）。
#
#  用法：
#     python3 scripts/re/sanitize_symbols.py /tmp/_prep.c > /tmp/_sanitized.c
#  然后仍用 C++ 模式解析（见 prelude/prep）：
#     clang -x c++ -fms-extensions -std=c++17 -include engine/hxclang_prelude.h -I engine \
#           -fsyntax-only /tmp/_sanitized.c
import sys, re

SYM_PAT = re.compile(r"`[^`']*(?:'|`)")          # `...'  或 `...`（反引号区段）
NONIDENT = re.compile(r"[^A-Za-z0-9_]")
# 全限定 mangled 名：以标识符开头、含 ::（或反引号）的连续“符号字符”串
QUAL_PAT = re.compile(r"(?<![A-Za-z0-9_\'])[A-Za-z_][A-Za-z0-9_:<>*'` ]*")

def _san(m):
    return NONIDENT.sub("_", m.group(0))

def sanitize(src):
    # 1) 先清反引号区段（`...' / `...`）
    out = SYM_PAT.sub(_san, src)
    # 2) 再折叠含 `::` 的全限定名（Concurrency::ISource<bool>::`vftable' 等）为单个标识符
    #    只处理“含 :: 或反引号”的串，且开头前不是标识符字符（token 边界），避免误伤普通 C。
    def fold(m):
        t = m.group(0)
        if '::' not in t and '`' not in t:
            return t
        return _san(m)
    out = QUAL_PAT.sub(fold, out)
    return out

def main():
    if len(sys.argv) < 2:
        print("usage: sanitize_symbols.py <c> [out.c]", file=sys.stderr); sys.exit(1)
    src_path = sys.argv[1]
    with open(src_path, 'r', encoding='utf-8', errors='replace') as f:
        src = f.read()
    out = sanitize(src)
    if len(sys.argv) > 2:
        with open(sys.argv[2], 'w', encoding='utf-8') as f:
            f.write(out)
        print(f"[sanitize] wrote {sys.argv[2]}  (backtick syms sanitized)")
    else:
        sys.stdout.write(out)

if __name__ == "__main__":
    main()
