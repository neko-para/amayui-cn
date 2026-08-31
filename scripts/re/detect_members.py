#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# detect_members.py — 识别所有「操作 Engine 的成员函数」，只输出函数名（不做任何文本替换）。
#
#  1) 基准（baseline）：函数若有一形参（通常首参，即 this/_this）被以 **高偏移** 访问
#     （常数下标 K、K*elem 命中 Engine 顶层字段，或 `param + <byteconst>` 命中），则该形参
#     确证承载 Engine → 函数为 Engine 成员。
#  2) 传播（call/callee）：沿调用图双向 taint。
#       - DOWN：已知成员 F 调用 G 并把「Engine this 值」作为 **第 0 个实参** ⇒ G 的第 0 个形参也是
#         Engine ⇒ G 为成员。
#       - UP：某函数把「其 own this 值」作为实参传给已知成员（其第 0 形参为 Engine）⇒ 调用方也是成员。
#     迭代到不动点。局部 `v = this` 派生变量、`(cast)this` 包装也纳入 this 值集合。
#  3) 输出：全部 Engine 成员函数名。
#
#  用法：$VENV scripts/re/detect_members.py /tmp/_prep.c [--out names.txt]
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

def root_var(t):
    """取表达式→最左标识符（根变量/形参名）。"""
    t = t.strip()
    if t.startswith('('):
        t = t.strip('()').strip()
    m = re.match(r'[A-Za-z_]\w*', t)
    return m.group(0) if m else t

def core_expr(t):
    """剥离前导指针/若干括号转换，得到核心表达式（如 '(_DWORD *)_this' -> '_this'）。"""
    t = t.strip()
    while True:
        m = re.match(r'\(\s*[A-Za-z_][A-Za-z0-9_ \*]*\*\s*\)\s*', t)
        if m:
            t = t[m.end():].strip(); continue
        if t.startswith('(') and t.endswith(')'):
            inner = t[1:-1].strip()
            if inner and not any(ch in inner for ch in ',;'):
                t = inner; continue
        break
    return t

def detect_one(fn, params):
    """扫描函数体。返回 dict{seed, seed_field, assign, edges}。
       seed=承载 Engine 的形参名；assign={局部变量: 赋值源文本}；edges=[(被调函数名, [实参文本…])]"""
    seed_param = None
    seed_field = None
    def as_any(field):
        nonlocal seed_param, seed_field
        if seed_param is None:
            seed_param = field

    for c in fn.walk_preorder():
        if c.kind == ci.CursorKind.ARRAY_SUBSCRIPT_EXPR:
            kids = list(c.get_children())
            if len(kids) != 2:
                continue
            base, index = kids[0], kids[1]
            btext = root_var(text_of(base))
            if index.kind == ci.CursorKind.INTEGER_LITERAL:
                v = retype.int_value(index)
                if v is not None:
                    for p in params:
                        if btext == p.spelling and (v * elem_of(p)) in ENGINE_TOP:
                            seed_param = p.spelling; seed_field = ENGINE_TOP[v * elem_of(p)]; break
            if seed_param: break
        if c.kind == ci.CursorKind.BINARY_OPERATOR and c.spelling == '+':
            kids = list(c.get_children())
            if len(kids) == 2 and kids[1].kind == ci.CursorKind.INTEGER_LITERAL:
                v = retype.int_value(kids[1])
                if v is not None and v in ENGINE_TOP:
                    atext = root_var(text_of(kids[0]))
                    for p in params:
                        if atext == p.spelling:
                            seed_param = p.spelling; seed_field = ENGINE_TOP[v]; break
            if seed_param: break

    assign = {}
    edges = []
    for c in fn.walk_preorder():
        if c.kind == ci.CursorKind.BINARY_OPERATOR and c.spelling == '=':
            kids = list(c.get_children())
            if len(kids) == 2:
                lv = root_var(text_of(kids[0]))
                if lv and lv not in [p.spelling for p in params]:
                    assign[lv] = text_of(kids[1]).strip()
        if c.kind == ci.CursorKind.CALL_EXPR:
            kids = list(c.get_children())
            if not kids:
                continue
            cname = None
            try:
                cr = kids[0].referenced
                if cr is not None and cr.kind == ci.CursorKind.FUNCTION_DECL:
                    cname = cr.spelling
            except Exception:
                cname = None
            if cname is None:
                cname = root_var(text_of(kids[0]))
            edges.append((cname, [text_of(a).strip() for a in kids[1:]]))
    return {'seed': seed_param, 'seed_field': seed_field, 'assign': assign, 'edges': edges}

def detect_names(tu):
    """识别所有 Engine 成员函数名（返回排序后的名字列表）。tu 为已解析的 TranslationUnit。"""
    raw = [c for c in tu.cursor.walk_preorder() if c.kind == ci.CursorKind.FUNCTION_DECL]
    def has_body(c):
        return any(ch.kind == ci.CursorKind.COMPOUND_STMT for ch in c.get_children())
    seen = {}; order = []
    for c in raw:
        name = c.spelling
        if not name:
            continue
        if name not in seen:
            seen[name] = c; order.append(name)
        elif has_body(c) and not has_body(seen[name]):
            seen[name] = c
    info = {}
    for n in order:
        fn = seen[n]
        params = params_of(fn)
        data = detect_one(fn, params)
        info[n] = {'params': [p.spelling for p in params], 'data': data, 'engine_params': set()}

    # seed
    for n, d in info.items():
        if d['data']['seed']:
            d['engine_params'].add(d['data']['seed'])

    def this_values(name):
        d = info[name]
        vals = set(d['engine_params'])
        changed = True
        while changed:
            changed = False
            for v, srcx in d['data']['assign'].items():
                if v in vals:
                    continue
                if any(s and (srcx == s or srcx.startswith(s) or ('('+s+')') in srcx) for s in list(vals)):
                    vals.add(v); changed = True
        return vals

    changed = True; iters = 0
    while changed and iters < 200:
        changed = False; iters += 1
        for name, d in info.items():
            tv = this_values(name)
            for (cname, args) in d['data']['edges']:
                if not args:
                    continue
                a0c = core_expr(args[0])
                if cname in info and info[cname]['params']:
                    p0 = info[cname]['params'][0]
                    if a0c in tv or (re.match(r'[A-Za-z_]\w*', a0c) and a0c in tv):
                        if p0 not in info[cname]['engine_params']:
                            info[cname]['engine_params'].add(p0); changed = True
                    if p0 in info[cname]['engine_params'] and a0c and name != cname:
                        rv = root_var(a0c)
                        if rv in info[name]['params']:
                            if rv not in info[name]['engine_params']:
                                info[name]['engine_params'].add(rv); changed = True
                        elif rv in info[name]['data']['assign']:
                            srcx = info[name]['data']['assign'][rv]
                            seen=set(); r2 = srcx
                            while r2 in info[name]['data']['assign'] and r2 not in seen:
                                seen.add(r2); r2 = info[name]['data']['assign'][r2]
                            r2 = core_expr(r2)
                            if r2 in info[name]['params'] and r2 not in info[name]['engine_params']:
                                info[name]['engine_params'].add(r2); changed = True

    return sorted(n for n, d in info.items() if d['engine_params'])

def main():
    src = sys.argv[1]
    out = None
    if '--out' in sys.argv:
        out = sys.argv[sys.argv.index('--out') + 1]
    tu = parse(src)
    members = detect_names(tu)
    if out:
        with open(out, 'w', encoding='utf-8') as f:
            f.write("\n".join(members) + "\n")
        print(f"[detect] members={len(members)}  out={out}")
    else:
        print(f"[detect] members={len(members)}")
        for n in members:
            print(n)

if __name__ == "__main__":
    main()
