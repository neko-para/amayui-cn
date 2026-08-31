#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# memberize.py — 把 Engine 成员函数改成「成员函数实现」形态：
#   1) 函数签名：`RET __thiscall sub_XXX(_DWORD *_this, ...)` -> `RET Engine::sub_XXX(_DWORD *_this, ...)`
#                （**保留 _this 形参**；去掉 __thiscall；前缀 Engine::）。
#   2) 字段访问：把已字段化的 `((Engine*)_this)->key` 类表达式改为显式 `this->key`；
#                本脚本直接对「可确证 Engine」的 `_this[K]`（常数下标命中 Engine 顶层字段）
#                生成 `this->field`（等价于先 ((Engine*)_this)->field 再 this->field 的终态）。
#
#   用法：
#     $VENV scripts/re/memberize.py engine/天结_unpacked.exe_utf8.c /tmp/_members.txt [-o out.cpp]
import sys, re
from clang import cindex as ci
import retype

ENGINE_TOP = retype.ENGINE_TOP
ARGS = retype.ARGS

def parse(p):
    return retype.parse(p)

def text_of(cur):
    try:
        return ''.join(t.spelling for t in cur.get_tokens())
    except Exception:
        return cur.spelling

def params_of(fn):
    return [c for c in fn.get_children() if c.kind == ci.CursorKind.PARM_DECL]

def has_body(fn):
    return any(ch.kind == ci.CursorKind.COMPOUND_STMT for ch in fn.get_children())

def body_start(fn):
    for ch in fn.get_children():
        if ch.kind == ci.CursorKind.COMPOUND_STMT:
            return ch.extent.start.offset
    return None

def elem_of(p):
    try:
        pt = p.type.get_pointee()
        if pt is not None and pt.get_size() in (1, 2, 4):
            return pt.get_size()
    except Exception:
        pass
    ts = p.type.spelling
    if 'char' in ts or '_BYTE' in ts:
        return 1
    return 4

CALLCONV = re.compile(r'\b(__thiscall|__fastcall|__stdcall|__cdecl)\b', re.IGNORECASE)

def make_sig_keep_this(src_bytes, fn):
    """RET __thiscall sub_XXX(_DWORD *_this, ...) -> RET Engine::sub_XXX(_DWORD *_this, ...)；保留 _this。"""
    s = fn.extent.start.offset
    bs = body_start(fn)
    if bs is None:
        return None
    sig = src_bytes[s:bs].decode('utf-8', 'replace')
    name = fn.spelling
    npos = sig.find(name)
    if npos < 0:
        return None
    pop = sig.find('(', npos)
    if pop < 0:
        return None
    depth = 0; pcl = -1
    for i in range(pop, len(sig)):
        if sig[i] == '(': depth += 1
        elif sig[i] == ')':
            depth -= 1
            if depth == 0:
                pcl = i; break
    if pcl < 0:
        return None
    params = sig[pop+1:pcl].strip()          # 保留全部参数（含 _this）
    ret = CALLCONV.sub('', sig[:npos]).strip()
    new_sig = f"{ret} Engine::{name}({params})" if ret else f"Engine::{name}({params})"
    return (s, bs, new_sig)

def top_field_subscript(fn, params, this_param):
    """收集 `_this[K]`（常数 K、K*elem 命中 Engine 顶层字段）的 (cursor, field)；__this 基址为 _this 形参。"""
    occ = []
    for c in fn.walk_preorder():
        if c.kind != ci.CursorKind.ARRAY_SUBSCRIPT_EXPR:
            continue
        kids = list(c.get_children())
        if len(kids) != 2:
            continue
        base, index = kids[0], kids[1]
        if text_of(base).strip() != '_this':        # 基址必须是保留的 _this 形参
            continue
        if index.kind != ci.CursorKind.INTEGER_LITERAL:
            continue
        v = retype.int_value(index)
        if v is None:
            continue
        # 用 _this 形参的元素宽判断字节偏移
        elem = elem_of(this_param)
        off = v * (elem if elem else 4)
        if off in ENGINE_TOP:
            occ.append((c, ENGINE_TOP[off]))
    return occ

def main():
    if len(sys.argv) < 3:
        print("usage: memberize.py <src.c> <members.txt> [-o out.cpp]", file=sys.stderr); sys.exit(1)
    src_path = sys.argv[1]
    member_list = sys.argv[2]
    out_path = "engine/天结_unpacked.exe_member.cpp"
    if '-o' in sys.argv:
        out_path = sys.argv[sys.argv.index('-o') + 1]
    members = set(x.strip() for x in open(member_list, encoding='utf-8') if x.strip())

    with open(src_path, 'rb') as f:
        src = f.read()
    tu = parse(src_path)
    edits = []   # (start, end, repl)
    touched = 0
    for c in tu.cursor.walk_preorder():
        if c.kind != ci.CursorKind.FUNCTION_DECL or not has_body(c):
            continue
        if c.spelling not in members:
            continue
        params = params_of(c)
        this_param = next((p for p in params if p.spelling == '_this'), None)
        # 签名
        sig_edit = make_sig_keep_this(src, c)
        if sig_edit:
            edits.append(sig_edit)
        # field-ize `_this[K]` -> `this->field`
        if this_param is not None:
            for (sub, field) in top_field_subscript(c, params, this_param):
                s, e = sub.extent.start.offset, sub.extent.end.offset
                edits.append((s, e, f"this->{field}"))
        touched += 1
    # 应用（字节偏移，倒序防重叠）
    edits = sorted(set(edits), key=lambda e: (e[0], -(e[1]-e[0])))
    keep = []
    for e in edits:
        s, ee = e[0], e[1]
        if any(not (ee <= ks or s >= ke) for (ks, ke, _r) in keep):
            continue
        keep.append(e)
    keep = sorted(keep, key=lambda e: e[0], reverse=True)
    ba = bytearray(src)
    for (s, ee, repl) in keep:
        ba[s:ee] = repl.encode('utf-8')
    with open(out_path, 'wb') as f:
        f.write(bytes(ba))
    print(f"[memberize] members_touched={touched}  edits={len(keep)}  out={out_path}")

if __name__ == "__main__":
    main()
