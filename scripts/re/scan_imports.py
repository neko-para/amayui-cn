# -*- coding: utf-8 -*-
"""scan_imports.py  (RUN AS ADMIN, 32-BIT python)

READ-ONLY: scan the running AGE engine .text for DIRECT import calls
  'call dword ptr [0x51Dxxx]'  (opcode FF 15)  and  'jmp dword ptr [0x51Dxxx]' (FF 25),
read each IAT slot's value (the resolved API address), resolve it to module!function,
and build the direct-import (call-site -> API) mapping.

Usage:  <admin 32bit python> scan_imports.py <pid> <outfile>
"""
import sys, ctypes, struct, json, os
from ctypes import wintypes
sys.stdout.reconfigure(encoding='utf-8')

PID = int(sys.argv[1]) if len(sys.argv) > 1 else 19604
OUT = sys.argv[2] if len(sys.argv) > 2 else r'..\tmp\import_map.json'
OUT = os.path.abspath(OUT)
BASE = 0x400000
TEXT_RVA = 0x1000
TEXT_SIZE = 0x11C000
SLOT_LO = 0x51C000; SLOT_HI = 0x51E000   # IAT slot region observed

k = ctypes.WinDLL('kernel32', use_last_error=True)
k.OpenProcess.restype = wintypes.HANDLE; k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
k.ReadProcessMemory.restype = wintypes.BOOL; k.ReadProcessMemory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
k.CloseHandle.restype = wintypes.BOOL; k.CloseHandle.argtypes = [wintypes.HANDLE]
k.CreateToolhelp32Snapshot.restype = wintypes.HANDLE; k.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
k.Module32FirstW.restype = wintypes.BOOL; k.Module32FirstW.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
k.Module32NextW.restype = wintypes.BOOL; k.Module32NextW.argtypes = [wintypes.HANDLE, ctypes.c_void_p]

h = k.OpenProcess(0x0010|0x0400, False, PID)
if not h:
    print('OpenProcess FAILED err=%d (run as ADMIN)' % ctypes.get_last_error()); sys.exit(1)

def rd(a, n, cap=0x10000):
    out = bytearray(); done = 0
    while done < n:
        m = min(cap, n-done)
        b = ctypes.create_string_buffer(m); r = ctypes.c_size_t(0)
        if not k.ReadProcessMemory(h, ctypes.c_void_p(a+done), b, m, ctypes.byref(r)) or r.value == 0:
            return bytes(out) if done else None
        out += b.raw[:r.value]; done += r.value
    return bytes(out)

# ---- modules + export maps ----
mods = []
snap = k.CreateToolhelp32Snapshot(0x00000008, PID)
class ME(ctypes.Structure):
    _fields_ = [("dwSize", wintypes.DWORD), ("th32ModuleID", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
        ("GlblcntUsage", wintypes.DWORD), ("ProccntUsage", wintypes.DWORD),
        ("modBaseAddr", ctypes.c_void_p), ("modBaseSize", wintypes.DWORD),
        ("hModule", wintypes.HMODULE), ("szModule", ctypes.c_wchar*256), ("szExePath", ctypes.c_wchar*260)]
me = ME(); me.dwSize = ctypes.sizeof(me)
if k.Module32FirstW(snap, ctypes.byref(me)):
    while True:
        mods.append((me.modBaseAddr, me.modBaseSize, me.szModule))
        if not k.Module32NextW(snap, ctypes.byref(me)): break
k.CloseHandle(snap)
print('modules:', len(mods))

_em = {}
def exports(base, size):
    if base in _em: return _em[base]
    m = {}
    try:
        hd = rd(base, 0x400)
        e = struct.unpack_from('<I', hd, 0x3C)[0]
        pe = rd(base+e, 0x200)
        magic = struct.unpack_from('<H', pe, 24)[0]
        dd = 24 + (96 if magic == 0x10b else 112)
        er, es = struct.unpack_from('<II', pe, dd)
        if er:
            ed = rd(base+er, 0x40)   # IMAGE_EXPORT_DIRECTORY header only
            nf, = struct.unpack_from('<I', ed, 20); nn, = struct.unpack_from('<I', ed, 24)
            af, = struct.unpack_from('<I', ed, 28); an, = struct.unpack_from('<I', ed, 32); ao, = struct.unpack_from('<I', ed, 36)
            if nf and nn:
                funcs = rd(base+af, nf*4) or b''
                name_rvas = rd(base+an, nn*4) or b''
                ords = rd(base+ao, nn*2) or b''
                for j in range(nn):
                    nrva, = struct.unpack_from('<I', name_rvas, j*4)
                    nbytes = rd(base+nrva, 256)
                    s = nbytes.split(b'\0')[0].decode('ascii','replace') if nbytes else '?'
                    oi, = struct.unpack_from('<H', ords, j*2)
                    if oi < nf:   # AddressOfNameOrdinals[j] is a 0-based index into funcs
                        fa, = struct.unpack_from('<I', funcs, oi*4)
                        if fa: m[base+fa] = s
    except Exception:
        pass
    _em[base] = m
    return m

def resolve(addr):
    if addr == 0: return None, None
    for b, sz, nm in mods:
        if b <= addr < b + (sz or 0):
            return nm, exports(b, sz).get(addr, '?')
    return None, None

# ---- scan engine .text for direct import calls ----
text = rd(BASE+TEXT_RVA, TEXT_SIZE) or b''
hits = []
slots_used = set()
i = 0
while i < len(text)-6:
    if text[i] == 0xFF and text[i+1] in (0x15, 0x25):   # call [mem] / jmp [mem]
        slot = text[i+2]|(text[i+3]<<8)|(text[i+4]<<16)|(text[i+5]<<24)
        if SLOT_LO <= slot < SLOT_HI:
            rva = TEXT_RVA + i
            hits.append((rva, slot, 'call' if text[i+1]==0x15 else 'jmp'))
            slots_used.add(slot)
            i += 6
            continue
    i += 1
print('direct import sites (call/jmp [slot]) in .text:', len(hits), ' distinct slots:', len(slots_used))

def u32(a):
    v = rd(a, 4)
    if v is None: return None
    return v[0]|(v[1]<<8)|(v[2]<<16)|(v[3]<<24)

# resolve each distinct slot
slotmap = {}
for slot in sorted(slots_used):
    val = u32(slot)
    mod, fn = resolve(val) if val else (None, None)
    slotmap[slot] = {'slot_va': slot, 'value': val, 'module': mod, 'func': fn}

# aggregate per site
sites = []
for rva, slot, kind in hits:
    s = slotmap.get(slot, {})
    sites.append({'site_rva': hex(rva), 'site_va': hex(BASE+rva), 'kind': kind,
        'slot_va': hex(slot), 'value': s.get('value'), 'module': s.get('module'), 'func': s.get('func')})

resolved = sum(1 for s in slotmap.values() if s['module'])
print('distinct slots resolved to module+func: %d/%d' % (resolved, len(slotmap)))
print('\n--- distinct slot -> module!func ---')
for slot, s in sorted(slotmap.items()):
    print('  slot %08X = %08X  %s!%s' % (slot, s['value'] or 0, s['module'] or '?', s['func'] or '?'))

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump({'pid': PID, 'sites': sites, 'slotmap': {hex(k): {'value': v['value'], 'module': v['module'], 'func': v['func']} for k, v in slotmap.items()}}, f, indent=2, ensure_ascii=False)
print('\nsaved', OUT)
k.CloseHandle(h)
