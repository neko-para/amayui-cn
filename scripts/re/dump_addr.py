# -*- coding: utf-8 -*-
"""dump_addr.py  (RUN AS ADMIN; use the 32-bit python.exe)

Read the LIVE AGE process memory around a VA and disassemble it with a proper
alignment search (to fix OllyDbg's backward-scroll misalignment). Reports raw hex +
disassembly, marks the target return-address, and lists nearby `call` instructions.

Usage:  <admin python> dump_addr.py <pid> <va_hex> [from_va_hex] [end_va_hex]
        e.g.   dump_addr.py 19604 0x65D910
"""
import sys, ctypes, struct
from ctypes import wintypes
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
sys.stdout.reconfigure(encoding='utf-8')

from_va_default = 0x30
PID = int(sys.argv[1]) if len(sys.argv) > 1 else 19604
VA = int(sys.argv[2], 16) if len(sys.argv) > 2 else 0x65D910
FROM = int(sys.argv[3], 16) if len(sys.argv) > 3 else VA - from_va_default
END = int(sys.argv[4], 16) if len(sys.argv) > 4 else VA + 0x40

k = ctypes.WinDLL('kernel32', use_last_error=True)
k.OpenProcess.restype = wintypes.HANDLE; k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
k.ReadProcessMemory.restype = wintypes.BOOL; k.ReadProcessMemory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
k.CloseHandle.restype = wintypes.BOOL; k.CloseHandle.argtypes = [wintypes.HANDLE]
h = k.OpenProcess(0x0010, False, PID)
if not h:
    print('OpenProcess FAILED err=%d (run as ADMIN)' % ctypes.get_last_error()); sys.exit(1)

def rd(a, n):
    out = bytearray(); d = 0
    while d < n:
        m = min(0x10000, n-d); b = ctypes.create_string_buffer(m); r = ctypes.c_size_t(0)
        if not k.ReadProcessMemory(h, ctypes.c_void_p(a+d), b, m, ctypes.byref(r)) or r.value == 0:
            return bytes(out) if d else None
        out += b.raw[:r.value]; d += r.value
    return bytes(out)

data = rd(FROM, END - FROM)
k.CloseHandle(h)
if not data or len(data) == 0:
    print('read failed @0x%X..0x%X' % (FROM, END)); sys.exit(2)
print('read %d bytes @0x%X..0x%X' % (len(data), FROM, END))
print('--- raw hex ---')
for i in range(0, len(data), 16):
    row = data[i:i+16]
    print('  %08X  %s' % (FROM+i, ' '.join('%02X' % x for x in row)))

md = Cs(CS_ARCH_X86, CS_MODE_32)
def linear(start, buf):
    return list(md.disasm(buf, start))

# find an alignment such that VA is a clean instruction boundary
best = None
for delta in range(0, 16):
    start = FROM + delta
    insns = linear(start, data[delta:])
    addrs = {i.address for i in insns}
    if VA in addrs and VA-2 in addrs:
        best = (start, insns); break
    if best is None and VA in addrs:
        best = (start, insns)
if best is None:
    best = linear(FROM, data), FROM
    start, insns = best[1], best[0]
else:
    start, insns = best
print('\n--- disassembly (from %08X; alignment chosen so %08X is an instruction boundary) ---' % (start, VA))
for insn in insns:
    mark = ''
    if insn.address == VA: mark = '   <<< RETURN ADDR'
    elif insn.mnemonic in ('call',) or insn.op_str.startswith('call'):
        mark = '   <<< CALL %s' % insn.op_str
    print('  %08X  %-8s %s%s' % (insn.address, insn.mnemonic, insn.op_str, mark))
