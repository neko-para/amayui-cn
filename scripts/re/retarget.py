#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# retarget.py — 一体化管线：直接从 engine/天结_unpacked.exe_utf8.c 生成「字段标记 + 语义签名替换」版。
#
#  集成两阶段：
#    (A) 签名替换：Engine 成员函数  RET __thiscall sub_<addr>(...) -> RET Engine::<sem>_<addr>(...)
#        - sem 取自 scripts/re/semantic_names.json（已知语义名）；未知回退为 sub_<addr>（天然含地址）。
#        - **地址作为后缀保留**（`<sem>_<addr>`），便于定位汇编。
#        - **保留 _this 形参**（先不移除），去掉 __thiscall。
#    (B) 字段标记：可确证 Engine 的 `_this[K]`（常数下标命中 Engine 顶层字段）-> `this->field`。
#
#  依赖：scripts/re/detect_members.py（成员检测）、scripts/re/retype.py（解析/模型）、semantic_names.json。
#  用法：
#     $VENV scripts/re/retarget.py engine/天结_unpacked.exe_utf8.c [-o engine/engine.cpp]
import sys, os, json, re
from clang import cindex as ci
import retype
import detect_members as DM

ENGINE_TOP = retype.ENGINE_TOP
ARGS = retype.ARGS

def parse(p):
    return retype.parse(p)

def text_of(cur):
    try:
        return ''.join(t.spelling for t in cur.get_tokens())
    except Exception:
        return cur.spelling

def has_body(fn):
    return any(ch.kind == ci.CursorKind.COMPOUND_STMT for ch in fn.get_children())

def body_start(fn):
    for ch in fn.get_children():
        if ch.kind == ci.CursorKind.COMPOUND_STMT:
            return ch.extent.start.offset
    return None

def params_of(fn):
    return [c for c in fn.get_children() if c.kind == ci.CursorKind.PARM_DECL]

def elem_of(this_param):
    try:
        pt = this_param.type.get_pointee()
        if pt is not None and pt.get_size() in (1, 2, 4):
            return pt.get_size()
    except Exception:
        pass
    ts = this_param.type.spelling
    if 'char' in ts or '_BYTE' in ts:
        return 1
    return 4

CALLCONV = re.compile(r'\b(__thiscall|__fastcall|__stdcall|__cdecl)\b', re.IGNORECASE)

def semantic_name(fn_name, table):
    """sub_41BF50 -> ('readIntOperand', '41BF50')；unknown -> (None, '41BF50')。
       返回 (sem_stem_or_None, addr)。"""
    if fn_name.startswith('sub_') and len(fn_name) > 4:
        addr = fn_name[4:]
        return table.get(addr), addr
    return None, fn_name

def member_signature(src_bytes, fn, table):
    """RET __thiscall sub_<addr>(_DWORD *_this, ...) -> RET Engine::<sem>_<addr>(_DWORD *_this, ...)。"""
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
    params = sig[pop+1:pcl].strip()
    ret = CALLCONV.sub('', sig[:npos]).strip()
    sem, addr = semantic_name(name, table)
    mem = f"{sem}_{addr}" if sem else name       # 地址后缀保留
    new_sig = f"{ret} Engine::{mem}({params})" if ret else f"Engine::{mem}({params})"
    return (s, bs, new_sig)

def top_field_edits(fn, this_param):
    """_this[K]（常数，K*elem 命中 Engine 顶层字段）-> this->field。"""
    occ = []
    elem = elem_of(this_param)
    for c in fn.walk_preorder():
        if c.kind != ci.CursorKind.ARRAY_SUBSCRIPT_EXPR:
            continue
        kids = list(c.get_children())
        if len(kids) != 2:
            continue
        base, index = kids[0], kids[1]
        if text_of(base).strip() != '_this':
            continue
        if index.kind != ci.CursorKind.INTEGER_LITERAL:
            continue
        v = retype.int_value(index)
        if v is None:
            continue
        off = v * elem
        if off in ENGINE_TOP:
            occ.append((c, ENGINE_TOP[off]))
    return occ

def member_call_edits(tu, name_map, src):
    """把成员函数调用改成成员调用：`sub_M(recv, a1, ...)` -> `this->M(a1, ...)`（recv 为 _this）
       或 `recv->M(a1, ...)`（recv 为其它接收者）。会把作为「接收者」的第一实参移除。"""
    edits = []
    for c in tu.cursor.walk_preorder():
        if c.kind != ci.CursorKind.CALL_EXPR:
            continue
        kids = list(c.get_children())
        if len(kids) < 2:
            continue
        cal = kids[0]
        nm = None
        try:
            ref = cal.referenced
            if ref is not None and ref.kind == ci.CursorKind.FUNCTION_DECL:
                nm = ref.spelling
        except Exception:
            nm = None
        if nm is None or nm not in name_map:
            continue
        args = kids[1:]
        recv = DM.core_expr(text_of(args[0]).strip())
        recv_root = DM.root_var(recv)
        mem = name_map[nm]
        if len(args) >= 2:
            rest = src[args[1].extent.start.offset:args[-1].extent.end.offset].decode('utf-8', 'replace')
        else:
            rest = ''
        repl = f"this->{mem}({rest})" if recv_root == '_this' else f"{recv}->{mem}({rest})"
        s, e = c.extent.start.offset, c.extent.end.offset
        edits.append((s, e, repl))
    return edits

def main():
    if len(sys.argv) < 2:
        print("usage: retarget.py <utf8.c> [-o out.cpp]", file=sys.stderr); sys.exit(1)
    src_path = sys.argv[1]
    out_path = "engine/engine.cpp"
    if '-o' in sys.argv:
        out_path = sys.argv[sys.argv.index('-o') + 1]
    table_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "semantic_names.json")
    table = json.load(open(table_path, encoding='utf-8'))

    with open(src_path, 'rb') as f:
        src = f.read()
    tu = parse(src_path)
    # 成员检测：先跑 detect_members.detect_names，再并入已记录的成员清单
    # （docs/re/engine/member_functions.detected.txt）。后者是更完整的权威清单，合并可保证
    # 「重跑重建」不会因本环境重检测到的成员数（可能偏少）而回退既有成员改名。
    detected = set(DM.detect_names(tu))
    members = set(detected)
    det_file = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            '..', '..', 'docs', 're', 'engine', 'member_functions.detected.txt')
    if os.path.exists(det_file):
        with open(det_file, encoding='utf-8') as f:
            recorded = [ln.strip() for ln in f if ln.strip()]
        members |= set(recorded)
        print(f"[retarget] detected={len(detected)} +recorded={len(recorded)} -> members={len(members)}")

    # 成员名映射：sub_<addr> -> <sem>_<addr>（未知 -> sub_<addr>，地址始终保留）
    name_map = {}
    for nm in members:
        sem, addr = semantic_name(nm, table)
        name_map[nm] = (f"{sem}_{addr}" if sem else nm)
    # 只对「已知语义」的函数做调用点/原型改名（未知函数保持 sub_<addr>）；键用 sub_<ADDR>
    sem_rename = {}
    for nm in members:
        sem, addr = semantic_name(nm, table)
        if sem:
            sem_rename['sub_' + addr.upper()] = f"{sem}_{addr}"

    edits = []
    touched = 0
    for c in tu.cursor.walk_preorder():
        if c.kind != ci.CursorKind.FUNCTION_DECL or not has_body(c):
            continue
        if c.spelling not in members:
            continue
        this_param = next((p for p in params_of(c) if p.spelling == '_this'), None)
        sig_edit = member_signature(src, c, table)
        if sig_edit:
            edits.append(sig_edit)
        if this_param is not None:
            for (sub, field) in top_field_edits(c, this_param):
                s, e = sub.extent.start.offset, sub.extent.end.offset
                edits.append((s, e, f"this->{field}"))
        touched += 1

    # 成员调用改写：`sub_M(recv, ...)` -> `this->M(...)` / `recv->M(...)`（接收者=首实参）
    edits += member_call_edits(tu, name_map, src)

    # 应用（字节偏移；去重；遇重叠保留外层/更大范围）
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
    text = bytes(ba).decode('utf-8', 'replace')
    # 调用点/原型统一改名：`sub_<6hex>` -> 已知成员名（`<sem>_<addr>`）；未知保持 sub_<addr>。
    # 定义处已是 `Engine::<name>`，不再含裸 sub_<hex>，故仅命中调用点/原型。
    text = re.sub(r'\bsub_([0-9A-Fa-f]{6})\b',
                  lambda m: sem_rename.get('sub_' + m.group(1).upper(), m.group(0)),
                  text)
    # 成员调用 -> `this->member(...)`：把「接收者=首实参 _this」的调用改写为显式 this。
    # 只匹配「裸 member(`（非 ::member）；`_this` 在首实参位置（可为 (cast)_this）；排除原型/已转换。
    member_names = sorted(set(name_map.values()), key=len, reverse=True)
    call_pat = re.compile(
        r'(?<![A-Za-z0-9_:])(' + '|'.join(re.escape(n) for n in member_names) + r')'
        r'\(\s*(?:\([^()]*\)\s*)?_this\s*,')
    text = call_pat.sub(lambda m: f"this->{m.group(1)}(", text)
    # 帧字段化：`_this[30 * this->cur_script + K]` -> `this->frames[this->cur_script].field`
    #   K 是 _DWORD 下标；帧内偏移 = 4*K - FRAMES_BASE(0x5D894)；命中 FRAME_FIELD 才改写，
    #   未确认的偏移（如 0x34/0x40..）保持原样，绝不臆测。
    _fr = re.compile(r'_this\[\s*30\s*\*\s*this->cur_script\s*\+\s*(\d+)\s*\]')
    def _frame_repl(m):
        off = 4 * int(m.group(1)) - retype.FRAMES_BASE
        fld = retype.FRAME_FIELD.get(off)
        return f"this->frames[this->cur_script].{fld}" if fld is not None else m.group(0)
    text = _fr.sub(_frame_repl, text)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(text)
    print(f"[retarget] members_touched={touched}  edits={len(keep)}  out={out_path}")

if __name__ == "__main__":
    main()
