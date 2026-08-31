#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# retype.py — 把可证明为 Engine 的 `this`(=prep 后的 _this) 访问改写成字段引用。
#
#   第一版范围（保守、只动“确证”的部分）：
#     1) 用 libclang 解析 hexrays_prep.py 产出的 /tmp/_prep.c（C++ 模式 + hxclang_prelude.h）。
#     2) 证明：某函数的 _this（首个 __thiscall 形参）只要以 **常数下标** 访问过任何一个
#        Engine 高层字段偏移（>= 0x5D800）=> 该 _this 可确证为 Engine。
#     3) 改写：把该函数里的 `_this[K]`（K*4 == Engine 高层字节偏移）→ `((Engine*)_this)->field`。
#        保留 _this 原声明类型不变（不改函数签名），用 C 风格指针转换；不破坏未改写的其余下标。
#     4) 帧内访问（`_this[30*cur+C]` -> frames[cur].field）与 float/ptr 复合形，留待下一版。
#
#   用法：
#     VENV=pyenv/bin/python
#     python3 scripts/re/hexrays_prep.py engine/天结_unpacked.exe_utf8.c > /tmp/_prep.c
#     $VENV scripts/re/retype.py /tmp/_prep.c [out.c]
#
#   只输出“可确证”的改动；未确证的一概原样保留。
import sys, os, json
from clang import cindex as ci

LIB_CLANG = os.environ.get(
    "LIB_CLANG",
    "/opt/homebrew/Cellar/llvm/23.1.0/lib/libclang.dylib",
)
ci.Config.set_library_file(LIB_CLANG)

# -----------------------------------------------------------------------------
# Engine 对象模型（来自 engine/engine.hpp 已用 static_assert 锁定的偏移；字节偏移）
# -----------------------------------------------------------------------------
# 顶层字段：byte_offset -> 字段名
ENGINE_TOP = {
    0x5D800: "global_int_base",
    0x5D808: "global_float_base",
    0x5D810: "global_string_base",
    0x5D818: "global_ptr_base",
    0x5D820: "global_float_ptr_base",
    0x5D880: "cur_script",
    0x5D884: "call_ret",
    0x5D888: "call_link",
    0x5D88C: "call_flag",
    0x5EC8C: "key",
    0xA509C: "dispatch",
}
# _DWORD* 下标 K -> 字节偏移 = K*4 ; 反向查表（dword index -> field）只保留命中顶层字段的
ENGINE_DWORD_FIELD = {}
for _off, _name in ENGINE_TOP.items():
    if _off % 4 == 0:
        ENGINE_DWORD_FIELD[_off // 4] = _name

# ScriptContext 帧字段（frame-offset -> 字段名）；用于下一版帧访问
FRAME_FIELD = {
    0x00: "str_table", 0x04: "ip", 0x20: "local_int", 0x24: "local_float",
    0x28: "local_string", 0x2C: "local_ptr", 0x30: "local_float_ptr",
    0x38: "caller", 0x3C: "frame_arg", 0x60: "arity", 0x70: "array_container",
}
FRAMES_BASE = 0x5D894       # frames 数组基址（Engine 成员偏移）
FRAMES_STRIDE = 0x78        # 每帧 120 字节

# 编译参数（与 09 文档一致）
ARGS = [
    "-x", "c++", "-fms-extensions", "-std=c++17",
    "-Iengine",
    "-Wno-ignored-attributes", "-Wno-implicit-exception-spec-mismatch",
    "-ferror-limit=0",
    "-include", "engine/hxclang_prelude.h",
]

# -----------------------------------------------------------------------------
# 工具
# -----------------------------------------------------------------------------
def src_of(tu, cur):
    """取 cursor 的源码文本（offset 区间）。"""
    s, e = cur.extent.start.offset, cur.extent.end.offset
    return tu.primary_id if False else None

def text_at(src, cur):
    s, e = cur.extent.start.offset, cur.extent.end.offset
    return src[s:e]

def is_int_const(cur):
    return cur.kind == ci.CursorKind.INTEGER_LITERAL

def int_value(cur):
    """从整数/字符字面量 cursor 取数值。"""
    try:
        # get_tokens 会给出字面量文本；用 C 之求得数值
        for t in cur.get_tokens():
            txt = t.spelling
            try:
                return int(txt, 0)
            except ValueError:
                pass
    except Exception:
        pass
    try:
        return cur.evaluate.int_value
    except Exception:
        return None

def param_named(fn, name):
    for ch in fn.get_children():
        if ch.kind == ci.CursorKind.PARM_DECL and ch.spelling == name:
            return ch
    return None

# -----------------------------------------------------------------------------
# 主流程
# -----------------------------------------------------------------------------
def parse(src_path):
    idx = ci.Index.create()
    return idx.parse(src_path, args=ARGS, options=0)

def is_this_ref(cur, this_param):
    """该 cursor 是否引用同函数的 `_this` 形参（基址可能是 DECL_REF_EXPR 或 UNEXPOSED_EXPR）。"""
    if cur.spelling != "_this":
        return False
    if cur.kind not in (ci.CursorKind.DECL_REF_EXPR, ci.CursorKind.UNEXPOSED_EXPR,
                        ci.CursorKind.MEMBER_REF_EXPR):
        return False
    try:
        ref = cur.referenced
    except Exception:
        ref = None
    if ref is not None and ref.kind == ci.CursorKind.PARM_DECL and ref.spelling == "_this":
        return True
    # 兜底：有些 UNEXPOSED_EXPR 拿不到 referenced，但名字就是 _this 且该函数确有 _this 形参
    return True

def elem_size_of(base_cur):
    """base 指针元素字节宽。Engine 的 this 是 _DWORD*/uint32*/int* → 4；char*→1；双指针按 32 位游戏取 4。
       优先用类型；type 解析失败时退化为基址写到的指向类型字符串。"""
    try:
        pt = base_cur.type.get_pointee()
    except Exception:
        pt = None
    if pt is not None and pt.get_size() in (1, 2, 4):
        return pt.get_size()
    ts = base_cur.type.spelling
    if 'char' in ts or '_BYTE' in ts:
        return 1
    if ts and ('*' in ts or 'int' in ts or 'uint' in ts or '_DWORD' in ts):
        return 4
    if pt is not None and pt.kind == ci.TypeKind.POINTER:
        return 4
    return None

def collect_edits(tu, src):
    edits = []          # (start_off, end_off, replacement)
    proven = set()      # id(fn cursor) -> True (info)

    # 先遍历所有 FUNCTION_DECL，判定每个函数的 _this 是否为“可确证 Engine”
    # 用一个两遍法：先收集每个函数的 _this[K] 下标候选，再统一应用。
    fns = [c for c in tu.cursor.walk_preorder() if c.kind == ci.CursorKind.FUNCTION_DECL]

    for fn in fns:
        this_param = param_named(fn, "_this")
        if this_param is None:
            continue
        # 收集该函数内所有以 _this 为基址、且下标为常数的 ArraySubscriptExpr
        occ = []        # (sub_cur, index_cur, const_val, elem)
        for c in fn.walk_preorder():
            if c.kind != ci.CursorKind.ARRAY_SUBSCRIPT_EXPR:
                continue
            kids = list(c.get_children())
            if len(kids) != 2:
                continue
            base, index = kids[0], kids[1]
            if not is_this_ref(base, this_param):
                continue
            v = int_value(index) if is_int_const(index) else None
            if v is None:
                continue
            elem = elem_size_of(base)
            if elem is None:
                continue
            occ.append((c, index, v, elem))

        if not occ:
            continue
        # 判断该函数是否“确证 Engine”：存在任一 occ 的 v*elem_bits 命中 Engine 顶层字节偏移
        is_engine = any((v * elem) in ENGINE_TOP for (_c, _i, v, elem) in occ)
        if not is_engine:
            continue
        # 收集改写（只改命中字段的项）
        for (c, _index, v, elem) in occ:
            off = v * elem
            if off in ENGINE_TOP:
                field = ENGINE_TOP[off]
                s, e = c.extent.start.offset, c.extent.end.offset
                repl = f"((Engine*)_this)->{field}"
                edits.append((s, e, repl))
            # 帧访问（下一版）：_this[30*cur + C] 在此暂不处理

    return edits

def apply_edits(src_bytes, edits):
    """按字节偏移应用替换（libclang offset 是字节；文件含多字节 UTF-8，必须按字节处理）。"""
    # 去重 (s,e,repl)
    seen = set(); unique = []
    for e in edits:
        key = (e[0], e[1], e[2])
        if key in seen: continue
        seen.add(key); unique.append(e)
    # 按 start 降序应用，规避重叠
    unique = sorted(unique, key=lambda e: e[0], reverse=True)
    ba = bytearray(src_bytes)
    applied = 0
    last_start = len(src_bytes)
    for (s, e, repl) in unique:
        if e > last_start:
            continue            # 与已应用的更高偏移区间重叠，跳过
        ba[s:e] = repl.encode("utf-8")
        last_start = s
        applied += 1
    return bytes(ba), applied

def main():
    if len(sys.argv) < 2:
        print("usage: retype.py <prep.c> [out.c]", file=sys.stderr); sys.exit(1)
    src_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else "engine/天结_unpacked.exe_typed.c"
    with open(src_path, "rb") as f:
        src = f.read()

    tu = parse(src_path)
    edits = collect_edits(tu, src)
    out, applied = apply_edits(src, edits)
    with open(out_path, "wb") as f:
        f.write(out)

    # 统计
    defn = [c for c in tu.cursor.walk_preorder() if c.kind == ci.CursorKind.FUNCTION_DECL]
    print(f"[retype] functions={len(defn)}  edits={applied}  out={out_path}")

if __name__ == "__main__":
    main()
