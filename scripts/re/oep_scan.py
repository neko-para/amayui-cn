# -*- coding: utf-8 -*-
"""Locate OEP of a running (ASProtect-packed) AGE process by byte-signature slide scan.

Signature source = scripts/re/oep_signature.json (extracted from raw\\天结_unpacked.exe
CRT/OEP region). Reads the process .text via ReadProcessMemory and slide-matches.
Engine is a static interpreter, so once resident the .text is stable and the OEP blob
is byte-identical to the unpacked sample; ASProtect only rewrites import-call sites,
never this CRT region.

Usage:  python scripts/re/oep_scan.py <pid> [module_base]
        module_base defaults to 0x400000 (observed; AGE loads at preferred base).
"""
import sys, os, json, struct, ctypes
from ctypes import wintypes

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
SIG = os.path.join(HERE, 'oep_signature.json')

PID = int(sys.argv[1]) if len(sys.argv) > 1 else 0
if not PID:
    print('usage: python oep_scan.py <pid> [module_base]'); sys.exit(2)
MODBASE = int(sys.argv[2], 16) if len(sys.argv) > 2 else 0x400000

sig = json.load(open(SIG, encoding='utf-8'))
IMG = int(sig['image_base'], 16)
TEXT_RVA = 0x1000
VSPAN = 0x11C000

# ---------- process read ----------
kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
class MBI(ctypes.Structure):
    _fields_ = [("BaseAddress", ctypes.c_void_p), ("AllocationBase", ctypes.c_void_p),
        ("AllocationProtect", wintypes.DWORD), ("Alignment", wintypes.DWORD),
        ("RegionSize", ctypes.c_size_t), ("State", wintypes.DWORD),
        ("Protect", wintypes.DWORD), ("Type", wintypes.DWORD)]
OpenProcess = kernel32.OpenProcess; OpenProcess.restype = wintypes.HANDLE
OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
ReadProcessMemory = kernel32.ReadProcessMemory; ReadProcessMemory.restype = wintypes.BOOL
ReadProcessMemory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
CloseHandle = kernel32.CloseHandle
h = OpenProcess(0x0410, False, PID)
if not h:
    print('OpenProcess failed, error', ctypes.get_last_error()); sys.exit(1)

def read_region(addr, size, cap=0x40000):
    out = bytearray(); done = 0
    while done < size:
        n = min(cap, size - done)
        buf = ctypes.create_string_buffer(n); rd = ctypes.c_size_t(0)
        if not ReadProcessMemory(h, ctypes.c_void_p(addr+done), buf, n, ctypes.byref(rd)) or rd.value == 0:
            return bytes(out) if done else None
        out += buf.raw[:rd.value]; done += rd.value
    return bytes(out)

def unhex(s): return bytes.fromhex(s)

print('signature: %s' % SIG)
print('pid %d  module_base=0x%08X  image_base=0x%08X  oep_rva=%s' % (PID, MODBASE, IMG, sig['oep_rva']))

print('reading .text 0x%08X..0x%08X ...' % (MODBASE+TEXT_RVA, MODBASE+TEXT_RVA+VSPAN))
text = read_region(MODBASE+TEXT_RVA, VSPAN)
if text is None:
    print('  FAILED to read .text (process not initialized / not the packed engine?)')
    CloseHandle(h); sys.exit(3)
print('  read %d bytes' % len(text))

def slide(needle, hay):
    if not needle: return []
    hits = []; start = 0
    while True:
        i = hay.find(needle, start)
        if i < 0: break
        hits.append(i); start = i + 1
    return hits

print('\n--- slide scan (hits reported as OEP RVA/VA) ---')
best = None
for name, blob in sig['signatures'].items():
    needle = unhex(blob['hex'])
    rva0 = int(blob['rva'], 16)
    hits = slide(needle, text)
    # RVA of hit = offset + TEXT_RVA
    hit_rvas = [TEXT_RVA + i for i in hits]
    print('  %-12s len=%3d sig_rva=0x%05X  hits=%s' % (name, len(needle), rva0,
        ', '.join('RVA 0x%05X (VA 0x%08X)' % (r, MODBASE+r) for r in hit_rvas) if hit_rvas else 'none'))
    if hit_rvas and name.startswith('oep_'):
        best = hit_rvas[0]

print('\n--- direct cross-check at known OEP RVA ---')
oep_rva = int(sig['oep_rva'], 16)
file_hex = unhex(sig['signatures']['oep_start_10']['hex'])
rt = read_region(MODBASE+oep_rva, 10)
print('  OEP RVA 0x%05X  runtime=%s' % (oep_rva, rt.hex(' ') if rt else 'NA'))
print('              file   =%s  MATCH=%s' % (file_hex.hex(' '), 'YES' if rt == file_hex else 'no'))

CloseHandle(h)

print('\n--- conclusion ---')
if best == oep_rva:
    print('  OEP = RVA 0x%05X  (VA 0x%08X)  -- confirmed, matches unpacked engine (AGE==天结 same build).' % (oep_rva, MODBASE+oep_rva))
elif best is not None:
    print('  OEP blob hit at RVA 0x%05X (VA 0x%08X) != reported 0x%05X -> engine was RELINKED;' % (best, MODBASE+best, oep_rva))
    print('  treat 0x%05X as the real OEP (%s).' % (best, sig['oep_rva']))
else:
    print('  no signature hit found.')
